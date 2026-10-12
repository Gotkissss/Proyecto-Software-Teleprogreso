/**
 * Reportes de gerencia: consulta en JSON (pantalla de reportes, HU-S9-04),
 * serie temporal, comparación con el periodo anterior y descarga en Excel.
 * Todos son de admin y gerente.
 */

import apiClient from './client'
import { periodoAnterior, variacionPorcentual } from '../utils/reportes'

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

/* ── Reportes en pantalla (HU-S9-04) ────────────────────────────────────── */


function sinVacios(params) {
  return Object.fromEntries(
    Object.entries(params).filter(
      ([, valor]) => valor !== '' && valor !== null && valor !== undefined
    )
  )
}

async function getReporte(ruta, params) {
  const { data } = await apiClient.get(ruta, { params: sinVacios(params) })
  return data
}

/** Resumen operativo por empleado. `empleado` es opcional. */
export const getReporteResumen = ({ fecha_inicio, fecha_fin, empleado }) =>
  getReporte('/reportes/resumen', { fecha_inicio, fecha_fin, empleado })

/** Asistencia agregada. `empleado` es opcional. */
export const getReporteAsistencia = ({ fecha_inicio, fecha_fin, empleado }) =>
  getReporte('/reportes/asistencia', { fecha_inicio, fecha_fin, empleado })

/** Tareas completadas por técnico. Se filtra con `tecnico`, no `empleado`. */
export const getReporteTareasCompletadas = ({ fecha_inicio, fecha_fin, tecnico }) =>
  getReporte('/reportes/tareas-completadas', { fecha_inicio, fecha_fin, tecnico })

/** Tareas por hora trabajada por técnico. Se filtra con `tecnico`. */
export const getReporteProductividad = ({ fecha_inicio, fecha_fin, tecnico }) =>
  getReporte('/reportes/productividad', { fecha_inicio, fecha_fin, tecnico })

/**
 * Evolución de una métrica por día o semana.
 * @param {{metrica:'horas'|'tareas'|'pausas', agrupar:'dia'|'semana', fecha_inicio:string, fecha_fin:string, empleado?:number}} filtros
 */
export const getSerieReporte = ({ metrica, agrupar, fecha_inicio, fecha_fin, empleado }) =>
  getReporte('/reportes/serie', { metrica, agrupar, fecha_inicio, fecha_fin, empleado })

/**
 * Resumen del rango y del periodo anterior equivalente, pedidos en paralelo,
 * con la variación en % de cada total numérico (null si el periodo anterior
 * no tiene base para comparar).
 *
 * @returns {Promise<{actual:Object, anterior:Object, periodoAnterior:{fecha_inicio:string, fecha_fin:string}, variaciones:Object<string, number|null>}>}
 */
export async function getResumenConComparacion({ fecha_inicio, fecha_fin, empleado }) {
  const rangoAnterior = periodoAnterior({ fecha_inicio, fecha_fin })
  const [actual, anterior] = await Promise.all([
    getReporteResumen({ fecha_inicio, fecha_fin, empleado }),
    getReporteResumen({ ...rangoAnterior, empleado }),
  ])

  const variaciones = Object.fromEntries(
    Object.entries(actual)
      .filter(([, valor]) => typeof valor === 'number')
      .map(([clave, valor]) => [clave, variacionPorcentual(valor, anterior[clave])])
  )
  return { actual, anterior, periodoAnterior: rangoAnterior, variaciones }
}
