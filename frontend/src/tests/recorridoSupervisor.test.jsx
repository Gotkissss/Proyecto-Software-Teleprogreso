/**
 * tests/recorridoSupervisor.test.jsx
 * ---------------------------------------------------------------------------
 * HU-5 — Recorrido del día en el mapa del supervisor.
 *
 *   - Se elige técnico y fecha con los filtros que ya existían y se activa
 *     con "Ver recorrido" (deshabilitado mientras no haya técnico).
 *   - El recorrido se dibuja como línea, con los tramos sin datos punteados,
 *     y la lista muestra en orden los eventos con su hora.
 *   - Un día sin datos muestra un estado vacío claro.
 * ---------------------------------------------------------------------------
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { hoyISO } from '../utils/fecha'

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }) => <div>{children}</div>,
  TileLayer: () => null,
  Marker: ({ children, position }) => (
    <div data-testid="marker" data-pos={position.join(',')}>{children}</div>
  ),
  CircleMarker: ({ children, center }) => (
    <div data-testid="punto" data-pos={center.join(',')}>{children}</div>
  ),
  Polyline: ({ children, positions, pathOptions }) => (
    <div
      data-testid={pathOptions?.dashArray ? 'hueco' : 'tramo'}
      data-puntos={positions.length}
    >
      {children}
    </div>
  ),
  Popup: ({ children }) => <div>{children}</div>,
  Tooltip: ({ children }) => <div>{children}</div>,
  useMap: () => ({ getZoom: () => 13, setView: vi.fn(), fitBounds: vi.fn() }),
}))

const HOY = hoyISO()

const {
  getMapaSupervisorMock,
  getTecnicosDisponiblesMock,
  getUbicacionesTecnicosMock,
  getRecorridoMock,
} = vi.hoisted(() => ({
  getMapaSupervisorMock: vi.fn(),
  getTecnicosDisponiblesMock: vi.fn(),
  getUbicacionesTecnicosMock: vi.fn(),
  getRecorridoMock: vi.fn(),
}))

vi.mock('../api/tareaService', () => ({
  getMapaSupervisor: getMapaSupervisorMock,
  getTecnicosDisponibles: getTecnicosDisponiblesMock,
}))

vi.mock('../api/ubicacionService', () => ({
  getUbicacionesTecnicos: getUbicacionesTecnicosMock,
  getRecorrido: getRecorridoMock,
}))

import MapaSupervisorPage from '../pages/MapaSupervisorPage'

const punto = (hora, evento = 'periodico', extra = {}) => ({
  lat: 14.47,
  lng: -90.44,
  fecha_hora: `${HOY}T${hora}:00`,
  evento,
  id_tarea: null,
  titulo_tarea: null,
  tras_hueco: false,
  ...extra,
})

const RECORRIDO = {
  id_empleado: 2,
  nombre: 'Juan Pérez',
  fecha: HOY,
  minutos_hueco: 10,
  puntos: [
    punto('08:00', 'entrada', { lat: 14.460 }),
    punto('08:05', 'periodico', { lat: 14.461 }),
    punto('08:20', 'inicio_tarea', { lat: 14.462, id_tarea: 7, titulo_tarea: 'Instalación fibra' }),
    punto('10:30', 'periodico', { lat: 14.470, tras_hueco: true }),
    punto('10:32', 'fin_tarea', { lat: 14.471, id_tarea: 7, titulo_tarea: 'Instalación fibra' }),
  ],
}

beforeEach(() => {
  getMapaSupervisorMock.mockReset().mockResolvedValue([])
  getTecnicosDisponiblesMock.mockReset().mockResolvedValue([
    { id_empleado: 2, nombre_completo: 'Juan Pérez' },
  ])
  getUbicacionesTecnicosMock.mockReset().mockResolvedValue([])
  getRecorridoMock.mockReset().mockResolvedValue(RECORRIDO)
})

async function abrirRecorrido(user) {
  render(<MapaSupervisorPage />)
  await screen.findByLabelText('Técnico')
  await user.selectOptions(screen.getByLabelText('Técnico'), '2')
  await user.click(screen.getByRole('button', { name: 'Ver recorrido' }))
}

describe('MapaSupervisorPage — recorrido del técnico (HU-5)', () => {
  it('"Ver recorrido" está deshabilitado mientras no se elija técnico', async () => {
    render(<MapaSupervisorPage />)

    const boton = await screen.findByRole('button', { name: 'Ver recorrido' })
    expect(boton).toBeDisabled()
    expect(getRecorridoMock).not.toHaveBeenCalled()
  })

  it('pide el recorrido del técnico y la fecha elegidos', async () => {
    const user = userEvent.setup()
    await abrirRecorrido(user)

    await waitFor(() => expect(getRecorridoMock).toHaveBeenCalledWith('2', HOY))
  })

  it('dibuja el trayecto y marca punteado el tramo sin datos', async () => {
    const user = userEvent.setup()
    await abrirRecorrido(user)

    // Tramo 08:00–08:20 (3 puntos), hueco 08:20→10:30, tramo 10:30–10:32.
    const tramos = await screen.findAllByTestId('tramo')
    expect(tramos.map((t) => t.dataset.puntos)).toEqual(['3', '2'])
    const hueco = screen.getByTestId('hueco')
    expect(within(hueco).getByText('Sin datos entre 08:20 y 10:30')).toBeInTheDocument()
    // Los eventos van con pin; los reportes periódicos como puntos.
    expect(screen.getAllByTestId('punto')).toHaveLength(2)
  })

  it('lista en orden los eventos con su hora y los tramos sin datos', async () => {
    const user = userEvent.setup()
    await abrirRecorrido(user)

    const panel = (await screen.findByText('Recorrido de Juan Pérez')).closest('section')
    const lista = within(panel).getByRole('list')
    const items = within(lista).getAllByRole('listitem').map((li) => li.textContent)
    expect(items).toEqual([
      expect.stringContaining('08:00Entrada'),
      expect.stringContaining('08:20Inició: Instalación fibra'),
      expect.stringContaining('08:20–10:30Sin datos'),
      expect.stringContaining('10:32Finalizó: Instalación fibra'),
    ])
    expect(screen.getByText(/2 ubicaciones registradas/)).toBeInTheDocument()
    expect(screen.getByText(/1 tramo sin datos/)).toBeInTheDocument()
  })

  it('un día sin datos muestra un estado vacío, no un mapa en blanco', async () => {
    getRecorridoMock.mockResolvedValue({ ...RECORRIDO, puntos: [] })
    const user = userEvent.setup()
    await abrirRecorrido(user)

    expect(await screen.findByText('Sin recorrido registrado')).toBeInTheDocument()
    expect(screen.queryByTestId('tramo')).not.toBeInTheDocument()
  })

  it('si falla la carga lo dice y permite reintentar', async () => {
    getRecorridoMock.mockRejectedValueOnce({ response: { data: { detail: 'Error del servidor' } } })
    const user = userEvent.setup()
    await abrirRecorrido(user)

    expect(await screen.findByText('Error del servidor')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('Recorrido de Juan Pérez')).toBeInTheDocument()
  })

  it('al quitar el técnico se oculta el recorrido', async () => {
    const user = userEvent.setup()
    await abrirRecorrido(user)
    await screen.findByText('Recorrido de Juan Pérez')

    await user.selectOptions(screen.getByLabelText('Técnico'), '')

    await waitFor(() =>
      expect(screen.queryByText('Recorrido de Juan Pérez')).not.toBeInTheDocument()
    )
    expect(screen.getByRole('button', { name: 'Ver recorrido' })).toBeDisabled()
  })
})
