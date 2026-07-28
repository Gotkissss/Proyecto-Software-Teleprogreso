/**
 * Modal con multi-select de herramientas disponibles para asignar a un carro.
 *
 * Props:
 *   carro           {object}   - Vehículo destino { id_activo, placa, marca, modelo }
 *   herramientasYa  {number[]} - IDs de herramientas ya asignadas (para excluirlas)
 *   onAsignar       {fn}       - Callback(idsSeleccionados[]) llamado al confirmar
 *   onCerrar        {fn}       - Callback para cerrar el modal
 *
 * Consume los endpoints reales de carroService.js
 * (GET /activos/herramientas y POST /activos/carros/{id}/herramientas).
 * ---------------------------------------------------------------------------
 */

import { useState, useEffect, useMemo } from 'react'
import Modal, { ModalActions } from '../ui/Modal'
import Spinner from '../ui/Spinner'
import styles from './ModalAsignarHerramientas.module.css'
import { getHerramientas } from '../../api/carroService'

/*  Iconos  */
const IconX = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
)
const IconSearch = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
)
const IconCheck = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
)
const IconWrench = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
  </svg>
)
const IconCar = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 17H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v9a2 2 0 0 1-2 2h-1"/>
    <circle cx="7.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>
  </svg>
)
const IconFilter = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
  </svg>
)


/* Componente  */
export default function ModalAsignarHerramientas({
  carro,
  herramientasYa = [],
  onAsignar,
  onCerrar,
}) {
  const [herramientas,   setHerramientas]   = useState([])
  const [loading,        setLoading]        = useState(true)
  const [guardando,      setGuardando]      = useState(false)
  const [error,          setError]          = useState(null)
  const [seleccionados,  setSeleccionados]  = useState([])  // IDs seleccionados
  const [busqueda,       setBusqueda]       = useState('')
  const [filtroTipo,     setFiltroTipo]     = useState('todos')

  /* Cargar herramientas disponibles */
  useEffect(() => {
    const fetchHerramientas = async () => {
      setLoading(true)
      try {
        const data = await getHerramientas()
        // Excluir las ya asignadas al carro y las que no están disponibles
        const disponibles = data.filter(
          (h) => !herramientasYa.includes(h.id_activo) && h.estado === 'disponible'
        )
        setHerramientas(disponibles)
      } catch (err) {
        setError('No se pudieron cargar las herramientas disponibles.')
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    fetchHerramientas()
  }, [herramientasYa])

  /* Tipos únicos para el filtro */
  const tipos = useMemo(() => {
    const set = new Set(herramientas.map((h) => h.tipo_herramienta).filter(Boolean))
    return ['todos', ...Array.from(set).sort()]
  }, [herramientas])

  /* Herramientas filtradas */
  const filtradas = useMemo(() => {
    return herramientas.filter((h) => {
      const texto = busqueda.toLowerCase()
      const coincideBusqueda =
        !texto ||
        h.nombre_activo.toLowerCase().includes(texto) ||
        (h.marca ?? '').toLowerCase().includes(texto) ||
        (h.tipo_herramienta ?? '').toLowerCase().includes(texto)
      const coincideTipo = filtroTipo === 'todos' || h.tipo_herramienta === filtroTipo
      return coincideBusqueda && coincideTipo
    })
  }, [herramientas, busqueda, filtroTipo])

  const toggleSeleccion = (id) => {
    setSeleccionados((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  const toggleTodos = () => {
    const idsFiltrados = filtradas.map((h) => h.id_activo)
    const todosSeleccionados = idsFiltrados.every((id) => seleccionados.includes(id))
    if (todosSeleccionados) {
      setSeleccionados((prev) => prev.filter((id) => !idsFiltrados.includes(id)))
    } else {
      setSeleccionados((prev) => [...new Set([...prev, ...idsFiltrados])])
    }
  }

  const handleConfirmar = async () => {
    if (seleccionados.length === 0) return
    setGuardando(true)
    setError(null)
    try {
      await onAsignar(seleccionados)
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Error al asignar herramientas.')
      setGuardando(false)
    }
  }

  const todosVisiblesMarcados =
    filtradas.length > 0 && filtradas.every((h) => seleccionados.includes(h.id_activo))

  return (
    <Modal
      open={Boolean(carro)}
      onClose={onCerrar}
      title="Asignar herramientas"
      width={640}
    >
        <p className={styles.headerSubtitle}>
          <IconCar />
          {carro.placa} — {carro.marca ?? ''} {carro.modelo ?? ''}
        </p>

        {/* Barra de búsqueda y filtro  */}
        <div className={styles.toolbar}>
          <div className={styles.searchWrap}>
            <span className={styles.searchIcon}><IconSearch /></span>
            <input
              type="search"
              className={styles.searchInput}
              placeholder="Buscar herramienta, marca, tipo..."
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              disabled={loading}
            />
            {busqueda && (
              <button
                className={styles.searchClear}
                onClick={() => setBusqueda('')}
                aria-label="Limpiar"
              >
                <IconX />
              </button>
            )}
          </div>

          <div className={styles.filterWrap}>
            <span className={styles.filterIcon}><IconFilter /></span>
            <select
              className={styles.filterSelect}
              value={filtroTipo}
              onChange={(e) => setFiltroTipo(e.target.value)}
              disabled={loading}
            >
              {tipos.map((t) => (
                <option key={t} value={t}>
                  {t === 'todos' ? 'Todos los tipos' : t}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/*Cabecera de lista (seleccionar todos + contador)  */}
        {!loading && filtradas.length > 0 && (
          <div className={styles.listHeader}>
            <label className={styles.checkAll}>
              <input
                type="checkbox"
                checked={todosVisiblesMarcados}
                onChange={toggleTodos}
                className={styles.checkbox}
              />
              <span>
                {todosVisiblesMarcados
                  ? 'Deseleccionar todos'
                  : `Seleccionar todos (${filtradas.length})`}
              </span>
            </label>
            {seleccionados.length > 0 && (
              <span className={styles.selectedCount}>
                {seleccionados.length} seleccionada{seleccionados.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        )}

        {/* Lista de herramientas */}
        <div className={styles.listWrap}>
          {loading ? (
            <div className={styles.center}>
              <Spinner size="lg" />
              <p className={styles.loadingText}>Cargando herramientas...</p>
            </div>
          ) : error ? (
            <p className={styles.errorMsg}>{error}</p>
          ) : filtradas.length === 0 ? (
            <div className={styles.emptyWrap}>
              <span className={styles.emptyIcon}><IconWrench /></span>
              <p className={styles.emptyMsg}>
                {herramientas.length === 0
                  ? 'No hay herramientas disponibles para asignar.'
                  : 'Ninguna herramienta coincide con la búsqueda.'}
              </p>
              {busqueda && (
                <button
                  className={styles.clearFilterBtn}
                  onClick={() => { setBusqueda(''); setFiltroTipo('todos') }}
                >
                  Limpiar filtros
                </button>
              )}
            </div>
          ) : (
            <ul className={styles.list}>
              {filtradas.map((herr) => {
                const isSelected = seleccionados.includes(herr.id_activo)
                return (
                  <li key={herr.id_activo}>
                    <label
                      className={`${styles.item} ${isSelected ? styles.itemSelected : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSeleccion(herr.id_activo)}
                        className={styles.checkbox}
                      />

                      <div className={styles.itemIconWrap}>
                        <IconWrench />
                      </div>

                      <div className={styles.itemInfo}>
                        <span className={styles.itemNombre}>{herr.nombre_activo}</span>
                        <span className={styles.itemMeta}>
                          {[herr.tipo_herramienta, herr.marca, herr.modelo]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </div>

                      <span className={`${styles.itemEstado} ${styles[`estado_${herr.estado}`]}`}>
                        {herr.estado}
                      </span>

                      {isSelected && (
                        <span className={styles.itemCheckMark}>
                          <IconCheck />
                        </span>
                      )}
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Error de guardado */}
        {error && !loading && (
          <p className={styles.saveError}>{error}</p>
        )}

        {/*  Pie con botones */}
        <ModalActions>
          <button className={styles.cancelBtn} onClick={onCerrar} disabled={guardando}>
            Cancelar
          </button>
          <button
            className={styles.confirmBtn}
            onClick={handleConfirmar}
            disabled={seleccionados.length === 0 || guardando}
          >
            {guardando ? (
              <><Spinner size="sm" color="white" /> Asignando...</>
            ) : (
              <>
                <IconCheck />
                Asignar {seleccionados.length > 0 && `(${seleccionados.length})`}
              </>
            )}
          </button>
        </ModalActions>
    </Modal>
  )
}