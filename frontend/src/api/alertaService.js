/**
 * api/alertaService.js
 * ---------------------------------------------------------------------------
 * Cliente del módulo de alertas persistentes del supervisor.
 * Consume directamente el backend real (GET/PATCH /alertas): la generación
 * de alertas (tareas vencidas, técnicos sin entrada, stock crítico) ocurre
 * en el servidor (app/services/alertas.py), no en el frontend.
 * ---------------------------------------------------------------------------
 */

import apiClient from './client'

/** Estados posibles de una alerta persistida (coincide con schemas.alerta.EstadoAlerta) */
export const ESTADO_ALERTA = {
  PENDIENTE: 'pendiente',
  ATENDIDA: 'atendida',
  DESCARTADA: 'descartada',
  // La pone el backend solo, cuando la causa del aviso desaparece (la tarea
  // se cerró, el material se repuso, el técnico marcó entrada). No es una
  // acción del supervisor: por eso no hay botón que la produzca.
  RESUELTA: 'resuelta',
}

/** Tipos de alerta que puede generar el backend (services/alertas.py) */
export const TIPO_ALERTA = {
  TAREA_VENCIDA: 'tarea_vencida',
  TECNICO_SIN_ENTRADA: 'tecnico_sin_entrada',
  STOCK_CRITICO: 'stock_critico',
}

/**
 * Lista alertas persistentes desde el backend.
 * @param {Object} filtros - { tipo?, severidad?, estado?, generar? }
 *   (query params soportados por GET /alertas)
 */
export async function getAlertas(filtros = {}) {
  const { data } = await apiClient.get('/alertas', { params: filtros })
  return Array.isArray(data) ? data : []
}

/**
 * Atajo para obtener solo las alertas pendientes (no atendidas ni descartadas).
 */
export async function getAlertasPendientes() {
  return getAlertas({ estado: ESTADO_ALERTA.PENDIENTE })
}

/**
 * Convierte un error de axios en un mensaje legible para el usuario.
 * Distingue 403 (rol sin permiso), 500 y errores de red, porque antes todos
 * se mostraban como "No se pudieron cargar las alertas" y no había forma de
 * saber qué estaba fallando realmente.
 */
export function describirErrorAlertas(err) {
  const status = err?.response?.status
  const detail = err?.response?.data?.detail

  if (!err?.response) {
    return 'No se pudo contactar al servidor. Revisa tu conexión e inténtalo de nuevo.'
  }
  if (status === 403) {
    return detail || 'Tu rol no tiene permiso para ver las alertas del sistema.'
  }
  if (status === 500) {
    return detail || 'El servidor falló al generar las alertas. Inténtalo de nuevo.'
  }
  return detail || `No se pudieron cargar las alertas (error ${status}).`
}

/**
 * Actualiza el estado de una alerta (atender o descartar).
 * @param {number} idAlerta
 * @param {'atendida'|'descartada'} estado
 */
export async function actualizarEstadoAlerta(idAlerta, estado) {
  const { data } = await apiClient.patch(`/alertas/${idAlerta}`, { estado })
  return data
}

/**
 * Obtiene métricas del dashboard del supervisor.
 */
export async function getMetricas() {
  const { data } = await apiClient.get('/metricas/supervisor')
  return data
}

// Aquí vivía `getTecnicos()`, que pedía la lista a `/empleados?rol=tecnico`
// (gestión de personal, restringida a admin y supervisor). No la llamaba nadie
// y era una trampa para el siguiente que necesitara técnicos: lo correcto es
// `getTecnicosDisponibles()` de api/tareaService, que además trae la carga de
// trabajo de cada uno y devuelve lo mismo en todas las pantallas.