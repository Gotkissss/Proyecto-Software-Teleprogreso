/**
 * pages/CambioObligatorioPage.jsx
 * ---------------------------------------------------------------------------
 * Pantalla de cambio de contraseña obligatorio (HU-S10-01, tarea 4).
 *
 * A ella se llega cuando la cuenta tiene `debe_cambiar_contrasena`: la
 * contraseña la puso otra persona (un admin al crear la cuenta o al
 * restablecerla) y por eso no es secreta de verdad. Hasta cambiarla, el
 * backend responde 403 PASSWORD_CHANGE_REQUIRED a todo lo demás, así que esta
 * pantalla no tiene menú ni navegación: lo único posible es cambiar la clave o
 * cerrar sesión.
 *
 * Reutiliza el formulario de Mi perfil. Al guardar, el backend invalida las
 * sesiones, el formulario cierra la sesión local y se vuelve a login.
 * ---------------------------------------------------------------------------
 */

import { Navigate } from 'react-router-dom'
import FormularioCambioContrasena from '../components/perfil/FormularioCambioContrasena'
import { useAuth } from '../context/AuthContext'
import { debeCambiarContrasena } from '../utils/cambioObligatorio'
import { rutaInicialPorRol } from '../utils/permisos'
import styles from './CambioObligatorioPage.module.css'

export default function CambioObligatorioPage() {
  const { user, logoutUser } = useAuth()

  // Sin cambio pendiente esta pantalla no tiene nada que hacer: quien llegue
  // por un enlace viejo o con el botón "atrás" vuelve a su pantalla inicial.
  if (!debeCambiarContrasena(user)) {
    return <Navigate to={rutaInicialPorRol(user?.rol)} replace />
  }

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="cambio-obligatorio-titulo">
        <img
          src="/teleprogreso-logo.jpg"
          alt="Teleprogreso"
          className={styles.logo}
        />

        <h1 className={styles.title} id="cambio-obligatorio-titulo">
          Cambia tu contraseña para continuar
        </h1>
        <p className={styles.nota}>
          Tu contraseña actual te la asignó otra persona, así que no es
          privada. Por seguridad, elige una propia antes de usar el sistema.
          Al guardarla se cerrará tu sesión y tendrás que entrar de nuevo con
          la contraseña nueva.
        </p>

        <FormularioCambioContrasena
          idBase="obligatorio"
          etiquetaActual="Contraseña actual (la que te dieron)"
        />

        <div className={styles.salir}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={logoutUser}
          >
            Cerrar sesión
          </button>
        </div>
      </section>
    </main>
  )
}