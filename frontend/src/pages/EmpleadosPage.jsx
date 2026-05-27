/**
 * pages/EmpleadosPage.jsx
 * ---------------------------------------------------------------------------
 * Gestión de empleados para supervisor/admin.
 * Funcionalidades:
 *   - Tabla con columnas: nombre, correo, rol, estado y fecha de contratación
 *   - Filtros por rol y por estado; ordenamiento por columna
 *   - Botón "Editar" → panel lateral con formulario
 *   - Botón "Desactivar/Activar" → modal de confirmación
 *   - Botón "Nuevo empleado" → PanelCrearEmpleado con validación client-side
 *   - Integración POST /empleados, manejo correo duplicado y confirmación visual
 * ---------------------------------------------------------------------------
 */

import { useState, useEffect, useRef } from 'react'
import apiClient from '../api/client'
import Spinner from '../components/ui/Spinner'
import Badge from '../components/ui/Badge'
import styles from './EmpleadosPage.module.css'

const USE_MOCK = false

const MOCK_EMPLEADOS = [
  { id_empleado: 1, nombre: 'Carlos', apellido: 'Administrador', correo: 'admin@teleprogreso.com', rol: 'admin', estado: 'activo', telefono: '5550-0001', fecha_contratacion: '2020-01-15', placa_vehiculo: null },
  { id_empleado: 2, nombre: 'Juan', apellido: 'Pérez García', correo: 'tecnico@teleprogreso.com', rol: 'tecnico', estado: 'activo', telefono: '5550-0002', fecha_contratacion: '2022-06-01', placa_vehiculo: 'P-123ABC' },
  { id_empleado: 3, nombre: 'María', apellido: 'López Ruiz', correo: 'supervisora@teleprogreso.com', rol: 'supervisor', estado: 'activo', telefono: '5550-0003', fecha_contratacion: '2021-03-10', placa_vehiculo: null },
  { id_empleado: 4, nombre: 'Carlos', apellido: 'Hernández', correo: 'carlos.h@teleprogreso.com', rol: 'tecnico', estado: 'activo', telefono: '5550-0004', fecha_contratacion: '2023-01-20', placa_vehiculo: 'P-456DEF' },
  { id_empleado: 5, nombre: 'Ana', apellido: 'Rodríguez Soto', correo: 'ana.r@teleprogreso.com', rol: 'tecnico', estado: 'inactivo', telefono: '5550-0005', fecha_contratacion: '2022-09-15', placa_vehiculo: null },
  { id_empleado: 6, nombre: 'Roberto', apellido: 'Gómez', correo: 'roberto.g@teleprogreso.com', rol: 'gerente', estado: 'activo', telefono: '5550-0006', fecha_contratacion: '2019-07-01', placa_vehiculo: null },
]

const ROLES = ['admin', 'supervisor', 'tecnico', 'gerente']

const ROL_LABEL = {
  admin:      'Admin',
  supervisor: 'Supervisor',
  tecnico:    'Técnico',
  gerente:    'Gerente',
}

const ROL_VARIANT = {
  admin:      'danger',
  supervisor: 'info',
  tecnico:    'muted',
  gerente:    'warning',
}

const IconEdit   = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
  </svg>
)
const IconToggleOff = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="5" width="22" height="14" rx="7" ry="7"/>
    <circle cx="8" cy="12" r="3" fill="currentColor" stroke="none"/>
  </svg>
)
const IconToggleOn = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="5" width="22" height="14" rx="7" ry="7"/>
    <circle cx="16" cy="12" r="3" fill="currentColor" stroke="none"/>
  </svg>
)
const IconSearch  = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/>
    <line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
)
const IconX = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
)
const IconUser = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
    <circle cx="12" cy="7" r="4"/>
  </svg>
)
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
const IconPlus = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="12" y1="5" x2="12" y2="19"/>
    <line x1="5" y1="12" x2="19" y2="12"/>
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
const IconUserPlus = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
    <circle cx="8.5" cy="7" r="4"/>
    <line x1="20" y1="8" x2="20" y2="14"/>
    <line x1="23" y1="11" x2="17" y2="11"/>
  </svg>
)
const IconChevronUp   = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <polyline points="18 15 12 9 6 15"/>
  </svg>
)
const IconChevronDown = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <polyline points="6 9 12 15 18 9"/>
  </svg>
)
const IconChevronsUpDown = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <polyline points="7 15 12 20 17 15"/>
    <polyline points="7 9 12 4 17 9"/>
  </svg>
)

/* ═══════════════════════════════════════════════════════════════
   SCRUM-65 / SCRUM-66 — Panel Crear Empleado
   ═══════════════════════════════════════════════════════════════ */
const FORM_INICIAL = {
  nombre:            '',
  apellido:          '',
  correo:            '',
  telefono:          '',
  rol:               'tecnico',
  estado:            'activo',
  contrasena:        '',
  confirmar_contrasena: '',
  fecha_contratacion:'',
}

function validarFormulario(form) {
  const errores = {}
  if (!form.nombre.trim()) errores.nombre = 'El nombre es obligatorio.'
  else if (form.nombre.trim().length < 2) errores.nombre = 'El nombre debe tener al menos 2 caracteres.'
  if (!form.apellido.trim()) errores.apellido = 'El apellido es obligatorio.'
  else if (form.apellido.trim().length < 2) errores.apellido = 'El apellido debe tener al menos 2 caracteres.'
  if (!form.correo.trim()) errores.correo = 'El correo electrónico es obligatorio.'
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.correo.trim())) errores.correo = 'Ingresa un correo electrónico válido.'
  if (form.telefono.trim()) {
    const digitos = form.telefono.replace(/\D/g, '')
    if (digitos.length < 7) errores.telefono = 'El teléfono debe tener al menos 7 dígitos.'
    else if (!/^[0-9+\-() ]+$/.test(form.telefono.trim())) errores.telefono = 'Solo se permiten dígitos, espacios, +, - y ().'
  }
  if (!form.contrasena) errores.contrasena = 'La contraseña es obligatoria.'
  else if (form.contrasena.length < 8) errores.contrasena = 'La contraseña debe tener al menos 8 caracteres.'
  else if (!/[A-Z]/.test(form.contrasena)) errores.contrasena = 'Debe contener al menos una letra mayúscula.'
  else if (!/[a-z]/.test(form.contrasena)) errores.contrasena = 'Debe contener al menos una letra minúscula.'
  else if (!/[0-9]/.test(form.contrasena)) errores.contrasena = 'Debe contener al menos un número.'
  if (!form.confirmar_contrasena) errores.confirmar_contrasena = 'Confirma la contraseña.'
  else if (form.contrasena !== form.confirmar_contrasena) errores.confirmar_contrasena = 'Las contraseñas no coinciden.'
  if (!form.fecha_contratacion) errores.fecha_contratacion = 'La fecha de contratación es obligatoria.'
  else {
    const hoy = new Date(); hoy.setHours(0,0,0,0)
    const fecha = new Date(form.fecha_contratacion + 'T12:00:00')
    if (fecha > hoy) errores.fecha_contratacion = 'La fecha no puede ser en el futuro.'
  }
  return errores
}

function getPasswordStrength(pass) {
  if (!pass) return { level: 0, label: '', color: '' }
  let score = 0
  if (pass.length >= 8)  score++
  if (pass.length >= 12) score++
  if (/[A-Z]/.test(pass)) score++
  if (/[a-z]/.test(pass)) score++
  if (/[0-9]/.test(pass)) score++
  if (/[^A-Za-z0-9]/.test(pass)) score++
  if (score <= 2) return { level: 1, label: 'Débil',  color: '#ef4444' }
  if (score <= 4) return { level: 2, label: 'Media',  color: '#f97316' }
  return              { level: 3, label: 'Fuerte', color: '#16a34a' }
}

function PanelCrearEmpleado({ onCreado, onCerrar, empleadosExistentes }) {
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
    if (empleadosExistentes.some(e => e.correo.toLowerCase() === form.correo.trim().toLowerCase())) {
      setErrores(prev => ({ ...prev, correo: 'Este correo ya está registrado en el sistema.' }))
      return
    }
    setCargando(true); setErrorServidor(null)
    try {
      const payload = {
        nombre: form.nombre.trim(), apellido: form.apellido.trim(),
        correo: form.correo.trim().toLowerCase(), telefono: form.telefono.trim() || null,
        rol: form.rol, contrasena: form.contrasena, fecha_contratacion: form.fecha_contratacion,
      }
      if (USE_MOCK) {
        await new Promise(r => setTimeout(r, 800))
        onCreado({ id_empleado: Date.now(), ...payload, estado: form.estado, fecha_registro: new Date().toISOString(), ultimo_acceso: null })
      } else {
        const { data } = await apiClient.post('/empleados', payload)
        onCreado(data)
      }
    } catch (err) {
      const status = err?.response?.status
      const detail = err?.response?.data?.detail
      if (status === 409) {
        setErrores(prev => ({ ...prev, correo: 'Este correo ya está registrado en el sistema.' }))
      } else if (status === 400 || status === 422) {
        if (Array.isArray(detail)) {
          const errBack = {}
          detail.forEach(d => { const campo = d.loc?.[d.loc.length - 1]; if (campo && campo in FORM_INICIAL) errBack[campo] = d.msg || d.message })
          if (Object.keys(errBack).length > 0) { setErrores(prev => ({ ...prev, ...errBack })); return }
        }
        const msg = typeof detail === 'string' ? detail : ''
        if (msg.toLowerCase().includes('correo') || msg.toLowerCase().includes('email') || msg.toLowerCase().includes('duplicate') || msg.toLowerCase().includes('unique')) {
          setErrores(prev => ({ ...prev, correo: 'Este correo ya está registrado en el sistema.' })); return
        }
        setErrorServidor(msg || 'Los datos enviados no son válidos.')
      } else {
        setErrorServidor('Error al conectar con el servidor. Intenta de nuevo.')
      }
    } finally { setCargando(false) }
  }
  const campoTieneError = (campo) => tocados[campo] && errores[campo]

  return (
    <div className={styles.panelOverlay} onClick={onCerrar}>
      <div className={styles.editPanel} onClick={e => e.stopPropagation()}>
        <div className={styles.editPanelHeader}>
          <div className={styles.editPanelHeaderLeft}>
            <div className={styles.editAvatar} style={{ background: '#dbeafe', color: '#2563eb' }}>
              <IconUserPlus />
            </div>
            <div>
              <h2 className={styles.editPanelTitle}>Nuevo empleado</h2>
              <p className={styles.editPanelSubtitle}>Completa todos los campos obligatorios</p>
            </div>
          </div>
          <button className={styles.panelCloseBtn} onClick={onCerrar} aria-label="Cerrar panel"><IconX /></button>
        </div>
        {errorServidor && (
          <div className={styles.editErrorBanner}><IconAlert /><span>{errorServidor}</span></div>
        )}
        <form className={styles.editForm} onSubmit={handleSubmit} noValidate>
          <div className={styles.formSectionLabel}>Datos personales</div>
          <div className={styles.editFormGrid}>
            <div className={styles.editField}>
              <label className={styles.editLabel}>Nombre <span className={styles.required}>*</span></label>
              <input type="text" className={`${styles.editInput} ${campoTieneError('nombre') ? styles.editInputError : ''}`} value={form.nombre} onChange={e => handleChange('nombre', e.target.value)} onBlur={() => handleBlur('nombre')} disabled={cargando} placeholder="Ej: Juan" autoComplete="given-name" />
              {campoTieneError('nombre') && <p className={styles.editFieldError}>{errores.nombre}</p>}
            </div>
            <div className={styles.editField}>
              <label className={styles.editLabel}>Apellido <span className={styles.required}>*</span></label>
              <input type="text" className={`${styles.editInput} ${campoTieneError('apellido') ? styles.editInputError : ''}`} value={form.apellido} onChange={e => handleChange('apellido', e.target.value)} onBlur={() => handleBlur('apellido')} disabled={cargando} placeholder="Ej: Pérez García" autoComplete="family-name" />
              {campoTieneError('apellido') && <p className={styles.editFieldError}>{errores.apellido}</p>}
            </div>
          </div>
          <div className={styles.editField}>
            <label className={styles.editLabel}>Correo electrónico <span className={styles.required}>*</span></label>
            <input type="email" className={`${styles.editInput} ${campoTieneError('correo') ? styles.editInputError : ''}`} value={form.correo} onChange={e => handleChange('correo', e.target.value)} onBlur={() => handleBlur('correo')} disabled={cargando} placeholder="usuario@teleprogreso.com" autoComplete="email" />
            {campoTieneError('correo') && <p className={styles.editFieldError}>{errores.correo}</p>}
          </div>
          <div className={styles.editField}>
            <label className={styles.editLabel}>Teléfono <span className={styles.optional}>(opcional)</span></label>
            <input type="tel" className={`${styles.editInput} ${campoTieneError('telefono') ? styles.editInputError : ''}`} value={form.telefono} onChange={e => handleChange('telefono', e.target.value)} onBlur={() => handleBlur('telefono')} disabled={cargando} placeholder="Ej: 5550-0001" autoComplete="tel" />
            {campoTieneError('telefono') && <p className={styles.editFieldError}>{errores.telefono}</p>}
          </div>
          <div className={styles.formSectionLabel}>Rol y estado</div>
          <div className={styles.editFormGrid}>
            <div className={styles.editField}>
              <label className={styles.editLabel}>Rol <span className={styles.required}>*</span></label>
              <select className={styles.editSelect} value={form.rol} onChange={e => handleChange('rol', e.target.value)} disabled={cargando}>
                {ROLES.map(r => <option key={r} value={r}>{ROL_LABEL[r]}</option>)}
              </select>
            </div>
            <div className={styles.editField}>
              <label className={styles.editLabel}>Fecha de contratación <span className={styles.required}>*</span></label>
              <input type="date" className={`${styles.editInput} ${campoTieneError('fecha_contratacion') ? styles.editInputError : ''}`} value={form.fecha_contratacion} onChange={e => handleChange('fecha_contratacion', e.target.value)} onBlur={() => handleBlur('fecha_contratacion')} disabled={cargando} max={new Date().toISOString().split('T')[0]} />
              {campoTieneError('fecha_contratacion') && <p className={styles.editFieldError}>{errores.fecha_contratacion}</p>}
            </div>
          </div>
          <div className={styles.editField}>
            <label className={styles.editLabel}>Estado inicial</label>
            <div className={styles.estadoToggleGroup}>
              {['activo', 'inactivo'].map(est => (
                <button key={est} type="button" className={`${styles.estadoToggleBtn} ${form.estado === est ? styles.estadoToggleBtnActive : ''} ${est === 'activo' ? styles.estadoToggleBtnActivo : styles.estadoToggleBtnInactivo}`} onClick={() => handleChange('estado', est)} disabled={cargando}>
                  <span className={styles.estadoToggleDot} />{est.charAt(0).toUpperCase() + est.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.formSectionLabel}>Contraseña de acceso</div>
          <div className={styles.editField}>
            <label className={styles.editLabel}>Contraseña <span className={styles.required}>*</span></label>
            <div className={styles.passWrap}>
              <input type={showPass ? 'text' : 'password'} className={`${styles.editInput} ${styles.editInputWithIcon} ${campoTieneError('contrasena') ? styles.editInputError : ''}`} value={form.contrasena} onChange={e => handleChange('contrasena', e.target.value)} onBlur={() => handleBlur('contrasena')} disabled={cargando} placeholder="Mínimo 8 caracteres" autoComplete="new-password" />
              <button type="button" className={styles.passEyeBtn} onClick={() => setShowPass(v => !v)} tabIndex={-1} aria-label={showPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}>
                {showPass ? <IconEyeOff /> : <IconEye />}
              </button>
            </div>
            {form.contrasena && (
              <div className={styles.strengthBar}>
                <div className={styles.strengthSegments}>
                  {[1,2,3].map(lvl => <div key={lvl} className={styles.strengthSegment} style={{ background: strength.level >= lvl ? strength.color : '#e2e8f0' }} />)}
                </div>
                <span className={styles.strengthLabel} style={{ color: strength.color }}>{strength.label}</span>
              </div>
            )}
            {campoTieneError('contrasena') && <p className={styles.editFieldError}>{errores.contrasena}</p>}
            {!campoTieneError('contrasena') && <p className={styles.passHint}>Mín. 8 caracteres, una mayúscula, una minúscula y un número.</p>}
          </div>
          <div className={styles.editField}>
            <label className={styles.editLabel}>Confirmar contraseña <span className={styles.required}>*</span></label>
            <div className={styles.passWrap}>
              <input type={showConfirm ? 'text' : 'password'} className={`${styles.editInput} ${styles.editInputWithIcon} ${campoTieneError('confirmar_contrasena') ? styles.editInputError : ''}`} value={form.confirmar_contrasena} onChange={e => handleChange('confirmar_contrasena', e.target.value)} onBlur={() => handleBlur('confirmar_contrasena')} disabled={cargando} placeholder="Repite la contraseña" autoComplete="new-password" />
              <button type="button" className={styles.passEyeBtn} onClick={() => setShowConfirm(v => !v)} tabIndex={-1} aria-label={showConfirm ? 'Ocultar confirmación' : 'Mostrar confirmación'}>
                {showConfirm ? <IconEyeOff /> : <IconEye />}
              </button>
            </div>
            {campoTieneError('confirmar_contrasena') && <p className={styles.editFieldError}>{errores.confirmar_contrasena}</p>}
          </div>
          <div className={styles.editFormBtns}>
            <button type="button" className={styles.editCancelBtn} onClick={onCerrar} disabled={cargando}>Cancelar</button>
            <button type="submit" className={styles.editSaveBtn} disabled={cargando}>
              {cargando ? <><Spinner size="sm" color="white" /> Creando...</> : <><IconUserPlus /> Crear empleado</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ModalConfirmacion({ empleado, onConfirmar, onCancelar, cargando }) {
  const esActivo    = empleado.estado === 'activo'
  const nuevoEstado = esActivo ? 'inactivo' : 'activo'
  return (
    <div className={styles.modalOverlay} onClick={onCancelar}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={`${styles.modalIconWrap} ${esActivo ? styles.modalIconDanger : styles.modalIconSuccess}`}>
          {esActivo ? <IconAlert /> : <IconCheck />}
        </div>
        <h3 className={styles.modalTitle}>{esActivo ? 'Desactivar empleado' : 'Activar empleado'}</h3>
        <p className={styles.modalDesc}>
          {esActivo
            ? <><strong>{empleado.nombre} {empleado.apellido}</strong> no podrá iniciar sesión mientras esté inactivo.</>
            : <>¿Deseas activar nuevamente a <strong>{empleado.nombre} {empleado.apellido}</strong>?</>
          }
        </p>
        <div className={styles.modalBtns}>
          <button className={styles.modalCancelBtn} onClick={onCancelar} disabled={cargando}>Cancelar</button>
          <button className={`${styles.modalConfirmBtn} ${esActivo ? styles.modalConfirmDanger : styles.modalConfirmSuccess}`} onClick={() => onConfirmar(empleado.id_empleado, nuevoEstado)} disabled={cargando}>
            {cargando ? <><Spinner size="sm" color="white" /> Procesando...</> : esActivo ? 'Sí, desactivar' : 'Sí, activar'}
          </button>
        </div>
      </div>
    </div>
  )
}

function PanelEditar({ empleado, onGuardar, onCerrar, cargando, errorMsg }) {
  const [form, setForm] = useState({ nombre: empleado.nombre ?? '', apellido: empleado.apellido ?? '', correo: empleado.correo ?? '', telefono: empleado.telefono ?? '', rol: empleado.rol ?? 'tecnico' })
  const [errores, setErrores] = useState({})
  const handleChange = (campo, valor) => { setForm(prev => ({ ...prev, [campo]: valor })); if (errores[campo]) setErrores(prev => ({ ...prev, [campo]: null })) }
  const validar = () => {
    const e = {}
    if (!form.nombre.trim())   e.nombre   = 'El nombre es obligatorio.'
    if (!form.apellido.trim()) e.apellido  = 'El apellido es obligatorio.'
    if (!form.correo.trim())   e.correo    = 'El correo es obligatorio.'
    if (form.correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.correo)) e.correo = 'Ingresa un correo válido.'
    if (form.telefono && !/^[0-9+\-() ]{7,}$/.test(form.telefono.trim())) e.telefono = 'Teléfono inválido (mín. 7 dígitos).'
    setErrores(e)
    return Object.keys(e).length === 0
  }
  const handleSubmit = (e) => {
    e.preventDefault()
    if (!validar()) return
    const cambios = {}
    if (form.nombre.trim()   !== empleado.nombre)              cambios.nombre   = form.nombre.trim()
    if (form.apellido.trim() !== empleado.apellido)            cambios.apellido = form.apellido.trim()
    if (form.correo.trim()   !== empleado.correo)              cambios.correo   = form.correo.trim()
    if (form.rol             !== empleado.rol)                 cambios.rol      = form.rol
    if (form.telefono.trim() !== (empleado.telefono ?? ''))    cambios.telefono = form.telefono.trim() || null
    if (Object.keys(cambios).length === 0) { onCerrar(); return }
    onGuardar(empleado.id_empleado, cambios)
  }
  return (
    <div className={styles.panelOverlay} onClick={onCerrar}>
      <div className={styles.editPanel} onClick={e => e.stopPropagation()}>
        <div className={styles.editPanelHeader}>
          <div className={styles.editPanelHeaderLeft}>
            <div className={styles.editAvatar}>{empleado.nombre[0]?.toUpperCase()}{empleado.apellido[0]?.toUpperCase()}</div>
            <div>
              <h2 className={styles.editPanelTitle}>Editar empleado</h2>
              <p className={styles.editPanelSubtitle}>ID #{empleado.id_empleado} — {empleado.correo}</p>
            </div>
          </div>
          <button className={styles.panelCloseBtn} onClick={onCerrar} aria-label="Cerrar panel"><IconX /></button>
        </div>
        {errorMsg && <div className={styles.editErrorBanner}><IconAlert /><span>{errorMsg}</span></div>}
        <form className={styles.editForm} onSubmit={handleSubmit} noValidate>
          <div className={styles.editFormGrid}>
            <div className={styles.editField}>
              <label className={styles.editLabel}>Nombre <span className={styles.required}>*</span></label>
              <input type="text" className={`${styles.editInput} ${errores.nombre ? styles.editInputError : ''}`} value={form.nombre} onChange={e => handleChange('nombre', e.target.value)} disabled={cargando} placeholder="Ej: Juan" />
              {errores.nombre && <p className={styles.editFieldError}>{errores.nombre}</p>}
            </div>
            <div className={styles.editField}>
              <label className={styles.editLabel}>Apellido <span className={styles.required}>*</span></label>
              <input type="text" className={`${styles.editInput} ${errores.apellido ? styles.editInputError : ''}`} value={form.apellido} onChange={e => handleChange('apellido', e.target.value)} disabled={cargando} placeholder="Ej: Pérez García" />
              {errores.apellido && <p className={styles.editFieldError}>{errores.apellido}</p>}
            </div>
          </div>
          <div className={styles.editField}>
            <label className={styles.editLabel}>Correo electrónico <span className={styles.required}>*</span></label>
            <input type="email" className={`${styles.editInput} ${errores.correo ? styles.editInputError : ''}`} value={form.correo} onChange={e => handleChange('correo', e.target.value)} disabled={cargando} placeholder="usuario@teleprogreso.com" />
            {errores.correo && <p className={styles.editFieldError}>{errores.correo}</p>}
          </div>
          <div className={styles.editField}>
            <label className={styles.editLabel}>Teléfono</label>
            <input type="tel" className={`${styles.editInput} ${errores.telefono ? styles.editInputError : ''}`} value={form.telefono} onChange={e => handleChange('telefono', e.target.value)} disabled={cargando} placeholder="Ej: 5550-0001" />
            {errores.telefono && <p className={styles.editFieldError}>{errores.telefono}</p>}
          </div>
          <div className={styles.editField}>
            <label className={styles.editLabel}>Rol</label>
            <select className={styles.editSelect} value={form.rol} onChange={e => handleChange('rol', e.target.value)} disabled={cargando}>
              {ROLES.map(r => <option key={r} value={r}>{ROL_LABEL[r]}</option>)}
            </select>
          </div>
          <div className={styles.editFormBtns}>
            <button type="button" className={styles.editCancelBtn} onClick={onCerrar} disabled={cargando}>Cancelar</button>
            <button type="submit" className={styles.editSaveBtn} disabled={cargando}>
              {cargando ? <><Spinner size="sm" color="white" /> Guardando...</> : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
   COMPONENTE PRINCIPAL
   ══════════════════════════════════════════════════════════════ */
export default function EmpleadosPage() {
  const [empleados,      setEmpleados]      = useState([])
  const [loading,        setLoading]        = useState(true)
  const [error,          setError]          = useState(null)
  const [busqueda,       setBusqueda]       = useState('')
  const [filtroRol,      setFiltroRol]      = useState('todos')
  const [filtroEstado,   setFiltroEstado]   = useState('todos')   // SCRUM-75
  const [sortConfig,     setSortConfig]     = useState({ key: null, dir: 'asc' }) // SCRUM-75

  const [empleadoEditar, setEmpleadoEditar] = useState(null)
  const [editCargando,   setEditCargando]   = useState(false)
  const [editError,      setEditError]      = useState(null)

  const [empleadoToggle, setEmpleadoToggle] = useState(null)
  const [toggleCargando, setToggleCargando] = useState(false)

  const [mostrarCrear,   setMostrarCrear]   = useState(false)

  const [successMsg,     setSuccessMsg]     = useState(null)
  const successTimer = useRef(null)

  const mostrarExito = (msg) => {
    setSuccessMsg(msg)
    clearTimeout(successTimer.current)
    successTimer.current = setTimeout(() => setSuccessMsg(null), 4000)
  }

  useEffect(() => () => clearTimeout(successTimer.current), [])

  useEffect(() => {
    const fetchEmpleados = async () => {
      setLoading(true); setError(null)
      try {
        if (USE_MOCK) {
          await new Promise(r => setTimeout(r, 500))
          setEmpleados(MOCK_EMPLEADOS)
        } else {
          const { data } = await apiClient.get('/empleados')
          setEmpleados(Array.isArray(data) ? data : (data?.empleados ?? []))
        }
      } catch (err) {
        setError(err?.response?.data?.detail || 'No se pudieron cargar los empleados.')
      } finally { setLoading(false) }
    }
    fetchEmpleados()
  }, [])

  const handleEmpleadoCreado = (nuevoEmpleado) => {
    setEmpleados(prev => [nuevoEmpleado, ...prev])
    setMostrarCrear(false)
    mostrarExito(`Empleado ${nuevoEmpleado.nombre} ${nuevoEmpleado.apellido} creado correctamente.`)
  }

  const handleGuardarEdicion = async (id, cambios) => {
    setEditCargando(true); setEditError(null)
    try {
      if (!USE_MOCK) {
        const { data } = await apiClient.patch(`/empleados/${id}`, cambios)
        setEmpleados(prev => prev.map(e => e.id_empleado === id ? { ...e, ...data } : e))
      } else {
        await new Promise(r => setTimeout(r, 700))
        setEmpleados(prev => prev.map(e => e.id_empleado === id ? { ...e, ...cambios } : e))
      }
      setEmpleadoEditar(null)
      mostrarExito('Empleado actualizado correctamente.')
    } catch (err) {
      const detail = err?.response?.data?.detail
      setEditError(Array.isArray(detail) ? detail.map(d => d.message || d.msg).join(', ') : detail || 'Error al guardar los cambios.')
    } finally { setEditCargando(false) }
  }

  const handleToggleEstado = async (id, nuevoEstado) => {
    setToggleCargando(true)
    try {
      if (!USE_MOCK) {
        const { data } = await apiClient.patch(`/empleados/${id}/estado`, { estado: nuevoEstado })
        setEmpleados(prev => prev.map(e => e.id_empleado === id ? { ...e, estado: data.estado } : e))
      } else {
        await new Promise(r => setTimeout(r, 600))
        setEmpleados(prev => prev.map(e => e.id_empleado === id ? { ...e, estado: nuevoEstado } : e))
      }
      mostrarExito(`Empleado ${nuevoEstado === 'activo' ? 'activado' : 'desactivado'} correctamente.`)
      setEmpleadoToggle(null)
    } catch (err) {
      setError(err?.response?.data?.detail || 'Error al cambiar el estado.')
      setEmpleadoToggle(null)
    } finally { setToggleCargando(false) }
  }

  // SCRUM-75: Ordenamiento por columna
  const handleSort = (key) => {
    setSortConfig(prev => ({
      key,
      dir: prev.key === key && prev.dir === 'asc' ? 'desc' : 'asc',
    }))
  }

  const SortIcon = ({ colKey }) => {
    if (sortConfig.key !== colKey) return <span className={styles.sortIconNeutral}><IconChevronsUpDown /></span>
    return sortConfig.dir === 'asc'
      ? <span className={styles.sortIconActive}><IconChevronUp /></span>
      : <span className={styles.sortIconActive}><IconChevronDown /></span>
  }

  // SCRUM-74 + SCRUM-75: filtrado y ordenamiento
  const empleadosFiltrados = (() => {
    let lista = empleados.filter(e => {
      const texto = busqueda.toLowerCase()
      const coincideBusqueda =
        !texto ||
        e.nombre.toLowerCase().includes(texto)   ||
        e.apellido.toLowerCase().includes(texto) ||
        e.correo.toLowerCase().includes(texto)
      const coincideRol    = filtroRol    === 'todos' || e.rol    === filtroRol
      const coincideEstado = filtroEstado === 'todos' || e.estado === filtroEstado
      return coincideBusqueda && coincideRol && coincideEstado
    })

    if (sortConfig.key) {
      lista = [...lista].sort((a, b) => {
        let valA, valB
        if (sortConfig.key === 'nombre_completo') {
          valA = `${a.nombre} ${a.apellido}`.toLowerCase()
          valB = `${b.nombre} ${b.apellido}`.toLowerCase()
        } else {
          valA = String(a[sortConfig.key] ?? '').toLowerCase()
          valB = String(b[sortConfig.key] ?? '').toLowerCase()
        }
        if (valA < valB) return sortConfig.dir === 'asc' ? -1 : 1
        if (valA > valB) return sortConfig.dir === 'asc' ?  1 : -1
        return 0
      })
    }

    return lista
  })()

  const totalActivos   = empleados.filter(e => e.estado === 'activo').length
  const totalInactivos = empleados.filter(e => e.estado === 'inactivo').length

  if (loading) {
    return (
      <div className={styles.center}>
        <Spinner size="lg" />
        <p className={styles.loadingText}>Cargando empleados...</p>
      </div>
    )
  }

  if (error && empleados.length === 0) {
    return <div className={styles.center}><p className={styles.errorText}>{error}</p></div>
  }

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div className={styles.pageHeaderLeft}>
          <h1 className={styles.title}>Gestión de Empleados</h1>
          <p className={styles.subtitle}>
            {empleados.length} empleados en total ·{' '}
            <span className={styles.countActivos}>{totalActivos} activos</span>
            {totalInactivos > 0 && (
              <> · <span className={styles.countInactivos}>{totalInactivos} inactivos</span></>
            )}
          </p>
        </div>
        <button className={styles.btnNuevoEmpleado} onClick={() => setMostrarCrear(true)}>
          <IconPlus /><span>Nuevo empleado</span>
        </button>
      </div>

      {successMsg && (
        <div className={styles.toast} role="status" aria-live="polite">
          <span className={styles.toastIcon}><IconCheck /></span>
          <div className={styles.toastBody}>
            <span className={styles.toastTitle}>¡Listo!</span>
            <span className={styles.toastMsg}>{successMsg}</span>
          </div>
          <button
            type="button"
            className={styles.toastClose}
            onClick={() => setSuccessMsg(null)}
            aria-label="Cerrar notificación"
          >
            <IconX />
          </button>
          <span className={styles.toastBar} />
        </div>
      )}
      {error && empleados.length > 0 && (
        <div className={styles.errorBanner}>{error}</div>
      )}

      {/* SCRUM-75: Toolbar con búsqueda + filtro rol + filtro estado */}
      <div className={styles.toolbar}>
        <div className={styles.searchWrap}>
          <span className={styles.searchIcon}><IconSearch /></span>
          <input
            type="search"
            className={styles.searchInput}
            placeholder="Buscar por nombre, apellido o correo..."
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
          />
          {busqueda && (
            <button className={styles.searchClear} onClick={() => setBusqueda('')} aria-label="Limpiar búsqueda">
              <IconX />
            </button>
          )}
        </div>
        <div className={styles.filters}>
          <select className={styles.filterSelect} value={filtroRol} onChange={e => setFiltroRol(e.target.value)}>
            <option value="todos">Todos los roles</option>
            {ROLES.map(r => <option key={r} value={r}>{ROL_LABEL[r]}</option>)}
          </select>
          <select className={styles.filterSelect} value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}>
            <option value="todos">Todos los estados</option>
            <option value="activo">Activo</option>
            <option value="inactivo">Inactivo</option>
          </select>
        </div>
      </div>

      {empleadosFiltrados.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}><IconUser /></div>
          <p className={styles.emptyMsg}>
            {busqueda || filtroRol !== 'todos' || filtroEstado !== 'todos'
              ? 'No se encontraron empleados con esos criterios.'
              : 'No hay empleados registrados.'}
          </p>
          {(busqueda || filtroRol !== 'todos' || filtroEstado !== 'todos') && (
            <button className={styles.emptyResetBtn} onClick={() => { setBusqueda(''); setFiltroRol('todos'); setFiltroEstado('todos') }}>
              Limpiar filtros
            </button>
          )}
        </div>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            {/* SCRUM-75: Headers con ordenamiento */}
            <thead className={styles.thead}>
              <tr>
                <th className={`${styles.th} ${styles.thSortable}`} onClick={() => handleSort('nombre_completo')}>
                  <span>Empleado</span><SortIcon colKey="nombre_completo" />
                </th>
                <th className={`${styles.th} ${styles.thSortable}`} onClick={() => handleSort('correo')}>
                  <span>Correo</span><SortIcon colKey="correo" />
                </th>
                <th className={`${styles.th} ${styles.thSortable}`} onClick={() => handleSort('rol')}>
                  <span>Rol</span><SortIcon colKey="rol" />
                </th>
                <th className={`${styles.th} ${styles.thSortable}`} onClick={() => handleSort('estado')}>
                  <span>Estado</span><SortIcon colKey="estado" />
                </th>
                <th className={`${styles.th} ${styles.thSortable}`} onClick={() => handleSort('fecha_contratacion')}>
                  <span>Contratación</span><SortIcon colKey="fecha_contratacion" />
                </th>
                <th className={`${styles.th} ${styles.thSortable}`} onClick={() => handleSort('placa_vehiculo')}>
                  <span>Vehículo</span><SortIcon colKey="placa_vehiculo" />
                </th>
                <th className={`${styles.th} ${styles.thAcciones}`}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {empleadosFiltrados.map(emp => {
                const esActivo = emp.estado === 'activo'
                return (
                  <tr key={emp.id_empleado} className={`${styles.tr} ${!esActivo ? styles.trInactivo : ''}`}>
                    {/* SCRUM-74: Nombre */}
                    <td className={styles.td}>
                      <div className={styles.empleadoCell}>
                        <div className={`${styles.avatar} ${!esActivo ? styles.avatarInactivo : ''}`}>
                          {emp.nombre[0]?.toUpperCase()}{emp.apellido[0]?.toUpperCase()}
                        </div>
                        <span className={styles.empleadoNombre}>{emp.nombre} {emp.apellido}</span>
                      </div>
                    </td>
                    {/* SCRUM-74: Correo */}
                    <td className={styles.td}>
                      <span className={styles.empleadoCorreo}>{emp.correo}</span>
                    </td>
                    {/* SCRUM-74: Rol */}
                    <td className={styles.td}>
                      <Badge label={ROL_LABEL[emp.rol] ?? emp.rol} variant={ROL_VARIANT[emp.rol] ?? 'muted'} />
                    </td>
                    {/* SCRUM-74: Estado */}
                    <td className={styles.td}>
                      <span className={`${styles.estadoBadge} ${esActivo ? styles.estadoActivo : styles.estadoInactivo}`}>
                        <span className={styles.estadoDot} />
                        {esActivo ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    {/* SCRUM-74: Fecha de contratación */}
                    <td className={styles.td}>
                      <span className={styles.fechaText}>
                        {emp.fecha_contratacion
                          ? new Date(emp.fecha_contratacion + 'T12:00:00').toLocaleDateString('es-GT', { day: '2-digit', month: 'short', year: 'numeric' })
                          : <span className={styles.sinDato}>—</span>}
                      </span>
                    </td>
                    <td className={styles.td}>
                        {emp.placa_vehiculo
                          ? <span className={styles.placaVehiculo}>{emp.placa_vehiculo}</span>
                          : <span className={styles.sinDato}>—</span>}
                    </td>
                    <td className={`${styles.td} ${styles.tdAcciones}`}>
                      <button className={styles.btnEditar} onClick={() => { setEditError(null); setEmpleadoEditar(emp) }} title={`Editar a ${emp.nombre}`}>
                        <IconEdit /><span>Editar</span>
                      </button>
                      <button
                        className={`${styles.btnToggle} ${esActivo ? styles.btnDesactivar : styles.btnActivar}`}
                        onClick={() => setEmpleadoToggle(emp)}
                        title={esActivo ? 'Desactivar' : 'Activar'}
                      >
                        {esActivo ? <IconToggleOff /> : <IconToggleOn />}
                        <span>{esActivo ? 'Desactivar' : 'Activar'}</span>
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className={styles.resultCount}>
            Mostrando {empleadosFiltrados.length} de {empleados.length} empleados
          </p>
        </div>
      )}

      {mostrarCrear && (
        <PanelCrearEmpleado onCreado={handleEmpleadoCreado} onCerrar={() => setMostrarCrear(false)} empleadosExistentes={empleados} />
      )}
      {empleadoEditar && (
        <PanelEditar empleado={empleadoEditar} onGuardar={handleGuardarEdicion} onCerrar={() => { setEmpleadoEditar(null); setEditError(null) }} cargando={editCargando} errorMsg={editError} />
      )}
      {empleadoToggle && (
        <ModalConfirmacion empleado={empleadoToggle} onConfirmar={handleToggleEstado} onCancelar={() => setEmpleadoToggle(null)} cargando={toggleCargando} />
      )}
    </div>
  )
}