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
import { guardarBorrador, leerBorrador } from '../utils/borradorTarea'
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
    // Desde la HU-S9-05 el modal guarda un borrador por tarea en
    // localStorage. Sin limpiarlo, lo que escribe un test reaparece en el
    // siguiente y los dos fallan por una razón que no es la que prueban.
    localStorage.clear()
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

    // applyAccept: false simula al usuario que en el diálogo del sistema elige
    // "Todos los archivos" y se salta el filtro del atributo accept. Ese es
    // justamente el caso contra el que defiende la validación.
    await userEvent.upload(
      input,
      archivo('documento.pdf', 100, 'application/pdf'),
      { applyAccept: false },
    )

    expect(await screen.findByText(/Formato no permitido/i)).toBeInTheDocument()
  })

  it('envía descripción y foto cuando todo es válido', async () => {
    finalizarTareaConEvidencia.mockResolvedValue({
      id_incidencia: 1,
      foto_evidencia: '/archivos/incidencias/x.jpg?exp=1&firma=f',
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
        // HU-5: jsdom no tiene GPS y el modal no recibió respaldo.
        posicion: null,
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

  /* ── Borrador (HU-S9-05) ────────────────────────────────────────────── */

  it('guarda lo escrito mientras se escribe, sin esperar a enviarlo', async () => {
    const usuario = userEvent.setup()
    renderizar()

    await usuario.type(
      screen.getByLabelText(/¿Qué realizaste\?/i),
      'Se cambió el conector',
    )

    // Se guarda en cada cambio y no al cerrar: si lo que se lleva la sesión
    // por delante es la pestaña entera, no hay ningún "al cerrar" que correr.
    await waitFor(() => {
      expect(leerBorrador(SERVICIO.id_servicio)?.descripcion).toBe(
        'Se cambió el conector',
      )
    })
  })

  it('al volver a entrar reofrece lo que había escrito', async () => {
    guardarBorrador(SERVICIO.id_servicio, {
      descripcion: 'Lo que escribí antes de que se cayera la sesión',
      nombreFoto: 'evidencia.jpg',
    })

    renderizar()

    expect(screen.getByLabelText(/¿Qué realizaste\?/i)).toHaveValue(
      'Lo que escribí antes de que se cayera la sesión',
    )
    expect(screen.getByText(/Recuperamos lo que habías escrito/i)).toBeInTheDocument()
    // La foto no se puede guardar, así que se le dice cuál era para que la
    // vuelva a elegir sin dudar.
    expect(screen.getByText('evidencia.jpg')).toBeInTheDocument()
  })

  it('"empezar de cero" descarta el borrador', async () => {
    guardarBorrador(SERVICIO.id_servicio, { descripcion: 'Texto viejo' })
    const usuario = userEvent.setup()

    renderizar()
    await usuario.click(screen.getByRole('button', { name: /Empezar de cero/i }))

    expect(screen.getByLabelText(/¿Qué realizaste\?/i)).toHaveValue('')
    expect(leerBorrador(SERVICIO.id_servicio)).toBeNull()
  })

  it('el borrador de otra tarea no se cuela en esta', () => {
    guardarBorrador(999, { descripcion: 'De otra tarea' })

    renderizar()

    expect(screen.getByLabelText(/¿Qué realizaste\?/i)).toHaveValue('')
  })
})
