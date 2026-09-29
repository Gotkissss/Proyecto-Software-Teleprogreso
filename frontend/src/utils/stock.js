/**
 * utils/stock.js
 * ---------------------------------------------------------------------------
 * Cómo se lee el nivel de existencias de un material.
 *
 * Vivían en api/materialService.js, que además duplicaba las llamadas de
 * api/inventarioService.js. Al quitar aquel servicio se quedan aquí, que es su
 * sitio: no hablan con el backend, solo traducen `cantidad_disponible` y
 * `stock_minimo` a lo que pinta la pantalla.
 * ---------------------------------------------------------------------------
 */

/**
 * Clasifica el nivel de existencias de un material.
 *
 * @param {number} disponible - cantidad actual
 * @param {number} minimo     - stock mínimo configurado
 * @returns {'critico' | 'bajo' | 'normal'}
 */
export function clasificarStock(disponible, minimo) {
  if (disponible === 0) return 'critico'
  if (disponible < minimo) return 'bajo'
  return 'normal'
}

/**
 * Porcentaje de llenado de la barra de stock.
 *
 * La referencia es el doble del mínimo, no el mínimo: así el 50% de la barra
 * cae justo sobre el mínimo y se ve de un vistazo si el material está por
 * encima o por debajo de él.
 *
 * @param {number} disponible
 * @param {number} minimo
 * @returns {number} entre 0 y 100
 */
export function calcularPorcentajeStock(disponible, minimo) {
  if (!minimo || minimo === 0) return 100

  const referencia = minimo * 2
  return Math.min(100, Math.round((disponible / referencia) * 100))
}
