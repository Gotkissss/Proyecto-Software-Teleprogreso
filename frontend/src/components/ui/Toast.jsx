/**
 * components/ui/Toast.jsx
 * Sistema de toasts global — reemplaza los toasts inline por página.
 *
 * 1. Envolver la app:            <ToastProvider> ... </ToastProvider>
 * 2. En cualquier componente:    const toast = useToast()
 *                                toast.success('Guardado correctamente')
 *                                toast.error('Algo salió mal')
 */
import { createContext, useCallback, useContext, useRef, useState } from 'react'
import styles from './Toast.module.css'

const ToastContext = createContext(null)

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const idRef = useRef(0)

  const remove = useCallback((id) => {
    setToasts((t) => t.filter((x) => x.id !== id))
  }, [])

  const push = useCallback((tipo, mensaje, ms = 3500) => {
    const id = ++idRef.current
    setToasts((t) => [...t, { id, tipo, mensaje }])
    setTimeout(() => remove(id), ms)
  }, [remove])

  const api = {
    success: (m, ms) => push('success', m, ms),
    error:   (m, ms) => push('error', m, ms),
    info:    (m, ms) => push('info', m, ms),
  }

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={styles.container} aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`${styles.toast} ${styles[t.tipo]}`} onClick={() => remove(t.id)}>
            {t.mensaje}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast debe usarse dentro de <ToastProvider>')
  return ctx
}
