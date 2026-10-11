import { useState } from 'react'
import Modal, { ModalActions } from '../ui/Modal'
import Spinner from '../ui/Spinner'
import { ROLES, ROL_LABEL, validarFormularioEdicion } from './empleadoValidacion'
import { SeccionContrasena } from './ModalRestablecerContrasena'
import styles from './ModalEditarEmpleado.module.css'

const IconAlert = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
    <line x1="12" y1="9" x2="12" y2="13"/>
    <line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>
)

export default function ModalEditarEmpleado({
  empleado, onGuardar, onCerrar, cargando, errorMsg, puedeRestablecer = false,
}) {
  const [form, setForm] = useState({
    nombre:   empleado?.nombre   ?? '',
    apellido: empleado?.apellido ?? '',
    correo:   empleado?.correo   ?? '',
    telefono: empleado?.telefono ?? '',
    rol:      empleado?.rol      ?? 'tecnico',
  })
  const [errores, setErrores] = useState({})

  if (!empleado) return null

  const handleChange = (campo, valor) => {
    setForm(prev => ({ ...prev, [campo]: valor }))
    if (errores[campo]) setErrores(prev => ({ ...prev, [campo]: null }))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    const erroresValidacion = validarFormularioEdicion(form)
    setErrores(erroresValidacion)
    if (Object.keys(erroresValidacion).length > 0) return
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

      {/* Un admin editándose a sí mismo no pasa: el backend responde 403 y
          lo manda a «Cambiar contraseña» del perfil. */}
      {puedeRestablecer && <SeccionContrasena empleado={empleado} bloqueado={cargando} />}
    </Modal>
  )
}
