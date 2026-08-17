/**
 * tests/estadoColor.test.js
 * ---------------------------------------------------------------------------
 * Regresión del bug de los badges sin color en los popups del mapa.
 *
 * Badge.jsx usa el prop `variant` directamente como nombre de clase, y
 * Badge.module.css solo define success/info/warning/danger/muted. Los
 * marcadores le pasaban el estado crudo ('pendiente', 'alta', ...), que
 * resolvía a `styles[...] === undefined`: el badge salía gris/sin estilo y
 * con la clase literal "undefined" en el DOM.
 *
 * Estos tests fijan el contrato: toda variante devuelta por los helpers debe
 * ser una de las que Badge sabe pintar.
 * ---------------------------------------------------------------------------
 */
import { describe, it, expect } from 'vitest'
import {
  ESTADO_LABEL,
  ORDEN_ESTADOS,
  PRIORIDAD_LABEL,
  colorPorEstado,
  variantePorEstado,
  variantePorPrioridad,
} from '../components/mapa/estadoColor'

// Las únicas clases que existen en Badge.module.css.
const VARIANTES_VALIDAS = ['success', 'info', 'warning', 'danger', 'muted']

describe('variantePorEstado', () => {
  it('devuelve una variante que Badge sabe pintar para cada estado', () => {
    ORDEN_ESTADOS.forEach((estado) => {
      expect(VARIANTES_VALIDAS).toContain(variantePorEstado(estado))
    })
  })

  it('cae en "muted" ante un estado desconocido en vez de undefined', () => {
    expect(variantePorEstado('estado_que_no_existe')).toBe('muted')
    expect(variantePorEstado(undefined)).toBe('muted')
  })
})

describe('variantePorPrioridad', () => {
  it('devuelve una variante válida para cada prioridad', () => {
    Object.keys(PRIORIDAD_LABEL).forEach((prioridad) => {
      expect(VARIANTES_VALIDAS).toContain(variantePorPrioridad(prioridad))
    })
  })

  it('cae en "muted" ante una prioridad desconocida', () => {
    expect(variantePorPrioridad('altísima')).toBe('muted')
    expect(variantePorPrioridad(null)).toBe('muted')
  })
})

describe('etiquetas y colores', () => {
  it('cada estado del orden de la leyenda tiene etiqueta y color', () => {
    ORDEN_ESTADOS.forEach((estado) => {
      expect(ESTADO_LABEL[estado]).toBeTruthy()
      expect(colorPorEstado(estado)).toMatch(/^var\(--/)
    })
  })

  it('un estado desconocido no rompe el color del pin', () => {
    expect(colorPorEstado('inventado')).toBe('var(--color-text-muted)')
  })
})
