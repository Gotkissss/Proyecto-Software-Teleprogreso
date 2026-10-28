import { describe, expect, it } from 'vitest'
import { ACCIONES, filasDeCambios, quien, textoAccion } from '../utils/bitacora'

describe('utils/bitacora', () => {
  it('un update se lee como diff campo por campo', () => {
    expect(filasDeCambios({ nombre: { antes: 'Ana', despues: 'Eva' } })).toEqual({
      conDiff: true,
      filas: [{ campo: 'nombre', antes: 'Ana', despues: 'Eva' }],
    })
  })

  it('una creación o un evento se leen como campo y valor', () => {
    expect(filasDeCambios({ masivo: true, filas: 2, ids: [3, 4] })).toEqual({
      conDiff: false,
      filas: [
        { campo: 'masivo', valor: 'sí' },
        { campo: 'filas', valor: '2' },
        { campo: 'ids', valor: '[3,4]' },
      ],
    })
  })

  it('sin cambios no hay filas', () => {
    expect(filasDeCambios(null)).toEqual({ conDiff: false, filas: [] })
  })

  it('el valor oculto de la lista negra se enseña tal cual', () => {
    expect(filasDeCambios({ hash_contrasena: { antes: '***', despues: '***' } }).filas[0]).toEqual({
      campo: 'hash_contrasena', antes: '***', despues: '***',
    })
  })

  it('nombra al actor aunque no haya sesión', () => {
    expect(quien({ nombre_actor: 'Ada', id_actor: 1 })).toBe('Ada')
    expect(quien({ rol_actor: 'sistema', id_actor: null })).toBe('Sistema')
    expect(quien({ id_actor: 9, nombre_actor: null })).toBe('Empleado #9')
    expect(quien({ id_actor: null })).toBe('Sin sesión')
  })

  it('toda acción conocida tiene texto y una acción nueva no rompe la pantalla', () => {
    for (const accion of Object.keys(ACCIONES)) {
      expect(textoAccion(accion)).not.toBe(accion)
    }
    // Una acción que el backend emita y aquí no esté sale cruda en vez de
    // dejar la celda vacía. `renovar_sesion` era el ejemplo de esta prueba
    // justamente porque le faltaba la etiqueta: desde RTF-01 / R1-6 ya la
    // tiene, así que el ejemplo pasa a ser una acción inventada.
    expect(textoAccion('accion_que_no_existe')).toBe('accion_que_no_existe')
  })

  it('las acciones que el backend emite tienen su etiqueta', () => {
    // RTF-01 / R1-6: la bitácora mostraba «renovar_sesion» tal cual, y un
    // login salía como «Modificó empleado #n» porque no había una acción
    // propia. Un registro de auditoría que hay que descifrar no lo lee nadie.
    for (const accion of [
      'login',
      'logout',
      'renovar_sesion',
      'login_fallido',
      'login_bloqueado',
      'acceso_denegado',
      'limite_ubicaciones',
      'error_interno',
    ]) {
      expect(ACCIONES[accion], `falta la etiqueta de «${accion}»`).toBeTruthy()
      expect(textoAccion(accion)).not.toBe(accion)
    }
  })

  it('«Inició sesión» se distingue de «Modificó»', () => {
    expect(textoAccion('login')).toBe('Inició sesión')
    expect(textoAccion('actualizar')).toBe('Modificó')
  })
})
