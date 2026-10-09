/**
 * components/layout/RedirigirInicio.jsx
 * ---------------------------------------------------------------------------
 * Índice de /supervisor: manda a cada rol a su pantalla inicial según la tabla
 * de utils/permisos.js. Antes todos caían en el panel, y para el gerente eso
 * era un 403.
 * ---------------------------------------------------------------------------
 */

import { Navigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { rutaInicialPorRol } from '../../utils/permisos'

export default function RedirigirInicio() {
  const { user } = useAuth()
  return <Navigate to={rutaInicialPorRol(user?.rol)} replace />
}