/**
 * tests/useRefrescoAutomatico.test.jsx
 * ---------------------------------------------------------------------------
 * SCRUM-226 — Refresco automático cada X segundos, pausado si la pestaña
 * está en segundo plano.
 * ---------------------------------------------------------------------------
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useRefrescoAutomatico } from '../hooks/useRefrescoAutomatico'

/** Simula document.hidden (jsdom no deja asignarlo directo). */
function setDocumentHidden(hidden) {
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => hidden,
  })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('useRefrescoAutomatico', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setDocumentHidden(false)
  })

  afterEach(() => {
    vi.useRealTimers()
    // Se limpia el getter para no arrastrar el mock de un test a otro.
    delete document.hidden
  })

  it('llama al callback cada intervalMs mientras la pestaña está visible', () => {
    const callback = vi.fn()
    renderHook(() => useRefrescoAutomatico(callback, 1000))

    expect(callback).not.toHaveBeenCalled()

    vi.advanceTimersByTime(3000)

    expect(callback).toHaveBeenCalledTimes(3)
  })

  it('deja de llamar al callback en cuanto la pestaña pasa a segundo plano', () => {
    const callback = vi.fn()
    renderHook(() => useRefrescoAutomatico(callback, 1000))

    vi.advanceTimersByTime(2000)
    expect(callback).toHaveBeenCalledTimes(2)

    setDocumentHidden(true)
    vi.advanceTimersByTime(5000)

    // Ni un tick más mientras estuvo oculta.
    expect(callback).toHaveBeenCalledTimes(2)
  })

  it('al volver a primer plano refresca de inmediato y retoma el intervalo', () => {
    const callback = vi.fn()
    renderHook(() => useRefrescoAutomatico(callback, 1000))

    vi.advanceTimersByTime(1000)
    expect(callback).toHaveBeenCalledTimes(1)

    setDocumentHidden(true)
    vi.advanceTimersByTime(10000) // "minutos" en segundo plano, sin llamadas

    setDocumentHidden(false)
    // El refresco inmediato al recuperar el foco no espera al próximo tick.
    expect(callback).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(1000)
    expect(callback).toHaveBeenCalledTimes(3)
  })

  it('no arranca ningún intervalo si `activo` es false', () => {
    const callback = vi.fn()
    renderHook(() => useRefrescoAutomatico(callback, 1000, { activo: false }))

    vi.advanceTimersByTime(5000)

    expect(callback).not.toHaveBeenCalled()
  })

  it('usa siempre la versión más reciente del callback sin reiniciar el intervalo', () => {
    const primero = vi.fn()
    const segundo = vi.fn()

    const { rerender } = renderHook(
      ({ cb }) => useRefrescoAutomatico(cb, 1000),
      { initialProps: { cb: primero } }
    )

    vi.advanceTimersByTime(1000)
    expect(primero).toHaveBeenCalledTimes(1)

    rerender({ cb: segundo })

    vi.advanceTimersByTime(1000)
    // El intervalo sigue su cadencia normal: no se reinicia por el rerender,
    // pero el tick ya usa la función nueva.
    expect(primero).toHaveBeenCalledTimes(1)
    expect(segundo).toHaveBeenCalledTimes(1)
  })

  it('limpia el intervalo y el listener al desmontar', () => {
    const callback = vi.fn()
    const removeSpy = vi.spyOn(document, 'removeEventListener')

    const { unmount } = renderHook(() => useRefrescoAutomatico(callback, 1000))
    unmount()

    vi.advanceTimersByTime(5000)

    expect(callback).not.toHaveBeenCalled()
    expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function))

    removeSpy.mockRestore()
  })
})