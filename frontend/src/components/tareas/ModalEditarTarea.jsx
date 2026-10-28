/**
 * components/tareas/ModalEditarTarea.jsx
 * ---------------------------------------------------------------------------
 * Modal para editar una tarea ya creada (PATCH /tareas/{id}).
 *
 * Envía únicamente los campos que realmente cambiaron, para no pisar datos
 * que el supervisor no tocó y para que el backend no revalide de más
 * (por ejemplo el límite de tareas activas del técnico).
 *
 * Aquí NO se cambia el técnico asignado. Había un segundo selector que hacía
 * lo mismo que "Reasignar", pero a ciegas: sin el mapa del servicio, sin decir
 * quién la lleva ahora y sin avisar cuando ya no queda nadie más a quien
 * pasársela. Tener las dos puertas obligaba además a elegir entre ellas sin
 * ninguna pista de que una estaba peor equipada. El técnico se muestra en
 * modo lectura y el botón lleva al flujo de reasignación, que es el completo.
 *
 * T6 del Sprint 10: la ubicación sí se edita aquí, con el mismo selector de
 * mapa de «Nueva tarea». El backend aceptaba `lat`/`lng` en este PATCH desde
 * SCRUM-170, pero la interfaz no los ofrecía: una tarea creada con la
 * coordenada mal puesta —o sin coordenada, porque el supervisor la escribió
 * con prisa— no se podía arreglar sin borrarla y volver a crearla, y con ella
 * se iban su historial y sus evidencias. El técnico, mientras tanto, veía el
 * pin en otra calle o no veía ninguno.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Modal, { ModalActions } from '../ui/Modal'
import SelectorUbicacionMapa from '../mapa/SelectorUbicacionMapa'
import { actualizarTarea } from '../../api/tareaService'
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
    // null y no '' cuando la tarea no tiene ubicación: el selector distingue
    // "sin punto" de "punto en el 0,0", que cae en el golfo de Guinea.
    lat:                tarea?.lat ?? null,
    lng:                tarea?.lng ?? null,
  }
}

export default function ModalEditarTarea({
  open,
  tarea,
  onClose,
  onGuardado,
  onReasignar,
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

  /**
   * Mapa ↔ dirección, igual que en «Nueva tarea».
   *
   * `direccion` llega como undefined mientras la geocodificación inversa sigue
   * en curso, o cuando el punto se movió sin que Nominatim devolviera texto:
   * en esos casos no se pisa lo que el supervisor ya tenía escrito.
   */
  const handleUbicacionCambiada = useCallback(({ lat, lng, direccion }) => {
    setForm((prev) => ({
      ...prev,
      lat,
      lng,
      direccion: direccion !== undefined ? direccion : prev.direccion,
    }))
    setError(null)
  }, [])

  if (!tarea) return null

  const handleChange = (campo, valor) => {
    setForm((prev) => ({ ...prev, [campo]: valor }))
    setError(null)
  }

  const quitarUbicacion = () => {
    // Las dos a null borran la coordenada en el backend (ver
    // `actualizarTarea`): el validador las exige como par.
    setForm((prev) => ({ ...prev, lat: null, lng: null }))
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
      if (campo === 'lat' || campo === 'lng') return
      const valor = campo === 'titulo' ? form[campo].trim() : form[campo]
      if (String(valor ?? '') !== String(inicial[campo] ?? '')) {
        cambios[campo] = valor
      }
    })

    // La coordenada va aparte porque es un par: el validador del backend
    // rechaza una lat sin su lng, y comparar campo a campo podía mandar solo
    // una cuando el punto se movía en una dirección casi recta y la otra
    // coordenada quedaba con el mismo valor redondeado.
    if (
      String(form.lat ?? '') !== String(inicial.lat ?? '')
      || String(form.lng ?? '') !== String(inicial.lng ?? '')
    ) {
      cambios.lat = form.lat
      cambios.lng = form.lng
    }

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
      // 409 desde la HU-S10-08: pasar la tarea a 'completado' sin evidencia
      // registrada. El motivo que manda el backend es el que hay que mostrar
      // —dice qué falta—, así que va en la misma rama que el 400.
      if (status === 400 || status === 404 || status === 409) {
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

      {/* T6: la ubicación, con el mismo selector de «Nueva tarea». Escribir la
          dirección mueve el pin y mover el pin rellena la dirección. */}
      <div className={styles.ubicacionCabecera}>
        <span className={styles.label}>Ubicación en el mapa</span>
        {form.lat != null && (
          <button
            type="button"
            className={styles.quitarUbicacion}
            onClick={quitarUbicacion}
            disabled={guardando}
          >
            Quitar ubicación
          </button>
        )}
      </div>
      <SelectorUbicacionMapa
        direccion={form.direccion}
        lat={form.lat}
        lng={form.lng}
        onCambiarUbicacion={handleUbicacionCambiada}
      />
      <p className={styles.ubicacionNota}>
        {form.lat == null
          ? 'Esta tarea no tiene ubicación: el técnico no la ve en su mapa. Toca el mapa para ponerle una.'
          : 'Toca el mapa o arrastra el pin para corregirla.'}
      </p>

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

      <span className={styles.label}>Técnico asignado</span>
      <div className={styles.tecnicoRow}>
        <span
          className={
            tarea.tecnico?.nombre ? styles.tecnicoNombre : styles.tecnicoSinAsignar
          }
        >
          {tarea.tecnico?.nombre ?? 'Sin asignar'}
        </span>

        {onReasignar && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => onReasignar(tarea)}
            disabled={guardando}
          >
            Reasignar…
          </button>
        )}
      </div>
      <p className={styles.tecnicoNota}>
        El cambio de técnico se hace desde “Reasignar”, que muestra la
        ubicación del servicio y la carga de cada uno.
      </p>

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
