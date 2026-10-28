import { useState } from 'react'
import Modal, { ModalActions } from '../ui/Modal'
import Spinner from '../ui/Spinner'
import { editarActivo } from '../../api/inventarioService'
import styles from './ModalEditarActivo.module.css'

export default function ModalEditarActivo({ activo, onCerrar, onEditado }) {
  const tipo = activo?.tipo ?? (activo?.placa ? 'carro' : activo?.stock_minimo !== undefined ? 'material' : 'herramienta')

  const [form, setForm] = useState({
    nombre_activo:       activo?.nombre_activo       ?? '',
    descripcion:         activo?.descripcion         ?? '',
    placa:               activo?.placa               ?? '',
    marca:               activo?.marca               ?? '',
    modelo:              activo?.modelo              ?? '',
    capacidad:           activo?.capacidad           ?? '',
    estado_vehiculo:     activo?.estado_vehiculo     ?? 'disponible',
    tipo_herramienta:    activo?.tipo_herramienta    ?? '',
    estado:              activo?.estado              ?? 'disponible',
    stock_minimo:        activo?.stock_minimo        ?? 0,
    unidad_medida:       activo?.unidad_medida       ?? '',
    tipo_material:       activo?.tipo_material       ?? '',
  })
  const [guardando, setGuardando] = useState(false)
  const [error,     setError]     = useState(null)

  if (!activo) return null

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const handleGuardar = async (e) => {
    e.preventDefault()
    if (!form.nombre_activo.trim()) {
      setError('El nombre del activo es obligatorio.')
      return
    }

    setGuardando(true)
    setError(null)
    try {
      let body = {
        nombre_activo: form.nombre_activo.trim(),
        descripcion:   form.descripcion.trim() || undefined,
      }
      if (tipo === 'carro') {
        body = {
          ...body,
          placa:           form.placa.trim() || undefined,
          marca:           form.marca.trim() || undefined,
          modelo:          form.modelo.trim() || undefined,
          capacidad:       form.capacidad ? Number(form.capacidad) : undefined,
          estado_vehiculo: form.estado_vehiculo,
        }
      } else if (tipo === 'herramienta') {
        body = {
          ...body,
          tipo_herramienta: form.tipo_herramienta.trim() || undefined,
          marca:            form.marca.trim() || undefined,
          modelo:           form.modelo.trim() || undefined,
          estado:           form.estado,
        }
      } else {
        body = {
          ...body,
          // `cantidad_disponible` ya no viaja aquí (HU-S10-07): el stock se
          // mueve con un movimiento del kardex, que obliga a decir por qué.
          // El backend tampoco lo acepta en este PATCH.
          stock_minimo:        Number(form.stock_minimo) || 0,
          unidad_medida:       form.unidad_medida.trim() || undefined,
          tipo_material:       form.tipo_material.trim() || undefined,
        }
      }
      const actualizado = await editarActivo(activo.id_activo, body)
      onEditado({ ...activo, ...actualizado })
    } catch (err) {
      setError(err?.response?.data?.detail || 'Error al actualizar el activo.')
      setGuardando(false)
    }
  }

  return (
    <Modal open onClose={onCerrar} title={`Editar ${tipo}`} width={600}>
      <p className={styles.subtitle}>ID #{activo.id_activo} — {activo.nombre_activo}</p>

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
          />
        </div>

        {tipo === 'carro' && (
          <>
            <div className={styles.grid}>
              <div className={styles.field}>
                <label className={styles.label}>Placa</label>
                <input
                  type="text"
                  className={styles.input}
                  value={form.placa}
                  onChange={e => set('placa', e.target.value.toUpperCase())}
                  disabled={guardando}
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
                />
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Estado del vehículo</label>
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
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Estado</label>
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

        {tipo === 'material' && (
          <>
            {/* La cantidad disponible ya no se edita aquí (HU-S10-07): era el
                camino por el que el stock cambiaba sin dejar rastro. Se mueve
                desde "Movimientos", registrando una entrada o un ajuste con su
                motivo. */}
            <p className={styles.nota}>
              El stock ({activo.cantidad_disponible?.toLocaleString() ?? 0}
              {activo.unidad_medida ? ` ${activo.unidad_medida}` : ''}) se
              cambia desde <strong>Movimientos</strong>, registrando una
              entrada o un ajuste con su motivo.
            </p>
            <div className={styles.grid}>
              <div className={styles.field}>
                <label className={styles.label}>Stock mínimo</label>
                <input
                  type="number"
                  min="0"
                  className={styles.input}
                  value={form.stock_minimo}
                  onChange={e => set('stock_minimo', e.target.value)}
                  disabled={guardando}
                />
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
                />
              </div>
            </div>
          </>
        )}

        <div className={styles.field}>
          <label className={styles.label}>Descripción</label>
          <textarea
            className={styles.textarea}
            rows={2}
            value={form.descripcion}
            onChange={e => set('descripcion', e.target.value)}
            disabled={guardando}
          />
        </div>

        <ModalActions>
          <button type="button" className="btn btn-ghost" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={guardando}>
            {guardando ? <><Spinner size="sm" color="white" /> Guardando...</> : 'Guardar cambios'}
          </button>
        </ModalActions>
      </form>
    </Modal>
  )
}
