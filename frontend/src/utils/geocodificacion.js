/**
 * utils/geocodificacion.js
 * ---------------------------------------------------------------------------
 * SCRUM-171/172 — Geocodificación con Nominatim (OpenStreetMap): sin costo y
 * sin API key, el mismo proveedor de los tiles que ya usa MapaBase.jsx.
 *
 *  - buscarCoordenadas(direccion): texto → { lat, lng, etiqueta }
 *  - buscarDireccion(lat, lng):    coordenadas → texto de dirección
 *
 * Nominatim pide como buena práctica no más de 1 solicitud por segundo, así
 * que quien llame a estas funciones desde un input de texto debe pasar por
 * `debounce()` (exportado aquí) en vez de disparar una petición por tecla.
 *
 * Ambas funciones aceptan un AbortSignal opcional para que el componente
 * pueda cancelar la consulta al desmontarse; sin eso, una respuesta lenta
 * llega después del unmount e intenta escribir estado sobre un componente
 * que ya no existe.
 * ---------------------------------------------------------------------------
 */

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org'

// Sesgo geográfico: Teleprogreso opera en Guatemala. Sin esto, "Zona 10"
// devuelve resultados de media Latinoamérica.
const PAIS = 'gt'

// Los resultados vienen en el idioma que se pida, no en el del navegador.
const IDIOMA = 'es'

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

/** Lanza la petición y devuelve el JSON, con el error ya normalizado. */
async function consultar(ruta, params, signal) {
  const respuesta = await fetch(`${NOMINATIM_BASE}${ruta}?${params}`, {
    headers: { Accept: 'application/json' },
    signal,
  })

  if (!respuesta.ok) throw new Error('No se pudo consultar el mapa.')

  return respuesta.json()
}

/**
 * Geocodificación directa: texto → coordenadas.
 *
 * @param {string} direccion
 * @param {AbortSignal} [signal]
 * @returns {Promise<{lat:number, lng:number, etiqueta:string}|null>}
 */
export async function buscarCoordenadas(direccion, signal) {
  const texto = (direccion ?? '').trim()
  if (texto.length < 3) return null

  const params = new URLSearchParams({
    q: texto,
    format: 'jsonv2',
    countrycodes: PAIS,
    'accept-language': IDIOMA,
    limit: '1',
  })

  const resultados = await consultar('/search', params, signal)
  if (!Array.isArray(resultados) || resultados.length === 0) return null

  const [mejor] = resultados
  const lat = Number(mejor.lat)
  const lng = Number(mejor.lon)

  // Nominatim manda lat/lon como strings; si alguno no es número, es mejor
  // tratarlo como "no encontrado" que plantar un NaN en el mapa.
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null

  return { lat, lng, etiqueta: mejor.display_name }
}

/**
 * Geocodificación inversa: coordenadas → dirección legible.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {AbortSignal} [signal]
 * @returns {Promise<string|null>}
 */
export async function buscarDireccion(lat, lng, signal) {
  if (lat == null || lng == null) return null

  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lng),
    format: 'jsonv2',
    'accept-language': IDIOMA,
  })

  const resultado = await consultar('/reverse', params, signal)
  return resultado?.display_name ?? null
}
