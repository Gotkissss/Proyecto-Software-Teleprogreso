/**
 * api/incidenciaService.js
 * ---------------------------------------------------------------------------
 * Evidencias de trabajo (incidencias) de una tarea.
 *
 * Endpoints del backend:
 *   POST   /tareas/{id}/incidencias                      → registrar evidencia
 *   GET    /tareas/{id}/incidencias                      → listar evidencias
 *   POST   /tareas/{id}/incidencias/{id_inc}/foto        → subir/reemplazar foto
 *   DELETE /tareas/{id}/incidencias/{id_inc}             → eliminar evidencia
 *
 * Acceso: el técnico asignado a la tarea, o admin/supervisor/gerente.
 * ---------------------------------------------------------------------------
 */

import apiClient from './client'

/** Extensiones que acepta el backend (app/services/uploads.py). */
export const EXTENSIONES_FOTO = ['.jpg', '.jpeg', '.png', '.webp', '.gif']

/** Tamaño máximo en MB que acepta el backend. */
export const MAX_FOTO_MB = 5

/** Valor para el atributo `accept` de un <input type="file">. */
export const ACCEPT_FOTO = EXTENSIONES_FOTO.join(',')

/** Longitud mínima de la descripción (igual que el schema del backend). */
export const MIN_DESCRIPCION = 5

/**
 * Valida una foto en el navegador antes de subirla.
 * Duplica a propósito las reglas del backend para dar feedback inmediato,
 * sin gastar una petición que va a fallar.
 *
 * @param {File|null} archivo
 * @returns {string|null} mensaje de error, o null si es válida
 */
export function validarFoto(archivo) {
  if (!archivo) return 'Adjunta una foto de evidencia.'

  const nombre = archivo.name || ''
  const extension = nombre.slice(nombre.lastIndexOf('.')).toLowerCase()

  if (!EXTENSIONES_FOTO.includes(extension)) {
    return `Formato no permitido. Usa: ${EXTENSIONES_FOTO.join(', ')}.`
  }
  if (archivo.size === 0) {
    return 'El archivo está vacío.'
  }
  if (archivo.size > MAX_FOTO_MB * 1024 * 1024) {
    const mb = (archivo.size / (1024 * 1024)).toFixed(1)
    return `La foto pesa ${mb} MB y el máximo son ${MAX_FOTO_MB} MB.`
  }
  return null
}

/**
 * Lista las evidencias de una tarea (de la más reciente a la más antigua).
 * @param {number} idTarea
 */
export async function getIncidencias(idTarea) {
  const { data } = await apiClient.get(`/tareas/${idTarea}/incidencias`)
  return Array.isArray(data) ? data : []
}

/**
 * Registra una evidencia (solo texto).
 * @param {number} idTarea
 * @param {{descripcion: string, finalizarTarea?: boolean}} datos
 */
export async function crearIncidencia(idTarea, { descripcion, finalizarTarea = false }) {
  const { data } = await apiClient.post(`/tareas/${idTarea}/incidencias`, {
    descripcion,
    finalizar_tarea: finalizarTarea,
  })
  return data
}

/**
 * Sube o reemplaza la foto de una evidencia ya creada.
 *
 * @param {number} idTarea
 * @param {number} idIncidencia
 * @param {File} archivo
 * @param {{finalizarTarea?: boolean}} [opciones] - finalizarTarea cierra la
 *        tarea solo si la foto se guardó correctamente.
 */
export async function subirFotoEvidencia(
  idTarea,
  idIncidencia,
  archivo,
  { finalizarTarea = false } = {},
) {
  const formData = new FormData()
  formData.append('file', archivo)
  formData.append('finalizar_tarea', String(finalizarTarea))

  const { data } = await apiClient.post(
    `/tareas/${idTarea}/incidencias/${idIncidencia}/foto`,
    formData,
    {
      // Se deja que el navegador ponga el boundary del multipart; si se manda
      // el Content-Type por defecto del cliente (application/json) el backend
      // rechaza la petición.
      headers: { 'Content-Type': undefined },
      timeout: 30000, // subir una foto por datos móviles tarda más que un GET
    },
  )
  return data
}

/**
 * Elimina una evidencia. Solo admin y supervisor.
 * @param {number} idTarea
 * @param {number} idIncidencia
 */
export async function eliminarIncidencia(idTarea, idIncidencia) {
  const { data } = await apiClient.delete(
    `/tareas/${idTarea}/incidencias/${idIncidencia}`,
  )
  return data
}

/**
 * Flujo de "Finalizar tarea": registra la evidencia y, si la foto se subió
 * bien, cierra la tarea en la misma petición.
 *
 * El orden importa. Si se cerrara la tarea primero y la subida fallara,
 * quedaría una tarea completada sin evidencia, que es justo lo que la
 * historia pide evitar. Por eso la incidencia se crea con
 * `finalizar_tarea: false` y el cierre viaja en el upload de la foto.
 *
 * @param {number} idTarea
 * @param {{descripcion: string, foto: File}} datos
 * @returns {Promise<Object>} la incidencia creada, ya con su foto
 */
export async function finalizarTareaConEvidencia(idTarea, { descripcion, foto }) {
  const incidencia = await crearIncidencia(idTarea, {
    descripcion,
    finalizarTarea: false,
  })

  const { foto_evidencia } = await subirFotoEvidencia(
    idTarea,
    incidencia.id_incidencia,
    foto,
    { finalizarTarea: true },
  )

  return { ...incidencia, foto_evidencia }
}
