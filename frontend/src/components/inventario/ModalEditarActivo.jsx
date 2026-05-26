/**
 * components/inventario/ModalEditarActivo.jsx
 * ---------------------------------------------------------------------------
 * Modal para editar un activo existente del inventario.
 * Reutiliza los estilos de ModalNuevoActivo y sigue el mismo patrón
 * (overlay + panel, campos dinámicos por tipo, cierre con Escape, etc.).
 * ---------------------------------------------------------------------------
 */

import { useEffect, useRef, useState } from 'react'
import { updateActivo } from '../../services/inventarioService'
import styles from './ModalNuevoActivo.module.css'

const ESTADO_INICIAL = {
  nombre: '',
  tipo:   'material',
  estado: 'disponible',
  cantidad:     '',
  stock_minimo: '',
  unidad:       '',
  placa:       '',
  kilometraje: '',
  numero_serie: '',
}

export default function ModalEditarActivo({ isOpen, activo, onClose, onActivoEditado }) {
  const [campos,       setCampos]       = useState(ESTADO_INICIAL)
  const [imagen,       setImagen]       = useState(null)
  const [previewLocal, setPreviewLocal] = useState('') // URL.createObjectURL nueva
  const [errorNombre,  setErrorNombre]  = useState('')
  const [errorGlobal,  setErrorGlobal]  = useState('')
  const [guardando,    setGuardando]    = useState(false)

  const nombreRef = useRef(null)

  // Precarga el formulario cada vez que cambia el activo
  useEffect(() => {
    if (!isOpen || !activo) return
    setCampos({
      nombre: activo.nombre_activo ?? activo.nombre ?? '',
      tipo:   (activo.tipo_activo ?? activo.tipo ?? 'material').toLowerCase(),
      estado: activo.estado ?? 'disponible',
      cantidad:     activo.cantidad_disponible ?? '',
      stock_minimo: activo.stock_minimo ?? '',
      unidad:       activo.unidad_medida ?? activo.unidad ?? '',
      placa:        activo.placa ?? '',
      kilometraje:  activo.kilometraje ?? '',
      numero_serie: activo.numero_serie ?? '',
    })
    setImagen(null)
    setPreviewLocal('')
    setErrorNombre('')
    setErrorGlobal('')
    setGuardando(false)
    setTimeout(() => nombreRef.current?.focus(), 50)
  }, [isOpen, activo])

  // Cerrar con Escape
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  // Libera la URL local del preview
  useEffect(() => {
    return () => {
      if (previewLocal) URL.revokeObjectURL(previewLocal)
    }
  }, [previewLocal])

  if (!isOpen || !activo) return null

  const handleChange = (e) => {
    const { name, value } = e.target
    setCampos(prev => ({ ...prev, [name]: value }))
    if (name === 'nombre' && value.trim()) setErrorNombre('')
  }

  const handleImagenChange = (e) => {
    const file = e.target.files?.[0]
    if (previewLocal) URL.revokeObjectURL(previewLocal)
    if (file) {
      setImagen(file)
      setPreviewLocal(URL.createObjectURL(file))
    } else {
      setImagen(null)
      setPreviewLocal('')
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setErrorGlobal('')

    if (!campos.nombre.trim()) {
      setErrorNombre('El nombre es obligatorio.')
      nombreRef.current?.focus()
      return
    }

    const formData = new FormData()
    formData.append('nombre',      campos.nombre.trim())
    formData.append('tipo_activo', campos.tipo)
    formData.append('estado',      campos.estado)

    if (campos.tipo === 'material') {
      formData.append('cantidad_disponible', campos.cantidad || 0)
      formData.append('stock_minimo',        campos.stock_minimo || 0)
      formData.append('unidad_medida',       campos.unidad)
    } else if (campos.tipo === 'vehiculo') {
      formData.append('placa',       campos.placa)
      formData.append('kilometraje', campos.kilometraje || 0)
    } else if (campos.tipo === 'herramienta') {
      formData.append('numero_serie', campos.numero_serie)
    }

    if (imagen) formData.append('imagen', imagen)

    setGuardando(true)
    try {
      await updateActivo(activo.id_activo ?? activo.id, formData)
      onActivoEditado?.()
      onClose?.()
    } catch (err) {
      const msg = err?.response?.data?.detail || err?.message || 'No se pudo actualizar el activo.'
      setErrorGlobal(typeof msg === 'string' ? msg : 'No se pudo actualizar el activo.')
    } finally {
      setGuardando(false)
    }
  }

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget && !guardando) onClose?.()
  }

  // URL de la imagen a mostrar: local nueva > la del backend
  const previewSrc = previewLocal || activo.imagen_url || activo.imagen || ''

  return (
    <div className={styles.overlay} onClick={handleOverlayClick} role="dialog" aria-modal="true">
      <div className={styles.panel}>
        <div className={styles.header}>
          <h2 className={styles.title}>Editar activo</h2>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Cerrar"
            disabled={guardando}
          >
            ×
          </button>
        </div>

        <form className={styles.form} onSubmit={handleSubmit}>
          {errorGlobal && <div className={styles.errorBox}>{errorGlobal}</div>}

          <div className={styles.field}>
            <label className={styles.label} htmlFor="nombre">
              Nombre<span className={styles.required}>*</span>
            </label>
            <input
              ref={nombreRef}
              id="nombre"
              name="nombre"
              type="text"
              className={`${styles.input} ${errorNombre ? styles.inputError : ''}`}
              value={campos.nombre}
              onChange={handleChange}
            />
            {errorNombre && <p className={styles.errorMsg}>{errorNombre}</p>}
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="tipo">Tipo de activo</label>
            <select id="tipo" name="tipo" className={styles.select} value={campos.tipo} onChange={handleChange}>
              <option value="vehiculo">Vehículo</option>
              <option value="herramienta">Herramienta</option>
              <option value="material">Material</option>
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="estado">Estado</label>
            <select id="estado" name="estado" className={styles.select} value={campos.estado} onChange={handleChange}>
              <option value="disponible">Disponible</option>
              <option value="en_uso">En uso</option>
              <option value="en_mantenimiento">En mantenimiento</option>
              <option value="fuera_de_servicio">Fuera de servicio</option>
            </select>
          </div>

          {campos.tipo === 'material' && (
            <>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="cantidad">Cantidad</label>
                <input id="cantidad" name="cantidad" type="number" min="0"
                  className={styles.input} value={campos.cantidad} onChange={handleChange} />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="stock_minimo">Stock mínimo</label>
                <input id="stock_minimo" name="stock_minimo" type="number" min="0"
                  className={styles.input} value={campos.stock_minimo} onChange={handleChange} />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="unidad">Unidad</label>
                <input id="unidad" name="unidad" type="text"
                  placeholder="Ej: unidades, metros, rollos"
                  className={styles.input} value={campos.unidad} onChange={handleChange} />
              </div>
            </>
          )}

          {campos.tipo === 'vehiculo' && (
            <>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="placa">Placa</label>
                <input id="placa" name="placa" type="text"
                  className={styles.input} value={campos.placa} onChange={handleChange} />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="kilometraje">Kilometraje</label>
                <input id="kilometraje" name="kilometraje" type="number" min="0"
                  className={styles.input} value={campos.kilometraje} onChange={handleChange} />
              </div>
            </>
          )}

          {campos.tipo === 'herramienta' && (
            <div className={styles.field}>
              <label className={styles.label} htmlFor="numero_serie">Número de serie</label>
              <input id="numero_serie" name="numero_serie" type="text"
                className={styles.input} value={campos.numero_serie} onChange={handleChange} />
            </div>
          )}

          <div className={styles.field}>
            <label className={styles.label} htmlFor="imagen">Imagen</label>
            <div className={styles.fileWrap}>
              {previewSrc
                ? <img src={previewSrc} alt="Vista previa" className={styles.preview} />
                : <div className={styles.previewPlaceholder}>Sin imagen</div>}
              <input
                id="imagen"
                type="file"
                accept="image/*"
                className={styles.fileInput}
                onChange={handleImagenChange}
              />
            </div>
          </div>

          <div className={styles.actions}>
            <button type="button" className={`${styles.btn} ${styles.btnCancelar}`} onClick={onClose} disabled={guardando}>
              Cancelar
            </button>
            <button type="submit" className={`${styles.btn} ${styles.btnGuardar}`} disabled={guardando}>
              {guardando ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
