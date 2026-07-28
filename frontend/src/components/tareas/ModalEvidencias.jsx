/**
 * components/tareas/ModalEvidencias.jsx
 * ---------------------------------------------------------------------------
 * SCRUM-141 / SCRUM-142
 *
 * Vista del supervisor para revisar las evidencias que dejó el técnico al
 * completar una tarea: descripción, foto y fecha de cada registro.
 *
 * Consume GET /tareas/{id}/incidencias. El supervisor y el admin pueden además
 * eliminar una evidencia (el técnico no, por diseño del backend).
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from 'react'
import Modal from '../ui/Modal'
import PageState from '../ui/PageState'
import { useToast } from '../ui/Toast'
import { urlArchivo } from '../../api/client'
import { eliminarIncidencia, getIncidencias } from '../../api/incidenciaService'
import styles from './ModalEvidencias.module.css'

const IconSinFoto = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21 15 16 10 5 21" />
  </svg>
)

const IconBasura = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
  </svg>
)

/** "2026-07-28T16:30:00" → "28 jul 2026, 16:30" */
function formatearFechaHora(iso) {
  if (!iso) return '—'
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return iso
  return fecha.toLocaleString('es-GT', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function ModalEvidencias({
  open,
  tarea,
  onClose,
  puedeEliminar = false,
  onCambio,
}) {
  const toast = useToast()
  const [evidencias, setEvidencias] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [eliminando, setEliminando] = useState(null)

  const idTarea = tarea?.id_tarea ?? tarea?.id_servicio ?? tarea?.id

  const fetchEvidencias = useCallback(async () => {
    if (!idTarea) return
    setLoading(true)
    setError(null)
    try {
      setEvidencias(await getIncidencias(idTarea))
    } catch (err) {
      setError(
        err?.response?.data?.detail || 'No se pudieron cargar las evidencias.',
      )
      console.error('Error al cargar evidencias:', err)
    } finally {
      setLoading(false)
    }
  }, [idTarea])

  useEffect(() => {
    if (open) fetchEvidencias()
  }, [open, fetchEvidencias])

  const handleEliminar = async (idIncidencia) => {
    setEliminando(idIncidencia)
    try {
      await eliminarIncidencia(idTarea, idIncidencia)
      setEvidencias((prev) => prev.filter((e) => e.id_incidencia !== idIncidencia))
      toast.success('Evidencia eliminada.')
      onCambio?.(idTarea)
    } catch (err) {
      toast.error(
        err?.response?.data?.detail || 'No se pudo eliminar la evidencia.',
      )
      console.error('Error al eliminar la evidencia:', err)
    } finally {
      setEliminando(null)
    }
  }

  if (!tarea) return null

  return (
    <Modal open={open} onClose={onClose} title="Evidencias de la tarea" width={620}>
      <p className={styles.tarea}>{tarea.titulo ?? tarea.nombre}</p>

      {loading || error || evidencias.length === 0 ? (
        <PageState
          loading={loading}
          loadingLabel="Cargando evidencias..."
          error={error}
          onRetry={fetchEvidencias}
          errorTitle="No se pudieron cargar las evidencias"
          empty
          emptyIcon={<IconSinFoto />}
          emptyTitle="Sin evidencias registradas"
          emptyDescription="El técnico aún no ha adjuntado evidencia de esta tarea."
        />
      ) : (
        <ul className={styles.lista}>
          {evidencias.map((evidencia) => {
            const foto = urlArchivo(evidencia.foto_evidencia)
            const enProceso = eliminando === evidencia.id_incidencia

            return (
              <li key={evidencia.id_incidencia} className={styles.item}>
                {foto ? (
                  // Se abre en pestaña nueva para verla a tamaño completo sin
                  // montar un visor propio.
                  <a
                    href={foto}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.fotoLink}
                    title="Ver la foto a tamaño completo"
                  >
                    <img src={foto} alt="Evidencia de la tarea" className={styles.foto} />
                  </a>
                ) : (
                  <div className={styles.sinFoto}>
                    <IconSinFoto />
                    <span>Sin foto adjunta</span>
                  </div>
                )}

                <div className={styles.cuerpo}>
                  <span className={styles.fecha}>
                    {formatearFechaHora(evidencia.fecha_reporte)}
                  </span>
                  <p className={styles.descripcion}>
                    {evidencia.descripcion || 'Sin descripción.'}
                  </p>

                  {puedeEliminar && (
                    <button
                      className={styles.eliminarBtn}
                      onClick={() => handleEliminar(evidencia.id_incidencia)}
                      disabled={enProceso}
                    >
                      <IconBasura />
                      {enProceso ? 'Eliminando…' : 'Eliminar'}
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Modal>
  )
}
