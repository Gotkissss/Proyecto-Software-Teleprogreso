/**
 * utils/fecha.js
 * ---------------------------------------------------------------------------
 * Fechas "de calendario" (YYYY-MM-DD) sin pasar por `Date`.
 *
 * El backend guarda y devuelve las marcas de tiempo ya en hora de Guatemala y
 * sin zona ("2026-08-21T15:04:00" — ver app/core/tiempo.py). Al meterlas en
 * `new Date(...)` el navegador las reinterpreta con SU zona horaria, y una
 * tarea cerrada por la tarde podía contarse como del día siguiente (o del
 * anterior) según dónde estuviera abierta la pantalla. Peor todavía con las
 * fechas sin hora: `new Date('2026-08-21')` se parsea como UTC, así que en
 * Guatemala cae a las 18:00 del día 20.
 *
 * Comparando el texto "YYYY-MM-DD" no hay reinterpretación posible: el día que
 * dice el servidor es el día que se usa.
 * ---------------------------------------------------------------------------
 */

/** Date → "YYYY-MM-DD" en hora local (nunca toISOString, que pasa por UTC). */
export function aISO(fecha) {
  const mes = String(fecha.getMonth() + 1).padStart(2, '0')
  const dia = String(fecha.getDate()).padStart(2, '0')
  return `${fecha.getFullYear()}-${mes}-${dia}`
}

/** Hoy como "YYYY-MM-DD", en el día del calendario del usuario. */
export function hoyISO() {
  return aISO(new Date())
}

/** "2026-08-21T15:04:00" → "2026-08-21" (null si no hay valor). */
export function soloFecha(fechaHora) {
  return fechaHora ? String(fechaHora).slice(0, 10) : null
}

/**
 * ¿`fechaHora` cae en el día `fechaISO`?
 *
 * Sin marca de tiempo la respuesta es `false`: no se puede afirmar el día de
 * algo que no lo tiene registrado.
 */
export function esDelDia(fechaHora, fechaISO) {
  const dia = soloFecha(fechaHora)
  return dia !== null && dia === fechaISO
}
