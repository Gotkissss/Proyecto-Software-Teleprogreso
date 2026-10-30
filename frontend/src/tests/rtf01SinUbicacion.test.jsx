/**
 * tests/rtf01SinUbicacion.test.jsx
 * ---------------------------------------------------------------------------
 * RTF-01 / R3-4 y R3-5 — la marca sin GPS y la espera del GPS.
 *
 *   R3-4: «La entrada se registra sin GPS ("Ubicación no disponible"); para un
 *   control de personal de campo no se puede verificar el lugar.»
 *   R3-5: «El botón se queda con el spinner más de diez segundos sin indicar
 *   que está obteniendo la ubicación.»
 *
 * La marca sigue sin bloquearse —exigir el GPS deja al técnico sin poder
 * trabajar por un permiso denegado—, pero deja de ser un hueco mudo: se le
 * pregunta por qué y el supervisor lo lee en el historial.
 * ---------------------------------------------------------------------------
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const { postMock, getMock, posicionMock, ubicacion } = vi.hoisted(() => ({
  postMock: vi.fn(),
  getMock: vi.fn(),
  posicionMock: vi.fn(),
  ubicacion: { posicion: null, estado: 'cargando' },
}))

vi.mock('../api/client', () => ({
  default: { post: postMock, get: getMock, patch: vi.fn() },
}))

vi.mock('../utils/posicionActual', () => ({
  obtenerPosicionActual: posicionMock,
}))

vi.mock('../context/UbicacionContext', () => ({
  useUbicacion: () => ubicacion,
  UbicacionProvider: ({ children }) => children,
}))

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }) => <div>{children}</div>,
  TileLayer: () => null,
  Marker: ({ children }) => <div>{children}</div>,
  Popup: ({ children }) => <div>{children}</div>,
  useMap: () => ({ getZoom: () => 13, setView: vi.fn(), fitBounds: vi.fn() }),
}))

import { ToastProvider } from '../components/ui/Toast'
import { cuerpoMarca } from '../api/asistenciaService'
import HistorialAsistenciaTable, {
  motivoSinUbicacion,
} from '../components/asistencia/HistorialAsistenciaTable'
import PausasPage from '../pages/PausasPage'

function montar(Componente, props = {}) {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <Componente {...props} />
      </ToastProvider>
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  ubicacion.posicion = null
})

/* ══ El cuerpo de la marca ═══════════════════════════════════════════════ */

describe('cuerpoMarca', () => {
  it('con posición manda las coordenadas y nada más', () => {
    expect(cuerpoMarca({ lat: 14.4, lng: -90.4 }, 'GPS denegado')).toEqual({
      lat: 14.4,
      lng: -90.4,
    })
  })

  it('sin posición manda el motivo', () => {
    expect(cuerpoMarca(null, '  Sin señal  ')).toEqual({
      motivo_sin_ubicacion: 'Sin señal',
    })
  })

  it('sin posición y sin motivo no manda cuerpo', () => {
    // El contrato de antes: los clientes que no mandan nada siguen marcando.
    expect(cuerpoMarca(null, '   ')).toBeUndefined()
    expect(cuerpoMarca(null)).toBeUndefined()
    expect(cuerpoMarca()).toBeUndefined()
  })

  it('recorta el motivo al tope de la columna', () => {
    const cuerpo = cuerpoMarca(null, 'x'.repeat(300))
    expect(cuerpo.motivo_sin_ubicacion).toHaveLength(200)
  })

  it('media coordenada se trata como sin ubicación', () => {
    // Mandar lat sin lng daba un 422; el motivo es la respuesta correcta.
    expect(cuerpoMarca({ lat: 14.4 }, 'Sin señal')).toEqual({
      motivo_sin_ubicacion: 'Sin señal',
    })
  })
})

/* ══ R3-5 — El botón dice que está buscando la ubicación ═════════════════ */

const ESTADO_SIN_JORNADA = {
  fecha: '2026-10-28',
  id_asistencia: null,
  jornada_activa: false,
  hora_entrada: null,
  hora_salida: null,
  segundos_brutos: 0,
  segundos_trabajados: 0,
  segundos_en_pausa: 0,
  pausa_activa: null,
  tipos_usados: [],
  descansos: [],
}

function pantallaSinJornada() {
  getMock.mockImplementation(async (url) => {
    if (url === '/descanso/tipos') return { data: [] }
    return { data: ESTADO_SIN_JORNADA }
  })
}

describe('PausasPage — la espera del GPS se explica', () => {
  it('mientras busca la ubicación el botón lo dice', async () => {
    pantallaSinJornada()
    // La lectura del GPS se queda pendiente: es el caso del informe, el
    // spinner girando sin decir por qué.
    let liberar
    posicionMock.mockReturnValue(new Promise((r) => { liberar = r }))
    postMock.mockResolvedValue({ data: { ubicacion_registrada: true } })

    montar(PausasPage)
    await userEvent.click(await screen.findByRole('button', { name: /Registrar Entrada/ }))

    expect(await screen.findByText('Obteniendo ubicación…')).toBeInTheDocument()

    liberar({ lat: 14.4, lng: -90.4 })
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/asistencia/entrada', {
        lat: 14.4,
        lng: -90.4,
      })
    )
    // Y al terminar deja de decirlo.
    await waitFor(() =>
      expect(screen.queryByText('Obteniendo ubicación…')).not.toBeInTheDocument()
    )
  })
})

/* ══ R3-4 — Se pregunta por qué no hay ubicación ═════════════════════════ */

describe('PausasPage — motivo de la marca sin ubicación', () => {
  it('se puede escribir un motivo propio', async () => {
    pantallaSinJornada()
    posicionMock.mockResolvedValue(null)
    postMock.mockResolvedValue({ data: { ubicacion_registrada: false } })

    montar(PausasPage)
    await userEvent.click(await screen.findByRole('button', { name: /Registrar Entrada/ }))

    const campo = await screen.findByLabelText(/escríbelo con tus palabras/i)
    await userEvent.type(campo, 'El teléfono se quedó sin batería y lo cambié')
    await userEvent.click(
      screen.getByRole('button', { name: /Registrar con esta explicación/ })
    )

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/asistencia/entrada', {
        motivo_sin_ubicacion: 'El teléfono se quedó sin batería y lo cambié',
      })
    )
  })

  it('sin motivo escrito el botón de explicar está desactivado', async () => {
    pantallaSinJornada()
    posicionMock.mockResolvedValue(null)

    montar(PausasPage)
    await userEvent.click(await screen.findByRole('button', { name: /Registrar Entrada/ }))

    expect(
      await screen.findByRole('button', { name: /Registrar con esta explicación/ })
    ).toBeDisabled()
    // Pero siempre se puede seguir sin explicar: la marca no se bloquea.
    expect(screen.getByRole('button', { name: /Marcar sin explicar/ })).toBeEnabled()
  })

  it('si el backend rechaza la marca el modal se queda abierto', async () => {
    pantallaSinJornada()
    posicionMock.mockResolvedValue(null)
    postMock.mockRejectedValue({
      response: { status: 400, data: { detail: 'Ya tienes una jornada abierta hoy.' } },
    })

    montar(PausasPage)
    await userEvent.click(await screen.findByRole('button', { name: /Registrar Entrada/ }))
    await userEvent.click(
      await screen.findByRole('button', { name: /Marcar sin explicar/ })
    )

    expect(await screen.findByText('Ya tienes una jornada abierta hoy.')).toBeInTheDocument()
    // El modal no se cierra por un error que no es culpa del técnico.
    expect(
      screen.getByRole('button', { name: /Marcar sin explicar/ })
    ).toBeInTheDocument()
  })
})

/* ══ R3-4 — El supervisor lee el motivo en el historial ══════════════════ */

describe('motivoSinUbicacion', () => {
  it('lee el motivo de cada marca por separado', () => {
    const jornada = {
      motivo_sin_ubicacion_entrada: 'GPS denegado',
      motivo_sin_ubicacion_salida: 'Sin señal',
    }
    expect(motivoSinUbicacion(jornada, 'entrada')).toBe('GPS denegado')
    expect(motivoSinUbicacion(jornada, 'salida')).toBe('Sin señal')
  })

  it('una marca sin explicación devuelve null', () => {
    // Las jornadas anteriores a la corrección no traen los campos.
    expect(motivoSinUbicacion({}, 'entrada')).toBeNull()
    expect(motivoSinUbicacion({ motivo_sin_ubicacion_entrada: '  ' }, 'entrada')).toBeNull()
    expect(motivoSinUbicacion(null, 'salida')).toBeNull()
  })
})

describe('HistorialAsistenciaTable — el motivo se ve junto a la marca', () => {
  const jornada = (campos) => ({
    id_asistencia: 1,
    id_empleado: 2,
    nombre_empleado: 'Juan Pérez',
    rol: 'tecnico',
    fecha: '2026-10-27',
    hora_entrada: '08:00:00',
    hora_salida: '17:00:00',
    jornada_activa: false,
    lat_entrada: null,
    lng_entrada: null,
    lat_salida: null,
    lng_salida: null,
    minutos_trabajados: 480,
    horas_trabajadas: '08:00',
    horas_pausa: '00:00',
    total_pausas: 0,
    descansos: [],
    ...campos,
  })

  function simularHistorial(items) {
    getMock.mockImplementation(async (url) => {
      if (url === '/empleados') return { data: { empleados: [] } }
      return {
        data: {
          total: items.length,
          page: 1,
          page_size: 15,
          total_pages: 1,
          totales: null,
          items,
        },
      }
    })
  }

  it('muestra la explicación de la entrada y la de la salida', async () => {
    simularHistorial([
      jornada({
        motivo_sin_ubicacion_entrada: 'GPS denegado en el teléfono',
        motivo_sin_ubicacion_salida: 'Sin señal en el poste',
      }),
    ])

    montar(HistorialAsistenciaTable)

    expect(await screen.findByText(/GPS denegado en el teléfono/)).toBeInTheDocument()
    expect(screen.getByText(/Sin señal en el poste/)).toBeInTheDocument()
  })

  it('sin explicación sigue mostrando el badge, que es lo que había antes', async () => {
    simularHistorial([jornada({})])

    montar(HistorialAsistenciaTable)

    // Se espera la fila: `findAllByText` se daría por satisfecho con el badge
    // de la leyenda, que ya está en pantalla mientras la tabla carga.
    await screen.findByText('Juan Pérez')
    // Tres: la leyenda, la entrada y la salida.
    expect(screen.getAllByText('Sin ubicación')).toHaveLength(3)
  })
})
