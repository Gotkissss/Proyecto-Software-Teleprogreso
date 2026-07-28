/**
 * tests/PageState.test.jsx
 * ---------------------------------------------------------------------------
 * Pruebas del componente de estados de página (cargando / error / vacío).
 *
 * El último bloque ("uso correcto en una página") existe por un bug real: se
 * escribió `const estado = <PageState .../>; if (estado) return estado`, y como
 * un elemento JSX siempre es truthy, TODAS las páginas devolvían el PageState
 * en lugar de su contenido. Como internamente renderiza null cuando no hay
 * nada que mostrar, la app entera quedó en blanco. Estos tests fijan el
 * comportamiento para que no vuelva a pasar inadvertido.
 * ---------------------------------------------------------------------------
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PageState from '../components/ui/PageState'

describe('PageState', () => {
  it('no renderiza nada cuando no hay carga, ni error, ni vacío', () => {
    const { container } = render(<PageState />)
    expect(container).toBeEmptyDOMElement()
  })

  it('muestra el spinner y la etiqueta mientras carga', () => {
    render(<PageState loading loadingLabel="Cargando tu equipo..." />)
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText('Cargando tu equipo...')).toBeInTheDocument()
  })

  it('muestra el detalle del backend cuando el error es un texto', () => {
    render(
      <PageState
        error="El técnico no tiene vehículo asignado."
        errorTitle="No se pudo cargar tu equipo"
      />,
    )
    expect(screen.getByText('No se pudo cargar tu equipo')).toBeInTheDocument()
    expect(
      screen.getByText('El técnico no tiene vehículo asignado.'),
    ).toBeInTheDocument()
  })

  it('el botón Reintentar solo aparece si se pasa onRetry, y lo invoca', async () => {
    const { rerender } = render(<PageState error="boom" />)
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument()

    const onRetry = vi.fn()
    rerender(<PageState error="boom" onRetry={onRetry} />)
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('muestra el estado vacío con su descripción', () => {
    render(
      <PageState
        empty
        emptyTitle="Sin paradas para hoy"
        emptyDescription="Cuando tu supervisor te asigne tareas aparecerán aquí."
      />,
    )
    expect(screen.getByText('Sin paradas para hoy')).toBeInTheDocument()
    expect(
      screen.getByText('Cuando tu supervisor te asigne tareas aparecerán aquí.'),
    ).toBeInTheDocument()
  })

  it('la carga tiene prioridad sobre el error y el vacío', () => {
    render(<PageState loading error="boom" empty emptyTitle="Vacío" />)
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText('Vacío')).not.toBeInTheDocument()
  })
})

describe('PageState — uso correcto dentro de una página', () => {
  /** Página escrita con la guarda correcta: la condición mira los datos. */
  function PaginaCorrecta({ loading, error, datos }) {
    if (loading || error) {
      return <PageState loading={loading} error={error} errorTitle="Falló" />
    }
    return <p>Contenido real: {datos}</p>
  }

  it('renderiza su contenido cuando ya cargó y no hubo error', () => {
    render(<PaginaCorrecta loading={false} error={null} datos="mi equipo" />)
    expect(screen.getByText(/Contenido real/)).toBeInTheDocument()
  })

  it('renderiza el estado mientras carga', () => {
    render(<PaginaCorrecta loading error={null} />)
    expect(screen.queryByText(/Contenido real/)).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('un elemento JSX es truthy: la guarda NUNCA debe ir sobre el elemento', () => {
    // Esta es exactamente la trampa que dejó la app en blanco.
    const elemento = <PageState loading={false} error={null} />
    expect(Boolean(elemento)).toBe(true)

    // Y sin embargo, al renderizarlo no pinta nada:
    const { container } = render(elemento)
    expect(container).toBeEmptyDOMElement()
  })
})
