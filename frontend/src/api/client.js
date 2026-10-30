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
import { registrarErrorServidor } from '../utils/ultimoErrorServidor'

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
 * Convierte el enlace firmado que entrega la API (`/archivos/...?exp=&firma=`)
 * en URL absoluta. Las pantallas usan ese enlace tal cual y no arman la ruta
 * del archivo; sin esto las imágenes apuntarían al dominio del frontend.
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

/* ── Reintento de los fallos de red (RTF-01 / R1-2) ──────────────────────
 *
 * En la revisión técnica aparecieron errores intermitentes de conexión
 * («No se pudo cargar el panel», «No se pudo verificar la bitácora»), con
 * `AxiosError: Network Error`, que al reintentar a mano funcionaban. El
 * patrón es el arranque en frío del backend en Railway: la primera petición
 * después de un rato sin tráfico llega mientras el contenedor todavía
 * levanta, y muere sin respuesta.
 *
 * Lo que se reintenta y lo que no:
 *
 *   · Sin `error.response` —la petición no llegó o no volvió— se reintenta.
 *     Ahí no hay nada que pueda haber pasado a medias en el servidor.
 *   · 502, 503 y 504: el proxy contesta por un backend que no está. Tampoco
 *     procesó nada.
 *   · Cualquier respuesta del backend (400, 401, 409, 500…) NO se reintenta:
 *     el servidor ya decidió, y repetir un 500 solo repite el error.
 *
 * Solo métodos idempotentes. Un POST que no devolvió respuesta puede haberse
 * ejecutado igual —marcar entrada, crear una tarea, registrar una evidencia—
 * y repetirlo crearía la fila dos veces. Esos se dejan al usuario, que tiene
 * la pantalla delante y sabe si la acción surtió efecto.
 */
const METODOS_REINTENTABLES = new Set(['get', 'head', 'options'])
const ESTADOS_REINTENTABLES = new Set([502, 503, 504])
const MAX_REINTENTOS = 2
const ESPERA_BASE_MS = 400

function sePuedeReintentar(error) {
  const config = error.config
  if (!config) return false
  if (!METODOS_REINTENTABLES.has((config.method || 'get').toLowerCase())) {
    return false
  }
  // Una llamada puede pedir que no se reintente (p. ej. un sondeo que ya corre
  // en bucle y no gana nada esperando).
  if (config.sinReintento) return false
  if (!error.response) return true
  return ESTADOS_REINTENTABLES.has(error.response.status)
}

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/* ── Response Interceptor ────────────────────────────────────────────── */
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    // RTF-01 / R1-2: el arranque en frío del backend tira la primera petición
    // sin respuesta. Se reintenta antes de molestar al usuario con un error
    // que se arregla solo. La espera crece entre intentos para darle tiempo al
    // contenedor a levantar.
    if (sePuedeReintentar(error)) {
      const config = error.config
      config.__reintentos = (config.__reintentos || 0) + 1
      if (config.__reintentos <= MAX_REINTENTOS) {
        await esperar(ESPERA_BASE_MS * config.__reintentos)
        return apiClient(config)
      }
    }

    // HU-S10-04: se recuerda el request_id de los 5xx para mostrarlo en la
    // pantalla de error y que se pueda reportar.
    registrarErrorServidor(error)

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