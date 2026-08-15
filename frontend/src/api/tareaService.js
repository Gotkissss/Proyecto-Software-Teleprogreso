/**
 * api/tareaService.js
 * ---------------------------------------------------------------------------
 * Servicio para gestionar tareas/servicios desde el lado del supervisor.
 * Usa el mismo apiClient de Diego (con JWT automático).
 * ---------------------------------------------------------------------------
 */

import apiClient from './client'

/**
 * Obtiene todas las tareas (con filtros opcionales)
 * @param {Object} params - { estado, tecnico_id, fecha }
 */
export async function getTareas(params = {}) {
  const { data } = await apiClient.get('/tareas', { params })
  return data
}

/**
 * Cambia el estado de una tarea
 * @param {number} id
 * @param {string} estado - 'pendiente' | 'en_curso' | 'finalizado'
 */
export async function actualizarEstado(id, estado) {
  const { data } = await apiClient.patch(`/tareas/${id}/estado`, { estado })
  return data
}

/**
 * Reasigna una tarea a otro técnico
 * @param {number} id
 * @param {number} tecnico_id
 */
export async function reasignarTarea(id, tecnico_id) {
  const { data } = await apiClient.patch(`/tareas/${id}/reasignar`, { id_tecnico: tecnico_id })
  return data
}

/**
 * Crea una nueva tarea y la asigna a un técnico
 * @param {Object} tarea - { titulo, descripcion, direccion, prioridad, id_tecnico,
 *                           fecha_inicio, fecha_finalizacion, lat, lng }
 */
export async function crearTarea({
  titulo,
  descripcion,
  direccion,
  prioridad,
  id_tecnico,
  fecha_inicio,
  fecha_finalizacion,
  lat,
  lng,
}) {
  const { data } = await apiClient.post('/tareas', {
    nombre: titulo,
    descripcion,
    direccion,
    prioridad,
    id_tecnico,
    fecha_inicio: fecha_inicio || null,
    fecha_finalizacion: fecha_finalizacion || null,
    // El backend todavía no persiste esta coordenada — TareaCreate
    // (backend/app/schemas/tarea.py) no tiene lat/lng ni el router las
    // vuelca a coordenada_servicio. Pydantic ignora estos campos extra por
    // ahora sin fallar; quedan mandados desde ya para que cuando el
    // backend los reciba no haga falta tocar el frontend otra vez.
    lat,
    lng,
  })
  return data
}

/**
 * Edita una tarea existente (PATCH /tareas/{id}).
 * Solo se envían los campos presentes en `cambios`.
 *
 * @param {number} id
 * @param {Object} cambios - { titulo?, descripcion?, direccion?, prioridad?,
 *                             estado?, fecha_inicio?, fecha_finalizacion?, id_tecnico? }
 */
export async function actualizarTarea(id, cambios = {}) {
  const body = {}

  // El backend espera `nombre` para el título.
  if ('titulo' in cambios)             body.nombre = cambios.titulo
  if ('descripcion' in cambios)        body.descripcion = cambios.descripcion || null
  if ('direccion' in cambios)          body.direccion = cambios.direccion || null
  if ('prioridad' in cambios)          body.prioridad = cambios.prioridad
  if ('estado' in cambios)             body.estado = cambios.estado
  if ('fecha_inicio' in cambios)       body.fecha_inicio = cambios.fecha_inicio || null
  if ('fecha_finalizacion' in cambios) body.fecha_finalizacion = cambios.fecha_finalizacion || null
  // null desasigna la tarea; '' del <select> se traduce a null.
  if ('id_tecnico' in cambios) {
    body.id_tecnico = cambios.id_tecnico === '' || cambios.id_tecnico == null
      ? null
      : Number(cambios.id_tecnico)
  }

  const { data } = await apiClient.patch(`/tareas/${id}`, body)
  return data
}

/**
 * Máximo de tareas activas por técnico, por si el backend no lo envía.
 *
 * El valor bueno viene en `limite_tareas` dentro de cada técnico
 * (backend/app/core/reglas.py). Esta constante es solo el respaldo: antes el
 * número estaba escrito a mano en dos pantallas distintas, así que al cambiar
 * la política en el backend el selector seguía bloqueando técnicos que sí
 * podían recibir trabajo.
 */
export const LIMITE_TAREAS_FALLBACK = 5

/**
 * Técnicos activos con su conteo de tareas activas.
 *
 * Se usa este endpoint (admin + supervisor) en lugar de GET /empleados?rol=tecnico,
 * que está restringido a rol admin y devolvía 403 a los supervisores.
 */
export async function getTecnicosDisponibles() {
  const { data } = await apiClient.get('/empleados/tecnicos/disponibles')
  return (Array.isArray(data) ? data : []).map((tec) => ({
    ...tec,
    id: tec.id_empleado,
    nombre_completo: tec.nombre_completo ?? `${tec.nombre} ${tec.apellido}`,
    tareas_activas: tec.tareas_activas ?? 0,
    limite_tareas: tec.limite_tareas ?? LIMITE_TAREAS_FALLBACK,
  }))
}