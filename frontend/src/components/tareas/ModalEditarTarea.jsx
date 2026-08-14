/**
 * components/tareas/ModalEditarTarea.jsx
 * ---------------------------------------------------------------------------
 * Modal para editar una tarea ya creada (PATCH /tareas/{id}).
 *
 * Envía únicamente los campos que realmente cambiaron, para no pisar datos
 * que el supervisor no tocó y para que el backend no revalide de más
 * (por ejemplo el límite de tareas activas del técnico).
 * ---------------------------------------------------------------------------
 */

import { useEffect, useMemo, useState } from 'react'
import Modal, { ModalActions } from '../ui/Modal'
import { LIMITE_TAREAS_FALLBACK, actualizarTarea } from '../../api/tareaService'
import styles from './ModalEditarTarea.module.css'

const PRIORIDADES = [
  { value: 'baja',    label: 'Baja' },
  { value: 'media',   label: 'Media' },
  { value: 'alta',    label: 'Alta' },
  { value: 'urgente', label: 'Urgente' },
]

const ESTADOS = [
  { value: 'pendiente',   label: 'Pendiente' },
  { value: 'en_progreso', label: 'En progreso' },
  { value: 'completado',  label: 'Completado' },
  { value: 'cancelado',   label: 'Cancelado' },
]

// Respaldo. El límite real llega en `limite_tareas` de cada técnico.
const LIMITE_TAREAS = LIMITE_TAREAS_FALLBACK

/** Convierte la tarea del backend al estado del formulario. */
function tareaAFormulario(tarea) {
  return {
    titulo:             tarea?.titulo ?? '',
    descripcion:        tarea?.descripcion ?? '',
    direccion:          tarea?.direccion_servicio ?? '',
    prioridad:          tarea?.prioridad ?? 'media',
    estado:             tarea?.estado_tarea ?? 'pendiente',
    fecha_inicio:       tarea?.fecha_inicio ?? '',
    fecha_finalizacion: tarea?.fecha_finalizacion ?? '',
    id_tecnico:         tarea?.tecnico?.id_empleado ?? '',
  }
}

export default function ModalEditarTarea({
  open,
  tarea,
  tecnicos = [],
  onClose,
  onGuardado,
}) {
  const [form, setForm]         = useState(() => tareaAFormulario(tarea))
  const [error, setError]       = useState(null)
  const [guardando, setGuardando] = useState(false)

  // Cada vez que se abre con otra tarea se reinicia el formulario.
  const inicial = useMemo(() => tareaAFormulario(tarea), [tarea])

  useEffect(() => {
    setForm(inicial)
    setError(null)
  }, [inicial, open])

  if (!tarea) return null

  const handleChange = (campo, valor) => {
    setForm((prev) => ({ ...prev, [campo]: valor }))
    setError(null)
  }

  const handleGuardar = async () => {
    if (!form.titulo.trim()) {
      setError('El título es obligatorio.')
      return
    }
    if (form.titulo.trim().length < 5) {
      setError('El título debe tener al menos 5 caracteres.')
      return
    }
    if (
      form.fecha_inicio &&
      form.fecha_finalizacion &&
      form.fecha_inicio > form.fecha_finalizacion
    ) {
      setError('La fecha de inicio no puede ser posterior a la de finalización.')
      return
    }

    // Solo lo que cambió respecto al valor original.
    const cambios = {}
    Object.keys(inicial).forEach((campo) => {
      const valor = campo === 'titulo' ? form[campo].trim() : form[campo]
      if (String(valor ?? '') !== String(inicial[campo] ?? '')) {
        cambios[campo] = valor
      }
    })

    if (Object.keys(cambios).length === 0) {
      onClose?.()
      return
    }

    setGuardando(true)
    setError(null)
    try {
      const actualizada = await actualizarTarea(tarea.id_tarea, cambios)
      onGuardado?.(actualizada)
      onClose?.()
    } catch (err) {
      const status = err?.response?.status
      const detail = err?.response?.data?.detail
      if (status === 400 || status === 404) {
        setError(detail || 'No se pudo guardar la tarea. Revisa los datos.')
      } else if (status === 403) {
        setError(detail || 'Tu rol no tiene permiso para editar tareas.')
      } else {
        setError('Error inesperado al guardar. Inténtalo de nuevo.')
      }
      console.error('Error al editar la tarea:', err)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Editar tarea" width={560}>
      {error && (
        <div className={styles.error}>
          <span className={styles.errorIcon}>⚠</span>
          <span>{error}</span>
        </div>
      )}

      <label className={styles.label} htmlFor="edit-titulo">Título *</label>
      <input
        id="edit-titulo"
        className={styles.input}
        value={form.titulo}
        onChange={(e) => handleChange('titulo', e.target.value)}
        placeholder="Instalación fibra óptica — Residencial…"
      />

      <label className={styles.label} htmlFor="edit-desc">Descripción</label>
      <textarea
        id="edit-desc"
        className={styles.textarea}
        rows={3}
        value={form.descripcion}
        onChange={(e) => handleChange('descripcion', e.target.value)}
      />

      <label className={styles.label} htmlFor="edit-dir">Dirección del servicio</label>
      <input
        id="edit-dir"
        className={styles.input}
        value={form.direccion}
        onChange={(e) => handleChange('direccion', e.target.value)}
      />

      <div className={styles.row}>
        <div className={styles.col}>
          <label className={styles.label} htmlFor="edit-prio">Prioridad</label>
          <select
            id="edit-prio"
            className={styles.select}
            value={form.prioridad}
            onChange={(e) => handleChange('prioridad', e.target.value)}
          >
            {PRIORIDADES.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>

        <div className={styles.col}>
          <label className={styles.label} htmlFor="edit-estado">Estado</label>
          <select
            id="edit-estado"
            className={styles.select}
            value={form.estado}
            onChange={(e) => handleChange('estado', e.target.value)}
          >
            {ESTADOS.map((e) => (
              <option key={e.value} value={e.value}>{e.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className={styles.row}>
        <div className={styles.col}>
          <label className={styles.label} htmlFor="edit-ini">Fecha de inicio</label>
          <input
            id="edit-ini"
            type="date"
            className={styles.input}
            value={form.fecha_inicio ?? ''}
            onChange={(e) => handleChange('fecha_inicio', e.target.value)}
          />
        </div>
        <div className={styles.col}>
          <label className={styles.label} htmlFor="edit-fin">Fecha de finalización</label>
          <input
            id="edit-fin"
            type="date"
            className={styles.input}
            value={form.fecha_finalizacion ?? ''}
            onChange={(e) => handleChange('fecha_finalizacion', e.target.value)}
          />
        </div>
      </div>

      <label className={styles.label} htmlFor="edit-tec">Técnico asignado</label>
      <select
        id="edit-tec"
        className={styles.select}
        value={form.id_tecnico ?? ''}
        onChange={(e) => handleChange('id_tecnico', e.target.value)}
      >
        <option value="">Sin asignar</option>
        {tecnicos.map((tec) => {
          const esActual = tec.id === inicial.id_tecnico
          const alLimite =
            !esActual &&
            (tec.tareas_activas ?? 0) >= (tec.limite_tareas ?? LIMITE_TAREAS)
          return (
            <option key={tec.id} value={tec.id} disabled={alLimite}>
              {tec.nombre_completo} — {tec.tareas_activas ?? 0} activa
              {tec.tareas_activas === 1 ? '' : 's'}
              {alLimite ? ' (límite alcanzado)' : ''}
            </option>
          )
        })}
      </select>

      <ModalActions>
        <button className={styles.cancelBtn} onClick={onClose} disabled={guardando}>
          Cancelar
        </button>
        <button className={styles.saveBtn} onClick={handleGuardar} disabled={guardando}>
          {guardando ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </ModalActions>
    </Modal>
  )
}
