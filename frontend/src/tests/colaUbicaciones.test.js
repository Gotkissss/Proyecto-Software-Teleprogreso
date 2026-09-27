/**
 * tests/colaUbicaciones.test.js
 * ---------------------------------------------------------------------------
 * HU-5 — Cola de puntos tomados sin conexión.
 *
 * Lo que no puede fallar: sin red los puntos se conservan (con su hora real)
 * y se envían al reconectar; si el servidor ya los evaluó, salen de la cola
 * para no reenviarlos para siempre; y la cola de un técnico no se mezcla con
 * la de otro que use el mismo teléfono.
 * ---------------------------------------------------------------------------
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { enviarLoteMock } = vi.hoisted(() => ({ enviarLoteMock: vi.fn() }))

vi.mock('../api/ubicacionService', () => ({ enviarLote: enviarLoteMock }))

import {
  MAX_PUNTOS_COLA,
  encolarPunto,
  enviarCola,
  leerCola,
} from '../utils/colaUbicaciones'

const punto = (minuto) => ({
  lat: 14.47,
  lng: -90.44,
  fecha_hora: `2026-09-23T15:${String(minuto).padStart(2, '0')}:00.000Z`,
})

beforeEach(() => {
  localStorage.clear()
  enviarLoteMock.mockReset()
})

describe('colaUbicaciones', () => {
  it('guarda los puntos con su hora y por empleado', () => {
    encolarPunto(2, punto(1))
    encolarPunto(2, punto(2))
    encolarPunto(3, punto(5))

    expect(leerCola(2)).toEqual([punto(1), punto(2)])
    expect(leerCola(3)).toEqual([punto(5)])
  })

  it('sin empleado no encola nada', () => {
    encolarPunto(null, punto(1))

    expect(leerCola(null)).toEqual([])
  })

  it('al llenarse descarta los más viejos', () => {
    for (let i = 0; i < MAX_PUNTOS_COLA + 2; i += 1) {
      encolarPunto(2, { ...punto(0), lat: i })
    }

    const cola = leerCola(2)
    expect(cola).toHaveLength(MAX_PUNTOS_COLA)
    expect(cola[0].lat).toBe(2)
  })

  it('al enviar con éxito vacía la cola', async () => {
    enviarLoteMock.mockResolvedValue({ guardados: 2, descartados: 0 })
    encolarPunto(2, punto(1))
    encolarPunto(2, punto(2))

    const enviados = await enviarCola(2)

    expect(enviarLoteMock).toHaveBeenCalledWith([punto(1), punto(2)])
    expect(enviados).toBe(2)
    expect(leerCola(2)).toEqual([])
  })

  it('sin red conserva los puntos para el próximo intento', async () => {
    enviarLoteMock.mockRejectedValue(new Error('Network Error'))
    encolarPunto(2, punto(1))

    expect(await enviarCola(2)).toBe(0)
    expect(leerCola(2)).toEqual([punto(1)])
  })

  it('con la sesión vencida (401) tampoco los pierde', async () => {
    enviarLoteMock.mockRejectedValue({ response: { status: 401 } })
    encolarPunto(2, punto(1))

    await enviarCola(2)

    expect(leerCola(2)).toEqual([punto(1)])
  })

  it('si el servidor rechaza el lote, no lo reenvía para siempre', async () => {
    enviarLoteMock.mockRejectedValue({ response: { status: 422 } })
    encolarPunto(2, punto(1))

    await enviarCola(2)

    expect(leerCola(2)).toEqual([])
  })

  it('no pierde los puntos que llegan mientras el lote viaja', async () => {
    let resolver
    enviarLoteMock.mockImplementation(() => new Promise((r) => { resolver = r }))
    encolarPunto(2, punto(1))

    const envio = enviarCola(2)
    encolarPunto(2, punto(2))
    resolver({ guardados: 1, descartados: 0 })
    await envio

    expect(leerCola(2)).toEqual([punto(2)])
  })

  it('con la cola vacía no llama al backend', async () => {
    expect(await enviarCola(2)).toBe(0)
    expect(enviarLoteMock).not.toHaveBeenCalled()
  })
})
