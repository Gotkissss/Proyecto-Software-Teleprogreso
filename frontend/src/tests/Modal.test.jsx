/**
 * tests/Modal.test.jsx
 * ---------------------------------------------------------------------------
 * Pruebas unitarias del componente Modal genérico.
 * Verifica apertura/cierre, el botón de cerrar, la tecla Escape
 * y que el click dentro del modal NO lo cierre.
 * ---------------------------------------------------------------------------
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Modal from '../components/ui/Modal'

describe('Modal', () => {
  it('no renderiza nada cuando open es false', () => {
    render(
      <Modal open={false} onClose={() => {}} title="Confirmar">
        <p>Contenido</p>
      </Modal>,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renderiza título y contenido cuando open es true', () => {
    render(
      <Modal open onClose={() => {}} title="Confirmar acción">
        <p>¿Está seguro?</p>
      </Modal>,
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Confirmar acción')).toBeInTheDocument()
    expect(screen.getByText('¿Está seguro?')).toBeInTheDocument()
  })

  it('llama a onClose al hacer click en el botón de cerrar', async () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} title="Confirmar">
        <p>Contenido</p>
      </Modal>,
    )
    await userEvent.click(screen.getByLabelText('Cerrar'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('llama a onClose al presionar la tecla Escape', () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} title="Confirmar">
        <p>Contenido</p>
      </Modal>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('NO cierra el modal al hacer click dentro del contenido', async () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} title="Confirmar">
        <p>Contenido interno</p>
      </Modal>,
    )
    await userEvent.click(screen.getByText('Contenido interno'))
    expect(onClose).not.toHaveBeenCalled()
  })
})
