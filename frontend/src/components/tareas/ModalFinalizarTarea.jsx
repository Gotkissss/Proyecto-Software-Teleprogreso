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

export default function ModalFinalizarTarea({ open, servicio, onClose, onFinalizada }) {
  const toast = useToast()
  const inputFoto = useRef(null)

  const [descripcion, setDescripcion] = useState('')
  const [foto, setFoto] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [errores, setErrores] = useState({})
  const [guardando, setGuardando] = useState(false)

  // Al abrirlo con otra tarea se limpia todo.
  useEffect(() => {
    if (!open) return
    setDescripcion('')
    setFoto(null)
    setErrores({})
    setGuardando(false)
  }, [open, servicio?.id_servicio])

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

  const validar = () => {
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
      const incidencia = await finalizarTareaConEvidencia(servicio.id_servicio, {
        descripcion: descripcion.trim(),
        foto,
      })
      toast.success('Tarea finalizada y evidencia registrada.')
      onFinalizada?.(servicio.id_servicio, incidencia)
      onClose?.()
    } catch (err) {
      const status = err?.response?.status
      const detail = err?.response?.data?.detail

      if (status === 403) {
        setErrores({ general: detail || 'Solo el técnico asignado puede finalizar esta tarea.' })
      } else if (status === 400 || status === 404 || status === 422) {
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
        <div className={styles.errorGeneral} role="alert">
          {errores.general}
        </div>
      )}

      {/* ── Descripción ── */}
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
        disabled={guardando}
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
            className={`btn btn-secondary btn-sm ${styles.quitarBtn}`}
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
        disabled={guardando}
      />
      {errores.foto && <p className={styles.errorCampo}>{errores.foto}</p>}

      <ModalActions>
        <button className="btn btn-ghost" onClick={onClose} disabled={guardando}>
          Cancelar
        </button>
        <button
          className={`btn btn-success ${styles.guardarBtn}`}
          onClick={handleGuardar}
          disabled={guardando}
        >
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
