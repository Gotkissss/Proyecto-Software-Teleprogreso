/**
 * utils/formulario.js
 * ---------------------------------------------------------------------------
 * RTF-01 / R2-10: al enviar Nueva tarea sin título, el aviso aparecía arriba
 * del formulario pero la pantalla no subía hasta él. En un formulario largo
 * —el de tarea llega al mapa— el usuario pulsaba «Crear» y no pasaba nada
 * visible, así que volvía a pulsar.
 *
 * Esto lleva el foco al primer campo que está mal. El foco, y no solo el
 * desplazamiento, porque es lo que además anuncia el error a un lector de
 * pantalla y deja el cursor donde hay que escribir.
 * ---------------------------------------------------------------------------
 */

/**
 * Enfoca y trae a la vista el primer campo con error.
 *
 * Los campos se marcan en el JSX con `data-campo="<nombre>"`; el orden lo
 * decide `orden`, que normalmente es el de las claves del formulario, para que
 * «el primero» sea el primero de arriba abajo y no el primero que el objeto de
 * errores enumere.
 *
 * @param {Object} errores - {campo: mensaje}
 * @param {string[]} orden - nombres de campo, de arriba abajo
 * @param {HTMLElement|Document} [raiz] - dónde buscar
 * @returns {string|null} el campo enfocado, o null si no se encontró ninguno
 */
export function enfocarPrimerError(errores, orden, raiz = document) {
  if (!errores || !raiz) return null

  const conError = (orden ?? []).filter((campo) => errores[campo])
  for (const campo of conError) {
    const elemento = raiz.querySelector(`[data-campo="${campo}"]`)
    if (!elemento) continue

    // `focus` ya desplaza en todos los navegadores actuales, pero sin
    // suavizado y a veces dejando el campo pegado al borde; `scrollIntoView`
    // lo centra para que se vea también su mensaje.
    if (typeof elemento.scrollIntoView === 'function') {
      elemento.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
    if (typeof elemento.focus === 'function') {
      elemento.focus({ preventScroll: true })
    }
    return campo
  }
  return null
}
