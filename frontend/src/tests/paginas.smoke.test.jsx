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

// Las páginas leen el usuario del contexto de auth. Se mockea en vez de montar
// el AuthProvider real para no depender de localStorage ni de /auth/me.
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id_empleado: 2, nombre: 'Juan Pérez', rol: 'tecnico' },
    isLoading: false,
    isAuthenticated: true,
    loginUser: vi.fn(),
    logoutUser: vi.fn(),
  }),
  AuthProvider: ({ children }) => children,
}))

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
        fecha_completado: null,
      },
    ],
  })),
  iniciarServicio: vi.fn(async () => ({})),
  finalizarServicio: vi.fn(async () => ({})),
  getTareasCompletadas: vi.fn(async () => ({
    total: 1,
    desde: '2026-07-22',
    hasta: '2026-07-28',
    dias: [
      {
        fecha: '2026-07-28',
        total: 1,
        tareas: [
          {
            id_tarea: 1,
            titulo: 'Instalación fibra óptica',
            estado_tarea: 'completado',
            prioridad: 'alta',
            direccion_servicio: 'Calle 15, Fraijanes',
            fecha_completado: '2026-07-28T15:04:00',
            tecnico: { id_empleado: 2, nombre: 'Juan Pérez' },
            total_incidencias: 1,
            evidencias: [
              {
                id_incidencia: 1,
                descripcion: 'Se instaló la acometida y se configuró la ONT.',
                foto_evidencia: '/static/incidencias/x.jpg',
                fecha_reporte: '2026-07-28T15:03:00',
              },
            ],
          },
        ],
      },
    ],
  })),
  esTareaDeHoy: () => true,
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
  // Estado de pausas reconstruido desde el backend (GET /descanso/hoy).
  getEstadoPausas: vi.fn(async () => ({
    fecha: '2026-07-28',
    id_asistencia: 1,
    jornada_activa: true,
    hora_entrada: '08:00:00',
    hora_salida: null,
    segundos_brutos: 7200,
    segundos_trabajados: 6600,
    segundos_en_pausa: 600,
    pausa_activa: null,
    tipos_usados: ['personal'],
    descansos: [
      {
        id_descanso: 1,
        tipo: 'personal',
        label: 'Pausa Personal',
        hora_inicio: '09:00:00',
        hora_fin: '09:10:00',
        duracion_segundos: 600,
        duracion_max_seg: 600,
        segundos_restantes: 0,
        excedida: false,
        en_curso: false,
      },
    ],
  })),
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
  LIMITE_TAREAS_FALLBACK: 5,
}))

vi.mock('../api/incidenciaService', () => ({
  getIncidencias: vi.fn(async () => []),
  crearIncidencia: vi.fn(async () => ({ id_incidencia: 1 })),
  subirFotoEvidencia: vi.fn(async () => ({ foto_evidencia: '/static/x.jpg' })),
  eliminarIncidencia: vi.fn(async () => ({})),
  finalizarTarea: vi.fn(async () => ({ id_tarea: 1, estado_tarea: 'completado' })),
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

  it('PausasPage reconstruye la pausa ya registrada en el servidor', async () => {
    // El historial no vive en useState: si el backend reporta una pausa, la
    // pantalla debe pintarla aunque sea el primer render tras un reinicio.
    const { default: PausasPage } = await import('../pages/PausasPage')
    renderizar(PausasPage)
    expect(await screen.findByText('Pausa Personal')).toBeInTheDocument()
  })

  it('HistorialTareasPage lista lo completado por día', async () => {
    const { default: HistorialTareasPage } = await import('../pages/HistorialTareasPage')
    const { container } = renderizar(HistorialTareasPage)
    await esperarContenido(container)
    expect(await screen.findByText('Tareas realizadas')).toBeInTheDocument()
    expect(
      await screen.findByText(/Se instaló la acometida/i)
    ).toBeInTheDocument()
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

  it('HistorialAsistenciaTable muestra los filtros aunque no haya jornadas', async () => {
    // Ya no hay pantalla suelta de asistencia: la tabla se monta como tab
    // dentro de EmpleadosPage, así que el smoke test va contra el componente.
    const { default: Historial } = await import(
      '../components/asistencia/HistorialAsistenciaTable'
    )
    const { container } = renderizar(Historial)
    await esperarContenido(container)
    expect(await screen.findByText(/Historial de asistencia/i)).toBeInTheDocument()
  })
})
