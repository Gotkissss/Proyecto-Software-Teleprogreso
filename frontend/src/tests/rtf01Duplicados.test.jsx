/**
 * tests/rtf01Duplicados.test.jsx
 * ---------------------------------------------------------------------------
 * RTF-01 / R1-5 — empleados duplicados y correos personales.
 *
 * El informe: «Hay registros duplicados ("Luis Fonzi" como técnico y como
 * supervisor) y correos personales @gmail.com junto a los corporativos.»
 *
 * El backend es quien decide las dos reglas. Lo que se prueba aquí es la
 * pantalla: que el choque de nombres no se lea como un error del correo —antes
 * CUALQUIER 409 se mostraba como «este correo ya está registrado»— y que el
 * admin tenga una salida cuando de verdad son dos personas.
 * ---------------------------------------------------------------------------
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { postMock, patchMock } = vi.hoisted(() => ({
  postMock: vi.fn(),
  patchMock: vi.fn(),
}))

vi.mock('../api/client', () => ({
  default: { post: postMock, patch: patchMock, get: vi.fn() },
}))

import ModalCrearEmpleado from '../components/empleados/ModalCrearEmpleado'
import ModalEditarEmpleado from '../components/empleados/ModalEditarEmpleado'

const CLAVE = 'Tele.2026!clave'

const CONFLICTO_DUPLICADO = {
  response: {
    status: 409,
    data: {
      error: 'EMPLEADO_DUPLICADO',
      detail:
        "Ya hay un empleado llamado 'Luis Fonzi' (#7, supervisor, activo). " +
        'Si es la misma persona, edita ese registro en vez de crear otro.',
    },
  },
}

const CONFLICTO_CORREO = {
  response: {
    status: 409,
    data: { error: 'CONFLICT', detail: "El correo ya está en uso." },
  },
}

/**
 * Llena el formulario de alta.
 *
 * Se busca por placeholder y por tipo porque las etiquetas del formulario no
 * están asociadas a sus campos con `for`; cambiarlo es otra tarea.
 */
async function llenarAlta() {
  await userEvent.type(screen.getByPlaceholderText('Ej: Juan'), 'Luis')
  await userEvent.type(screen.getByPlaceholderText('Ej: Pérez García'), 'Fonzi')
  await userEvent.type(
    screen.getByPlaceholderText('usuario@teleprogreso.com'),
    'luis.fonzi2@teleprogreso.com'
  )
  await userEvent.type(screen.getByPlaceholderText(/Mínimo 8 caracteres/), CLAVE)
  await userEvent.type(screen.getByPlaceholderText(/Repite la contraseña/), CLAVE)
  const fecha = document.querySelector('input[type="date"]')
  await userEvent.type(fecha, '2024-01-15')
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ModalCrearEmpleado — nombre ya registrado', () => {
  it('el choque de nombres no se muestra como un error del correo', async () => {
    postMock.mockRejectedValue(CONFLICTO_DUPLICADO)

    render(<ModalCrearEmpleado onCreado={vi.fn()} onCerrar={vi.fn()} />)
    await llenarAlta()
    await userEvent.click(screen.getByRole('button', { name: /Crear empleado/ }))

    // El mensaje del backend, que dice con quién choca.
    expect(await screen.findByText(/Luis Fonzi.*#7.*supervisor/s)).toBeInTheDocument()
    expect(screen.queryByText(/Este correo ya está registrado/)).not.toBeInTheDocument()
  })

  it('se puede repetir el alta declarando que es un homónimo', async () => {
    postMock.mockRejectedValueOnce(CONFLICTO_DUPLICADO)
    postMock.mockResolvedValueOnce({ data: { id_empleado: 12 } })
    const onCreado = vi.fn()

    render(<ModalCrearEmpleado onCreado={onCreado} onCerrar={vi.fn()} />)
    await llenarAlta()
    await userEvent.click(screen.getByRole('button', { name: /Crear empleado/ }))
    await userEvent.click(
      await screen.findByRole('button', { name: /Son dos personas distintas/ })
    )

    await waitFor(() => expect(onCreado).toHaveBeenCalled())
    // El primer intento va sin permiso; el segundo con él.
    expect(postMock.mock.calls[0][1].permitir_homonimo).toBe(false)
    expect(postMock.mock.calls[1][1].permitir_homonimo).toBe(true)
  })

  it('el 409 del correo repetido sigue señalando el campo del correo', async () => {
    // La regla de antes no se pierde por haber añadido la nueva.
    postMock.mockRejectedValue(CONFLICTO_CORREO)

    render(<ModalCrearEmpleado onCreado={vi.fn()} onCerrar={vi.fn()} />)
    await llenarAlta()
    await userEvent.click(screen.getByRole('button', { name: /Crear empleado/ }))

    expect(
      await screen.findByText(/Este correo ya está registrado/)
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Son dos personas distintas/ })
    ).not.toBeInTheDocument()
  })

  it('el correo personal lo rechaza el backend y se señala en su campo', async () => {
    // El dominio lo decide el backend —se configura por despliegue—, así que
    // la pantalla no repite la regla: muestra su 422 junto al campo.
    postMock.mockRejectedValue({
      response: {
        status: 422,
        data: {
          detail: [
            {
              loc: ['body', 'correo'],
              msg: 'El correo de un empleado tiene que ser de la empresa (@teleprogreso.com).',
            },
          ],
        },
      },
    })

    render(<ModalCrearEmpleado onCreado={vi.fn()} onCerrar={vi.fn()} />)
    await llenarAlta()
    await userEvent.click(screen.getByRole('button', { name: /Crear empleado/ }))

    expect(
      await screen.findByText(/tiene que ser de la empresa/)
    ).toBeInTheDocument()
  })
})

describe('ModalEditarEmpleado — renombrar hacia un nombre que ya existe', () => {
  const empleado = {
    id_empleado: 3,
    nombre: 'Luis',
    apellido: 'Fonseca',
    correo: 'luis.fonseca@teleprogreso.com',
    telefono: '1234-5678',
    rol: 'tecnico',
  }

  it('con el código del duplicado ofrece guardarlo como homónimo', async () => {
    const onGuardar = vi.fn()

    render(
      <ModalEditarEmpleado
        empleado={empleado}
        onGuardar={onGuardar}
        onCerrar={vi.fn()}
        cargando={false}
        errorMsg="Ya hay un empleado llamado 'Luis Fonzi' (#7, supervisor, activo)."
        errorCodigo="EMPLEADO_DUPLICADO"
      />
    )

    const apellido = screen.getByPlaceholderText('Ej: Pérez García')
    await userEvent.clear(apellido)
    await userEvent.type(apellido, 'Fonzi')
    await userEvent.click(
      screen.getByRole('button', { name: /Son dos personas distintas/ })
    )

    expect(onGuardar).toHaveBeenCalledWith(3, {
      apellido: 'Fonzi',
      permitir_homonimo: true,
    })
  })

  it('sin ese código no ofrece nada: el error es otro', async () => {
    render(
      <ModalEditarEmpleado
        empleado={empleado}
        onGuardar={vi.fn()}
        onCerrar={vi.fn()}
        cargando={false}
        errorMsg="El correo ya está en uso por otro empleado."
        errorCodigo="CONFLICT"
      />
    )

    expect(screen.getByText(/El correo ya está en uso/)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Son dos personas distintas/ })
    ).not.toBeInTheDocument()
  })

  it('guardar normal manda solo lo que cambió, sin el permiso', async () => {
    const onGuardar = vi.fn()

    render(
      <ModalEditarEmpleado
        empleado={empleado}
        onGuardar={onGuardar}
        onCerrar={vi.fn()}
        cargando={false}
      />
    )

    const telefono = screen.getByPlaceholderText('Ej: 5550-0001')
    await userEvent.clear(telefono)
    await userEvent.type(telefono, '8765-4321')
    await userEvent.click(screen.getByRole('button', { name: /Guardar cambios/i }))

    expect(onGuardar).toHaveBeenCalledWith(3, { telefono: '8765-4321' })
  })
})
