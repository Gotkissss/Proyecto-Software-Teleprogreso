/**
 * Descarga rápida del reporte de asistencia mensual en Excel.
 */

import { descargarReporteAsistenciaExcel } from '../api/reporteService'

const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** Primer y último día del mes indicado, en formato YYYY-MM-DD local. */
export function rangoMesActual(fechaReferencia = new Date()) {
  const inicio = new Date(
    fechaReferencia.getFullYear(),
    fechaReferencia.getMonth(),
    1
  )
  const fin = new Date(
    fechaReferencia.getFullYear(),
    fechaReferencia.getMonth() + 1,
    0
  )

  const aYMD = (fecha) =>
    `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`

  return { fecha_inicio: aYMD(inicio), fecha_fin: aYMD(fin) }
}

/** Obtiene el nombre sugerido por el backend cuando CORS expone el header. */
function nombreDesdeContentDisposition(valor) {
  if (!valor) return null

  const coincidencia = valor.match(/filename="?([^";]+)"?/i)
  return coincidencia?.[1] ?? null
}

/** Dispara la descarga sin navegar fuera del dashboard. */
function descargarArchivo(contenido, nombreArchivo) {
  const blob = contenido instanceof Blob
    ? contenido
    : new Blob([contenido], { type: MIME_XLSX })
  const url = URL.createObjectURL(blob)
  const enlace = document.createElement('a')

  enlace.href = url
  enlace.download = nombreArchivo
  document.body.appendChild(enlace)
  enlace.click()
  document.body.removeChild(enlace)

  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Solicita al backend la asistencia agregada del mes y descarga el XLSX.
 *
 * @returns {Promise<{archivo:string}>}
 */
export async function exportarReporteAsistenciaMes(
  fechaReferencia = new Date()
) {
  const { fecha_inicio, fecha_fin } = rangoMesActual(fechaReferencia)
  const respuesta = await descargarReporteAsistenciaExcel({
    fecha_inicio,
    fecha_fin,
  })

  const nombreRespaldo = (
    `reporte_asistencia_${fecha_inicio}_${fecha_fin}.xlsx`
  )
  const nombreArchivo = nombreDesdeContentDisposition(
    respuesta.headers?.['content-disposition']
  ) || nombreRespaldo

  descargarArchivo(respuesta.data, nombreArchivo)

  return { archivo: nombreArchivo }
}
