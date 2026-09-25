/**
 * api/ubicacionService.js
 * ---------------------------------------------------------------------------
 * SCRUM-218 — Reporte de la ubicación del técnico mientras está en jornada.
 *
 * Mapeo de endpoints reales:
 *   POST /ubicaciones          → guarda la posición actual del empleado autenticado
 *   GET  /ubicaciones/tecnicos → última posición de cada técnico en jornada
 *                                (solo admin/supervisor/gerente)
 *
 * El empleado dueño de la ubicación nunca viaja en el cuerpo: el backend lo
 * saca del JWT que el interceptor de client.js ya adjunta en cada petición.
 * Mandarlo desde aquí no serviría de nada y abriría la puerta a que alguien
 * intentara reportar posiciones a nombre de un compañero.
 * ---------------------------------------------------------------------------
 */

import apiClient from './client'

/**
 * Registra la posición actual del técnico autenticado.
 *
 * El 409 no se trata como una excepción sino como un resultado: "no hay
 * jornada abierta" es un estado normal de la aplicación (el técnico todavía
 * no marcó entrada, o ya marcó salida), no una falla. Se devuelve entonces un
 * objeto que el hook puede leer sin envolver la llamada en su propio try, el
 * mismo criterio que usa getAsistenciaHoy con su 404.
 *
 * Los demás errores sí se relanzan. Un 401 tiene que llegar al interceptor
 * que cierra la sesión, y un 422 o un 500 son fallas de verdad: taparlas aquí
 * dejaría al técnico creyendo que su ubicación se está registrando.
 *
 * @param {Object} coordenadas
 * @param {number} coordenadas.lat - Latitud en grados decimales (-90 a 90).
 * @param {number} coordenadas.lng - Longitud en grados decimales (-180 a 180).
 *
 * @returns {Promise<{
 *   ok: boolean,
 *   motivo?: string,
 *   mensaje?: string,
 *   id_ubicacion?: number,
 *   fecha_hora_registro?: string
 * }>}
 */
export const enviarUbicacion = async ({ lat, lng }) => {
  try {
    const { data } = await apiClient.post('/ubicaciones', { lat, lng })
    return { ok: true, ...data }
  } catch (err) {
    if (err?.response?.status === 409) {
      return {
        ok: false,
        motivo: 'sin_jornada',
        mensaje:
          err.response?.data?.detail ??
          'No tienes una jornada abierta. Registra tu entrada antes de reportar tu ubicación.',
      }
    }
    throw err
  }
}

/**
 * SCRUM-225 — Última posición conocida de cada técnico que tiene jornada
 * abierta ahora mismo. La usa el mapa del supervisor para pintar dónde está
 * cada técnico en vivo, además de los pines de tareas.
 *
 * Solo trae técnicos EN JORNADA: un técnico que ya marcó salida, o que
 * todavía no marcó entrada, no aparece en la respuesta (así lo resuelve
 * GET /ubicaciones/tecnicos en el backend), así que no hace falta filtrar
 * nada más aquí.
 *
 * @returns {Promise<Array<{
 *   id_empleado: number,
 *   nombre: string,
 *   lat: number,
 *   lng: number,
 *   fecha_hora_registro: string,
 *   estado: 'en_tarea' | 'en_pausa' | 'disponible'
 * }>>}
 */
export async function getUbicacionesTecnicos() {
  const { data } = await apiClient.get('/ubicaciones/tecnicos')
  return Array.isArray(data) ? data : []
}