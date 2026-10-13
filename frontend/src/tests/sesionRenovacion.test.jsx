/**
 * tests/sesionRenovacion.test.jsx
 * ---------------------------------------------------------------------------
 * HU-S9-05 — La sesión no se cae a media tarea.
 *
 * El JWT dura una hora y nadie miraba su `exp`: la sesión se acababa en seco,
 * la siguiente petición devolvía 401 y el interceptor hacía
 * `window.location.href = '/login'` — una recarga completa que se llevaba por
 * delante lo que el técnico estuviera escribiendo.
 *
 * Lo que se fija aquí:
 *   1. La lectura del `exp` del token y cuándo toca avisar.
 *   2. Que el aviso salga antes del corte, no después.
 *   3. Que "seguir conectado" renueve y el aviso desaparezca.
 *   4. Single-flight: dos renovaciones a la vez son una sola petición.
 *   5. Que un 401 no recargue la página y que varios 401 no disparen varias
 *      navegaciones.
 *   6. Que el borrador del modal de finalizar tarea sobreviva.
 * ---------------------------------------------------------------------------
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import {
  MARGEN_AVISO_MS,
  cuentaAtras,
  msHastaAviso,
  restanteDe,
  vencimientoDe,
} from '../utils/sesion'
import {
  VIGENCIA_MS,
  borrarBorrador,
  guardarBorrador,
  leerBorrador,
} from '../utils/borradorTarea'

const { postMock, getMock } = vi.hoisted(() => ({
  postMock: vi.fn(),
  getMock: vi.fn(),
}))

vi.mock('../api/client', () => ({
  EVENTO_SESION_CADUCADA: 'teleprogreso:sesion-caducada',
  marcarSesionIniciada: vi.fn(),
  default: { get: getMock, post: postMock, patch: vi.fn() },
}))

import { AuthProvider, useAuth } from '../context/AuthContext'

/** Token de juguete: solo necesita un payload base64url con `exp`. */
function tokenQueVenceEn(ms, extra = {}) {
  const payload = {
    sub: '7',
    rol: 'tecnico',
    exp: Math.floor((Date.now() + ms) / 1000),
    ...extra,
  }
  const base64 = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  return `cabecera.${base64}.firma`
}

function Pantalla() {
  const { user, sesionPorVencer } = useAuth()
  return (
    <div>
      <p>Usuario: {user?.nombre ?? 'ninguno'}</p>
      <p>Aviso: {sesionPorVencer ? 'sí' : 'no'}</p>
    </div>
  )
}

function montar(rutaInicial = '/ruta') {
  return render(
    <MemoryRouter initialEntries={[rutaInicial]}>
      <AuthProvider>
        <Routes>
          <Route path="/ruta" element={<Pantalla />} />
          <Route path="/login" element={<p>Pantalla de login</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  getMock.mockResolvedValue({
    data: { id_empleado: 7, nombre: 'Ana López', rol: 'tecnico' },
  })
})

afterEach(() => {
  vi.useRealTimers()
})

/* ── 1. Leer el token ─────────────────────────────────────────────────── */

describe('utils/sesion', () => {
  it('lee el vencimiento del token', () => {
    const token = tokenQueVenceEn(60_000)
    expect(vencimientoDe(token)).toBeGreaterThan(Date.now())
    expect(restanteDe(token)).toBeGreaterThan(55_000)
  })

  it('un token ilegible no revienta: simplemente no se sabe cuándo vence', () => {
    for (const basura of ['', 'no-es-un-jwt', 'a.b', 'a.@@@.c', null, undefined]) {
      expect(vencimientoDe(basura)).toBeNull()
      expect(msHastaAviso(basura)).toBeNull()
    }
  })

  it('el aviso se programa cinco minutos antes del corte', () => {
    const token = tokenQueVenceEn(60 * 60 * 1000)
    const espera = msHastaAviso(token)

    expect(espera).toBeGreaterThan(55 * 60 * 1000 - 2000)
    expect(espera).toBeLessThanOrEqual(60 * 60 * 1000 - MARGEN_AVISO_MS)
  })

  it('dentro del margen hay que avisar ya, no dentro de un rato', () => {
    expect(msHastaAviso(tokenQueVenceEn(2 * 60 * 1000))).toBe(0)
  })

  it('un token ya vencido no se avisa: se cierra', () => {
    expect(msHastaAviso(tokenQueVenceEn(-1000))).toBeNull()
  })

  it('la cuenta atrás nunca baja de cero', () => {
    expect(cuentaAtras(4 * 60 * 1000 + 7000)).toBe('4:07')
    expect(cuentaAtras(59_000)).toBe('0:59')
    // Con el reloj del equipo adelantado el restante sale negativo, y
    // "-0:03" en pantalla parece un fallo de la aplicación.
    expect(cuentaAtras(-5000)).toBe('0:00')
  })
})

describe('AvisoSesion — no se puede ignorar', () => {
  it('no ofrece una X que no cierra nada', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    localStorage.setItem('access_token', tokenQueVenceEn(6 * 60 * 1000))

    montar()
    await waitFor(() => expect(screen.getByText(/Usuario: Ana López/)).toBeInTheDocument())
    await act(async () => { vi.advanceTimersByTime(61_000) })

    // Las dos salidas son decisiones explícitas; la tercera —ignorarlo— es
    // justo la que había antes y acaba con el trabajo a medias perdido.
    expect(screen.queryByRole('button', { name: 'Cerrar' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Seguir conectado/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Cerrar sesión/i })).toBeInTheDocument()
  })
})

/* ── 2 y 3. El aviso y la renovación ──────────────────────────────────── */

describe('AuthContext — aviso de sesión por vencer', () => {
  it('avisa antes del corte, no después', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    // Seis minutos: el aviso entra en un minuto.
    localStorage.setItem('access_token', tokenQueVenceEn(6 * 60 * 1000))

    montar()
    await waitFor(() => expect(screen.getByText(/Usuario: Ana López/)).toBeInTheDocument())
    expect(screen.queryByText(/Tu sesión está por vencer/i)).not.toBeInTheDocument()

    await act(async () => { vi.advanceTimersByTime(61_000) })

    expect(screen.getByText(/Tu sesión está por vencer/i)).toBeInTheDocument()
    // Y con la cuenta atrás, que es el dato que hace decidir.
    expect(screen.getByText(/^[0-9]:[0-9]{2}$/)).toBeInTheDocument()
  })

  it('"seguir conectado" renueva y el aviso desaparece', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const usuario = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    localStorage.setItem('access_token', tokenQueVenceEn(6 * 60 * 1000))
    postMock.mockResolvedValue({
      data: { access_token: tokenQueVenceEn(60 * 60 * 1000) },
    })

    montar()
    await waitFor(() => expect(screen.getByText(/Usuario: Ana López/)).toBeInTheDocument())
    await act(async () => { vi.advanceTimersByTime(61_000) })

    await usuario.click(screen.getByRole('button', { name: /Seguir conectado/i }))

    await waitFor(() => {
      expect(screen.queryByText(/Tu sesión está por vencer/i)).not.toBeInTheDocument()
    })
    expect(postMock).toHaveBeenCalledWith('/auth/renovar')
    // El token nuevo queda guardado: la siguiente petición ya va con él.
    expect(restanteDe(localStorage.getItem('access_token'))).toBeGreaterThan(
      50 * 60 * 1000,
    )
  })

  it('si la renovación falla, la sesión se cierra diciendo por qué', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const usuario = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    localStorage.setItem('access_token', tokenQueVenceEn(6 * 60 * 1000))
    // Le restablecieron la contraseña: la sesión ya no se puede salvar.
    postMock.mockRejectedValue({ response: { status: 401 } })

    montar()
    await waitFor(() => expect(screen.getByText(/Usuario: Ana López/)).toBeInTheDocument())
    await act(async () => { vi.advanceTimersByTime(61_000) })

    await usuario.click(screen.getByRole('button', { name: /Seguir conectado/i }))

    expect(await screen.findByText('Pantalla de login')).toBeInTheDocument()
    expect(localStorage.getItem('access_token')).toBeNull()
  })
})

/* ── 4. Single-flight ─────────────────────────────────────────────────── */

describe('renovarSesion — single-flight', () => {
  it('dos renovaciones a la vez son una sola petición', async () => {
    // Importante más allá de la eficiencia: cada renovación REVOCA el token
    // anterior, así que dos en paralelo pueden dejar vigente uno que la otra
    // acaba de invalidar, y la sesión se cae justo al intentar salvarla.
    const { renovarSesion } = await import('../api/authService')

    let resolver
    postMock.mockReturnValue(
      new Promise((resuelve) => { resolver = resuelve }),
    )

    const primera = renovarSesion()
    const segunda = renovarSesion()
    expect(primera).toBe(segunda)

    resolver({ data: { access_token: tokenQueVenceEn(60_000) } })
    await primera

    expect(postMock).toHaveBeenCalledTimes(1)

    // Y al terminar se rearma: una renovación posterior sí sale.
    postMock.mockResolvedValue({ data: { access_token: tokenQueVenceEn(60_000) } })
    await renovarSesion()
    expect(postMock).toHaveBeenCalledTimes(2)
  })
})

/* ── 5. El 401 ya no recarga la página ────────────────────────────────── */

describe('Sesión caducada', () => {
  it('navega a login con el motivo, sin recargar la página', async () => {
    localStorage.setItem('access_token', tokenQueVenceEn(60 * 60 * 1000))

    montar()
    await waitFor(() => expect(screen.getByText(/Usuario: Ana López/)).toBeInTheDocument())

    // Lo que emite el interceptor de axios al recibir un 401.
    await act(async () => {
      window.dispatchEvent(new CustomEvent('teleprogreso:sesion-caducada'))
    })

    expect(await screen.findByText('Pantalla de login')).toBeInTheDocument()
    expect(localStorage.getItem('access_token')).toBeNull()
  })

  it('varios 401 seguidos no disparan varias navegaciones', async () => {
    localStorage.setItem('access_token', tokenQueVenceEn(60 * 60 * 1000))

    montar()
    await waitFor(() => expect(screen.getByText(/Usuario: Ana López/)).toBeInTheDocument())

    await act(async () => {
      for (let i = 0; i < 5; i += 1) {
        window.dispatchEvent(new CustomEvent('teleprogreso:sesion-caducada'))
      }
    })

    // Una sola pantalla de login, no cinco navegaciones encadenadas.
    expect(screen.getAllByText('Pantalla de login')).toHaveLength(1)
  })
})

/* ── 6. El borrador ───────────────────────────────────────────────────── */

describe('utils/borradorTarea', () => {
  it('guarda y recupera lo escrito para esa tarea', () => {
    guardarBorrador(31, {
      descripcion: 'Se cambió el conector y se midió la señal.',
      nombreFoto: 'evidencia.jpg',
    })

    expect(leerBorrador(31)).toMatchObject({
      descripcion: 'Se cambió el conector y se midió la señal.',
      // La foto no cabe en localStorage: se guarda el nombre para que el
      // técnico sepa cuál tiene que volver a elegir.
      nombreFoto: 'evidencia.jpg',
    })
  })

  it('cada tarea tiene el suyo', () => {
    guardarBorrador(31, { descripcion: 'Lo de la tarea 31' })

    expect(leerBorrador(32)).toBeNull()
  })

  it('un borrador vacío no se guarda', () => {
    guardarBorrador(31, { descripcion: '   ' })

    expect(leerBorrador(31)).toBeNull()
  })

  it('un borrador de hace más de un día ya no es de este trabajo', () => {
    guardarBorrador(31, { descripcion: 'De ayer' })

    expect(leerBorrador(31, Date.now() + VIGENCIA_MS + 1000)).toBeNull()
    // Y se limpia solo, para no ir acumulando.
    expect(localStorage.getItem('teleprogreso:borrador-tarea:31')).toBeNull()
  })

  it('un localStorage corrupto no rompe nada', () => {
    localStorage.setItem('teleprogreso:borrador-tarea:31', 'esto no es json')

    expect(leerBorrador(31)).toBeNull()
  })

  it('se borra al enviarlo', () => {
    guardarBorrador(31, { descripcion: 'Enviado' })
    borrarBorrador(31)

    expect(leerBorrador(31)).toBeNull()
  })
})
