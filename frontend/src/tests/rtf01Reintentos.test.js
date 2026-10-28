/**
 * RTF-01 / R1-2 y R2-2 — reintentos de red y la fecha en el texto de la alerta.
 * ---------------------------------------------------------------------------
 * **R1-2.** «No se pudo cargar el panel» y «No se pudo verificar la bitácora»
 * con `AxiosError: Network Error`, que al reintentar a mano funcionaban. Es el
 * arranque en frío del backend: la primera petición tras un rato sin tráfico
 * llega mientras el contenedor levanta y muere sin respuesta.
 *
 * Lo que importa de la corrección no es que reintente, sino QUÉ reintenta: un
 * POST que no devolvió respuesta puede haberse ejecutado igual —marcar
 * entrada, crear una tarea— y repetirlo duplicaría la fila.
 *
 * **R2-2.** El texto decía «no ha marcado su entrada el día de hoy» en todos
 * los avisos, así que uno del 21/08 leído en octubre afirmaba algo falso.
 * ---------------------------------------------------------------------------
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

import apiClient from '../api/client'
import { diaDeLaAlerta } from '../pages/AlertasPage'

/* ══ R1-2 — Reintento de los fallos de red ════════════════════════════════ */

describe('Reintento de peticiones', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  /**
   * Intercepta en el adaptador, que es la capa por debajo de los
   * interceptores: así se cuenta cuántas veces sale la petición de verdad.
   */
  function conAdaptador(respuestas) {
    const intentos = []
    const adaptador = vi.fn(async (config) => {
      intentos.push(config)
      const siguiente = respuestas[Math.min(intentos.length - 1, respuestas.length - 1)]
      if (siguiente instanceof Error) {
        // axios adjunta `config` al error que sale del adaptador, y el
        // interceptor lo necesita para saber qué método se intentó. Un Error
        // pelado haría que el reintento no se evaluara nunca y la prueba
        // pasaría por el motivo equivocado.
        siguiente.config = config
        throw siguiente
      }
      return { ...siguiente, config }
    })
    return { adaptador, intentos }
  }

  function errorDeRed() {
    // Lo que produce axios cuando la petición no llega o no vuelve: no hay
    // `response`.
    const error = new Error('Network Error')
    error.isAxiosError = true
    return error
  }

  function errorConEstado(status) {
    const error = new Error(`Request failed with status code ${status}`)
    error.isAxiosError = true
    error.response = { status, data: {}, headers: {} }
    return error
  }

  const respuestaOk = { status: 200, statusText: 'OK', data: { ok: true }, headers: {} }

  it('un GET que falla por red se reintenta y acaba funcionando', async () => {
    const { adaptador, intentos } = conAdaptador([errorDeRed(), respuestaOk])

    const respuesta = await apiClient.get('/metricas/supervisor', { adapter: adaptador })

    expect(respuesta.data).toEqual({ ok: true })
    expect(intentos).toHaveLength(2)
  })

  it('deja de reintentar y propaga el error tras el tope', async () => {
    // Si el backend está caído de verdad, el usuario tiene que verlo: un
    // reintento infinito deja la pantalla girando sin explicar nada.
    const { adaptador, intentos } = conAdaptador([errorDeRed()])

    await expect(
      apiClient.get('/auditoria/verificacion', { adapter: adaptador })
    ).rejects.toThrow('Network Error')
    // El original más dos reintentos.
    expect(intentos).toHaveLength(3)
  })

  it.each([502, 503, 504])('reintenta el %s del proxy', async (status) => {
    // El proxy contesta por un backend que no está: tampoco procesó nada.
    const { adaptador, intentos } = conAdaptador([errorConEstado(status), respuestaOk])

    await apiClient.get('/tareas', { adapter: adaptador })

    expect(intentos).toHaveLength(2)
  })

  it.each([400, 401, 403, 409, 422, 500])(
    'NO reintenta el %s, que lo decidió el backend',
    async (status) => {
      const { adaptador, intentos } = conAdaptador([errorConEstado(status)])

      await expect(
        apiClient.get('/tareas', { adapter: adaptador })
      ).rejects.toBeTruthy()
      expect(intentos).toHaveLength(1)
    }
  )

  it('NO reintenta un POST que se quedó sin respuesta', async () => {
    // El punto de la corrección: ese POST puede haberse ejecutado igual
    // —marcar entrada, crear una tarea, registrar una evidencia— y repetirlo
    // crearía la fila dos veces.
    const { adaptador, intentos } = conAdaptador([errorDeRed()])

    await expect(
      apiClient.post('/asistencia/entrada', {}, { adapter: adaptador })
    ).rejects.toThrow('Network Error')
    expect(intentos).toHaveLength(1)
  })

  it.each(['patch', 'delete', 'put'])(
    'NO reintenta un %s sin respuesta',
    async (metodo) => {
      const { adaptador, intentos } = conAdaptador([errorDeRed()])

      // `request` y no `apiClient[metodo](...)`: la firma de `delete` solo
      // toma (url, config), así que pasar la configuración como tercer
      // argumento la descartaba y el adaptador no se usaba nunca — la prueba
      // habría pasado sin probar nada.
      await expect(
        apiClient.request({ method: metodo, url: '/tareas/1', adapter: adaptador })
      ).rejects.toThrow('Network Error')
      expect(intentos).toHaveLength(1)
    }
  )

  it('una llamada puede pedir que no se reintente', async () => {
    // Un sondeo que ya corre en bucle no gana nada esperando.
    const { adaptador, intentos } = conAdaptador([errorDeRed()])

    await expect(
      apiClient.get('/descanso/hoy', { adapter: adaptador, sinReintento: true })
    ).rejects.toThrow('Network Error')
    expect(intentos).toHaveLength(1)
  })
})

/* ══ R2-2 — La fecha en el texto de la alerta ═════════════════════════════ */

describe('diaDeLaAlerta', () => {
  const AHORA = new Date('2026-10-28T10:00:00')

  it('dice «hoy» para la de hoy', () => {
    expect(diaDeLaAlerta('2026-10-28T08:30:00', AHORA)).toBe('hoy')
  })

  it('dice «ayer» para la de ayer', () => {
    expect(diaDeLaAlerta('2026-10-27T08:30:00', AHORA)).toBe('ayer')
  })

  it('pone la fecha completa cuando es más vieja', () => {
    // El caso del informe: un aviso del 21/08 que decía «el día de hoy».
    expect(diaDeLaAlerta('2026-08-21T08:30:00', AHORA)).toBe('el 21/08/2026')
  })

  it('aguanta una fecha ausente o ilegible sin romper la tarjeta', () => {
    expect(diaDeLaAlerta(null, AHORA)).toBe('ese día')
    expect(diaDeLaAlerta('no-es-una-fecha', AHORA)).toBe('ese día')
  })

  it('compara por día y no por horas transcurridas', () => {
    // 23:50 de ayer y 00:10 de hoy distan 20 minutos, pero son días distintos:
    // con una resta de horas, el de ayer habría dicho «hoy».
    const medianoche = new Date('2026-10-28T00:10:00')
    expect(diaDeLaAlerta('2026-10-27T23:50:00', medianoche)).toBe('ayer')
  })
})
