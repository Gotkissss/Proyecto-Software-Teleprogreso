import React, { useState, useEffect } from 'react'
import Modal, { ModalActions } from '../ui/Modal'
import Spinner from '../ui/Spinner'
import { asignarTecnicoACarro } from '../../api/inventarioService'
import { getTecnicosDisponibles } from '../../api/tareaService'
import styles from './ModalAsignarTecnico.module.css'

export default function ModalAsignarTecnico({ vehiculo, onCerrar, onAsignado }) {
  if (!vehiculo) return null

  const [tecnicos, setTecnicos] = useState([])
  const [loading, setLoading] = useState(true)
  const [tecnicoId, setTecnicoId] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    getTecnicosDisponibles()
      .then(setTecnicos)
      .catch(() => setError('No se pudo cargar la lista de técnicos.'))
      .finally(() => setLoading(false))
  }, [])

  const handleConfirmar = async () => {
    if (!tecnicoId) return
    setGuardando(true)
    setError(null)
    try {
      await asignarTecnicoACarro(vehiculo.id_activo, Number(tecnicoId))
      const tec = tecnicos.find(t => t.id_empleado === Number(tecnicoId))
      onAsignado(vehiculo.id_activo, tec)
    } catch (err) {
      setError(err?.response?.data?.detail || 'Error al asignar técnico al vehículo.')
      setGuardando(false)
    }
  }

  return (
    <Modal open onClose={onCerrar} title="Asignar técnico" width={480}>
      <p className={styles.desc}>
        Vehículo: <strong>{vehiculo.placa}</strong> — {vehiculo.nombre_activo}
      </p>

      {error && (
        <div className={styles.errorBanner}>
          {error}
        </div>
      )}

      {loading ? (
        <div className={styles.loadingWrap}>
          <Spinner size="md" />
        </div>
      ) : (
        <div className={styles.formWrap}>
          <label className={styles.label}>Seleccionar técnico</label>
          <select
            className={styles.select}
            value={tecnicoId}
            onChange={e => setTecnicoId(e.target.value)}
            disabled={guardando}
          >
            <option value="">— Selecciona un técnico —</option>
            {tecnicos.map(tec => (
              <option key={tec.id_empleado} value={tec.id_empleado}>
                {tec.nombre_completo ?? `${tec.nombre} ${tec.apellido}`}
                {' — '}
                {tec.tareas_activas ?? 0} tarea{tec.tareas_activas === 1 ? '' : 's'} activa{tec.tareas_activas === 1 ? '' : 's'}
              </option>
            ))}
          </select>
        </div>
      )}

      <ModalActions>
        <button type="button" className="btn btn-ghost" onClick={onCerrar} disabled={guardando}>
          Cancelar
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleConfirmar}
          disabled={!tecnicoId || guardando}
        >
          {guardando ? 'Asignando...' : 'Asignar'}
        </button>
      </ModalActions>
    </Modal>
  )
}
