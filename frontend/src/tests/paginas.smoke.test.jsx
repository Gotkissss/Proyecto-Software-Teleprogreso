/**
 * tests/paginas.smoke.test.jsx
 * ---------------------------------------------------------------------------
 * Smoke test de las pantallas: con los servicios mockeados y datos cargados,
 * cada página debe pintar contenido real (no quedarse en blanco).
 *
 * Es la red de seguridad contra el bug del early-return: una página podía
 * compilar, pasar el lint y aun así renderizar null. Aquí eso falla.
 * ---------------------------------------------------------------------------
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '../components/ui/Toast'

/* ── Mocks de los servicios ─────────────────────────────────────────────── */

vi.mock('../api/rutaService', () => ({
  getMiRuta: vi.fn(async () => ({
    fecha: '2026-07-28',
    tecnico: { nombre_completo: 'Juan Pérez', cargo: 'Técnico de Campo' },
    alerta: null,
    servicios: [
      {
        id_servicio: 1,
        estado: 'pendiente',
        prioridad: 'alta',
        nombre: 'Instalación fibra óptica',
        direccion: 'Calle 15, Fraijanes',
        tipo: 'Instalación',
      },
    ],
  })),
  iniciarServicio: vi.fn(async () => ({})),
  terminarServicio: vi.fn(async () => ({})),
}))

vi.mock('../api/equipoService', () => ({
  getMiEquipo: vi.fn(async () => ({
    vehiculo: {
      id_activo: 9,
      nombre_activo: 'Pick-up Toyota Hilux',
      placa: 'P-472BCR',
      marca: 'Toyota',
      modelo: 'Hilux 2021',
      estado_vehiculo: 'asignado',
    },
    herramientas: [
      { id_activo: 3, nombre_activo: 'OTDR de campo', estado: 'asignada' },
    ],
  })),
}))

vi.mock('../api/asistenciaService', () => ({
  getAsistenciaHoy: vi.fn(async () => ({
    id_asistencia: 1,
    fecha: '2026-07-28',
    hora_entrada: '08:00:00',
    hora_salida: null,
    tiempo_en_pausa_segundos: 0,
    productividad_pct: 0,
  })),
  getTiposPausa: vi.fn(async () => [
    { id: 'almuerzo', label: 'Pausa de Almuerzo', duracion_max_min: 60 },
  ]),
  registrarEntrada: vi.fn(async () => ({})),
  iniciarPausa: vi.fn(async () => ({})),
  finalizarPausa: vi.fn(async () => ({})),
  finalizarJornada: vi.fn(async () => ({})),
  getHistorialAsistencia: vi.fn(async () => ({
    total: 0, page: 1, page_size: 15, total_pages: 0,
    totales: {
      jornadas: 0, jornadas_abiertas: 0, minutos_trabajados: 0, minutos_pausa: 0,
      minutos_brutos: 0, horas_trabajadas: '00:00', horas_pausa: '00:00',
      horas_brutas: '00:00', promedio_minutos_trabajados: 0,
    },
    items: [],
  })),
  getEmpleadosParaFiltro: vi.fn(async () => []),
}))

vi.mock('../api/tareaService', () => ({
  getTareas: vi.fn(async () => [
    {
      id_tarea: 1,
      titulo: 'Instalación fibra óptica',
      estado_tarea: 'pendiente',
      prioridad: 'alta',
      tecnico: { id_empleado: 2, nombre: 'Juan Pérez' },
      total_incidencias: 0,
    },
  ]),
  getTecnicosDisponibles: vi.fn(async () => [
    { id: 2, id_empleado: 2, nombre_completo: 'Juan Pérez', tareas_activas: 1 },
  ]),
  reasignarTarea: vi.fn(async () => ({})),
  actualizarTarea: vi.fn(async () => ({})),
  crearTarea: vi.fn(async () => ({})),
  actualizarEstado: vi.fn(async () => ({})),
}))

vi.mock('../api/incidenciaService', () => ({
  getIncidencias: vi.fn(async () => []),
  crearIncidencia: vi.fn(async () => ({ id_incidencia: 1 })),
  subirFotoEvidencia: vi.fn(async () => ({ foto_evidencia: '/static/x.jpg' })),
  eliminarIncidencia: vi.fn(async () => ({})),
  finalizarTareaConEvidencia: vi.fn(async () => ({ id_incidencia: 1 })),
  validarFoto: () => null,
  EXTENSIONES_FOTO: ['.jpg', '.png'],
  ACCEPT_FOTO: '.jpg,.png',
  MAX_FOTO_MB: 5,
  MIN_DESCRIPCION: 5,
}))

vi.mock('../api/client', () => ({
  urlArchivo: (ruta) => (ruta ? `http://backend.test${ruta}` : null),
  BASE_URL: 'http://backend.test',
  default: {
    get: vi.fn(async (url) => {
      if (url.startsWith('/metricas/supervisor')) {
        return {
          data: {
            tecnicos_activos: 2,
            tareas_completadas: 1,
            tareas_pendientes: 3,
            tareas_retrasadas: 1,
          },
        }
      }
      if (url.startsWith('/empleados/tecnicos/disponibles')) {
        return {
          data: [
            {
              id_empleado: 2,
              nombre: 'Juan',
              apellido: 'Pérez',
              nombre_completo: 'Juan Pérez',
              tareas_activas: 1,
              disponible: true,
            },
          ],
        }
      }
      return { data: { total: 0, empleados: [] } }
    }),
    post: vi.fn(async () => ({ data: {} })),
    patch: vi.fn(async () => ({ data: {} })),
  },
}))

/* ── Utilidades ─────────────────────────────────────────────────────────── */

function renderizar(Pagina) {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <Pagina />
      </ToastProvider>
    </MemoryRouter>,
  )
}

/** Falla si la página termina de cargar y no pinta ningún texto. */
async function esperarContenido(container) {
  await waitFor(() => {
    const texto = container.textContent.replace(/\s+/g, ' ').trim()
    expect(texto.length).toBeGreaterThan(15)
  })
}

/* ── Tests ──────────────────────────────────────────────────────────────── */

describe('Pantallas del técnico', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('RutaDiariaPage muestra la ruta del día', async () => {
    const { default: RutaDiariaPage } = await import('../pages/RutaDiariaPage')
    const { container } = renderizar(RutaDiariaPage)
    await esperarContenido(container)
    expect(await screen.findByText('Instalación fibra óptica')).toBeInTheDocument()
  })

  it('EquipoPage muestra el vehículo asignado', async () => {
    const { default: EquipoPage } = await import('../pages/EquipoPage')
    const { container } = renderizar(EquipoPage)
    await esperarContenido(container)
    expect(await screen.findByText(/Mi vehículo/i)).toBeInTheDocument()
  })

  it('PausasPage muestra el estado de la jornada', async () => {
    const { default: PausasPage } = await import('../pages/PausasPage')
    const { container } = renderizar(PausasPage)
    await esperarContenido(container)
  })
})

describe('Pantallas del supervisor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('DashboardPage muestra el panel de control', async () => {
    const { default: DashboardPage } = await import('../pages/DashboardPage')
    const { container } = renderizar(DashboardPage)
    await esperarContenido(container)
    expect(await screen.findByText('Panel de control')).toBeInTheDocument()
  })

  it('ReasignacionPage muestra la lista de tareas', async () => {
    const { default: ReasignacionPage } = await import('../pages/ReasignacionPage')
    const { container } = renderizar(ReasignacionPage)
    await esperarContenido(container)
    expect(await screen.findByText(/Reasignación de servicios/i)).toBeInTheDocument()
  })

  it('HistorialAsistenciaPage muestra los filtros aunque no haya jornadas', async () => {
    const { default: Historial } = await import('../pages/HistorialAsistenciaPage')
    const { container } = renderizar(Historial)
    await esperarContenido(container)
    expect(await screen.findByText(/Historial de asistencia/i)).toBeInTheDocument()
  })
})
