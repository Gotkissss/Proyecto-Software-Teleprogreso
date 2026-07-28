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
  const servicios = tareas.map((t) => ({
    id_servicio: t.id_tarea,
    estado:      t.estado_tarea,          // pendiente | en_progreso | completado | cancelado
    prioridad:   t.prioridad ?? 'media',  // urgente | alta | media | baja
    nombre:      t.titulo,
    direccion:   t.direccion_servicio ?? 'Dirección no especificada',
    tipo:        _inferirTipo(t.titulo, t.descripcion),
  }))

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
 * Marca una tarea como completada en el backend.
 * Corresponde a PATCH /tareas/{id}/estado con estado='completado'.
 *
 * @param {number} idTarea
 */
export const terminarServicio = async (idTarea) => {
  const { data } = await apiClient.patch(`/tareas/${idTarea}/estado`, {
    estado: 'completado',
  })
  return data
}

// ── Helpers ────────────────────────────────────────────────────────────────

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
