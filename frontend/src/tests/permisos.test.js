import { describe, expect, it } from 'vitest'
import {
  ROLES,
  PERMISOS_RUTAS,
  ROLES_RAMA_TECNICO,
  ROLES_RAMA_SUPERVISOR,
  rolesPermitidos,
  puedeAcceder,
  rutaInicialPorRol,
} from '../utils/permisos'

const ROLES_VALIDOS = Object.values(ROLES)
const RUTAS = Object.keys(PERMISOS_RUTAS)

describe('PERMISOS_RUTAS', () => {
  it('toda ruta tiene al menos un rol y todos son válidos', () => {
    for (const ruta of RUTAS) {
      const roles = PERMISOS_RUTAS[ruta]
      expect(roles.length).toBeGreaterThan(0)
      for (const rol of roles) {
        expect(ROLES_VALIDOS).toContain(rol)
      }
    }
  })

  it('está congelada', () => {
    expect(Object.isFrozen(PERMISOS_RUTAS)).toBe(true)
  })

  it('ninguna ruta de /supervisor admite tecnico', () => {
    for (const ruta of RUTAS.filter((r) => r.startsWith('/supervisor'))) {
      expect(puedeAcceder(ROLES.TECNICO, ruta)).toBe(false)
    }
  })

  it('empleados y reasignacion no admiten gerente ni tecnico', () => {
    for (const ruta of ['/supervisor/empleados', '/supervisor/reasignacion']) {
      expect(puedeAcceder(ROLES.GERENTE, ruta)).toBe(false)
      expect(puedeAcceder(ROLES.TECNICO, ruta)).toBe(false)
    }
  })

  it('cada ruta hija solo admite roles que su rama también admite', () => {
    for (const ruta of RUTAS) {
      const rama = ruta.startsWith('/supervisor') ? ROLES_RAMA_SUPERVISOR : ROLES_RAMA_TECNICO
      for (const rol of PERMISOS_RUTAS[ruta]) {
        expect(rama).toContain(rol)
      }
    }
  })
})

describe('rolesPermitidos', () => {
  it.each(['/no-existe', 'constructor', '__proto__', 'toString', '', undefined, null])(
    'devuelve [] para %s',
    (ruta) => {
      expect(rolesPermitidos(ruta)).toEqual([])
    }
  )
})

describe('puedeAcceder', () => {
  it.each([undefined, null, '', 'root', 42])('rechaza el rol %s', (rol) => {
    for (const ruta of RUTAS) {
      expect(puedeAcceder(rol, ruta)).toBe(false)
    }
  })

  it('rechaza rutas fuera de la tabla aunque el rol sea admin', () => {
    expect(puedeAcceder(ROLES.ADMIN, '/no-existe')).toBe(false)
  })
})

describe('rutaInicialPorRol', () => {
  it.each(ROLES_VALIDOS)('la pantalla inicial de %s es accesible para ese rol', (rol) => {
    expect(puedeAcceder(rol, rutaInicialPorRol(rol))).toBe(true)
  })

  it.each([undefined, null, '', 'root', 'constructor'])('manda %s a /login', (rol) => {
    expect(rutaInicialPorRol(rol)).toBe('/login')
  })
})
