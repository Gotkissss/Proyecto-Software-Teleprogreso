/**
 * utils/plural.js
 * ---------------------------------------------------------------------------
 * Concordancia de número en los textos de la interfaz.
 *
 * RTF-01 / R2-9: el panel decía «1 tareas activas» y Nueva tarea, para lo
 * mismo, «1 tarea activa». No es solo una falta: cuando la pantalla escribe
 * mal lo que sabe contar, el resto de lo que dice también se lee con dudas.
 *
 * Son funciones y no plantillas sueltas porque el caso de «1» aparece en
 * cuatro pantallas y cada una lo resolvía por su cuenta, o no lo resolvía.
 * ---------------------------------------------------------------------------
 */

/**
 * «1 tarea» / «3 tareas».
 *
 * @param {number} cantidad
 * @param {string} singular - la palabra tal cual se escribe con uno
 * @param {string} [plural]  - por defecto, el singular con «s»
 */
export function contar(cantidad, singular, plural = `${singular}s`) {
  const n = Number(cantidad) || 0
  return `${n} ${n === 1 ? singular : plural}`
}

/** «1 tarea activa» / «0 tareas activas». */
export function contarTareas(cantidad) {
  return contar(cantidad, 'tarea activa', 'tareas activas')
}

/** «1 jornada» / «12 jornadas». */
export function contarJornadas(cantidad) {
  return contar(cantidad, 'jornada')
}

/** «1 alerta» / «5 alertas». */
export function contarAlertas(cantidad) {
  return contar(cantidad, 'alerta')
}
