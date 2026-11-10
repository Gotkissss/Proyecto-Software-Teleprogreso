/**
 * components/ui/Skeleton.jsx
 * ---------------------------------------------------------------------------
 * El dibujo gris de una pantalla mientras llegan sus datos.
 *
 * Antes toda pantalla que cargaba mostraba un spinner centrado en una página
 * en blanco: el contenido aparecía de golpe y la pantalla "saltaba" de un
 * estado al otro. Con el esqueleto, el espacio que va a ocupar cada pieza ya
 * está dibujado antes de que lleguen los datos, así que lo único que cambia
 * al terminar la carga es el contenido, no la forma de la página.
 *
 * No reemplaza a las animaciones de entrada (`src/anim/Entra`): el esqueleto
 * se ve mientras no hay datos, y cuando llegan, el contenido real entra con su
 * animación de siempre. Son dos momentos distintos y no compiten.
 *
 * Uso:  <PageState loading={loading} skeleton="table" loadingLabel="..." />
 *
 * Las variantes no copian la pantalla pieza por pieza a propósito: imitan su
 * reparto (cuántos bloques, de qué tamaño y en qué columnas). Un esqueleto que
 * persigue cada detalle se desactualiza con el primer cambio de diseño y
 * termina mintiendo más que ayudando.
 * ---------------------------------------------------------------------------
 */

import styles from './Skeleton.module.css'

/** Un bloque gris. `w` y `h` aceptan cualquier medida CSS. */
function Bloque({ w = '100%', h = 16, radio }) {
  return (
    <span
      className={styles.bloque}
      style={{ width: w, height: h, borderRadius: radio }}
    />
  )
}

const repetir = (n, fn) => Array.from({ length: n }, (_, i) => fn(i))

function Cabecera() {
  return (
    <div className={styles.cabecera}>
      <Bloque w="38%" h={26} />
      <Bloque w="22%" h={14} />
    </div>
  )
}

function Tarjeta({ alto = 104 }) {
  return (
    <div className={styles.tarjeta}>
      <Bloque w="52%" h={12} />
      <Bloque w="38%" h={28} />
      <Bloque w="100%" h={6} radio="999px" />
      <span className={styles.relleno} style={{ minHeight: alto - 86 }} />
    </div>
  )
}

function FilaLista() {
  return (
    <div className={styles.filaLista}>
      <Bloque w={42} h={42} radio="50%" />
      <div className={styles.filaTexto}>
        <Bloque w="46%" h={14} />
        <Bloque w="72%" h={11} />
      </div>
      <Bloque w={78} h={24} radio="999px" />
    </div>
  )
}

function Tabla({ filas = 8, columnas = 5 }) {
  return (
    <div className={styles.tabla}>
      <div className={styles.filaTabla}>
        {repetir(columnas, (c) => (
          <Bloque key={c} w={c === 0 ? '26%' : '14%'} h={11} />
        ))}
      </div>
      {repetir(filas, (f) => (
        <div className={styles.filaTabla} key={f}>
          {repetir(columnas, (c) => (
            <Bloque key={c} w={c === 0 ? '26%' : '14%'} h={14} />
          ))}
        </div>
      ))}
    </div>
  )
}

const VARIANTES = {
  /** Panel del supervisor: tarjetas de métricas, mapa y lista al lado. */
  dashboard: () => (
    <>
      <Cabecera />
      <div className={styles.metricas}>
        {repetir(5, (i) => (
          <Tarjeta key={i} />
        ))}
      </div>
      <div className={styles.dosColumnas}>
        <div className={styles.panelGrande}>
          <Bloque w="34%" h={18} />
          <Bloque w="100%" h={300} radio="var(--radius-lg)" />
        </div>
        <div className={styles.panelGrande}>
          <Bloque w="44%" h={18} />
          {repetir(4, (i) => (
            <FilaLista key={i} />
          ))}
        </div>
      </div>
    </>
  ),

  /** Pantallas con filtros y una tabla larga: historial, inventario, bitácora. */
  table: () => (
    <>
      <Cabecera />
      <div className={styles.filtros}>
        {repetir(4, (i) => (
          <Bloque key={i} w={i === 0 ? '34%' : '16%'} h={38} radio="var(--radius-md)" />
        ))}
      </div>
      <div className={styles.panelGrande}>
        <Tabla />
      </div>
    </>
  ),

  /** Listas de tarjetas: ruta del técnico, alertas, equipo, reasignación. */
  list: () => (
    <>
      <Cabecera />
      <div className={styles.panelGrande}>
        {repetir(6, (i) => (
          <FilaLista key={i} />
        ))}
      </div>
    </>
  ),

  /** Pantallas de mapa: el mapa manda y la lista lo acompaña. */
  map: () => (
    <>
      <Cabecera />
      <div className={styles.mapa}>
        <Bloque w="100%" h="100%" radio="var(--radius-lg)" />
        <div className={styles.panelGrande}>
          {repetir(5, (i) => (
            <FilaLista key={i} />
          ))}
        </div>
      </div>
    </>
  ),

  /** Reportes: cifras arriba y una gráfica ancha abajo. */
  cards: () => (
    <>
      <Cabecera />
      <div className={styles.metricas}>
        {repetir(4, (i) => (
          <Tarjeta key={i} />
        ))}
      </div>
      <div className={styles.panelGrande}>
        <Bloque w="30%" h={18} />
        <Bloque w="100%" h={240} radio="var(--radius-lg)" />
      </div>
    </>
  ),

  /** Ficha de una sola cosa: perfil, detalle de vehículo. */
  detail: () => (
    <>
      <Cabecera />
      <div className={styles.dosColumnas}>
        <div className={styles.panelGrande}>
          <Bloque w={84} h={84} radio="50%" />
          {repetir(4, (i) => (
            <Bloque key={i} w={`${72 - i * 8}%`} h={14} />
          ))}
        </div>
        <div className={styles.panelGrande}>
          {repetir(6, (i) => (
            <div className={styles.filaDato} key={i}>
              <Bloque w="30%" h={12} />
              <Bloque w="52%" h={14} />
            </div>
          ))}
        </div>
      </div>
    </>
  ),
}

export const VARIANTES_SKELETON = Object.keys(VARIANTES)

export default function Skeleton({ variant = 'list', label = 'Cargando...' }) {
  // Una variante escrita mal no debe dejar la pantalla en blanco: cae en la
  // lista, que es la forma que sirve para casi cualquier pantalla.
  const conocida = Object.hasOwn(VARIANTES, variant)
  const Dibujo = conocida ? VARIANTES[variant] : VARIANTES.list

  return (
    // `aria-busy` es lo que hace que un lector de pantalla diga "cargando" en
    // vez de leer en voz alta una pila de cajas vacías.
    <div
      className={styles.wrap}
      role="status"
      aria-busy="true"
      data-skeleton={conocida ? variant : 'list'}
    >
      <span className="sr-only">{label}</span>
      <div className={styles.dibujo} aria-hidden="true">
        <Dibujo />
      </div>
    </div>
  )
}
