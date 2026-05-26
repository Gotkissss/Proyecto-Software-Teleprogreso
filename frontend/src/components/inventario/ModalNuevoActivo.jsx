/**
 * components/inventario/ModalNuevoActivo.jsx
 * ---------------------------------------------------------------------------
 * Modal para crear un nuevo activo del inventario.
 * Permite registrar vehículos, herramientas o materiales con campos dinámicos
 * según el tipo seleccionado, e incluye subida opcional de imagen.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useRef, useState } from 'react'
import { createActivo } from '../../services/inventarioService'
import styles from './ModalNuevoActivo.module.css'

const ESTADO_INICIAL = {
  nombre: '',
  tipo:   'material',
  estado: 'disponible',
  // material
  cantidad:     '',
  stock_minimo: '',
  unidad:       '',
  // vehiculo
  placa:       '',
  kilometraje: '',
  // herramienta
  numero_serie: '',
}

export default function ModalNuevoActivo({ isOpen, onClose, onActivoCreado }) {
  const [campos,        setCampos]        = useState(ESTADO_INICIAL)
  const [imagen,        setImagen]        = useState(null)
  const [previewUrl,    setPreviewUrl]    = useState('')
  const [errorNombre,   setErrorNombre]   = useState('')
  const [errorGlobal,   setErrorGlobal]   = useState('')
  const [guardando,     setGuardando]     = useState(false)

  const nombreRef = useRef(null)

  // Reinicia el formulario y enfoca el primer campo al abrir el modal
  useEffect(() => {
    if (isOpen) {
      setCampos(ESTADO_INICIAL)
      setImagen(null)
      setPreviewUrl('')
      setErrorNombre('')
      setErrorGlobal('')
      setGuardando(false)
      // Pequeño retraso para asegurar que el input ya está montado
      setTimeout(() => nombreRef.current?.focus(), 50)
    }
  }, [isOpen])

  // Cierra el modal al presionar Escape
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  // Libera la URL del preview cuando se desmonta o cambia
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  if (!isOpen) return null

  const handleChange = (e) => {
    const { name, value } = e.target
    setCampos(prev => ({ ...prev, [name]: value }))
    if (name === 'nombre' && value.trim()) setErrorNombre('')
  }

  const handleImagenChange = (e) => {
    const file = e.target.files?.[0]
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    if (file) {
      setImagen(file)
      setPreviewUrl(URL.createObjectURL(file))
    } else {
      setImagen(null)
      setPreviewUrl('')
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

    // Construye el FormData con los campos base + los específicos del tipo
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
      await createActivo(formData)
      onActivoCreado?.()
      onClose?.()
    } catch (err) {
      const msg = err?.response?.data?.detail || err?.message || 'No se pudo crear el activo.'
      setErrorGlobal(typeof msg === 'string' ? msg : 'No se pudo crear el activo.')
    } finally {
      setGuardando(false)
    }
  }

  const handleOverlayClick = (e) => {
    // Cerrar solo si se hace click directamente sobre el overlay, no sobre el panel
    if (e.target === e.currentTarget && !guardando) onClose?.()
  }

  return (
    <div className={styles.overlay} onClick={handleOverlayClick} role="dialog" aria-modal="true">
      <div className={styles.panel}>
        <div className={styles.header}>
          <h2 className={styles.title}>Nuevo activo</h2>
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

          {/* Nombre */}
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

          {/* Tipo */}
          <div className={styles.field}>
            <label className={styles.label} htmlFor="tipo">Tipo de activo</label>
            <select
              id="tipo"
              name="tipo"
              className={styles.select}
              value={campos.tipo}
              onChange={handleChange}
            >
              <option value="vehiculo">Vehículo</option>
              <option value="herramienta">Herramienta</option>
              <option value="material">Material</option>
            </select>
          </div>

          {/* Estado */}
          <div className={styles.field}>
            <label className={styles.label} htmlFor="estado">Estado</label>
            <select
              id="estado"
              name="estado"
              className={styles.select}
              value={campos.estado}
              onChange={handleChange}
            >
              <option value="disponible">Disponible</option>
              <option value="en_uso">En uso</option>
              <option value="en_mantenimiento">En mantenimiento</option>
              <option value="fuera_de_servicio">Fuera de servicio</option>
            </select>
          </div>

          {/* Campos dinámicos según tipo */}
          {campos.tipo === 'material' && (
            <>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="cantidad">Cantidad</label>
                <input
                  id="cantidad"
                  name="cantidad"
                  type="number"
                  min="0"
                  className={styles.input}
                  value={campos.cantidad}
                  onChange={handleChange}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="stock_minimo">Stock mínimo</label>
                <input
                  id="stock_minimo"
                  name="stock_minimo"
                  type="number"
                  min="0"
                  className={styles.input}
                  value={campos.stock_minimo}
                  onChange={handleChange}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="unidad">Unidad</label>
                <input
                  id="unidad"
                  name="unidad"
                  type="text"
                  placeholder="Ej: unidades, metros, rollos"
                  className={styles.input}
                  value={campos.unidad}
                  onChange={handleChange}
                />
              </div>
            </>
          )}

          {campos.tipo === 'vehiculo' && (
            <>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="placa">Placa</label>
                <input
                  id="placa"
                  name="placa"
                  type="text"
                  className={styles.input}
                  value={campos.placa}
                  onChange={handleChange}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="kilometraje">Kilometraje</label>
                <input
                  id="kilometraje"
                  name="kilometraje"
                  type="number"
                  min="0"
                  className={styles.input}
                  value={campos.kilometraje}
                  onChange={handleChange}
                />
              </div>
            </>
          )}

          {campos.tipo === 'herramienta' && (
            <div className={styles.field}>
              <label className={styles.label} htmlFor="numero_serie">Número de serie</label>
              <input
                id="numero_serie"
                name="numero_serie"
                type="text"
                className={styles.input}
                value={campos.numero_serie}
                onChange={handleChange}
              />
            </div>
          )}

          {/* Imagen */}
          <div className={styles.field}>
            <label className={styles.label} htmlFor="imagen">Imagen (opcional)</label>
            <div className={styles.fileWrap}>
              {previewUrl
                ? <img src={previewUrl} alt="Vista previa" className={styles.preview} />
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

          {/* Acciones */}
          <div className={styles.actions}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnCancelar}`}
              onClick={onClose}
              disabled={guardando}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className={`${styles.btn} ${styles.btnGuardar}`}
              disabled={guardando}
            >
              {guardando ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
