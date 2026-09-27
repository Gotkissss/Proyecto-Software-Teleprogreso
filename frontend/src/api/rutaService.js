/**
 * api/rutaService.js
 * ---------------------------------------------------------------------------
 * Servicio para la pantalla "Mi Ruta Diaria" del técnico.
 *
 * Las tareas del día se obtienen de GET /tareas/mi-ruta (el técnico sale del
 * token) y se transforman al formato que espera RutaDiariaPage. Si se envía
 * la posición del técnico, el backend las devuelve ordenadas por cercanía y
 * con su distancia (HU-3); si no, ordenadas por prioridad.
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
 * HU-3: el orden lo decide el backend (urgentes primero, luego la parada más
 * cercana; sin posición, por prioridad). Aquí no se reordena.
 *
 * @param {{lat: number, lng: number}|null} posicion - posición actual del
 *   técnico, o null si el GPS no está disponible. Solo se usa para calcular
 *   el orden y la distancia; el backend no la guarda.
 * @returns {{ fecha, tecnico, alerta, servicios, ordenadoPorCercania }}
 */
export const getMiRuta = async (posicion = null) => {
  const params = {}
  const conPosicion =
    Number.isFinite(posicion?.lat) && Number.isFinite(posicion?.lng)
  if (conPosicion) {
    params.lat = posicion.lat
    params.lng = posicion.lng
  }

  const { data } = await apiClient.get('/tareas/mi-ruta', { params })
  const tareas = Array.isArray(data) ? data : []

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
      // Fecha límite: la pantalla la usa para avisar al técnico de lo que
      // vence hoy o ya venció, en vez de dejarle deducirlo de la lista.
      fecha_finalizacion: t.fecha_finalizacion ?? null,
      estado_tarea: t.estado_tarea,
      // HU-3: coordenada para "Cómo llegar" y distancia desde el técnico
      // (null sin GPS o si la tarea no tiene coordenada).
      lat:              t.lat ?? null,
      lng:              t.lng ?? null,
      distancia_m:      t.distancia_m ?? null,
    }))
    // El backend ya recorta al día (abiertas + cerradas hoy); el filtro se
    // conserva como red de seguridad y no altera el orden recibido.
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
      // /tareas/mi-ruta no trae el técnico (es el del token): la pantalla
      // toma el nombre del usuario autenticado.
      nombre_completo: null,
      cargo:           'Técnico de Campo',
    },
    alerta,
    servicios,
    ordenadoPorCercania: conPosicion,
  }
}

/**
 * Marca una tarea como iniciada (en_progreso) en el backend.
 * Corresponde a PATCH /tareas/{id}/iniciar — solo el técnico asignado puede llamarla.
 *
 * HU-5: requiere la jornada abierta (409 si no), y si llega la posición, el
 * lugar del inicio queda en el recorrido del técnico.
 *
 * @param {number} idTarea
 * @param {{lat:number, lng:number}|null} [posicion]
 */
export const iniciarServicio = async (idTarea, posicion = null) => {
  const { data } = await apiClient.patch(
    `/tareas/${idTarea}/iniciar`,
    cuerpoUbicacion(posicion),
  )
  return data
}

/** Cuerpo {lat, lng} solo si hay posición; si no, la petición va sin cuerpo. */
export function cuerpoUbicacion(posicion) {
  return Number.isFinite(posicion?.lat) && Number.isFinite(posicion?.lng)
    ? { lat: posicion.lat, lng: posicion.lng }
    : undefined
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
