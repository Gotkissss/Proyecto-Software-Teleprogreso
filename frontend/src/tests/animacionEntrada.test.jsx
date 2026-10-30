/**
 * tests/animacionEntrada.test.jsx
 * ---------------------------------------------------------------------------
 * Las pantallas de entrada (login y el panel de cada rol) no aparecen de
 * golpe: sus piezas entran escalonadas. El movimiento lo hace index.css con
 * las clases `entra`, `entraIzquierda`, `entraDerecha` y `entraHijos`.
 *
 * Aquí se fijan las dos cosas que, si se rompen, no se ven venir:
 *
 *  1. Las clases usan `animation-fill-mode: backwards`, que mantiene la pieza
 *     oculta mientras espera su turno. Si una de ellas se queda fuera del
 *     bloque de `prefers-reduced-motion`, quien pidió menos movimiento sigue
 *     viendo recorridos; y si además alguien quitara el `@keyframes`, el
 *     `backwards` dejaría contenido invisible para siempre. Por eso cada clase
 *     que use `backwards` tiene que estar también en ese bloque.
 *
 *  2. En el login las piezas no entran al montarse sino cuando el splash se
 *     va. El splash tapa la pantalla casi dos segundos: si la entrada arranca
 *     antes, ocurre detrás de él y el formulario aparece ya puesto, que es
 *     justo lo que se quería evitar.
 * ---------------------------------------------------------------------------
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { act } from 'react'
import { readFileSync } from 'node:fs'

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams()],
}))

const auth = vi.hoisted(() => ({ loginUser: vi.fn() }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => auth,
  AuthProvider: ({ children }) => children,
}))

// Ruta relativa a la raíz del frontend, que es desde donde corre vitest.
const CSS = readFileSync('src/index.css', 'utf8')
// Sin comentarios: si no, el texto que precede a una regla se cuela dentro de
// su selector y la comprobación de abajo deja pasar justo lo que vigila.
const CSS_LIMPIO = CSS.replace(/\/\*[\s\S]*?\*\//g, '')

/** El contenido del `@media (prefers-reduced-motion: reduce)` de index.css. */
function bloqueMenosMovimiento() {
  const inicio = CSS.indexOf('@media (prefers-reduced-motion: reduce)')
  expect(inicio, 'index.css debe tener un bloque de menos movimiento').toBeGreaterThan(-1)

  // Se recorta contando llaves, porque dentro hay reglas anidadas.
  let nivel = 0
  for (let i = CSS.indexOf('{', inicio); i < CSS.length; i += 1) {
    if (CSS[i] === '{') nivel += 1
    if (CSS[i] === '}') {
      nivel -= 1
      if (nivel === 0) return CSS.slice(inicio, i + 1)
    }
  }
  throw new Error('el bloque de menos movimiento no cierra')
}

describe('contrato de las clases de entrada', () => {
  it('define las piezas del sistema y sus tiempos', () => {
    for (const pieza of [
      '--entrada-dur',
      '--entrada-paso',
      '--entrada-tope',
      '@keyframes entradaSube',
      '@keyframes entradaIzquierda',
      '@keyframes entradaDerecha',
      '.entraHijos > *',
    ]) {
      expect(CSS, `index.css debe definir ${pieza}`).toContain(pieza)
    }
  })

  it('toda clase que oculta la pieza mientras espera se apaga con menos movimiento', () => {
    const menosMovimiento = bloqueMenosMovimiento()

    // Los selectores que usan `backwards`: son los que dejan la pieza oculta
    // mientras espera, y por eso todos tienen que poder apagarse.
    const conBackwards = [...CSS_LIMPIO.matchAll(/([^{}]+)\{[^{}]*backwards[^{}]*\}/g)]
      .flatMap(([, selector]) => selector.split(','))
      .map((s) => s.trim())
      .filter(Boolean)

    expect(conBackwards.length).toBeGreaterThan(0)
    for (const selector of conBackwards) {
      expect(
        menosMovimiento,
        `${selector} oculta la pieza con backwards pero no se apaga con menos movimiento`,
      ).toContain(selector)
    }
  })
})

describe('login: cuándo entran las piezas', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    sessionStorage.clear()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const piezasAnimadas = (container) =>
    container.querySelectorAll('.entra, .entraIzquierda, .entraDerecha')

  it('no anima nada mientras el splash tapa la pantalla', async () => {
    const { default: LoginPage } = await import('../pages/LoginPage')
    const { container } = render(<LoginPage />)

    expect(piezasAnimadas(container).length).toBe(0)
  })

  it('reparte los turnos cuando el splash termina', async () => {
    const { default: LoginPage } = await import('../pages/LoginPage')
    const { container } = render(<LoginPage />)

    await act(async () => {
      vi.advanceTimersByTime(3000)
    })

    const piezas = piezasAnimadas(container)
    expect(piezas.length).toBeGreaterThan(5)

    // Cada pieza lleva su turno, y no todas el mismo: en eso consiste el
    // escalonado. Sin esto, poner `--orden: 0` en todas pasaría inadvertido.
    const turnos = [...piezas].map((el) => el.style.getPropertyValue('--orden'))
    expect(turnos.every((t) => t !== '')).toBe(true)
    expect(new Set(turnos).size).toBeGreaterThan(1)
  })

  it('se salta el splash, y su espera, si ya se vio en esta sesión', async () => {
    sessionStorage.setItem('splash_seen', '1')
    const { default: LoginPage } = await import('../pages/LoginPage')
    const { container } = render(<LoginPage />)

    expect(piezasAnimadas(container).length).toBeGreaterThan(5)
  })
})
