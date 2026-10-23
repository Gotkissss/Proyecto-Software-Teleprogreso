/**
 * components/layout/ProtectedRoute.jsx
 * ---------------------------------------------------------------------------
 * Wrapper para rutas que requieren autenticación.
 * Si el usuario no está autenticado, redirige al login.
 * Muestra un spinner mientras se verifica la sesión inicial.
 * Con la prop `roles`, además muestra el 403 si el rol no está en la lista.
 *
 * HU-S10-01: si el usuario tiene el cambio de contraseña pendiente
 * (`debe_cambiar_contrasena`), lo lleva a /cambiar-contrasena y no lo deja
 * navegar a ninguna otra pantalla. Esa propia ruta se monta con
 * `permitirCambioPendiente` para no redirigirse a sí misma.
 * ---------------------------------------------------------------------------
 */

import { Navigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import Spinner from '../ui/Spinner'
import { RUTA_CAMBIO_OBLIGATORIO, debeCambiarContrasena } from '../../utils/cambioObligatorio'
import AccesoDenegadoPage from '../../pages/AccesoDenegadoPage'
import styles from './ProtectedRoute.module.css'

function rolAutorizado(roles, rol) {
  return Array.isArray(roles) && typeof rol === 'string' && roles.includes(rol)
}

export default function ProtectedRoute({ children, roles, permitirCambioPendiente = false }) {
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

  // Va antes de la comprobación de rol: con el cambio pendiente el backend
  // responde 403 a todo, así que mostrar "sin acceso" sería engañoso.
  if (debeCambiarContrasena(user) && !permitirCambioPendiente) {
    return <Navigate to={RUTA_CAMBIO_OBLIGATORIO} replace />
  }

  if (roles !== undefined && !rolAutorizado(roles, user?.rol)) {
    return <AccesoDenegadoPage />
  }

  return children
}