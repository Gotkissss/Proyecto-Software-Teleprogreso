/**
 * components/ui/Modal.jsx
 * Modal genérico reutilizable — usar en lugar de modales inline por página.
 *
 * <Modal open={open} onClose={fn} title="Confirmar">
 *   <p>Contenido</p>
 *   <ModalActions>
 *     <button onClick={fn}>Cancelar</button>
 *     <button onClick={confirmar}>Aceptar</button>
 *   </ModalActions>
 * </Modal>
 */
import { useEffect } from 'react'
import styles from './Modal.module.css'

export default function Modal({ open, onClose, title, children, width = 480 }) {
  // Sin `onClose` el diálogo no se puede cerrar: ni con Escape, ni pulsando
  // fuera, ni con la X — que en ese caso ni se dibuja, porque un botón que no
  // hace nada es peor que no tenerlo. Lo usa el aviso de sesión por vencer,
  // donde las dos salidas tienen que ser decisiones explícitas.
  const cerrable = typeof onClose === 'function'
  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && onClose?.()
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className={styles.overlay}
      onClick={cerrable ? onClose : undefined}
      role="presentation"
    >
      <div
        className={styles.modal}
        style={{ maxWidth: width }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className={styles.header}>
          <h3 className={styles.title}>{title}</h3>
          {cerrable && (
            <button className={styles.close} onClick={onClose} aria-label="Cerrar">×</button>
          )}
        </div>
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  )
}

export function ModalActions({ children }) {
  return <div className={styles.actions}>{children}</div>
}
