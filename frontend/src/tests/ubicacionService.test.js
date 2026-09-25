/**
 * tests/ubicacionService.test.js
 * ---------------------------------------------------------------------------
 * Pruebas del servicio de reporte de ubicación (SCRUM-218).
 *
 * Lo que se fija aquí es el contrato que el hook da por sentado: el 409 llega
 * como resultado y cualquier otro error llega como excepción. Si eso se
 * invirtiera, el hook dejaría de reportar en silencio o se llenaría de
 * errores no controlados.
 * ---------------------------------------------------------------------------
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { postMock, getMock } = vi.hoisted(() => ({
  postMock: vi.fn(),
  getMock: vi.fn(),
}))

vi.mock('../api/client', () => ({
  default: {
    post: postMock,
    get: getMock,
  },
}))

import { enviarUbicacion, getUbicacionesTecnicos } from '../api/ubicacionService'

// Ciudad de Guatemala: latitud norte, longitud oeste.
const COORDENADAS = { lat: 14.6349, lng: -90.5069 }

/** Error de Axios con respuesta del servidor, como el que ve el servicio. */
function errorHttp(status, detail) {
  return { response: { status, data: { error: 'X', detail, status_code: status } } }
}

describe('enviarUbicacion', () => {
  beforeEach(() => {
    postMock.mockReset()
  })

  it('manda las coordenadas al endpoint y devuelve el comprobante (201)', async () => {
    postMock.mockResolvedValue({
      data: {
        id_ubicacion: 55,
        fecha_hora_registro: '2026-09-22T09:15:00',
        mensaje: 'Ubicación registrada correctamente.',
      },
    })

    const resultado = await enviarUbicacion(COORDENADAS)

    expect(postMock).toHaveBeenCalledWith('/ubicaciones', COORDENADAS)
    expect(resultado).toEqual({
      ok: true,
      id_ubicacion: 55,
      fecha_hora_registro: '2026-09-22T09:15:00',
      mensaje: 'Ubicación registrada correctamente.',
    })
  })

  it('no manda ningún id de empleado: eso lo resuelve el backend con el token', async () => {
    postMock.mockResolvedValue({ data: { id_ubicacion: 1 } })

    await enviarUbicacion({ ...COORDENADAS, id_empleado: 99 })

    const [, cuerpo] = postMock.mock.calls[0]
    expect(Object.keys(cuerpo).sort()).toEqual(['lat', 'lng'])
  })

  it('devuelve un resultado, no una excepción, cuando no hay jornada abierta (409)', async () => {
    postMock.mockRejectedValue(
      errorHttp(409, 'No tienes una jornada abierta. Registra tu entrada antes de reportar tu ubicación.')
    )

    const resultado = await enviarUbicacion(COORDENADAS)

    expect(resultado.ok).toBe(false)
    expect(resultado.motivo).toBe('sin_jornada')
    expect(resultado.mensaje).toContain('jornada abierta')
  })

  it('propaga el 401 para que el interceptor cierre la sesión', async () => {
    postMock.mockRejectedValue(errorHttp(401, 'No se pudo validar las credenciales'))

    await expect(enviarUbicacion(COORDENADAS)).rejects.toMatchObject({
      response: { status: 401 },
    })
  })

  it('propaga el 422 de coordenadas inválidas en vez de darlo por bueno', async () => {
    postMock.mockRejectedValue(errorHttp(422, 'Los datos enviados no son validos.'))

    await expect(enviarUbicacion({ lat: 200, lng: 0 })).rejects.toMatchObject({
      response: { status: 422 },
    })
  })

  it('propaga un fallo de red, que no trae respuesta del servidor', async () => {
    postMock.mockRejectedValue(new Error('Network Error'))

    await expect(enviarUbicacion(COORDENADAS)).rejects.toThrow('Network Error')
  })
})

describe('getUbicacionesTecnicos', () => {
  beforeEach(() => {
    getMock.mockReset()
  })

  it('pide GET /ubicaciones/tecnicos y devuelve la lista tal cual', async () => {
    const lista = [
      {
        id_empleado: 7,
        nombre: 'Ana López',
        lat: 14.6349,
        lng: -90.5069,
        fecha_hora_registro: '2026-09-23T09:45:12',
        estado: 'en_tarea',
      },
    ]
    getMock.mockResolvedValue({ data: lista })

    const resultado = await getUbicacionesTecnicos()

    expect(getMock).toHaveBeenCalledWith('/ubicaciones/tecnicos')
    expect(resultado).toEqual(lista)
  })

  it('devuelve un arreglo vacío si la respuesta no es un arreglo', async () => {
    getMock.mockResolvedValue({ data: null })

    const resultado = await getUbicacionesTecnicos()

    expect(resultado).toEqual([])
  })
})