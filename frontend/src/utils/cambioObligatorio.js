/**
 * utils/cambioObligatorio.js
 * ---------------------------------------------------------------------------
 * Cambio de contraseña obligatorio (HU-S10-01, tarea 4).
 *
 * Quien entra con una contraseña que le puso otra persona (un admin al crearle
 * la cuenta o al restablecérsela) no puede usar el sistema hasta cambiarla. El
 * backend lo impone: mientras `debe_cambiar_contrasena` esté en true, solo deja
 * pasar /auth/me, /auth/perfil, /auth/cambiar-contrasena, /auth/renovar y
 * /auth/logout; todo lo demás responde 403 con `error: PASSWORD_CHANGE_REQUIRED`.
 *
 * El frontend lo refleja por dos caminos, para que ninguno dependa del otro:
 *   1. El campo `debe_cambiar_contrasena` del usuario (lo trae GET /auth/me):
 *      ProtectedRoute lleva a la pantalla de cambio sin esperar a un error.
 *   2. El 403 con ese código: el interceptor de axios avisa con un evento y
 *      AuthContext marca al usuario. Cubre el caso de que la bandera cambie con
 *      la pantalla ya abierta (un admin restablece la clave en pleno turno).
 *
 * Vive en utils/ y no en api/client.js para que AuthContext pueda importar las
 * constantes sin depender de todo el cliente de axios.
 * ---------------------------------------------------------------------------
 */

export const CODIGO_CAMBIO_OBLIGATORIO = 'PASSWORD_CHANGE_REQUIRED'

/** Evento que emite el interceptor cuando el backend exige el cambio. */
export const EVENTO_CAMBIO_OBLIGATORIO = 'teleprogreso:cambio-contrasena-obligatorio'

/** Pantalla a la que se encierra al usuario hasta que cambie la contraseña. */
export const RUTA_CAMBIO_OBLIGATORIO = '/cambiar-contrasena'

/** ¿Es este error de axios el 403 de "cambia tu contraseña primero"? */
export function esErrorCambioObligatorio(error) {
  return (
    error?.response?.status === 403 &&
    error?.response?.data?.error === CODIGO_CAMBIO_OBLIGATORIO
  )
}

/** ¿Tiene este usuario el cambio de contraseña pendiente? */
export function debeCambiarContrasena(user) {
  return user?.debe_cambiar_contrasena === true
}