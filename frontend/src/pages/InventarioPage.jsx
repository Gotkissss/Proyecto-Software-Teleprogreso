/**
 * pages/InventarioPage.jsx
 * ---------------------------------------------------------------------------
 * Gestión de inventario de vehículos, herramientas y materiales.
 * Arquitectura modular desacoplada:
 *   - TablaVehiculos (components/inventario/TablaVehiculos)
 *   - TablaHerramientas (components/inventario/TablaHerramientas)
 *   - TablaMateriales (components/inventario/TablaMateriales)
 *   - ModalNuevoActivo (components/inventario/ModalNuevoActivo)
 *   - ModalEditarActivo (components/inventario/ModalEditarActivo)
 *   - ModalEliminarActivo (components/inventario/ModalEliminarActivo)
 *   - ModalAsignarTecnico (components/inventario/ModalAsignarTecnico)
 *   - ModalAsignarHerramientaACarro (components/inventario/ModalAsignarHerramientaACarro)
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { getCarros, getHerramientas, getMateriales } from '../api/inventarioService'
import PageState from '../components/ui/PageState'
import { useToast } from '../components/ui/Toast'
import TablaVehiculos from '../components/inventario/TablaVehiculos'
import TablaHerramientas from '../components/inventario/TablaHerramientas'
import TablaMateriales from '../components/inventario/TablaMateriales'
import ModalNuevoActivo from '../components/inventario/ModalNuevoActivo'
import ModalEditarActivo from '../components/inventario/ModalEditarActivo'
import ModalEliminarActivo from '../components/inventario/ModalEliminarActivo'
import ModalAsignarTecnico from '../components/inventario/ModalAsignarTecnico'
import ModalAsignarHerramientaACarro from '../components/inventario/ModalAsignarHerramientaACarro'
import styles from './InventarioPage.module.css'

const IconRefresh = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
  </svg>
)

const IconPlus = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="12" y1="5" x2="12" y2="19"/>
    <line x1="5" y1="12" x2="19" y2="12"/>
  </svg>
)

const IconSearch = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/>
    <line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
)

const IconX = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
)

const TABS = [
  {
    id: 'vehiculos',
    label: 'Vehículos',
    estados: [
      { value: 'todos',          label: 'Todos los estados' },
      { value: 'disponible',     label: 'Disponible' },
      { value: 'en_uso',         label: 'En uso' },
      { value: 'mantenimiento',  label: 'Mantenimiento' },
      { value: 'fuera_servicio', label: 'Fuera de servicio' },
    ],
  },
  {
    id: 'herramientas',
    label: 'Herramientas',
    estados: [
      { value: 'todos',         label: 'Todos los estados' },
      { value: 'disponible',    label: 'Disponible' },
      { value: 'en_uso',        label: 'En uso' },
      { value: 'mantenimiento', label: 'Mantenimiento' },
      { value: 'dañada',        label: 'Dañada' },
    ],
  },
  {
    id: 'materiales',
    label: 'Materiales',
    estados: [
      { value: 'todos',      label: 'Todos los niveles' },
      { value: 'normal',     label: 'Stock normal' },
      { value: 'stock_bajo', label: 'Stock bajo' },
    ],
  },
]

function filtrarYOrdenar(lista, busqueda, filtroEstado, sortConfig, tipo) {
  let result = lista.filter(item => {
    const q = busqueda.toLowerCase().trim()
    let coincide = !q
    if (!coincide) {
      const campos = [
        item.nombre_activo,
        item.placa,
        item.marca,
        item.modelo,
        item.tipo_herramienta,
        item.tipo_material,
        item.unidad_medida,
      ].filter(Boolean)
      coincide = campos.some(c => c.toLowerCase().includes(q))
    }

    let estadoOk = filtroEstado === 'todos'
    if (!estadoOk) {
      if (tipo === 'vehiculos') estadoOk = item.estado_vehiculo === filtroEstado
      else if (tipo === 'herramientas') estadoOk = item.estado === filtroEstado
      else if (filtroEstado === 'stock_bajo') estadoOk = item.cantidad_disponible <= item.stock_minimo
      else if (filtroEstado === 'normal') estadoOk = item.cantidad_disponible > item.stock_minimo
    }

    return coincide && estadoOk
  })

  if (sortConfig.key) {
    result = [...result].sort((a, b) => {
      const va = typeof a[sortConfig.key] === 'number' ? a[sortConfig.key] : String(a[sortConfig.key] ?? '').toLowerCase()
      const vb = typeof b[sortConfig.key] === 'number' ? b[sortConfig.key] : String(b[sortConfig.key] ?? '').toLowerCase()
      if (va < vb) return sortConfig.dir === 'asc' ? -1 : 1
      if (va > vb) return sortConfig.dir === 'asc' ? 1 : -1
      return 0
    })
  }

  return result
}

export default function InventarioPage() {
  const toast = useToast()
  const [tabActiva, setTabActiva] = useState('vehiculos')
  const [busqueda, setBusqueda] = useState('')
  const [filtroEstado, setFiltroEstado] = useState('todos')
  const [sortConfig, setSortConfig] = useState({ key: null, dir: 'asc' })

  // Datos
  const [vehiculos,    setVehiculos]    = useState([])
  const [herramientas, setHerramientas] = useState([])
  const [materiales,   setMateriales]   = useState([])
  const [loading,      setLoading]      = useState(false)
  const [errorCarga,   setErrorCarga]   = useState(null)

  // Modales
  const [modalNuevo,              setModalNuevo]              = useState(null)
  const [modalEditar,             setModalEditar]             = useState(null)
  const [modalEliminar,           setModalEliminar]           = useState(null)
  const [modalAsignarTecnico,     setModalAsignarTecnico]     = useState(null)
  const [modalAsignarHerramienta, setModalAsignarHerramienta] = useState(null)

  const tabInfo = TABS.find(t => t.id === tabActiva)

  const cargarDatos = useCallback(async () => {
    setLoading(true)
    setErrorCarga(null)
    try {
      const [v, h, m] = await Promise.all([getCarros(), getHerramientas(), getMateriales()])
      setVehiculos(v)
      setHerramientas(h)
      setMateriales(m)
    } catch (err) {
      setErrorCarga(err?.response?.data?.detail || 'No se pudo cargar el inventario.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    cargarDatos()
  }, [cargarDatos])

  const handleCambiarTab = (id) => {
    setTabActiva(id)
    setBusqueda('')
    setFiltroEstado('todos')
    setSortConfig({ key: null, dir: 'asc' })
  }

  const handleSort = (key) => {
    setSortConfig(prev => ({
      key,
      dir: prev.key === key && prev.dir === 'asc' ? 'desc' : 'asc',
    }))
  }

  const datosFiltrados = useMemo(() => {
    const fuente = tabActiva === 'vehiculos' ? vehiculos : tabActiva === 'herramientas' ? herramientas : materiales
    return filtrarYOrdenar(fuente, busqueda, filtroEstado, sortConfig, tabActiva)
  }, [tabActiva, vehiculos, herramientas, materiales, busqueda, filtroEstado, sortConfig])

  // Callbacks de modales
  const handleCreado = (nuevo) => {
    if (nuevo.tipo === 'carro') setVehiculos(p => [nuevo, ...p])
    else if (nuevo.tipo === 'herramienta') setHerramientas(p => [nuevo, ...p])
    else setMateriales(p => [nuevo, ...p])
    setModalNuevo(null)
    toast.success(`${nuevo.nombre_activo} se agregó al inventario.`)
  }

  const handleEditado = (actualizado) => {
    if (actualizado.tipo === 'carro') {
      setVehiculos(p => p.map(v => v.id_activo === actualizado.id_activo ? { ...v, ...actualizado } : v))
    } else if (actualizado.tipo === 'herramienta') {
      setHerramientas(p => p.map(h => h.id_activo === actualizado.id_activo ? { ...h, ...actualizado } : h))
    } else {
      setMateriales(p => p.map(m => m.id_activo === actualizado.id_activo ? { ...m, ...actualizado } : m))
    }
    setModalEditar(null)
    toast.success(`${actualizado.nombre_activo} se actualizó correctamente.`)
  }

  const handleEliminado = (id) => {
    setVehiculos(p => p.filter(v => v.id_activo !== id))
    setHerramientas(p => p.filter(h => h.id_activo !== id))
    setMateriales(p => p.filter(m => m.id_activo !== id))
    setModalEliminar(null)
    toast.success('Activo eliminado del inventario.')
  }

  const handleAsignadaACarro = () => {
    setModalAsignarHerramienta(null)
    toast.success('Herramienta asignada al vehículo.')
  }

  const handleAsignadoTecnico = (idActivo, tec) => {
    setVehiculos(p => p.map(v => v.id_activo === idActivo ? {
      ...v,
      nombre_empleado_asignado: tec ? `${tec.nombre} ${tec.apellido}` : null,
      estado_vehiculo: 'en_uso',
    } : v))
    setModalAsignarTecnico(null)
    toast.success(
      tec ? `Vehículo asignado a ${tec.nombre} ${tec.apellido}.` : 'Vehículo liberado.'
    )
  }

  return (
    <div className={styles.page}>
      {/* ── Encabezado ── */}
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.title}>Control de Inventario</h1>
          <p className={styles.subtitle}>Gestión y asignación de vehículos, herramientas y materiales operativos</p>
        </div>

        <div className={styles.headerActions}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={cargarDatos}
            disabled={loading}
            title="Actualizar datos"
          >
            <IconRefresh />
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setModalNuevo(tabActiva === 'vehiculos' ? 'carro' : tabActiva === 'herramientas' ? 'herramienta' : 'material')}
          >
            <IconPlus /> Nuevo activo
          </button>
        </div>
      </div>

      {errorCarga && (
        <PageState
          error={errorCarga}
          onRetry={cargarDatos}
          errorTitle="No se pudo cargar el inventario"
        />
      )}

      {/* ── Tabs de Navegación ── */}
      <div className={styles.tabs}>
        {TABS.map(tab => {
          const conteo = tab.id === 'vehiculos' ? vehiculos.length : tab.id === 'herramientas' ? herramientas.length : materiales.length
          return (
            <button
              key={tab.id}
              type="button"
              className={`${styles.tab} ${tabActiva === tab.id ? styles.tabActive : ''}`}
              onClick={() => handleCambiarTab(tab.id)}
            >
              <span>{tab.label}</span>
              <span className={styles.tabCount}>{conteo}</span>
            </button>
          )
        })}
      </div>

      {/* ── Toolbar / Filtros ── */}
      <div className={styles.toolbar}>
        <div className={styles.searchWrap}>
          <span className={styles.searchIcon}><IconSearch /></span>
          <input
            type="search"
            className={styles.searchInput}
            placeholder={`Buscar ${tabInfo?.label.toLowerCase()}...`}
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
          />
          {busqueda && (
            <button
              type="button"
              className={styles.searchClear}
              onClick={() => setBusqueda('')}
              aria-label="Limpiar búsqueda"
            >
              <IconX />
            </button>
          )}
        </div>

        <select
          className={styles.filterSelect}
          value={filtroEstado}
          onChange={e => setFiltroEstado(e.target.value)}
        >
          {tabInfo?.estados.map(e => (
            <option key={e.value} value={e.value}>{e.label}</option>
          ))}
        </select>
      </div>

      {/* ── Tablas Modulares ── */}
      {tabActiva === 'vehiculos' && (
        <TablaVehiculos
          datos={datosFiltrados}
          loading={loading}
          sortConfig={sortConfig}
          onSort={handleSort}
          onAsignarTecnico={v => setModalAsignarTecnico(v)}
          onEditar={v => setModalEditar(v)}
          onEliminar={v => setModalEliminar(v)}
        />
      )}

      {tabActiva === 'herramientas' && (
        <TablaHerramientas
          datos={datosFiltrados}
          loading={loading}
          sortConfig={sortConfig}
          onSort={handleSort}
          onAsignarCarro={h => setModalAsignarHerramienta(h)}
          onEditar={h => setModalEditar(h)}
          onEliminar={h => setModalEliminar(h)}
        />
      )}

      {tabActiva === 'materiales' && (
        <TablaMateriales
          datos={datosFiltrados}
          loading={loading}
          sortConfig={sortConfig}
          onSort={handleSort}
          onEditar={m => setModalEditar(m)}
          onEliminar={m => setModalEliminar(m)}
        />
      )}

      {/* ── Modales Modulares ── */}
      {modalNuevo && (
        <ModalNuevoActivo
          tipoInicial={modalNuevo}
          onCerrar={() => setModalNuevo(null)}
          onCreado={handleCreado}
        />
      )}

      {modalEditar && (
        <ModalEditarActivo
          activo={modalEditar}
          onCerrar={() => setModalEditar(null)}
          onEditado={handleEditado}
        />
      )}

      {modalEliminar && (
        <ModalEliminarActivo
          activo={modalEliminar}
          onCerrar={() => setModalEliminar(null)}
          onEliminado={handleEliminado}
        />
      )}

      {modalAsignarTecnico && (
        <ModalAsignarTecnico
          vehiculo={modalAsignarTecnico}
          onCerrar={() => setModalAsignarTecnico(null)}
          onAsignado={handleAsignadoTecnico}
        />
      )}

      {modalAsignarHerramienta && (
        <ModalAsignarHerramientaACarro
          herramienta={modalAsignarHerramienta}
          carros={vehiculos}
          onCerrar={() => setModalAsignarHerramienta(null)}
          onAsignada={handleAsignadaACarro}
        />
      )}
    </div>
  )
}
