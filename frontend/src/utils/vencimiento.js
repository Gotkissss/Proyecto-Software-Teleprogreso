/**
 * utils/vencimiento.js
 * ---------------------------------------------------------------------------
 * Lectura humana de la fecha límite de una tarea.
 *
 * Mostrar solo "2026-08-07" obliga a hacer la cuenta mental de cuánto falta.
 * Estas funciones convierten esa fecha en "Vence hoy", "Faltan 2 días" o
 * "Vencida hace 3 días", que es lo que el supervisor necesita para priorizar.
 *
 * Se trabaja a nivel de día, no de hora: `fecha_finalizacion` es una fecha
 * (columna DATE en la base), así que hablar de horas sería inventar precisión
 * que el dato no tiene.
 * ---------------------------------------------------------------------------
 */

/** Estados en los que la tarea ya no corre contra el reloj. */
const ESTADOS_CERRADOS = ['completado', 'cancelado']

/**
 * Convierte "YYYY-MM-DD" en un Date local a medianoche.
 *
 * `new Date('2026-08-07')` lo interpreta como UTC y en Guatemala (UTC-6) cae
 * el día anterior a las 18:00, así que una tarea que vence hoy aparecería como
 * vencida ayer. Por eso se construye componente a componente.
 */
export function parsearFechaLocal(valor) {
  if (!valor) return null
  const [y, m, d] = String(valor).slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

/** Días entre hoy y la fecha límite. Negativo = ya venció. */
export function diasRestantes(fechaLimite, hoy = new Date()) {
  const limite = parsearFechaLocal(fechaLimite)
  if (!limite) return null

  const hoySinHora = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())
  const MS_POR_DIA = 24 * 60 * 60 * 1000
  return Math.round((limite - hoySinHora) / MS_POR_DIA)
}

/**
 * Descripción del vencimiento de una tarea.
 *
 * @returns {{texto: string, variant: string, vencida: boolean} | null}
 *   null cuando no hay fecha límite o la tarea ya está cerrada.
 */
export function describirVencimiento(tarea) {
  const estado = tarea?.estado_tarea ?? tarea?.estado
  if (ESTADOS_CERRADOS.includes(estado)) return null

  const dias = diasRestantes(tarea?.fecha_finalizacion)
  if (dias === null) return null

  if (dias < 0) {
    const n = Math.abs(dias)
    return {
      texto: n === 1 ? 'Vencida ayer' : `Vencida hace ${n} días`,
      variant: 'danger',
      vencida: true,
    }
  }
  if (dias === 0) return { texto: 'Vence hoy',    variant: 'danger',  vencida: false }
  if (dias === 1) return { texto: 'Vence mañana', variant: 'warning', vencida: false }
  if (dias <= 3)  return { texto: `Faltan ${dias} días`, variant: 'warning', vencida: false }

  return { texto: `Faltan ${dias} días`, variant: 'muted', vencida: false }
}

/** Fecha en formato corto y legible: "7 ago 2026". */
export function formatearFecha(valor) {
  const fecha = parsearFechaLocal(valor)
  if (!fecha) return null
  return fecha.toLocaleDateString('es-GT', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}
