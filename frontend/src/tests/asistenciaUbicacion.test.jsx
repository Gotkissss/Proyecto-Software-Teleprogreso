/**
 * tests/asistenciaUbicacion.test.jsx
 * ---------------------------------------------------------------------------
 * HU-4 — Marcar entrada y salida deja constancia del lugar.
 *
 *   1. El servicio manda {lat, lng} solo cuando hay posición.
 *   2. PausasPage envía la posición al marcar y, si la marca quedó sin
 *      ubicación, se lo dice al técnico sin bloquearlo.
 *   3. El historial señala las marcas sin ubicación y, al expandir la fila,
 *      muestra el mini-mapa con el lugar de la entrada y la salida.
 * ---------------------------------------------------------------------------
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
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
  MapContainer: ({ children }) => <div data-testid="mapa">{children}</div>,
  TileLayer: () => null,
  Marker: ({ children, position }) => (
    <div data-testid="marker" data-pos={position.join(',')}>{children}</div>
  ),
  Popup: ({ children }) => <div>{children}</div>,
  useMap: () => ({ getZoom: () => 13, setView: vi.fn(), fitBounds: vi.fn() }),
}))

import { ToastProvider } from '../components/ui/Toast'
import { finalizarJornada, registrarEntrada } from '../api/asistenciaService'
import PausasPage from '../pages/PausasPage'
import HistorialAsistenciaTable from '../components/asistencia/HistorialAsistenciaTable'
import { hoyISO } from '../utils/fecha'

const LUGAR = { lat: 14.4653, lng: -90.4408 }

function montar(Componente) {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <Componente />
      </ToastProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  postMock.mockReset()
  getMock.mockReset()
  posicionMock.mockReset()
  ubicacion.posicion = null
})

// ─── Servicio ─────────────────────────────────────────────────────────────────

describe('asistenciaService', () => {
  it('registrarEntrada manda la posición como cuerpo', async () => {
    postMock.mockResolvedValue({ data: { ubicacion_registrada: true } })

    const respuesta = await registrarEntrada(LUGAR)

    expect(postMock).toHaveBeenCalledWith('/asistencia/entrada', LUGAR)
    expect(respuesta.ubicacion_registrada).toBe(true)
  })

  it('sin posición la entrada va sin cuerpo', async () => {
    postMock.mockResolvedValue({ data: { ubicacion_registrada: false } })

    const respuesta = await registrarEntrada(null)

    expect(postMock).toHaveBeenCalledWith('/asistencia/entrada', undefined)
    expect(respuesta.ubicacion_registrada).toBe(false)
  })

  it('finalizarJornada manda la posición solo si existe', async () => {
    postMock.mockResolvedValue({ data: {} })

    await finalizarJornada(LUGAR)
    await finalizarJornada()

    expect(postMock).toHaveBeenNthCalledWith(1, '/asistencia/salida', LUGAR)
    expect(postMock).toHaveBeenNthCalledWith(2, '/asistencia/salida', undefined)
  })
})

// ─── PausasPage ───────────────────────────────────────────────────────────────

function estadoPausas(campos = {}) {
  return {
    fecha: '2026-09-23',
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
    ...campos,
  }
}

function simularPantallaPausas(estado) {
  getMock.mockImplementation(async (url) => {
    if (url === '/descanso/tipos') return { data: [] }
    return { data: estado }
  })
}

describe('PausasPage — marcar con ubicación', () => {
  it('al registrar la entrada envía la posición obtenida', async () => {
    ubicacion.posicion = { lat: 14.4, lng: -90.4, accuracy: 20 }
    simularPantallaPausas(estadoPausas())
    posicionMock.mockResolvedValue(LUGAR)
    postMock.mockResolvedValue({ data: { ubicacion_registrada: true } })

    montar(PausasPage)
    await userEvent.click(await screen.findByRole('button', { name: /Registrar Entrada/ }))

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/asistencia/entrada', LUGAR)
    )
    // La última posición conocida viaja como respaldo.
    expect(posicionMock).toHaveBeenCalledWith({ respaldo: ubicacion.posicion })
    expect(await screen.findByText('¡Entrada registrada correctamente!')).toBeInTheDocument()
    expect(screen.queryByText(/quedó registrada sin ella/)).not.toBeInTheDocument()
  })

  it('sin ubicación la entrada se registra igual y se avisa al técnico', async () => {
    simularPantallaPausas(estadoPausas())
    posicionMock.mockResolvedValue(null)
    postMock.mockResolvedValue({ data: { ubicacion_registrada: false } })

    montar(PausasPage)
    await userEvent.click(await screen.findByRole('button', { name: /Registrar Entrada/ }))

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/asistencia/entrada', undefined)
    )
    expect(await screen.findByText('¡Entrada registrada correctamente!')).toBeInTheDocument()
    expect(screen.getByText(/quedó registrada sin ella/)).toBeInTheDocument()
  })

  it('al finalizar la jornada envía la posición de la salida', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    simularPantallaPausas(
      estadoPausas({ jornada_activa: true, id_asistencia: 1, hora_entrada: '08:00:00' })
    )
    posicionMock.mockResolvedValue(LUGAR)
    postMock.mockResolvedValue({ data: { ubicacion_registrada: true } })

    montar(PausasPage)
    await userEvent.click(
      await screen.findByRole('button', { name: /Guardar y Finalizar Jornada/ })
    )

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/asistencia/salida', LUGAR)
    )
  })
})

// ─── HistorialAsistenciaTable ─────────────────────────────────────────────────

function jornada(id, campos = {}) {
  return {
    id_asistencia: id,
    id_empleado: 2,
    nombre_empleado: `Técnico ${id}`,
    rol: 'tecnico',
    fecha: '2026-07-20',
    hora_entrada: '07:50:00',
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
  }
}

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

function filaDe(nombre) {
  return screen.getByText(nombre).closest('tr')
}

describe('HistorialAsistenciaTable — lugar de las marcas', () => {
  it('señala las marcas sin ubicación y no las que sí la tienen', async () => {
    simularHistorial([
      jornada(1, { lat_entrada: 14.47, lng_entrada: -90.44, lat_salida: 14.48, lng_salida: -90.45 }),
      jornada(2),
      jornada(3, { lat_entrada: 14.47, lng_entrada: -90.44 }),
    ])

    montar(() => <HistorialAsistenciaTable showHeader={false} />)
    await screen.findByText('Técnico 1')

    expect(within(filaDe('Técnico 1')).queryByText('Sin ubicación')).not.toBeInTheDocument()
    // Sin ubicación en la entrada y en la salida.
    expect(within(filaDe('Técnico 2')).getAllByText('Sin ubicación')).toHaveLength(2)
    // Solo la salida quedó sin ubicación.
    expect(within(filaDe('Técnico 3')).getAllByText('Sin ubicación')).toHaveLength(1)
    // La leyenda explica el badge.
    expect(screen.getByText(/se registró sin GPS/)).toBeInTheDocument()
  })

  it('una jornada en curso no marca la salida como faltante', async () => {
    simularHistorial([
      jornada(4, {
        fecha: hoyISO(),
        hora_salida: null,
        jornada_activa: true,
        lat_entrada: 14.47,
        lng_entrada: -90.44,
      }),
    ])

    montar(() => <HistorialAsistenciaTable showHeader={false} />)
    await screen.findByText('Técnico 4')

    expect(within(filaDe('Técnico 4')).queryByText('Sin ubicación')).not.toBeInTheDocument()
  })

  it('al expandir la fila muestra el mini-mapa con entrada y salida', async () => {
    simularHistorial([
      jornada(1, { lat_entrada: 14.4744, lng_entrada: -90.4425, lat_salida: 14.4812, lng_salida: -90.4523 }),
    ])

    montar(() => <HistorialAsistenciaTable showHeader={false} />)
    await userEvent.click(await screen.findByText('Técnico 1'))

    expect(await screen.findByText('Lugar de las marcas')).toBeInTheDocument()
    const pines = screen.getAllByTestId('marker').map((m) => m.dataset.pos)
    // [lat, lng], igual que el resto de mapas de Leaflet.
    expect(pines).toEqual(['14.4744,-90.4425', '14.4812,-90.4523'])
    expect(screen.getByText('Entrada · 07:50', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByText('Salida · 17:00', { selector: 'span' })).toBeInTheDocument()
  })

  it('si falta una marca el mini-mapa lo indica', async () => {
    simularHistorial([jornada(3, { lat_entrada: 14.47, lng_entrada: -90.44 })])

    montar(() => <HistorialAsistenciaTable showHeader={false} />)
    await userEvent.click(await screen.findByText('Técnico 3'))

    expect(await screen.findByText('Salida sin ubicación')).toBeInTheDocument()
    expect(screen.getAllByTestId('marker')).toHaveLength(1)
  })

  it('sin ninguna ubicación ni pausas la fila no se expande', async () => {
    simularHistorial([jornada(2)])

    montar(() => <HistorialAsistenciaTable showHeader={false} />)
    await userEvent.click(await screen.findByText('Técnico 2'))

    expect(screen.queryByText('Lugar de las marcas')).not.toBeInTheDocument()
    expect(screen.queryByTestId('mapa')).not.toBeInTheDocument()
  })
})
