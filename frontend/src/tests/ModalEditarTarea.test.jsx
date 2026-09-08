/**
 * tests/ModalEditarTarea.test.jsx
 * ---------------------------------------------------------------------------
 * Fija el reparto de responsabilidades entre "Editar" y "Reasignar".
 *
 * Editar tenía su propio selector de técnico, que hacía lo mismo que
 * Reasignar pero sin el mapa del servicio, sin decir quién la lleva ahora y
 * sin avisar cuando ya no queda nadie a quien pasársela. Estos tests impiden
 * que ese segundo camino vuelva a aparecer sin que nadie lo note.
 * ---------------------------------------------------------------------------
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { actualizarTareaMock } = vi.hoisted(() => ({
  actualizarTareaMock: vi.fn(),
}))

vi.mock('../api/tareaService', () => ({
  actualizarTarea: actualizarTareaMock,
  LIMITE_TAREAS_FALLBACK: 5,
}))

import ModalEditarTarea from '../components/tareas/ModalEditarTarea'

const TAREA = {
  id_tarea: 1,
  titulo: 'Instalación fibra óptica',
  descripcion: 'Acometida y ONT',
  direccion_servicio: 'Calle 15, Fraijanes',
  prioridad: 'alta',
  estado_tarea: 'pendiente',
  fecha_inicio: '2026-09-01',
  fecha_finalizacion: '2026-09-05',
  tecnico: { id_empleado: 2, nombre: 'Juan Pérez' },
}

function montar(props = {}) {
  return render(
    <ModalEditarTarea
      open
      tarea={TAREA}
      onClose={vi.fn()}
      onGuardado={vi.fn()}
      {...props}
    />,
  )
}

describe('ModalEditarTarea', () => {
  beforeEach(() => {
    actualizarTareaMock.mockReset()
    actualizarTareaMock.mockResolvedValue({ ...TAREA, titulo: 'Otro título' })
  })

  it('muestra al técnico asignado, pero sin selector para cambiarlo', () => {
    montar()

    expect(screen.getByText('Juan Pérez')).toBeInTheDocument()
    expect(screen.queryByLabelText(/Técnico asignado/i)).not.toBeInTheDocument()
  })

  it('dice "Sin asignar" cuando la tarea no tiene técnico', () => {
    montar({ tarea: { ...TAREA, tecnico: null } })

    expect(screen.getByText('Sin asignar')).toBeInTheDocument()
  })

  it('el botón manda al flujo de reasignación con la tarea abierta', async () => {
    const onReasignar = vi.fn()
    const user = userEvent.setup()
    montar({ onReasignar })

    await user.click(screen.getByRole('button', { name: /reasignar/i }))

    expect(onReasignar).toHaveBeenCalledWith(TAREA)
  })

  it('sin onReasignar no ofrece el botón', () => {
    montar({ onReasignar: undefined })

    expect(screen.queryByRole('button', { name: /reasignar/i })).not.toBeInTheDocument()
  })

  it('al guardar no envía el técnico, solo lo que se editó', async () => {
    const user = userEvent.setup()
    montar()

    const titulo = screen.getByLabelText(/Título/i)
    await user.clear(titulo)
    await user.type(titulo, 'Revisión de acometida')
    await user.click(screen.getByRole('button', { name: /guardar cambios/i }))

    await waitFor(() => expect(actualizarTareaMock).toHaveBeenCalled())

    const [, cambios] = actualizarTareaMock.mock.calls[0]
    expect(cambios).toEqual({ titulo: 'Revisión de acometida' })
    expect(cambios).not.toHaveProperty('id_tecnico')
  })

  it('sigue validando el título antes de llamar al backend', async () => {
    const user = userEvent.setup()
    montar()

    const titulo = screen.getByLabelText(/Título/i)
    await user.clear(titulo)
    await user.type(titulo, 'abc')
    await user.click(screen.getByRole('button', { name: /guardar cambios/i }))

    expect(await screen.findByText(/al menos 5 caracteres/i)).toBeInTheDocument()
    expect(actualizarTareaMock).not.toHaveBeenCalled()
  })
})
