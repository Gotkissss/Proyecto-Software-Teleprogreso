/**
 * services/inventarioService.js
 * ---------------------------------------------------------------------------
 * Servicio para gestionar los activos del inventario (equipos, herramientas,
 * vehículos, etc.) desde el panel del supervisor.
 * Usa el mismo apiClient centralizado (JWT automático vía interceptor).
 * ---------------------------------------------------------------------------
 */

import apiClient from '../api/client'

/**
 * Obtiene todos los activos del inventario.
 * Espera del backend: array de activos
 *   [{ id, nombre, categoria, estado, asignado_a, imagen_url, ... }]
 */
export async function getActivos() {
  const { data } = await apiClient.get('/activos')
  return data
}

/**
 * Obtiene el detalle de un activo específico.
 * Espera del backend: objeto activo
 *   { id, nombre, categoria, estado, asignado_a, imagen_url, descripcion, ... }
 * @param {number} id
 */
export async function getActivoById(id) {
  const { data } = await apiClient.get(`/activos/${id}`)
  return data
}

/**
 * Crea un nuevo activo en el inventario (incluye imagen).
 * Espera del backend: objeto activo recién creado con su id asignado.
 * @param {FormData} formData - debe contener los campos del activo y el archivo de imagen
 */
export async function createActivo(formData) {
  const { data } = await apiClient.post('/activos', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

/**
 * Actualiza un activo existente (puede incluir nueva imagen).
 * Espera del backend: objeto activo actualizado.
 * @param {number} id
 * @param {FormData} formData
 */
export async function updateActivo(id, formData) {
  const { data } = await apiClient.put(`/activos/${id}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

/**
 * Elimina un activo del inventario.
 * Espera del backend: confirmación de borrado (por ejemplo { ok: true } o 204).
 * @param {number} id
 */
export async function deleteActivo(id) {
  const { data } = await apiClient.delete(`/activos/${id}`)
  return data
}
