import { useState } from 'react'
import apiClient from '../../api/client'
import Modal, { ModalActions } from '../ui/Modal'
import Spinner from '../ui/Spinner'
import { ROLES, ROL_LABEL, validarFormulario, getPasswordStrength } from './empleadoValidacion'
import styles from './ModalCrearEmpleado.module.css'

const IconAlert = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
    <line x1="12" y1="9" x2="12" y2="13"/>
    <line x1="12" y1="17" x2="12.01" y2="17"/>
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

const FORM_INICIAL = {
  nombre:               '',
  apellido:             '',
  correo:               '',
  telefono:             '',
  rol:                  'tecnico',
  estado:               'activo',
  contrasena:           '',
  confirmar_contrasena: '',
  fecha_contratacion:   '',
}

export default function ModalCrearEmpleado({ onCreado, onCerrar, empleadosExistentes = [] }) {
  const [form,          setForm]          = useState(FORM_INICIAL)
  const [errores,       setErrores]       = useState({})
  const [cargando,      setCargando]      = useState(false)
  const [errorServidor, setErrorServidor] = useState(null)
  const [showPass,      setShowPass]      = useState(false)
  const [showConfirm,   setShowConfirm]   = useState(false)
  const [tocados,       setTocados]       = useState({})

  const strength = getPasswordStrength(form.contrasena)

  const handleChange = (campo, valor) => {
    setForm(prev => ({ ...prev, [campo]: valor }))
    setErrorServidor(null)
    if (tocados[campo]) {
      const nuevosErrores = validarFormulario({ ...form, [campo]: valor })
      setErrores(prev => ({ ...prev, [campo]: nuevosErrores[campo] || null }))
    }
  }

  const handleBlur = (campo) => {
    setTocados(prev => ({ ...prev, [campo]: true }))
    const nuevosErrores = validarFormulario(form)
    setErrores(prev => ({ ...prev, [campo]: nuevosErrores[campo] || null }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const todosTocados = Object.keys(FORM_INICIAL).reduce((acc, k) => ({ ...acc, [k]: true }), {})
    setTocados(todosTocados)
    const erroresValidacion = validarFormulario(form)
    setErrores(erroresValidacion)
    if (Object.keys(erroresValidacion).length > 0) return

    if (empleadosExistentes.some(emp => emp.correo.toLowerCase() === form.correo.trim().toLowerCase())) {
      setErrores(prev => ({ ...prev, correo: 'Este correo ya está registrado en el sistema.' }))
      return
    }

    setCargando(true)
    setErrorServidor(null)
    try {
      const payload = {
        nombre: form.nombre.trim(),
        apellido: form.apellido.trim(),
        correo: form.correo.trim().toLowerCase(),
        telefono: form.telefono.trim() || null,
        rol: form.rol,
        contrasena: form.contrasena,
        fecha_contratacion: form.fecha_contratacion,
      }
      const { data } = await apiClient.post('/empleados', payload)
      onCreado(data)
    } catch (err) {
      const status = err?.response?.status
      const detail = err?.response?.data?.detail
      if (status === 409) {
        setErrores(prev => ({ ...prev, correo: 'Este correo ya está registrado en el sistema.' }))
      } else if (status === 400 || status === 422) {
        if (Array.isArray(detail)) {
          const errBack = {}
          detail.forEach(d => {
            const campo = d.loc?.[d.loc.length - 1]
            if (campo && campo in FORM_INICIAL) errBack[campo] = d.msg || d.message
          })
          if (Object.keys(errBack).length > 0) {
            setErrores(prev => ({ ...prev, ...errBack }))
            return
          }
        }
        const msg = typeof detail === 'string' ? detail : ''
        if (msg.toLowerCase().includes('correo') || msg.toLowerCase().includes('email') || msg.toLowerCase().includes('duplicate') || msg.toLowerCase().includes('unique')) {
          setErrores(prev => ({ ...prev, correo: 'Este correo ya está registrado en el sistema.' }))
          return
        }
        setErrorServidor(msg || 'Los datos enviados no son válidos.')
      } else {
        setErrorServidor('Error al conectar con el servidor. Intenta de nuevo.')
      }
    } finally {
      setCargando(false)
    }
  }

  const campoTieneError = (campo) => tocados[campo] && errores[campo]

  return (
    <Modal open onClose={onCerrar} title="Nuevo empleado" width={640}>
      <p className={styles.subtitle}>Completa todos los campos obligatorios para registrar al colaborador</p>
      
      {errorServidor && (
        <div className={styles.errorBanner}>
          <IconAlert />
          <span>{errorServidor}</span>
        </div>
      )}

      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <div className={styles.sectionLabel}>Datos personales</div>
        <div className={styles.grid}>
          <div className={styles.field}>
            <label className={styles.label}>Nombre <span className={styles.required}>*</span></label>
            <input
              type="text"
              className={`${styles.input} ${campoTieneError('nombre') ? styles.inputError : ''}`}
              value={form.nombre}
              onChange={e => handleChange('nombre', e.target.value)}
              onBlur={() => handleBlur('nombre')}
              disabled={cargando}
              placeholder="Ej: Juan"
              autoComplete="given-name"
            />
            {campoTieneError('nombre') && <p className={styles.fieldError}>{errores.nombre}</p>}
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Apellido <span className={styles.required}>*</span></label>
            <input
              type="text"
              className={`${styles.input} ${campoTieneError('apellido') ? styles.inputError : ''}`}
              value={form.apellido}
              onChange={e => handleChange('apellido', e.target.value)}
              onBlur={() => handleBlur('apellido')}
              disabled={cargando}
              placeholder="Ej: Pérez García"
              autoComplete="family-name"
            />
            {campoTieneError('apellido') && <p className={styles.fieldError}>{errores.apellido}</p>}
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Correo electrónico <span className={styles.required}>*</span></label>
          <input
            type="email"
            className={`${styles.input} ${campoTieneError('correo') ? styles.inputError : ''}`}
            value={form.correo}
            onChange={e => handleChange('correo', e.target.value)}
            onBlur={() => handleBlur('correo')}
            disabled={cargando}
            placeholder="usuario@teleprogreso.com"
            autoComplete="email"
          />
          {campoTieneError('correo') && <p className={styles.fieldError}>{errores.correo}</p>}
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Teléfono <span className={styles.optional}>(opcional)</span></label>
          <input
            type="tel"
            className={`${styles.input} ${campoTieneError('telefono') ? styles.inputError : ''}`}
            value={form.telefono}
            onChange={e => handleChange('telefono', e.target.value)}
            onBlur={() => handleBlur('telefono')}
            disabled={cargando}
            placeholder="Ej: 5550-0001"
            autoComplete="tel"
          />
          {campoTieneError('telefono') && <p className={styles.fieldError}>{errores.telefono}</p>}
        </div>

        <div className={styles.sectionLabel}>Rol y contratación</div>
        <div className={styles.grid}>
          <div className={styles.field}>
            <label className={styles.label}>Rol <span className={styles.required}>*</span></label>
            <select
              className={styles.select}
              value={form.rol}
              onChange={e => handleChange('rol', e.target.value)}
              disabled={cargando}
            >
              {ROLES.map(r => <option key={r} value={r}>{ROL_LABEL[r]}</option>)}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Fecha de contratación <span className={styles.required}>*</span></label>
            <input
              type="date"
              className={`${styles.input} ${campoTieneError('fecha_contratacion') ? styles.inputError : ''}`}
              value={form.fecha_contratacion}
              onChange={e => handleChange('fecha_contratacion', e.target.value)}
              onBlur={() => handleBlur('fecha_contratacion')}
              disabled={cargando}
              max={new Date().toISOString().split('T')[0]}
            />
            {campoTieneError('fecha_contratacion') && <p className={styles.fieldError}>{errores.fecha_contratacion}</p>}
          </div>
        </div>

        <div className={styles.sectionLabel}>Seguridad y contraseña</div>
        <div className={styles.field}>
          <label className={styles.label}>Contraseña <span className={styles.required}>*</span></label>
          <div className={styles.passWrap}>
            <input
              type={showPass ? 'text' : 'password'}
              className={`${styles.input} ${styles.inputPass} ${campoTieneError('contrasena') ? styles.inputError : ''}`}
              value={form.contrasena}
              onChange={e => handleChange('contrasena', e.target.value)}
              onBlur={() => handleBlur('contrasena')}
              disabled={cargando}
              placeholder="Mínimo 8 caracteres"
              autoComplete="new-password"
            />
            <button
              type="button"
              className={styles.eyeBtn}
              onClick={() => setShowPass(v => !v)}
              tabIndex={-1}
              aria-label={showPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            >
              {showPass ? <IconEyeOff /> : <IconEye />}
            </button>
          </div>
          {form.contrasena && (
            <div className={styles.strengthBar}>
              <div className={styles.strengthSegments}>
                {[1, 2, 3].map(lvl => (
                  <div
                    key={lvl}
                    className={styles.strengthSegment}
                    style={{ background: strength.level >= lvl ? strength.color : 'var(--color-border)' }}
                  />
                ))}
              </div>
              <span className={styles.strengthLabel} style={{ color: strength.color }}>{strength.label}</span>
            </div>
          )}
          {campoTieneError('contrasena') && <p className={styles.fieldError}>{errores.contrasena}</p>}
          {!campoTieneError('contrasena') && <p className={styles.passHint}>Mín. 8 caracteres, una mayúscula, una minúscula y un número.</p>}
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Confirmar contraseña <span className={styles.required}>*</span></label>
          <div className={styles.passWrap}>
            <input
              type={showConfirm ? 'text' : 'password'}
              className={`${styles.input} ${styles.inputPass} ${campoTieneError('confirmar_contrasena') ? styles.inputError : ''}`}
              value={form.confirmar_contrasena}
              onChange={e => handleChange('confirmar_contrasena', e.target.value)}
              onBlur={() => handleBlur('confirmar_contrasena')}
              disabled={cargando}
              placeholder="Repite la contraseña"
              autoComplete="new-password"
            />
            <button
              type="button"
              className={styles.eyeBtn}
              onClick={() => setShowConfirm(v => !v)}
              tabIndex={-1}
              aria-label={showConfirm ? 'Ocultar confirmación' : 'Mostrar confirmación'}
            >
              {showConfirm ? <IconEyeOff /> : <IconEye />}
            </button>
          </div>
          {campoTieneError('confirmar_contrasena') && <p className={styles.fieldError}>{errores.confirmar_contrasena}</p>}
        </div>

        <ModalActions>
          <button type="button" className="btn btn-ghost" onClick={onCerrar} disabled={cargando}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={cargando}>
            {cargando ? <><Spinner size="sm" color="white" /> Creando...</> : 'Crear empleado'}
          </button>
        </ModalActions>
      </form>
    </Modal>
  )
}
