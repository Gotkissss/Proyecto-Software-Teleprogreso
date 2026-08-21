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
 * Tareas que van al mapa del supervisor/admin para un día dado.
 *
 * Va contra GET /tareas/mapa-supervisor, que hace el recorte en SQL:
 *   - En HOY entra todo el trabajo abierto del equipo (pendiente y en curso),
 *     tenga la fecha planificada que tenga, más lo que se cerró hoy.
 *   - En un día pasado entra solo lo que se cerró ese día.
 *
 * Antes esta pantalla pedía /tareas y recortaba en el cliente por el rango
 * [fecha_inicio, fecha_finalizacion]. Eso dejaba fuera del mapa las tareas
 * pendientes vencidas y las programadas para otro día —en "pendiente" salían
 * dos de seis— y arrastraba en el mapa las ya completadas durante todos los
 * días de su rango.
 *
 * @param {string} fecha - día a mirar, en formato "YYYY-MM-DD"
 */
export async function getMapaSupervisor(fecha) {
  const { data } = await apiClient.get('/tareas/mapa-supervisor', {
    params: fecha ? { fecha } : {},
  })
  return Array.isArray(data) ? data : []
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
 *
 * SCRUM-170/171: `lat` y `lng` son la ubicación exacta del servicio. El
 * backend las valida como par (TareaCreate en backend/app/schemas/tarea.py:
 * o van las dos con valor, o van las dos en null) y las guarda en
 * `coordenada_servicio` como punto PostGIS.
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
    // Se mandan siempre juntas: mandar solo una es un 422 del validador.
    lat: lat ?? null,
    lng: lng ?? null,
  })
  return data
}

/**
 * Edita una tarea existente (PATCH /tareas/{id}).
 * Solo se envían los campos presentes en `cambios`.
 *
 * @param {number} id
 * @param {Object} cambios - { titulo?, descripcion?, direccion?, prioridad?,
 *                             estado?, fecha_inicio?, fecha_finalizacion?,
 *                             id_tecnico?, lat?, lng? }
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

  // SCRUM-170: el validador del backend exige lat y lng como par. Basta con
  // que venga una en `cambios` para mandar las dos; ambas en null borran la
  // ubicación de la tarea.
  if ('lat' in cambios || 'lng' in cambios) {
    body.lat = cambios.lat ?? null
    body.lng = cambios.lng ?? null
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