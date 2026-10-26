/**
 * Materiales usados al finalizar una tarea (HU-S10-07, tarea 3).
 *
 * 1. El modal: anotar materiales, sumar los repetidos, guardarlos en el
 *    borrador y, si el cierre falla con 409 después de guardar la evidencia,
 *    reintentar sin volver a crearla.
 * 2. El servicio: con materiales la foto no cierra la tarea (el cierre y el
 *    descuento van juntos en /finalizar) y la evidencia guardada se reutiliza.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const api = vi.hoisted(() => ({ post: vi.fn(), patch: vi.fn(), get: vi.fn(), delete: vi.fn() }))
const inventario = vi.hoisted(() => ({ getMaterialesParaConsumo: vi.fn() }))

vi.mock('../api/client', () => ({ default: api }))
vi.mock('../api/inventarioService', () => inventario)

import { ToastProvider } from '../components/ui/Toast'
import ModalFinalizarTarea from '../components/tareas/ModalFinalizarTarea'
import * as incidencias from '../api/incidenciaService'
import { guardarBorrador, leerBorrador } from '../utils/borradorTarea'

const SERVICIO = { id_servicio: 41, nombre: 'Instalación fibra óptica' }
const DISPONIBLES = [
  { id_activo: 5, nombre_activo: 'Cable UTP', unidad_medida: 'm' },
  { id_activo: 9, nombre_activo: 'Conector RJ45', unidad_medida: 'u' },
]
const EVIDENCIA = { id_incidencia: 3, foto_evidencia: '/archivos/incidencias/x.jpg?exp=1&firma=f' }

function foto() {
  return new File([new Uint8Array(2048)], 'evidencia.jpg', { type: 'image/jpeg' })
}

function montar() {
  return render(
    <ToastProvider>
      <ModalFinalizarTarea open servicio={SERVICIO} onClose={() => {}} onFinalizada={() => {}} />
    </ToastProvider>,
  )
}

async function llenarEvidencia(container) {
  await userEvent.type(screen.getByLabelText(/¿Qué realizaste\?/), 'Se instaló la acometida y la ONT.')
  await userEvent.upload(container.querySelector('input[type="file"]'), foto())
}

async function anotar(nombre, cantidad) {
  await userEvent.selectOptions(screen.getByLabelText('Material'), screen.getByRole('option', { name: new RegExp(nombre) }))
  const campo = screen.getByLabelText('Cantidad')
  await userEvent.clear(campo)
  await userEvent.type(campo, String(cantidad))
  await userEvent.click(screen.getByRole('button', { name: 'Agregar' }))
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  inventario.getMaterialesParaConsumo.mockResolvedValue(DISPONIBLES)
})

describe('modal de finalizar con materiales', () => {
  it('sin abrir la sección no pide la lista de materiales', async () => {
    montar()
    await screen.findByText('Materiales usados (opcional)')
    expect(inventario.getMaterialesParaConsumo).not.toHaveBeenCalled()
  })

  it('anota materiales, suma los repetidos y los manda con el cierre', async () => {
    const spy = vi.spyOn(incidencias, 'finalizarTareaConEvidencia').mockResolvedValue(EVIDENCIA)
    const { container } = montar()
    await llenarEvidencia(container)

    await userEvent.click(screen.getByRole('button', { name: /Agregar materiales/ }))
    await screen.findByRole('option', { name: /Cable UTP/ })
    await anotar('Cable UTP', 3)
    await anotar('Cable UTP', 2)
    await anotar('Conector', 4)

    const lista = screen.getByRole('list', { name: 'Materiales anotados' })
    expect(lista).toHaveTextContent('Cable UTP: 5 m')
    expect(lista).toHaveTextContent('Conector RJ45: 4 u')

    await userEvent.click(screen.getByRole('button', { name: /Finalizar tarea/ }))

    await waitFor(() => expect(spy).toHaveBeenCalled())
    expect(spy.mock.calls[0][1].materiales).toEqual([
      { id_material: 5, nombre: 'Cable UTP', unidad: 'm', cantidad: 5 },
      { id_material: 9, nombre: 'Conector RJ45', unidad: 'u', cantidad: 4 },
    ])
    spy.mockRestore()
  })

  it('una cantidad que no es un entero positivo no se agrega', async () => {
    montar()
    await userEvent.click(screen.getByRole('button', { name: /Agregar materiales/ }))
    await screen.findByRole('option', { name: /Cable UTP/ })

    await anotar('Cable UTP', 0)

    expect(screen.getByText(/entero mayor que 0/)).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Materiales anotados' })).not.toBeInTheDocument()
  })

  it('los materiales anotados quedan en el borrador y se reofrecen', async () => {
    guardarBorrador(SERVICIO.id_servicio, {
      descripcion: 'A medias',
      materiales: [{ id_material: 5, nombre: 'Cable UTP', unidad: 'm', cantidad: 7 }],
    })

    montar()

    expect(await screen.findByRole('list', { name: 'Materiales anotados' })).toHaveTextContent('Cable UTP: 7 m')
    expect(leerBorrador(SERVICIO.id_servicio).materiales).toHaveLength(1)
  })

  it('si falta stock, el reintento no vuelve a crear la evidencia', async () => {
    const error = {
      response: { status: 409, data: { detail: 'No hay suficiente «Cable UTP»: quedan 2 m.' } },
      evidenciaGuardada: EVIDENCIA,
    }
    const spy = vi
      .spyOn(incidencias, 'finalizarTareaConEvidencia')
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(EVIDENCIA)
    const { container } = montar()
    await llenarEvidencia(container)
    await userEvent.click(screen.getByRole('button', { name: /Agregar materiales/ }))
    await screen.findByRole('option', { name: /Cable UTP/ })
    await anotar('Cable UTP', 5)

    await userEvent.click(screen.getByRole('button', { name: /Finalizar tarea/ }))
    expect(await screen.findByText(/La evidencia ya quedó guardada/)).toBeInTheDocument()
    expect(screen.getByLabelText(/¿Qué realizaste\?/)).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: /Quitar Cable UTP/ }))
    await anotar('Cable UTP', 2)
    await userEvent.click(screen.getByRole('button', { name: /Finalizar tarea/ }))

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2))
    expect(spy.mock.calls[1][1].evidenciaGuardada).toEqual(EVIDENCIA)
    expect(spy.mock.calls[1][1].materiales).toEqual([
      { id_material: 5, nombre: 'Cable UTP', unidad: 'm', cantidad: 2 },
    ])
    spy.mockRestore()
  })
})

describe('incidenciaService con materiales', () => {
  beforeEach(() => {
    api.post.mockImplementation(async (url) =>
      url.endsWith('/foto')
        ? { data: { foto_evidencia: EVIDENCIA.foto_evidencia } }
        : { data: { id_incidencia: EVIDENCIA.id_incidencia } }
    )
    api.patch.mockResolvedValue({ data: { id_tarea: 41, estado_tarea: 'completado' } })
  })

  it('con materiales la foto no cierra la tarea y el cierre los lleva', async () => {
    await incidencias.finalizarTareaConEvidencia(41, {
      descripcion: 'Listo',
      foto: foto(),
      posicion: { lat: 14.6, lng: -90.5 },
      materiales: [{ id_material: 5, nombre: 'Cable UTP', unidad: 'm', cantidad: 3 }],
    })

    const subida = api.post.mock.calls.find(([url]) => url.endsWith('/foto'))[1]
    expect(subida.get('finalizar_tarea')).toBe('false')
    expect(api.patch).toHaveBeenCalledWith('/tareas/41/finalizar', {
      lat: 14.6,
      lng: -90.5,
      materiales: [{ id_material: 5, cantidad: 3 }],
    })
  })

  it('sin materiales todo queda como antes', async () => {
    await incidencias.finalizarTareaConEvidencia(41, { descripcion: 'Listo', foto: foto() })

    const subida = api.post.mock.calls.find(([url]) => url.endsWith('/foto'))[1]
    expect(subida.get('finalizar_tarea')).toBe('true')
    expect(api.patch).toHaveBeenCalledWith('/tareas/41/finalizar', undefined)
  })

  it('con la evidencia ya guardada solo se reintenta el cierre', async () => {
    await incidencias.finalizarTareaConEvidencia(41, {
      descripcion: 'Listo',
      foto: foto(),
      materiales: [{ id_material: 5, nombre: 'Cable UTP', unidad: 'm', cantidad: 1 }],
      evidenciaGuardada: EVIDENCIA,
    })

    expect(api.post).not.toHaveBeenCalled()
    expect(api.patch).toHaveBeenCalledTimes(1)
  })

  it('si el cierre falla, el error lleva la evidencia guardada', async () => {
    api.patch.mockRejectedValue({ response: { status: 409 } })

    const error = await incidencias
      .finalizarTareaConEvidencia(41, {
        descripcion: 'Listo',
        foto: foto(),
        materiales: [{ id_material: 5, nombre: 'Cable UTP', unidad: 'm', cantidad: 9 }],
      })
      .catch((e) => e)

    expect(error.evidenciaGuardada).toEqual({
      id_incidencia: EVIDENCIA.id_incidencia,
      foto_evidencia: EVIDENCIA.foto_evidencia,
    })
  })
})
