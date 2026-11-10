/**
 * utils/jornada.js
 * ---------------------------------------------------------------------------
 * Cuánto lleva el técnico desde que marcó entrada, en palabras.
 *
 * El backend manda la hora de entrada del día (`hora_entrada`, "07:35:00") y
 * la cuenta se hace aquí, contra el reloj del teléfono: así el número avanza
 * solo entre una consulta y la siguiente, en lugar de quedarse congelado en
 * el valor que vino del servidor.
 *
 * Es tiempo en jornada, no tiempo trabajado: no descuenta las pausas. La
 * pantalla lo dice con esas palabras para que nadie lea una cosa por la otra;
 * el desglose con pausas está en la pantalla de Pausas.
 * ---------------------------------------------------------------------------
 */

/**
 * Segundos transcurridos desde la hora de entrada de hoy.
 * Devuelve null si no hay hora, y 0 si la hora cae en el futuro (relojes
 * desfasados): un contador en negativo se lee como un error de la aplicación.
 */
export function segundosEnJornada(horaEntrada, ahora = new Date()) {
  if (!horaEntrada || typeof horaEntrada !== 'string') return null

  const [h, m, s] = horaEntrada.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null

  const entrada = new Date(ahora)
  entrada.setHours(h, m, Number.isFinite(s) ? s : 0, 0)

  return Math.max(0, Math.floor((ahora.getTime() - entrada.getTime()) / 1000))
}

/**
 * Segundos → "4 h 20 min" / "45 min". Sin segundos a la vista: es un dato que
 * se mira de reojo entre una tarea y otra, no un cronómetro.
 */
export function duracionCorta(segundos) {
  if (segundos == null || !Number.isFinite(segundos)) return null

  const minutos = Math.floor(segundos / 60)
  const horas = Math.floor(minutos / 60)

  if (horas === 0) return `${minutos} min`
  return `${horas} h ${String(minutos % 60).padStart(2, '0')} min`
}
