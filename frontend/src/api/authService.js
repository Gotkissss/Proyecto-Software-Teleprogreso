import apiClient from './client'

export const login = async (correo, contrasena) => {
  const { data } = await apiClient.post('/auth/login', {
    correo,
    contrasena,
  })
  localStorage.setItem('access_token', data.access_token)
  return data
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
