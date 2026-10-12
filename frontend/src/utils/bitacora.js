/**
 * utils/bitacora.js
 * ---------------------------------------------------------------------------
 * Presentación de las filas de la bitácora de auditoría (HU-S9-03): cómo se
 * nombra cada acción, quién la hizo y cómo se arma el antes/después del panel
 * de detalle. Funciones puras para poder probarlas sin montar la pantalla.
 * ---------------------------------------------------------------------------
 */

/** Cómo se lee cada acción en pantalla, y con qué color. */
export const ACCIONES = {
  crear:              { texto: 'Creó',                variante: 'success' },
  actualizar:         { texto: 'Modificó',            variante: 'info' },
  eliminar:           { texto: 'Eliminó',             variante: 'danger' },
  leer:               { texto: 'Consultó',            variante: 'muted' },
  login_fallido:      { texto: 'Login fallido',       variante: 'warning' },
  login_bloqueado:    { texto: 'Login bloqueado',     variante: 'danger' },
  bloqueo_rate_limit: { texto: 'Exceso de peticiones', variante: 'danger' },
  logout:             { texto: 'Cerró sesión',        variante: 'muted' },
  acceso_denegado:    { texto: 'Acceso denegado',     variante: 'warning' },
  purgar:             { texto: 'Purga',               variante: 'warning' },
  reencadenar:        { texto: 'Re-encadenado',       variante: 'muted' },
}

export function textoAccion(accion) {
  return ACCIONES[accion]?.texto ?? accion
}

export function formatearFechaHora(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-GT', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function quien(fila) {
  if (fila.nombre_actor) return fila.nombre_actor
  if (fila.rol_actor === 'sistema') return 'Sistema'
  if (fila.id_actor != null) return `Empleado #${fila.id_actor}`
  return 'Sin sesión'
}

function valorLegible(valor) {
  if (valor === null || valor === undefined) return '—'
  if (typeof valor === 'object') return JSON.stringify(valor)
  if (typeof valor === 'boolean') return valor ? 'sí' : 'no'
  return String(valor)
}

function esDiff(valor) {
  return (
    valor !== null &&
    typeof valor === 'object' &&
    !Array.isArray(valor) &&
    Object.keys(valor).length === 2 &&
    'antes' in valor &&
    'despues' in valor
  )
}

/**
 * Convierte `cambios` en filas para el panel de detalle:
 * - actualizar → campo, antes, después (solo lo que cambió)
 * - el resto   → campo, valor
 */
export function filasDeCambios(cambios) {
  if (!cambios || typeof cambios !== 'object') return { conDiff: false, filas: [] }
  const entradas = Object.entries(cambios)
  const conDiff = entradas.length > 0 && entradas.every(([, valor]) => esDiff(valor))
  return {
    conDiff,
    filas: entradas.map(([campo, valor]) =>
      conDiff
        ? { campo, antes: valorLegible(valor.antes), despues: valorLegible(valor.despues) }
        : { campo, valor: valorLegible(valor) }
    ),
  }
}
