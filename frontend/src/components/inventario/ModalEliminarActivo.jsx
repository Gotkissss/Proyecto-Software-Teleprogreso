import React, { useState } from 'react'
import Modal, { ModalActions } from '../ui/Modal'
import Spinner from '../ui/Spinner'
import { eliminarActivo } from '../../api/inventarioService'
import styles from './ModalEliminarActivo.module.css'

const IconAlert = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
    <line x1="12" y1="9" x2="12" y2="13"/>
    <line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>
)

export default function ModalEliminarActivo({ activo, onCerrar, onEliminado }) {
  if (!activo) return null

  const [eliminando, setEliminando] = useState(false)
  const [error,      setError]      = useState(null)

  const handleConfirmar = async () => {
    setEliminando(true)
    setError(null)
    try {
      await eliminarActivo(activo.id_activo)
      onEliminado(activo.id_activo)
    } catch (err) {
      setError(err?.response?.data?.detail || 'Error al eliminar el activo.')
      setEliminando(false)
    }
  }

  return (
    <Modal open onClose={onCerrar} title="Eliminar activo" width={440}>
      <div className={styles.iconWrap}>
        <IconAlert />
      </div>

      <p className={styles.desc}>
        ¿Estás seguro de que deseas eliminar <strong>{activo.nombre_activo}</strong> del inventario?
      </p>
      <p className={styles.warning}>
        Esta acción no se puede deshacer y desvinculará cualquier tarea o asignación vinculada a este activo.
      </p>

      {error && (
        <div className={styles.errorBanner}>
          {error}
        </div>
      )}

      <ModalActions>
        <button type="button" className="btn btn-ghost" onClick={onCerrar} disabled={eliminando}>
          Cancelar
        </button>
        <button
          type="button"
          className="btn btn-danger"
          onClick={handleConfirmar}
          disabled={eliminando}
        >
          {eliminando ? <><Spinner size="sm" color="white" /> Eliminando...</> : 'Sí, eliminar'}
        </button>
      </ModalActions>
    </Modal>
  )
}
