import React, { useState } from 'react'
import Modal, { ModalActions } from '../ui/Modal'
import { asignarHerramientaACarro } from '../../api/inventarioService'
import styles from './ModalAsignarHerramientaACarro.module.css'

export default function ModalAsignarHerramientaACarro({ herramienta, carros = [], onCerrar, onAsignada }) {
  if (!herramienta) return null

  const [carroId, setCarroId] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  const handleConfirmar = async () => {
    if (!carroId) return
    setGuardando(true)
    setError(null)
    try {
      await asignarHerramientaACarro(Number(carroId), herramienta.id_activo)
      const carro = carros.find(c => c.id_activo === Number(carroId))
      onAsignada(herramienta.id_activo, carro)
    } catch (err) {
      setError(err?.response?.data?.detail || 'Error al asignar herramienta al vehículo.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal open onClose={onCerrar} title="Asignar a vehículo" width={460}>
      <p className={styles.desc}>
        Selecciona el vehículo al que deseas asignar la herramienta <strong>{herramienta.nombre_activo}</strong>.
      </p>

      {error && (
        <div className={styles.errorBanner}>
          {error}
        </div>
      )}

      <div className={styles.formWrap}>
        <label className={styles.label}>Vehículo destino</label>
        <select
          className={styles.select}
          value={carroId}
          onChange={e => setCarroId(e.target.value)}
          disabled={guardando}
        >
          <option value="">— Selecciona un vehículo —</option>
          {carros.filter(c => c.estado_vehiculo !== 'fuera_de_servicio').map(c => (
            <option key={c.id_activo} value={c.id_activo}>
              {c.placa} — {c.nombre_activo} {c.nombre_empleado_asignado ? `(${c.nombre_empleado_asignado})` : '(Sin técnico)'}
            </option>
          ))}
        </select>
      </div>

      <ModalActions>
        <button type="button" className="btn btn-ghost" onClick={onCerrar} disabled={guardando}>
          Cancelar
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleConfirmar}
          disabled={!carroId || guardando}
        >
          {guardando ? 'Asignando...' : 'Asignar'}
        </button>
      </ModalActions>
    </Modal>
  )
}
