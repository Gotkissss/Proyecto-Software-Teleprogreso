/**
 * components/layout/ProtectedRoute.jsx
 * ---------------------------------------------------------------------------
 * Wrapper para rutas que requieren autenticación.
 * Si el usuario no está autenticado, redirige al login.
 * Muestra un spinner mientras se verifica la sesión inicial.
 * Con la prop `roles`, además muestra el 403 si el rol no está en la lista.
 * ---------------------------------------------------------------------------
 */

import { Navigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import Spinner from '../ui/Spinner'
import AccesoDenegadoPage from '../../pages/AccesoDenegadoPage'
import styles from './ProtectedRoute.module.css'

function rolAutorizado(roles, rol) {
  return Array.isArray(roles) && typeof rol === 'string' && roles.includes(rol)
}

export default function ProtectedRoute({ children, roles }) {
  const { user, isAuthenticated, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className={styles.center}>
        <Spinner size="lg" />
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  if (roles !== undefined && !rolAutorizado(roles, user?.rol)) {
    return <AccesoDenegadoPage />
  }

  return children
}
