/**
 * anim/Entra.jsx
 * ---------------------------------------------------------------------------
 * Las dos piezas con las que una pantalla se presenta:
 *
 *   <Entra>          envuelve un trozo de pantalla y lo hace entrar en su turno.
 *   <NumeroAnimado>  una cifra que sube desde cero hasta su valor.
 *
 * `<Entra>` no mete ningún elemento nuevo en el árbol: sustituye al que ya
 * estaba (`as="section"`, `as="article"`...) y le pasa todas sus props. Eso
 * importa porque varias de estas piezas son celdas de una rejilla o hijos de
 * un flex, y un div de más entre el contenedor y la celda rompe el diseño.
 *
 * Se usa `m` y no `motion`: `motion.div` arrastra en el bundle todo lo que
 * Motion sabe hacer (arrastrar piezas, animar cambios de layout) aunque aquí
 * no se use nada de eso. `m` trae solo el componente y las capacidades las
 * aporta un `<LazyMotion>`. Son unas decenas de kB de diferencia en una app
 * que se abre con datos móviles.
 *
 * Ese proveedor va aquí dentro, en cada pieza, y no una sola vez en lo alto
 * de la app a propósito: sin él `m` no anima y la pieza se queda invisible
 * para siempre, porque arranca invisible. Teniéndolo que recordar, basta con
 * montar un `<Entra>` en un sitio nuevo —un modal, un portal, una prueba que
 * renderiza una pantalla suelta— para dejar un hueco en blanco que nadie
 * relaciona con esto. Cuesta un contexto de React por pieza, que es nada.
 *
 * Quien pidió menos movimiento en su sistema ve las piezas aparecer sin
 * recorrido y las cifras ya puestas. No se "apaga" la animación sin más: la
 * pieza arranca invisible, así que aparecer es obligatorio (ver `variantes`).
 * ---------------------------------------------------------------------------
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { LazyMotion, animate, domAnimation, m, useReducedMotion } from 'motion/react'
import { DURACION_CONTEO, retraso, variantes } from './movimiento'

/**
 * Una pieza que entra.
 *
 * @param {object}  props
 * @param {string}  props.as     Etiqueta a renderizar ('div' por defecto).
 * @param {string}  props.desde  Recorrido: abajo | izquierda | derecha | cae | sello.
 * @param {number}  props.turno  0 es la primera; el retraso sale de aquí.
 * @param {boolean} props.activo En false la pieza espera oculta. Lo usa el
 *   login, donde la entrada no empieza al montarse sino cuando el splash se
 *   va: el splash tapa la pantalla casi dos segundos, así que animar antes
 *   significa animar detrás de él y que el formulario aparezca ya puesto.
 */
export function Entra({
  as = 'div',
  desde = 'abajo',
  turno = 0,
  activo = true,
  children,
  ...resto
}) {
  const reducido = useReducedMotion()
  const Pieza = m[as] ?? m.div
  const pasos = useMemo(() => variantes(desde, Boolean(reducido)), [desde, reducido])

  return (
    <LazyMotion features={domAnimation}>
      <Pieza
        variants={pasos}
        custom={turno}
        initial="oculto"
        animate={activo ? 'visible' : 'oculto'}
        {...resto}
      >
        {children}
      </Pieza>
    </LazyMotion>
  )
}

/**
 * Una cifra que cuenta desde cero hasta su valor, en el turno que le toque.
 *
 * Es lo que hace que un panel de cifras se lea como algo vivo y no como una
 * captura. Dos cuidados, porque aquí un adorno mal hecho miente:
 *
 *  - El texto se escribe en el nodo directamente, sin pasar por el estado de
 *    React: contar es un cambio por fotograma y con `useState` serían sesenta
 *    renders por segundo y por cifra.
 *  - Al terminar se vuelve a escribir el valor exacto. Los fotogramas pintan
 *    valores intermedios redondeados y el último puede no caer justo en el
 *    final; dejar "51" donde el dato dice 52 sería un defecto, no un detalle.
 *
 * @param {object}   props
 * @param {number}   props.valor    La cifra. Lo que no sea número se pinta tal cual.
 * @param {number}   props.turno    Mismo turno que la pieza que la contiene.
 * @param {function} props.formato  Cómo se escribe cada paso ("85 %", "3,4 h").
 *   Tiene que ser estable entre renders: si cambia, el conteo vuelve a empezar.
 */
export function NumeroAnimado({ valor, turno = 0, formato = null }) {
  const reducido = useReducedMotion()
  const ref = useRef(null)
  const esNumero = typeof valor === 'number' && Number.isFinite(valor)
  // Sin `formato` propio, la cifra conserva los decimales que trae el dato:
  // un 3,4 que cuenta en enteros se queda en 3 y deja de cuadrar con el resto.
  const decimales = esNumero ? (String(valor).split('.')[1] ?? '').length : 0

  const pintar = useCallback(
    (n) => (formato ? formato(n) : n.toFixed(decimales)),
    [formato, decimales],
  )

  useEffect(() => {
    const nodo = ref.current
    if (!nodo) return undefined

    if (!esNumero) {
      nodo.textContent = String(valor ?? '')
      return undefined
    }
    if (reducido) {
      nodo.textContent = pintar(valor)
      return undefined
    }

    const conteo = animate(0, valor, {
      duration: DURACION_CONTEO,
      delay: retraso(turno),
      ease: 'easeOut',
      onUpdate: (n) => { nodo.textContent = pintar(n) },
      onComplete: () => { nodo.textContent = pintar(valor) },
    })
    return () => conteo.stop()
  }, [valor, esNumero, reducido, turno, pintar])

  // Lo que se pinta en el primer render es el principio del conteo, no el
  // final: con el final puesto se veria la cifra correcta y acto seguido
  // caer a cero de un salto.
  const inicial = !esNumero ? String(valor ?? '') : pintar(reducido ? valor : 0)

  return <span ref={ref}>{inicial}</span>
}
