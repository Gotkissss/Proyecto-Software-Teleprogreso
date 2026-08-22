/**
 * Descargas de reportes generados por el backend.
 */

import apiClient from './client'

/** Tipos que acepta GET /reportes/{tipo}/exportar. */
export const TIPOS_REPORTE = [
  'resumen',
  'asistencia',
  'tareas-completadas',
  'productividad',
]

/**
 * Descarga un reporte agregado como archivo XLSX.
 *
 * El backend valida el cruce de filtros: 'resumen' y 'asistencia' se recortan
 * con `empleado`, y 'tareas-completadas' y 'productividad' con `tecnico`.
 * Enviar el que no corresponde devuelve 400, así que quien llame debe mandar
 * solo el filtro del tipo que pidió.
 *
 * @param {string} tipo - Uno de TIPOS_REPORTE.
 * @param {{fecha_inicio:string, fecha_fin:string, empleado?:number, tecnico?:number}} filtros
 * @returns {Promise<import('axios').AxiosResponse<Blob>>}
 */
export async function descargarReporteExcel(tipo, filtros = {}) {
  const params = Object.fromEntries(
    Object.entries(filtros).filter(
      ([, valor]) => valor !== '' && valor !== null && valor !== undefined
    )
  )

  return apiClient.get(`/reportes/${tipo}/exportar`, {
    params,
    responseType: 'blob',
  })
}
