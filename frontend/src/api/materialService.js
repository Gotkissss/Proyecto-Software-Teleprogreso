/**
 * Servicio para consultar materiales y alertas de stock bajo.
 *
 * Endpoint que implementará Gualim en back :
 *   GET /activos/materiales/bajo-stock
 *   que retorna materiales donde cantidad_disponible < stock_minimo
 *
 * ---------------------------------------------------------------------------
 */

import apiClient from './client'

/**
 * Obtiene todos los materiales del sistema.
 * Endpoint: GET /activos/materiales
 */
export async function getMateriales() {
  const { data } = await apiClient.get('/activos/materiales')
  return Array.isArray(data) ? data : (data?.materiales ?? [])
}

/**
 * Obtiene materiales con stock bajo (cantidad_disponible < stock_minimo).
 *
 * NOTA: Este endpoint debe ser implementado aun por backend.
 * Endpoint: GET /activos/materiales/bajo-stock
 *
 * ahora bien como no esta un listo se puede simular filtrando en el frontend
 * desde getMateriales() — ver comentario en AlertasPage.
 */
export async function getMaterialesBajoStock() {
  // TODO (backend): Implementar GET /activos/materiales/bajo-stock
  // que filtre cantidad_disponible < stock_minimo en la BD.
  const { data } = await apiClient.get('/activos/materiales/bajo-stock')
  return Array.isArray(data) ? data : (data?.materiales ?? [])
}

/**
 * Calcula el porcentaje de stock disponible respecto al mínimo.
 * Útil para la barra de progreso en la UI.
 *
 * @param {number} disponible
 * @param {number} minimo
 * @returns {number} porcentaje entre 0 y 100
 */
export function calcularPorcentajeStock(disponible, minimo) {
  if (!minimo || minimo === 0) return 100
  // Mostramos el stock como % del doble del mínimo (100% = 2× el mínimo)
  const referencia = minimo * 2
  return Math.min(100, Math.round((disponible / referencia) * 100))
}

/**
 * Clasifica el nivel de criticidad del stock.
 *
 * @param {number} disponible
 * @param {number} minimo
 * @returns {'critico' | 'bajo' | 'normal'}
 */
export function clasificarStock(disponible, minimo) {
  if (disponible === 0) return 'critico'
  if (disponible < minimo) return 'bajo'
  return 'normal'
}