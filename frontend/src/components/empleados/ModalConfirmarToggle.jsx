import React from 'react'
import Modal, { ModalActions } from '../ui/Modal'
import Spinner from '../ui/Spinner'
import styles from './ModalConfirmarToggle.module.css'

const IconAlert = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
    <line x1="12" y1="9" x2="12" y2="13"/>
    <line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>
)

const IconCheck = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
)

export default function ModalConfirmarToggle({ empleado, onConfirmar, onCancelar, cargando }) {
  if (!empleado) return null
  const esActivo = empleado.estado === 'activo'
  const nuevoEstado = esActivo ? 'inactivo' : 'activo'

  return (
    <Modal
      open
      onClose={onCancelar}
      title={esActivo ? 'Desactivar empleado' : 'Activar empleado'}
      width={440}
    >
      <div className={`${styles.iconWrap} ${esActivo ? styles.iconDanger : styles.iconSuccess}`}>
        {esActivo ? <IconAlert /> : <IconCheck />}
      </div>
      <p className={styles.desc}>
        {esActivo ? (
          <>
            <strong>{empleado.nombre} {empleado.apellido}</strong> no podrá iniciar sesión en la plataforma mientras su cuenta permanezca inactiva.
          </>
        ) : (
          <>
            ¿Deseas activar nuevamente a <strong>{empleado.nombre} {empleado.apellido}</strong> para permitirle acceder al sistema?
          </>
        )}
      </p>
      <ModalActions>
        <button type="button" className="btn btn-ghost" onClick={onCancelar} disabled={cargando}>
          Cancelar
        </button>
        <button
          type="button"
          className={`btn ${esActivo ? 'btn-danger' : 'btn-success'}`}
          onClick={() => onConfirmar(empleado.id_empleado, nuevoEstado)}
          disabled={cargando}
        >
          {cargando ? (
            <><Spinner size="sm" color="white" /> Procesando...</>
          ) : esActivo ? (
            'Sí, desactivar'
          ) : (
            'Sí, activar'
          )}
        </button>
      </ModalActions>
    </Modal>
  )
}
