/**
 * components/tareas/ModalDetalleTarea.jsx
 * ---------------------------------------------------------------------------
 * Ficha completa de una tarea, en solo lectura.
 *
 * Existe porque la única forma de ver los datos de una tarea era abrir el
 * modal de edición, lo que obliga a entrar en modo escritura (y arriesgarse a
 * guardar algo sin querer) solo para consultar la dirección o la descripción.
 * Ahora se abre haciendo clic en la tarjeta, y las acciones (editar,
 * reasignar, ver evidencias) se ofrecen desde aquí.
 * ---------------------------------------------------------------------------
 */

import Badge from '../ui/Badge'
import Modal, { ModalActions } from '../ui/Modal'
import { PRIORIDAD_LABEL, variantePorPrioridad } from '../mapa/estadoColor'
import { describirVencimiento, formatearFecha } from '../../utils/vencimiento'
import styles from './ModalDetalleTarea.module.css'

const ESTADO_LABEL = {
  pendiente:   'Pendiente',
  en_progreso: 'En curso',
  completado:  'Completado',
  cancelado:   'Cancelado',
}

const ESTADO_VARIANT = {
  pendiente:   'warning',
  en_progreso: 'info',
  completado:  'success',
  cancelado:   'danger',
}

/** Una fila etiqueta/valor. Se omite entera si no hay dato que mostrar. */
function Dato({ label, children }) {
  if (children === null || children === undefined || children === '') return null
  return (
    <div className={styles.dato}>
      <span className={styles.datoLabel}>{label}</span>
      <span className={styles.datoValor}>{children}</span>
    </div>
  )
}

export default function ModalDetalleTarea({
  tarea,
  onClose,
  onEditar,
  onReasignar,
  onVerEvidencias,
}) {
  if (!tarea) return null

  const estado = tarea.estado_tarea ?? tarea.estado
  const prioridad = (tarea.prioridad ?? 'media').toLowerCase()
  const vencimiento = describirVencimiento(tarea)
  const evidencias = tarea.total_incidencias ?? 0

  return (
    <Modal open onClose={onClose} title={tarea.titulo} width={620}>
      <div className={styles.cuerpo}>
        <div className={styles.badges}>
          <Badge
            label={ESTADO_LABEL[estado] ?? estado}
            variant={ESTADO_VARIANT[estado] ?? 'muted'}
          />
          <Badge
            label={`Prioridad ${PRIORIDAD_LABEL[prioridad] ?? prioridad}`}
            variant={variantePorPrioridad(prioridad)}
          />
          {vencimiento && (
            <Badge label={vencimiento.texto} variant={vencimiento.variant} />
          )}
        </div>

        {tarea.descripcion ? (
          <p className={styles.descripcion}>{tarea.descripcion}</p>
        ) : (
          <p className={styles.sinDescripcion}>Esta tarea no tiene descripción.</p>
        )}

        <div className={styles.datos}>
          <Dato label="Técnico asignado">
            {tarea.tecnico?.nombre ?? tarea.tecnico?.nombre_completo ?? 'Sin asignar'}
          </Dato>
          <Dato label="Dirección">{tarea.direccion_servicio}</Dato>
          <Dato label="Asignada el">{formatearFecha(tarea.fecha_asignacion)}</Dato>
          <Dato label="Inicio previsto">{formatearFecha(tarea.fecha_inicio)}</Dato>
          <Dato label="Fecha límite">{formatearFecha(tarea.fecha_finalizacion)}</Dato>
          <Dato label="Evidencias">
            {evidencias > 0 ? `${evidencias} registrada(s)` : 'Ninguna'}
          </Dato>
          <Dato label="Identificador">#{tarea.id_tarea ?? tarea.id}</Dato>
        </div>
      </div>

      <ModalActions>
        {evidencias > 0 && onVerEvidencias && (
          <button
            type="button"
            className={styles.btnSecundario}
            onClick={() => onVerEvidencias(tarea)}
          >
            Ver evidencias
          </button>
        )}
        {onEditar && (
          <button
            type="button"
            className={styles.btnSecundario}
            onClick={() => onEditar(tarea)}
          >
            Editar
          </button>
        )}
        {onReasignar && (
          <button
            type="button"
            className={styles.btnPrimario}
            onClick={() => onReasignar(tarea)}
          >
            Reasignar
          </button>
        )}
      </ModalActions>
    </Modal>
  )
}
