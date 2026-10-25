/**
 * tests/ErrorBoundary.test.jsx
 * ---------------------------------------------------------------------------
 * HU-S10-04 (tarea 6): un error de render en una pantalla no deja la
 * aplicación en blanco.
 * ---------------------------------------------------------------------------
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Outlet, Route, Routes, Link, useLocation } from 'react-router-dom'
import ErrorBoundary from '../components/ui/ErrorBoundary'
import {
  obtenerUltimoRequestId,
  olvidarUltimoRequestId,
  registrarErrorServidor,
} from '../utils/ultimoErrorServidor'

function PantallaRota() {
  throw new Error('detalle-interno-que-no-debe-verse')
}

// jsdom reporta como "Uncaught" el error que lanza el render aunque el límite lo
// atrape; se marca como manejado para no llenar la salida de las pruebas.
const silenciarErrorDeJsdom = (evento) => evento.preventDefault()

beforeEach(() => {
  window.addEventListener('error', silenciarErrorDeJsdom)
  olvidarUltimoRequestId()
  // React escribe el error en consola aunque haya un límite que lo atrape.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  window.removeEventListener('error', silenciarErrorDeJsdom)
  vi.restoreAllMocks()
})

describe('ErrorBoundary', () => {
  it('muestra a sus hijos cuando no hay error', () => {
    render(
      <ErrorBoundary>
        <p>Contenido normal</p>
      </ErrorBoundary>
    )
    expect(screen.getByText('Contenido normal')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('en lugar de pantalla en blanco muestra "Algo salió mal" y un botón de recarga', () => {
    render(
      <ErrorBoundary>
        <PantallaRota />
      </ErrorBoundary>
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('Algo salió mal')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Recargar' })).toBeInTheDocument()
  })

  it('no enseña el mensaje del error al usuario', () => {
    render(
      <ErrorBoundary>
        <PantallaRota />
      </ErrorBoundary>
    )
    expect(screen.queryByText(/detalle-interno/)).not.toBeInTheDocument()
  })

  it('el botón Recargar llama a la recarga', async () => {
    const onRecargar = vi.fn()
    render(
      <ErrorBoundary onRecargar={onRecargar}>
        <PantallaRota />
      </ErrorBoundary>
    )
    await userEvent.click(screen.getByRole('button', { name: 'Recargar' }))
    expect(onRecargar).toHaveBeenCalledTimes(1)
  })

  it('muestra el request_id del último error del servidor para poder reportarlo', () => {
    registrarErrorServidor({ response: { status: 500, data: { request_id: 'abc123def456' } } })
    render(
      <ErrorBoundary>
        <PantallaRota />
      </ErrorBoundary>
    )
    expect(screen.getByText('abc123def456')).toBeInTheDocument()
  })

  it('sin request_id guardado no muestra la línea del código', () => {
    render(
      <ErrorBoundary>
        <PantallaRota />
      </ErrorBoundary>
    )
    expect(screen.queryByText(/con este código/)).not.toBeInTheDocument()
  })

  it('al cambiar de ruta se reinicia y la pantalla siguiente se ve', async () => {
    function Layout() {
      const { pathname } = useLocation()
      return (
        <div>
          <nav>
            <Link to="/rota">ir a rota</Link>
            <Link to="/sana">ir a sana</Link>
          </nav>
          <ErrorBoundary claveReinicio={pathname}>
            <Outlet />
          </ErrorBoundary>
        </div>
      )
    }

    render(
      <MemoryRouter initialEntries={['/rota']}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/rota" element={<PantallaRota />} />
            <Route path="/sana" element={<p>Pantalla sana</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    )

    // El menú sigue ahí aunque la pantalla falló.
    expect(screen.getByText('Algo salió mal')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'ir a sana' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('link', { name: 'ir a sana' }))
    expect(screen.getByText('Pantalla sana')).toBeInTheDocument()
    expect(screen.queryByText('Algo salió mal')).not.toBeInTheDocument()
  })
})

describe('registrarErrorServidor', () => {
  it('guarda el request_id del cuerpo de un 500', () => {
    expect(registrarErrorServidor({ response: { status: 500, data: { request_id: 'r1' } } })).toBe('r1')
    expect(obtenerUltimoRequestId()).toBe('r1')
  })

  it('usa la cabecera X-Request-ID si el cuerpo no lo trae', () => {
    registrarErrorServidor({ response: { status: 503, data: {}, headers: { 'x-request-id': 'r2' } } })
    expect(obtenerUltimoRequestId()).toBe('r2')
  })

  it('ignora errores que no son 5xx', () => {
    registrarErrorServidor({ response: { status: 422, data: { request_id: 'r3' } } })
    expect(obtenerUltimoRequestId()).toBeNull()
  })

  it('ignora errores sin respuesta (red caída)', () => {
    expect(registrarErrorServidor({ message: 'Network Error' })).toBeNull()
    expect(obtenerUltimoRequestId()).toBeNull()
  })
})
