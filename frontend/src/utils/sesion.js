/**
 * utils/sesion.js
 * ---------------------------------------------------------------------------
 * Cuánto le queda de vida al token que hay guardado.
 *
 * El JWT ya trae su `exp`; el frontend solo tenía que mirarlo y nunca lo
 * hacía, así que la sesión se acababa sin aviso: el técnico se enteraba
 * cuando el envío de la evidencia devolvía 401 y la aplicación lo mandaba a
 * login, con lo escrito dentro.
 *
 * Se lee el payload a mano en vez de añadir una librería de JWT: es base64url
 * y aquí NO se valida nada. La firma la comprueba el backend; esto solo sirve
 * para saber cuándo avisar, y un token manipulado no gana nada engañando a su
 * propio reloj — lo único que conseguiría es que su dueño viera el aviso a
 * destiempo.
 * ---------------------------------------------------------------------------
 */

/** Cuánto antes del vencimiento se avisa. */
export const MARGEN_AVISO_MS = 5 * 60 * 1000

/**
 * Payload del JWT, o null si no se puede leer.
 *
 * Nunca lanza: un token cortado, de otra versión o con basura dentro tiene
 * que acabar en "no sé cuándo vence", no en una pantalla rota.
 */
export function leerPayload(token) {
  if (typeof token !== 'string') return null

  const partes = token.split('.')
  if (partes.length !== 3) return null

  try {
    // base64url → base64, con el relleno que atob exige.
    const base64 = partes[1].replace(/-/g, '+').replace(/_/g, '/')
    const relleno = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
    const json = decodeURIComponent(
      atob(relleno)
        .split('')
        .map((caracter) => `%${caracter.charCodeAt(0).toString(16).padStart(2, '0')}`)
        .join('')
    )
    return JSON.parse(json)
  } catch {
    return null
  }
}

/** Momento de vencimiento en milisegundos, o null si el token no lo dice. */
export function vencimientoDe(token) {
  const payload = leerPayload(token)
  // `exp` viaja en segundos; el resto del frontend trabaja en milisegundos.
  return typeof payload?.exp === 'number' ? payload.exp * 1000 : null
}

/**
 * Milisegundos que faltan para que venza. Negativo si ya venció, null si no
 * se puede saber.
 */
export function restanteDe(token, ahora = Date.now()) {
  const vence = vencimientoDe(token)
  return vence === null ? null : vence - ahora
}

/**
 * Cuándo hay que enseñar el aviso, en milisegundos desde ahora.
 *
 * Cero cuando ya está dentro del margen (hay que avisar ya mismo) y null
 * cuando no hay nada que programar: sin token, sin `exp`, o ya vencido — ahí
 * no toca avisar, toca cerrar la sesión.
 */
export function msHastaAviso(token, ahora = Date.now(), margen = MARGEN_AVISO_MS) {
  const restante = restanteDe(token, ahora)
  if (restante === null || restante <= 0) return null
  return Math.max(restante - margen, 0)
}

/**
 * Milisegundos → "4:07", para la cuenta atrás del aviso.
 *
 * Nunca baja de cero: con el reloj del equipo adelantado el restante puede
 * salir negativo, y "-0:03" en pantalla parece un fallo.
 */
export function cuentaAtras(ms) {
  const segundos = Math.max(0, Math.floor(ms / 1000))
  const minutos = Math.floor(segundos / 60)
  return `${minutos}:${String(segundos % 60).padStart(2, '0')}`
}
