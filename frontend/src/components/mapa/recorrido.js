/**
 * components/mapa/recorrido.js
 * ---------------------------------------------------------------------------
 * HU-5 — Utilidades compartidas por <CapaRecorrido> (mapa) y
 * <PanelRecorrido> (lista), para que ambos nombren y coloreen los eventos
 * del recorrido igual.
 * ---------------------------------------------------------------------------
 */

export const COLOR_TRAYECTO = 'var(--color-primary)'
export const COLOR_HUECO = 'var(--color-text-muted)'

/** Color de cada evento; los reportes periódicos usan el color de la línea. */
export const COLOR_EVENTO = {
  entrada: 'var(--color-success)',
  salida: 'var(--color-danger)',
  inicio_tarea: 'var(--color-info)',
  fin_tarea: 'var(--color-warning)',
}

/** "2026-09-23T08:05:00" → "08:05" (el backend manda hora local sin zona). */
export function horaDe(fechaHora) {
  return fechaHora ? String(fechaHora).slice(11, 16) : '—'
}

/** Texto de un punto con evento: "Entrada", "Inició: Instalación fibra"… */
export function etiquetaEvento(punto) {
  switch (punto.evento) {
    case 'entrada':
      return 'Entrada'
    case 'salida':
      return 'Salida'
    case 'inicio_tarea':
      return `Inició: ${punto.titulo_tarea ?? `tarea #${punto.id_tarea}`}`
    case 'fin_tarea':
      return `Finalizó: ${punto.titulo_tarea ?? `tarea #${punto.id_tarea}`}`
    default:
      return 'Ubicación'
  }
}
