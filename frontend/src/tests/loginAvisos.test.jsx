/**
 * tests/loginAvisos.test.jsx
 * ---------------------------------------------------------------------------
 * El hueco que se veía en todas las visitas.
 *
 * Los dos mensajes del login —«tu sesión se cerró» y el error de credenciales—
 * vivían dentro de un contenedor con `min-height: 48px` reservado siempre, para
 * que el formulario no se moviera al aparecer uno (RTF-01 / R1-10). El efecto
 * de verdad era el contrario del buscado: el contenedor se pinta en cada
 * entrada y el mensaje casi nunca, así que lo que la gente veía siempre era un
 * vacío entre «Ingresa tus credenciales para continuar» y «Correo
 * electrónico», y el salto que se quería evitar ocurre de uvas a peras.
 *
 * Aquí se fija que el hueco solo existe cuando hay algo dentro. La primera
 * prueba mira la posición: sin aviso, el primer hijo del formulario tiene que
 * ser ya el campo de correo, sin nada delante. Comprobar «no hay un div vacío»
 * sería más frágil —cualquier envoltorio nuevo lo rompería—; esto comprueba lo
 * que de verdad importaba, que es que no sobre espacio antes del primer campo.
 * ---------------------------------------------------------------------------
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// Los parámetros de la URL los decide cada prueba: `?expirado=1` es lo que
// enciende el aviso de sesión vencida.
const ruta = vi.hoisted(() => ({ parametros: new URLSearchParams() }))
vi.mock('react-router-dom', () => ({
  useSearchParams: () => [ruta.parametros],
}))

const auth = vi.hoisted(() => ({ loginUser: vi.fn() }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => auth,
  AuthProvider: ({ children }) => children,
}))

async function montarLogin() {
  // Sin esto el splash tapa la pantalla casi dos segundos. El formulario está
  // en el DOM igual, pero saltárselo deja la prueba rápida y sin relojes.
  sessionStorage.setItem('splash_seen', '1')
  const { default: LoginPage } = await import('../pages/LoginPage')
  return render(<LoginPage />)
}

describe('avisos del login', () => {
  beforeEach(() => {
    ruta.parametros = new URLSearchParams()
    sessionStorage.clear()
    vi.resetModules()
  })
  afterEach(() => {
    sessionStorage.clear()
  })

  it('sin aviso no deja hueco: el formulario empieza en el campo de correo', async () => {
    const { container } = await montarLogin()

    const formulario = container.querySelector('form')
    expect(formulario, 'el login tiene que pintar un formulario').not.toBeNull()

    const correo = screen.getByLabelText(/correo electrónico/i)
    expect(
      formulario.firstElementChild.contains(correo),
      'sin ningún aviso, lo primero del formulario tiene que ser el campo de ' +
        'correo: cualquier cosa delante es el hueco reservado que se quitó',
    ).toBe(true)
  })

  it('no hay ningún mensaje que anunciar cuando no pasó nada', async () => {
    await montarLogin()

    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('con ?expirado=1 sí sale el aviso, delante del campo de correo', async () => {
    ruta.parametros = new URLSearchParams('expirado=1')
    const { container } = await montarLogin()

    const aviso = screen.getByRole('status')
    expect(aviso).toHaveTextContent(/sesión se cerró por seguridad/i)

    const formulario = container.querySelector('form')
    const correo = screen.getByLabelText(/correo electrónico/i)
    expect(
      formulario.firstElementChild.contains(aviso),
      'el aviso va arriba del todo, antes del primer campo',
    ).toBe(true)
    expect(aviso.compareDocumentPosition(correo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
