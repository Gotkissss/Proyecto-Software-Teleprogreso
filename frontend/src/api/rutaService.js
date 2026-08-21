/**
 * api/rutaService.js
 * ---------------------------------------------------------------------------
 * Servicio para la pantalla "Mi Ruta Diaria" del técnico.
 *
 * No existe un endpoint /servicios/mi-ruta en el backend.
 * Las tareas del técnico se obtienen de GET /tareas?id_tecnico={id}
 * y se transforman al formato que espera RutaDiariaPage.
 *
 * Mapeo de tareas → servicios:
 *   tarea.id_tarea          → servicio.id_servicio
 *   tarea.estado_tarea      → servicio.estado
 *   tarea.prioridad         → servicio.prioridad
 *   tarea.titulo            → servicio.nombre
 *   tarea.direccion_servicio → servicio.direccion
 *   tarea.descripcion       → servicio.tipo (simplificado)
 * ---------------------------------------------------------------------------
 */

import apiClient from './client'
import { esDelDia, hoyISO } from '../utils/fecha'

/**
 * Obtiene la ruta diaria del técnico autenticado.
 *
 * @param {number} idTecnico - ID del empleado autenticado (de useAuth)
 * @returns {{ fecha, tecnico, alerta, servicios }}
 */
export const getMiRuta = async (idTecnico) => {
  // Fetch tareas del técnico (incluye pendientes y en_progreso del día)
  const params = {}
  if (idTecnico) params.id_tecnico = idTecnico

  const { data: tareas } = await apiClient.get('/tareas', { params })

  // Mapear cada tarea al formato de "servicio" que espera la UI
  const servicios = tareas
    .map((t) => ({
      id_servicio:      t.id_tarea,
      estado:           t.estado_tarea,          // pendiente | en_progreso | completado | cancelado
      prioridad:        t.prioridad ?? 'media',  // urgente | alta | media | baja
      nombre:           t.titulo,
      direccion:        t.direccion_servicio ?? 'Dirección no especificada',
      tipo:             _inferirTipo(t.titulo, t.descripcion),
      fecha_completado: t.fecha_completado ?? null,
      total_incidencias: t.total_incidencias ?? 0,
      // Fecha límite: la pantalla la usa para avisar al técnico de lo que
      // vence hoy o ya venció, en vez de dejarle deducirlo de la lista.
      fecha_finalizacion: t.fecha_finalizacion ?? null,
      estado_tarea: t.estado_tarea,
    }))
    // La ruta del día es eso: el día. Se muestran todas las tareas abiertas
    // más las que el técnico cerró hoy (para que vea su avance), pero no el
    // histórico completo: antes la lista arrastraba todas las tareas que le
    // habían asignado alguna vez y parecía "quemada".
    .filter((s) => esTareaDeHoy(s))

  // Calcular alerta si hay urgentes pendientes
  const urgentes = servicios.filter(
    (s) => s.prioridad === 'urgente' && s.estado === 'pendiente'
  )
  const alerta = urgentes.length > 0
    ? { mensaje: `Tienes ${urgentes.length} servicio(s) urgente(s) pendiente(s) en tu ruta.` }
    : null

  return {
    fecha:    new Date().toISOString().split('T')[0],
    tecnico:  {
      nombre_completo: tareas[0]?.tecnico?.nombre ?? 'Técnico',
      cargo:           'Técnico de Campo',
    },
    alerta,
    servicios,
  }
}

/**
 * Marca una tarea como iniciada (en_progreso) en el backend.
 * Corresponde a PATCH /tareas/{id}/iniciar — solo el técnico asignado puede llamarla.
 *
 * @param {number} idTarea
 */
export const iniciarServicio = async (idTarea) => {
  const { data } = await apiClient.patch(`/tareas/${idTarea}/iniciar`)
  return data
}

/**
 * Cierra una tarea desde la app del técnico.
 * Corresponde a PATCH /tareas/{id}/finalizar (requiere evidencia registrada).
 *
 * Se usa este endpoint y no PATCH /tareas/{id}/estado porque aquel está
 * restringido a admin/supervisor: al técnico le devolvía 403 y la tarea se
 * quedaba "en progreso" en el panel aunque la evidencia sí se hubiera subido.
 *
 * @param {number} idTarea
 */
export const finalizarServicio = async (idTarea) => {
  const { data } = await apiClient.patch(`/tareas/${idTarea}/finalizar`)
  return data
}

/**
 * Historial de tareas completadas, agrupado por día.
 * Corresponde a GET /tareas/completadas.
 *
 * Un técnico solo recibe las suyas aunque no mande `id_tecnico`; el backend
 * fuerza el filtro según el rol del token.
 *
 * @param {{fecha_desde?: string, fecha_hasta?: string, id_tecnico?: number}} filtros
 * @returns {Promise<{total:number, desde:string, hasta:string, dias:Array}>}
 */
export const getTareasCompletadas = async (filtros = {}) => {
  const params = Object.fromEntries(
    Object.entries(filtros).filter(
      ([, v]) => v !== '' && v !== null && v !== undefined
    )
  )
  const { data } = await apiClient.get('/tareas/completadas', { params })
  return data
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * ¿Esta tarea pertenece a la ruta de hoy?
 *
 * Sí para todo lo que sigue abierto (pendiente / en progreso) y para lo que se
 * cerró hoy. Las completadas de días anteriores viven en el historial, no en
 * la ruta diaria.
 *
 * @param {{estado: string, fecha_completado: string|null}} servicio
 */
export function esTareaDeHoy(servicio) {
  if (servicio.estado === 'cancelado') return false
  if (servicio.estado !== 'completado') return true

  return esDelDia(servicio.fecha_completado, hoyISO())
}

/**
 * Intenta inferir el tipo de servicio a partir del título o descripción.
 * Devuelve 'Servicio' como fallback genérico.
 */
function _inferirTipo(titulo = '', descripcion = '') {
  const text = `${titulo} ${descripcion}`.toLowerCase()
  if (text.includes('instalac'))   return 'Instalación'
  if (text.includes('repar'))      return 'Reparación'
  if (text.includes('manten'))     return 'Mantenimiento'
  if (text.includes('inspecc'))    return 'Inspección'
  if (text.includes('configur'))   return 'Configuración'
  return 'Servicio'
}

/**
 * Paradas del mapa de HOY, con coordenadas (lat/lng) para pintarlas
 * (SCRUM-162).
 *
 * Va contra GET /tareas/mi-ruta, no contra /tareas. El recorte del día lo
 * hace el backend en SQL (ver `_filtro_mapa_del_dia` en routers/tareas.py):
 * entra todo lo que sigue abierto más lo que el técnico cerró HOY, y una
 * tarea completada ayer ya no vuelve a pintarse. Antes se traían las últimas
 * 500 tareas del técnico y se filtraban aquí, con dos problemas: el mapa
 * arrastraba semanas de puntos ya completados, y a partir de unos cientos de
 * tareas cerradas el corte de 500 (ordenado de la más reciente hacia atrás)
 * empezaba a comerse las tareas abiertas más viejas.
 *
 * El técnico no viaja como parámetro: el backend lo saca del token, así que
 * nadie puede pedir la ruta de un compañero por query string.
 *
 * @returns {Promise<Array>} paradas del día (con y sin coordenadas; el
 *   consumidor decide si descarta las que no se pueden ubicar en el mapa)
 */
export const getServiciosMapa = async () => {
  const { data } = await apiClient.get('/tareas/mi-ruta')

  return (Array.isArray(data) ? data : []).map((t) => ({
    id_servicio:      t.id_tarea,
    estado:           t.estado_tarea,
    prioridad:        t.prioridad ?? 'media',
    nombre:           t.titulo,
    direccion:        t.direccion_servicio ?? 'Dirección no especificada',
    tipo:             _inferirTipo(t.titulo, t.descripcion),
    lat:              t.lat ?? null,
    lng:              t.lng ?? null,
    fecha_completado: t.fecha_completado ?? null,
  }))
}
