/**
 * utils/navegacion.js
 * ---------------------------------------------------------------------------
 * HU-3 — Ruta diaria por cercanía y navegación.
 *
 *  - formatearDistancia(metros): 2400 → "a 2.4 km", 350 → "a 350 m"
 *  - urlGoogleMaps(lat, lng):    enlace de indicaciones hasta la coordenada
 *  - urlWaze(lat, lng):          enlace de navegación de Waze a la coordenada
 *
 * Se usan enlaces universales (https) y no esquemas propios como `geo:`: en
 * Android e iOS abren la app instalada y, si no está, caen al navegador; en
 * escritorio siguen funcionando. `geo:` no hace nada en escritorio y es poco
 * fiable en iOS.
 * ---------------------------------------------------------------------------
 */

/**
 * Texto corto de distancia para la tarjeta de la ruta.
 * Devuelve null si no hay distancia (sin GPS o tarea sin coordenada), para
 * que la pantalla no muestre una distancia inventada.
 *
 * @param {number|null|undefined} metros
 * @returns {string|null}
 */
export function formatearDistancia(metros) {
  if (metros === null || metros === undefined || !Number.isFinite(metros)) {
    return null
  }
  if (metros < 1000) {
    // Por debajo de 10 m la precisión del GPS no da para más detalle.
    return `a ${Math.max(10, Math.round(metros / 10) * 10)} m`
  }
  return `a ${(metros / 1000).toFixed(1)} km`
}

function tieneCoordenadas(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng)
}

/**
 * Indicaciones en Google Maps desde la ubicación actual hasta la coordenada.
 * @returns {string|null} null si la tarea no tiene coordenada
 */
export function urlGoogleMaps(lat, lng) {
  if (!tieneCoordenadas(lat, lng)) return null
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
}

/**
 * Navegación en Waze hasta la coordenada.
 * @returns {string|null} null si la tarea no tiene coordenada
 */
export function urlWaze(lat, lng) {
  if (!tieneCoordenadas(lat, lng)) return null
  return `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`
}
