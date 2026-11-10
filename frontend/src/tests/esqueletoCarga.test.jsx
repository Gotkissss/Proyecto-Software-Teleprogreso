/**
 * tests/esqueletoCarga.test.jsx
 * ---------------------------------------------------------------------------
 * El dibujo gris que ocupa el lugar de la pantalla mientras llegan sus datos.
 *
 * Lo que se fija aquí:
 *   - El esqueleto es opcional: sin `skeleton` sigue saliendo el spinner de
 *     siempre, que es lo que usan las secciones pequeñas dentro de una página
 *     ya montada.
 *   - Cada pantalla pide su forma y esa forma llega hasta el DOM. Si el panel
 *     dibujara la forma de una tabla, la pantalla "saltaría" igual que antes.
 *   - Una variante mal escrita no deja la pantalla en blanco.
 *   - Mientras carga se anuncia como ocupado y se dice de qué pantalla se
 *     trata: un lector de pantalla no puede leer en voz alta cajas vacías.
 *   - En una pantalla de verdad (el panel), el esqueleto está mientras no hay
 *     datos y desaparece en cuanto llegan.
 *
 * Se ejecutan con: npx vitest run src/tests/esqueletoCarga.test.jsx
 * ---------------------------------------------------------------------------
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import PageState from '../components/ui/PageState'
import Skeleton, { VARIANTES_SKELETON } from '../components/ui/Skeleton'
import { ToastProvider } from '../components/ui/Toast'

/* ── Mocks del panel ───────────────────────────────────────────────────── */

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }) => <div data-testid="mapa">{children}</div>,
  TileLayer: () => null,
  Marker: ({ children }) => <div data-testid="marker">{children}</div>,
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

vi.mock('../api/ubicacionService', () => ({
  getUbicacionesTecnicos: vi.fn(async () => []),
}))

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }))

vi.mock('../api/client', () => ({
  urlArchivo: (ruta) => ruta,
  BASE_URL: 'http://backend.test',
  default: { get: getMock },
}))

const METRICAS = {
  tecnicos_en_jornada: 2,
  tecnicos_total: 4,
  tareas_completadas_hoy: 1,
  tareas_pendientes: 2,
  tareas_en_progreso: 1,
  tareas_retrasadas: 0,
  tareas_activas: 3,
}

/** Una petición que se queda colgada hasta que la prueba decida soltarla. */
function peticionEnEspera() {
  let soltar
  const espera = new Promise((resolve) => {
    soltar = resolve
  })
  return { espera, soltar: () => soltar() }
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

/* ── El componente ─────────────────────────────────────────────────────── */

describe('Skeleton', () => {
  it('dibuja la variante que le piden', () => {
    const { container } = render(<Skeleton variant="table" />)
    expect(container.querySelector('[data-skeleton="table"]')).toBeTruthy()
  })

  it('todas las variantes declaradas se dibujan', () => {
    expect(VARIANTES_SKELETON.length).toBeGreaterThan(0)

    for (const variante of VARIANTES_SKELETON) {
      const { container, unmount } = render(<Skeleton variant={variante} />)
      expect(container.querySelector(`[data-skeleton="${variante}"]`)).toBeTruthy()
      // Lo que se ve son bloques grises: si no hubiera ninguno, el esqueleto
      // sería un hueco en blanco y la pantalla parecería rota.
      expect(container.querySelectorAll('span[style]').length).toBeGreaterThan(3)
      unmount()
    }
  })

  it('una variante que no existe cae en la lista en vez de quedar en blanco', () => {
    const { container } = render(<Skeleton variant="pantalla-inventada" />)
    expect(container.querySelector('[data-skeleton="list"]')).toBeTruthy()
  })

  it('se anuncia como ocupado y dice qué está cargando', () => {
    render(<Skeleton variant="list" label="Cargando el historial..." />)

    const estado = screen.getByRole('status')
    expect(estado).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('Cargando el historial...')).toBeInTheDocument()
  })
})

/* ── Cómo lo usa PageState ─────────────────────────────────────────────── */

describe('PageState con esqueleto', () => {
  it('sin la prop sigue mostrando el spinner', () => {
    const { container } = render(
      <PageState loading loadingLabel="Cargando evidencias..." />,
    )
    expect(container.querySelector('[data-skeleton]')).toBeNull()
    expect(screen.getByText('Cargando evidencias...')).toBeInTheDocument()
  })

  it('con la prop muestra el esqueleto y ya no el spinner', () => {
    const { container } = render(
      <PageState loading skeleton="dashboard" loadingLabel="Cargando el panel..." />,
    )
    expect(container.querySelector('[data-skeleton="dashboard"]')).toBeTruthy()
    expect(screen.getByText('Cargando el panel...')).toBeInTheDocument()
  })

  it('el esqueleto es solo para la carga: el error se sigue viendo igual', () => {
    const { container } = render(
      <PageState error="se cayó" errorTitle="No se pudo cargar el panel" skeleton="dashboard" />,
    )
    expect(container.querySelector('[data-skeleton]')).toBeNull()
    expect(screen.getByText('No se pudo cargar el panel')).toBeInTheDocument()
  })
})

/* ── En una pantalla de verdad ─────────────────────────────────────────── */

describe('El panel mientras carga', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('dibuja el esqueleto del panel y lo cambia por el panel cuando llegan los datos', async () => {
    const pendiente = peticionEnEspera()
    getMock.mockImplementation(async (url) => {
      await pendiente.espera
      if (url.startsWith('/metricas/supervisor')) return { data: METRICAS }
      if (url.startsWith('/empleados/tecnicos/disponibles')) return { data: [] }
      return { data: {} }
    })

    const { container } = await montarPanel()

    // Mientras la petición no contesta, lo que se ve es la forma del panel.
    await waitFor(() =>
      expect(container.querySelector('[data-skeleton="dashboard"]')).toBeTruthy(),
    )
    expect(screen.queryByText('Panel de control')).not.toBeInTheDocument()

    pendiente.soltar()

    expect(await screen.findByText('Panel de control')).toBeInTheDocument()
    expect(container.querySelector('[data-skeleton]')).toBeNull()
  })
})
