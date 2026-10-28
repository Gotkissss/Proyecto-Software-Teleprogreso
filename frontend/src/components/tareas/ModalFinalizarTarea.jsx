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
 * HU-S10-07: lleva además el paso "materiales usados", opcional. Lo que se
 * anote ahí se descuenta del stock en la misma transacción que cierra la
 * tarea; si el almacén no alcanza, el backend responde 409 y la tarea se queda
 * abierta para que el técnico corrija la cantidad.
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
import PasoMaterialesUsados, {
  validarMateriales,
} from './PasoMaterialesUsados'
import { getMateriales } from '../../api/inventarioService'
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
  const [materiales, setMateriales] = useState([])
  // Catálogo del inventario, para poder avisar de "solo hay 3" antes de gastar
  // una petición que el backend va a rechazar con 409.
  const [catalogo, setCatalogo] = useState([])
  const [erroresMateriales, setErroresMateriales] = useState({})
  const [foto, setFoto] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [errores, setErrores] = useState({})
  const [guardando, setGuardando] = useState(false)
  // Lo que había escrito antes de que se le cayera la sesión (HU-S9-05).
  const [recuperado, setRecuperado] = useState(null)

  // Al abrirlo con otra tarea se limpia todo... salvo lo que el técnico ya
  // había escrito para ESTA tarea y no llegó a enviarse. El informe son varias
  // líneas escritas de pie y con una mano: perderlo por un 401 significa
  // volver a escribirlo de memoria.
  useEffect(() => {
    if (!open) return

    const borrador = leerBorrador(servicio?.id_servicio)
    setDescripcion(borrador?.descripcion ?? '')
    setMateriales(borrador?.materiales ?? [])
    setRecuperado(borrador)
    setFoto(null)
    setErrores({})
    setErroresMateriales({})
    setGuardando(false)
  }, [open, servicio?.id_servicio])

  // El catálogo se pide una vez por apertura. Si falla no se bloquea nada: el
  // paso de materiales es opcional y su propio componente lo avisa.
  useEffect(() => {
    if (!open) return
    let vivo = true
    getMateriales()
      .then((lista) => {
        if (vivo) setCatalogo(lista)
      })
      .catch(() => {
        if (vivo) setCatalogo([])
      })
    return () => {
      vivo = false
    }
  }, [open])

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

    // Las líneas de material se validan aquí y no en su componente para que
    // "Finalizar" no envíe nada con una línea a medias: el backend rechazaría
    // el cierre entero y el técnico perdería el viaje.
    const { errores: erroresLineas } = validarMateriales(materiales, catalogo)
    setErroresMateriales(erroresLineas)

    setErrores(nuevos)
    return (
      Object.keys(nuevos).length === 0
      && Object.keys(erroresLineas).length === 0
    )
  }

  const handleGuardar = async () => {
    if (!validar()) return

    setGuardando(true)
    try {
      // HU-5: nunca bloquea el cierre; sin GPS llega null y la tarea se
      // cierra igual, solo que sin punto en el recorrido.
      const posicion = await obtenerPosicionActual({ respaldo: posicionRespaldo })
      const { limpias } = validarMateriales(materiales, catalogo)
      const incidencia = await finalizarTareaConEvidencia(servicio.id_servicio, {
        descripcion: descripcion.trim(),
        foto,
        posicion,
        materiales: limpias,
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

      if (status === 403) {
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
        disabled={guardando}
      />
      {errores.foto && <p className={styles.errorCampo}>{errores.foto}</p>}

      {/* ── Materiales usados (opcional) ── */}
      <label className={styles.label}>Materiales usados</label>
      <PasoMaterialesUsados
        lineas={materiales}
        onChange={(nuevas) => {
          setMateriales(nuevas)
          setErroresMateriales({})
        }}
        deshabilitado={guardando}
        errores={erroresMateriales}
      />

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
