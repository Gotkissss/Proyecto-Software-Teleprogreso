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
import { MotionGlobalConfig } from 'motion/react'
import { afterEach, vi } from 'vitest'

// Las animaciones de entrada llegan a su destino al instante en las pruebas.
// Sin esto, cada pantalla renderiza con sus piezas invisibles y sus cifras en
// cero, y cualquier comprobación de que algo se ve acabaría fallando por el
// movimiento y no por lo que estaba probando.
//
// Es `instantAnimations` y no `skipAnimations`: el segundo no salta al final,
// deja la pieza en su estado inicial, que es precisamente el invisible. El
// contrato del movimiento se comprueba aparte, en animacionEntrada.test.jsx.
MotionGlobalConfig.instantAnimations = true

// jsdom no implementa la API de object URLs. Los componentes que muestran el
// preview de una foto antes de subirla (ModalFinalizarTarea, ModalEvidencias)
// la llaman dentro de un useEffect, así que sin este polyfill el render
// revienta y el test falla por una razón que no tiene que ver con lo probado.
if (typeof URL.createObjectURL !== 'function') {
  URL.createObjectURL = vi.fn(() => 'blob:mock/preview')
}
if (typeof URL.revokeObjectURL !== 'function') {
  URL.revokeObjectURL = vi.fn()
}

afterEach(() => {
  cleanup()
})
