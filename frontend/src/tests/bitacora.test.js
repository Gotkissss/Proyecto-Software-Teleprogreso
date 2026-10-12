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
    expect(textoAccion('renovar_sesion')).toBe('renovar_sesion')
  })
})
