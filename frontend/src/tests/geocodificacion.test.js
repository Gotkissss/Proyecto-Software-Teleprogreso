/**
 * tests/geocodificacion.test.js
 * ---------------------------------------------------------------------------
 * SCRUM-171/172 — Contrato de la capa de geocodificación (Nominatim).
 *
 * Lo que se fija aquí es lo que el mapa da por hecho: que el sesgo a Guatemala
 * y el idioma viajan en la consulta, que `lon` se traduce a `lng`, y que
 * "no encontré nada" devuelve null en vez de reventar la pantalla.
 * ---------------------------------------------------------------------------
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  buscarCoordenadas,
  buscarDireccion,
  debounce,
} from '../utils/geocodificacion'

/** Respuesta fetch mínima con el cuerpo JSON indicado. */
function respuesta(body, ok = true) {
  return { ok, json: async () => body }
}

/** URL de la última llamada a fetch, ya parseada. */
function ultimaUrl() {
  return new URL(global.fetch.mock.calls.at(-1)[0])
}

beforeEach(() => {
  global.fetch = vi.fn()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('buscarCoordenadas', () => {
  it('traduce lat/lon de Nominatim a { lat, lng } numéricos', async () => {
    global.fetch.mockResolvedValue(
      respuesta([{ lat: '14.6349', lon: '-90.5069', display_name: 'Zona 10' }])
    )

    const resultado = await buscarCoordenadas('Zona 10, Guatemala')

    expect(resultado).toEqual({
      lat: 14.6349,
      lng: -90.5069,
      etiqueta: 'Zona 10',
    })
  })

  it('sesga la búsqueda a Guatemala y pide resultados en español', async () => {
    global.fetch.mockResolvedValue(respuesta([]))

    await buscarCoordenadas('Calle 15')

    const url = ultimaUrl()
    expect(url.pathname).toBe('/search')
    expect(url.searchParams.get('countrycodes')).toBe('gt')
    expect(url.searchParams.get('accept-language')).toBe('es')
    expect(url.searchParams.get('limit')).toBe('1')
  })

  it('no consulta con textos demasiado cortos', async () => {
    expect(await buscarCoordenadas('z1')).toBeNull()
    expect(await buscarCoordenadas('   ')).toBeNull()
    expect(await buscarCoordenadas(null)).toBeNull()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('devuelve null cuando Nominatim no encuentra la dirección', async () => {
    global.fetch.mockResolvedValue(respuesta([]))
    expect(await buscarCoordenadas('dirección inexistente')).toBeNull()
  })

  it('devuelve null si las coordenadas no son numéricas', async () => {
    // Un NaN colado en el mapa deja el marcador en un limbo silencioso; es
    // preferible tratarlo como "no encontrado".
    global.fetch.mockResolvedValue(
      respuesta([{ lat: 'no-es-numero', lon: '-90.5', display_name: 'X' }])
    )
    expect(await buscarCoordenadas('Calle rara')).toBeNull()
  })

  it('lanza un error legible si el servicio responde mal', async () => {
    global.fetch.mockResolvedValue(respuesta(null, false))
    await expect(buscarCoordenadas('Zona 1')).rejects.toThrow(
      'No se pudo consultar el mapa.'
    )
  })
})

describe('buscarDireccion', () => {
  it('devuelve el display_name de la geocodificación inversa', async () => {
    global.fetch.mockResolvedValue(
      respuesta({ display_name: '5a Avenida, Zona 1, Guatemala' })
    )

    const texto = await buscarDireccion(14.6349, -90.5069)

    expect(texto).toBe('5a Avenida, Zona 1, Guatemala')
    const url = ultimaUrl()
    expect(url.pathname).toBe('/reverse')
    expect(url.searchParams.get('lat')).toBe('14.6349')
    expect(url.searchParams.get('lon')).toBe('-90.5069')
  })

  it('no consulta si falta alguna coordenada', async () => {
    expect(await buscarDireccion(null, -90.5)).toBeNull()
    expect(await buscarDireccion(14.6, null)).toBeNull()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('devuelve null si la respuesta no trae dirección', async () => {
    global.fetch.mockResolvedValue(respuesta({}))
    expect(await buscarDireccion(14.6349, -90.5069)).toBeNull()
  })
})

describe('debounce', () => {
  it('ejecuta una sola vez con el último valor tras la pausa', async () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const debounced = debounce(fn, 500)

    debounced('a')
    debounced('ab')
    debounced('abc')

    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(500)

    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('abc')
    vi.useRealTimers()
  })

  it('cancelar() evita la ejecución pendiente', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const debounced = debounce(fn, 500)

    debounced('algo')
    debounced.cancelar()
    vi.advanceTimersByTime(1000)

    expect(fn).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
