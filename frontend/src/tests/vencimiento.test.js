/**
 * tests/vencimiento.test.js
 * ---------------------------------------------------------------------------
 * Cuenta regresiva de la fecha límite de una tarea.
 *
 * El caso que más importa aquí es el del huso horario: `new Date('2026-08-07')`
 * se interpreta como UTC y en Guatemala (UTC-6) cae el día anterior, así que
 * una tarea que vence hoy se mostraría como vencida. Estas pruebas fijan eso.
 * ---------------------------------------------------------------------------
 */
import { describe, it, expect } from 'vitest'
import {
  describirVencimiento,
  diasRestantes,
  formatearFecha,
  parsearFechaLocal,
} from '../utils/vencimiento'

const HOY = new Date(2026, 7, 5) // 5 de agosto de 2026, hora local

/** Date -> "YYYY-MM-DD" en hora local (toISOString desplazaría el día). */
function aFechaLocalISO(fecha) {
  const mes = String(fecha.getMonth() + 1).padStart(2, '0')
  const dia = String(fecha.getDate()).padStart(2, '0')
  return `${fecha.getFullYear()}-${mes}-${dia}`
}

describe('parsearFechaLocal', () => {
  it('interpreta la fecha en horario local, no en UTC', () => {
    const fecha = parsearFechaLocal('2026-08-07')

    expect(fecha.getFullYear()).toBe(2026)
    expect(fecha.getMonth()).toBe(7) // agosto
    expect(fecha.getDate()).toBe(7)  // no el 6, como haría new Date(str)
  })

  it('devuelve null si no hay fecha', () => {
    expect(parsearFechaLocal(null)).toBeNull()
    expect(parsearFechaLocal('')).toBeNull()
  })

  it('tolera un timestamp completo', () => {
    expect(parsearFechaLocal('2026-08-07T16:30:00').getDate()).toBe(7)
  })
})

describe('diasRestantes', () => {
  it('cuenta los días que faltan', () => {
    expect(diasRestantes('2026-08-07', HOY)).toBe(2)
  })

  it('devuelve 0 el mismo día', () => {
    expect(diasRestantes('2026-08-05', HOY)).toBe(0)
  })

  it('devuelve negativo cuando ya venció', () => {
    expect(diasRestantes('2026-08-02', HOY)).toBe(-3)
  })
})

describe('describirVencimiento', () => {
  const tarea = (fecha, estado = 'pendiente') => ({
    fecha_finalizacion: fecha,
    estado_tarea: estado,
  })

  it('marca en rojo lo que vence hoy', () => {
    // Se usa la fecha real de hoy porque la función consulta el reloj.
    // toISOString() da la fecha en UTC: en Guatemala (UTC-6) puede caer un
    // día antes o después de la fecha local que usa describirVencimiento.
    const hoyLocal = aFechaLocalISO(new Date())
    const v = describirVencimiento(tarea(hoyLocal))

    expect(v.texto).toBe('Vence hoy')
    expect(v.variant).toBe('danger')
    expect(v.vencida).toBe(false)
  })

  it('marca como vencida lo que ya pasó', () => {
    const ayer = new Date()
    ayer.setDate(ayer.getDate() - 1)
    const v = describirVencimiento(tarea(aFechaLocalISO(ayer)))

    expect(v.vencida).toBe(true)
    expect(v.texto).toBe('Vencida ayer')
    expect(v.variant).toBe('danger')
  })

  it('no muestra nada para tareas ya cerradas', () => {
    // Una tarea completada no corre contra el reloj aunque su fecha pasara.
    expect(describirVencimiento(tarea('2020-01-01', 'completado'))).toBeNull()
    expect(describirVencimiento(tarea('2020-01-01', 'cancelado'))).toBeNull()
  })

  it('no muestra nada si la tarea no tiene fecha límite', () => {
    expect(describirVencimiento(tarea(null))).toBeNull()
  })
})

describe('formatearFecha', () => {
  it('devuelve una fecha corta y legible', () => {
    const texto = formatearFecha('2026-08-07')

    expect(texto).toContain('7')
    expect(texto).toContain('2026')
  })

  it('devuelve null sin fecha', () => {
    expect(formatearFecha(null)).toBeNull()
  })
})
