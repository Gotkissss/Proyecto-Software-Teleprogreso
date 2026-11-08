/**
 * tests/panelMapaEquipo.test.jsx
 * ---------------------------------------------------------------------------
 * El mapa del panel: dónde está hoy cada técnico, al entrar, sin filtros.
 *
 * Lo que se fija aquí:
 *   - El panel pide las ubicaciones con alcance `dia`. Con el alcance por
 *     omisión se perdería a quien ya marcó salida, que es justo la mitad de
 *     la foto del día.
 *   - Cada técnico con coordenadas se pinta una vez.
 *   - Quien ya cerró su jornada se distingue: su punto es de hace horas y
 *     leerlo como posición actual es el error que esto evita.
 *   - El mapa ocupó el sitio de «Tareas recientes», que ya no está.
 *   - Si la llamada de ubicaciones falla, el panel entra igual. Es un añadido
 *     al panel, no su contenido: un 500 aquí no puede dejar al supervisor sin
 *     cifras ni sin la lista de técnicos.
 * ---------------------------------------------------------------------------
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '../components/ui/Toast'

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }) => <div data-testid="mapa">{children}</div>,
  TileLayer: () => null,
  Marker: ({ children, position }) => (
    <div data-testid="marker" data-pos={position.join(',')}>{children}</div>
  ),
  Popup: ({ children }) => <div>{children}</div>,
  useMap: () => ({ getZoom: () => 13, setView: vi.fn(), fitBounds: vi.fn() }),
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id_empleado: 1, nombre: 'Lucía Gómez', rol: 'supervisor' },
    isLoading: false,
    isAuthenticated: true,
  }),
  AuthProvider: ({ children }) => children,
}))

const { getUbicacionesTecnicosMock } = vi.hoisted(() => ({
  getUbicacionesTecnicosMock: vi.fn(),
}))

vi.mock('../api/ubicacionService', () => ({
  getUbicacionesTecnicos: getUbicacionesTecnicosMock,
}))

vi.mock('../api/client', () => ({
  urlArchivo: (ruta) => ruta,
  BASE_URL: 'http://backend.test',
  default: {
    get: vi.fn(async (url) => {
      if (url.startsWith('/metricas/supervisor')) {
        return {
          data: {
            tecnicos_en_jornada: 2,
            tecnicos_total: 4,
            tareas_completadas_hoy: 1,
            tareas_pendientes: 2,
            tareas_en_progreso: 1,
            tareas_retrasadas: 0,
            tareas_activas: 3,
          },
        }
      }
      if (url.startsWith('/empleados/tecnicos/disponibles')) {
        return {
          data: [
            {
              id_empleado: 7,
              nombre_completo: 'Ana López',
              tareas_activas: 1,
              disponible: true,
              en_jornada: true,
              marco_entrada: true,
            },
          ],
        }
      }
      return { data: {} }
    }),
  },
}))

const EN_LA_CALLE = {
  id_empleado: 7,
  nombre: 'Ana López',
  lat: 14.6349,
  lng: -90.5069,
  fecha_hora_registro: '2026-11-08T15:45:00',
  estado: 'en_tarea',
}

const YA_SALIO = {
  id_empleado: 8,
  nombre: 'Beto Ruiz',
  lat: 14.70,
  lng: -90.44,
  fecha_hora_registro: '2026-11-08T12:10:00',
  estado: 'fuera_de_jornada',
}

async function montarPanel() {
  const { default: DashboardPage } = await import('../pages/DashboardPage')
  return render(
    <MemoryRouter>
      <ToastProvider>
        <DashboardPage />
      </ToastProvider>
    </MemoryRouter>,
  )
}

describe('Mapa del equipo en el panel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getUbicacionesTecnicosMock.mockResolvedValue([EN_LA_CALLE, YA_SALIO])
  })

  it('pide las ubicaciones del día, no solo las de quien sigue en jornada', async () => {
    await montarPanel()

    await waitFor(() => expect(getUbicacionesTecnicosMock).toHaveBeenCalled())
    expect(getUbicacionesTecnicosMock).toHaveBeenCalledWith({ alcance: 'dia' })
  })

  it('pinta un marcador por técnico con coordenadas', async () => {
    await montarPanel()

    const marcadores = await screen.findAllByTestId('marker')
    expect(marcadores).toHaveLength(2)
    expect(marcadores.map((m) => m.dataset.pos)).toEqual([
      '14.6349,-90.5069',
      '14.7,-90.44',
    ])
  })

  it('distingue a quien no tiene jornada abierta', async () => {
    await montarPanel()

    expect(await screen.findByText('Fuera de jornada')).toBeInTheDocument()
    expect(screen.getByText('En tarea')).toBeInTheDocument()
    // La leyenda cuenta los dos grupos por separado.
    expect(screen.getByText(/1 en tarea/i)).toBeInTheDocument()
    expect(screen.getByText(/1 fuera de jornada/i)).toBeInTheDocument()
  })

  it('cuenta en la cabecera solo a los que siguen en la calle', async () => {
    await montarPanel()

    const cabecera = await screen.findByText('Dónde está el equipo')
    expect(cabecera.parentElement.textContent).toMatch(/1 en la calle/)
  })

  it('ya no muestra "Tareas recientes"', async () => {
    await montarPanel()

    await screen.findByText('Dónde está el equipo')
    expect(screen.queryByText('Tareas recientes')).not.toBeInTheDocument()
  })

  it('sin reportes de hoy lo dice en vez de dejar el mapa vacío', async () => {
    getUbicacionesTecnicosMock.mockResolvedValue([])

    await montarPanel()

    expect(
      await screen.findByText(/Nadie ha reportado su ubicación hoy/i)
    ).toBeInTheDocument()
    expect(screen.queryByTestId('mapa')).not.toBeInTheDocument()
  })

  it('si falla la llamada del mapa, el panel entra igual', async () => {
    getUbicacionesTecnicosMock.mockRejectedValue(new Error('500'))

    await montarPanel()

    expect(await screen.findByText('Panel de control')).toBeInTheDocument()
    expect(screen.getByText('Técnicos hoy')).toBeInTheDocument()
    expect(
      screen.getByText(/No se pudieron cargar las ubicaciones/i)
    ).toBeInTheDocument()
  })

  it('un punto sin coordenadas no se pinta ni se cuenta', async () => {
    getUbicacionesTecnicosMock.mockResolvedValue([
      EN_LA_CALLE,
      { ...YA_SALIO, lat: null, lng: null },
    ])

    await montarPanel()

    const marcadores = await screen.findAllByTestId('marker')
    expect(marcadores).toHaveLength(1)
    expect(screen.queryByText(/fuera de jornada/i)).not.toBeInTheDocument()
  })
})
