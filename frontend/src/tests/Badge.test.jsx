/**
 * tests/Badge.test.jsx
 * ---------------------------------------------------------------------------
 * Pruebas unitarias del componente Badge (etiqueta de estado/prioridad).
 * Verifica que el texto se renderice y que el mapeo automático
 * label → variante de color funcione.
 * ---------------------------------------------------------------------------
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import Badge from '../components/ui/Badge'

describe('Badge', () => {
  it('renderiza el texto de la etiqueta', () => {
    render(<Badge label="pendiente" />)
    expect(screen.getByText('pendiente')).toBeInTheDocument()
  })

  it('asigna la variante success cuando el label es "completado"', () => {
    render(<Badge label="completado" />)
    expect(screen.getByText('completado').className).toContain('success')
  })

  it('asigna la variante danger cuando el label es "urgente"', () => {
    render(<Badge label="urgente" />)
    expect(screen.getByText('urgente').className).toContain('danger')
  })

  it('usa la variante muted para labels desconocidos', () => {
    render(<Badge label="algo_raro" />)
    expect(screen.getByText('algo_raro').className).toContain('muted')
  })

  it('respeta la variante explícita aunque el label tenga mapeo propio', () => {
    render(<Badge label="completado" variant="danger" />)
    expect(screen.getByText('completado').className).toContain('danger')
  })
})
