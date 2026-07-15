/**
 * api/alertaService.js
 * ---------------------------------------------------------------------------
 * Deriva alertas operativas a partir de los datos reales de GET /tareas.
 * No existe un endpoint /alertas en el backend — las alertas se calculan
 * en el cliente según reglas de negocio sobre el estado de las tareas.
 *
 * Reglas de alerta implementadas:
 *   CRÍTICO  - Tarea sin asignar hace > 60 min
 *   CRÍTICO  - Tarea pendiente/en_progreso hace > 3 horas sin avance
 *   ADVERTENCIA - Tarea sin asignar (reciente, < 60 min)
 *   ADVERTENCIA - Tarea en progreso hace > 4 horas
 * ---------------------------------------------------------------------------
 */

import apiClient from './client'

const CRITICO_SIN_ASIGNAR_MIN  = 60   // minutos sin asignar → crítico
const CRITICO_RETRASO_HORAS    = 3    // horas pendiente con técnico → crítico
const ADVERTENCIA_EN_PROG_HORAS = 4   // horas en progreso → advertencia

/**
 * Calcula cuántos minutos han pasado desde `fechaStr`.
 * @param {string|null} fechaStr - ISO date string
 * @returns {number} minutos transcurridos (0 si no hay fecha)
 */
function minutosDesde(fechaStr) {
  if (!fechaStr) return 0
  const diff = Date.now() - new Date(fechaStr).getTime()
  return Math.max(0, Math.floor(diff / 60000))
}

/**
 * Obtiene tareas del servidor y deriva alertas operativas.
 * El array resultante tiene la misma forma que esperaba el mock:
 *   { id, nivel, mensaje, tecnico, tarea, fecha_hora, resuelta }
 */
export async function getAlertas() {
  const { data: tareas } = await apiClient.get('/tareas')

  const alertas = []

  for (const tarea of tareas) {
    const mins    = minutosDesde(tarea.fecha_asignacion)
    const tecnico = tarea.tecnico
      ? { nombre_completo: tarea.tecnico.nombre }
      : null
    const tareaRef = { titulo: tarea.titulo }

    // ── Sin asignar ───────────────────────────────────────────────────────
    if (tarea.estado_tarea === 'pendiente' && !tarea.tecnico) {
      const nivel   = mins >= CRITICO_SIN_ASIGNAR_MIN ? 'critico' : 'advertencia'
      const horasStr = mins >= 60
        ? `${Math.floor(mins / 60)}h ${mins % 60}min`
        : `${mins} min`
      alertas.push({
        id:         `sin-asignar-${tarea.id_tarea}`,
        nivel,
        mensaje:    `Tarea sin asignar hace ${horasStr}`,
        tecnico:    null,
        tarea:      tareaRef,
        fecha_hora: tarea.fecha_asignacion ?? new Date().toISOString(),
        resuelta:   false,
        _id_tarea:  tarea.id_tarea,
      })
      continue  // una sola alerta por tarea
    }

    // ── Pendiente con técnico pero demorada ───────────────────────────────
    if (tarea.estado_tarea === 'pendiente' && tarea.tecnico) {
      const horas = mins / 60
      if (horas >= CRITICO_RETRASO_HORAS) {
        alertas.push({
          id:        `retraso-${tarea.id_tarea}`,
          nivel:     'critico',
          mensaje:   `Tarea pendiente con más de ${Math.floor(horas)}h sin iniciar`,
          tecnico,
          tarea:     tareaRef,
          fecha_hora: tarea.fecha_asignacion ?? new Date().toISOString(),
          resuelta:   false,
          _id_tarea:  tarea.id_tarea,
        })
      }
    }

    // ── En progreso prolongado ─────────────────────────────────────────────
    if (tarea.estado_tarea === 'en_progreso') {
      const horas = mins / 60
      if (horas >= ADVERTENCIA_EN_PROG_HORAS) {
        alertas.push({
          id:        `en-progreso-${tarea.id_tarea}`,
          nivel:     horas >= CRITICO_RETRASO_HORAS * 2 ? 'critico' : 'advertencia',
          mensaje:   `Tarea en progreso hace más de ${Math.floor(horas)}h`,
          tecnico,
          tarea:     tareaRef,
          fecha_hora: tarea.fecha_asignacion ?? new Date().toISOString(),
          resuelta:   false,
          _id_tarea:  tarea.id_tarea,
        })
      }
    }
  }

  // Ordenar: críticos primero, luego por fecha más reciente
  alertas.sort((a, b) => {
    if (a.nivel === b.nivel) {
      return new Date(b.fecha_hora) - new Date(a.fecha_hora)
    }
    return a.nivel === 'critico' ? -1 : 1
  })

  return alertas
}

/**
 * "Resolver" una alerta derivada: no tiene efecto en el backend porque las
 * alertas son calculadas en tiempo real. El componente ya las filtra del estado local.
 */
export async function resolverAlerta(_id) {
  // No-op: las alertas son efímeras (derivadas de tareas).
  // El componente elimina la alerta del estado local después de este await.
  return { ok: true }
}

/**
 * Obtiene métricas del dashboard del supervisor.
 */
export async function getMetricas() {
  const { data } = await apiClient.get('/metricas/supervisor')
  return data
}

/**
 * Obtiene la lista de técnicos con su estado actual.
 */
export async function getTecnicos() {
  const { data } = await apiClient.get('/empleados?rol=tecnico')
  return data
}
