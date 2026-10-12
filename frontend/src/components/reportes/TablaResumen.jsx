/**
 * components/reportes/TablaResumen.jsx
 * ---------------------------------------------------------------------------
 * Tabla maestra del resumen operativo (GET /reportes/resumen): una fila por
 * empleado, ordenable por cualquier columna y con los totales del periodo al
 * pie. Elegir una fila (clic, Enter o espacio) abre el detalle de esa
 * persona en la pantalla de reportes.
 * ---------------------------------------------------------------------------
 */
import { useMemo, useState } from 'react'
import { formatoNumero, ordenarFilas } from '../../utils/reportes'
import styles from './TablaResumen.module.css'

/* `orden` es la columna numérica por la que se ordena (las horas se
   muestran como "hh:mm" pero se ordenan por minutos). */
const COLUMNAS = [
  { clave: 'nombre_empleado', etiqueta: 'Empleado', orden: 'nombre_empleado', texto: true },
  { clave: 'jornadas', etiqueta: 'Jornadas', orden: 'jornadas' },
  { clave: 'horas_trabajadas', etiqueta: 'Horas trabajadas', orden: 'minutos_trabajados' },
  { clave: 'descansos', etiqueta: 'Descansos', orden: 'descansos' },
  { clave: 'horas_descanso', etiqueta: 'Tiempo en descanso', orden: 'minutos_descanso' },
  { clave: 'tareas_completadas', etiqueta: 'Tareas', orden: 'tareas_completadas' },
  { clave: 'tareas_por_hora', etiqueta: 'Tareas/hora', orden: 'tareas_por_hora', decimales: 2 },
]

function celda(columna, fila) {
  const valor = fila[columna.clave]
  if (columna.texto || typeof valor === 'string') return valor
  return formatoNumero(valor, columna.decimales ?? 0)
}

export default function TablaResumen({ resumen, seleccionado = null, onSeleccionar }) {
  const [orden, setOrden] = useState({ columna: 'minutos_trabajados', direccion: 'desc' })
  const filas = useMemo(
    () => ordenarFilas(resumen?.items ?? [], orden.columna, orden.direccion),
    [resumen, orden]
  )

  const ordenarPor = (columna) => {
    setOrden((previo) =>
      previo.columna === columna.orden
        ? { columna: columna.orden, direccion: previo.direccion === 'asc' ? 'desc' : 'asc' }
        // Texto de la A a la Z; números del mayor al menor.
        : { columna: columna.orden, direccion: columna.texto ? 'asc' : 'desc' }
    )
  }

  const totales = {
    nombre_empleado: `Total · ${resumen.total_empleados} ${resumen.total_empleados === 1 ? 'persona' : 'personas'}`,
    jornadas: resumen.total_jornadas,
    horas_trabajadas: resumen.total_horas_trabajadas,
    descansos: resumen.total_descansos,
    horas_descanso: resumen.total_horas_descanso,
    tareas_completadas: resumen.total_tareas_completadas,
    tareas_por_hora: resumen.tareas_por_hora,
  }

  return (
    <div className={styles.wrap}>
      <table className={styles.tabla}>
        <caption className={styles.oculto}>
          Resumen operativo por empleado. Elige una fila para ver su detalle.
        </caption>
        <thead>
          <tr>
            {COLUMNAS.map((columna) => {
              const activa = orden.columna === columna.orden
              return (
                <th
                  key={columna.clave}
                  scope="col"
                  className={columna.texto ? undefined : styles.numero}
                  aria-sort={activa ? (orden.direccion === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  <button type="button" className={styles.ordenar} onClick={() => ordenarPor(columna)}>
                    {columna.etiqueta}
                    <span className={`${styles.flecha} ${activa ? styles.flechaActiva : ''}`} aria-hidden="true">
                      {activa && orden.direccion === 'asc' ? '▲' : '▼'}
                    </span>
                  </button>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {filas.map((fila) => {
            const elegida = seleccionado === fila.id_empleado
            return (
              <tr
                key={fila.id_empleado}
                className={`${styles.fila} ${elegida ? styles.filaElegida : ''}`}
                tabIndex={0}
                aria-selected={elegida}
                onClick={() => onSeleccionar?.(fila)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSeleccionar?.(fila)
                  }
                }}
              >
                {COLUMNAS.map((columna) => (
                  <td key={columna.clave} className={columna.texto ? styles.nombre : styles.numero}>
                    {celda(columna, fila)}
                    {columna.clave === 'jornadas' && fila.jornadas_abiertas > 0 && (
                      <span className={styles.aviso} title="Jornadas sin salida marcada">
                        {' '}({fila.jornadas_abiertas} sin cerrar)
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr>
            {COLUMNAS.map((columna) => (
              <td key={columna.clave} className={columna.texto ? styles.nombre : styles.numero}>
                {celda(columna, totales)}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
