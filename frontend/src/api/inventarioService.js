/**
 * api/inventarioService.js
 * ---------------------------------------------------------------------------
 * Servicio centralizado para el módulo de inventario.
 * Cubre los tres tipos de activos: Carros, Herramientas y Materiales.
 */

import apiClient from './client'

/* ─── LECTURA ─────────────────────────────────────────────────────────────── */

export async function getCarros() {
  const { data } = await apiClient.get('/activos/carros')
  return Array.isArray(data) ? data : []
}

export async function getCarroById(id) {
  const { data } = await apiClient.get(`/activos/carros/${id}`)
  return data
}

export async function getHerramientas() {
  const { data } = await apiClient.get('/activos/herramientas')
  return Array.isArray(data) ? data : []
}

export async function getMateriales() {
  const { data } = await apiClient.get('/activos/materiales')
  return Array.isArray(data) ? data : []
}

export async function getMaterialesBajoStock() {
  const { data } = await apiClient.get('/activos/materiales/bajo-stock')
  return Array.isArray(data) ? data : []
}

/* ─── Kardex de materiales (HU-S10-07) ───────────────────────────────────── */

/**
 * Historia de stock de un material, lo más reciente primero.
 *
 * Es la respuesta a "¿a dónde se fueron las 40 rosetas?", que antes no se
 * podía contestar: `cantidad_disponible` solo guarda el último valor escrito.
 *
 * @param {number} id
 * @returns {Promise<{id_material:number, nombre_material:string,
 *   cantidad_disponible:number, stock_minimo:number, total:number,
 *   movimientos:Array}>}
 */
export async function getMovimientosMaterial(id) {
  const { data } = await apiClient.get(`/activos/materiales/${id}/movimientos`)
  return {
    ...data,
    movimientos: Array.isArray(data?.movimientos) ? data.movimientos : [],
  }
}

/**
 * Registra una entrada o un ajuste de stock.
 *
 * El consumo no entra por aquí: lo registra el cierre de la tarea, porque un
 * consumo sin trabajo que lo explique es el dato que esta historia viene a
 * arreglar.
 *
 * @param {number} id
 * @param {{tipo:'entrada'|'ajuste', cantidad:number, motivo?:string}} body
 */
export async function crearMovimientoMaterial(id, body) {
  const { data } = await apiClient.post(
    `/activos/materiales/${id}/movimientos`,
    body,
  )
  return data
}

/* ─── CRUD ───────────────────────────────────────────────────────────────── */

export async function crearActivo(body) {
  const { data } = await apiClient.post('/activos', body)
  return data
}

export async function editarActivo(id, cambios) {
  const { data } = await apiClient.patch(`/activos/${id}`, cambios)
  return data
}

export async function eliminarActivo(id) {
  const { data } = await apiClient.delete(`/activos/${id}`)
  return data
}

/* ─── IMAGEN ─────────────────────────────────────────────────────────────── */

export async function subirImagenActivo(id, file) {
  const formData = new FormData()
  formData.append('file', file)
  const { data } = await apiClient.post(`/activos/${id}/imagen`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

/* ─── ASIGNACIONES ──────────────────────────────────────────────────────── */

export async function asignarTecnicoACarro(idCarro, idEmpleado) {
  const { data } = await apiClient.post(`/activos/carros/${idCarro}/asignar`, {
    id_empleado: idEmpleado,
  })
  return data
}

export async function liberarTecnicoDeCarro(idCarro) {
  const { data } = await apiClient.delete(`/activos/carros/${idCarro}/asignacion`)
  return data
}

export async function getHerramientasDeCarro(idCarro) {
  const { data } = await apiClient.get(`/activos/carros/${idCarro}/herramientas`)
  return Array.isArray(data) ? data : []
}

export async function asignarHerramientaACarro(idCarro, idHerramienta) {
  const { data } = await apiClient.post(`/activos/carros/${idCarro}/herramientas`, {
    id_herramienta: idHerramienta,
  })
  return data
}

export async function liberarHerramientaDeCarro(idCarro, idHerramienta) {
  const { data } = await apiClient.delete(
    `/activos/carros/${idCarro}/herramientas/${idHerramienta}`
  )
  return data
}
