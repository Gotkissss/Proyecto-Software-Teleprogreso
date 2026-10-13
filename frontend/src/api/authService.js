import apiClient, { marcarSesionIniciada } from './client'

export const login = async (correo, contrasena) => {
  const { data } = await apiClient.post('/auth/login', {
    correo,
    contrasena,
  })
  localStorage.setItem('access_token', data.access_token)
  // Rearma el aviso de sesión caducada, que se desactiva tras el primer 401
  // para no disparar una navegación por cada petición en vuelo.
  marcarSesionIniciada()
  return data
}

/**
 * Pide un token nuevo para la sesión en curso (POST /auth/renovar).
 *
 * Single-flight: si el aviso de vencimiento y una recarga de pantalla piden
 * renovar a la vez, la segunda llamada se engancha a la primera en vez de
 * emitir dos tokens. No es solo eficiencia: cada renovación REVOCA el token
 * anterior, así que dos renovaciones en paralelo pueden dejar como vigente
 * uno que la otra acaba de invalidar, y la sesión se cae justo al intentar
 * salvarla.
 */
let renovacionEnVuelo = null

export const renovarSesion = () => {
  if (renovacionEnVuelo) return renovacionEnVuelo

  renovacionEnVuelo = apiClient
    .post('/auth/renovar')
    .then(({ data }) => {
      localStorage.setItem('access_token', data.access_token)
      marcarSesionIniciada()
      return data
    })
    .finally(() => {
      renovacionEnVuelo = null
    })

  return renovacionEnVuelo
}

export const getMe = async () => {
  const { data } = await apiClient.get('/auth/me')
  return data
}

export const logout = async () => {
  try {
    await apiClient.post('/auth/logout')
  } catch (_) {
    // ignorar si falla
  }
  localStorage.removeItem('access_token')
  localStorage.removeItem('user')
}
/**
 * Datos del empleado autenticado para la pantalla de perfil.
 *
 * `/auth/me` devuelve lo mínimo que necesita el layout (nombre completo, rol);
 * el perfil además muestra teléfono, fecha de contratación, alta y último
 * acceso, que solo vienen por aquí.
 *
 * Endpoint: GET /auth/perfil
 */
export const getPerfil = async () => {
  const { data } = await apiClient.get('/auth/perfil')
  return data
}

/**
 * Cambia la contraseña del propio usuario.
 *
 * Ojo: al guardarla, el backend sube la versión de sesión del empleado, así
 * que el token con el que se hizo la llamada queda inválido de inmediato y
 * hay que volver a iniciar sesión. Por eso esta función borra el token: si se
 * dejara, la siguiente petición devolvería 401 y el usuario vería un error
 * confuso en lugar de la pantalla de login.
 *
 * Endpoint: POST /auth/cambiar-contrasena
 */
export const cambiarContrasena = async ({
  contrasenaActual,
  nuevaContrasena,
  confirmacion,
}) => {
  const { data } = await apiClient.post('/auth/cambiar-contrasena', {
    contrasena_actual: contrasenaActual,
    nueva_contrasena: nuevaContrasena,
    confirmacion_contrasena: confirmacion,
  })
  localStorage.removeItem('access_token')
  localStorage.removeItem('user')
  return data
}
