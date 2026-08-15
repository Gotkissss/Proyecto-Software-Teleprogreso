/**
 * utils/csv.js
 * ---------------------------------------------------------------------------
 * Generación y descarga de reportes CSV en el cliente, sin dependencias.
 * Reutilizable por cualquier pantalla que necesite un "Exportar" rápido
 * (este botón del dashboard, y la futura página completa de Reportes).
 * ---------------------------------------------------------------------------
 */

/** Escapa un valor para una celda CSV (comillas, comas, saltos de línea). */
function escaparCelda(valor) {
  const texto = valor === null || valor === undefined ? '' : String(valor)
  if (/[",\n;]/.test(texto)) {
    return `"${texto.replace(/"/g, '""')}"`
  }
  return texto
}

/**
 * Construye el texto CSV a partir de columnas y filas.
 * @param {Array<{key: string, label: string}>} columnas
 * @param {Array<Object>} filas
 */
export function construirCSV(columnas, filas) {
  const encabezado = columnas.map((c) => escaparCelda(c.label)).join(',')
  const cuerpo = filas
    .map((fila) => columnas.map((c) => escaparCelda(fila[c.key])).join(','))
    .join('\n')
  return `${encabezado}\n${cuerpo}`
}

/**
 * Dispara la descarga de un CSV en el navegador.
 *
 * El BOM UTF-8 (\uFEFF) es necesario para que Excel en Windows detecte bien
 * la codificación; sin él, tildes y "ñ" salen corruptas aunque el contenido
 * esté correcto.
 *
 * @param {string} nombreArchivo - sin extensión, se le agrega ".csv"
 * @param {Array<{key: string, label: string}>} columnas
 * @param {Array<Object>} filas
 */
export function descargarCSV(nombreArchivo, columnas, filas) {
  const csv = construirCSV(columnas, filas)
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = `${nombreArchivo}.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)

  URL.revokeObjectURL(url)
}