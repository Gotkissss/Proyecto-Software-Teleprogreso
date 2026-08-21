/**
 * tests/fecha.test.js
 * ---------------------------------------------------------------------------
 * utils/fecha.js — comparar días sin que la zona horaria del navegador mueva
 * la fecha.
 *
 * Es lo que decide si una tarea completada se pinta en el mapa "hoy" o ya no.
 * Con `new Date(...)` la respuesta cambiaba según la zona del navegador: el
 * backend devuelve hora de Guatemala sin zona, así que un cierre de la tarde
 * se contaba como del día siguiente en cualquier navegador al este de
 * Guatemala, y un valor sin hora se parseaba como UTC y caía al día anterior.
 * ---------------------------------------------------------------------------
 */
import { describe, it, expect } from 'vitest'
import { aISO, esDelDia, hoyISO, soloFecha } from '../utils/fecha'

describe('soloFecha', () => {
  it('se queda con el día de una marca de tiempo', () => {
    expect(soloFecha('2026-08-21T15:04:00')).toBe('2026-08-21')
  })

  it('deja pasar una fecha que ya viene sin hora', () => {
    expect(soloFecha('2026-08-21')).toBe('2026-08-21')
  })

  it('devuelve null cuando no hay valor', () => {
    expect(soloFecha(null)).toBeNull()
    expect(soloFecha(undefined)).toBeNull()
    expect(soloFecha('')).toBeNull()
  })
})

describe('esDelDia', () => {
  it('reconoce un cierre del mismo día', () => {
    expect(esDelDia('2026-08-21T15:04:00', '2026-08-21')).toBe(true)
  })

  it('un cierre de la noche no se pasa al día siguiente', () => {
    // 23:59 hora de Guatemala son las 05:59 UTC del día 22: con `new Date` +
    // getDate() esta tarea aparecía como de mañana.
    expect(esDelDia('2026-08-21T23:59:00', '2026-08-21')).toBe(true)
    expect(esDelDia('2026-08-21T23:59:00', '2026-08-22')).toBe(false)
  })

  it('un cierre de otro día no cuenta', () => {
    expect(esDelDia('2026-08-20T15:04:00', '2026-08-21')).toBe(false)
  })

  it('sin marca de tiempo no se puede afirmar el día', () => {
    expect(esDelDia(null, '2026-08-21')).toBe(false)
  })
})

describe('aISO / hoyISO', () => {
  it('formatea en hora local, no en UTC', () => {
    // 21 de agosto a las 20:00 locales: toISOString() lo habría escrito como
    // día 22 en cualquier zona al oeste de Greenwich.
    expect(aISO(new Date(2026, 7, 21, 20, 0, 0))).toBe('2026-08-21')
  })

  it('rellena mes y día con cero a la izquierda', () => {
    expect(aISO(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('hoyISO devuelve el día de hoy con el mismo formato', () => {
    expect(hoyISO()).toBe(aISO(new Date()))
    expect(hoyISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
