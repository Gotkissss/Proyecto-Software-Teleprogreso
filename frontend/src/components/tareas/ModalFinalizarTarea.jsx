/**
 * components/tareas/ModalFinalizarTarea.jsx
 * ---------------------------------------------------------------------------
 * SCRUM-139 / SCRUM-140
 *
 * Modal con el que el técnico cierra una tarea dejando constancia de lo
 * realizado: una descripción y una foto de evidencia (obligatoria).
 *
 * La foto se valida en el navegador antes de enviarla (extensión y tamaño,
 * con las mismas reglas del backend) para no gastar una subida por datos
 * móviles que va a rebotar igual.
 *
 * HU-5: al cerrar se envía también la posición del técnico, para que el
 * lugar del cierre quede en su recorrido. `posicionRespaldo` es la última
 * posición conocida, por si la lectura nueva del GPS no llega a tiempo.
 *
 * HU-S10-07: el técnico puede anotar los materiales que usó (opcional); se
 * descuentan del inventario al cerrar. Si el cierre falla después de guardar
 * la evidencia (por ejemplo, falta stock), la evidencia no se vuelve a crear:
 * se corrigen los materiales y se reintenta solo el cierre.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useRef, useState } from 'react'
import Modal, { ModalActions } from '../ui/Modal'
import Spinner from '../ui/Spinner'
import { useToast } from '../ui/Toast'
import {
  ACCEPT_FOTO,
  MAX_FOTO_MB,
  MIN_DESCRIPCION,
  finalizarTareaConEvidencia,
  validarFoto,
} from '../../api/incidenciaService'
import { getMaterialesParaConsumo } from '../../api/inventarioService'
import { obtenerPosicionActual } from '../../utils/posicionActual'
import {
  borrarBorrador,
  guardarBorrador,
  leerBorrador,
} from '../../utils/borradorTarea'
import styles from './ModalFinalizarTarea.module.css'

const IconCamara = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
    <circle cx="12" cy="13" r="4" />
  </svg>
)

const IconBasura = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
  </svg>
)

export default function ModalFinalizarTarea({
  open,
  servicio,
  onClose,
  onFinalizada,
  posicionRespaldo = null,
}) {
  const toast = useToast()
  const inputFoto = useRef(null)

  const [descripcion, setDescripcion] = useState('')
  const [foto, setFoto] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [errores, setErrores] = useState({})
  const [guardando, setGuardando] = useState(false)
  // Lo que había escrito antes de que se le cayera la sesión (HU-S9-05).
  const [recuperado, setRecuperado] = useState(null)
  // HU-S10-07: materiales usados [{id_material, nombre, unidad, cantidad}].
  const [materiales, setMateriales] = useState([])
  const [mostrarMateriales, setMostrarMateriales] = useState(false)
  // La lista se pide solo si el técnico abre la sección: la mayoría de los
  // cierres no usa material y no tiene por qué pagar esa consulta.
  const [disponibles, setDisponibles] = useState(null)
  const [seleccion, setSeleccion] = useState({ id: '', cantidad: '1' })
  // La evidencia que ya se guardó si el último intento falló en el cierre.
  const [evidenciaGuardada, setEvidenciaGuardada] = useState(null)

  // Al abrirlo con otra tarea se limpia todo... salvo lo que el técnico ya
  // había escrito para ESTA tarea y no llegó a enviarse. El informe son varias
  // líneas escritas de pie y con una mano: perderlo por un 401 significa
  // volver a escribirlo de memoria.
  useEffect(() => {
    if (!open) return

    const borrador = leerBorrador(servicio?.id_servicio)
    setDescripcion(borrador?.descripcion ?? '')
    setRecuperado(borrador)
    setMateriales(borrador?.materiales ?? [])
    setMostrarMateriales((borrador?.materiales ?? []).length > 0)
    setSeleccion({ id: '', cantidad: '1' })
    setEvidenciaGuardada(null)
    setFoto(null)
    setErrores({})
    setGuardando(false)
  }, [open, servicio?.id_servicio])

  // La lista de materiales, la primera vez que se abre la sección.
  useEffect(() => {
    if (!open || !mostrarMateriales || disponibles !== null) return
    let vigente = true
    getMaterialesParaConsumo()
      .then((lista) => vigente && setDisponibles(lista))
      .catch((err) => {
        console.error('No se pudo cargar la lista de materiales:', err)
        if (vigente) {
          setDisponibles([])
          setErrores((p) => ({ ...p, materiales: 'No se pudo cargar la lista de materiales.' }))
        }
      })
    return () => {
      vigente = false
    }
  }, [open, mostrarMateriales, disponibles])

  // Se guarda en cada cambio y no al cerrar: si lo que se lleva la sesión por
  // delante es la pestaña entera, no hay ningún "al cerrar" que ejecutar.
  useEffect(() => {
    if (!open || !servicio?.id_servicio) return
    guardarBorrador(servicio.id_servicio, {
      descripcion,
      nombreFoto: foto?.name ?? null,
      materiales,
    })
  }, [open, servicio?.id_servicio, descripcion, foto, materiales])

  // La preview usa una URL de objeto que hay que revocar para no filtrar
  // memoria cada vez que el técnico cambia de foto.
  useEffect(() => {
    if (!foto) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(foto)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [foto])

  if (!servicio) return null

  const handleFoto = (evento) => {
    const archivo = evento.target.files?.[0] ?? null

    // Cancelar el selector dispara un change sin archivos. Si aquí se siguiera
    // adelante, se borraría la foto que el técnico ya había elegido antes.
    if (!archivo) return

    const error = validarFoto(archivo)

    if (error) {
      setFoto(null)
      setErrores((prev) => ({ ...prev, foto: error }))
      // Se limpia el input para que volver a elegir el mismo archivo dispare
      // el onChange otra vez.
      evento.target.value = ''
      return
    }

    setFoto(archivo)
    setErrores((prev) => ({ ...prev, foto: null }))
  }

  const quitarFoto = () => {
    setFoto(null)
    if (inputFoto.current) inputFoto.current.value = ''
  }

  const agregarMaterial = () => {
    const material = (disponibles ?? []).find((m) => String(m.id_activo) === seleccion.id)
    const cantidad = Number(seleccion.cantidad)
    if (!material) {
      setErrores((p) => ({ ...p, materiales: 'Elige un material de la lista.' }))
      return
    }
    if (!Number.isInteger(cantidad) || cantidad < 1) {
      setErrores((p) => ({ ...p, materiales: 'La cantidad tiene que ser un número entero mayor que 0.' }))
      return
    }
    // El mismo material dos veces se suma en una sola línea.
    setMateriales((prev) => {
      const existente = prev.find((m) => m.id_material === material.id_activo)
      if (existente) {
        return prev.map((m) =>
          m.id_material === material.id_activo ? { ...m, cantidad: m.cantidad + cantidad } : m
        )
      }
      return [
        ...prev,
        {
          id_material: material.id_activo,
          nombre: material.nombre_activo,
          unidad: material.unidad_medida ?? '',
          cantidad,
        },
      ]
    })
    setSeleccion({ id: '', cantidad: '1' })
    setErrores((p) => ({ ...p, materiales: null }))
  }

  const quitarMaterial = (idMaterial) =>
    setMateriales((prev) => prev.filter((m) => m.id_material !== idMaterial))

  const validar = () => {
    // La descripción y la foto ya se guardaron en el intento anterior.
    if (evidenciaGuardada) {
      setErrores({})
      return true
    }

    const nuevos = {}
    const texto = descripcion.trim()

    if (!texto) {
      nuevos.descripcion = 'Describe brevemente lo que realizaste.'
    } else if (texto.length < MIN_DESCRIPCION) {
      nuevos.descripcion = `La descripción debe tener al menos ${MIN_DESCRIPCION} caracteres.`
    }

    const errorFoto = validarFoto(foto)
    if (errorFoto) nuevos.foto = errorFoto

    setErrores(nuevos)
    return Object.keys(nuevos).length === 0
  }

  const handleGuardar = async () => {
    if (!validar()) return

    setGuardando(true)
    try {
      // HU-5: nunca bloquea el cierre; sin GPS llega null y la tarea se
      // cierra igual, solo que sin punto en el recorrido.
      const posicion = await obtenerPosicionActual({ respaldo: posicionRespaldo })
      const incidencia = await finalizarTareaConEvidencia(servicio.id_servicio, {
        descripcion: descripcion.trim(),
        foto,
        posicion,
        // Solo si hay: sin materiales el cierre es exactamente el de antes.
        ...(materiales.length ? { materiales } : {}),
        ...(evidenciaGuardada ? { evidenciaGuardada } : {}),
      })
      // Enviado: el borrador ya no sirve y reofrecerlo luego sería confuso.
      borrarBorrador(servicio.id_servicio)
      setRecuperado(null)
      toast.success('Tarea finalizada y evidencia registrada.')
      onFinalizada?.(servicio.id_servicio, incidencia)
      onClose?.()
    } catch (err) {
      const status = err?.response?.status
      const detail = err?.response?.data?.detail
      if (err?.evidenciaGuardada) setEvidenciaGuardada(err.evidenciaGuardada)

      if (err?.evidenciaGuardada && status === 409) {
        // Lo más probable: faltó stock de algún material. La evidencia ya
        // quedó; basta corregir los materiales y volver a pulsar Finalizar.
        setErrores({
          general:
            `${detail || 'No se pudo cerrar la tarea.'} La evidencia ya quedó guardada: ` +
            'corrige los materiales y vuelve a pulsar Finalizar.',
        })
      } else if (status === 403) {
        setErrores({ general: detail || 'Solo el técnico asignado puede finalizar esta tarea.' })
      } else if (status === 400 || status === 404 || status === 409 || status === 422) {
        setErrores({ general: detail || 'No se pudo registrar la evidencia. Revisa los datos.' })
      } else if (!err?.response) {
        setErrores({
          general:
            'No se pudo contactar al servidor. La tarea sigue abierta, ' +
            'inténtalo de nuevo cuando tengas señal.',
        })
      } else {
        setErrores({ general: 'Error inesperado al finalizar la tarea.' })
      }
      console.error('Error al finalizar la tarea:', err)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal open={open} onClose={guardando ? undefined : onClose} title="Finalizar tarea">
      <p className={styles.tarea}>{servicio.nombre}</p>

      {errores.general && (
        <div className={styles.errorGeneral}>
          <span aria-hidden="true">⚠</span>
          <span>{errores.general}</span>
        </div>
      )}

      {/* ── Descripción ── */}
      {recuperado && (
        <div className={styles.borrador} role="status">
          <span>
            Recuperamos lo que habías escrito antes de salir
            {recuperado.nombreFoto && (
              <>. La foto que habías elegido era <strong>{recuperado.nombreFoto}</strong>,
                tenés que volver a seleccionarla</>
            )}.
          </span>
          <button
            type="button"
            className={styles.descartarBorrador}
            onClick={() => {
              borrarBorrador(servicio.id_servicio)
              setDescripcion('')
              setRecuperado(null)
            }}
          >
            Empezar de cero
          </button>
        </div>
      )}

      <label className={styles.label} htmlFor="fin-descripcion">
        ¿Qué realizaste? <span className={styles.required}>*</span>
      </label>
      <textarea
        id="fin-descripcion"
        className={`${styles.textarea} ${errores.descripcion ? styles.campoError : ''}`}
        rows={4}
        value={descripcion}
        onChange={(e) => {
          setDescripcion(e.target.value)
          if (errores.descripcion) setErrores((p) => ({ ...p, descripcion: null }))
        }}
        placeholder="Ej: Se instaló la acometida y se configuró la ONT. Señal medida: -18 dBm. Cliente conforme."
        disabled={guardando || Boolean(evidenciaGuardada)}
      />
      {errores.descripcion && <p className={styles.errorCampo}>{errores.descripcion}</p>}

      {/* ── Foto de evidencia ── */}
      <label className={styles.label} htmlFor="fin-foto">
        Foto de evidencia <span className={styles.required}>*</span>
      </label>

      {previewUrl ? (
        <div className={styles.previewWrap}>
          <img src={previewUrl} alt="Evidencia seleccionada" className={styles.preview} />
          <div className={styles.previewInfo}>
            <span className={styles.previewNombre}>{foto?.name}</span>
            <span className={styles.previewPeso}>
              {(foto.size / (1024 * 1024)).toFixed(1)} MB
            </span>
          </div>
          <button
            type="button"
            className={styles.quitarBtn}
            onClick={quitarFoto}
            disabled={guardando}
          >
            <IconBasura /> Quitar
          </button>
        </div>
      ) : (
        <label
          className={`${styles.dropzone} ${errores.foto ? styles.campoError : ''}`}
          htmlFor="fin-foto"
        >
          <span className={styles.dropzoneIcono}><IconCamara /></span>
          <span className={styles.dropzoneTexto}>Toca para tomar o elegir una foto</span>
          <span className={styles.dropzoneHint}>
            JPG, PNG, WEBP o GIF · máx. {MAX_FOTO_MB} MB
          </span>
        </label>
      )}

      <input
        id="fin-foto"
        ref={inputFoto}
        type="file"
        className={styles.inputOculto}
        accept={ACCEPT_FOTO}
        capture="environment"
        onChange={handleFoto}
        disabled={guardando || Boolean(evidenciaGuardada)}
      />
      {errores.foto && <p className={styles.errorCampo}>{errores.foto}</p>}

      {/* ── Materiales usados (HU-S10-07) ── */}
      <div className={styles.materiales}>
        <span className={styles.label}>Materiales usados (opcional)</span>
        {!mostrarMateriales ? (
          <button
            type="button"
            className={styles.agregarBtn}
            onClick={() => setMostrarMateriales(true)}
            disabled={guardando}
          >
            + Agregar materiales
          </button>
        ) : (
          <>
            <p className={styles.materialesHint}>
              Se descuentan del inventario al cerrar la tarea.
            </p>
            <div className={styles.materialFila}>
              <select
                aria-label="Material"
                className={styles.materialSelect}
                value={seleccion.id}
                onChange={(e) => setSeleccion((p) => ({ ...p, id: e.target.value }))}
                disabled={guardando || disponibles === null}
              >
                <option value="">
                  {disponibles === null ? 'Cargando materiales…' : 'Elige un material'}
                </option>
                {(disponibles ?? []).map((m) => (
                  <option key={m.id_activo} value={String(m.id_activo)}>
                    {m.nombre_activo}{m.unidad_medida ? ` (${m.unidad_medida})` : ''}
                  </option>
                ))}
              </select>
              <input
                aria-label="Cantidad"
                className={styles.materialCantidad}
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                value={seleccion.cantidad}
                onChange={(e) => setSeleccion((p) => ({ ...p, cantidad: e.target.value }))}
                disabled={guardando}
              />
              <button
                type="button"
                className={styles.agregarBtn}
                onClick={agregarMaterial}
                disabled={guardando || disponibles === null}
              >
                Agregar
              </button>
            </div>
            {materiales.length > 0 && (
              <ul className={styles.materialLista} aria-label="Materiales anotados">
                {materiales.map((m) => (
                  <li key={m.id_material} className={styles.materialItem}>
                    <span>
                      {m.nombre}: <strong>{m.cantidad}{m.unidad ? ` ${m.unidad}` : ''}</strong>
                    </span>
                    <button
                      type="button"
                      className={styles.quitarBtn}
                      onClick={() => quitarMaterial(m.id_material)}
                      disabled={guardando}
                      aria-label={`Quitar ${m.nombre}`}
                    >
                      <IconBasura /> Quitar
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        {errores.materiales && <p className={styles.errorCampo}>{errores.materiales}</p>}
      </div>

      <ModalActions>
        <button className={styles.cancelBtn} onClick={onClose} disabled={guardando}>
          Cancelar
        </button>
        <button className={styles.guardarBtn} onClick={handleGuardar} disabled={guardando}>
          {guardando ? (
            <><Spinner size="sm" color="white" /> Enviando evidencia…</>
          ) : (
            'Finalizar tarea'
          )}
        </button>
      </ModalActions>
    </Modal>
  )
}
