/**
 * api/client.js
 * ---------------------------------------------------------------------------
 * Cliente Axios centralizado para Teleprogreso S.A.
 * ---------------------------------------------------------------------------
 */

import axios from 'axios'
import {
  EVENTO_CAMBIO_OBLIGATORIO,
  esErrorCambioObligatorio,
} from '../utils/cambioObligatorio'

// Resolución de la URL base del API:
// 1. Si la build inyectó VITE_API_URL (Railway / .env.production) → usarla.
// 2. Si estamos en localhost (desarrollo local) → backend local.
// 3. Fallback: backend de Railway (mantiene compatibilidad si la build
//    de prod se hizo sin VITE_API_URL).
const isLocalhost =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' ||
   window.location.hostname === '127.0.0.1')

export const BASE_URL =
  import.meta.env.VITE_API_URL ||
  (isLocalhost
    ? 'http://localhost:8000'
    : 'https://backend-production-6d60.up.railway.app')

/**
 * Convierte una ruta de archivo del backend (`/static/...`) en URL absoluta.
 * El backend guarda las fotos de activos y de evidencias como rutas relativas;
 * sin esto las imágenes apuntarían al dominio del frontend y saldrían rotas.
 *
 * @param {string|null|undefined} ruta
 * @returns {string|null}
 */
export function urlArchivo(ruta) {
  if (!ruta) return null
  return ruta.startsWith('http') ? ruta : BASE_URL + ruta
}

const apiClient = axios.create({
  baseURL: BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 15000,
})

/* ── Request Interceptor ──────────────────────────────────────────────── */
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('access_token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

/**
 * Evento con el que el cliente avisa de que la sesión dejó de valer.
 *
 * Antes este interceptor hacía `window.location.href = '/login'`: una recarga
 * completa del navegador que tira el árbol de React entero. Lo que el técnico
 * estuviera escribiendo —las notas de la evidencia, por ejemplo— se perdía sin
 * aviso, y con varias peticiones en vuelo la página se recargaba una vez por
 * cada 401.
 *
 * Ahora solo se emite esto. Quién navega es AuthContext, con React Router, que
 * conserva el estado de la aplicación y puede explicar el motivo.
 */
export const EVENTO_SESION_CADUCADA = 'teleprogreso:sesion-caducada'

// Single-flight: con cinco peticiones en vuelo llegan cinco 401, y sin esta
// bandera se emitirían cinco eventos y se dispararían cinco navegaciones. Se
// rearma al volver a entrar (ver `marcarSesionIniciada`).
let sesionYaCaducada = false

/** Rearma el aviso. Lo llama el login, una vez que hay sesión nueva. */
export function marcarSesionIniciada() {
  sesionYaCaducada = false
}

/* ── Response Interceptor ────────────────────────────────────────────── */
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('access_token')
      localStorage.removeItem('user')

      if (!sesionYaCaducada) {
        sesionYaCaducada = true
        window.dispatchEvent(new CustomEvent(EVENTO_SESION_CADUCADA))
      }
    } else if (esErrorCambioObligatorio(error)) {
      // HU-S10-01: la sesión sigue siendo válida, pero el backend no deja hacer
      // nada hasta cambiar la contraseña. NO se borra el token (hace falta para
      // llamar a /auth/cambiar-contrasena); solo se avisa y AuthContext marca
      // al usuario para que ProtectedRoute lo lleve a la pantalla de cambio.
      window.dispatchEvent(new CustomEvent(EVENTO_CAMBIO_OBLIGATORIO))
    }
    return Promise.reject(error)
  }
)

export default apiClient