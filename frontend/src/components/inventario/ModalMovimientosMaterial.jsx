/**
 * components/inventario/ModalMovimientosMaterial.jsx
 * ---------------------------------------------------------------------------
 * HU-S10-07 — La historia de stock de un material, y el formulario para
 * moverlo.
 *
 * Qué resuelve: `cantidad_disponible` era un número que se editaba a mano en
 * el modal del activo. Nadie podía saber si las 40 unidades que faltaban se
 * habían usado en tareas, se habían perdido o alguien se equivocó al teclear,
 * porque el campo solo guarda el último valor escrito.
 *
 * Ahora cada cambio es una fila con su saldo, su actor y —si fue consumo— su
 * tarea. Y para cambiarlo hay que decir qué pasó:
 *
 *   · Entrada: llegó material. Suma.
 *   · Ajuste:  se contó el almacén y hay otra cifra. Fija el saldo y exige
 *              motivo, porque sin él un ajuste y un dedazo son la misma fila.
 *
 * El consumo no se registra desde aquí: lo hace el cierre de la tarea, que es
 * lo que le da sentido.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from 'react'
import Badge from '../ui/Badge'
import Modal, { ModalActions } from '../ui/Modal'
import Spinner from '../ui/Spinner'
import { useToast } from '../ui/Toast'
import {
  crearMovimientoMaterial,
  getMovimientosMaterial,
} from '../../api/inventarioService'
import styles from './ModalMovimientosMaterial.module.css'

const ETIQUETA_TIPO = {
  entrada: 'Entrada',
  consumo: 'Consumo',
  ajuste: 'Ajuste',
}

const VARIANTE_TIPO = {
  entrada: 'success',
  consumo: 'info',
  ajuste: 'warning',
}

/** "2026-10-27T14:32:00" → "27/10/2026 14:32". */
function formatearFechaHora(valor) {
  if (!valor) return '—'
  // Se lee del texto y no con `new Date(...)`: el backend manda la hora ya en
  // la zona de la operación y sin zona declarada, así que construir un Date la
  // interpretaría como UTC y la correría seis horas.
  const [fecha, hora = ''] = String(valor).split('T')
  const [a, m, d] = fecha.split('-')
  if (!a || !m || !d) return valor
  return `${d}/${m}/${a}${hora ? ` ${hora.slice(0, 5)}` : ''}`
}

export default function ModalMovimientosMaterial({ material, onCerrar, onMovido }) {
  const toast = useToast()

  const [datos, setDatos] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)

  const [tipo, setTipo] = useState('entrada')
  const [cantidad, setCantidad] = useState('')
  const [motivo, setMotivo] = useState('')
  const [errorForm, setErrorForm] = useState(null)
  const [guardando, setGuardando] = useState(false)

  const cargar = useCallback(async () => {
    if (!material) return
    setCargando(true)
    setError(null)
    try {
      setDatos(await getMovimientosMaterial(material.id_activo))
    } catch (err) {
      setError(
        err?.response?.data?.detail
          || 'No se pudo cargar la historia de este material.'
      )
    } finally {
      setCargando(false)
    }
  }, [material])

  useEffect(() => { cargar() }, [cargar])

  if (!material) return null

  const enviar = async () => {
    const numero = Number(cantidad)
    if (!Number.isInteger(numero) || numero <= 0) {
      setErrorForm('La cantidad tiene que ser un número entero mayor que 0.')
      return
    }
    if (tipo === 'ajuste' && !motivo.trim()) {
      setErrorForm('Un ajuste necesita un motivo.')
      return
    }

    setGuardando(true)
    setErrorForm(null)
    try {
      const movimiento = await crearMovimientoMaterial(material.id_activo, {
        tipo,
        cantidad: numero,
        motivo: motivo.trim() || undefined,
      })
      toast.success(
        tipo === 'entrada'
          ? `Entrada registrada. Quedan ${movimiento.saldo_resultante}.`
          : `Stock ajustado a ${movimiento.saldo_resultante}.`
      )
      setCantidad('')
      setMotivo('')
      await cargar()
      // La tabla del inventario tiene el saldo viejo: se le pasa el nuevo para
      // que no haya que recargar la pantalla entera para verlo.
      onMovido?.({
        ...material,
        cantidad_disponible: movimiento.saldo_resultante,
      })
    } catch (err) {
      const detalle = err?.response?.data?.detail
      setErrorForm(
        typeof detalle === 'string'
          ? detalle
          : 'No se pudo registrar el movimiento.'
      )
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal open onClose={guardando ? undefined : onCerrar} title="Movimientos de stock">
      <p className={styles.material}>{material.nombre_activo}</p>

      {datos && (
        <div className={styles.resumen}>
          <span className={styles.saldo}>
            {datos.cantidad_disponible?.toLocaleString()}
            {material.unidad_medida ? ` ${material.unidad_medida}` : ''}
          </span>
          <Badge
            label={
              datos.cantidad_disponible <= datos.stock_minimo
                ? 'Stock bajo'
                : 'Normal'
            }
            variant={
              datos.cantidad_disponible <= datos.stock_minimo
                ? 'danger'
                : 'success'
            }
          />
          <span className={styles.minimo}>
            mínimo {datos.stock_minimo?.toLocaleString()}
          </span>
        </div>
      )}

      {/* ── Registrar un movimiento ── */}
      <fieldset className={styles.formulario}>
        <legend className={styles.leyenda}>Registrar movimiento</legend>

        {errorForm && (
          <p className={styles.errorForm} role="alert">{errorForm}</p>
        )}

        <div className={styles.campos}>
          <label className={styles.campo}>
            <span className={styles.label}>Tipo</span>
            <select
              className={styles.select}
              value={tipo}
              onChange={(e) => {
                setTipo(e.target.value)
                setErrorForm(null)
              }}
              disabled={guardando}
            >
              <option value="entrada">Entrada (suma al stock)</option>
              <option value="ajuste">Ajuste (fija el stock)</option>
            </select>
          </label>

          <label className={styles.campo}>
            <span className={styles.label}>
              {tipo === 'entrada' ? 'Unidades que entran' : 'Stock contado'}
            </span>
            <input
              type="number"
              min="1"
              step="1"
              className={styles.input}
              value={cantidad}
              onChange={(e) => {
                setCantidad(e.target.value)
                setErrorForm(null)
              }}
              disabled={guardando}
            />
          </label>
        </div>

        <label className={styles.campo}>
          <span className={styles.label}>
            Motivo {tipo === 'ajuste' && <span className={styles.req}>*</span>}
          </span>
          <input
            type="text"
            maxLength={300}
            className={styles.input}
            value={motivo}
            onChange={(e) => {
              setMotivo(e.target.value)
              setErrorForm(null)
            }}
            placeholder={
              tipo === 'ajuste'
                ? 'Ej: conteo físico del 27/10, sobraban 3'
                : 'Ej: compra a proveedor, factura 1042'
            }
            disabled={guardando}
          />
        </label>

        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={enviar}
          disabled={guardando}
        >
          {guardando
            ? <><Spinner size="sm" color="white" /> Registrando…</>
            : 'Registrar'}
        </button>
      </fieldset>

      {/* ── Historia ── */}
      <h3 className={styles.tituloHistoria}>Historia</h3>

      {cargando && (
        <div className={styles.centro}><Spinner /></div>
      )}

      {!cargando && error && (
        <div className={styles.errorCarga} role="alert">
          <span>{error}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={cargar}>
            Reintentar
          </button>
        </div>
      )}

      {!cargando && !error && datos?.movimientos.length === 0 && (
        <p className={styles.vacio}>
          Todavía no hay movimientos. Los consumos aparecen aquí cuando un
          técnico cierra una tarea anotando el material que usó.
        </p>
      )}

      {!cargando && !error && datos?.movimientos.length > 0 && (
        <div className={styles.tablaWrap}>
          <table className={styles.tabla}>
            <thead>
              <tr>
                <th>Cuándo</th>
                <th>Tipo</th>
                <th className={styles.derecha}>Cant.</th>
                <th className={styles.derecha}>Saldo</th>
                <th>Quién</th>
                <th>Tarea / motivo</th>
              </tr>
            </thead>
            <tbody>
              {datos.movimientos.map((m) => (
                <tr key={m.id_movimiento}>
                  <td className={styles.fecha}>{formatearFechaHora(m.fecha_hora)}</td>
                  <td>
                    <Badge
                      label={ETIQUETA_TIPO[m.tipo] ?? m.tipo}
                      variant={VARIANTE_TIPO[m.tipo] ?? 'muted'}
                    />
                  </td>
                  <td className={styles.derecha}>{m.cantidad?.toLocaleString()}</td>
                  <td className={`${styles.derecha} ${styles.saldoFila}`}>
                    {m.saldo_resultante?.toLocaleString()}
                  </td>
                  {/* Null cuando la cuenta o la tarea se borraron: el
                      movimiento no se reescribe, así que la fila sigue
                      contando lo que pasó aunque ya no se pueda decir quién. */}
                  <td className={styles.secundario}>{m.nombre_empleado || '—'}</td>
                  <td className={styles.secundario}>
                    {m.titulo_tarea || m.motivo || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ModalActions>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onCerrar}
          disabled={guardando}
        >
          Cerrar
        </button>
      </ModalActions>
    </Modal>
  )
}
