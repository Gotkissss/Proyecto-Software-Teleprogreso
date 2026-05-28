/**
 * api/asistenciaService.js
 * ---------------------------------------------------------------------------
 * Servicio para la pantalla "Pausas y Asistencia".
 *
 * Mapeo de endpoints reales:
 *   GET   /asistencia/hoy        → AsistenciaHoy
 *   POST  /asistencia/entrada    → registrar entrada
 *   POST  /asistencia/salida     → finalizar jornada
 *   POST  /descanso/iniciar      → iniciar pausa
 *   POST  /descanso/finalizar    → finalizar pausa activa
 *   GET   /descanso/tipos        → TipoPausa[] (configuración estática)
 * ---------------------------------------------------------------------------
 */

import apiClient from './client'

/**
 * Normaliza la respuesta de asistencia al formato que espera PausasPage.
 * Añade defaults para campos que el backend todavía no calcula (e.g. productividad).
 */
function normalizarAsistencia(data) {
  return {
    id_asistencia:            data.id_asistencia ?? null,
    fecha:                    data.fecha ?? new Date().toISOString().split('T')[0],
    hora_entrada:             data.hora_entrada ?? null,
    hora_salida:              data.hora_salida ?? null,
    tiempo_en_pausa_segundos: data.tiempo_en_pausa_segundos ?? 0,
    productividad_pct:        data.productividad_pct ?? 0,
  }
}

/**
 * Obtiene el estado de asistencia del día actual para el usuario autenticado.
 * Si no hay jornada hoy (404) devuelve un objeto vacío en lugar de lanzar error,
 * para que PausasPage muestre el botón "Registrar Entrada".
 */
export const getAsistenciaHoy = async () => {
  try {
    const { data } = await apiClient.get('/asistencia/hoy')
    return normalizarAsistencia(data)
  } catch (err) {
    if (err?.response?.status === 404) {
      // Sin jornada hoy → estado inicial limpio
      return normalizarAsistencia({})
    }
    throw err
  }
}

/**
 * Registra la entrada al inicio de la jornada.
 */
export const registrarEntrada = async () => {
  const { data } = await apiClient.post('/asistencia/entrada')
  return normalizarAsistencia(data)
}

/**
 * Inicia una pausa (el backend registra un descanso; el tipo se gestiona en frontend).
 *
 * @param {string} _tipoPausa - Ignorado por el backend actual; se reserva para futuro.
 */
export const iniciarPausa = async (_tipoPausa) => {
  const { data } = await apiClient.post('/descanso/iniciar')
  return data
}

/**
 * Finaliza la pausa activa actual.
 */
export const finalizarPausa = async () => {
  const { data } = await apiClient.post('/descanso/finalizar')
  return data
}

/**
 * Obtiene los tipos de pausa disponibles según la normativa.
 *
 * Response:
 * [
 *   { id: 'almuerzo', label: 'Pausa de Almuerzo', duracion_max_min: 60 },
 *   { id: 'tecnica',  label: 'Pausa Técnica (Soporte)', duracion_max_min: 15 },
 *   { id: 'personal', label: 'Pausa Personal', duracion_max_min: 10 },
 * ]
 */
export const getTiposPausa = async () => {
  const { data } = await apiClient.get('/descanso/tipos')
  return data
}

/**
 * Finaliza la jornada laboral del día (registra la hora de salida).
 */
export const finalizarJornada = async () => {
  const { data } = await apiClient.post('/asistencia/salida')
  return data
}
