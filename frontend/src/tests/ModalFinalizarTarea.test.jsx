/**
 * tests/ModalFinalizarTarea.test.jsx
 * ---------------------------------------------------------------------------
 * SCRUM-139 / SCRUM-140
 *
 * Cubre las validaciones del modal con el que el técnico cierra una tarea:
 * descripción obligatoria, foto obligatoria, formato y tamaño máximo, y que
 * la tarea NO se marque como finalizada si la subida falla.
 * ---------------------------------------------------------------------------
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastProvider } from '../components/ui/Toast'
import ModalFinalizarTarea from '../components/tareas/ModalFinalizarTarea'
import {
  MAX_FOTO_MB,
  finalizarTareaConEvidencia,
  validarFoto,
} from '../api/incidenciaService'

vi.mock('../api/incidenciaService', async (importOriginal) => {
  // Se conserva la validación real (es lógica pura que también queremos probar)
  // y solo se mockea la llamada al backend.
  const original = await importOriginal()
  return { ...original, finalizarTareaConEvidencia: vi.fn() }
})

const SERVICIO = { id_servicio: 7, nombre: 'Instalación fibra óptica' }

function archivo(nombre, bytes, tipo = 'image/jpeg') {
  return new File([new Uint8Array(bytes)], nombre, { type: tipo })
}

function renderizar(props = {}) {
  return render(
    <ToastProvider>
      <ModalFinalizarTarea
        open
        servicio={SERVICIO}
        onClose={() => {}}
        onFinalizada={() => {}}
        {...props}
      />
    </ToastProvider>,
  )
}

/* ── validarFoto (lógica pura) ───────────────────────────────────────────── */

describe('validarFoto', () => {
  it('exige que haya una foto', () => {
    expect(validarFoto(null)).toMatch(/Adjunta una foto/i)
  })

  it('rechaza extensiones no permitidas', () => {
    expect(validarFoto(archivo('virus.exe', 10))).toMatch(/Formato no permitido/i)
  })

  it('rechaza archivos vacíos', () => {
    expect(validarFoto(archivo('foto.jpg', 0))).toMatch(/vacío/i)
  })

  it(`rechaza archivos de más de ${MAX_FOTO_MB} MB`, () => {
    const grande = archivo('grande.jpg', MAX_FOTO_MB * 1024 * 1024 + 1)
    expect(validarFoto(grande)).toMatch(/MB/)
  })

  it('acepta una foto válida', () => {
    expect(validarFoto(archivo('evidencia.png', 2048, 'image/png'))).toBeNull()
  })
})

/* ── Modal ───────────────────────────────────────────────────────────────── */

describe('ModalFinalizarTarea', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('muestra el nombre de la tarea que se va a cerrar', () => {
    renderizar()
    expect(screen.getByText('Instalación fibra óptica')).toBeInTheDocument()
  })

  it('no envía nada si falta la descripción y la foto', async () => {
    renderizar()
    await userEvent.click(screen.getByRole('button', { name: /Finalizar tarea/i }))

    expect(finalizarTareaConEvidencia).not.toHaveBeenCalled()
    expect(await screen.findByText(/Describe brevemente/i)).toBeInTheDocument()
    expect(await screen.findByText(/Adjunta una foto/i)).toBeInTheDocument()
  })

  it('no envía si hay descripción pero falta la foto', async () => {
    renderizar()
    await userEvent.type(
      screen.getByLabelText(/¿Qué realizaste\?/i),
      'Se instaló la acometida y se probó la señal.',
    )
    await userEvent.click(screen.getByRole('button', { name: /Finalizar tarea/i }))

    expect(finalizarTareaConEvidencia).not.toHaveBeenCalled()
    expect(await screen.findByText(/Adjunta una foto/i)).toBeInTheDocument()
  })

  it('rechaza una foto con extensión inválida al seleccionarla', async () => {
    const { container } = renderizar()
    const input = container.querySelector('input[type="file"]')

    await userEvent.upload(input, archivo('documento.pdf', 100, 'application/pdf'))

    expect(await screen.findByText(/Formato no permitido/i)).toBeInTheDocument()
  })

  it('envía descripción y foto cuando todo es válido', async () => {
    finalizarTareaConEvidencia.mockResolvedValue({
      id_incidencia: 1,
      foto_evidencia: '/static/incidencias/x.jpg',
    })
    const onFinalizada = vi.fn()
    const { container } = renderizar({ onFinalizada })

    await userEvent.type(
      screen.getByLabelText(/¿Qué realizaste\?/i),
      'Se instaló la acometida y se configuró la ONT.',
    )
    await userEvent.upload(
      container.querySelector('input[type="file"]'),
      archivo('evidencia.jpg', 4096),
    )
    await userEvent.click(screen.getByRole('button', { name: /Finalizar tarea/i }))

    await waitFor(() => {
      expect(finalizarTareaConEvidencia).toHaveBeenCalledWith(7, {
        descripcion: 'Se instaló la acometida y se configuró la ONT.',
        foto: expect.any(File),
      })
    })
    await waitFor(() => expect(onFinalizada).toHaveBeenCalled())
  })

  it('si la subida falla, la tarea NO se marca como finalizada', async () => {
    finalizarTareaConEvidencia.mockRejectedValue({
      response: { status: 400, data: { detail: 'El archivo supera el límite de 5 MB.' } },
    })
    const onFinalizada = vi.fn()
    const { container } = renderizar({ onFinalizada })

    await userEvent.type(
      screen.getByLabelText(/¿Qué realizaste\?/i),
      'Trabajo terminado sin novedades.',
    )
    await userEvent.upload(
      container.querySelector('input[type="file"]'),
      archivo('evidencia.jpg', 4096),
    )
    await userEvent.click(screen.getByRole('button', { name: /Finalizar tarea/i }))

    expect(
      await screen.findByText('El archivo supera el límite de 5 MB.'),
    ).toBeInTheDocument()
    expect(onFinalizada).not.toHaveBeenCalled()
  })

  it('avisa sin cerrar la tarea cuando no hay conexión', async () => {
    finalizarTareaConEvidencia.mockRejectedValue(new Error('Network Error'))
    const onFinalizada = vi.fn()
    const { container } = renderizar({ onFinalizada })

    await userEvent.type(
      screen.getByLabelText(/¿Qué realizaste\?/i),
      'Trabajo terminado sin novedades.',
    )
    await userEvent.upload(
      container.querySelector('input[type="file"]'),
      archivo('evidencia.jpg', 4096),
    )
    await userEvent.click(screen.getByRole('button', { name: /Finalizar tarea/i }))

    expect(await screen.findByText(/La tarea sigue abierta/i)).toBeInTheDocument()
    expect(onFinalizada).not.toHaveBeenCalled()
  })
})
