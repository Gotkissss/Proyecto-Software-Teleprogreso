/**
 * utils/geocodificacion.js
 * ---------------------------------------------------------------------------
 * Geocodificación con Nominatim (OpenStreetMap) — sin costo, sin API key,
 * igual que los tiles que ya usa MapaBase.jsx.
 *
 *  - buscarCoordenadas(direccion): texto → { lat, lng, etiqueta }
 *  - buscarDireccion(lat, lng):    coordenadas → texto de dirección
 *
 * Nominatim pide como buena práctica no más de 1 solicitud/segundo; por eso
 * quien llame a estas funciones desde un input de texto debe pasar por
 * `debounce()` (exportado aquí) en vez de disparar una petición por tecla.
 * ---------------------------------------------------------------------------
 */

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org'

// Sesgo geográfico: Teleprogreso opera en Guatemala.
const PAIS = 'gt'

/** Retrasa la ejecución de `fn` hasta que pasen `ms` sin nuevas llamadas. */
export function debounce(fn, ms = 600) {
  let temporizador = null
  const debounced = (...args) => {
    clearTimeout(temporizador)
    temporizador = setTimeout(() => fn(...args), ms)
  }
  debounced.cancelar = () => clearTimeout(temporizador)
  return debounced
}

/**
 * Geocodificación directa: texto → coordenadas.
 * @returns {Promise<{lat:number, lng:number, etiqueta:string}|null>}
 */
export async function buscarCoordenadas(direccion) {
  const texto = (direccion ?? '').trim()
  if (texto.length < 3) return null

  const params = new URLSearchParams({
    q: texto,
    format: 'jsonv2',
    countrycodes: PAIS,
    limit: '1',
  })

  const respuesta = await fetch(`${NOMINATIM_BASE}/search?${params}`, {
    headers: { Accept: 'application/json' },
  })
  if (!respuesta.ok) throw new Error('No se pudo consultar el mapa.')

  const resultados = await respuesta.json()
  if (!Array.isArray(resultados) || resultados.length === 0) return null

  const [mejor] = resultados
  return { lat: Number(mejor.lat), lng: Number(mejor.lon), etiqueta: mejor.display_name }
}

/**
 * Geocodificación inversa: coordenadas → dirección legible.
 * @returns {Promise<string|null>}
 */
export async function buscarDireccion(lat, lng) {
  if (lat == null || lng == null) return null

  const params = new URLSearchParams({ lat: String(lat), lon: String(lng), format: 'jsonv2' })

  const respuesta = await fetch(`${NOMINATIM_BASE}/reverse?${params}`, {
    headers: { Accept: 'application/json' },
  })
  if (!respuesta.ok) throw new Error('No se pudo consultar el mapa.')

  const resultado = await respuesta.json()
  return resultado?.display_name ?? null
}