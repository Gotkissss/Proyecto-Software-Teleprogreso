/**
 * components/reportes/ModalExportarReporte.jsx
 * ---------------------------------------------------------------------------
 * Diálogo de descarga de reportes: qué reporte, de qué fechas y de quién.
 *
 * El botón "Exportar reporte" del dashboard bajaba siempre lo mismo — la
 * asistencia del mes en curso — porque el rango se calculaba dentro de la
 * función de descarga y el tipo estaba fijo. El backend ya aceptaba rango y
 * tres reportes más; lo que faltaba era pedirle al usuario esos datos.
 *
 * Reglas de la pantalla:
 *   - Un atajo de fecha ("Hoy", "Este mes"...) rellena las dos fechas; tocar
 *     una fecha a mano cambia el periodo a "Personalizado".
 *   - No se permite descargar con el rango invertido. El backend también lo
 *     rechaza con 400, pero avisar aquí evita la ida y vuelta.
 *   - El filtro por persona solo se ofrece si el padre pasó la lista; sin
 *     ella, el reporte sale de toda la plantilla.
 * ---------------------------------------------------------------------------
 */
import { useEffect, useMemo, useState } from 'react'
import Modal, { ModalActions } from '../ui/Modal'
import Spinner from '../ui/Spinner'
import {
  RANGOS_RAPIDOS,
  REPORTES,
  exportarReporte,
  rangoRapido,
} from '../../utils/exportarReportes'
import styles from './ModalExportarReporte.module.css'

const RANGO_POR_DEFECTO = 'mes'

export default function ModalExportarReporte({
  open,
  onClose,
  empleados = [],
  onExportado,
  onError,
}) {
  const [tipo, setTipo] = useState(REPORTES[0].tipo)
  const [periodo, setPeriodo] = useState(RANGO_POR_DEFECTO)
  const [fechas, setFechas] = useState(() => rangoRapido(RANGO_POR_DEFECTO))
  const [empleado, setEmpleado] = useState('')
  const [descargando, setDescargando] = useState(false)

  // Al reabrir, el diálogo vuelve a su estado inicial: si alguien descargó
  // "el mes pasado de Ana", lo natural al volver a abrir no es repetir eso.
  useEffect(() => {
    if (!open) return
    setTipo(REPORTES[0].tipo)
    setPeriodo(RANGO_POR_DEFECTO)
    setFechas(rangoRapido(RANGO_POR_DEFECTO))
    setEmpleado('')
  }, [open])

  const reporte = useMemo(
    () => REPORTES.find((item) => item.tipo === tipo) ?? REPORTES[0],
    [tipo]
  )

  const rangoInvertido = Boolean(
    fechas.fecha_inicio &&
    fechas.fecha_fin &&
    fechas.fecha_inicio > fechas.fecha_fin
  )
  const faltanFechas = !fechas.fecha_inicio || !fechas.fecha_fin

  const aplicarRangoRapido = (clave) => {
    setPeriodo(clave)
    setFechas(rangoRapido(clave))
  }

  const cambiarFecha = (campo, valor) => {
    setPeriodo('personalizado')
    setFechas((previas) => ({ ...previas, [campo]: valor }))
  }

  const handleDescargar = async () => {
    if (rangoInvertido || faltanFechas) return

    setDescargando(true)
    try {
      const { archivo } = await exportarReporte({
        tipo,
        fecha_inicio: fechas.fecha_inicio,
        fecha_fin: fechas.fecha_fin,
        empleado: empleado || undefined,
      })
      onExportado?.(archivo)
      onClose?.()
    } catch (err) {
      console.error('Error al exportar el reporte:', err)
      onError?.(
        err?.response?.data?.detail ||
        'No se pudo generar el reporte. Intenta de nuevo.'
      )
    } finally {
      setDescargando(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Exportar reporte" width={560}>
      <fieldset className={styles.bloque}>
        <legend className={styles.legend}>Reporte</legend>
        <div className={styles.opciones}>
          {REPORTES.map((item) => (
            <label
              key={item.tipo}
              className={`${styles.opcion} ${tipo === item.tipo ? styles.opcionActiva : ''}`}
            >
              <input
                type="radio"
                name="tipo-reporte"
                value={item.tipo}
                checked={tipo === item.tipo}
                onChange={() => setTipo(item.tipo)}
              />
              <span>
                <span className={styles.opcionTitulo}>{item.titulo}</span>
                <span className={styles.opcionDesc}>{item.descripcion}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className={styles.bloque}>
        <legend className={styles.legend}>Periodo</legend>
        <div className={styles.atajos}>
          {RANGOS_RAPIDOS.map((rango) => (
            <button
              key={rango.clave}
              type="button"
              className={`${styles.atajo} ${periodo === rango.clave ? styles.atajoActivo : ''}`}
              onClick={() => aplicarRangoRapido(rango.clave)}
            >
              {rango.etiqueta}
            </button>
          ))}
        </div>

        <div className={styles.fechas}>
          <label className={styles.campo}>
            <span>Desde</span>
            <input
              type="date"
              value={fechas.fecha_inicio ?? ''}
              max={fechas.fecha_fin || undefined}
              onChange={(e) => cambiarFecha('fecha_inicio', e.target.value)}
            />
          </label>
          <label className={styles.campo}>
            <span>Hasta</span>
            <input
              type="date"
              value={fechas.fecha_fin ?? ''}
              min={fechas.fecha_inicio || undefined}
              onChange={(e) => cambiarFecha('fecha_fin', e.target.value)}
            />
          </label>
        </div>

        {rangoInvertido && (
          <p className={styles.error} role="alert">
            La fecha inicial no puede ser posterior a la final.
          </p>
        )}
      </fieldset>

      {empleados.length > 0 && (
        <fieldset className={styles.bloque}>
          <legend className={styles.legend}>
            {reporte.filtro === 'tecnico' ? 'Técnico' : 'Empleado'}
          </legend>
          <select
            className={styles.select}
            value={empleado}
            onChange={(e) => setEmpleado(e.target.value)}
          >
            <option value="">Todos</option>
            {empleados.map((persona) => (
              <option key={persona.id} value={persona.id}>
                {persona.nombre_completo}
              </option>
            ))}
          </select>
        </fieldset>
      )}

      <p className={styles.nota}>
        Se descarga un archivo Excel (.xlsx) con una fila por persona y una
        fila de totales al final.
      </p>

      <ModalActions>
        <button
          type="button"
          className={styles.btnSecundario}
          onClick={onClose}
          disabled={descargando}
        >
          Cancelar
        </button>
        <button
          type="button"
          className={styles.btnPrimario}
          onClick={handleDescargar}
          disabled={descargando || rangoInvertido || faltanFechas}
        >
          {descargando
            ? <><Spinner size="sm" color="white" /> Generando...</>
            : 'Descargar Excel'}
        </button>
      </ModalActions>
    </Modal>
  )
}
