/**
 * utils/exportarAsistenciaCSV.js
 * ---------------------------------------------------------------------------
 * Descarga rápida de asistencia del mes desde el dashboard del supervisor
 * (botón "Exportar reporte"). Es un adelanto de la página completa de
 * Reportes del próximo sprint: aquí no hay filtros ni vista previa, solo
 * "dame el mes actual en un CSV que abra en Excel".
 *
 * Reutiliza GET /asistencia/historial (asistenciaService.getHistorialAsistencia),
 * el mismo endpoint que ya usa la pantalla de Pausas/Historial. Como
 * supervisor, no se manda `empleado`, así que el backend devuelve la
 * asistencia de TODA la plantilla — es paginado, así que se recorre página
 * por página hasta juntar el rango completo antes de armar el archivo.
 * ---------------------------------------------------------------------------
 */

import { getHistorialAsistencia } from '../api/asistenciaService'

/** Primer y último día del mes actual, en formato YYYY-MM-DD (hora local). */
function rangoMesActual() {
  const hoy = new Date()
  const inicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1)
  const fin = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0)

  const aYMD = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

  return { fecha_inicio: aYMD(inicio), fecha_fin: aYMD(fin) }
}

/**
 * Trae TODAS las jornadas del mes actual, recorriendo la paginación del
 * backend (page_size máximo permitido: 100 — ver routers/asistencia.py).
 */
async function obtenerJornadasDelMes() {
  const { fecha_inicio, fecha_fin } = rangoMesActual()
  const PAGE_SIZE = 100

  const primera = await getHistorialAsistencia({
    fecha_inicio,
    fecha_fin,
    page: 1,
    page_size: PAGE_SIZE,
  })

  let items = [...primera.items]
  const totalPaginas = primera.total_pages ?? 1

  // La mayoría de meses caben en una sola página (100 jornadas); esto solo
  // entra en juego con plantillas grandes o jornadas muy frecuentes.
  for (let pagina = 2; pagina <= totalPaginas; pagina++) {
    const siguiente = await getHistorialAsistencia({
      fecha_inicio,
      fecha_fin,
      page: pagina,
      page_size: PAGE_SIZE,
    })
    items = items.concat(siguiente.items)
  }

  return { items, fecha_inicio, fecha_fin, totales: primera.totales }
}

/**
 * Escapa un valor para una celda CSV: si contiene coma, comillas o salto de
 * línea, lo envuelve en comillas dobles (duplicando las comillas internas).
 */
function celdaCSV(valor) {
  const texto = valor == null ? '' : String(valor)
  if (/[",\n]/.test(texto)) {
    return `"${texto.replace(/"/g, '""')}"`
  }
  return texto
}

const ENCABEZADOS = [
  'Empleado',
  'Rol',
  'Fecha',
  'Hora entrada',
  'Hora salida',
  'Horas trabajadas',
  'Horas en pausa',
  'Horas brutas',
  'Total pausas',
  'Jornada activa',
]

function filaDeJornada(j) {
  return [
    j.nombre_empleado,
    j.rol,
    j.fecha,
    j.hora_entrada ?? '—',
    j.hora_salida ?? '—',
    j.horas_trabajadas,
    j.horas_pausa,
    j.horas_brutas,
    j.total_pausas,
    j.jornada_activa ? 'Sí' : 'No',
  ]
}

function filaDeTotales(totales, fecha_inicio, fecha_fin) {
  return [
    `TOTAL (${fecha_inicio} a ${fecha_fin})`,
    '',
    `${totales.jornadas} jornada${totales.jornadas === 1 ? '' : 's'}`,
    '',
    '',
    totales.horas_trabajadas,
    totales.horas_pausa,
    totales.horas_brutas,
    '',
    totales.jornadas_abiertas > 0 ? `${totales.jornadas_abiertas} abierta(s)` : '',
  ]
}

/** Arma el string CSV completo (con BOM para que Excel detecte UTF-8/tildes). */
function construirCSV({ items, totales, fecha_inicio, fecha_fin }) {
  const filas = [
    ENCABEZADOS,
    ...items.map(filaDeJornada),
    [], // línea en blanco como separador visual antes del total
    filaDeTotales(totales, fecha_inicio, fecha_fin),
  ]

  const cuerpo = filas.map((fila) => fila.map(celdaCSV).join(',')).join('\r\n')
  const BOM = '\uFEFF'
  return BOM + cuerpo
}

/** Dispara la descarga del archivo en el navegador sin recargar la página. */
function descargarArchivo(contenido, nombreArchivo) {
  const blob = new Blob([contenido], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = nombreArchivo
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)

  // Libera el objeto URL una vez que el navegador ya inició la descarga.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Punto de entrada: trae la asistencia del mes actual y descarga el CSV.
 * Lanza el error hacia arriba si algo falla, para que el botón muestre un
 * toast de error en vez de fallar en silencio.
 *
 * @returns {Promise<{ totalJornadas: number, archivo: string }>}
 */
export async function exportarReporteAsistenciaMes() {
  const datos = await obtenerJornadasDelMes()

  if (datos.items.length === 0) {
    const err = new Error('No hay jornadas registradas este mes todavía.')
    err.sinDatos = true
    throw err
  }

  const csv = construirCSV(datos)

  const hoy = new Date()
  const etiquetaMes = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`
  const nombreArchivo = `asistencia_teleprogreso_${etiquetaMes}.csv`

  descargarArchivo(csv, nombreArchivo)

  return { totalJornadas: datos.items.length, archivo: nombreArchivo }
}