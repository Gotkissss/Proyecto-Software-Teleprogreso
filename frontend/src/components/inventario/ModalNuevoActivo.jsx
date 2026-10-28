import { useState } from 'react'
import Modal, { ModalActions } from '../ui/Modal'
import Spinner from '../ui/Spinner'
import { crearActivo } from '../../api/inventarioService'
import styles from './ModalNuevoActivo.module.css'

/**
 * Errores por campo del formulario de alta de un activo.
 *
 * Se exporta para poder probarla sin montar el modal. Las reglas son las del
 * backend (`app/schemas/activo.py`), que sigue siendo quien decide: esto solo
 * evita el viaje y, sobre todo, dice QUÉ campo está mal — el 422 de Pydantic
 * llega con la lista en un formato que la pantalla no puede mostrar y acababa
 * en un «Los datos enviados no son válidos.» genérico (RTF-01 / R3-7).
 */
export function validarActivo(tipo, form) {
  const errores = {}

  if (!form.nombre_activo.trim()) {
    errores.nombre_activo = 'El nombre del activo es obligatorio.'
  }

  if (tipo === 'carro') {
    if (!form.placa.trim()) errores.placa = 'La placa es obligatoria.'
    if (form.capacidad !== '' && Number(form.capacidad) < 0) {
      errores.capacidad = 'La capacidad no puede ser negativa.'
    }
  }

  if (tipo === 'material') {
    // `Number('')` es 0 y `Number('abc')` es NaN: hay que distinguir el campo
    // vacío (que vale, se toma como 0) del que tiene algo que no es un número.
    for (const [campo, etiqueta] of [
      ['cantidad_disponible', 'La cantidad disponible'],
      ['stock_minimo', 'El stock mínimo'],
    ]) {
      const crudo = String(form[campo] ?? '').trim()
      if (!crudo) continue
      const valor = Number(crudo)
      if (!Number.isFinite(valor)) {
        errores[campo] = `${etiqueta} tiene que ser un número.`
      } else if (valor < 0) {
        errores[campo] = `${etiqueta} no puede ser negativa.`
      } else if (!Number.isInteger(valor)) {
        errores[campo] = `${etiqueta} tiene que ser un número entero.`
      }
    }
  }

  return errores
}

export default function ModalNuevoActivo({ tipoInicial = 'carro', onCerrar, onCreado }) {
  const [tipo, setTipo] = useState(tipoInicial)
  const [form, setForm] = useState({
    nombre_activo: '',
    descripcion: '',
    placa: '',
    marca: '',
    modelo: '',
    capacidad: '',
    estado_vehiculo: 'disponible',
    tipo_herramienta: '',
    estado: 'disponible',
    cantidad_disponible: '0',
    stock_minimo: '0',
    unidad_medida: '',
    tipo_material: '',
  })
  const [guardando, setGuardando] = useState(false)
  // RTF-01 / R3-7: un mensaje por campo, no uno genérico arriba.
  const [errores,   setErrores]   = useState({})
  const [error, setError] = useState(null)

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const handleGuardar = async (e) => {
    e.preventDefault()

    // RTF-01 / R3-7: el backend rechaza una cantidad negativa, pero su
    // respuesta es «Los datos enviados no son válidos.» — un 422 de Pydantic
    // con la lista de errores en un formato que no se puede mostrar. El
    // usuario veía un mensaje genérico arriba del formulario y tenía que
    // adivinar qué campo estaba mal. Se valida aquí y se señala el campo.
    const nuevosErrores = validarActivo(tipo, form)
    setErrores(nuevosErrores)
    if (Object.keys(nuevosErrores).length > 0) {
      setError(null)
      return
    }

    setGuardando(true)
    setError(null)
    try {
      let body = {
        tipo,
        nombre_activo: form.nombre_activo.trim(),
        descripcion: form.descripcion.trim() || undefined,
      }
      if (tipo === 'carro') {
        body = {
          ...body,
          placa: form.placa.trim(),
          marca: form.marca.trim() || undefined,
          modelo: form.modelo.trim() || undefined,
          capacidad: form.capacidad ? Number(form.capacidad) : undefined,
          estado_vehiculo: form.estado_vehiculo,
        }
      } else if (tipo === 'herramienta') {
        body = {
          ...body,
          tipo_herramienta: form.tipo_herramienta.trim() || undefined,
          marca: form.marca.trim() || undefined,
          modelo: form.modelo.trim() || undefined,
          estado: form.estado,
        }
      } else {
        body = {
          ...body,
          cantidad_disponible: Number(form.cantidad_disponible) || 0,
          stock_minimo: Number(form.stock_minimo) || 0,
          unidad_medida: form.unidad_medida.trim() || undefined,
          tipo_material: form.tipo_material.trim() || undefined,
        }
      }
      const nuevo = await crearActivo(body)
      onCreado(nuevo)
    } catch (err) {
      setError(err?.response?.data?.detail || 'Error al crear el activo.')
      setGuardando(false)
    }
  }

  return (
    <Modal open onClose={onCerrar} title="Nuevo activo" width={600}>
      <p className={styles.subtitle}>Selecciona el tipo de activo y completa la información requerida</p>

      {/* Selector de Tipo */}
      <div className={styles.tipoSelector}>
        {[
          { id: 'carro', label: '🚗 Vehículo' },
          { id: 'herramienta', label: '🔧 Herramienta' },
          { id: 'material', label: '📦 Material' },
        ].map(t => (
          <button
            key={t.id}
            type="button"
            className={`${styles.tipoBtn} ${tipo === t.id ? styles.tipoBtnActive : ''}`}
            onClick={() => { setTipo(t.id); setError(null) }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className={styles.errorBanner}>
          {error}
        </div>
      )}

      <form className={styles.form} onSubmit={handleGuardar} noValidate>
        <div className={styles.field}>
          <label className={styles.label}>Nombre del activo <span className={styles.required}>*</span></label>
          <input
            type="text"
            className={styles.input}
            value={form.nombre_activo}
            onChange={e => set('nombre_activo', e.target.value)}
            disabled={guardando}
            placeholder={tipo === 'carro' ? 'Ej: Toyota Hilux 2022' : tipo === 'herramienta' ? 'Ej: Taladro Percutor' : 'Ej: Conectores RJ45'}
          />
        </div>

        {/* Campos específicos: Vehículo */}
        {tipo === 'carro' && (
          <>
            <div className={styles.grid}>
              <div className={styles.field}>
                <label className={styles.label}>Placa <span className={styles.required}>*</span></label>
                <input
                  type="text"
                  className={styles.input}
                  value={form.placa}
                  onChange={e => set('placa', e.target.value.toUpperCase())}
                  disabled={guardando}
                  placeholder="Ej: P-123XYZ"
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Marca</label>
                <input
                  type="text"
                  className={styles.input}
                  value={form.marca}
                  onChange={e => set('marca', e.target.value)}
                  disabled={guardando}
                  placeholder="Ej: Toyota"
                />
              </div>
            </div>

            <div className={styles.grid}>
              <div className={styles.field}>
                <label className={styles.label}>Modelo</label>
                <input
                  type="text"
                  className={styles.input}
                  value={form.modelo}
                  onChange={e => set('modelo', e.target.value)}
                  disabled={guardando}
                  placeholder="Ej: Hilux 4x4"
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Capacidad (kg)</label>
                <input
                  type="number"
                  className={styles.input}
                  value={form.capacidad}
                  onChange={e => set('capacidad', e.target.value)}
                  disabled={guardando}
                  placeholder="Ej: 1000"
                />
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Estado inicial</label>
              <select
                className={styles.select}
                value={form.estado_vehiculo}
                onChange={e => set('estado_vehiculo', e.target.value)}
                disabled={guardando}
              >
                <option value="disponible">Disponible</option>
                <option value="en_uso">En uso</option>
                <option value="mantenimiento">Mantenimiento</option>
                <option value="fuera_servicio">Fuera de servicio</option>
              </select>
            </div>
          </>
        )}

        {/* Campos específicos: Herramienta */}
        {tipo === 'herramienta' && (
          <>
            <div className={styles.grid}>
              <div className={styles.field}>
                <label className={styles.label}>Tipo de herramienta</label>
                <input
                  type="text"
                  className={styles.input}
                  value={form.tipo_herramienta}
                  onChange={e => set('tipo_herramienta', e.target.value)}
                  disabled={guardando}
                  placeholder="Ej: Eléctrica, Manual, Medición"
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Marca</label>
                <input
                  type="text"
                  className={styles.input}
                  value={form.marca}
                  onChange={e => set('marca', e.target.value)}
                  disabled={guardando}
                  placeholder="Ej: DeWalt, Bosch"
                />
              </div>
            </div>

            <div className={styles.grid}>
              <div className={styles.field}>
                <label className={styles.label}>Modelo</label>
                <input
                  type="text"
                  className={styles.input}
                  value={form.modelo}
                  onChange={e => set('modelo', e.target.value)}
                  disabled={guardando}
                  placeholder="Ej: DCD771"
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Estado inicial</label>
                <select
                  className={styles.select}
                  value={form.estado}
                  onChange={e => set('estado', e.target.value)}
                  disabled={guardando}
                >
                  <option value="disponible">Disponible</option>
                  <option value="en_uso">En uso</option>
                  <option value="mantenimiento">Mantenimiento</option>
                  <option value="dañada">Dañada</option>
                </select>
              </div>
            </div>
          </>
        )}

        {/* Campos específicos: Material */}
        {tipo === 'material' && (
          <>
            <div className={styles.grid}>
              <div className={styles.field}>
                <label className={styles.label}>Cantidad disponible</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  className={`${styles.input} ${errores.cantidad_disponible ? styles.inputError : ''}`}
                  value={form.cantidad_disponible}
                  onChange={e => set('cantidad_disponible', e.target.value)}
                  disabled={guardando}
                  aria-invalid={Boolean(errores.cantidad_disponible)}
                />
                {errores.cantidad_disponible && (
                  <p className={styles.campoError}>{errores.cantidad_disponible}</p>
                )}
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Stock mínimo de alerta</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  className={`${styles.input} ${errores.stock_minimo ? styles.inputError : ''}`}
                  value={form.stock_minimo}
                  onChange={e => set('stock_minimo', e.target.value)}
                  disabled={guardando}
                  aria-invalid={Boolean(errores.stock_minimo)}
                />
                {errores.stock_minimo && (
                  <p className={styles.campoError}>{errores.stock_minimo}</p>
                )}
              </div>
            </div>

            <div className={styles.grid}>
              <div className={styles.field}>
                <label className={styles.label}>Unidad de medida</label>
                <input
                  type="text"
                  className={styles.input}
                  value={form.unidad_medida}
                  onChange={e => set('unidad_medida', e.target.value)}
                  disabled={guardando}
                  placeholder="Ej: metros, unidades, cajas"
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Tipo de material</label>
                <input
                  type="text"
                  className={styles.input}
                  value={form.tipo_material}
                  onChange={e => set('tipo_material', e.target.value)}
                  disabled={guardando}
                  placeholder="Ej: Cable, Conector, Fibra"
                />
              </div>
            </div>
          </>
        )}

        <div className={styles.field}>
          <label className={styles.label}>Descripción <span className={styles.optional}>(opcional)</span></label>
          <textarea
            className={styles.textarea}
            rows={2}
            value={form.descripcion}
            onChange={e => set('descripcion', e.target.value)}
            disabled={guardando}
            placeholder="Observaciones o notas sobre el activo..."
          />
        </div>

        <ModalActions>
          <button type="button" className="btn btn-ghost" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={guardando}>
            {guardando ? <><Spinner size="sm" color="white" /> Guardando...</> : 'Crear activo'}
          </button>
        </ModalActions>
      </form>
    </Modal>
  )
}
