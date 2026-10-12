/**
 * utils/reportes.js
 * ---------------------------------------------------------------------------
 * Cálculos puros de la pantalla de reportes (HU-S9-04): periodo anterior
 * equivalente, variación porcentual, formatos y escala de los gráficos.
 * Viven aquí para poder probarlos sin montar la pantalla.
 * ---------------------------------------------------------------------------
 */

import { aISO } from './fecha'

function aFecha(ymd) {
  const [anio, mes, dia] = ymd.split('-').map(Number)
  return new Date(anio, mes - 1, dia)
}

function ultimoDiaDelMes(anio, mes) {
  return new Date(anio, mes + 1, 0).getDate()
}

/**
 * Periodo anterior equivalente, para comparar los KPIs.
 *
 * - Si el rango empieza el día 1 y no sale de ese mes ("este mes", "mes
 *   pasado"), se compara con los mismos días del mes anterior: del 1 al 12 de
 *   octubre contra del 1 al 12 de septiembre (recortado si el mes es más
 *   corto).
 * - En cualquier otro caso, el mismo número de días justo antes: una semana
 *   contra la semana previa, un día contra el día anterior.
 *
 * @param {{fecha_inicio:string, fecha_fin:string}} rango
 * @returns {{fecha_inicio:string, fecha_fin:string}}
 */
export function periodoAnterior({ fecha_inicio, fecha_fin }) {
  const inicio = aFecha(fecha_inicio)
  const fin = aFecha(fecha_fin)

  const mismoMes = inicio.getFullYear() === fin.getFullYear() && inicio.getMonth() === fin.getMonth()
  if (inicio.getDate() === 1 && mismoMes) {
    const anio = inicio.getMonth() === 0 ? inicio.getFullYear() - 1 : inicio.getFullYear()
    const mes = (inicio.getMonth() + 11) % 12
    const diaFin = Math.min(fin.getDate(), ultimoDiaDelMes(anio, mes))
    return { fecha_inicio: aISO(new Date(anio, mes, 1)), fecha_fin: aISO(new Date(anio, mes, diaFin)) }
  }

  const dias = Math.round((fin - inicio) / 86_400_000) + 1
  const finAnterior = new Date(inicio)
  finAnterior.setDate(finAnterior.getDate() - 1)
  const inicioAnterior = new Date(inicio)
  inicioAnterior.setDate(inicioAnterior.getDate() - dias)
  return { fecha_inicio: aISO(inicioAnterior), fecha_fin: aISO(finAnterior) }
}

/**
 * Variación en % de `actual` respecto de `anterior`, con un decimal.
 * null cuando no hay base (anterior 0 o ausente): "+∞ %" no informa nada.
 */
export function variacionPorcentual(actual, anterior) {
  if (anterior === null || anterior === undefined || anterior === 0) return null
  return Math.round(((actual - anterior) / Math.abs(anterior)) * 1000) / 10
}

/** Días del rango, inclusivos. */
export function diasDelRango({ fecha_inicio, fecha_fin }) {
  return Math.round((aFecha(fecha_fin) - aFecha(fecha_inicio)) / 86_400_000) + 1
}

/** "2026-10-05" → "5 oct" (con `conAnio`, "5 oct 2026"). */
export function fechaCorta(ymd, { conAnio = false } = {}) {
  return aFecha(ymd).toLocaleDateString('es-GT', {
    day: 'numeric',
    month: 'short',
    ...(conAnio ? { year: 'numeric' } : {}),
  })
}

/** Texto del rango para leyendas y comparaciones: "1 – 12 oct 2026". */
export function textoRango({ fecha_inicio, fecha_fin }) {
  if (fecha_inicio === fecha_fin) return fechaCorta(fecha_inicio, { conAnio: true })
  return `${fechaCorta(fecha_inicio)} – ${fechaCorta(fecha_fin, { conAnio: true })}`
}

/** 1284 → "1,284"; 12.5 → "12.5". Agrupa miles con el formato local. */
export function formatoNumero(valor, decimales = 0) {
  return Number(valor ?? 0).toLocaleString('es-GT', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimales,
  })
}

/** 750 minutos → "12:30" (mismo formato que los reportes del backend). */
export function minutosAHoras(minutos) {
  const total = Math.max(0, Math.round(minutos ?? 0))
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/**
 * Marcas limpias del eje Y: 0 y múltiplos de 1, 2, 2.5 o 5 por potencia de
 * diez, de forma que el máximo quede dentro. Nunca un eje sin escala: con
 * todo en 0, el eje va de 0 a 1.
 */
export function marcasEje(maximo, cantidad = 4) {
  const tope = maximo > 0 ? maximo : 1
  const crudo = tope / cantidad
  const potencia = 10 ** Math.floor(Math.log10(crudo))
  const paso = [1, 2, 2.5, 5, 10].map((f) => f * potencia).find((p) => p >= crudo)
  const pasos = Math.ceil(tope / paso - 1e-9)
  return Array.from({ length: pasos + 1 }, (_, i) => Math.round(i * paso * 1000) / 1000)
}

/**
 * Ordena filas por una columna sin mutar el arreglo. Texto con
 * localeCompare (acentos bien ordenados); números por valor. Los empates se
 * resuelven por nombre para que el orden sea estable.
 */
export function ordenarFilas(filas, columna, direccion = 'desc') {
  const signo = direccion === 'asc' ? 1 : -1
  return [...filas].sort((a, b) => {
    const va = a[columna]
    const vb = b[columna]
    const comparacion =
      typeof va === 'string' || typeof vb === 'string'
        ? String(va ?? '').localeCompare(String(vb ?? ''), 'es')
        : (va ?? 0) - (vb ?? 0)
    return comparacion * signo || String(a.nombre_empleado).localeCompare(String(b.nombre_empleado), 'es')
  })
}

/** Unidades de la serie y cómo se escribe un valor de cada una. */
export const METRICAS_SERIE = [
  { clave: 'horas', etiqueta: 'Horas trabajadas', formato: (v) => `${formatoNumero(v, 1)} h` },
  { clave: 'tareas', etiqueta: 'Tareas completadas', formato: (v) => formatoNumero(v) },
  { clave: 'pausas', etiqueta: 'Tiempo en pausa', formato: (v) => `${formatoNumero(v)} min` },
]

export function metricaSerie(clave) {
  return METRICAS_SERIE.find((m) => m.clave === clave) ?? METRICAS_SERIE[0]
}

/**
 * Indicadores de la cabecera, calculados del resumen. `sentido` dice si
 * subir es bueno (1), malo (-1) o ni lo uno ni lo otro (0): decide el color
 * de la variación, que además lleva flecha y texto.
 */
export const KPIS = [
  { clave: 'total_minutos_trabajados', etiqueta: 'Horas trabajadas', sentido: 1, formato: minutosAHoras },
  { clave: 'total_tareas_completadas', etiqueta: 'Tareas completadas', sentido: 1, formato: (v) => formatoNumero(v) },
  { clave: 'tareas_por_hora', etiqueta: 'Tareas por hora', sentido: 1, formato: (v) => formatoNumero(v, 2) },
  { clave: 'total_jornadas', etiqueta: 'Jornadas', sentido: 0, formato: (v) => formatoNumero(v) },
  { clave: 'total_minutos_descanso', etiqueta: 'Tiempo en descanso', sentido: 0, formato: minutosAHoras },
  { clave: 'total_jornadas_abiertas', etiqueta: 'Jornadas sin cerrar', sentido: -1, formato: (v) => formatoNumero(v) },
]

/**
 * Tono de una variación: 'bueno', 'malo' o 'neutro', según el sentido del
 * indicador. Sin variación (null o 0) siempre es neutro.
 */
export function tonoVariacion(variacion, sentido) {
  if (!variacion || sentido === 0) return 'neutro'
  return Math.sign(variacion) === sentido ? 'bueno' : 'malo'
}
