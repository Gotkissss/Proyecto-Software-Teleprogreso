/**
 * components/ui/EmptyState.jsx
 * Estado vacío/error homogéneo para todas las páginas.
 *
 * <EmptyState icon={<IconX/>} title="Sin tareas" description="No hay tareas hoy." />
 * <EmptyState variant="error" title="Error al cargar" action={<button onClick={retry}>Reintentar</button>} />
 */
import styles from './EmptyState.module.css'

export default function EmptyState({ icon, title, description, action, variant = 'empty' }) {
  return (
    <div className={`${styles.wrap} ${variant === 'error' ? styles.error : ''}`}>
      {icon && <div className={styles.icon}>{icon}</div>}
      <h3 className={styles.title}>{title}</h3>
      {description && <p className={styles.desc}>{description}</p>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  )
}
