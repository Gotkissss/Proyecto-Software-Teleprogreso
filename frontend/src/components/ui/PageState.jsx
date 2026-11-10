/**
 * components/ui/PageState.jsx
 * ---------------------------------------------------------------------------
 * Resuelve en un solo lugar los tres estados que toda pantalla repite:
 * cargando, error y vacío. Antes cada página los pintaba a su manera (un
 * <p> rojo aquí, un div con emoji allá), así que el mismo error se veía
 * distinto según dónde ocurriera.
 *
 * Uso como early return (cuando el estado reemplaza a toda la página):
 *
 *   if (loading || error) {
 *     return <PageState loading={loading} error={error} onRetry={fetchDatos} />
 *   }
 *
 * Uso inline (cuando solo reemplaza una sección):
 *
 *   {loading || error || items.length === 0 ? (
 *     <PageState loading={loading} error={error} onRetry={fetchDatos} empty
 *                emptyTitle="No hay tareas" />
 *   ) : (
 *     <Lista items={items} />
 *   )}
 *
 * ⚠️ NO hacer `const estado = <PageState ... />; if (estado) return estado`.
 * Un elemento JSX es siempre truthy, así que ese `if` se cumple siempre y la
 * página devuelve el PageState — que internamente renderiza `null` cuando no
 * hay nada que mostrar. Resultado: pantalla en blanco. La condición tiene que
 * estar sobre los datos (`loading`, `error`, `items.length`), no sobre el
 * elemento.
 * ---------------------------------------------------------------------------
 */

import EmptyState from './EmptyState'
import Spinner from './Spinner'
import styles from './PageState.module.css'

const IconError = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
)

const IconVacio = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 12h-6l-2 3h-4l-2-3H2" />
    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  </svg>
)

export default function PageState({
  loading = false,
  error = null,
  onRetry,
  empty = false,
  loadingLabel,
  errorTitle = 'No se pudieron cargar los datos',
  emptyIcon,
  emptyTitle = 'No hay nada que mostrar',
  emptyDescription,
  emptyAction,
}) {
  if (loading) {
    return (
      <div className={styles.center}>
        <Spinner size="lg" />
        {loadingLabel && <p className={styles.loadingLabel}>{loadingLabel}</p>}
      </div>
    )
  }

  if (error) {
    return (
      <EmptyState
        variant="error"
        icon={<IconError />}
        title={errorTitle}
        // El detalle que devuelve el backend es más útil que un texto genérico.
        description={typeof error === 'string' ? error : undefined}
        action={
          onRetry && (
            <button className={styles.retryBtn} onClick={onRetry}>
              Reintentar
            </button>
          )
        }
      />
    )
  }

  if (empty) {
    return (
      <EmptyState
        icon={emptyIcon ?? <IconVacio />}
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
      />
    )
  }

  return null
}
