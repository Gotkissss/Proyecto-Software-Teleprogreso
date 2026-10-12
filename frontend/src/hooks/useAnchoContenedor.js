/**
 * hooks/useAnchoContenedor.js
 * ---------------------------------------------------------------------------
 * Ancho en píxeles de un elemento, actualizado cuando cambia de tamaño.
 *
 * Los gráficos SVG de reportes se dibujan al ancho real del contenedor en vez
 * de estirarse con viewBox: estirado, el texto de los ejes se deforma.
 * Sin ResizeObserver (jsdom en las pruebas) se queda con el ancho inicial.
 * ---------------------------------------------------------------------------
 */
import { useEffect, useState } from 'react'

/**
 * @returns {[Function, number]} ref de callback para el elemento y su ancho.
 *   Es de callback (no useRef) porque el elemento puede montarse después
 *   del primer render: un gráfico que aparece al llegar los datos, o al
 *   volver de "Ver tabla".
 */
export function useAnchoContenedor(anchoInicial = 640) {
  const [elemento, setElemento] = useState(null)
  const [ancho, setAncho] = useState(anchoInicial)

  useEffect(() => {
    if (!elemento || typeof ResizeObserver === 'undefined') return undefined
    const observador = new ResizeObserver(([entrada]) => {
      const medido = Math.floor(entrada.contentRect.width)
      if (medido > 0) setAncho(medido)
    })
    observador.observe(elemento)
    return () => observador.disconnect()
  }, [elemento])

  return [setElemento, ancho]
}
