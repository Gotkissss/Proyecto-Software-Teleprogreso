/**
 * El gerente no ve botones que el backend le va a rechazar — HU-S10-08.
 * ---------------------------------------------------------------------------
 * La tabla de rutas de `utils/permisos.js` decide qué PANTALLAS ve cada rol.
 * Esta historia añade la de ACCIONES, que no es lo mismo: el gerente entra a
 * Alertas y a Inventario porque su trabajo es revisar la operación, pero los
 * endpoints de detrás son `require_supervisor`. Veía los botones igual y cada
 * clic terminaba en un 403: el permiso estaba bien puesto, lo que estaba mal
 * era prometer en pantalla algo que la API iba a rechazar.
 *
 * Se prueban las dos puntas: que el gerente no los ve y que el supervisor sí.
 * Sin la segunda, una tabla de permisos vacía pasaría todas las de la primera.
 * ---------------------------------------------------------------------------
 */

import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import { ROLES, puedeOperar } from '../utils/permisos'
import TablaMateriales from '../components/inventario/TablaMateriales'
import TablaVehiculos from '../components/inventario/TablaVehiculos'
import TablaHerramientas from '../components/inventario/TablaHerramientas'

const ACCIONES = [
  'alertas.atender',
  'inventario.crear',
  'inventario.editar',
  'inventario.eliminar',
  'inventario.asignar',
  'inventario.movimientos',
]

describe('puedeOperar', () => {
  it.each(ACCIONES)('el gerente no puede "%s"', (accion) => {
    expect(puedeOperar(ROLES.GERENTE, accion)).toBe(false)
  })

  it.each(ACCIONES)('el supervisor sí puede "%s"', (accion) => {
    expect(puedeOperar(ROLES.SUPERVISOR, accion)).toBe(true)
  })

  it.each(ACCIONES)('el admin sí puede "%s"', (accion) => {
    expect(puedeOperar(ROLES.ADMIN, accion)).toBe(true)
  })

  it.each(ACCIONES)('el técnico no puede "%s"', (accion) => {
    expect(puedeOperar(ROLES.TECNICO, accion)).toBe(false)
  })

  it('una acción desconocida se deniega', () => {
    // Si alguien añade un botón y escribe mal la clave, lo seguro es que no se
    // pinte, no que se pinte para todos.
    expect(puedeOperar(ROLES.ADMIN, 'inventario.inventada')).toBe(false)
    expect(puedeOperar(ROLES.ADMIN, '')).toBe(false)
    expect(puedeOperar(ROLES.ADMIN, undefined)).toBe(false)
  })

  it('sin rol se deniega', () => {
    expect(puedeOperar(undefined, 'inventario.editar')).toBe(false)
    expect(puedeOperar('', 'inventario.editar')).toBe(false)
    expect(puedeOperar(null, 'inventario.editar')).toBe(false)
  })
})

/* ── Las tablas del inventario ─────────────────────────────────────────────
   Lo que se comprueba es la columna de acciones, que es donde viven los
   botones de editar, eliminar, asignar y movimientos.
   ----------------------------------------------------------------------- */

const MATERIAL = {
  id_activo: 7,
  nombre_activo: 'Roseta óptica',
  tipo: 'material',
  tipo_material: 'conectividad',
  unidad_medida: 'unidad',
  cantidad_disponible: 12,
  stock_minimo: 5,
}

const VEHICULO = {
  id_activo: 3,
  nombre_activo: 'Pick-up 4x4',
  tipo: 'carro',
  placa: 'P-123ABC',
  estado_vehiculo: 'disponible',
}

const HERRAMIENTA = {
  id_activo: 5,
  nombre_activo: 'Taladro percutor',
  tipo: 'herramienta',
  tipo_herramienta: 'eléctrica',
  estado: 'disponible',
}

const TABLAS = [
  ['materiales', TablaMateriales, MATERIAL, 'Roseta óptica'],
  ['vehículos', TablaVehiculos, VEHICULO, 'Pick-up 4x4'],
  ['herramientas', TablaHerramientas, HERRAMIENTA, 'Taladro percutor'],
]

/** La tabla de vehículos enlaza al detalle con <Link>: necesita un router. */
function montar(elemento) {
  return render(<MemoryRouter>{elemento}</MemoryRouter>)
}

describe('Tablas del inventario según el permiso', () => {
  it.each(TABLAS)(
    'la tabla de %s esconde la columna de acciones sin permiso',
    (_nombre, Tabla, fila, textoVisible) => {
      montar(<Tabla datos={[fila]} puedeGestionar={false} />)

      // La fila sigue ahí: el gerente tiene que poder CONSULTAR el inventario.
      expect(screen.getByText(textoVisible)).toBeInTheDocument()
      expect(
        screen.queryByRole('columnheader', { name: 'Acciones' }),
      ).not.toBeInTheDocument()
      expect(screen.queryAllByRole('button')).toHaveLength(0)
    },
  )

  it.each(TABLAS)(
    'la tabla de %s muestra la columna de acciones con permiso',
    (_nombre, Tabla, fila, textoVisible) => {
      montar(<Tabla datos={[fila]} puedeGestionar />)

      expect(screen.getByText(textoVisible)).toBeInTheDocument()
      expect(
        screen.getByRole('columnheader', { name: 'Acciones' }),
      ).toBeInTheDocument()
      expect(screen.queryAllByRole('button').length).toBeGreaterThan(0)
    },
  )

  it('por omisión se muestran: el permiso lo decide quien monta la tabla', () => {
    // Las tablas se usan desde una sola pantalla, que sí calcula el permiso.
    // El valor por omisión es "sí" para que una tabla montada en otra parte no
    // aparezca mutilada sin que nadie entienda por qué.
    montar(<TablaMateriales datos={[MATERIAL]} />)
    expect(
      screen.getByRole('columnheader', { name: 'Acciones' }),
    ).toBeInTheDocument()
  })
})
