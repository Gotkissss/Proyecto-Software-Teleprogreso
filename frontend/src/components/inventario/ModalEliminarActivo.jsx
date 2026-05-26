/**
 * components/inventario/ModalEliminarActivo.jsx
 * ---------------------------------------------------------------------------
 * Modal de confirmación para eliminar un activo del inventario.
 * Reutiliza el overlay y panel base de ModalNuevoActivo.module.css.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useState } from 'react'
import { deleteActivo } from '../../services/inventarioService'
import baseStyles from './ModalNuevoActivo.module.css'
import styles from './ModalEliminarActivo.module.css'

export default function ModalEliminarActivo({ isOpen, activo, onClose, onActivoEliminado }) {
  const [eliminando,  setEliminando]  = useState(false)
  const [errorGlobal, setErrorGlobal] = useState('')

  // Resetea estado al abrir
  useEffect(() => {
    if (isOpen) {
      setEliminando(false)
      setErrorGlobal('')
    }
  }, [isOpen])

  // Cerrar con Escape
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !eliminando) onClose?.()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose, eliminando])

  if (!isOpen || !activo) return null

  const handleEliminar = async () => {
    setErrorGlobal('')
    setEliminando(true)
    try {
      await deleteActivo(activo.id_activo ?? activo.id)
      onActivoEliminado?.()
      onClose?.()
    } catch (err) {
      const msg = err?.response?.data?.detail || err?.message || 'No se pudo eliminar el activo.'
      setErrorGlobal(typeof msg === 'string' ? msg : 'No se pudo eliminar el activo.')
    } finally {
      setEliminando(false)
    }
  }

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget && !eliminando) onClose?.()
  }

  const nombre = activo.nombre_activo ?? activo.nombre ?? 'este activo'

  return (
    <div className={baseStyles.overlay} onClick={handleOverlayClick} role="dialog" aria-modal="true">
      <div className={baseStyles.panel} style={{ maxWidth: 440 }}>
        <div className={baseStyles.header}>
          <h2 className={baseStyles.title}>Eliminar activo</h2>
          <button
            type="button"
            className={baseStyles.closeBtn}
            onClick={onClose}
            aria-label="Cerrar"
            disabled={eliminando}
          >
            ×
          </button>
        </div>

        {errorGlobal && <div className={baseStyles.errorBox} style={{ marginBottom: 12 }}>{errorGlobal}</div>}

        <p className={styles.mensaje}>
          ¿Estás seguro de que deseas eliminar <span className={styles.nombre}>{nombre}</span>?
          {' '}Esta acción no se puede deshacer.
        </p>

        <div className={baseStyles.actions}>
          <button
            type="button"
            className={`${baseStyles.btn} ${baseStyles.btnCancelar}`}
            onClick={onClose}
            disabled={eliminando}
          >
            Cancelar
          </button>
          <button
            type="button"
            className={`${baseStyles.btn} ${styles.btnEliminar}`}
            onClick={handleEliminar}
            disabled={eliminando}
          >
            {eliminando ? 'Eliminando...' : 'Eliminar'}
          </button>
        </div>
      </div>
    </div>
  )
}
