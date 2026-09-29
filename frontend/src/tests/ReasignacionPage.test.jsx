/**
 * tests/ReasignacionPage.test.jsx
 * ---------------------------------------------------------------------------
 * "Reasignar" es ahora el único sitio donde se cambia de técnico. Al quitarle
 * el selector a "Editar" se habría perdido lo único que aquel modal permitía
 * y este no: dejar una tarea sin nadie asignado. Estos tests fijan que esa
 * opción existe aquí y que llama al endpoint correcto.
 * ---------------------------------------------------------------------------
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const {
  getTareasMock,
  getTecnicosDisponiblesMock,
  reasignarTareaMock,
  actualizarTareaMock,
} = vi.hoisted(() => ({
  getTareasMock: vi.fn(),
  getTecnicosDisponiblesMock: vi.fn(),
  reasignarTareaMock: vi.fn(),
  actualizarTareaMock: vi.fn(),
}))

vi.mock('../api/tareaService', () => ({
  LIMITE_TAREAS_FALLBACK: 5,
  getTareas: getTareasMock,
  getTecnicosDisponibles: getTecnicosDisponiblesMock,
  reasignarTarea: reasignarTareaMock,
  actualizarTarea: actualizarTareaMock,
}))

// El mini mapa monta Leaflet, que no aporta nada a lo que se prueba aquí.
vi.mock('../components/mapa/MiniMapaTarea', () => ({
  default: () => <div>Mapa simulado</div>,
}))

import { ToastProvider } from '../components/ui/Toast'
import ReasignacionPage from '../pages/ReasignacionPage'

const TAREA = {
  id_tarea: 1,
  titulo: 'Instalación fibra óptica',
  estado_tarea: 'pendiente',
  prioridad: 'alta',
  direccion_servicio: 'Calle 15, Fraijanes',
  fecha_finalizacion: '2026-09-30',
  tecnico: { id_empleado: 2, nombre: 'Juan Pérez' },
  total_incidencias: 0,
}

const TECNICOS = [
  { id: 2, id_empleado: 2, nombre_completo: 'Juan Pérez', tareas_activas: 1, limite_tareas: 5 },
  { id: 3, id_empleado: 3, nombre_completo: 'María López', tareas_activas: 0, limite_tareas: 5 },
]

function montar() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <ReasignacionPage />
      </ToastProvider>
    </MemoryRouter>,
  )
}

/** El select del modal. La página tiene otro ("Agrupar por"), así que se
    busca por su etiqueta y no por rol. */
const selectorTecnico = () => screen.getByLabelText(/Reasignar a/i)

/** Abre el modal de reasignación de la única tarea de la lista. */
async function abrirReasignar() {
  const user = userEvent.setup()
  montar()
  await user.click(await screen.findByRole('button', { name: 'Reasignar' }))
  await screen.findByLabelText(/Reasignar a/i)
  return user
}

describe('ReasignacionPage — cambio de técnico', () => {
  beforeEach(() => {
    getTareasMock.mockReset().mockResolvedValue([TAREA])
    getTecnicosDisponiblesMock.mockReset().mockResolvedValue(TECNICOS)
    reasignarTareaMock.mockReset().mockResolvedValue({})
    actualizarTareaMock.mockReset().mockResolvedValue({})
  })

  it('el modal dice quién tiene la tarea ahora', async () => {
    await abrirReasignar()

    expect(screen.getByText(/Asignada actualmente a/i)).toHaveTextContent('Juan Pérez')
  })

  it('ofrece dejar la tarea sin asignar cuando alguien la tiene', async () => {
    await abrirReasignar()

    expect(
      within(selectorTecnico()).getByRole('option', { name: 'Dejar sin asignar' })
    ).toBeInTheDocument()
  })

  it('no ofrece esa opción si la tarea ya está sin asignar', async () => {
    getTareasMock.mockResolvedValue([{ ...TAREA, tecnico: null }])
    await abrirReasignar()

    expect(screen.queryByRole('option', { name: 'Dejar sin asignar' })).not.toBeInTheDocument()
  })

  it('al confirmar "sin asignar" manda id_tecnico null, no una reasignación', async () => {
    const user = await abrirReasignar()

    await user.selectOptions(selectorTecnico(), 'sin-asignar')
    await user.click(screen.getByRole('button', { name: /confirmar/i }))

    await waitFor(() =>
      expect(actualizarTareaMock).toHaveBeenCalledWith(1, { id_tecnico: null })
    )
    expect(reasignarTareaMock).not.toHaveBeenCalled()
    expect(await screen.findByText(/Queda sin asignar/i)).toBeInTheDocument()
  })

  it('elegir un técnico sigue usando el endpoint de reasignación', async () => {
    const user = await abrirReasignar()

    await user.selectOptions(selectorTecnico(), '3')
    await user.click(screen.getByRole('button', { name: /confirmar/i }))

    await waitFor(() => expect(reasignarTareaMock).toHaveBeenCalledWith(1, 3))
    expect(actualizarTareaMock).not.toHaveBeenCalled()
  })

  it('al mover la tarea, el técnico que la soltaba deja de contarla', async () => {
    // Dos tareas: se mueve la primera de Juan a María y se abre la segunda.
    getTareasMock.mockResolvedValue([
      TAREA,
      { ...TAREA, id_tarea: 2, titulo: 'Revisión de router', tecnico: null },
    ])
    // La segunda consulta falla, así que en pantalla queda el conteo que
    // llevaba la propia pantalla: es justo ahí donde se veía el desajuste.
    getTecnicosDisponiblesMock.mockImplementation((idTarea) =>
      idTarea === 2 ? Promise.reject(new Error('sin red')) : Promise.resolve(TECNICOS),
    )

    const user = userEvent.setup()
    montar()
    const botones = await screen.findAllByRole('button', { name: 'Reasignar' })

    await user.click(botones[0])
    await user.selectOptions(await screen.findByLabelText(/Reasignar a/i), '3')
    await user.click(screen.getByRole('button', { name: /confirmar/i }))
    await waitFor(() => expect(reasignarTareaMock).toHaveBeenCalledWith(1, 3))

    await user.click(botones[1])

    const opciones = within(await screen.findByLabelText(/Reasignar a/i))
      .getAllByRole('option')
      .map((o) => o.textContent)

    // Juan se queda sin tareas activas y María pasa a tener una.
    expect(opciones.find((t) => t.includes('Juan Pérez'))).toContain('0 tareas activas')
    expect(opciones.find((t) => t.includes('María López'))).toContain('1 tarea activa')
  })

  it('avisa cuando no hay ningún otro técnico con hueco', async () => {
    getTecnicosDisponiblesMock.mockResolvedValue([
      TECNICOS[0],
      { ...TECNICOS[1], tareas_activas: 5 },
    ])
    await abrirReasignar()

    expect(
      screen.getByText(/No hay ningún otro técnico disponible/i)
    ).toHaveTextContent(/Puedes dejarla sin asignar/i)
  })
})


/* ─── SCRUM-248 / 249: distancia y orden de la lista ──────────────────────── */

// La misma tarea, pero con la coordenada exacta que el backend necesita para
// medir. Sin ella no hay distancias que pedir.
const TAREA_UBICADA = { ...TAREA, lat: 14.4744, lng: -90.4425 }

// Lo que devuelve el endpoint con ?id_tarea: María está lejos, Ana cerca y
// Pedro no ha reportado posición reciente.
const TECNICOS_CON_DISTANCIA = [
  { id: 2, id_empleado: 2, nombre_completo: 'Juan Pérez',  tareas_activas: 1, limite_tareas: 5, distancia_m: 300, ubicacion_registrada_en: '2026-09-29T08:40:00' },
  { id: 3, id_empleado: 3, nombre_completo: 'María López', tareas_activas: 0, limite_tareas: 5, distancia_m: 5400, ubicacion_registrada_en: '2026-09-29T08:10:00' },
  { id: 4, id_empleado: 4, nombre_completo: 'Ana Gómez',   tareas_activas: 2, limite_tareas: 5, distancia_m: 1420.5, ubicacion_registrada_en: '2026-09-29T09:05:00' },
  { id: 5, id_empleado: 5, nombre_completo: 'Pedro Ruiz',  tareas_activas: 1, limite_tareas: 5, distancia_m: null, ubicacion_registrada_en: null },
]

/** Texto de cada opción del selector de técnicos, en el orden en que se ven.
    Fuera el "Selecciona un técnico" y el "Dejar sin asignar", que no son
    técnicos y no entran en el orden. */
const opcionesTecnico = () =>
  within(selectorTecnico())
    .getAllByRole('option')
    .map((opcion) => opcion.textContent)
    .filter((texto) => texto.includes(' — '))

describe('ReasignacionPage — cercanía del técnico a la tarea', () => {
  beforeEach(() => {
    getTareasMock.mockReset().mockResolvedValue([TAREA_UBICADA])
    // Sin id_tarea el endpoint no trae distancias; con id_tarea, sí.
    getTecnicosDisponiblesMock
      .mockReset()
      .mockImplementation((idTarea) =>
        Promise.resolve(idTarea ? TECNICOS_CON_DISTANCIA : TECNICOS),
      )
    reasignarTareaMock.mockReset().mockResolvedValue({})
    actualizarTareaMock.mockReset().mockResolvedValue({})
  })

  it('pide las distancias a la tarea que se está reasignando', async () => {
    await abrirReasignar()

    // La carga inicial de la pantalla va sin tarea; el modal sí la manda.
    expect(getTecnicosDisponiblesMock.mock.calls[0]).toEqual([])
    await waitFor(() => expect(getTecnicosDisponiblesMock).toHaveBeenCalledWith(1))
  })

  it('muestra a cuánto está cada técnico', async () => {
    await abrirReasignar()

    await waitFor(() =>
      expect(opcionesTecnico().join('|')).toContain('a 1.4 km'),
    )
    expect(opcionesTecnico().join('|')).toContain('a 300 m')
  })

  it('distingue al técnico sin ubicación reciente de uno que está a 0 m', async () => {
    await abrirReasignar()

    await waitFor(() =>
      expect(
        opcionesTecnico().find((texto) => texto.includes('Pedro Ruiz')),
      ).toContain('sin ubicación reciente'),
    )
  })

  it('ordena por carga de trabajo mientras no se pida otra cosa', async () => {
    await abrirReasignar()

    await waitFor(() => expect(opcionesTecnico()).toHaveLength(4))
    // 0, 1, 1 y 2 tareas activas; los empatados, por nombre.
    expect(opcionesTecnico().map((t) => t.split(' —')[0])).toEqual([
      'María López',
      'Juan Pérez',
      'Pedro Ruiz',
      'Ana Gómez',
    ])
  })

  it('al ordenar por cercanía el más cercano queda primero', async () => {
    const user = await abrirReasignar()
    await waitFor(() => expect(opcionesTecnico()).toHaveLength(4))

    await user.selectOptions(screen.getByLabelText(/Ordenar por/i), 'cercania')

    // Pedro, sin ubicación, se va al final en vez de colarse como "a 0 m".
    expect(opcionesTecnico().map((t) => t.split(' —')[0])).toEqual([
      'Juan Pérez',
      'Ana Gómez',
      'María López',
      'Pedro Ruiz',
    ])
  })

  it('dice de cuándo es la posición del técnico elegido', async () => {
    const user = await abrirReasignar()
    await waitFor(() => expect(opcionesTecnico()).toHaveLength(4))

    await user.selectOptions(selectorTecnico(), '3')

    expect(screen.getByText(/última posición reportada/i)).toHaveTextContent('08:10')
  })

  it('una tarea sin coordenadas no ofrece ordenar por cercanía', async () => {
    getTareasMock.mockResolvedValue([TAREA]) // sin lat/lng
    await abrirReasignar()

    expect(screen.getByLabelText(/Ordenar por/i)).toBeDisabled()
    expect(
      screen.getByText(/no tiene ubicación exacta registrada/i),
    ).toBeInTheDocument()
  })

  it('avisa cuando ningún técnico ha reportado ubicación', async () => {
    getTecnicosDisponiblesMock.mockImplementation((idTarea) =>
      Promise.resolve(
        idTarea
          ? TECNICOS_CON_DISTANCIA.map((t) => ({ ...t, distancia_m: null }))
          : TECNICOS,
      ),
    )
    await abrirReasignar()

    expect(
      await screen.findByText(/Ningún técnico ha reportado ubicación/i),
    ).toBeInTheDocument()
  })

  it('si falla la consulta de distancias la reasignación sigue funcionando', async () => {
    getTecnicosDisponiblesMock.mockImplementation((idTarea) =>
      idTarea ? Promise.reject(new Error('sin red')) : Promise.resolve(TECNICOS),
    )
    const user = await abrirReasignar()

    await user.selectOptions(selectorTecnico(), '3')
    await user.click(screen.getByRole('button', { name: /confirmar/i }))

    await waitFor(() => expect(reasignarTareaMock).toHaveBeenCalledWith(1, 3))
  })

  it('no arrastra las distancias de la tarea anterior al abrir otra', async () => {
    getTareasMock.mockResolvedValue([
      TAREA_UBICADA,
      { ...TAREA_UBICADA, id_tarea: 2, titulo: 'Revisión de router', tecnico: null },
    ])

    const user = userEvent.setup()
    montar()

    const botones = await screen.findAllByRole('button', { name: 'Reasignar' })
    await user.click(botones[0])
    await waitFor(() => expect(opcionesTecnico().join('|')).toContain('a 1.4 km'))
    await user.click(screen.getByRole('button', { name: /cancelar/i }))

    // La segunda tarea no responde: sus opciones no pueden heredar los metros
    // que se calcularon para la primera.
    getTecnicosDisponiblesMock.mockImplementation((idTarea) =>
      idTarea === 2 ? Promise.reject(new Error('sin red')) : Promise.resolve(TECNICOS),
    )
    await user.click(botones[1])

    await waitFor(() =>
      expect(opcionesTecnico().join('|')).not.toContain('a 1.4 km'),
    )
  })
})
