/**
 * components/ui/ErrorBoundary.jsx
 * ---------------------------------------------------------------------------
 * HU-S10-04 (tarea 5): un error al renderizar una pantalla ya no deja la
 * aplicación en blanco. React desmonta todo el árbol cuando un componente
 * lanza durante el render y no hay un límite de error que lo atrape.
 *
 * Se coloca alrededor del <Outlet /> de los dos layouts: si una página falla,
 * el encabezado y la navegación siguen en pantalla y el usuario puede moverse a
 * otra sección. Con `claveReinicio` (la ruta actual) el límite se reinicia al
 * navegar, así que un error en una pantalla no contamina a las demás.
 *
 * Muestra "algo salió mal", un botón para recargar y, si el último error del
 * servidor traía un request_id, ese identificador para reportarlo.
 *
 * Solo atrapa errores de render, de ciclo de vida y de constructores. Los
 * errores de eventos y de promesas (axios) se siguen manejando donde ocurren.
 * ---------------------------------------------------------------------------
 */

import { Component } from 'react'
import { obtenerUltimoRequestId } from '../../utils/ultimoErrorServidor'
import styles from './ErrorBoundary.module.css'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, requestId: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // El request_id se lee al fallar, no al montar: es el del último 5xx.
    this.setState({ requestId: obtenerUltimoRequestId() })
    // Solo a la consola del navegador: nunca se muestra el mensaje ni el stack.
    console.error('ErrorBoundary: error de render', error, info?.componentStack)
  }

  componentDidUpdate(prevProps) {
    if (this.state.error && prevProps.claveReinicio !== this.props.claveReinicio) {
      this.setState({ error: null, requestId: null })
    }
  }

  recargar = () => {
    const { onRecargar } = this.props
    if (onRecargar) onRecargar()
    else window.location.reload()
  }

  render() {
    if (!this.state.error) return this.props.children

    const { requestId } = this.state
    return (
      <div className={styles.contenedor} role="alert">
        <h2 className={styles.titulo}>Algo salió mal</h2>
        <p className={styles.texto}>
          Esta pantalla tuvo un problema y no pudo mostrarse. Puedes recargar la
          página o ir a otra sección del menú.
        </p>
        {requestId && (
          <p className={styles.referencia}>
            Si el problema continúa, avisa al equipo con este código:{' '}
            <code className={styles.codigo}>{requestId}</code>
          </p>
        )}
        <button type="button" className={styles.boton} onClick={this.recargar}>
          Recargar
        </button>
      </div>
    )
  }
}
