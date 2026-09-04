import React, { useState } from 'react'
import apiClient from '../../api/client'
import Modal, { ModalActions } from '../ui/Modal'
import Spinner from '../ui/Spinner'
import { useToast } from '../ui/Toast'
import { getPasswordStrength } from './ModalCrearEmpleado'
import styles from './ModalEditarEmpleado.module.css'

const ROLES = ['admin', 'supervisor', 'tecnico', 'gerente']
const ROL_LABEL = {
  admin:      'Admin',
  supervisor: 'Supervisor',
  tecnico:    'Técnico',
  gerente:    'Gerente',
}

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

export default function ModalEditarEmpleado({ empleado, onGuardar, onCerrar, cargando, errorMsg }) {
  if (!empleado) return null

  const [form, setForm] = useState({
    nombre:   empleado.nombre   ?? '',
    apellido: empleado.apellido ?? '',
    correo:   empleado.correo   ?? '',
    telefono: empleado.telefono ?? '',
    rol:      empleado.rol      ?? 'tecnico',
  })
  const [errores, setErrores] = useState({})

  const handleChange = (campo, valor) => {
    setForm(prev => ({ ...prev, [campo]: valor }))
    if (errores[campo]) setErrores(prev => ({ ...prev, [campo]: null }))
  }

  const validar = () => {
    const e = {}
    if (!form.nombre.trim())   e.nombre   = 'El nombre es obligatorio.'
    if (!form.apellido.trim()) e.apellido = 'El apellido es obligatorio.'
    if (!form.correo.trim())   e.correo   = 'El correo es obligatorio.'
    if (form.correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.correo)) e.correo = 'Ingresa un correo válido.'
    if (form.telefono && !/^[0-9+\-() ]{7,}$/.test(form.telefono.trim())) e.telefono = 'Teléfono inválido (mín. 7 dígitos).'
    setErrores(e)
    return Object.keys(e).length === 0
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!validar()) return
    const cambios = {}
    if (form.nombre.trim()   !== empleado.nombre)           cambios.nombre   = form.nombre.trim()
    if (form.apellido.trim() !== empleado.apellido)         cambios.apellido = form.apellido.trim()
    if (form.correo.trim()   !== empleado.correo)           cambios.correo   = form.correo.trim()
    if (form.rol             !== empleado.rol)              cambios.rol      = form.rol
    if (form.telefono.trim() !== (empleado.telefono ?? '')) cambios.telefono = form.telefono.trim() || null

    if (Object.keys(cambios).length === 0) {
      onCerrar()
      return
    }
    onGuardar(empleado.id_empleado, cambios)
  }

  return (
    <Modal open onClose={onCerrar} title="Editar empleado" width={620}>
      <p className={styles.subtitle}>ID #{empleado.id_empleado} — {empleado.correo}</p>
      
      {errorMsg && (
        <div className={styles.errorBanner}>
          <IconAlert />
          <span>{errorMsg}</span>
        </div>
      )}

      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <div className={styles.grid}>
          <div className={styles.field}>
            <label className={styles.label}>Nombre <span className={styles.required}>*</span></label>
            <input
              type="text"
              className={`${styles.input} ${errores.nombre ? styles.inputError : ''}`}
              value={form.nombre}
              onChange={e => handleChange('nombre', e.target.value)}
              disabled={cargando}
              placeholder="Ej: Juan"
            />
            {errores.nombre && <p className={styles.fieldError}>{errores.nombre}</p>}
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Apellido <span className={styles.required}>*</span></label>
            <input
              type="text"
              className={`${styles.input} ${errores.apellido ? styles.inputError : ''}`}
              value={form.apellido}
              onChange={e => handleChange('apellido', e.target.value)}
              disabled={cargando}
              placeholder="Ej: Pérez García"
            />
            {errores.apellido && <p className={styles.fieldError}>{errores.apellido}</p>}
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Correo electrónico <span className={styles.required}>*</span></label>
          <input
            type="email"
            className={`${styles.input} ${errores.correo ? styles.inputError : ''}`}
            value={form.correo}
            onChange={e => handleChange('correo', e.target.value)}
            disabled={cargando}
            placeholder="usuario@teleprogreso.com"
          />
          {errores.correo && <p className={styles.fieldError}>{errores.correo}</p>}
        </div>

        <div className={styles.grid}>
          <div className={styles.field}>
            <label className={styles.label}>Teléfono</label>
            <input
              type="tel"
              className={`${styles.input} ${errores.telefono ? styles.inputError : ''}`}
              value={form.telefono}
              onChange={e => handleChange('telefono', e.target.value)}
              disabled={cargando}
              placeholder="Ej: 5550-0001"
            />
            {errores.telefono && <p className={styles.fieldError}>{errores.telefono}</p>}
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Rol</label>
            <select
              className={styles.select}
              value={form.rol}
              onChange={e => handleChange('rol', e.target.value)}
              disabled={cargando}
            >
              {ROLES.map(r => <option key={r} value={r}>{ROL_LABEL[r]}</option>)}
            </select>
          </div>
        </div>

        <ModalActions>
          <button type="button" className="btn btn-ghost" onClick={onCerrar} disabled={cargando}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={cargando}>
            {cargando ? <><Spinner size="sm" color="white" /> Guardando...</> : 'Guardar cambios'}
          </button>
        </ModalActions>
      </form>

      <SeccionContrasena empleado={empleado} bloqueado={cargando} />
    </Modal>
  )
}

function SeccionContrasena({ empleado, bloqueado }) {
  const toast = useToast()
  const [abierto,     setAbierto]     = useState(false)
  const [clave,       setClave]       = useState('')
  const [confirmar,   setConfirmar]   = useState('')
  const [visible,     setVisible]     = useState(false)
  const [guardando,   setGuardando]   = useState(false)
  const [error,       setError]       = useState(null)

  const limpiar = () => { setClave(''); setConfirmar(''); setError(null); setVisible(false) }
  const cerrar = () => { setAbierto(false); limpiar() }

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
              <label className={styles.label}>Nueva contraseña</label>
              <div className={styles.passWrap}>
                <input
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
              <label className={styles.label}>Confirmar contraseña</label>
              <div className={styles.passWrap}>
                <input
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
