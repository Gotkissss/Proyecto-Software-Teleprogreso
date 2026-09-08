/**
 * pages/PerfilPage.jsx
 * ---------------------------------------------------------------------------
 * Perfil del usuario autenticado: sus datos de empleado y el formulario para
 * cambiar su propia contraseña.
 *
 * Se llega desde el menú del avatar, que es el mismo componente en los dos
 * layouts (UserMenu), así que la pantalla sirve tal cual al técnico en móvil
 * y al supervisor en desktop; solo cambia la ruta bajo la que se monta.
 *
 * Hasta ahora la contraseña solo la podía cambiar un admin o un supervisor
 * desde Empleados. El propio dueño de la cuenta no tenía ninguna forma de
 * hacerlo, ni siquiera sabiendo la actual.
 *
 * Al guardar, el backend invalida todas las sesiones del empleado
 * (`version_token`), así que el token con el que se hizo la llamada muere en
 * el acto: por eso al terminar se cierra sesión y se va al login en vez de
 * dejar la pantalla abierta con un token que ya no vale.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from 'react'
import Badge from '../components/ui/Badge'
import PageState from '../components/ui/PageState'
import Spinner from '../components/ui/Spinner'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../context/AuthContext'
import { cambiarContrasena, getPerfil } from '../api/authService'
import styles from './PerfilPage.module.css'

/* ── Reglas de la contraseña ────────────────────────────────────────────────
   El mínimo lo fija el backend (schemas/auth.py y schemas/empleado.py). Se
   repite aquí para poder avisar antes de gastar una petición, pero el que
   manda sigue siendo el servidor.
   ------------------------------------------------------------------------ */
export const MIN_CONTRASENA = 8

const ROL_LABEL = {
  admin:      'Administrador',
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

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

/**
 * "2025-01-15" → "15 de enero de 2025".
 *
 * Se lee del texto y no con `new Date(...)`: el backend manda las fechas ya
 * en hora de Guatemala y sin zona, y dejar que el navegador las reinterprete
 * mueve el día (ver utils/fecha.js).
 */
function formatearFecha(valor) {
  if (!valor) return '—'
  const [anio, mes, dia] = String(valor).slice(0, 10).split('-')
  const indiceMes = Number(mes) - 1
  if (!anio || !MESES[indiceMes]) return '—'
  return `${Number(dia)} de ${MESES[indiceMes]} de ${anio}`
}

/** "2025-01-15T08:30:00" → "15 de enero de 2025, 08:30". */
function formatearFechaHora(valor) {
  if (!valor) return '—'
  const fecha = formatearFecha(valor)
  const hora = String(valor).slice(11, 16)
  return hora ? `${fecha}, ${hora}` : fecha
}

/* ── Iconos ───────────────────────────────────────────────────────────────── */
const IconMail = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
    <polyline points="22,6 12,13 2,6" />
  </svg>
)
const IconPhone = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.68 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.32 1.85.55 2.81.68A2 2 0 0 1 22 16.92z" />
  </svg>
)
const IconCalendar = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
)
const IconClock = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <polyline points="12 7 12 12 15 14" />
  </svg>
)
const IconLock = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
)
const IconEye = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)
const IconEyeOff = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
)
const IconAlert = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
)

/* ── Validación del formulario ──────────────────────────────────────────────
   Se exporta para poder probarla sin montar la pantalla entera.
   ------------------------------------------------------------------------ */
export function validarCambioContrasena(form) {
  const errores = {}

  if (!form.actual) {
    errores.actual = 'Escribe tu contraseña actual.'
  }

  if (!form.nueva) {
    errores.nueva = 'Escribe la contraseña nueva.'
  } else if (form.nueva.length < MIN_CONTRASENA) {
    errores.nueva = `La contraseña nueva debe tener al menos ${MIN_CONTRASENA} caracteres.`
  } else if (form.nueva.trim() !== form.nueva) {
    errores.nueva = 'La contraseña no puede empezar ni terminar con espacios.'
  } else if (form.actual && form.nueva === form.actual) {
    errores.nueva = 'La contraseña nueva debe ser distinta de la actual.'
  }

  if (!form.confirmacion) {
    errores.confirmacion = 'Repite la contraseña nueva.'
  } else if (form.nueva && form.confirmacion !== form.nueva) {
    errores.confirmacion = 'Las contraseñas no coinciden.'
  }

  return errores
}

/* ── Campo de contraseña con botón de mostrar/ocultar ─────────────────────── */
function CampoContrasena({ id, label, valor, onChange, error, disabled, autoComplete }) {
  const [visible, setVisible] = useState(false)

  return (
    <div className={styles.campo}>
      <label className={styles.label} htmlFor={id}>{label}</label>
      <div className={styles.inputWrap}>
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          className={`${styles.input} ${error ? styles.inputError : ''}`}
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          autoComplete={autoComplete}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        <button
          type="button"
          className={styles.verBtn}
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
          tabIndex={-1}
        >
          {visible ? <IconEyeOff /> : <IconEye />}
        </button>
      </div>
      {error && (
        <p className={styles.campoError} id={`${id}-error`} role="alert">{error}</p>
      )}
    </div>
  )
}

/* ── Pantalla ─────────────────────────────────────────────────────────────── */
export default function PerfilPage() {
  const toast = useToast()
  const { cerrarSesionLocal } = useAuth()

  const [perfil,  setPerfil]  = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  const [form, setForm] = useState({ actual: '', nueva: '', confirmacion: '' })
  const [errores,      setErrores]      = useState({})
  const [errorEnvio,   setErrorEnvio]   = useState(null)
  const [guardando,    setGuardando]    = useState(false)

  const cargarPerfil = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setPerfil(await getPerfil())
    } catch (err) {
      setError(
        err?.response?.data?.detail || 'No se pudo cargar tu perfil.'
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { cargarPerfil() }, [cargarPerfil])

  const handleChange = (campo) => (valor) => {
    setForm((prev) => ({ ...prev, [campo]: valor }))
    // El error del campo se retira en cuanto se vuelve a escribir: dejarlo
    // puesto mientras se corrige hace pensar que la corrección no sirvió.
    setErrores((prev) => (prev[campo] ? { ...prev, [campo]: null } : prev))
    setErrorEnvio(null)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    const erroresValidacion = validarCambioContrasena(form)
    setErrores(erroresValidacion)
    if (Object.keys(erroresValidacion).length > 0) return

    setGuardando(true)
    setErrorEnvio(null)
    try {
      const respuesta = await cambiarContrasena({
        contrasenaActual: form.actual,
        nuevaContrasena:  form.nueva,
        confirmacion:     form.confirmacion,
      })

      toast.success(
        respuesta?.detail ||
          'Contraseña actualizada correctamente. Inicia sesión nuevamente.'
      )
      // El token ya no vale del lado del servidor: quedarse aquí solo llevaría
      // a un 401 en la siguiente petición.
      cerrarSesionLocal()
    } catch (err) {
      const status = err?.response?.status
      const detail = err?.response?.data?.detail
      let mensaje

      if (status === 400) {
        mensaje = typeof detail === 'string'
          ? detail
          : 'No se pudo cambiar la contraseña. Revisa los datos.'
      } else if (status === 422) {
        // 422 = el schema del backend rechazó el payload. Su `detail` es una
        // lista de objetos de Pydantic, ilegible tal cual para el usuario.
        mensaje = 'La contraseña nueva no cumple los requisitos mínimos.'
      } else if (status === 401) {
        mensaje = 'Tu sesión expiró. Vuelve a iniciar sesión e inténtalo otra vez.'
      } else {
        mensaje = 'No se pudo cambiar la contraseña. Inténtalo de nuevo.'
      }

      setErrorEnvio(mensaje)
      toast.error(mensaje)
      console.error('Error al cambiar la contraseña:', err)
    } finally {
      setGuardando(false)
    }
  }

  if (loading || error) {
    return (
      <PageState
        loading={loading}
        loadingLabel="Cargando tu perfil..."
        error={error}
        onRetry={cargarPerfil}
        errorTitle="No se pudo cargar tu perfil"
      />
    )
  }

  const nombreCompleto = `${perfil.nombre} ${perfil.apellido}`.trim()

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <h1 className={styles.title}>Mi perfil</h1>
        <p className={styles.subtitle}>
          Tus datos en Teleprogreso y el acceso a tu cuenta.
        </p>
      </header>

      {/* ── Identidad ─────────────────────────────────────────────────── */}
      <section className={styles.identidadCard}>
        <span className={styles.avatar} aria-hidden="true">
          {nombreCompleto[0]?.toUpperCase() ?? 'U'}
        </span>

        <div className={styles.identidadInfo}>
          <h2 className={styles.nombre}>{nombreCompleto}</h2>
          <p className={styles.correo}>{perfil.correo}</p>
          <div className={styles.badges}>
            <Badge
              label={ROL_LABEL[perfil.rol] ?? perfil.rol}
              variant={ROL_VARIANT[perfil.rol] ?? 'muted'}
            />
            <Badge
              label={perfil.estado === 'activo' ? 'Cuenta activa' : 'Cuenta inactiva'}
              variant={perfil.estado === 'activo' ? 'success' : 'danger'}
            />
          </div>
        </div>
      </section>

      {/* ── Datos del empleado ────────────────────────────────────────── */}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Datos del empleado</h2>
        {/* Solo lectura a propósito: quien corrige estos campos es un
            administrador desde Empleados, no el propio usuario. */}
        <p className={styles.cardNota}>
          Si algún dato está mal, pídele a un administrador que lo corrija
          desde la pantalla de Empleados.
        </p>

        <dl className={styles.datosGrid}>
          <div className={styles.dato}>
            <dt className={styles.datoLabel}><IconMail /> Correo</dt>
            <dd className={styles.datoValor}>{perfil.correo}</dd>
          </div>

          <div className={styles.dato}>
            <dt className={styles.datoLabel}><IconPhone /> Teléfono</dt>
            <dd className={styles.datoValor}>{perfil.telefono || '—'}</dd>
          </div>

          <div className={styles.dato}>
            <dt className={styles.datoLabel}><IconCalendar /> Fecha de contratación</dt>
            <dd className={styles.datoValor}>
              {formatearFecha(perfil.fecha_contratacion)}
            </dd>
          </div>

          <div className={styles.dato}>
            <dt className={styles.datoLabel}><IconCalendar /> Alta en el sistema</dt>
            <dd className={styles.datoValor}>
              {formatearFechaHora(perfil.fecha_registro)}
            </dd>
          </div>

          <div className={styles.dato}>
            <dt className={styles.datoLabel}><IconClock /> Último acceso</dt>
            <dd className={styles.datoValor}>
              {formatearFechaHora(perfil.ultimo_acceso)}
            </dd>
          </div>

          <div className={styles.dato}>
            <dt className={styles.datoLabel}>N.º de empleado</dt>
            <dd className={`${styles.datoValor} ${styles.datoMono}`}>
              {perfil.id_empleado}
            </dd>
          </div>
        </dl>
      </section>

      {/* ── Cambio de contraseña ──────────────────────────────────────── */}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}><IconLock /> Cambiar contraseña</h2>
        <p className={styles.cardNota}>
          Al guardarla se cerrarán todas tus sesiones y tendrás que iniciar
          sesión de nuevo con la contraseña nueva.
        </p>

        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          {errorEnvio && (
            <div className={styles.errorBanner} role="alert">
              <IconAlert />
              <span>{errorEnvio}</span>
            </div>
          )}

          <CampoContrasena
            id="perfil-actual"
            label="Contraseña actual"
            valor={form.actual}
            onChange={handleChange('actual')}
            error={errores.actual}
            disabled={guardando}
            autoComplete="current-password"
          />

          <CampoContrasena
            id="perfil-nueva"
            label="Contraseña nueva"
            valor={form.nueva}
            onChange={handleChange('nueva')}
            error={errores.nueva}
            disabled={guardando}
            autoComplete="new-password"
          />

          <CampoContrasena
            id="perfil-confirmacion"
            label="Repetir contraseña nueva"
            valor={form.confirmacion}
            onChange={handleChange('confirmacion')}
            error={errores.confirmacion}
            disabled={guardando}
            autoComplete="new-password"
          />

          <p className={styles.ayuda}>
            Mínimo {MIN_CONTRASENA} caracteres y distinta de la actual.
          </p>

          <div className={styles.formActions}>
            <button type="submit" className="btn btn-primary" disabled={guardando}>
              {guardando
                ? <><Spinner size="sm" color="white" /> Guardando…</>
                : 'Cambiar contraseña'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
