/**
 * utils/colaUbicaciones.js
 * ---------------------------------------------------------------------------
 * HU-5 — Cola de puntos del recorrido tomados sin conexión.
 *
 * En campo hay zonas sin señal. Cuando un punto no se puede enviar por falta
 * de red, se guarda aquí con la hora real de la lectura y se manda en lote
 * (POST /ubicaciones/lote) al recuperar la conexión. El backend descarta los
 * que caen fuera de la jornada, los futuros y los repetidos, así que reenviar
 * un lote cuya respuesta se perdió no duplica nada.
 *
 * Se guarda en localStorage para sobrevivir a una recarga de la app, con una
 * clave por empleado: si otro técnico inicia sesión en el mismo teléfono, sus
 * puntos no se mezclan con los del anterior (el backend atribuye cada lote al
 * dueño del token).
 *
 * La cola solo existe mientras la app está abierta: con el teléfono bloqueado
 * o la app cerrada el navegador no entrega lecturas y no hay nada que encolar.
 * ---------------------------------------------------------------------------
 */
import { enviarLote } from '../api/ubicacionService'

/** Igual que MAX_PUNTOS_LOTE del backend: tope de la cola y de cada envío. */
export const MAX_PUNTOS_COLA = 500

const clave = (idEmpleado) => `teleprogreso.colaUbicaciones.${idEmpleado}`

// Evita dos envíos simultáneos del mismo empleado (p. ej. el evento 'online'
// y un reporte exitoso llegando a la vez), que mandarían los mismos puntos.
const enviando = new Set()

export function leerCola(idEmpleado) {
  if (idEmpleado == null) return []
  try {
    const guardada = JSON.parse(localStorage.getItem(clave(idEmpleado)) ?? '[]')
    return Array.isArray(guardada) ? guardada : []
  } catch {
    return []
  }
}

function guardarCola(idEmpleado, cola) {
  try {
    if (cola.length === 0) localStorage.removeItem(clave(idEmpleado))
    else localStorage.setItem(clave(idEmpleado), JSON.stringify(cola))
  } catch {
    // Almacenamiento lleno o bloqueado: se pierde la cola, no la app.
  }
}

/**
 * Agrega un punto {lat, lng, fecha_hora (ISO)} a la cola. Si se llena, se
 * descartan los más viejos: un hueco al principio del día pesa menos que
 * perder la posición más reciente.
 */
export function encolarPunto(idEmpleado, punto) {
  if (idEmpleado == null) return
  const cola = [...leerCola(idEmpleado), punto]
  guardarCola(idEmpleado, cola.slice(-MAX_PUNTOS_COLA))
}

/**
 * Envía la cola pendiente. Nunca rechaza.
 *
 *  - Éxito: se quitan los puntos enviados (los que el backend descartó
 *    también: ya los evaluó).
 *  - Error del servidor con respuesta (4xx/5xx): se quitan igual, para no
 *    reenviar para siempre un lote que el backend no acepta.
 *  - Sin red o sesión vencida (401): se conservan y se reintenta en la
 *    próxima oportunidad.
 *
 * @returns {Promise<number>} cuántos puntos salieron de la cola
 */
export async function enviarCola(idEmpleado) {
  if (idEmpleado == null || enviando.has(idEmpleado)) return 0
  const lote = leerCola(idEmpleado).slice(0, MAX_PUNTOS_COLA)
  if (lote.length === 0) return 0

  enviando.add(idEmpleado)
  try {
    await enviarLote(lote)
  } catch (err) {
    if (!err?.response || err.response.status === 401) return 0
  } finally {
    enviando.delete(idEmpleado)
  }
  // Se relee: mientras el lote viajaba pudieron entrar puntos nuevos al final.
  guardarCola(idEmpleado, leerCola(idEmpleado).slice(lote.length))
  return lote.length
}
