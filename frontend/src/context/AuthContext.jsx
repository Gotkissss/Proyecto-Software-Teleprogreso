/**
 * context/AuthContext.jsx
 * ---------------------------------------------------------------------------
 * Sesión del usuario: quién entró y, desde la HU-S9-05, cuánto le queda.
 *
 * El JWT dura una hora. Antes nadie miraba su `exp`, así que la sesión se
 * acababa en seco: la siguiente petición devolvía 401 y el interceptor de
 * axios hacía `window.location.href = '/login'`, una recarga completa del
 * navegador. El técnico que llevaba diez minutos escribiendo el informe de una
 * tarea lo perdía sin aviso y sin entender por qué.
 *
 * Ahora el token se mira: cinco minutos antes del corte sale un aviso con la
 * opción de seguir conectado, y cuando la sesión sí muere se navega con React
 * Router —sin recargar— a /login?expirado=1, que explica lo que pasó.
 * ---------------------------------------------------------------------------
 */

import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { login, getMe, logout, renovarSesion } from '../api/authService'
import { EVENTO_SESION_CADUCADA } from '../api/client'
import AvisoSesion from '../components/layout/AvisoSesion'
import { rutaInicialPorRol } from '../utils/permisos'
import { msHastaAviso, restanteDe } from '../utils/sesion'
import {
  EVENTO_CAMBIO_OBLIGATORIO,
  RUTA_CAMBIO_OBLIGATORIO,
  debeCambiarContrasena,
} from '../utils/cambioObligatorio'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser]         = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  // Copia del token en estado para reprogramar el aviso cuando cambia (al
  // entrar y al renovar). `localStorage` no avisa de sus propios cambios.
  const [token, setToken] = useState(() => localStorage.getItem('access_token'))
  const [avisoVisible, setAvisoVisible] = useState(false)
  const [restanteMs, setRestanteMs] = useState(0)
  const [renovando, setRenovando] = useState(false)
  const navigate = useNavigate()
  // Evita que dos caminos (el reloj y un 401) cierren la sesión dos veces.
  const expirandoRef = useRef(false)

  useEffect(() => {
    const checkSession = async () => {
      const token = localStorage.getItem('access_token')
      if (!token) {
        setIsLoading(false)
        return
      }
      try {
        const userData = await getMe()
        setUser(userData)
        setToken(token)
      } catch {
        setUser(null)
      } finally {
        setIsLoading(false)
      }
    }
    checkSession()
  }, [])

  /**
   * Cierra la sesión del lado del cliente y manda a login diciendo por qué.
   *
   * `expirado=1` es lo que distingue "se te acabó el tiempo" de "cerraste
   * sesión": sin eso, el usuario aparece en la pantalla de login sin saber si
   * pulsó algo sin querer o si la aplicación falló.
   */
  const expirarSesion = useCallback(() => {
    if (expirandoRef.current) return
    expirandoRef.current = true

    localStorage.removeItem('access_token')
    localStorage.removeItem('user')
    setUser(null)
    setToken(null)
    setAvisoVisible(false)
    navigate('/login?expirado=1', { replace: true })
  }, [navigate])

  // El cliente de axios avisa por un evento en vez de recargar la página; la
  // navegación la hace React Router, que conserva el estado de la aplicación.
  useEffect(() => {
    const alCaducar = () => expirarSesion()
    window.addEventListener(EVENTO_SESION_CADUCADA, alCaducar)
    return () => window.removeEventListener(EVENTO_SESION_CADUCADA, alCaducar)
  }, [expirarSesion])

  // HU-S10-01: el backend respondió 403 PASSWORD_CHANGE_REQUIRED (por ejemplo,
  // un admin le restableció la contraseña con la pantalla ya abierta). Se marca
  // al usuario y ProtectedRoute lo lleva a la pantalla de cambio obligatorio.
  // Si ya estaba marcado se devuelve el mismo objeto para no re-renderizar.
  useEffect(() => {
    const alExigirCambio = () =>
      setUser((actual) =>
        actual && !debeCambiarContrasena(actual)
          ? { ...actual, debe_cambiar_contrasena: true }
          : actual,
      )
    window.addEventListener(EVENTO_CAMBIO_OBLIGATORIO, alExigirCambio)
    return () => window.removeEventListener(EVENTO_CAMBIO_OBLIGATORIO, alExigirCambio)
  }, [])

  // Programa el aviso para cinco minutos antes del vencimiento del token
  // actual. Se rehace en cada cambio de token, o sea también al renovar.
  useEffect(() => {
    if (!token) {
      setAvisoVisible(false)
      return undefined
    }

    const espera = msHastaAviso(token)
    if (espera === null) {
      // Token ilegible o ya vencido: no hay nada que avisar. Si ya venció, la
      // primera petición que salga devolverá 401 y cerrará la sesión.
      return undefined
    }

    const temporizador = setTimeout(() => setAvisoVisible(true), espera)
    return () => clearTimeout(temporizador)
  }, [token])

  // Cuenta atrás mientras el aviso está en pantalla. Cuando llega a cero la
  // sesión ya no vale: se cierra sin esperar a que falle una petición.
  useEffect(() => {
    if (!avisoVisible || !token) return undefined

    const refrescar = () => {
      const restante = restanteDe(token) ?? 0
      setRestanteMs(restante)
      if (restante <= 0) expirarSesion()
    }

    refrescar()
    const intervalo = setInterval(refrescar, 1000)
    return () => clearInterval(intervalo)
  }, [avisoVisible, token, expirarSesion])

  /**
   * "Seguir conectado": pide un token nuevo y reprograma el aviso.
   *
   * Si la renovación falla, la sesión ya no se puede salvar (le cambiaron la
   * contraseña, lo desactivaron, cerró sesión en otro dispositivo): se cierra
   * aquí mismo en vez de dejar el aviso colgado.
   */
  const renovar = useCallback(async () => {
    setRenovando(true)
    try {
      const data = await renovarSesion()
      setToken(data.access_token)
      setAvisoVisible(false)
    } catch {
      expirarSesion()
    } finally {
      setRenovando(false)
    }
  }, [expirarSesion])

  // HU-S9-01: la pantalla inicial sale de la tabla única de utils/permisos.js,
  // así el gerente no aterriza en un panel que su rol no puede abrir.
  const getRedirectPath = (rol) => rutaInicialPorRol(rol)

  const loginUser = useCallback(async (correo, contrasena) => {
    const loginData = await login(correo, contrasena)
    const userData = await getMe()
    expirandoRef.current = false
    setUser(userData)
    setToken(loginData.access_token)
    // HU-S10-01: con la contraseña puesta por otra persona se entra directo a
    // la pantalla de cambio, no al panel (que respondería 403).
    const redirectPath = debeCambiarContrasena(userData)
      ? RUTA_CAMBIO_OBLIGATORIO
      : getRedirectPath(userData.rol || loginData.rol)
    navigate(redirectPath, { replace: true })
  }, [navigate])

  const logoutUser = useCallback(async () => {
    await logout()
    setUser(null)
    setToken(null)
    setAvisoVisible(false)
    navigate('/login', { replace: true })
  }, [navigate])

  /**
   * Cierra la sesión sin llamar a POST /auth/logout.
   *
   * Se usa cuando el token ya dejó de valer del lado del servidor —hoy solo
   * al cambiar la propia contraseña, que invalida todas las sesiones—. Llamar
   * al logout normal en ese punto devuelve 401, y el interceptor de axios
   * reacciona recargando la página entera hacia /login, lo que se lleva por
   * delante el aviso de que el cambio salió bien.
   */
  const cerrarSesionLocal = useCallback(() => {
    localStorage.removeItem('access_token')
    localStorage.removeItem('user')
    setUser(null)
    setToken(null)
    setAvisoVisible(false)
    navigate('/login', { replace: true })
  }, [navigate])

  return (
    <AuthContext.Provider value={{
      user,
      isLoading,
      isAuthenticated: !!user,
      loginUser,
      logoutUser,
      cerrarSesionLocal,
      renovarSesionActual: renovar,
      sesionPorVencer: avisoVisible,
    }}>
      {children}

      {/* Fuera del árbol de rutas a propósito: el aviso tiene que salir esté
          donde esté el usuario, también en una pantalla a pantalla completa. */}
      <AvisoSesion
        abierto={avisoVisible}
        restanteMs={restanteMs}
        renovando={renovando}
        onRenovar={renovar}
        onCerrarSesion={logoutUser}
      />
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  return ctx
}