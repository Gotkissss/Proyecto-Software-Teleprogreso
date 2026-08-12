/**
 * HU-165/166 — Fuente única de verdad para el color y la etiqueta de cada
 * estado de tarea en las vistas de mapa del supervisor.
 *
 * Se usa tanto en el marcador (MarcadorTareaSupervisor) como en la leyenda
 * (LeyendaMapaSupervisor), para que el color de cada pin en el mapa siempre
 * coincida con el color mostrado en la leyenda. Antes cada componente tenía
 * su propio mapeo de colores y era fácil que se desincronizaran al agregar
 * un estado nuevo.
 *
 * Mismas variables de color que ya usa Badge.jsx en el resto de la app.
 */

export const ESTADO_COLOR = {
  pendiente:   'var(--color-warning)',
  en_progreso: 'var(--color-primary)',
  completado:  'var(--color-success)',
  cancelado:   'var(--color-text-muted)',
}

export const ESTADO_LABEL = {
  pendiente:   'Pendiente',
  en_progreso: 'En Curso',
  completado:  'Completado',
  cancelado:   'Cancelado',
}

/** Orden fijo para pintar la leyenda siempre igual, sin depender del orden
 * en que llegan las tareas del backend. */
export const ORDEN_ESTADOS = ['pendiente', 'en_progreso', 'completado', 'cancelado']

/** Color del pin/leyenda para un estado dado (con respaldo neutro). */
export function colorPorEstado(estado) {
  return ESTADO_COLOR[estado] ?? 'var(--color-text-muted)'
}