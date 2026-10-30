/**
 * anim/movimiento.js
 * ---------------------------------------------------------------------------
 * Los tiempos y los recorridos de la entrada de pantalla, sin React en medio.
 *
 * Las pantallas que se abren al entrar (login y el panel de cada rol) no
 * aparecen de golpe: sus piezas entran escalonadas. Cada pieza solo dice en
 * qué turno va; de aquí sale su retraso y el recorrido que hace.
 *
 * Está aparte de los componentes a propósito: así el ritmo, el tope de la
 * cascada y la variante de accesibilidad se pueden comprobar con aritmética
 * en vez de mirando la pantalla, que es justo lo que no se puede automatizar.
 *
 * Solo se animan `opacity` y `transform` (incluido el giro en 3D, que también
 * es transform): el navegador los resuelve en la GPU sin rehacer el layout,
 * así la lista de tareas de un técnico con un teléfono modesto no se
 * entrecorta. Nada de `filter: blur()`, que es lo que se atraganta ahí.
 * ---------------------------------------------------------------------------
 */

/** Segundos entre una pieza y la siguiente. */
export const PASO = 0.075

/**
 * Turno a partir del cual el retraso deja de crecer.
 *
 * Sin tope, la parada 30 de una ruta esperaría más de dos segundos a entrar y
 * el técnico vería la pantalla llenarse a cuentagotas. Con el tope, una ruta
 * de treinta paradas termina de entrar igual de rápido que una de nueve.
 */
export const TOPE = 8

/** Cuánto dura el conteo de una cifra, en segundos. */
export const DURACION_CONTEO = 1.0

/**
 * El muelle que mueve cada pieza.
 *
 * Es un muelle y no una curva de duración fija porque la entrada se pidió
 * "notoria, pero que no se haga larga": el muelle llega rápido a destino y se
 * asienta con un rebote corto, que es lo que hace que el movimiento se note
 * sin alargar la espera. Se asienta en unos 0,75 s.
 */
export const MUELLE = {
  type: 'spring',
  stiffness: 230,
  damping: 21,
  mass: 0.95,
}

/**
 * De dónde viene cada pieza. El nombre lo elige la pantalla, no el componente.
 *
 *  - `abajo`      sube y crece un poco. El caso corriente.
 *  - `izquierda`  entra desde su borde. La marca del login vive a la izquierda.
 *  - `derecha`    entra girando sobre su eje vertical: la tarjeta del login se
 *                 endereza como una puerta al cerrarse.
 *  - `cae`        cae de plano y se endereza. Las tarjetas de cifras del panel.
 *  - `sello`      aparece pequeña y torcida y se planta. Solo el logo.
 *
 * `transformPerspective` va en la propia pieza, no en el contenedor: sin él
 * los giros se ven planos, y puesto en el padre afectaría a todo lo de dentro.
 */
export const RECORRIDOS = {
  abajo:     { y: 46, scale: 0.94 },
  izquierda: { x: -62 },
  derecha:   { x: 70, rotateY: 24, scale: 0.92, transformPerspective: 1300 },
  cae:       { y: 52, rotateX: -46, scale: 0.86, transformPerspective: 900 },
  sello:     { scale: 0.34, rotate: -14 },
}

/** Punto de llegada: todo quieto y a la vista. Es común a los cinco recorridos. */
const REPOSO = {
  opacity: 1,
  x: 0,
  y: 0,
  rotate: 0,
  rotateX: 0,
  rotateY: 0,
  scale: 1,
}

/**
 * Retraso, en segundos, de la pieza que va en el turno `turno`.
 *
 * Un turno negativo o ausente cuenta como el primero: una pieza mal marcada
 * entra enseguida, que es el fallo menos visible de los dos.
 */
export function retraso(turno) {
  const n = Number.isFinite(turno) ? turno : 0
  return Math.min(Math.max(n, 0), TOPE) * PASO
}

/**
 * Las dos variantes de una pieza: `oculto` (antes de su turno) y `visible`.
 *
 * `visible` es una función porque recibe el turno desde `custom`, y así el
 * retraso se calcula por pieza sin que cada pantalla repita la aritmética.
 *
 * Con `reducido` (quien pidió menos movimiento en su sistema) no se devuelve
 * ningún recorrido: la pieza solo aparece, y lo hace rápido. No se devuelve
 * `null` ni se omite la animación, porque entonces `oculto` dejaría la pieza
 * invisible para siempre; aparecer es parte del contrato.
 */
export function variantes(desde, reducido = false) {
  const recorrido = RECORRIDOS[desde] ?? RECORRIDOS.abajo

  if (reducido) {
    return {
      oculto: { opacity: 0 },
      visible: (turno) => ({
        opacity: 1,
        transition: { duration: 0.2, delay: retraso(turno) / 3 },
      }),
    }
  }

  // La perspectiva se mantiene en el punto de llegada. Si solo estuviera en
  // el de partida, el navegador la llevaria a cero durante el giro y la pieza
  // se deformaria a mitad de camino en vez de girar limpia.
  const llegada = { ...REPOSO }
  if (recorrido.transformPerspective) {
    llegada.transformPerspective = recorrido.transformPerspective
  }

  return {
    oculto: { opacity: 0, ...recorrido },
    visible: (turno) => ({
      ...llegada,
      transition: { ...MUELLE, delay: retraso(turno) },
    }),
  }
}
