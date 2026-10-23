/**
 * tests/ModalEvidencias.test.jsx
 * ---------------------------------------------------------------------------
 * SCRUM-141 / SCRUM-142
 *
 * Vista del supervisor: listado de evidencias, foto enlazada al backend,
 * estado vacío y permiso de borrado.
 * ---------------------------------------------------------------------------
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastProvider } from '../components/ui/Toast'
import ModalEvidencias from '../components/tareas/ModalEvidencias'
import { eliminarIncidencia, getIncidencias } from '../api/incidenciaService'

vi.mock('../api/incidenciaService', () => ({
  getIncidencias: vi.fn(),
  eliminarIncidencia: vi.fn(),
}))

vi.mock('../api/client', () => ({
  default: {},
  BASE_URL: 'http://backend.test',
  urlArchivo: (ruta) => (ruta ? `http://backend.test${ruta}` : null),
}))

const TAREA = { id_tarea: 7, titulo: 'Ampliación de red' }

// Enlace firmado tal como lo entrega la API (HU-S10-02).
const FOTO_FIRMADA =
  '/archivos/incidencias/incidencia_2_ab12.jpg?exp=1790000600&firma=' + 'a'.repeat(64)

const EVIDENCIAS = [
  {
    id_incidencia: 2,
    id_tarea: 7,
    descripcion: 'Se certificaron los 5 puntos de red.',
    foto_evidencia: FOTO_FIRMADA,
    fecha_reporte: '2026-07-27T16:30:00',
  },
  {
    id_incidencia: 1,
    id_tarea: 7,
    descripcion: 'Primera visita: falta material.',
    foto_evidencia: null,
    fecha_reporte: '2026-07-26T09:15:00',
  },
]

function renderizar(props = {}) {
  return render(
    <ToastProvider>
      <ModalEvidencias open tarea={TAREA} onClose={() => {}} {...props} />
    </ToastProvider>,
  )
}

describe('ModalEvidencias', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lista las evidencias de la tarea', async () => {
    getIncidencias.mockResolvedValue(EVIDENCIAS)
    renderizar()

    expect(await screen.findByText('Se certificaron los 5 puntos de red.')).toBeInTheDocument()
    expect(screen.getByText('Primera visita: falta material.')).toBeInTheDocument()
    expect(getIncidencias).toHaveBeenCalledWith(7)
  })

  it('pinta la foto con el enlace firmado de la API, antepuesto con BASE_URL', async () => {
    getIncidencias.mockResolvedValue(EVIDENCIAS)
    renderizar()

    const img = await screen.findByAltText('Evidencia de la tarea')
    expect(img).toHaveAttribute('src', `http://backend.test${FOTO_FIRMADA}`)
    expect(img.closest('a')).toHaveAttribute('href', `http://backend.test${FOTO_FIRMADA}`)
  })

  it('si el enlace venció, pide las evidencias de nuevo sin volver al spinner', async () => {
    getIncidencias.mockResolvedValue(EVIDENCIAS)
    renderizar()

    const img = await screen.findByAltText('Evidencia de la tarea')
    fireEvent.error(img)

    await waitFor(() => expect(getIncidencias).toHaveBeenCalledTimes(2))
    expect(screen.queryByText(/Cargando evidencias/i)).not.toBeInTheDocument()
    expect(screen.getByAltText('Evidencia de la tarea')).toBeInTheDocument()
  })

  it('si la recarga de enlaces falla, la foto queda como no disponible', async () => {
    getIncidencias.mockResolvedValueOnce(EVIDENCIAS)
    getIncidencias.mockRejectedValueOnce(new Error('sin red'))
    renderizar()

    fireEvent.error(await screen.findByAltText('Evidencia de la tarea'))

    expect(await screen.findByText(/No se pudo cargar la foto/i)).toBeInTheDocument()
    expect(screen.queryByAltText('Evidencia de la tarea')).not.toBeInTheDocument()
    expect(getIncidencias).toHaveBeenCalledTimes(2)
  })

  it('indica cuando una evidencia no trae foto', async () => {
    getIncidencias.mockResolvedValue([EVIDENCIAS[1]])
    renderizar()
    expect(await screen.findByText(/Sin foto adjunta/i)).toBeInTheDocument()
  })

  it('muestra el estado vacío si la tarea no tiene evidencias', async () => {
    getIncidencias.mockResolvedValue([])
    renderizar()
    expect(await screen.findByText(/Sin evidencias registradas/i)).toBeInTheDocument()
  })

  it('muestra el error del backend y permite reintentar', async () => {
    getIncidencias.mockRejectedValueOnce({
      response: { data: { detail: 'No tienes permiso sobre esta tarea.' } },
    })
    renderizar()

    expect(await screen.findByText('No tienes permiso sobre esta tarea.')).toBeInTheDocument()

    getIncidencias.mockResolvedValueOnce(EVIDENCIAS)
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('Se certificaron los 5 puntos de red.')).toBeInTheDocument()
  })

  it('sin permiso de borrado no muestra el botón Eliminar', async () => {
    getIncidencias.mockResolvedValue(EVIDENCIAS)
    renderizar({ puedeEliminar: false })

    await screen.findByText('Se certificaron los 5 puntos de red.')
    expect(screen.queryByRole('button', { name: /Eliminar/i })).not.toBeInTheDocument()
  })

  it('con permiso, elimina la evidencia y la quita de la lista', async () => {
    getIncidencias.mockResolvedValue(EVIDENCIAS)
    eliminarIncidencia.mockResolvedValue({})
    renderizar({ puedeEliminar: true })

    await screen.findByText('Se certificaron los 5 puntos de red.')
    const botones = screen.getAllByRole('button', { name: /Eliminar/i })
    await userEvent.click(botones[0])

    await waitFor(() => expect(eliminarIncidencia).toHaveBeenCalledWith(7, 2))
    await waitFor(() =>
      expect(screen.queryByText('Se certificaron los 5 puntos de red.')).not.toBeInTheDocument(),
    )
  })
})
