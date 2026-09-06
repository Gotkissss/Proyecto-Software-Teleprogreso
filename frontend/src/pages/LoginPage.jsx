/**
 * pages/LoginPage.jsx
 * ---------------------------------------------------------------------------
 * Vista de login con splash screen corporativo de Teleprogreso.
 * Animación: 1.6s mostrando el logo grande con ondas wifi pulsando,
 * luego transición suave al formulario.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import Spinner from '../components/ui/Spinner'
import styles from './LoginPage.module.css'

/* Iconos */
const IconEye = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)
const IconEyeOff = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
)
const IconMail = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
    <polyline points="22,6 12,13 2,6"/>
  </svg>
)
const IconLock = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
  </svg>
)

export default function LoginPage() {
  const { loginUser } = useAuth()

  const [correo,     setCorreo]     = useState('')
  const [contrasena, setContrasena] = useState('')
  const [showPass,   setShowPass]   = useState(false)
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState(null)
  const [splashDone, setSplashDone] = useState(false)

  // Splash screen: muestra el logo grande durante 1.6s antes
  // de revelar el formulario. Se omite si el usuario ya inició
  // sesión esta sesión del navegador.
  useEffect(() => {
    const alreadySeen = sessionStorage.getItem('splash_seen')
    if (alreadySeen) {
      setSplashDone(true)
      return
    }
    const t = setTimeout(() => {
      setSplashDone(true)
      sessionStorage.setItem('splash_seen', '1')
    }, 1600)
    return () => clearTimeout(t)
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!correo || !contrasena) {
      setError('Por favor completa todos los campos.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      await loginUser(correo, contrasena)
    } catch (err) {
      const detail = err?.response?.data?.detail
      if (err?.response?.status === 401) {
        setError('Credenciales incorrectas. Verifica tu correo y contraseña.')
      } else if (detail) {
        setError(typeof detail === 'string' ? detail : 'Error al iniciar sesión.')
      } else {
        setError('No se pudo conectar al servidor. Intenta de nuevo.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.page}>
      {/* Fondo decorativo: gradiente corporativo + blobs */}
      <div className={styles.bgDecor} aria-hidden="true">
        <div className={styles.bgGradient} />
        <div className={styles.bgBlob1} />
        <div className={styles.bgBlob2} />
        <div className={styles.bgGrid} />
      </div>

      {/* ── SPLASH SCREEN ─────────────────────────────────── */}
      {!splashDone && (
        <div className={styles.splash} aria-hidden="true">
          <div className={styles.splashLogoRing}>
            <img
              src="/teleprogreso-logo.png"
              alt="Teleprogreso"
              className={styles.splashLogo}
            />
          </div>
          <p className={styles.splashTagline}>
            Televisión e Internet por Fibra Óptica
          </p>
          <div className={styles.splashDots}>
            <span /><span /><span />
          </div>
        </div>
      )}

      {/* ── LAYOUT DE LOGIN ───────────────────────────────── */}
      <div className={`${styles.layout} ${splashDone ? styles.layoutVisible : ''}`}>
        {/* Lado izquierdo: branding */}
        <aside className={styles.brandSide}>
          <div className={styles.brandContent}>
            <img
              src="/teleprogreso-logo.png"
              alt="Teleprogreso"
              className={styles.brandLogo}
            />
            <h2 className={styles.brandTitle}>
              Control de Personal Operativo
            </h2>
            <p className={styles.brandSubtitle}>
              Gestión inteligente de técnicos, tareas y operaciones de campo
              en tiempo real.
            </p>

            {/* Highlights */}
            <ul className={styles.brandFeatures}>
              <li>
                <span className={styles.featDot} />
                Monitoreo de jornadas en vivo
              </li>
              <li>
                <span className={styles.featDot} />
                Reasignación dinámica de tareas
              </li>
              <li>
                <span className={styles.featDot} />
                Alertas operativas inmediatas
              </li>
            </ul>
          </div>

          <p className={styles.brandFooter}>
            © {new Date().getFullYear()} Teleprogreso S.A.
          </p>
        </aside>

        {/* Lado derecho: formulario */}
        <main className={styles.formSide}>
          <div className={styles.card}>
            {/* Logo móvil (oculto en desktop) */}
            <img
              src="/teleprogreso-logo.png"
              alt="Teleprogreso"
              className={styles.mobileLogo}
            />

            <div className={styles.header}>
              <h1 className={styles.title}>Bienvenido de vuelta</h1>
              <p className={styles.subtitle}>
                Ingresa tus credenciales para continuar
              </p>
            </div>

            <form className={styles.form} onSubmit={handleSubmit} noValidate>
              {error && (
                <div className={styles.errorBanner} role="alert">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <span>{error}</span>
                </div>
              )}

              {/* Correo */}
              <div className={styles.field}>
                <label htmlFor="correo" className={styles.label}>
                  Correo electrónico
                </label>
                <div className={styles.inputWrap}>
                  <span className={styles.inputIcon}><IconMail /></span>
                  <input
                    id="correo"
                    type="email"
                    autoComplete="email"
                    className={`${styles.input} ${styles.inputWithLeftIcon}`}
                    placeholder="usuario@teleprogreso.com"
                    value={correo}
                    onChange={(e) => setCorreo(e.target.value)}
                    disabled={loading}
                  />
                </div>
              </div>

              {/* Contraseña */}
              <div className={styles.field}>
                <label htmlFor="contrasena" className={styles.label}>
                  Contraseña
                </label>
                <div className={styles.inputWrap}>
                  <span className={styles.inputIcon}><IconLock /></span>
                  <input
                    id="contrasena"
                    type={showPass ? 'text' : 'password'}
                    autoComplete="current-password"
                    className={`${styles.input} ${styles.inputWithLeftIcon} ${styles.inputWithRightIcon}`}
                    placeholder="••••••••"
                    value={contrasena}
                    onChange={(e) => setContrasena(e.target.value)}
                    disabled={loading}
                  />
                  <button
                    type="button"
                    className={styles.eyeBtn}
                    onClick={() => setShowPass((v) => !v)}
                    tabIndex={-1}
                    aria-label={showPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  >
                    {showPass ? <IconEyeOff /> : <IconEye />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                className={`btn btn-primary ${styles.submitBtn}`}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Spinner size="sm" color="white" />
                    <span>Iniciando sesión...</span>
                  </>
                ) : (
                  <>
                    <span>Iniciar sesión</span>
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="12" x2="19" y2="12"/>
                      <polyline points="12 5 19 12 12 19"/>
                    </svg>
                  </>
                )}
              </button>
            </form>

            <p className={styles.helpText}>
              ¿Problemas para acceder? Contacta a tu supervisor.
            </p>
          </div>
        </main>
      </div>
    </div>
  )
}