/**
 * tests/MapaSupervisorPage.test.jsx
 * ---------------------------------------------------------------------------
 * SCRUM-225 — Integrar los marcadores de técnico (posición en vivo) en
 * MapaSupervisorPage respetando el filtro de técnico existente.
 *
 * Lo que se fija aquí:
 *   - Los técnicos con ubicación se pintan como <MarcadorTecnico>.
 *   - El <select> de técnico (filtro existente) también filtra esta capa.
 *   - Las casillas de FiltroTecnicosMapa (filtro existente) también la
 *     filtran, usando el mismo id_empleado que agrupa las tareas.
 *   - En un día que no es hoy no se piden ni se pintan: la posición en vivo
 *     no significa nada sobre el pasado.
 * ---------------------------------------------------------------------------
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { hoyISO } from '../utils/fecha'

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }) => <div>{children}</div>,
  TileLayer: () => null,
  Marker: ({ children, position }) => (
    <div data-testid="marker" data-pos={position.join(',')}>{children}</div>
  ),
  Popup: ({ children }) => <div>{children}</div>,
  useMap: () => ({ getZoom: () => 13, setView: vi.fn(), fitBounds: vi.fn() }),
}))

const HOY = hoyISO()

const TAREA_BASE = {
  id_tarea: 1,
  titulo: 'Instalación fibra óptica',
  estado_tarea: 'pendiente',
  prioridad: 'alta',
  direccion_servicio: 'Calle 15, Fraijanes',
  lat: 14.6349,
  lng: -90.5069,
  tecnico: { id_empleado: 2, nombre: 'Juan Pérez' },
}

const TECNICO_UBICACION = {
  id_empleado: 2,
  nombre: 'Juan Pérez',
  lat: 14.64,
  lng: -90.5,
  fecha_hora_registro: `${HOY}T09:45:00`,
  estado: 'en_tarea',
}

const { getMapaSupervisorMock, getTecnicosDisponiblesMock, getUbicacionesTecnicosMock } =
  vi.hoisted(() => ({
    getMapaSupervisorMock: vi.fn(),
    getTecnicosDisponiblesMock: vi.fn(),
    getUbicacionesTecnicosMock: vi.fn(),
  }))

vi.mock('../api/tareaService', () => ({
  getMapaSupervisor: getMapaSupervisorMock,
  getTecnicosDisponibles: getTecnicosDisponiblesMock,
}))

vi.mock('../api/ubicacionService', () => ({
  getUbicacionesTecnicos: getUbicacionesTecnicosMock,
}))

import MapaSupervisorPage from '../pages/MapaSupervisorPage'

describe('MapaSupervisorPage — marcadores de técnico (SCRUM-225)', () => {
  beforeEach(() => {
    getMapaSupervisorMock.mockReset().mockResolvedValue([TAREA_BASE])
    getTecnicosDisponiblesMock.mockReset().mockResolvedValue([
      { id_empleado: 2, nombre_completo: 'Juan Pérez' },
    ])
    getUbicacionesTecnicosMock.mockReset().mockResolvedValue([TECNICO_UBICACION])
  })

  it('pide y pinta la posición en vivo del técnico junto a los pines de tareas', async () => {
    render(<MapaSupervisorPage />)

    await waitFor(() => expect(getUbicacionesTecnicosMock).toHaveBeenCalled())

    // Un marcador para la tarea (14.6349,-90.5069) y otro para el técnico
    // (14.64,-90.5): ambos deben estar en el mapa a la vez.
    await waitFor(() => {
      const posiciones = screen.getAllByTestId('marker').map((m) => m.dataset.pos)
      expect(posiciones).toContain('14.64,-90.5')
    })
  })

  it('el <select> de técnico también filtra el marcador de posición en vivo', async () => {
    getTecnicosDisponiblesMock.mockResolvedValue([
      { id_empleado: 2, nombre_completo: 'Juan Pérez' },
      { id_empleado: 3, nombre_completo: 'María Gómez' },
    ])

    const user = userEvent.setup()
    render(<MapaSupervisorPage />)

    await waitFor(() => expect(getUbicacionesTecnicosMock).toHaveBeenCalled())
    await waitFor(() => {
      const posiciones = screen.getAllByTestId('marker').map((m) => m.dataset.pos)
      expect(posiciones).toContain('14.64,-90.5')
    })

    await user.selectOptions(screen.getByLabelText('Técnico'), '3')

    await waitFor(() => {
      const posiciones = screen.queryAllByTestId('marker').map((m) => m.dataset.pos)
      expect(posiciones).not.toContain('14.64,-90.5')
    })
  })

  it('apagar al técnico en el panel lateral también oculta su posición en vivo', async () => {
    const user = userEvent.setup()
    render(<MapaSupervisorPage />)

    await waitFor(() => {
      const posiciones = screen.getAllByTestId('marker').map((m) => m.dataset.pos)
      expect(posiciones).toContain('14.64,-90.5')
    })

    await user.click(screen.getByRole('checkbox', { name: /Juan Pérez/i }))

    await waitFor(() => {
      const posiciones = screen.queryAllByTestId('marker').map((m) => m.dataset.pos)
      expect(posiciones).not.toContain('14.64,-90.5')
    })
  })

  it('no pide ni pinta posiciones en vivo cuando la fecha no es hoy', async () => {
    render(<MapaSupervisorPage />)

    await waitFor(() => expect(getUbicacionesTecnicosMock).toHaveBeenCalledTimes(1))
    getUbicacionesTecnicosMock.mockClear()

    const ayer = '2020-01-01'
    fireEvent.change(screen.getByLabelText('Fecha'), { target: { value: ayer } })

    await waitFor(() => expect(getMapaSupervisorMock).toHaveBeenCalledWith(ayer))
    expect(getUbicacionesTecnicosMock).not.toHaveBeenCalled()
  })
})