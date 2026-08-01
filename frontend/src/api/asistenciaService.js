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
export const iniciarPausa = async (tipoPausa) => {
  // El tipo se manda al backend (columna `descanso.tipo`). Antes solo vivía en
  // el estado de React: al recargar se perdía qué pausa se había tomado y el
  // técnico podía repetir el almuerzo tantas veces como quisiera.
  const { data } = await apiClient.post('/descanso/iniciar', {
    tipo: tipoPausa ?? null,
  })
  return data
}

/**
 * Estado completo de pausas de la jornada de hoy.
 * Endpoint: GET /descanso/hoy
 *
 * Es la fuente única con la que PausasPage se reconstruye: cronómetro, pausa
 * en curso, historial y tipos ya consumidos vienen todos de aquí, así que
 * recargar o cerrar sesión no reinicia nada.
 *
 * @returns {Promise<{
 *   fecha: string, jornada_activa: boolean,
 *   hora_entrada: string|null, hora_salida: string|null,
 *   segundos_brutos: number, segundos_trabajados: number, segundos_en_pausa: number,
 *   pausa_activa: Object|null, tipos_usados: string[], descansos: Array
 * }>}
 */
export const getEstadoPausas = async () => {
  const { data } = await apiClient.get('/descanso/hoy')
  return {
    fecha:               data.fecha ?? new Date().toISOString().split('T')[0],
    id_asistencia:       data.id_asistencia ?? null,
    jornada_activa:      Boolean(data.jornada_activa),
    hora_entrada:        data.hora_entrada ?? null,
    hora_salida:         data.hora_salida ?? null,
    segundos_brutos:     data.segundos_brutos ?? 0,
    segundos_trabajados: data.segundos_trabajados ?? 0,
    segundos_en_pausa:   data.segundos_en_pausa ?? 0,
    pausa_activa:        data.pausa_activa ?? null,
    tipos_usados:        Array.isArray(data.tipos_usados) ? data.tipos_usados : [],
    descansos:           Array.isArray(data.descansos) ? data.descansos : [],
  }
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

/**
 * Historial de jornadas con horas trabajadas y tiempo en pausas.
 * Endpoint: GET /asistencia/historial
 *
 * @param {Object} filtros
 * @param {number} [filtros.empleado]      - ID del empleado (solo admin/supervisor/gerente)
 * @param {string} [filtros.fecha_inicio]  - YYYY-MM-DD, inclusive
 * @param {string} [filtros.fecha_fin]     - YYYY-MM-DD, inclusive
 * @param {number} [filtros.page]          - página (empieza en 1)
 * @param {number} [filtros.page_size]     - jornadas por página (1-100)
 *
 * @returns {Promise<{total:number,page:number,page_size:number,total_pages:number,
 *                    totales:Object,items:Array}>}
 */
export const getHistorialAsistencia = async (filtros = {}) => {
  // Se omiten los filtros vacíos para no mandar `?empleado=` y provocar un 422.
  const params = Object.fromEntries(
    Object.entries(filtros).filter(
      ([, v]) => v !== '' && v !== null && v !== undefined
    )
  )
  const { data } = await apiClient.get('/asistencia/historial', { params })
  return data
}

/**
 * Lista de empleados para el filtro del historial.
 * Devuelve [] si el rol no tiene permiso (el endpoint es solo-admin), para que
 * el supervisor siga viendo el historial completo aunque sin el selector.
 */
export const getEmpleadosParaFiltro = async () => {
  try {
    const { data } = await apiClient.get('/empleados')
    const lista = data?.empleados ?? data ?? []
    return (Array.isArray(lista) ? lista : []).map((e) => ({
      id_empleado: e.id_empleado,
      nombre_completo: `${e.nombre} ${e.apellido}`,
      rol: e.rol,
    }))
  } catch (err) {
    if (err?.response?.status === 403) return []
    throw err
  }
}
