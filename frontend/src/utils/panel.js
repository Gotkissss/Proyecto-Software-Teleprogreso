/**
 * utils/panel.js
 * ---------------------------------------------------------------------------
 * Lo que el panel del supervisor calcula a partir de sus propias métricas,
 * sin pedir nada más al backend.
 *
 * Está aquí y no dentro de la pantalla porque son las cuentas que, si salen
 * mal, hacen que el panel mienta: un porcentaje de avance que no cuadra con
 * las tarjetas de arriba es peor que no tener porcentaje.
 * ---------------------------------------------------------------------------
 */

/** Saludo según la hora, para la cabecera del panel. */
export function saludoPorHora(fecha = new Date()) {
  const h = fecha.getHours()
  if (h < 12) return 'Buenos días'
  if (h < 19) return 'Buenas tardes'
  return 'Buenas noches'
}

/** "viernes, 30 de octubre" — la fecha larga de la cabecera. */
export function fechaLarga(fecha = new Date()) {
  return fecha.toLocaleDateString('es-GT', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

/**
 * Cuánto hace que se cargaron los datos, en palabras.
 *
 * El panel no se refresca solo: carga una vez al entrar. Decir cuándo fue
 * no es un adorno, es lo que evita que alguien tome una decisión con un
 * número de hace dos horas creyendo que es de ahora.
 */
export function hace(desde, ahora = Date.now()) {
  if (!desde) return null

  const segundos = Math.max(0, Math.floor((ahora - desde) / 1000))
  if (segundos < 60) return 'hace un momento'

  const minutos = Math.floor(segundos / 60)
  if (minutos < 60) return `hace ${minutos} min`

  const horas = Math.floor(minutos / 60)
  if (horas < 24) return `hace ${horas} h`

  const dias = Math.floor(horas / 24)
  return dias === 1 ? 'hace 1 día' : `hace ${dias} días`
}

/**
 * El día repartido en tres tramos, para la barra de avance.
 *
 * El total es lo que hay hoy sobre la mesa: lo cerrado más lo que sigue
 * abierto. Las retrasadas **no** suman: son un subconjunto de pendientes y en
 * curso, no una cuarta categoría, y contarlas aparte inflaría el total y
 * dejaría un porcentaje que no cuadra con las tarjetas de arriba. Se
 * devuelven igualmente porque la barra las señala como aviso.
 *
 * Con el día vacío se devuelve `total: 0` y `porcentaje: 0`: dividir entre
 * cero daría NaN y la barra se pintaría con un ancho inválido.
 */
export function repartoDelDia(metricas) {
  const completadas = Math.max(0, metricas?.tareas_completadas_hoy ?? 0)
  const enCurso     = Math.max(0, metricas?.tareas_en_progreso ?? 0)
  const pendientes  = Math.max(0, metricas?.tareas_pendientes ?? 0)
  const retrasadas  = Math.max(0, metricas?.tareas_retrasadas ?? 0)

  const total = completadas + enCurso + pendientes

  return {
    completadas,
    enCurso,
    pendientes,
    retrasadas,
    total,
    porcentaje: total === 0 ? 0 : Math.round((completadas / total) * 100),
  }
}

/**
 * Qué parte de un todo representa una cifra, de 0 a 1, o `null` si la cifra
 * no tiene un todo con el que compararse.
 *
 * El `null` es importante: hay tarjetas del panel ("En curso") que son un
 * número suelto, sin denominador. Pintarles una barra obligaría a inventar
 * un total, y una barra inventada se lee como un dato.
 */
export function proporcion(parte, todo) {
  if (!Number.isFinite(parte) || !Number.isFinite(todo) || todo <= 0) return null
  return Math.min(1, Math.max(0, parte / todo))
}
