/**
 * tests/useTimer.test.jsx
 * ---------------------------------------------------------------------------
 * Pruebas unitarias del hook useTimer y la función formatSeconds.
 * Se usan fake timers de Vitest para simular el paso del tiempo
 * sin esperar segundos reales.
 * ---------------------------------------------------------------------------
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTimer, formatSeconds } from '../hooks/useTimer'

describe('formatSeconds', () => {
  it('formatea 0 segundos como 00:00:00', () => {
    expect(formatSeconds(0)).toBe('00:00:00')
  })

  it('formatea horas, minutos y segundos correctamente', () => {
    // 1h 1m 5s = 3665 segundos
    expect(formatSeconds(3665)).toBe('01:01:05')
  })

  it('formatea jornadas largas (más de 10 horas)', () => {
    // 10h 30m 0s = 37800 segundos
    expect(formatSeconds(37800)).toBe('10:30:00')
  })
})

describe('useTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('arranca con los segundos iniciales del backend', () => {
    const { result } = renderHook(() => useTimer(120, true))
    expect(result.current.seconds).toBe(120)
    expect(result.current.formatted).toBe('00:02:00')
  })

  it('incrementa un segundo por cada segundo transcurrido', () => {
    const { result } = renderHook(() => useTimer(0, true))
    act(() => {
      vi.advanceTimersByTime(5000) // avanzar 5 segundos
    })
    expect(result.current.seconds).toBe(5)
  })

  it('se detiene cuando running es false (empleado en pausa)', () => {
    const { result } = renderHook(() => useTimer(10, false))
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    // En pausa: el contador no debe avanzar
    expect(result.current.seconds).toBe(10)
  })

  it('se reinicia si el backend envía un nuevo valor inicial', () => {
    const { result, rerender } = renderHook(
      ({ inicial }) => useTimer(inicial, true),
      { initialProps: { inicial: 0 } },
    )
    rerender({ inicial: 500 })
    expect(result.current.seconds).toBe(500)
  })
})
