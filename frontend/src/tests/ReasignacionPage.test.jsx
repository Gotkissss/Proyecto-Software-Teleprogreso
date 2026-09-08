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
