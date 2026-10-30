/**
 * utils/tecnicos.js
 * ---------------------------------------------------------------------------
 * RTF-01 / R2-6 — en qué orden se ofrecen los técnicos al asignar o reasignar
 * una tarea.
 *
 * El selector mostraba la lista en el orden en que la devolvía la base y
 * etiquetaba como «Disponible para asignación» a cualquiera que no hubiera
 * llegado a su límite de tareas. «Disponible» era eso y solo eso: nada decía
 * si la persona había marcado entrada. Así que el primer técnico que se
 * ofrecía podía ser alguien que no había empezado su jornada, y la tarea se
 * quedaba parada hasta que lo hiciera — sin que el supervisor se enterara
 * hasta mirar el panel al día siguiente.
 *
 * Vive en `utils/` y no en `api/tareaService.js` porque es una función pura:
 * las pruebas que simulan el servicio de API lo reemplazan entero, y una
 * función de ordenación escondida ahí desaparecía con el mock.
 * ---------------------------------------------------------------------------
 */

/**
 * Grupo de disponibilidad de un técnico. Menor es antes.
 *
 * 0 — está trabajando ahora (entrada marcada y sin salida).
 * 1 — marcó entrada hoy pero ya cerró su jornada.
 * 2 — no ha marcado entrada hoy.
 */
function grupoDisponibilidad(tecnico) {
  if (tecnico?.en_jornada) return 0
  if (tecnico?.marco_entrada) return 1
  return 2
}

/**
 * Ordena los técnicos para el selector: primero quien puede empezar la tarea
 * ya, y dentro de cada grupo el de menos carga.
 *
 * No filtra a nadie. Asignar trabajo a alguien que todavía no marcó entrada es
 * legítimo —se prepara la ruta del día antes de que llegue—, así que lo que
 * hace falta es que se vea, no que se impida.
 *
 * @param {Array<{en_jornada?:boolean, marco_entrada?:boolean,
 *   tareas_activas?:number, nombre_completo?:string}>} tecnicos
 */
export function ordenarPorDisponibilidad(tecnicos = []) {
  if (!Array.isArray(tecnicos)) return []
  return [...tecnicos].sort(
    (a, b) =>
      grupoDisponibilidad(a) - grupoDisponibilidad(b)
      || (a?.tareas_activas ?? 0) - (b?.tareas_activas ?? 0)
      // El nombre como último criterio: sin él, dos técnicos con la misma
      // carga se intercambian de sitio entre refrescos y la lista «salta».
      || (a?.nombre_completo ?? '').localeCompare(b?.nombre_completo ?? '')
  )
}

/**
 * Cómo se lee el estado de jornada de un técnico, para la opción del selector
 * y para el aviso de debajo.
 */
export function estadoJornada(tecnico) {
  if (tecnico?.en_jornada) return 'en jornada'
  if (tecnico?.marco_entrada) return 'jornada cerrada'
  return 'sin entrada hoy'
}
