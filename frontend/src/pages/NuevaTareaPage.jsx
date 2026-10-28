/**
 * pages/NuevaTareaPage.jsx
 * ---------------------------------------------------------------------------
 * Formulario para crear una nueva tarea/orden de servicio.
 * - Muestra cuántas tareas activas tiene cada técnico
 * - Deshabilita a los que ya alcanzaron el límite de carga. El límite lo envía
 *   el backend en `limite_tareas` (backend/app/core/reglas.py); aquí solo hay
 *   un valor de respaldo por si la respuesta no lo trae.
 * - Maneja errores del backend con mensajes claros
 * ---------------------------------------------------------------------------
 */

import { useCallback, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  LIMITE_TAREAS_FALLBACK,
  crearTarea,
  getTecnicosDisponibles,
} from '../api/tareaService'
import { estadoJornada, ordenarPorDisponibilidad } from '../utils/tecnicos'
import SelectorUbicacionMapa from '../components/mapa/SelectorUbicacionMapa'
import { hoyISO } from '../utils/fecha'
import Spinner from '../components/ui/Spinner'
import styles from './NuevaTareaPage.module.css'

const PRIORIDADES = [
  { value: 'baja',    label: 'Baja' },
  { value: 'media',   label: 'Media' },
  { value: 'alta',    label: 'Alta' },
  { value: 'urgente', label: 'Urgente' },
]

// Respaldo. El límite real llega en `limite_tareas` de cada técnico
// (lo publica GET /empleados/tecnicos/disponibles).
const LIMITE_TAREAS = LIMITE_TAREAS_FALLBACK

const FORM_INICIAL = {
  titulo:             '',
  descripcion:        '',
  direccion:          '',
  prioridad:          'media',
  id_tecnico:         '',
  fecha_inicio:       '',
  fecha_finalizacion: '',
  // SCRUM-171: ubicación exacta del servicio, fijada en el mapa. Es opcional;
  // si el supervisor no marca el punto, la tarea se crea solo con dirección.
  lat:                null,
  lng:                null,
}

function validar(form) {
  const errores = {}
  if (!form.titulo.trim())
    errores.titulo = 'El título es obligatorio.'
  else if (form.titulo.trim().length < 5)
    errores.titulo = 'El título debe tener al menos 5 caracteres.'
  if (!form.prioridad)
    errores.prioridad = 'Selecciona una prioridad.'
  if (
    form.fecha_inicio &&
    form.fecha_finalizacion &&
    form.fecha_inicio > form.fecha_finalizacion
  ) {
    errores.fecha_finalizacion =
      'La fecha límite no puede ser anterior a la de inicio.'
  }

  // RTF-01 / R2-5: dirección y ubicación eran las dos opcionales, así que la
  // tarea podía nacer sin saber dónde es el servicio: no aparecía en el mapa
  // del técnico —que es por donde se trabaja— y había que preguntar por chat.
  // Basta con una de las dos: un punto en el mapa dice dónde es igual de bien.
  if (!form.direccion.trim() && form.lat === null) {
    errores.direccion =
      'Escribe la dirección o marca el punto en el mapa: sin una de las dos, ' +
      'el técnico no sabe a dónde ir.'
  }

  return errores
}

/**
 * Avisos que NO impiden guardar: cosas que casi siempre son un error pero
 * que a veces se quieren a propósito.
 *
 * RTF-01 / R2-4: se podían crear tareas con fecha límite pasada y la tarea
 * nacía «Vencida hace 286 días» sin que nada lo dijera. Bloquearlo sin más
 * impediría registrar una tarea que de verdad venció la semana pasada, así
 * que se avisa y se deja decidir.
 */
export function avisosDeLaTarea(form, hoy = hoyISO()) {
  const avisos = []
  if (form.fecha_finalizacion && form.fecha_finalizacion < hoy) {
    avisos.push(
      'La fecha límite ya pasó: la tarea va a nacer vencida y generará una ' +
      'alerta en cuanto se guarde.'
    )
  }
  if (form.fecha_inicio && form.fecha_inicio < hoy) {
    avisos.push('La fecha de inicio ya pasó.')
  }
  return avisos
}

export default function NuevaTareaPage() {
  const navigate = useNavigate()

  const [form,          setForm]          = useState(FORM_INICIAL)
  const [errores,       setErrores]       = useState({})
  const [tocados,       setTocados]       = useState({})
  const [tecnicos,      setTecnicos]      = useState([])
  const [loadingTec,    setLoadingTec]    = useState(true)
  const [cargando,      setCargando]      = useState(false)
  const [errorServidor, setErrorServidor] = useState(null)
  const [exito,         setExito]         = useState(false)

  // Cargar técnicos con su conteo de tareas activas.
  // Se usa GET /empleados/tecnicos/disponibles (admin + supervisor) en vez de
  // GET /empleados?rol=tecnico, que es solo-admin y dejaba el selector vacío
  // cuando entraba un supervisor.
  useEffect(() => {
    const fetchTecnicos = async () => {
      setLoadingTec(true)
      try {
        // RTF-01 / R2-6: en jornada primero, luego los que ya salieron y
        // al final los que no marcaron entrada. El primero que se ofrecía
        // podía ser alguien que no había empezado el día.
        setTecnicos(ordenarPorDisponibilidad(await getTecnicosDisponibles()))
      } catch (err) {
        console.error('Error al cargar técnicos:', err)
        setErrorServidor(
          err?.response?.data?.detail ||
          'No se pudo cargar la lista de técnicos.'
        )
      } finally {
        setLoadingTec(false)
      }
    }
    fetchTecnicos()
  }, [])

  const handleChange = (campo, valor) => {
    setForm((prev) => ({ ...prev, [campo]: valor }))
    setErrorServidor(null)
    if (tocados[campo]) {
      const nuevosErrores = validar({ ...form, [campo]: valor })
      setErrores((prev) => ({ ...prev, [campo]: nuevosErrores[campo] || null }))
    }
  }

  const handleBlur = (campo) => {
    setTocados((prev) => ({ ...prev, [campo]: true }))
    const nuevosErrores = validar(form)
    setErrores((prev) => ({ ...prev, [campo]: nuevosErrores[campo] || null }))
  }

  /**
   * SCRUM-171 — Sincroniza mapa ↔ dirección (ver SelectorUbicacionMapa).
   *
   * `direccion` llega como undefined mientras la geocodificación inversa
   * sigue en curso, o cuando el punto se movió sin que Nominatim devolviera
   * un texto: en esos casos no se pisa lo que el supervisor ya escribió.
   */
  const handleUbicacionCambiada = useCallback(({ lat, lng, direccion }) => {
    setForm((prev) => ({
      ...prev,
      lat,
      lng,
      direccion: direccion !== undefined ? direccion : prev.direccion,
    }))
    setErrores((prev) => ({ ...prev, lat: null, lng: null }))
    setErrorServidor(null)
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()

    // Marcar todos como tocados
    const todosTocados = Object.keys(FORM_INICIAL).reduce(
      (acc, k) => ({ ...acc, [k]: true }), {}
    )
    setTocados(todosTocados)

    const erroresValidacion = validar(form)
    setErrores(erroresValidacion)
    if (Object.keys(erroresValidacion).length > 0) return

    // Validación del límite antes de llamar al backend
    if (form.id_tecnico) {
      const tec = tecnicos.find((t) => t.id === Number(form.id_tecnico))
      const limite = tec?.limite_tareas ?? LIMITE_TAREAS
      if (tec && tec.tareas_activas >= limite) {
        setErrorServidor(
          `${tec.nombre_completo} ya tiene ${tec.tareas_activas} tareas activas. ` +
          `El límite es ${limite}. Selecciona otro técnico.`
        )
        return
      }
    }

    setCargando(true)
    setErrorServidor(null)

    try {
      await crearTarea({
        titulo:             form.titulo.trim(),
        descripcion:        form.descripcion.trim() || null,
        direccion:          form.direccion.trim()   || null,
        prioridad:          form.prioridad,
        id_tecnico:         form.id_tecnico ? Number(form.id_tecnico) : null,
        fecha_inicio:       form.fecha_inicio       || null,
        fecha_finalizacion: form.fecha_finalizacion || null,
        lat:                form.lat,
        lng:                form.lng,
      })

      setExito(true)
      setTimeout(() => {
        navigate('/supervisor/reasignacion')
      }, 1800)

    } catch (err) {
      const status = err?.response?.status
      const detail = err?.response?.data?.detail

      if (status === 400 || status === 422) {
        if (Array.isArray(detail)) {
          // Errores de validación de Pydantic campo por campo
          const errBack = {}
          detail.forEach((d) => {
            const campo = d.loc?.[d.loc.length - 1]
            if (campo && campo in FORM_INICIAL) {
              errBack[campo] = d.msg || d.message
            }
          })
          if (Object.keys(errBack).length > 0) {
            setErrores((prev) => ({ ...prev, ...errBack }))
            return
          }
        }
        const msg = typeof detail === 'string' ? detail : ''
        if (msg.toLowerCase().includes('límite') || msg.toLowerCase().includes('limite')) {
          setErrorServidor(msg)
        } else {
          setErrorServidor(msg || 'Los datos enviados no son válidos.')
        }
      } else if (status === 403) {
        setErrorServidor('No tienes permisos para crear tareas.')
      } else if (status === 404) {
        setErrorServidor('El técnico seleccionado no fue encontrado.')
      } else {
        setErrorServidor('Error inesperado. Intenta de nuevo.')
      }
    } finally {
      setCargando(false)
    }
  }

  const campoError = (campo) => tocados[campo] && errores[campo]

  const tecnicoSeleccionado = form.id_tecnico
    ? tecnicos.find((t) => t.id === Number(form.id_tecnico))
    : null

  if (exito) {
    return (
      <div className={styles.exitoWrap}>
        <div className={styles.exitoIcono}>✓</div>
        <h2 className={styles.exitoTitulo}>¡Tarea creada!</h2>
        <p className={styles.exitoDesc}>Redirigiendo al panel de reasignación...</p>
      </div>
    )
  }

  // RTF-01 / R2-4: avisos que no impiden guardar (ver avisosDeLaTarea).
  const avisos = avisosDeLaTarea(form)

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <button
          className={`btn btn-secondary btn-sm ${styles.backBtn}`}
          onClick={() => navigate('/supervisor/reasignacion')}
          type="button"
        >
          ← Volver
        </button>
        <div>
          <h1 className={styles.title}>Nueva tarea</h1>
          <p className={styles.subtitle}>Completa los campos para crear una orden de servicio.</p>
        </div>
      </div>

      <div className={styles.card}>
        {errorServidor && (
          <div className={styles.errorBanner}>
            <span className={styles.errorBannerIcon}>⚠</span>
            <span>{errorServidor}</span>
          </div>
        )}

        <form className={styles.form} onSubmit={handleSubmit} noValidate>

          {/* ── Título ── */}
          <div className={styles.field}>
            <label className={styles.label}>
              Título <span className={styles.required}>*</span>
            </label>
            <input
              type="text"
              className={`${styles.input} ${campoError('titulo') ? styles.inputError : ''}`}
              placeholder="Ej: Reparación de señal - Local El Centro"
              value={form.titulo}
              onChange={(e) => handleChange('titulo', e.target.value)}
              onBlur={() => handleBlur('titulo')}
              disabled={cargando}
            />
            {campoError('titulo') && (
              <p className={styles.fieldError}>{errores.titulo}</p>
            )}
          </div>

          {/* ── Descripción ── */}
          <div className={styles.field}>
            <label className={styles.label}>
              Descripción <span className={styles.optional}>(opcional)</span>
            </label>
            <textarea
              className={styles.textarea}
              placeholder="Detalla el trabajo a realizar, condiciones del sitio, materiales necesarios..."
              rows={3}
              value={form.descripcion}
              onChange={(e) => handleChange('descripcion', e.target.value)}
              disabled={cargando}
            />
          </div>

          {/* ── Dirección ── */}
          <div className={styles.field}>
            <label className={styles.label}>
              Dirección del servicio{' '}
              {/* RTF-01 / R2-5: dirección O punto en el mapa, pero una de las
                  dos. Las dos decían «(opcional)» y la tarea nacía sin saber
                  dónde es el servicio. */}
              <span className={styles.optional}>(o marca el punto en el mapa)</span>
            </label>
            <input
              type="text"
              className={`${styles.input} ${errores.direccion ? styles.inputError : ''}`}
              placeholder="Ej: Calle 15, Ave. Circunvalación, Zona 10"
              value={form.direccion}
              onChange={(e) => handleChange('direccion', e.target.value)}
              onBlur={() => handleBlur('direccion')}
              disabled={cargando}
            />
            {errores.direccion && (
              <p className={styles.fieldError}>{errores.direccion}</p>
            )}
          </div>

          {/* ── Ubicación en el mapa (SCRUM-171) ──
              Va sincronizada con el campo de arriba: fijar el marcador
              rellena la dirección (geocodificación inversa) y escribir una
              dirección mueve el marcador (geocodificación directa). El
              técnico recibe así coordenadas exactas y no solo un texto. */}
          <div className={styles.field}>
            <label className={styles.label}>
              Ubicación en el mapa{' '}
              <span className={styles.optional}>(o escribe la dirección)</span>
            </label>
            <SelectorUbicacionMapa
              direccion={form.direccion}
              lat={form.lat}
              lng={form.lng}
              onCambiarUbicacion={handleUbicacionCambiada}
              disabled={cargando}
              error={errores.lat || errores.lng || null}
            />
          </div>

          {/* RTF-01 / R2-4: la tarea podía nacer «Vencida hace 286 días» sin
              que nada lo dijera. Es un aviso y no un error: registrar una
              tarea que de verdad venció la semana pasada es legítimo. */}
          {avisos.length > 0 && (
            <div className={styles.avisoFechas} role="status">
              {avisos.map((aviso) => (
                <p key={aviso}>{aviso}</p>
              ))}
            </div>
          )}

          {/* ── Fechas ──
              La fecha límite es la que usa el sistema de alertas para marcar
              una tarea como vencida; sin ella nunca se genera esa alerta. */}
          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label className={styles.label}>
                Fecha de inicio <span className={styles.optional}>(opcional)</span>
              </label>
              <input
                type="date"
                className={styles.input}
                value={form.fecha_inicio}
                onChange={(e) => handleChange('fecha_inicio', e.target.value)}
                disabled={cargando}
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label}>
                Fecha límite <span className={styles.optional}>(opcional)</span>
              </label>
              <input
                type="date"
                className={`${styles.input} ${campoError('fecha_finalizacion') ? styles.inputError : ''}`}
                value={form.fecha_finalizacion}
                onChange={(e) => handleChange('fecha_finalizacion', e.target.value)}
                onBlur={() => handleBlur('fecha_finalizacion')}
                disabled={cargando}
              />
              {campoError('fecha_finalizacion') && (
                <p className={styles.fieldError}>{errores.fecha_finalizacion}</p>
              )}
            </div>
          </div>

          {/* ── Prioridad ── */}
          <div className={styles.field}>
            <label className={styles.label}>
              Prioridad <span className={styles.required}>*</span>
            </label>
            <div className={styles.prioridadGroup}>
              {PRIORIDADES.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  className={`${styles.prioridadBtn} ${form.prioridad === p.value ? styles.prioridadBtnActive : ''} ${styles[`prio_${p.value}`]}`}
                  onClick={() => handleChange('prioridad', p.value)}
                  disabled={cargando}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {campoError('prioridad') && (
              <p className={styles.fieldError}>{errores.prioridad}</p>
            )}
          </div>

          {/* ── Técnico asignado ── */}
          <div className={styles.field}>
            <label className={styles.label}>
              Asignar técnico <span className={styles.optional}>(opcional)</span>
            </label>

            {loadingTec ? (
              <div className={styles.loadingTec}>
                <Spinner size="sm" /> Cargando técnicos...
              </div>
            ) : (
              <select
                className={`${styles.select} ${campoError('id_tecnico') ? styles.inputError : ''}`}
                value={form.id_tecnico}
                onChange={(e) => {
                  handleChange('id_tecnico', e.target.value)
                  setErrorServidor(null)
                }}
                disabled={cargando}
              >
                <option value="">Sin asignar por ahora</option>
                {tecnicos.map((tec) => {
                  const alLimite =
                    (tec.tareas_activas ?? 0) >= (tec.limite_tareas ?? LIMITE_TAREAS)
                  return (
                    <option
                      key={tec.id}
                      value={tec.id}
                      disabled={alLimite}
                    >
                      {tec.nombre_completo}
                      {' — '}
                      {tec.tareas_activas ?? 0} tarea{tec.tareas_activas !== 1 ? 's' : ''} activa{tec.tareas_activas !== 1 ? 's' : ''}
                      {/* RTF-01 / R2-6: el estado de la jornada, en la propia
                          opción, para no tener que seleccionar a cada uno
                          para enterarse. */}
                      {` · ${estadoJornada(tec)}`}
                      {alLimite ? ' (límite alcanzado)' : ''}
                    </option>
                  )
                })}
              </select>
            )}

            {/* Info del técnico seleccionado */}
            {tecnicoSeleccionado && (() => {
              const activas = tecnicoSeleccionado.tareas_activas ?? 0
              const limite = tecnicoSeleccionado.limite_tareas ?? LIMITE_TAREAS
              if (activas >= limite) {
                return (
                  <div className={`${styles.tecnicoInfo} ${styles.tecnicoInfoLimite}`}>
                    <span>⚠</span>
                    <span>
                      {tecnicoSeleccionado.nombre_completo} ya alcanzó el límite de {limite} tareas activas.
                      Selecciona otro técnico.
                    </span>
                  </div>
                )
              }
              if (activas === limite - 1) {
                return (
                  <div className={`${styles.tecnicoInfo} ${styles.tecnicoInfoAdvertencia}`}>
                    <span>ℹ</span>
                    <span>
                      {tecnicoSeleccionado.nombre_completo} tendrá {activas + 1} de {limite} tareas activas
                      tras esta asignación.
                    </span>
                  </div>
                )
              }
              // RTF-01 / R2-6: «Disponible para asignación» solo quería decir
              // «no llegó a su límite de tareas», y se mostraba igual a quien
              // no había marcado entrada. Asignarle trabajo a alguien que no
              // empezó su jornada no es un error del sistema, pero el
              // supervisor tiene que saberlo antes de hacerlo.
              const carga =
                `${tecnicoSeleccionado.nombre_completo} tiene ${activas} ` +
                `tarea${activas !== 1 ? 's' : ''} activa${activas !== 1 ? 's' : ''}.`

              if (!tecnicoSeleccionado.marco_entrada) {
                return (
                  <div className={`${styles.tecnicoInfo} ${styles.tecnicoInfoAdvertencia}`}>
                    <span>ℹ</span>
                    <span>{carga} No ha marcado entrada hoy: no podrá iniciarla hasta que lo haga.</span>
                  </div>
                )
              }

              if (!tecnicoSeleccionado.en_jornada) {
                return (
                  <div className={`${styles.tecnicoInfo} ${styles.tecnicoInfoAdvertencia}`}>
                    <span>ℹ</span>
                    <span>{carga} Ya cerró su jornada de hoy.</span>
                  </div>
                )
              }

              return (
                <div className={`${styles.tecnicoInfo} ${styles.tecnicoInfoOk}`}>
                  <span>✓</span>
                  <span>{carga} En jornada ahora mismo.</span>
                </div>
              )
            })()}
          </div>

          {/* ── Botones ── */}
          <div className={styles.formBtns}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => navigate('/supervisor/reasignacion')}
              disabled={cargando}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={
                cargando ||
                (tecnicoSeleccionado &&
                  (tecnicoSeleccionado.tareas_activas ?? 0) >=
                    (tecnicoSeleccionado.limite_tareas ?? LIMITE_TAREAS))
              }
            >
              {cargando
                ? <><Spinner size="sm" color="white" /> Creando tarea...</>
                : 'Crear tarea'}
            </button>
          </div>

        </form>
      </div>
    </div>
  )
}