/**
 * Kardex de materiales en pantalla — HU-S10-07.
 * ---------------------------------------------------------------------------
 * Dos piezas:
 *
 *   1. El paso "materiales usados" del modal de finalizar tarea. Es opcional,
 *      y lo que importa es que no deje enviar una línea a medias: el backend
 *      rechazaría el cierre entero con un 409 y el técnico perdería el viaje.
 *   2. El modal de movimientos del inventario, que es la respuesta a "¿a dónde
 *      se fueron las 40 rosetas?".
 * ---------------------------------------------------------------------------
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const servicio = vi.hoisted(() => ({
  getMateriales: vi.fn(),
  getMovimientosMaterial: vi.fn(),
  crearMovimientoMaterial: vi.fn(),
}))

vi.mock('../api/inventarioService', () => servicio)

import PasoMaterialesUsados, {
  validarMateriales,
} from '../components/tareas/PasoMaterialesUsados'
import ModalMovimientosMaterial from '../components/inventario/ModalMovimientosMaterial'
import { ToastProvider } from '../components/ui/Toast'

const MATERIALES = [
  {
    id_activo: 7,
    nombre_activo: 'Roseta óptica',
    cantidad_disponible: 3,
    unidad_medida: 'unidad',
  },
  {
    id_activo: 9,
    nombre_activo: 'Cable drop',
    cantidad_disponible: 500,
    unidad_medida: 'metro',
  },
]


/* ══ 1. Validación de las líneas ═══════════════════════════════════════════ */

describe('validarMateriales', () => {
  it('sin líneas no hay error ni nada que enviar', () => {
    const { errores, limpias } = validarMateriales([], MATERIALES)
    expect(errores).toEqual({})
    expect(limpias).toEqual([])
  })

  it('una línea completa pasa y se normaliza a números', () => {
    const { errores, limpias } = validarMateriales(
      [{ id_material: '7', cantidad: '2' }],
      MATERIALES,
    )
    expect(errores).toEqual({})
    expect(limpias).toEqual([{ id_material: 7, cantidad: 2 }])
  })

  it('una línea sin material pide elegirlo', () => {
    const { errores, limpias } = validarMateriales(
      [{ id_material: '', cantidad: '2' }],
      MATERIALES,
    )
    expect(errores[0]).toMatch(/material/i)
    expect(limpias).toEqual([])
  })

  it.each([['0'], ['-3'], [''], ['dos'], ['1.5']])(
    'rechaza la cantidad %s',
    (cantidad) => {
      const { errores } = validarMateriales(
        [{ id_material: '7', cantidad }],
        MATERIALES,
      )
      expect(errores[0]).toBeTruthy()
    },
  )

  it('avisa cuando se pide más de lo que hay', () => {
    const { errores } = validarMateriales(
      [{ id_material: '7', cantidad: '5' }],
      MATERIALES,
    )
    expect(errores[0]).toMatch(/solo hay 3/i)
  })

  it('suma las líneas del mismo material antes de comparar con el stock', () => {
    // Dos líneas de 2 sobre 3 unidades: ninguna se pasa por su cuenta, pero
    // juntas sí. El backend las agrupa igual y rechazaría el cierre entero,
    // así que avisar aquí evita el viaje perdido.
    const { errores } = validarMateriales(
      [
        { id_material: '7', cantidad: '2' },
        { id_material: '7', cantidad: '2' },
      ],
      MATERIALES,
    )
    expect(errores[1]).toMatch(/solo hay 3/i)
  })

  it('sin catálogo no inventa un tope de stock', () => {
    // Si el inventario no cargó, el cliente no puede saber cuánto hay: deja
    // pasar y que decida el backend, en vez de bloquear el cierre.
    const { errores, limpias } = validarMateriales(
      [{ id_material: '7', cantidad: '9999' }],
      [],
    )
    expect(errores).toEqual({})
    expect(limpias).toEqual([{ id_material: 7, cantidad: 9999 }])
  })
})


/* ══ 2. El paso en el modal ════════════════════════════════════════════════ */

describe('PasoMaterialesUsados', () => {
  beforeEach(() => {
    servicio.getMateriales.mockReset()
    servicio.getMateriales.mockResolvedValue(MATERIALES)
  })

  it('arranca vacío: el paso es opcional', async () => {
    render(<PasoMaterialesUsados lineas={[]} onChange={vi.fn()} />)

    expect(await screen.findByText(/dejalo vacío/i)).toBeInTheDocument()
    expect(screen.queryByLabelText('Material 1')).not.toBeInTheDocument()
  })

  it('"Agregar material" añade una línea', async () => {
    const onChange = vi.fn()
    render(<PasoMaterialesUsados lineas={[]} onChange={onChange} />)

    await userEvent.click(
      screen.getByRole('button', { name: /agregar material/i }),
    )

    expect(onChange).toHaveBeenCalledWith([{ id_material: '', cantidad: '' }])
  })

  it('el selector muestra el stock de cada material', async () => {
    render(
      <PasoMaterialesUsados
        lineas={[{ id_material: '', cantidad: '' }]}
        onChange={vi.fn()}
      />,
    )

    // Que el técnico vea cuánto hay antes de teclear la cantidad es lo que
    // evita el 409 al cerrar.
    expect(
      await screen.findByRole('option', { name: 'Roseta óptica (3 unidad)' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('option', { name: 'Cable drop (500 metro)' }),
    ).toBeInTheDocument()
  })

  it('quitar una línea la saca de la lista', async () => {
    const onChange = vi.fn()
    render(
      <PasoMaterialesUsados
        lineas={[
          { id_material: '7', cantidad: '1' },
          { id_material: '9', cantidad: '2' },
        ]}
        onChange={onChange}
      />,
    )

    await userEvent.click(
      await screen.findByRole('button', { name: /quitar material 1/i }),
    )

    expect(onChange).toHaveBeenCalledWith([{ id_material: '9', cantidad: '2' }])
  })

  it('si el inventario no carga, avisa y no bloquea el cierre', async () => {
    servicio.getMateriales.mockRejectedValue(new Error('sin red'))
    render(<PasoMaterialesUsados lineas={[]} onChange={vi.fn()} />)

    expect(
      await screen.findByText(/La tarea se cierra igual/i),
    ).toBeInTheDocument()
  })

  it('pinta el error que le llega de cada línea', async () => {
    render(
      <PasoMaterialesUsados
        lineas={[{ id_material: '7', cantidad: '5' }]}
        onChange={vi.fn()}
        errores={{ 0: 'Solo hay 3 en existencia.' }}
      />,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('Solo hay 3')
  })
})


/* ══ 3. El modal de movimientos ════════════════════════════════════════════ */

const MATERIAL = {
  id_activo: 7,
  nombre_activo: 'Roseta óptica',
  unidad_medida: 'unidad',
  cantidad_disponible: 12,
}

const RESPUESTA = {
  id_material: 7,
  nombre_material: 'Roseta óptica',
  cantidad_disponible: 12,
  stock_minimo: 5,
  total: 2,
  movimientos: [
    {
      id_movimiento: 2,
      tipo: 'consumo',
      cantidad: 8,
      saldo_resultante: 12,
      motivo: null,
      fecha_hora: '2026-10-27T14:32:00',
      id_tarea: 55,
      titulo_tarea: 'Instalación Los Álamos',
      id_empleado: 4,
      nombre_empleado: 'Juan Pérez',
    },
    {
      id_movimiento: 1,
      tipo: 'entrada',
      cantidad: 20,
      saldo_resultante: 20,
      motivo: 'Compra, factura 1042',
      fecha_hora: '2026-10-26T09:10:00',
      id_tarea: null,
      titulo_tarea: null,
      id_empleado: 2,
      nombre_empleado: 'Lucía Ramírez',
    },
  ],
}

function montarModal(props = {}) {
  return render(
    <ToastProvider>
      <ModalMovimientosMaterial
        material={MATERIAL}
        onCerrar={vi.fn()}
        {...props}
      />
    </ToastProvider>,
  )
}

describe('ModalMovimientosMaterial', () => {
  beforeEach(() => {
    servicio.getMovimientosMaterial.mockReset()
    servicio.crearMovimientoMaterial.mockReset()
    servicio.getMovimientosMaterial.mockResolvedValue(RESPUESTA)
  })

  it('cuenta a dónde fue cada unidad', async () => {
    montarModal()

    // Lo que antes no se podía contestar: el consumo trae su tarea y su
    // técnico, y la entrada su motivo.
    expect(await screen.findByText('Instalación Los Álamos')).toBeInTheDocument()
    expect(screen.getByText('Juan Pérez')).toBeInTheDocument()
    expect(screen.getByText('Compra, factura 1042')).toBeInTheDocument()
  })

  it('muestra el saldo que dejó cada movimiento', async () => {
    montarModal()

    await screen.findByText('Instalación Los Álamos')
    const filas = screen.getAllByRole('row')
    // Cabecera + dos movimientos.
    expect(filas).toHaveLength(3)
    expect(filas[1]).toHaveTextContent('12')
    expect(filas[2]).toHaveTextContent('20')
  })

  it('la fecha no se corre de zona', async () => {
    // El backend manda la hora ya en la zona de la operación y sin zona
    // declarada: construir un Date la interpretaría como UTC y la correría
    // seis horas, dejando los movimientos de la tarde con fecha del día
    // siguiente.
    montarModal()

    expect(await screen.findByText('27/10/2026 14:32')).toBeInTheDocument()
  })

  it('registra una entrada y refresca la historia', async () => {
    servicio.crearMovimientoMaterial.mockResolvedValue({
      id_movimiento: 3,
      tipo: 'entrada',
      cantidad: 5,
      saldo_resultante: 17,
      fecha_hora: '2026-10-27T15:00:00',
    })
    const onMovido = vi.fn()
    montarModal({ onMovido })

    await screen.findByText('Instalación Los Álamos')
    await userEvent.type(screen.getByLabelText(/unidades que entran/i), '5')
    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }))

    await waitFor(() => {
      expect(servicio.crearMovimientoMaterial).toHaveBeenCalledWith(7, {
        tipo: 'entrada',
        cantidad: 5,
        motivo: undefined,
      })
    })
    // La tabla del inventario tenía el saldo viejo.
    expect(onMovido).toHaveBeenCalledWith(
      expect.objectContaining({ cantidad_disponible: 17 }),
    )
  })

  it('un ajuste sin motivo no se envía', async () => {
    montarModal()

    await screen.findByText('Instalación Los Álamos')
    await userEvent.selectOptions(screen.getByLabelText('Tipo'), 'ajuste')
    await userEvent.type(screen.getByLabelText(/stock contado/i), '9')
    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }))

    expect(servicio.crearMovimientoMaterial).not.toHaveBeenCalled()
    expect(await screen.findByRole('alert')).toHaveTextContent(/motivo/i)
  })

  it('una cantidad que no es positiva no se envía', async () => {
    montarModal()

    await screen.findByText('Instalación Los Álamos')
    await userEvent.type(screen.getByLabelText(/unidades que entran/i), '0')
    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }))

    expect(servicio.crearMovimientoMaterial).not.toHaveBeenCalled()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('muestra el motivo que da el backend si rechaza el movimiento', async () => {
    servicio.crearMovimientoMaterial.mockRejectedValue({
      response: {
        status: 400,
        data: { detail: 'El material ya tiene 12 unidades: no hay nada que ajustar.' },
      },
    })
    montarModal()

    await screen.findByText('Instalación Los Álamos')
    await userEvent.type(screen.getByLabelText(/unidades que entran/i), '12')
    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /no hay nada que ajustar/i,
    )
  })

  it('sin movimientos explica de dónde salen', async () => {
    servicio.getMovimientosMaterial.mockResolvedValue({
      ...RESPUESTA,
      total: 0,
      movimientos: [],
    })
    montarModal()

    expect(
      await screen.findByText(/cuando un técnico cierra una tarea/i),
    ).toBeInTheDocument()
  })

  it('si la historia no carga, ofrece reintentar', async () => {
    servicio.getMovimientosMaterial.mockRejectedValue({
      response: { data: { detail: 'No existe ningún material con id=7.' } },
    })
    montarModal()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No existe ningún material con id=7.',
    )
    expect(
      screen.getByRole('button', { name: 'Reintentar' }),
    ).toBeInTheDocument()
  })
})
