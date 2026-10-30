/**
 * tests/animacionEntrada.test.jsx
 * ---------------------------------------------------------------------------
 * Las pantallas de entrada (login y el panel de cada rol) no aparecen de
 * golpe: sus piezas entran escalonadas. El movimiento lo lleva Motion desde
 * `src/anim/`, y de él se puede comprobar aquí lo que no se ve mirando la
 * pantalla, que es justo donde se esconden los fallos:
 *
 *  1. Cada pieza arranca invisible. Si un recorrido mueve algo y no lo
 *     devuelve a su sitio en el punto de llegada, la pieza se queda torcida o
 *     a medio camino para siempre, y nadie se entera hasta que alguien abre
 *     esa pantalla.
 *
 *  2. Quien pidió menos movimiento en su sistema tiene que ver la pantalla
 *     puesta. Como la pieza arranca invisible, no basta con "no animar":
 *     aparecer es obligatorio, o el contenido no llega nunca.
 *
 *  3. El retraso tiene tope. Sin él, la parada 30 de una ruta esperaría más de
 *     dos segundos a entrar.
 *
 *  4. En el login las piezas entran cuando el splash se va, no al montarse.
 *     El splash tapa la pantalla casi dos segundos: animar antes significa
 *     animar detrás de él, y el formulario aparece ya puesto.
 *
 *  5. Una cifra que cuenta tiene que terminar en su valor exacto. Los
 *     fotogramas pintan valores intermedios redondeados; dejar "51" donde el
 *     dato dice 52 sería un defecto, no un detalle.
 * ---------------------------------------------------------------------------
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { act } from 'react'
import { PASO, RECORRIDOS, TOPE, retraso, variantes } from '../anim/movimiento'
import { NumeroAnimado } from '../anim/Entra'

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams()],
}))

const auth = vi.hoisted(() => ({ loginUser: vi.fn() }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => auth,
  AuthProvider: ({ children }) => children,
}))

/** Valor en reposo de cada propiedad que un recorrido puede mover. */
const REPOSO = {
  x: 0,
  y: 0,
  rotate: 0,
  rotateX: 0,
  rotateY: 0,
  scale: 1,
}

describe('recorridos: toda pieza que se mueve vuelve a su sitio', () => {
  it.each(Object.keys(RECORRIDOS))('%s deja la pieza en su posicion final', (desde) => {
    const { oculto, visible } = variantes(desde)
    const llegada = visible(0)

    expect(oculto.opacity).toBe(0)
    expect(llegada.opacity).toBe(1)

    for (const propiedad of Object.keys(oculto)) {
      if (propiedad === 'opacity') continue

      // La perspectiva no es un desplazamiento: se conserva tal cual, porque
      // llevarla a cero durante el giro deforma la pieza a mitad de camino.
      if (propiedad === 'transformPerspective') {
        expect(llegada.transformPerspective).toBe(oculto.transformPerspective)
        continue
      }

      expect(
        REPOSO,
        `el recorrido "${desde}" mueve ${propiedad} y esta prueba no sabe cual es su reposo`,
      ).toHaveProperty(propiedad)
      expect(
        llegada[propiedad],
        `el recorrido "${desde}" mueve ${propiedad} y no lo devuelve a su sitio`,
      ).toBe(REPOSO[propiedad])
    }
  })
})

describe('menos movimiento', () => {
  it.each(Object.keys(RECORRIDOS))('%s se queda sin recorrido pero igual aparece', (desde) => {
    const { oculto, visible } = variantes(desde, true)

    // Aparecer no es opcional: la pieza arranca invisible.
    expect(oculto).toEqual({ opacity: 0 })
    expect(visible(0).opacity).toBe(1)

    // Y nada de lo que mueve el recorrido normal sobrevive.
    for (const propiedad of Object.keys(REPOSO)) {
      expect(oculto[propiedad]).toBeUndefined()
      expect(visible(0)[propiedad]).toBeUndefined()
    }
    expect(visible(0).transformPerspective).toBeUndefined()
  })
})

describe('turnos', () => {
  it('reparte el retraso pieza por pieza', () => {
    expect(retraso(0)).toBe(0)
    expect(retraso(1)).toBeCloseTo(PASO)
    expect(retraso(3)).toBeCloseTo(3 * PASO)
  })

  it('congela el retraso en el tope, asi una lista larga no se hace eterna', () => {
    expect(retraso(TOPE)).toBeCloseTo(TOPE * PASO)
    expect(retraso(TOPE + 1)).toBe(retraso(TOPE))
    expect(retraso(30)).toBe(retraso(TOPE))
    // Media ruta esperando: lo que el tope existe para evitar.
    expect(retraso(30)).toBeLessThan(1)
  })

  it('una pieza sin turno, o mal marcada, entra enseguida', () => {
    expect(retraso(undefined)).toBe(0)
    expect(retraso(-5)).toBe(0)
    expect(retraso(Number.NaN)).toBe(0)
  })
})

describe('cifras que cuentan', () => {
  it('termina en el valor exacto, no en el del ultimo fotograma', async () => {
    render(<NumeroAnimado valor={52} />)
    await waitFor(() => expect(screen.getByText('52')).toBeInTheDocument())
  })

  it('conserva los decimales del dato', async () => {
    render(<NumeroAnimado valor={3.4} />)
    await waitFor(() => expect(screen.getByText('3.4')).toBeInTheDocument())
  })

  it('cuenta con el formato del indicador, no con un numero pelado', async () => {
    render(<NumeroAnimado valor={85} formato={(n) => `${Math.round(n)} %`} />)
    await waitFor(() => expect(screen.getByText('85 %')).toBeInTheDocument())
  })

  it('lo que no es un numero se pinta tal cual', async () => {
    render(<NumeroAnimado valor="—" />)
    await waitFor(() => expect(screen.getByText('—')).toBeInTheDocument())
  })
})

/**
 * Estas tres van con el reloj de verdad, no con relojes falsos: Motion lleva
 * su propio tiempo con `performance.now()` y avanzar los temporizadores de
 * Vitest no lo mueve, así que con relojes falsos las piezas se quedan
 * eternamente en su estado de partida y la prueba mediría eso y no el splash.
 * El coste es la espera real del splash, segundo y medio, una sola vez.
 */
describe('login: cuando entran las piezas', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  /**
   * Las piezas de la pantalla, que Motion marca con su estilo inline.
   *
   * `visible` cuenta las que ya están puestas. Hay que dejar correr el reloj
   * antes de leerlas: Motion arranca en el fotograma siguiente al render, así
   * que recién montada toda pieza está todavía en su estado de partida.
   */
  const piezas = (container) => [...container.querySelectorAll('[style*="opacity"]')]
  const ocultas = (container) => piezas(container).filter((el) => el.style.opacity === '0')
  const visibles = (container) => piezas(container).filter((el) => el.style.opacity === '1')

  const esperar = (ms) => act(async () => {
    await new Promise((seguir) => { setTimeout(seguir, ms) })
  })

  it('las deja ocultas mientras el splash tapa la pantalla', async () => {
    const { default: LoginPage } = await import('../pages/LoginPage')
    const { container } = render(<LoginPage />)

    // Un cuarto de segundo: de sobra para que entraran si nadie las estuviera
    // frenando, y el splash dura 1,6 s.
    await esperar(250)

    expect(ocultas(container).length).toBeGreaterThan(5)
    expect(visibles(container)).toHaveLength(0)
  })

  it('las hace entrar cuando el splash termina', async () => {
    const { default: LoginPage } = await import('../pages/LoginPage')
    const { container } = render(<LoginPage />)

    await waitFor(
      () => expect(visibles(container).length).toBeGreaterThan(5),
      { timeout: 4000 },
    )
    expect(ocultas(container)).toHaveLength(0)
  })

  it('se salta el splash, y su espera, si ya se vio en esta sesion', async () => {
    sessionStorage.setItem('splash_seen', '1')
    const { default: LoginPage } = await import('../pages/LoginPage')
    const { container } = render(<LoginPage />)

    // Sin espera de splash: entran en el fotograma siguiente al render. Si
    // alguien rompiera el atajo, aquí se notaría como un tiempo agotado.
    await waitFor(
      () => expect(visibles(container).length).toBeGreaterThan(5),
      { timeout: 500 },
    )
    expect(ocultas(container)).toHaveLength(0)
  })
})
