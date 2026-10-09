import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import EmptyState from '../components/ui/EmptyState'
import { rutaInicialPorRol } from '../utils/permisos'
import styles from './AccesoDenegadoPage.module.css'

const IconCandado = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
)

export default function AccesoDenegadoPage() {
  const { user } = useAuth()
  const rol = typeof user?.rol === 'string' && user.rol !== '' ? user.rol : null

  return (
    <div className={styles.pagina} role="alert">
      <EmptyState
        variant="error"
        icon={<IconCandado />}
        title="No tienes acceso a esta pantalla"
        description="Si necesitas esta pantalla, pide acceso al administrador."
        action={
          <Link className="btn btn-primary" to={rutaInicialPorRol(rol)}>
            Ir a mi pantalla de inicio
          </Link>
        }
      />
    </div>
  )
}
