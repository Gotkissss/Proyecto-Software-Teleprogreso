/**
 * components/layout/AvisoSesion.jsx
 * ---------------------------------------------------------------------------
 * HU-S9-05 — El aviso de que la sesión está por vencer.
 *
 * Lo monta AuthProvider, así que sale esté donde esté el usuario. No se puede
 * cerrar con la X ni haciendo clic fuera a propósito: es una decisión, no una
 * notificación. Las dos salidas son explícitas — seguir conectado o cerrar
 * sesión — porque la tercera, ignorarlo, ya es la que había antes y acaba con
 * el trabajo a medias perdido.
 * ---------------------------------------------------------------------------
 */

import Modal, { ModalActions } from '../ui/Modal'
import { cuentaAtras } from '../../utils/sesion'
import Spinner from '../ui/Spinner'
import styles from './AvisoSesion.module.css'

export default function AvisoSesion({
  abierto,
  restanteMs,
  renovando,
  onRenovar,
  onCerrarSesion,
}) {
  if (!abierto) return null

  return (
    <Modal open title="Tu sesión está por vencer" width={440}>
      <p className={styles.texto}>
        Por seguridad la sesión se cierra sola. Te queda{' '}
        <strong className={styles.reloj}>{cuentaAtras(restanteMs)}</strong>.
      </p>
      <p className={styles.texto}>
        Si seguís conectado no perdés nada de lo que tengas a medias.
      </p>

      <ModalActions>
        <button
          type="button"
          className={styles.btnSecundario}
          onClick={onCerrarSesion}
          disabled={renovando}
        >
          Cerrar sesión
        </button>
        <button
          type="button"
          className={styles.btnPrimario}
          onClick={onRenovar}
          disabled={renovando}
          autoFocus
        >
          {renovando
            ? <><Spinner size="sm" color="white" /> Renovando…</>
            : 'Seguir conectado'}
        </button>
      </ModalActions>
    </Modal>
  )
}
