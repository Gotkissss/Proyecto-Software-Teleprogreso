/**
 * tests/setup.js
 * ---------------------------------------------------------------------------
 * Configuración global de Vitest.
 * Agrega los matchers de jest-dom (toBeInTheDocument, toHaveClass, etc.)
 * y limpia el DOM después de cada test.
 * ---------------------------------------------------------------------------
 */
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})
