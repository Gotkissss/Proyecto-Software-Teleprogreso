/**
 * pages/NuevaTareaPage.jsx
 * ---------------------------------------------------------------------------
 * Formulario para crear una nueva tarea/orden de servicio.
 * - Muestra cuántas tareas activas tiene cada técnico
 * - Deshabilita técnicos con 3 o más tareas activas
 * - Maneja errores del backend con mensajes claros
 * ---------------------------------------------------------------------------
 */

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { crearTarea, getTecnicosDisponibles } from '../api/tareaService'
import Spinner from '../components/ui/Spinner'
import styles from './NuevaTareaPage.module.css'

const PRIORIDADES = [
  { value: 'baja',    label: 'Baja' },
  { value: 'media',   label: 'Media' },
  { value: 'alta',    label: 'Alta' },
  { value: 'urgente', label: 'Urgente' },
]

const LIMITE_TAREAS = 3

const FORM_INICIAL = {
  titulo:             '',
  descripcion:        '',
  direccion:          '',
  prioridad:          'media',
  id_tecnico:         '',
  fecha_inicio:       '',
  fecha_finalizacion: '',
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
  return errores
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
        setTecnicos(await getTecnicosDisponibles())
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
      if (tec && tec.tareas_activas >= LIMITE_TAREAS) {
        setErrorServidor(
          `${tec.nombre_completo} ya tiene ${tec.tareas_activas} tareas activas. ` +
          `El límite es ${LIMITE_TAREAS}. Selecciona otro técnico.`
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

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <button
          className={styles.backBtn}
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
              Dirección del servicio <span className={styles.optional}>(opcional)</span>
            </label>
            <input
              type="text"
              className={styles.input}
              placeholder="Ej: Calle 15, Ave. Circunvalación, Zona 10"
              value={form.direccion}
              onChange={(e) => handleChange('direccion', e.target.value)}
              disabled={cargando}
            />
          </div>

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
                  const alLimite = (tec.tareas_activas ?? 0) >= LIMITE_TAREAS
                  return (
                    <option
                      key={tec.id}
                      value={tec.id}
                      disabled={alLimite}
                    >
                      {tec.nombre_completo}
                      {' — '}
                      {tec.tareas_activas ?? 0} tarea{tec.tareas_activas !== 1 ? 's' : ''} activa{tec.tareas_activas !== 1 ? 's' : ''}
                      {alLimite ? ' (límite alcanzado)' : ''}
                    </option>
                  )
                })}
              </select>
            )}

            {/* Info del técnico seleccionado */}
            {tecnicoSeleccionado && (() => {
              const activas = tecnicoSeleccionado.tareas_activas ?? 0
              if (activas >= LIMITE_TAREAS) {
                return (
                  <div className={`${styles.tecnicoInfo} ${styles.tecnicoInfoLimite}`}>
                    <span>⚠</span>
                    <span>
                      {tecnicoSeleccionado.nombre_completo} ya alcanzó el límite de {LIMITE_TAREAS} tareas activas.
                      Selecciona otro técnico.
                    </span>
                  </div>
                )
              }
              if (activas === LIMITE_TAREAS - 1) {
                return (
                  <div className={`${styles.tecnicoInfo} ${styles.tecnicoInfoAdvertencia}`}>
                    <span>ℹ</span>
                    <span>
                      {tecnicoSeleccionado.nombre_completo} tendrá {activas + 1} de {LIMITE_TAREAS} tareas activas
                      tras esta asignación.
                    </span>
                  </div>
                )
              }
              return (
                <div className={`${styles.tecnicoInfo} ${styles.tecnicoInfoOk}`}>
                  <span>✓</span>
                  <span>
                    {tecnicoSeleccionado.nombre_completo} tiene {activas} tarea{activas !== 1 ? 's' : ''} activa{activas !== 1 ? 's' : ''}.
                    Disponible para asignación.
                  </span>
                </div>
              )
            })()}
          </div>

          {/* ── Botones ── */}
          <div className={styles.formBtns}>
            <button
              type="button"
              className={styles.cancelBtn}
              onClick={() => navigate('/supervisor/reasignacion')}
              disabled={cargando}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className={styles.submitBtn}
              disabled={
                cargando ||
                (tecnicoSeleccionado && (tecnicoSeleccionado.tareas_activas ?? 0) >= LIMITE_TAREAS)
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