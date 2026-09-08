/**
 * context/AuthContext.jsx
 */

import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { login, getMe, logout } from '../api/authService'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser]         = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const navigate = useNavigate()

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
      } catch {
        setUser(null)
      } finally {
        setIsLoading(false)
      }
    }
    checkSession()
  }, [])

  const getRedirectPath = (rol) => {
    if (rol === 'admin' || rol === 'supervisor' || rol === 'gerente') {
      return '/supervisor/dashboard'
    }
    return '/ruta'
  }

  const loginUser = useCallback(async (correo, contrasena) => {
    const loginData = await login(correo, contrasena)
    const userData = await getMe()
    setUser(userData)
    const redirectPath = getRedirectPath(userData.rol || loginData.rol)
    navigate(redirectPath, { replace: true })
  }, [navigate])

  const logoutUser = useCallback(async () => {
    await logout()
    setUser(null)
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
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  return ctx
}