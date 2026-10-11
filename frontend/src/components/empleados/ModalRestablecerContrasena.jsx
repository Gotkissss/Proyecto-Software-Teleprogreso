import { useState } from 'react'
import apiClient from '../../api/client'
import Modal from '../ui/Modal'
import Spinner from '../ui/Spinner'
import { useToast } from '../ui/Toast'
import { getPasswordStrength } from './empleadoValidacion'
import styles from './ModalEditarEmpleado.module.css'

const IconAlert = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
    <line x1="12" y1="9" x2="12" y2="13"/>
    <line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>
)

const IconKey = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="7.5" cy="15.5" r="4.5"/>
    <path d="M10.7 12.3 21 2"/>
    <path d="m16.5 6.5 3 3"/>
  </svg>
)

const IconEye = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
)

const IconEyeOff = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
    <line x1="1" y1="1" x2="23" y2="23"/>
  </svg>
)

const MENSAJE_403 = 'No tienes permiso para restablecer la contraseña de esta cuenta.'

/**
 * Formulario de PATCH /empleados/{id}/contrasena.
 *
 * Dentro de ModalEditarEmpleado arranca plegado tras un botón; en
 * ModalRestablecerContrasena arranca abierto y `onCerrar` cierra el modal.
 */
export function SeccionContrasena({ empleado, bloqueado, abiertoInicial = false, onCerrar }) {
  const toast = useToast()
  const [abierto,     setAbierto]     = useState(abiertoInicial)
  const [clave,       setClave]       = useState('')
  const [confirmar,   setConfirmar]   = useState('')
  const [visible,     setVisible]     = useState(false)
  const [guardando,   setGuardando]   = useState(false)
  const [error,       setError]       = useState(null)

  const limpiar = () => { setClave(''); setConfirmar(''); setError(null); setVisible(false) }
  const cerrar = () => {
    limpiar()
    if (onCerrar) onCerrar()
    else setAbierto(false)
  }

  const problema = () => {
    if (clave.length < 8) return 'La contraseña debe tener al menos 8 caracteres.'
    if (clave !== clave.trim()) return 'No puede empezar ni terminar con espacios.'
    if (clave !== confirmar) return 'Las contraseñas no coinciden.'
    return null
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const fallo = problema()
    if (fallo) { setError(fallo); return }

    setGuardando(true)
    setError(null)
    try {
      const { data } = await apiClient.patch(
        `/empleados/${empleado.id_empleado}/contrasena`,
        { contrasena: clave, contrasena_confirmacion: confirmar },
      )
      toast.success(data?.detail || 'Contraseña actualizada correctamente.')
      cerrar()
    } catch (err) {
      const detail = err?.response?.data?.detail
      // El botón ya se oculta cuando el rol no alcanza (puedeRestablecerContrasena),
      // pero el backend es quien decide: si aun así responde 403, reintentar
      // con otra clave no cambia nada, así que se avisa y se cierra.
      if (err?.response?.status === 403) {
        toast.error(typeof detail === 'string' && detail ? detail : MENSAJE_403)
        cerrar()
        return
      }
      setError(
        Array.isArray(detail)
          ? detail.map(d => d.message || d.msg).join(', ')
          : detail || 'No se pudo actualizar la contraseña.'
      )
    } finally {
      setGuardando(false)
    }
  }

  const fuerza = getPasswordStrength(clave)

  return (
    <div className={styles.passSection}>
      {!abierto ? (
        <button
          type="button"
          className={`btn btn-secondary btn-sm ${styles.togglePassBtn}`}
          onClick={() => setAbierto(true)}
          disabled={bloqueado}
        >
          <IconKey />
          Restablecer contraseña de acceso
        </button>
      ) : (
        <form className={styles.passForm} onSubmit={handleSubmit} noValidate>
          <div className={styles.passHeader}>
            <span className={styles.passTitle}>Restablecer contraseña</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={cerrar} disabled={guardando}>
              Cerrar
            </button>
          </div>

          {error && (
            <div className={styles.errorBanner}>
              <IconAlert />
              <span>{error}</span>
            </div>
          )}

          <div className={styles.grid}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="restablecer-clave">Nueva contraseña</label>
              <div className={styles.passWrap}>
                <input
                  id="restablecer-clave"
                  type={visible ? 'text' : 'password'}
                  className={`${styles.input} ${styles.inputPass}`}
                  value={clave}
                  onChange={e => setClave(e.target.value)}
                  disabled={guardando}
                  placeholder="Mínimo 8 caracteres"
                />
                <button
                  type="button"
                  className={styles.eyeBtn}
                  onClick={() => setVisible(v => !v)}
                  tabIndex={-1}
                  aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                >
                  {visible ? <IconEyeOff /> : <IconEye />}
                </button>
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="restablecer-confirmar">Confirmar contraseña</label>
              <div className={styles.passWrap}>
                <input
                  id="restablecer-confirmar"
                  type={visible ? 'text' : 'password'}
                  className={`${styles.input} ${styles.inputPass}`}
                  value={confirmar}
                  onChange={e => setConfirmar(e.target.value)}
                  disabled={guardando}
                  placeholder="Repite la contraseña"
                />
              </div>
            </div>
          </div>

          {clave && (
            <div className={styles.strengthBar}>
              <div className={styles.strengthSegments}>
                {[1, 2, 3].map(lvl => (
                  <div
                    key={lvl}
                    className={styles.strengthSegment}
                    style={{ background: fuerza.level >= lvl ? fuerza.color : 'var(--color-border)' }}
                  />
                ))}
              </div>
              <span className={styles.strengthLabel} style={{ color: fuerza.color }}>{fuerza.label}</span>
            </div>
          )}

          <div className={styles.passActions}>
            <button type="submit" className="btn btn-primary btn-sm" disabled={guardando || !clave}>
              {guardando ? <><Spinner size="sm" color="white" /> Actualizando...</> : 'Actualizar contraseña'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

export default function ModalRestablecerContrasena({ empleado, onCerrar }) {
  if (!empleado) return null

  return (
    <Modal open onClose={onCerrar} title="Restablecer contraseña" width={620}>
      <p className={styles.subtitle}>
        {empleado.nombre} {empleado.apellido} — {empleado.correo}
      </p>
      <SeccionContrasena empleado={empleado} abiertoInicial onCerrar={onCerrar} />
    </Modal>
  )
}
