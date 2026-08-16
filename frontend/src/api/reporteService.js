/**
 * Descargas de reportes generados por el backend.
 */

import apiClient from './client'

/**
 * Descarga el reporte agregado de asistencia como archivo XLSX.
 *
 * @param {{fecha_inicio:string, fecha_fin:string, empleado?:number}} filtros
 * @returns {Promise<import('axios').AxiosResponse<Blob>>}
 */
export async function descargarReporteAsistenciaExcel(filtros = {}) {
  const params = Object.fromEntries(
    Object.entries(filtros).filter(
      ([, valor]) => valor !== '' && valor !== null && valor !== undefined
    )
  )

  return apiClient.get('/reportes/asistencia/exportar', {
    params,
    responseType: 'blob',
  })
}
