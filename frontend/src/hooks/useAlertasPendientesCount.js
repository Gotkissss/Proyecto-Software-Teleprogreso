/**
 * hooks/useAlertasPendientesCount.js
 * ---------------------------------------------------------------------------
 * Devuelve el número de alertas pendientes (estado=pendiente) consultando el
 * endpoint real GET /alertas. Se usa para el badge contador del layout del
 * supervisor. Hace polling cada `intervalMs` para mantenerse actualizado sin
 * depender de que el usuario recargue la página.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useState } from 'react'
import { ESTADO_ALERTA, getAlertas } from '../api/alertaService'

const DEFAULT_INTERVAL_MS = 30000 // 30s

export function useAlertasPendientesCount(intervalMs = DEFAULT_INTERVAL_MS) {
  const [count, setCount] = useState(0)

  useEffect(() => {
    let activo = true

    const fetchCount = async () => {
      try {
        // generar=false: el badge solo cuenta. La detección la dispara la
        // pantalla de Alertas, así evitamos que el polling y la página
        // escriban alertas a la vez y se dupliquen.
        const data = await getAlertas({
          estado: ESTADO_ALERTA.PENDIENTE,
          generar: false,
        })
        if (activo) setCount(data.length)
      } catch (err) {
        // Si falla la consulta (ej. sesión vencida) no rompemos el layout,
        // simplemente no actualizamos el contador.
        console.error('Error al obtener alertas pendientes:', err)
      }
    }

    fetchCount()
    const id = setInterval(fetchCount, intervalMs)

    return () => {
      activo = false
      clearInterval(id)
    }
  }, [intervalMs])

  return count
}