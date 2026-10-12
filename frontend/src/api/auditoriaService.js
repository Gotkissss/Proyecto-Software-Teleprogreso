/**
 * api/auditoriaService.js
 * ---------------------------------------------------------------------------
 * Bitácora de auditoría (HU-S9-03). Todos los endpoints son solo del admin.
 *
 *   GET /auditoria              página filtrada (más reciente primero)
 *   GET /auditoria/catalogos    acciones, entidades y roles que existen
 *   GET /auditoria/verificacion integridad de la cadena y protección en la BD
 *   GET /auditoria/exportar     XLSX con todas las filas del mismo filtro
 * ---------------------------------------------------------------------------
 */

import apiClient from './client'

/** Quita los filtros vacíos: el backend trata un "" como un valor. */
function sinVacios(params) {
  return Object.fromEntries(
    Object.entries(params).filter(([, valor]) => valor !== '' && valor !== null && valor !== undefined)
  )
}

/**
 * @param {{actor?, rol?, accion?, entidad?, id_entidad?, request_id?, fecha_inicio?, fecha_fin?}} filtros
 * @returns {Promise<{total:number, page:number, page_size:number, total_pages:number, items:Array}>}
 */
export async function getBitacora(filtros, page = 1, pageSize = 20) {
  const { data } = await apiClient.get('/auditoria', {
    params: sinVacios({ ...filtros, page, page_size: pageSize }),
  })
  return data
}

export async function getCatalogosBitacora() {
  const { data } = await apiClient.get('/auditoria/catalogos')
  return data
}

export async function getVerificacionBitacora() {
  // Recorre la cadena completa en la base: con meses de datos tarda más que
  // una consulta normal.
  const { data } = await apiClient.get('/auditoria/verificacion', { timeout: 60000 })
  return data
}

/** Mismos filtros que la tabla; devuelve la respuesta con el Blob. */
export async function descargarBitacoraExcel(filtros) {
  return apiClient.get('/auditoria/exportar', {
    params: sinVacios(filtros),
    responseType: 'blob',
    timeout: 120000,
  })
}

/**
 * Con `responseType: 'blob'` el cuerpo de un error (p. ej. el 400 de "acota
 * el rango") también llega como Blob: hay que leerlo para enseñar el motivo.
 */
export async function detalleDeErrorBlob(error) {
  const datos = error?.response?.data
  if (datos instanceof Blob) {
    try {
      return JSON.parse(await datos.text())?.detail ?? null
    } catch {
      return null
    }
  }
  return datos?.detail ?? null
}
