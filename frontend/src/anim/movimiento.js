/**
 * anim/movimiento.js
 * ---------------------------------------------------------------------------
 * Los tiempos y los recorridos de la entrada de pantalla, sin React en medio.
 *
 * Las pantallas que se abren al entrar (login y el panel de cada rol) no
 * aparecen de golpe: sus piezas entran escalonadas. Cada pieza solo dice en
 * qué turno va y a qué ritmo; de aquí sale su retraso y el recorrido que hace.
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

/**
 * Turno a partir del cual el retraso deja de crecer.
 *
 * Sin tope, la fila 30 de una tabla esperaría más de dos segundos a entrar y
 * la pantalla se llenaría a cuentagotas. Con el tope, una lista de treinta
 * filas termina de entrar igual de rápido que una de nueve.
 */
export const TOPE = 8

/** Cuánto dura el conteo de una cifra, en segundos. */
export const DURACION_CONTEO = 1.0

/**
 * Los dos ritmos, que no son el mismo gesto más o menos rápido sino dos
 * situaciones distintas:
 *
 *  - `normal` es para una pantalla que se abre una vez, al entrar: el login y
 *    el panel de cada rol. Ahí la entrada se mira, así que el recorrido es
 *    largo y el muelle se asienta con un rebote corto.
 *
 *  - `rapido` es para las listas y tablas de trabajo —empleados, reasignación,
 *    inventario, alertas, bitácora, historial—, que alguien abre veinte veces
 *    al día. Ahí la misma entrada estorba: el gesto del panel, repetido, deja
 *    de ser un detalle y pasa a ser una espera. Por eso el paso es menos de la
 *    mitad, el muelle más tenso y el recorrido poco más de un tercio: se nota
 *    que la lista entra, pero no hay que esperarla. Una lista larga termina de
 *    entrar en algo más de medio segundo.
 */
export const RITMOS = {
  normal: {
    paso: 0.075,
    muelle: { type: 'spring', stiffness: 230, damping: 21, mass: 0.95 },
    recorrido: 1,
  },
  rapido: {
    paso: 0.032,
    muelle: { type: 'spring', stiffness: 420, damping: 30, mass: 0.8 },
    recorrido: 0.4,
  },
}

const ritmoDe = (ritmo) => RITMOS[ritmo] ?? RITMOS.normal

/**
 * De dónde viene cada pieza. El nombre lo elige la pantalla, no el componente.
 * Los valores son los del ritmo normal; el rápido los acorta.
 *
 *  - `abajo`      sube y crece un poco. El caso corriente.
 *  - `izquierda`  entra desde su borde. La marca del login vive a la izquierda.
 *  - `derecha`    entra girando sobre su eje vertical: la tarjeta del login se
 *                 endereza como una puerta al cerrarse.
 *  - `cae`        cae de plano y se endereza. Las tarjetas de cifras del panel.
 *  - `sello`      aparece pequeña y torcida y se planta. Solo el logo.
 *  - `barra`      se dibuja de izquierda a derecha. Para barras de progreso;
 *                 el CSS de la pieza tiene que poner `transform-origin: left`,
 *                 o se abre desde el centro hacia los dos lados.
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
  barra:     { scaleX: 0 },
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
  scaleX: 1,
}

/**
 * Acorta un recorrido sin cambiar su forma.
 *
 * Los desplazamientos y los giros se encogen por proporción directa, pero las
 * escalas no: su reposo es 1 y no 0, así que un 0,86 acortado a la mitad es
 * 0,93 y no 0,43. Confundir las dos cosas hace que la pieza salga de un punto
 * diminuto justo cuando se pedía un gesto más discreto.
 */
function acortar(recorrido, factor) {
  if (factor === 1) return recorrido

  const corto = {}
  for (const [propiedad, valor] of Object.entries(recorrido)) {
    if (propiedad === 'transformPerspective') corto[propiedad] = valor
    else if (propiedad.startsWith('scale')) corto[propiedad] = 1 - (1 - valor) * factor
    else corto[propiedad] = valor * factor
  }
  return corto
}

/**
 * Retraso, en segundos, de la pieza que va en el turno `turno`.
 *
 * Un turno negativo o ausente cuenta como el primero: una pieza mal marcada
 * entra enseguida, que es el fallo menos visible de los dos.
 */
export function retraso(turno, ritmo = 'normal') {
  const n = Number.isFinite(turno) ? turno : 0
  return Math.min(Math.max(n, 0), TOPE) * ritmoDe(ritmo).paso
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
export function variantes(desde, reducido = false, ritmo = 'normal') {
  const { muelle, recorrido: factor } = ritmoDe(ritmo)
  const recorrido = acortar(RECORRIDOS[desde] ?? RECORRIDOS.abajo, factor)

  if (reducido) {
    return {
      oculto: { opacity: 0 },
      visible: (turno) => ({
        opacity: 1,
        transition: { duration: 0.2, delay: retraso(turno, ritmo) / 3 },
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
      transition: { ...muelle, delay: retraso(turno, ritmo) },
    }),
  }
}
