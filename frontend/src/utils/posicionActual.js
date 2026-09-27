/**
 * utils/posicionActual.js
 * ---------------------------------------------------------------------------
 * HU-4 — Posición del técnico en el momento de marcar entrada o salida.
 *
 * Se pide una lectura NUEVA al GPS (maximumAge: 0) porque la marca tiene que
 * dejar constancia de dónde estaba el técnico al pulsar el botón, no de dónde
 * estuvo hace un rato. Como la marca nunca debe bloquearse por el GPS, hay un
 * tope de tiempo y un respaldo:
 *
 *   1. Lectura nueva dentro de `timeoutMs`           → esa posición.
 *   2. Si falla, tarda o no hay soporte              → `respaldo` (la última
 *      posición conocida de UbicacionContext), si existe.
 *   3. Si tampoco hay respaldo                       → null: la marca se
 *      registra "sin ubicación" y el supervisor la ve señalada.
 *
 * El tope es doble a propósito: la opción `timeout` de la Geolocation API no
 * cuenta el tiempo que el navegador espera a que el usuario responda al aviso
 * de permiso, así que sin el temporizador propio el botón podría quedarse
 * esperando indefinidamente.
 * ---------------------------------------------------------------------------
 */

export const TIMEOUT_POSICION_MS = 8000

function aCoordenadas(posicion) {
  const lat = posicion?.lat ?? posicion?.coords?.latitude
  const lng = posicion?.lng ?? posicion?.coords?.longitude
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null
}

/**
 * @param {Object} [opciones]
 * @param {{lat:number, lng:number}|null} [opciones.respaldo] - última posición conocida
 * @param {number} [opciones.timeoutMs] - tiempo máximo de espera
 * @returns {Promise<{lat:number, lng:number}|null>} nunca rechaza
 */
export function obtenerPosicionActual({
  respaldo = null,
  timeoutMs = TIMEOUT_POSICION_MS,
} = {}) {
  const posicionRespaldo = aCoordenadas(respaldo)

  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve(posicionRespaldo)
  }

  return new Promise((resolve) => {
    let resuelto = false
    const terminar = (valor) => {
      if (resuelto) return
      resuelto = true
      clearTimeout(temporizador)
      resolve(valor)
    }

    const temporizador = setTimeout(() => terminar(posicionRespaldo), timeoutMs)

    navigator.geolocation.getCurrentPosition(
      (pos) => terminar(aCoordenadas(pos) ?? posicionRespaldo),
      () => terminar(posicionRespaldo),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    )
  })
}
