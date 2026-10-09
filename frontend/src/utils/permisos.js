// La tabla refleja backend/app/core/deps.py; el backend sigue siendo quien decide.

export const ROLES = Object.freeze({
  ADMIN: 'admin',
  SUPERVISOR: 'supervisor',
  GERENTE: 'gerente',
  TECNICO: 'tecnico',
})

const REQUIRE_ADMIN_SUPERVISOR_GERENTE = Object.freeze([ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.GERENTE])
const REQUIRE_SUPERVISOR = Object.freeze([ROLES.ADMIN, ROLES.SUPERVISOR])
const REQUIRE_GERENTE = Object.freeze([ROLES.ADMIN, ROLES.GERENTE])
const REQUIRE_TECNICO = Object.freeze([ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.TECNICO])

export const ROLES_RAMA_TECNICO = REQUIRE_TECNICO
export const ROLES_RAMA_SUPERVISOR = REQUIRE_ADMIN_SUPERVISOR_GERENTE

export const PERMISOS_RUTAS = Object.freeze({
  '/ruta': REQUIRE_TECNICO,
  '/mapa': REQUIRE_TECNICO,
  '/pausas': REQUIRE_TECNICO,
  '/historial': REQUIRE_TECNICO,
  '/equipo': REQUIRE_TECNICO,
  '/perfil': REQUIRE_TECNICO,

  '/supervisor/dashboard': REQUIRE_SUPERVISOR,
  '/supervisor/mapa': REQUIRE_ADMIN_SUPERVISOR_GERENTE,
  '/supervisor/alertas': REQUIRE_ADMIN_SUPERVISOR_GERENTE,
  '/supervisor/reasignacion': REQUIRE_SUPERVISOR,
  '/supervisor/empleados': REQUIRE_SUPERVISOR,
  '/supervisor/nueva-tarea': REQUIRE_SUPERVISOR,
  '/supervisor/inventario': REQUIRE_ADMIN_SUPERVISOR_GERENTE,
  '/supervisor/carros/:id': REQUIRE_ADMIN_SUPERVISOR_GERENTE,
  '/supervisor/historial-tareas': REQUIRE_ADMIN_SUPERVISOR_GERENTE,
  '/supervisor/perfil': REQUIRE_ADMIN_SUPERVISOR_GERENTE,
  '/supervisor/reportes': REQUIRE_GERENTE,
})

const RUTA_INICIAL = Object.freeze({
  [ROLES.ADMIN]: '/supervisor/dashboard',
  [ROLES.SUPERVISOR]: '/supervisor/dashboard',
  [ROLES.GERENTE]: '/supervisor/mapa',
  [ROLES.TECNICO]: '/ruta',
})

function tieneClave(objeto, clave) {
  return typeof clave === 'string' && Object.prototype.hasOwnProperty.call(objeto, clave)
}

export function rolesPermitidos(ruta) {
  if (!tieneClave(PERMISOS_RUTAS, ruta)) {
    return []
  }
  return PERMISOS_RUTAS[ruta]
}

export function puedeAcceder(rol, ruta) {
  if (typeof rol !== 'string' || rol === '') return false
  return rolesPermitidos(ruta).includes(rol)
}

export function rutaInicialPorRol(rol) {
  if (!tieneClave(RUTA_INICIAL, rol)) {
    return '/login'
  }
  return RUTA_INICIAL[rol]
}
