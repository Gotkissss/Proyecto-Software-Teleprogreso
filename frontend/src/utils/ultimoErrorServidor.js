/**
 * utils/ultimoErrorServidor.js
 * ---------------------------------------------------------------------------
 * HU-S10-04 (tarea 5): guarda el `request_id` del último error 5xx que contestó
 * el backend. Es el mismo identificador que queda en la bitácora y en los logs,
 * así que quien vea la pantalla "algo salió mal" puede dictarlo y el equipo
 * encuentra la fila exacta.
 *
 * Vive en memoria (no en localStorage): solo sirve durante la sesión abierta,
 * y un identificador de petición no debe sobrevivir a una recarga.
 * ---------------------------------------------------------------------------
 */

let ultimoRequestId = null

/**
 * Lee el request_id de una respuesta de error de axios (cuerpo o cabecera) y,
 * si el estado es 5xx, lo recuerda.
 *
 * @param {object} error  error de axios
 * @returns {string|null} el id guardado, o null si no hubo ninguno
 */
export function registrarErrorServidor(error) {
  const respuesta = error?.response
  if (!respuesta || respuesta.status < 500) return null

  const id = respuesta.data?.request_id || respuesta.headers?.['x-request-id'] || null
  if (typeof id === 'string' && id) {
    ultimoRequestId = id
    return id
  }
  return null
}

/** El request_id del último error 5xx, o null si no ha habido ninguno. */
export function obtenerUltimoRequestId() {
  return ultimoRequestId
}

/** Solo para las pruebas. */
export function olvidarUltimoRequestId() {
  ultimoRequestId = null
}
