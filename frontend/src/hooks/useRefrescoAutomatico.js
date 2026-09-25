/**
 * hooks/useRefrescoAutomatico.js
 * ---------------------------------------------------------------------------
 * SCRUM-226 — Refresco automático cada X segundos, pausado si la pestaña
 * está en segundo plano.
 *
 * Antes cada pantalla que necesitaba polling (mapa del supervisor, alertas)
 * armaba su propio setInterval a mano y lo dejaba corriendo aunque el
 * usuario cambiara de pestaña: eso seguía golpeando al backend con
 * peticiones que nadie iba a ver, gastando batería en móvil de paso.
 *
 * Este hook centraliza esa lógica con la Page Visibility API
 * (document.hidden / evento "visibilitychange"):
 *   - Con la pestaña VISIBLE, `callback` se ejecuta cada `intervalMs`.
 *   - Al pasar a SEGUNDO PLANO, el intervalo se detiene por completo (no
 *     sigue contando en silencio para "recuperar" al volver).
 *   - Al volver a primer plano, se dispara un refresco inmediato (los datos
 *     pudieron quedar viejos mientras la pestaña estuvo oculta) y el
 *     intervalo arranca de nuevo desde cero.
 *
 * No reemplaza la carga inicial de cada pantalla: este hook solo gobierna
 * las repeticiones. La primera llamada a los servicios sigue siendo el
 * useEffect de montaje que ya tenía cada página, para no alterar cómo se ve
 * el estado de loading/error la primera vez.
 *
 * Uso:
 *   useRefrescoAutomatico(fetchTareas, 30000)
 *   useRefrescoAutomatico(fetchUbicaciones, 15000, { activo: esHoy })
 *
 * @param {Function} callback   - función (puede ser async) a repetir.
 * @param {number}   intervalMs - milisegundos entre cada ejecución.
 * @param {Object}   [opciones]
 * @param {boolean}  [opciones.activo=true] - apaga el refresco por completo
 *   (ni siquiera en primer plano) cuando la pantalla no lo necesita, por
 *   ejemplo un filtro de fecha que ya no es "hoy".
 * ---------------------------------------------------------------------------
 */
import { useEffect, useRef } from 'react'

export function useRefrescoAutomatico(callback, intervalMs, { activo = true } = {}) {
  // Ref en vez de dependencia directa: así un `callback` recreado en cada
  // render (la forma normal de un useCallback con estado) no reinicia el
  // intervalo ni pierde el conteo de segundos ya transcurridos.
  const callbackRef = useRef(callback)
  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  useEffect(() => {
    if (!activo || !intervalMs) return

    let intervalId = null

    const ejecutar = () => {
      callbackRef.current()
    }

    const iniciar = () => {
      if (intervalId != null) return
      intervalId = setInterval(ejecutar, intervalMs)
    }

    const detener = () => {
      if (intervalId != null) {
        clearInterval(intervalId)
        intervalId = null
      }
    }

    const alCambiarVisibilidad = () => {
      if (document.hidden) {
        detener()
      } else {
        // La pestaña vuelve a primer plano: los datos pudieron quedar
        // viejos mientras estuvo oculta, así que se refresca ya mismo en
        // vez de esperar hasta el próximo tick del intervalo.
        ejecutar()
        iniciar()
      }
    }

    if (!document.hidden) iniciar()

    document.addEventListener('visibilitychange', alCambiarVisibilidad)
    return () => {
      detener()
      document.removeEventListener('visibilitychange', alCambiarVisibilidad)
    }
  }, [intervalMs, activo])
}