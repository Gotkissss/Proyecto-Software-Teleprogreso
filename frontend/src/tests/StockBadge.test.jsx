/**
 * tests/StockBadge.test.jsx
 * ---------------------------------------------------------------------------
 * Pruebas unitarias del componente StockBadge (niveles de inventario).
 * Verifica la lógica de negocio de los tres niveles:
 *   - critico : disponible === 0
 *   - bajo    : disponible < minimo
 *   - normal  : disponible >= minimo
 * ---------------------------------------------------------------------------
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import StockBadge from '../components/ui/StockBadge'

describe('StockBadge', () => {
  it('muestra "Sin stock" cuando disponible es 0', () => {
    render(<StockBadge disponible={0} minimo={20} />)
    expect(screen.getByText('Sin stock')).toBeInTheDocument()
  })

  it('muestra "Stock bajo" cuando disponible es menor al mínimo', () => {
    render(<StockBadge disponible={5} minimo={20} />)
    expect(screen.getByText('Stock bajo')).toBeInTheDocument()
  })

  it('muestra "En stock" cuando disponible es igual al mínimo (caso borde)', () => {
    render(<StockBadge disponible={20} minimo={20} />)
    expect(screen.getByText('En stock')).toBeInTheDocument()
  })

  it('muestra "En stock" cuando disponible supera el mínimo', () => {
    render(<StockBadge disponible={100} minimo={20} />)
    expect(screen.getByText('En stock')).toBeInTheDocument()
  })

  it('muestra la cantidad disponible solo si showCount es true', () => {
    const { rerender } = render(
      <StockBadge disponible={7} minimo={20} showCount />,
    )
    expect(screen.getByText('7')).toBeInTheDocument()

    rerender(<StockBadge disponible={7} minimo={20} />)
    expect(screen.queryByText('7')).not.toBeInTheDocument()
  })
})
