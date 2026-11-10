/**
 * tests/jornadaEnRuta.test.jsx
 * ---------------------------------------------------------------------------
 * El segundo contador de la ruta del técnico.
 *
 * Decía "PENDIENTES", que es la resta del contador de al lado: con "1/3
 * completadas" a la vista, "2 pendientes" no agrega nada. Ahora dice cuánto
 * lleva el técnico desde que marcó entrada, y si no marcó, lo dice.
 *
 * Lo que se fija aquí:
 *   - La cuenta se hace contra el reloj local, a partir de la hora de entrada
 *     del día: así avanza sola entre una consulta y otra.
 *   - Una hora de entrada en el futuro (reloj desfasado) no produce un
 *     contador en negativo.
 *   - Sin jornada abierta la pantalla lo dice en lugar de inventar un tiempo.
 *
 * Se ejecutan con: npx vitest run src/tests/jornadaEnRuta.test.jsx
 * ---------------------------------------------------------------------------
 */
import { describe, it, expect } from 'vitest'
import { duracionCorta, segundosEnJornada } from '../utils/jornada'

const EN = (iso) => new Date(iso)

describe('segundosEnJornada', () => {
  it('cuenta desde la hora de entrada de hoy', () => {
    const ahora = EN('2026-11-09T12:05:00')
    expect(segundosEnJornada('07:35:00', ahora)).toBe((4 * 60 + 30) * 60)
  })

  it('tolera la hora sin segundos', () => {
    expect(segundosEnJornada('08:00', EN('2026-11-09T09:30:00'))).toBe(90 * 60)
  })

  it('sin hora de entrada no hay cuenta', () => {
    expect(segundosEnJornada(null)).toBeNull()
    expect(segundosEnJornada('')).toBeNull()
    expect(segundosEnJornada('no es una hora')).toBeNull()
  })

  it('una entrada en el futuro da cero, no un número negativo', () => {
    // Pasa con el reloj del teléfono desfasado: un "-12 min" en la pantalla
    // se lee como que la aplicación está rota.
    expect(segundosEnJornada('18:00:00', EN('2026-11-09T09:00:00'))).toBe(0)
  })
})

describe('duracionCorta', () => {
  it('menos de una hora va en minutos', () => {
    expect(duracionCorta(45 * 60)).toBe('45 min')
    expect(duracionCorta(0)).toBe('0 min')
  })

  it('a partir de la hora, horas y minutos con dos cifras', () => {
    expect(duracionCorta((4 * 60 + 20) * 60)).toBe('4 h 20 min')
    // Los minutos van con cero adelante para que el ancho no baile cada vez
    // que el contador pasa de "4 h 09 min" a "4 h 10 min".
    expect(duracionCorta((4 * 60 + 5) * 60)).toBe('4 h 05 min')
  })

  it('los segundos sueltos no se muestran', () => {
    expect(duracionCorta(119)).toBe('1 min')
  })

  it('sin segundos no hay texto', () => {
    expect(duracionCorta(null)).toBeNull()
    expect(duracionCorta(undefined)).toBeNull()
  })
})
