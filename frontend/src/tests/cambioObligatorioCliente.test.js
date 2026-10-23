/**
 * tests/cambioObligatorioCliente.test.js
 * ---------------------------------------------------------------------------
 * HU-S10-01 (tarea 4) — el cliente de axios reconoce PASSWORD_CHANGE_REQUIRED.
 *
 * Con el cambio de contraseña pendiente, el backend responde 403 a todo salvo
 * a unas pocas rutas. El interceptor tiene que distinguir ese 403 de un 403
 * cualquiera (sin permiso de rol) y de un 401 (sesión muerta):
 *   - 403 PASSWORD_CHANGE_REQUIRED → avisa con un evento y CONSERVA el token
 *     (hace falta para llamar a /auth/cambiar-contrasena).
 *   - 403 normal → no avisa de nada.
 *   - 401 → sigue cerrando la sesión como antes.
 * ---------------------------------------------------------------------------
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import apiClient, { EVENTO_SESION_CADUCADA } from '../api/client'
import {
  CODIGO_CAMBIO_OBLIGATORIO,
  EVENTO_CAMBIO_OBLIGATORIO,
  debeCambiarContrasena,
  esErrorCambioObligatorio,
} from '../utils/cambioObligatorio'

const adaptadorOriginal = apiClient.defaults.adapter

/** Hace que la próxima petición falle con el estado y cuerpo dados. */
function responderCon(status, data) {
  apiClient.defaults.adapter = (config) =>
    Promise.reject({ config, response: { status, data, headers: {}, config } })
}

let alCambio
let alCaducar

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('access_token', 'token-vigente')
  alCambio = vi.fn()
  alCaducar = vi.fn()
  window.addEventListener(EVENTO_CAMBIO_OBLIGATORIO, alCambio)
  window.addEventListener(EVENTO_SESION_CADUCADA, alCaducar)
})

afterEach(() => {
  window.removeEventListener(EVENTO_CAMBIO_OBLIGATORIO, alCambio)
  window.removeEventListener(EVENTO_SESION_CADUCADA, alCaducar)
  apiClient.defaults.adapter = adaptadorOriginal
})

describe('esErrorCambioObligatorio', () => {
  it('reconoce el 403 con el código PASSWORD_CHANGE_REQUIRED', () => {
    expect(
      esErrorCambioObligatorio({
        response: { status: 403, data: { error: CODIGO_CAMBIO_OBLIGATORIO } },
      }),
    ).toBe(true)
  })

  it.each([
    ['un 403 por rol', { response: { status: 403, data: { error: 'FORBIDDEN' } } }],
    ['el mismo código con otro estado', { response: { status: 400, data: { error: CODIGO_CAMBIO_OBLIGATORIO } } }],
    ['un 401', { response: { status: 401, data: {} } }],
    ['un error de red sin respuesta', {}],
    ['null', null],
  ])('no confunde %s', (_nombre, error) => {
    expect(esErrorCambioObligatorio(error)).toBe(false)
  })
})

describe('debeCambiarContrasena', () => {
  it('solo es verdadero con la bandera en true', () => {
    expect(debeCambiarContrasena({ debe_cambiar_contrasena: true })).toBe(true)
    expect(debeCambiarContrasena({ debe_cambiar_contrasena: false })).toBe(false)
    expect(debeCambiarContrasena({})).toBe(false)
    expect(debeCambiarContrasena({ debe_cambiar_contrasena: 'true' })).toBe(false)
    expect(debeCambiarContrasena(null)).toBe(false)
  })
})

describe('interceptor de respuesta', () => {
  it('403 PASSWORD_CHANGE_REQUIRED: avisa y conserva el token', async () => {
    responderCon(403, { error: CODIGO_CAMBIO_OBLIGATORIO, detail: 'Cambia tu contraseña.' })

    await expect(apiClient.get('/tareas')).rejects.toBeTruthy()

    expect(alCambio).toHaveBeenCalledTimes(1)
    expect(alCaducar).not.toHaveBeenCalled()
    expect(localStorage.getItem('access_token')).toBe('token-vigente')
  })

  it('un 403 por rol no dispara el cambio obligatorio', async () => {
    responderCon(403, { error: 'FORBIDDEN', detail: 'Sin permiso.' })

    await expect(apiClient.get('/auditoria')).rejects.toBeTruthy()

    expect(alCambio).not.toHaveBeenCalled()
    expect(localStorage.getItem('access_token')).toBe('token-vigente')
  })

  it('un 401 sigue cerrando la sesión como antes', async () => {
    responderCon(401, { error: 'TOKEN_EXPIRED' })

    await expect(apiClient.get('/tareas')).rejects.toBeTruthy()

    expect(alCambio).not.toHaveBeenCalled()
    expect(localStorage.getItem('access_token')).toBeNull()
  })
})