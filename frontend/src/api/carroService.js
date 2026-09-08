/**
 * Servicio para gestionar vehículos y sus herramientas asignadas.
 */

import apiClient from './client'

/*  Carros*/

/**
 * Obtiene todos los vehículos del sistema.
 * Endpoint: GET /activos/carros
 */
export async function getCarros() {
  const { data } = await apiClient.get('/activos/carros')
  return Array.isArray(data) ? data : (data?.carros ?? [])
}

/**
 * Obtiene el detalle de un vehículo por ID.
 * Endpoint: GET /activos/carros/{id}
 */
export async function getCarroById(id) {
  const { data } = await apiClient.get(`/activos/carros/${id}`)
  return data
}

/*  Herramientas de un carro (SCRUM-111, 112, 113) */

/**
 * Obtiene las herramientas asignadas a un carro específico.
 * Endpoint: GET /activos/carros/{id}/herramientas
 */
export async function getHerramientasDeCarro(idCarro) {
  const { data } = await apiClient.get(`/activos/carros/${idCarro}/herramientas`)
  return Array.isArray(data) ? data : []
}

/**
 * Asigna una herramienta a un carro (crea registro en CarroHerramienta).
 * Endpoint: POST /activos/carros/{id}/herramientas
 *
 * @param {number} idCarro
 * @param {number} idHerramienta
 */
export async function asignarHerramientaACarro(idCarro, idHerramienta) {
  const { data } = await apiClient.post(
    `/activos/carros/${idCarro}/herramientas`,
    { id_herramienta: idHerramienta }
  )
  return data
}

/**
 * Desasigna (libera) una herramienta de un carro.
 * Endpoint: DELETE /activos/carros/{id}/herramientas/{id_h}
 *
 * @param {number} idCarro
 * @param {number} idHerramienta
 */
export async function liberarHerramientaDeCarro(idCarro, idHerramienta) {
  await apiClient.delete(`/activos/carros/${idCarro}/herramientas/${idHerramienta}`)
}

/*  Herramientas globales */

/**
 * Obtiene todas las herramientas del inventario.
 * Usado para el multi-select del modal de asignación.
 * Endpoint: GET /activos/herramientas
 */
export async function getHerramientas() {
  const { data } = await apiClient.get('/activos/herramientas')
  return Array.isArray(data) ? data : (data?.herramientas ?? [])
}