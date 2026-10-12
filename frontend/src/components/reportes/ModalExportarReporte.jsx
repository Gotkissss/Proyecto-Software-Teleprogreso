/**
 * components/reportes/ModalExportarReporte.jsx
 * ---------------------------------------------------------------------------
 * Diálogo de descarga de reportes en Excel, abierto desde la pantalla de
 * reportes (HU-S9-04).
 *
 * Antes vivía en el panel del supervisor y volvía a pedir fechas y persona.
 * Ahora el archivo sale con los MISMOS filtros que la pantalla está
 * mostrando (rango y, si hay una seleccionada, la persona): lo único que se
 * elige aquí es qué reporte bajar. Así lo que se descarga es lo que se ve.
 * ---------------------------------------------------------------------------
 */
import { useEffect, useState } from 'react'
import Modal, { ModalActions } from '../ui/Modal'
import Spinner from '../ui/Spinner'
import { REPORTES, exportarReporte } from '../../utils/exportarReportes'
import { textoRango } from '../../utils/reportes'
import styles from './ModalExportarReporte.module.css'

/**
 * @param {Object} props
 * @param {boolean} props.open
 * @param {Function} props.onClose
 * @param {{fecha_inicio:string, fecha_fin:string}} props.filtros - rango de la pantalla
 * @param {{id:number, nombre:string}|null} [props.empleado] - persona seleccionada, si hay
 * @param {Function} [props.onExportado] - recibe el nombre del archivo
 * @param {Function} [props.onError] - recibe el mensaje
 */
export default function ModalExportarReporte({
  open,
  onClose,
  filtros,
  empleado = null,
  onExportado,
  onError,
}) {
  const [tipo, setTipo] = useState(REPORTES[0].tipo)
  const [descargando, setDescargando] = useState(false)

  // Al reabrir vuelve al resumen: es el reporte que más se pide.
  useEffect(() => {
    if (open) setTipo(REPORTES[0].tipo)
  }, [open])

  const handleDescargar = async () => {
    setDescargando(true)
    try {
      const { archivo } = await exportarReporte({
        tipo,
        fecha_inicio: filtros.fecha_inicio,
        fecha_fin: filtros.fecha_fin,
        empleado: empleado?.id,
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
      <dl className={styles.filtros}>
        <dt>Periodo</dt>
        <dd>{textoRango(filtros)}</dd>
        <dt>Persona</dt>
        <dd>{empleado ? empleado.nombre : 'Toda la plantilla'}</dd>
      </dl>

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

      <p className={styles.nota}>
        Se descarga un archivo Excel (.xlsx) con los filtros que tienes en la
        pantalla: una fila por persona y una fila de totales al final. Para
        otro periodo, cámbialo en la pantalla antes de exportar.
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
          disabled={descargando}
        >
          {descargando
            ? <><Spinner size="sm" color="white" /> Generando...</>
            : 'Descargar Excel'}
        </button>
      </ModalActions>
    </Modal>
  )
}
