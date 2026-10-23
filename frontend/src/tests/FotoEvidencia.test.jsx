/**
 * tests/FotoEvidencia.test.jsx
 * ---------------------------------------------------------------------------
 * HU-S10-02: la foto usa el enlace firmado tal cual y, si vence con la
 * pantalla abierta, pide uno nuevo una sola vez antes de avisar.
 * ---------------------------------------------------------------------------
 */
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import FotoEvidencia from '../components/tareas/FotoEvidencia'

const BASE = 'http://backend.test/archivos/incidencias/incidencia_2_ab12.jpg'
const PRIMERA = `${BASE}?exp=1790000600&firma=${'a'.repeat(64)}`
const RENOVADA = `${BASE}?exp=1790001200&firma=${'b'.repeat(64)}`

function renderizar(src, alExpirar) {
  return render(<FotoEvidencia src={src} alt="Evidencia" alExpirar={alExpirar} />)
}

describe('FotoEvidencia', () => {
  it('usa el src que recibe tal cual, con su exp y su firma', () => {
    renderizar(PRIMERA)

    expect(screen.getByAltText('Evidencia')).toHaveAttribute('src', PRIMERA)
  })

  it('ante el primer error pide un enlace nuevo una sola vez y no avisa todavía', () => {
    const alExpirar = vi.fn()
    renderizar(PRIMERA, alExpirar)

    fireEvent.error(screen.getByAltText('Evidencia'))

    expect(alExpirar).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/No se pudo cargar la foto/i)).not.toBeInTheDocument()
  })

  it('si el enlace nuevo de la misma foto también falla, avisa y no vuelve a pedir', () => {
    const alExpirar = vi.fn()
    const { rerender } = renderizar(PRIMERA, alExpirar)

    fireEvent.error(screen.getByAltText('Evidencia'))
    rerender(<FotoEvidencia src={RENOVADA} alt="Evidencia" alExpirar={alExpirar} />)
    expect(screen.getByAltText('Evidencia')).toHaveAttribute('src', RENOVADA)
    fireEvent.error(screen.getByAltText('Evidencia'))

    expect(alExpirar).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/No se pudo cargar la foto/i)).toBeInTheDocument()
  })

  it('otra foto empieza su propio intento', () => {
    const alExpirar = vi.fn()
    const { rerender } = renderizar(PRIMERA, alExpirar)

    fireEvent.error(screen.getByAltText('Evidencia'))
    rerender(
      <FotoEvidencia
        src={'http://backend.test/archivos/incidencias/otra.jpg?exp=1&firma=c'}
        alt="Evidencia"
        alExpirar={alExpirar}
      />,
    )
    fireEvent.error(screen.getByAltText('Evidencia'))

    expect(alExpirar).toHaveBeenCalledTimes(2)
  })

  it('sin alExpirar avisa al primer error', () => {
    renderizar(PRIMERA)

    fireEvent.error(screen.getByAltText('Evidencia'))

    expect(screen.getByText(/No se pudo cargar la foto/i)).toBeInTheDocument()
  })
})
