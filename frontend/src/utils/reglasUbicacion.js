/**
 * utils/reglasUbicacion.js
 * ---------------------------------------------------------------------------
 * HU-5 — Cuándo se guarda un punto del recorrido del técnico.
 *
 * watchPosition entrega una lectura cada pocos segundos. Guardarlas todas
 * llenaría la tabla de ruido y gastaría batería y datos, así que cada lectura
 * pasa por estas reglas (acordadas con el equipo para el recorrido):
 *
 *   1. Precisión peor que PRECISION_MAXIMA_M → se descarta. En interiores el
 *      GPS "salta" cientos de metros y el recorrido saldría en zigzag.
 *   2. La primera lectura válida de la jornada se guarda siempre.
 *   3. Si el técnico se movió al menos DISTANCIA_MINIMA_M desde el último
 *      punto guardado, se guarda como máximo uno cada INTERVALO_MOVIMIENTO_MS.
 *   4. Si está quieto, se guarda un punto de control cada INTERVALO_QUIETO_MS
 *      para dejar constancia de que sigue ahí.
 *
 * El backend marca como "sin datos" los tramos de más de 10 min entre puntos
 * (MINUTOS_HUECO_RECORRIDO): el doble del punto de control de un técnico
 * quieto, para que estar parado no se confunda con un hueco.
 * ---------------------------------------------------------------------------
 */

export const INTERVALO_MOVIMIENTO_MS = 2 * 60 * 1000
export const INTERVALO_QUIETO_MS = 5 * 60 * 1000
export const DISTANCIA_MINIMA_M = 30
export const PRECISION_MAXIMA_M = 100

const RADIO_TIERRA_M = 6371000

/** Distancia en metros entre dos puntos {lat, lng} (fórmula de haversine). */
export function distanciaMetros(a, b) {
  const rad = (grados) => (grados * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * RADIO_TIERRA_M * Math.asin(Math.sqrt(h))
}

/**
 * ¿Hay que guardar esta lectura?
 *
 * @param {{lat:number, lng:number, t:number}|null} ultimo - último punto guardado
 * @param {{lat:number, lng:number, accuracy?:number}} lectura - lectura nueva
 * @param {number} ahoraMs - momento actual (Date.now())
 */
export function debeReportar(ultimo, lectura, ahoraMs) {
  if (Number.isFinite(lectura.accuracy) && lectura.accuracy > PRECISION_MAXIMA_M) {
    return false
  }
  if (!ultimo) return true

  const transcurrido = ahoraMs - ultimo.t
  if (transcurrido >= INTERVALO_QUIETO_MS) return true
  return (
    transcurrido >= INTERVALO_MOVIMIENTO_MS &&
    distanciaMetros(ultimo, lectura) >= DISTANCIA_MINIMA_M
  )
}
