/**
 * components/perfil/FormularioCambioContrasena.jsx
 * ---------------------------------------------------------------------------
 * Formulario para cambiar la contraseña propia (actual + nueva + repetir).
 *
 * Antes vivía dentro de PerfilPage. Se sacó para reutilizarlo en la pantalla
 * de cambio obligatorio (HU-S10-01), donde el usuario recién entró con una
 * contraseña que le puso otra persona. Los dos sitios hacen exactamente lo
 * mismo: llaman a POST /auth/cambiar-contrasena y, como el backend invalida
 * todas las sesiones al guardar, cierran la sesión local y mandan a login.
 *
 * Los estilos son los de PerfilPage.module.css: es el mismo formulario y así
 * no hay dos copias de la hoja que se desincronicen.
 * ---------------------------------------------------------------------------
 */

import { useState } from 'react'
import Spinner from '../ui/Spinner'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../context/AuthContext'
import { cambiarContrasena } from '../../api/authService'
import styles from '../../pages/PerfilPage.module.css'

/* ── Reglas de la contraseña ────────────────────────────────────────────────
   La política completa la aplica el backend (core/reglas.py,
   validar_politica_contrasena). Aquí solo se repite lo barato de comprobar
   para avisar antes de gastar una petición; el que manda es el servidor, y su
   mensaje es el que se muestra cuando rechaza algo más (contraseña común,
   igual al correo...).
   ------------------------------------------------------------------------ */
export const MIN_CONTRASENA = 8

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

/**
 * Mensaje a mostrar cuando el backend rechaza el cambio con 422.
 *
 * El backend devuelve `errors: [{ field, message }]` con el mensaje de la
 * política ("La contraseña es demasiado común. Elige otra."), precedido por el
 * "Value error, " que añade Pydantic. Se muestra ese mensaje en vez de un
 * genérico para que la persona sepa qué cambiar.
 */
export function mensajeDeValidacion(data) {
  const errores = Array.isArray(data?.errors) ? data.errors : []
  const deLaNueva = errores.find((e) => String(e?.field ?? '').includes('nueva_contrasena'))
  const mensaje = (deLaNueva ?? errores[0])?.message
  if (typeof mensaje === 'string' && mensaje.trim()) {
    return mensaje.replace(/^Value error,\s*/i, '')
  }
  return 'La contraseña nueva no cumple los requisitos mínimos.'
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

/**
 * @param {object}  props
 * @param {string}  [props.idBase]        Prefijo de los id de los campos.
 * @param {string}  [props.etiquetaActual] Texto del campo "contraseña actual".
 */
export default function FormularioCambioContrasena({
  idBase = 'perfil',
  etiquetaActual = 'Contraseña actual',
}) {
  const toast = useToast()
  const { cerrarSesionLocal } = useAuth()

  const [form, setForm] = useState({ actual: '', nueva: '', confirmacion: '' })
  const [errores,    setErrores]    = useState({})
  const [errorEnvio, setErrorEnvio] = useState(null)
  const [guardando,  setGuardando]  = useState(false)

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
        // 422 = el schema del backend rechazó el payload (política de
        // contraseña). Se muestra el mensaje concreto que trae `errors`.
        mensaje = mensajeDeValidacion(err?.response?.data)
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

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      {errorEnvio && (
        <div className={styles.errorBanner} role="alert">
          <IconAlert />
          <span>{errorEnvio}</span>
        </div>
      )}

      <CampoContrasena
        id={`${idBase}-actual`}
        label={etiquetaActual}
        valor={form.actual}
        onChange={handleChange('actual')}
        error={errores.actual}
        disabled={guardando}
        autoComplete="current-password"
      />

      <CampoContrasena
        id={`${idBase}-nueva`}
        label="Contraseña nueva"
        valor={form.nueva}
        onChange={handleChange('nueva')}
        error={errores.nueva}
        disabled={guardando}
        autoComplete="new-password"
      />

      <CampoContrasena
        id={`${idBase}-confirmacion`}
        label="Repetir contraseña nueva"
        valor={form.confirmacion}
        onChange={handleChange('confirmacion')}
        error={errores.confirmacion}
        disabled={guardando}
        autoComplete="new-password"
      />

      <p className={styles.ayuda}>
        Mínimo {MIN_CONTRASENA} caracteres, distinta de la actual y de tu
        correo, y que no sea una contraseña común.
      </p>

      <div className={styles.formActions}>
        <button type="submit" className="btn btn-primary" disabled={guardando}>
          {guardando
            ? <><Spinner size="sm" color="white" /> Guardando…</>
            : 'Cambiar contraseña'}
        </button>
      </div>
    </form>
  )
}