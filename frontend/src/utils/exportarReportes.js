/**
 * utils/exportarReportes.js
 * ---------------------------------------------------------------------------
 * Descarga de los reportes de gerencia en Excel.
 *
 * Antes esto era `exportarAsistenciaExcel.js` y solo sabía hacer una cosa: la
 * asistencia del mes en curso, con el rango calculado dentro de la función.
 * Quien exportaba no podía pedir "esta semana" ni "el mes pasado", ni ver
 * tareas cerradas o descansos — aunque el backend ya los servía.
 *
 * Ahora el rango entra por parámetro y los atajos de fecha viven aquí, en
 * funciones puras, para poder probarlos sin montar la pantalla.
 * ---------------------------------------------------------------------------
 */

import { descargarReporteExcel } from '../api/reporteService'

const MIME_XLSX =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/**
 * Catálogo de reportes que ofrece la pantalla de exportación.
 *
 * `filtro` dice con qué parámetro los recorta el backend: los que miran a la
 * persona usan `empleado` y los que miran el trabajo cerrado usan `tecnico`.
 * Mandar el que no toca devuelve 400.
 */
export const REPORTES = [
  {
    tipo: 'resumen',
    titulo: 'Resumen operativo',
    descripcion:
      'Todo junto por empleado: jornadas, horas trabajadas, descansos ' +
      'tomados, tiempo en descanso y tareas cerradas.',
    filtro: 'empleado',
  },
  {
    tipo: 'asistencia',
    titulo: 'Asistencia',
    descripcion:
      'Jornadas, jornadas sin cerrar, horas trabajadas y tiempo en descanso.',
    filtro: 'empleado',
  },
  {
    tipo: 'tareas-completadas',
    titulo: 'Tareas completadas',
    descripcion: 'Cuántas tareas cerró cada técnico en el periodo.',
    filtro: 'tecnico',
  },
  {
    tipo: 'productividad',
    titulo: 'Productividad',
    descripcion: 'Tareas cerradas por hora efectivamente trabajada.',
    filtro: 'tecnico',
  },
]

/** Fecha local en YYYY-MM-DD. `toISOString()` no sirve: convierte a UTC y en
 *  Guatemala (UTC-6) devuelve el día anterior para cualquier hora antes de
 *  las 18:00. */
export function aYMD(fecha) {
  const mes = String(fecha.getMonth() + 1).padStart(2, '0')
  const dia = String(fecha.getDate()).padStart(2, '0')
  return `${fecha.getFullYear()}-${mes}-${dia}`
}

function rango(inicio, fin) {
  return { fecha_inicio: aYMD(inicio), fecha_fin: aYMD(fin) }
}

/** Atajos de periodo que ofrece la pantalla, en orden de aparición. */
export const RANGOS_RAPIDOS = [
  {
    clave: 'hoy',
    etiqueta: 'Hoy',
    calcular: (hoy) => rango(hoy, hoy),
  },
  {
    clave: 'semana',
    etiqueta: 'Últimos 7 días',
    calcular: (hoy) => {
      const inicio = new Date(hoy)
      inicio.setDate(inicio.getDate() - 6)
      return rango(inicio, hoy)
    },
  },
  {
    clave: 'mes',
    etiqueta: 'Este mes',
    calcular: (hoy) =>
      rango(new Date(hoy.getFullYear(), hoy.getMonth(), 1), hoy),
  },
  {
    clave: 'mes-pasado',
    etiqueta: 'Mes pasado',
    calcular: (hoy) =>
      rango(
        new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1),
        // Día 0 del mes actual = último día del mes anterior.
        new Date(hoy.getFullYear(), hoy.getMonth(), 0)
      ),
  },
]

/**
 * Calcula un rango rápido por su clave.
 *
 * @param {string} clave
 * @param {Date} [referencia] - "Hoy" para el cálculo; parametrizable para tests.
 * @returns {{fecha_inicio:string, fecha_fin:string}|null}
 */
export function rangoRapido(clave, referencia = new Date()) {
  const definicion = RANGOS_RAPIDOS.find((item) => item.clave === clave)
  return definicion ? definicion.calcular(referencia) : null
}

/** Obtiene el nombre sugerido por el backend cuando CORS expone el header. */
function nombreDesdeContentDisposition(valor) {
  if (!valor) return null

  const coincidencia = valor.match(/filename="?([^";]+)"?/i)
  return coincidencia?.[1] ?? null
}

/** Dispara la descarga sin navegar fuera de la página. */
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
 * Pide el reporte al backend y lo descarga.
 *
 * @param {Object} opciones
 * @param {string} opciones.tipo - Uno de REPORTES[].tipo.
 * @param {string} opciones.fecha_inicio - YYYY-MM-DD, inclusive.
 * @param {string} opciones.fecha_fin - YYYY-MM-DD, inclusive.
 * @param {number} [opciones.empleado] - Filtro de una sola persona.
 * @returns {Promise<{archivo:string}>}
 */
export async function exportarReporte({
  tipo,
  fecha_inicio,
  fecha_fin,
  empleado,
}) {
  const definicion = REPORTES.find((reporte) => reporte.tipo === tipo)
  if (!definicion) throw new Error(`Tipo de reporte desconocido: ${tipo}`)

  const filtros = { fecha_inicio, fecha_fin }
  // El nombre del parámetro depende del reporte; el valor es el mismo id.
  if (empleado) filtros[definicion.filtro] = Number(empleado)

  const respuesta = await descargarReporteExcel(tipo, filtros)

  const nombreArchivo =
    nombreDesdeContentDisposition(
      respuesta.headers?.['content-disposition']
    ) || `reporte_${tipo.replace('-', '_')}_${fecha_inicio}_${fecha_fin}.xlsx`

  descargarArchivo(respuesta.data, nombreArchivo)

  return { archivo: nombreArchivo }
}
