/**
 * Servicio para gestionar vehículos y sus herramientas asignadas.
 *
 * Endpoints que implementará Gualim de backend (SCRUM-111, 112, 113):
 *
 *   SCRUM-111: GET  /activos/carros/{id}/herramientas
 *              -> Lista herramientas asignadas a un carro
 *
 *   SCRUM-112: POST /activos/carros/{id}/herramientas
 *              body: { id_herramienta: number }
 *               ->Asigna una herramienta al carro (tabla CarroHerramienta)
 *
 *   SCRUM-113: DELETE /activos/carros/{id}/herramientas/{id_h}
 *               -> Libera (desasigna) una herramienta del carro
 *
 * Todos los endpoints están implementados en el backend.
 * ---------------------------------------------------------------------------
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
 * SCRUM-111
 * Obtiene las herramientas asignadas a un carro específico.
 *
 * TODO (backend — gualim): Implementar GET /activos/carros/{id}/herramientas
 */
export async function getHerramientasDeCarro(idCarro) {
  const { data } = await apiClient.get(`/activos/carros/${idCarro}/herramientas`)
  return Array.isArray(data) ? data : []
}

/**
 * SCRUM-112
 * Asigna una herramienta a un carro (crea registro en CarroHerramienta).
 *
 * TODO (backend — gualim): Implementar POST /activos/carros/{id}/herramientas
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
 * SCRUM-113
 * Desasigna (libera) una herramienta de un carro.
 *
 * TODO (backend — gualim): Implementar DELETE /activos/carros/{id}/herramientas/{id_h}
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