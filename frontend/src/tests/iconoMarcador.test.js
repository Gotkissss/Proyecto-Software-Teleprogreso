/**
 * tests/iconoMarcador.test.js
 * ---------------------------------------------------------------------------
 * SCRUM-181 — Contrato de la fábrica de pines del mapa.
 *
 * Fija las dos cosas que importan: que el color siga el criterio de cada vista
 * (el técnico prioriza, el supervisor mira el avance) y que los íconos se
 * reutilicen. Lo segundo dejó de ser cosmético con SCRUM-180: el mapa del
 * supervisor pasó a pintar cientos de tareas, y antes cada render construía un
 * `L.divIcon` nuevo por marcador.
 * ---------------------------------------------------------------------------
 */
import { describe, it, expect } from 'vitest'
import {
  TAMANOS_PIN,
  crearIconoPin,
  iconoPorEstado,
  iconoPorTarea,
  iconoSeleccion,
} from '../components/mapa/iconoMarcador'
import { ESTADO_COLOR, PRIORIDAD_COLOR } from '../components/mapa/estadoColor'

/** El color viaja dentro del html del divIcon, como `style="color:..."`. */
function colorDe(icono) {
  return icono.options.html.match(/color:([^"]+)"/)?.[1]?.trim() ?? null
}

describe('memorización de íconos', () => {
  it('devuelve la MISMA instancia para los mismos parámetros', () => {
    const a = crearIconoPin({ color: 'var(--color-success)', tamano: 'md' })
    const b = crearIconoPin({ color: 'var(--color-success)', tamano: 'md' })
    expect(a).toBe(b)
  })

  it('distingue por color, por tamaño y por pulso', () => {
    const base = crearIconoPin({ color: 'var(--color-info)', tamano: 'md' })
    expect(crearIconoPin({ color: 'var(--color-danger)', tamano: 'md' })).not.toBe(base)
    expect(crearIconoPin({ color: 'var(--color-info)', tamano: 'sm' })).not.toBe(base)
    expect(crearIconoPin({ color: 'var(--color-info)', tamano: 'md', pulso: true })).not.toBe(base)
  })

  it('dos tareas distintas con el mismo estado comparten ícono', () => {
    const uno = iconoPorEstado('completado')
    const dos = iconoPorEstado('completado')
    expect(uno).toBe(dos)
  })
})

describe('iconoPorTarea — vista del técnico', () => {
  it('una tarea abierta se colorea por PRIORIDAD', () => {
    expect(colorDe(iconoPorTarea({ estado: 'pendiente', prioridad: 'urgente' })))
      .toBe(PRIORIDAD_COLOR.urgente)
    expect(colorDe(iconoPorTarea({ estado: 'pendiente', prioridad: 'baja' })))
      .toBe(PRIORIDAD_COLOR.baja)
  })

  it('una tarea cerrada se colorea por ESTADO, ignorando la prioridad', () => {
    expect(colorDe(iconoPorTarea({ estado: 'completado', prioridad: 'urgente' })))
      .toBe(ESTADO_COLOR.completado)
    expect(colorDe(iconoPorTarea({ estado: 'cancelado', prioridad: 'urgente' })))
      .toBe(ESTADO_COLOR.cancelado)
  })

  it('en progreso manda sobre la prioridad y además pulsa', () => {
    const icono = iconoPorTarea({ estado: 'en_progreso', prioridad: 'baja' })
    expect(colorDe(icono)).toBe(ESTADO_COLOR.en_progreso)
    expect(icono.options.html).toMatch(/pinPulse/)
  })

  it('acepta tareas que traen `estado_tarea` en vez de `estado`', () => {
    // Las tareas del backend usan estado_tarea; las de rutaService, estado.
    expect(colorDe(iconoPorTarea({ estado_tarea: 'completado' })))
      .toBe(ESTADO_COLOR.completado)
  })
})

describe('iconoPorEstado — vista del supervisor', () => {
  it('usa el color del estado, que es el de la leyenda', () => {
    expect(colorDe(iconoPorEstado('pendiente'))).toBe(ESTADO_COLOR.pendiente)
    expect(colorDe(iconoPorEstado('completado'))).toBe(ESTADO_COLOR.completado)
  })

  it('un estado desconocido no deja el pin sin color', () => {
    expect(colorDe(iconoPorEstado('inventado'))).toBe('var(--color-text-muted)')
  })
})

describe('geometría del pin', () => {
  it('ancla la punta de la gota, no su centro', () => {
    const { ancho, alto } = TAMANOS_PIN.md
    const icono = iconoSeleccion('md')
    expect(icono.options.iconAnchor).toEqual([ancho / 2, alto])
  })

  it('el selector de ubicación usa el color de marca', () => {
    expect(colorDe(iconoSeleccion())).toBe('var(--color-primary)')
  })
})
