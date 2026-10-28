// La tabla refleja backend/app/core/deps.py; el backend sigue siendo quien decide.

export const ROLES = Object.freeze({
  ADMIN: 'admin',
  SUPERVISOR: 'supervisor',
  GERENTE: 'gerente',
  TECNICO: 'tecnico',
})

const REQUIRE_ADMIN = Object.freeze([ROLES.ADMIN])
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
  // HU-S9-03: GET /auditoria/* es require_admin.
  '/supervisor/bitacora': REQUIRE_ADMIN,
})

const RUTA_INICIAL = Object.freeze({
  [ROLES.ADMIN]: '/supervisor/dashboard',
  [ROLES.SUPERVISOR]: '/supervisor/dashboard',
  // HU-S9-04: el gerente entra directo a sus reportes.
  [ROLES.GERENTE]: '/supervisor/reportes',
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

// Refleja NIVEL_ROL y puede_administrar de backend/app/core/reglas.py.
const NIVEL_ROL = Object.freeze({
  [ROLES.ADMIN]: 3,
  [ROLES.GERENTE]: 2,
  [ROLES.SUPERVISOR]: 2,
  [ROLES.TECNICO]: 1,
})

export function puedeAdministrar(actor, objetivo) {
  if (actor === ROLES.ADMIN) return true
  const nivel = (rol) => (tieneClave(NIVEL_ROL, rol) ? NIVEL_ROL[rol] : 0)
  return nivel(actor) > nivel(objetivo)
}

// PATCH /empleados/{id}/contrasena: require_supervisor, nunca sobre uno mismo
// (para eso está «Cambiar contraseña» en el perfil) y respetando la jerarquía.
export function puedeRestablecerContrasena(usuario, empleado) {
  if (!usuario || !empleado) return false
  if (!REQUIRE_SUPERVISOR.includes(usuario.rol)) return false
  if (usuario.id_empleado === empleado.id_empleado) return false
  return puedeAdministrar(usuario.rol, empleado.rol)
}

// ── Acciones dentro de una pantalla (HU-S10-08) ─────────────────────────────
//
// La tabla de rutas de arriba decide qué PANTALLAS ve cada rol. Esta decide
// qué BOTONES, que no es lo mismo: el gerente entra a Alertas y a Inventario
// porque su trabajo es revisar la operación, pero no atiende avisos ni toca el
// almacén. Hasta ahora veía los botones igual y cada clic terminaba en un 403
// del backend; el permiso estaba bien puesto, lo que estaba mal era prometer
// en pantalla algo que la API iba a rechazar.
//
// Los valores salen de las dependencias de los endpoints que hay detrás
// (`require_supervisor` en routers/alertas.py, activos.py y carros.py), que es
// quien de verdad decide. Esto solo evita el clic en falso.
const PERMISOS_ACCIONES = Object.freeze({
  // PATCH /alertas/{id}
  'alertas.atender': REQUIRE_SUPERVISOR,
  // POST /activos, PATCH /activos/{id}, DELETE /activos/{id}
  'inventario.crear': REQUIRE_SUPERVISOR,
  'inventario.editar': REQUIRE_SUPERVISOR,
  'inventario.eliminar': REQUIRE_SUPERVISOR,
  // POST/DELETE de asignaciones de vehículo y de herramientas a vehículo
  'inventario.asignar': REQUIRE_SUPERVISOR,
  // POST /activos/materiales/{id}/movimientos (HU-S10-07). La CONSULTA de los
  // movimientos es require_supervisor también, así que el gerente tampoco
  // abre la pestaña: no es un dato de reporte, es el detalle operativo del
  // almacén.
  'inventario.movimientos': REQUIRE_SUPERVISOR,
})

/**
 * ¿Puede este rol ejecutar esta acción?
 *
 * Una acción desconocida devuelve false a propósito: si alguien añade un botón
 * y escribe mal la clave, lo seguro es que no se pinte, no que se pinte para
 * todos.
 */
export function puedeOperar(rol, accion) {
  if (typeof rol !== 'string' || rol === '') return false
  if (!tieneClave(PERMISOS_ACCIONES, accion)) return false
  return PERMISOS_ACCIONES[accion].includes(rol)
}

export function rutaInicialPorRol(rol) {
  if (!tieneClave(RUTA_INICIAL, rol)) {
    return '/login'
  }
  return RUTA_INICIAL[rol]
}
