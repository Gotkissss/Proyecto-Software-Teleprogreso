import { useState, useMemo } from 'react'
import Badge from '../components/ui/Badge'
import styles from './InventarioPage.module.css'
 
/* ── Iconos ──────────────────────────────────────────────────────────────── */
const IconCar = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 17H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v9a2 2 0 0 1-2 2h-2"/>
    <circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>
  </svg>
)
const IconTool = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
  </svg>
)
const IconBox = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
    <polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>
  </svg>
)
const IconSearch = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
)
const IconX = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
)
const IconFilter = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
  </svg>
)
const IconChevronUp = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <polyline points="18 15 12 9 6 15"/>
  </svg>
)
const IconChevronDown = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <polyline points="6 9 12 15 18 9"/>
  </svg>
)
const IconChevronsUpDown = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <polyline points="7 15 12 20 17 15"/><polyline points="7 9 12 4 17 9"/>
  </svg>
)
 
/* ── Mock data ───────────────────────────────────────────────────────────── */
const MOCK_VEHICULOS = [
  { id_activo: 1, nombre_activo: 'Pickup Toyota Hilux',  placa: 'P-123ABC', marca: 'Toyota',    modelo: 'Hilux 2022',     capacidad: 5, estado_vehiculo: 'disponible',   color: '#1e3a5f' },
  { id_activo: 2, nombre_activo: 'Van Kia Pregio',       placa: 'P-456DEF', marca: 'Kia',       modelo: 'Pregio 2021',    capacidad: 8, estado_vehiculo: 'en_uso',       color: '#2d6a4f' },
  { id_activo: 3, nombre_activo: 'Moto Honda CG 150',    placa: 'M-789GHI', marca: 'Honda',     modelo: 'CG 150 2023',    capacidad: 1, estado_vehiculo: 'disponible',   color: '#7b2d00' },
  { id_activo: 4, nombre_activo: 'Pickup Ford Ranger',   placa: 'P-321JKL', marca: 'Ford',      modelo: 'Ranger 2020',    capacidad: 5, estado_vehiculo: 'mantenimiento',color: '#1e3a5f' },
  { id_activo: 5, nombre_activo: 'Camión Isuzu NQR',     placa: 'C-654MNO', marca: 'Isuzu',     modelo: 'NQR 2019',       capacidad: 2, estado_vehiculo: 'disponible',   color: '#3d405b' },
  { id_activo: 6, nombre_activo: 'Van Mercedes Sprinter',placa: 'P-987PQR', marca: 'Mercedes',  modelo: 'Sprinter 2022',  capacidad: 9, estado_vehiculo: 'en_uso',       color: '#2d6a4f' },
]
 
const MOCK_HERRAMIENTAS = [
  { id_activo: 1,  nombre_activo: 'Escalera telescópica 6m', tipo_herramienta: 'Escalera',     marca: 'Werner',   modelo: 'MT-22', estado: 'disponible',    },
  { id_activo: 2,  nombre_activo: 'Fusionadora de fibra',     tipo_herramienta: 'Fusionadora',  marca: 'Fujikura', modelo: 'FSM-70R', estado: 'en_uso',     },
  { id_activo: 3,  nombre_activo: 'OTDR Reflectómetro',       tipo_herramienta: 'Medidor',      marca: 'EXFO',     modelo: 'MAX-715B', estado: 'disponible',},
  { id_activo: 4,  nombre_activo: 'Taladro percutor 20V',     tipo_herramienta: 'Taladro',      marca: 'Dewalt',   modelo: 'DCD796', estado: 'disponible',   },
  { id_activo: 5,  nombre_activo: 'Multímetro digital',       tipo_herramienta: 'Medidor',      marca: 'Fluke',    modelo: '117', estado: 'mantenimiento',  },
  { id_activo: 6,  nombre_activo: 'Crimpeadora RJ45',         tipo_herramienta: 'Herramienta',  marca: 'Rexlis',   modelo: 'TC-P207', estado: 'disponible', },
  { id_activo: 7,  nombre_activo: 'Escalera tijera 3m',       tipo_herramienta: 'Escalera',     marca: 'Louisville',modelo: 'FS1506', estado: 'en_uso',     },
  { id_activo: 8,  nombre_activo: 'Power Meter fibra óptica', tipo_herramienta: 'Medidor',      marca: 'Grandway', modelo: 'FHP-M200', estado: 'disponible',},
]
 
const MOCK_MATERIALES = [
  { id_activo: 1, nombre_activo: 'Cable fibra óptica G657A2',   tipo_material: 'Cable',      unidad_medida: 'metro',  cantidad_disponible: 1500, stock_minimo: 200 },
  { id_activo: 2, nombre_activo: 'Conector SC/APC',             tipo_material: 'Conector',   unidad_medida: 'unidad', cantidad_disponible: 320,  stock_minimo: 50  },
  { id_activo: 3, nombre_activo: 'Manga de empalme dome 24FO',  tipo_material: 'Accesorio',  unidad_medida: 'unidad', cantidad_disponible: 45,   stock_minimo: 10  },
  { id_activo: 4, nombre_activo: 'ONT ZTE F670L',               tipo_material: 'Equipo',     unidad_medida: 'unidad', cantidad_disponible: 18,   stock_minimo: 5   },
  { id_activo: 5, nombre_activo: 'Cable UTP Cat 6 Panduit',     tipo_material: 'Cable',      unidad_medida: 'metro',  cantidad_disponible: 800,  stock_minimo: 100 },
  { id_activo: 6, nombre_activo: 'Patch cord LC/UPC 1m',        tipo_material: 'Cable',      unidad_medida: 'unidad', cantidad_disponible: 95,   stock_minimo: 20  },
  { id_activo: 7, nombre_activo: 'Grapa plástica negra 1/4"',   tipo_material: 'Fijación',   unidad_medida: 'caja',   cantidad_disponible: 60,   stock_minimo: 10  },
  { id_activo: 8, nombre_activo: 'Router MikroTik hAP ac²',     tipo_material: 'Equipo',     unidad_medida: 'unidad', cantidad_disponible: 8,    stock_minimo: 3   },
]
 
/* ── Helpers ─────────────────────────────────────────────────────────────── */
const ESTADO_VEHICULO_VARIANT = {
  disponible:    'success',
  en_uso:        'info',
  mantenimiento: 'warning',
  fuera_servicio:'danger',
}
const ESTADO_VEHICULO_LABEL = {
  disponible:    'Disponible',
  en_uso:        'En uso',
  mantenimiento: 'Mantenimiento',
  fuera_servicio:'Fuera de servicio',
}
const ESTADO_HERR_VARIANT = {
  disponible:    'success',
  en_uso:        'info',
  mantenimiento: 'warning',
  dañada:        'danger',
}
const ESTADO_HERR_LABEL = {
  disponible:    'Disponible',
  en_uso:        'En uso',
  mantenimiento: 'Mantenimiento',
  dañada:        'Dañada',
}
 
/* Miniatura de vehículo generada con SVG inline */
function VehiculoMiniatura({ marca, color = '#1e3a5f' }) {
  const inicial = marca?.[0]?.toUpperCase() ?? 'V'
  return (
    <div className={styles.miniatura} style={{ background: color + '18', borderColor: color + '30' }}>
      <svg viewBox="0 0 40 28" width="40" height="28" fill="none">
        {/* Carrocería */}
        <rect x="2" y="14" width="36" height="10" rx="2" fill={color} opacity="0.85"/>
        {/* Cabina */}
        <path d="M8 14 L12 6 L28 6 L34 14 Z" fill={color}/>
        {/* Ventana */}
        <path d="M13 13 L15 8 L26 8 L29 13 Z" fill="white" opacity="0.4"/>
        {/* Ruedas */}
        <circle cx="10" cy="24" r="3.5" fill="#1a202c"/>
        <circle cx="10" cy="24" r="1.5" fill="#718096"/>
        <circle cx="30" cy="24" r="3.5" fill="#1a202c"/>
        <circle cx="30" cy="24" r="1.5" fill="#718096"/>
      </svg>
      <span className={styles.miniaturaLabel}>{inicial}</span>
    </div>
  )
}
 
/* Miniatura de herramienta */
function HerramientaMiniatura({ tipo }) {
  const colores = {
    Escalera:    { bg: '#e3f2fd', color: '#1565c0' },
    Fusionadora: { bg: '#fce4ec', color: '#c62828' },
    Medidor:     { bg: '#e8f5e9', color: '#2e7d32' },
    Taladro:     { bg: '#fff3e0', color: '#e65100' },
    Herramienta: { bg: '#ede7f6', color: '#4527a0' },
  }
  const { bg, color } = colores[tipo] ?? { bg: '#f5f5f5', color: '#555' }
  return (
    <div className={styles.miniatura} style={{ background: bg, borderColor: color + '30' }}>
      <span style={{ color, fontSize: 18, display: 'flex', alignItems: 'center' }}>
        <IconTool />
      </span>
    </div>
  )
}
 
/* Miniatura de material */
function MaterialMiniatura({ tipo }) {
  const colores = {
    Cable:    { bg: '#e8f5e9', color: '#2e7d32' },
    Conector: { bg: '#e3f2fd', color: '#1565c0' },
    Accesorio:{ bg: '#fff3e0', color: '#e65100' },
    Equipo:   { bg: '#fce4ec', color: '#c62828' },
    Fijación: { bg: '#ede7f6', color: '#4527a0' },
  }
  const { bg, color } = colores[tipo] ?? { bg: '#f5f5f5', color: '#555' }
  return (
    <div className={styles.miniatura} style={{ background: bg, borderColor: color + '30' }}>
      <span style={{ color, fontSize: 18, display: 'flex', alignItems: 'center' }}>
        <IconBox />
      </span>
    </div>
  )
}

function TablaVehiculos({ busqueda, filtroEstado, sortConfig, onSort }) {
  const SortIcon = ({ col }) => {
    if (sortConfig.key !== col) return <span className={styles.sortNeutral}><IconChevronsUpDown /></span>
    return sortConfig.dir === 'asc'
      ? <span className={styles.sortActive}><IconChevronUp /></span>
      : <span className={styles.sortActive}><IconChevronDown /></span>
  }
 
  const datos = useMemo(() => {
    let lista = MOCK_VEHICULOS.filter(v => {
      const q = busqueda.toLowerCase()
      const coincide = !q ||
        v.nombre_activo.toLowerCase().includes(q) ||
        v.placa.toLowerCase().includes(q) ||
        v.marca.toLowerCase().includes(q) ||
        v.modelo.toLowerCase().includes(q)
      const estado = filtroEstado === 'todos' || v.estado_vehiculo === filtroEstado
      return coincide && estado
    })
    if (sortConfig.key) {
      lista = [...lista].sort((a, b) => {
        const va = String(a[sortConfig.key] ?? '').toLowerCase()
        const vb = String(b[sortConfig.key] ?? '').toLowerCase()
        if (va < vb) return sortConfig.dir === 'asc' ? -1 : 1
        if (va > vb) return sortConfig.dir === 'asc' ?  1 : -1
        return 0
      })
    }
    return lista
  }, [busqueda, filtroEstado, sortConfig])
 
  if (datos.length === 0) {
    return (
      <div className={styles.emptyState}>
        <div className={styles.emptyIcon}><IconCar /></div>
        <p className={styles.emptyMsg}>No se encontraron vehículos con esos criterios.</p>
      </div>
    )
  }
 
  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead className={styles.thead}>
          <tr>
            <th className={styles.th}>Vehículo</th>
            <th className={`${styles.th} ${styles.thSortable}`} onClick={() => onSort('placa')}>
              <span>Placa</span><SortIcon col="placa" />
            </th>
            <th className={`${styles.th} ${styles.thSortable}`} onClick={() => onSort('marca')}>
              <span>Marca</span><SortIcon col="marca" />
            </th>
            <th className={`${styles.th} ${styles.thSortable}`} onClick={() => onSort('modelo')}>
              <span>Modelo</span><SortIcon col="modelo" />
            </th>
            <th className={styles.th}>Cap.</th>
            <th className={`${styles.th} ${styles.thSortable}`} onClick={() => onSort('estado_vehiculo')}>
              <span>Estado</span><SortIcon col="estado_vehiculo" />
            </th>
          </tr>
        </thead>
        <tbody>
          {datos.map(v => (
            <tr key={v.id_activo} className={styles.tr}>
              <td className={styles.td}>
                <div className={styles.activoCell}>
                  <VehiculoMiniatura marca={v.marca} color={v.color} />
                  <span className={styles.activoNombre}>{v.nombre_activo}</span>
                </div>
              </td>
              <td className={styles.td}>
                <span className={styles.placaTag}>{v.placa}</span>
              </td>
              <td className={styles.td}>
                <span className={styles.textoSecundario}>{v.marca}</span>
              </td>
              <td className={styles.td}>
                <span className={styles.textoSecundario}>{v.modelo}</span>
              </td>
              <td className={styles.td}>
                <span className={styles.capacidadBadge}>{v.capacidad}</span>
              </td>
              <td className={styles.td}>
                <Badge
                  label={ESTADO_VEHICULO_LABEL[v.estado_vehiculo] ?? v.estado_vehiculo}
                  variant={ESTADO_VEHICULO_VARIANT[v.estado_vehiculo] ?? 'muted'}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={styles.resultCount}>
        Mostrando {datos.length} de {MOCK_VEHICULOS.length} vehículos
      </p>
    </div>
  )
}
 
function TablaHerramientas({ busqueda, filtroEstado, sortConfig, onSort }) {
  const SortIcon = ({ col }) => {
    if (sortConfig.key !== col) return <span className={styles.sortNeutral}><IconChevronsUpDown /></span>
    return sortConfig.dir === 'asc'
      ? <span className={styles.sortActive}><IconChevronUp /></span>
      : <span className={styles.sortActive}><IconChevronDown /></span>
  }
 
  const datos = useMemo(() => {
    let lista = MOCK_HERRAMIENTAS.filter(h => {
      const q = busqueda.toLowerCase()
      const coincide = !q ||
        h.nombre_activo.toLowerCase().includes(q) ||
        (h.tipo_herramienta ?? '').toLowerCase().includes(q) ||
        (h.marca ?? '').toLowerCase().includes(q) ||
        (h.modelo ?? '').toLowerCase().includes(q)
      const estado = filtroEstado === 'todos' || h.estado === filtroEstado
      return coincide && estado
    })
    if (sortConfig.key) {
      lista = [...lista].sort((a, b) => {
        const va = String(a[sortConfig.key] ?? '').toLowerCase()
        const vb = String(b[sortConfig.key] ?? '').toLowerCase()
        if (va < vb) return sortConfig.dir === 'asc' ? -1 : 1
        if (va > vb) return sortConfig.dir === 'asc' ?  1 : -1
        return 0
      })
    }
    return lista
  }, [busqueda, filtroEstado, sortConfig])
 
  if (datos.length === 0) {
    return (
      <div className={styles.emptyState}>
        <div className={styles.emptyIcon}><IconTool /></div>
        <p className={styles.emptyMsg}>No se encontraron herramientas con esos criterios.</p>
      </div>
    )
  }
 
  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead className={styles.thead}>
          <tr>
            <th className={styles.th}>Herramienta</th>
            <th className={`${styles.th} ${styles.thSortable}`} onClick={() => onSort('tipo_herramienta')}>
              <span>Tipo</span><SortIcon col="tipo_herramienta" />
            </th>
            <th className={`${styles.th} ${styles.thSortable}`} onClick={() => onSort('marca')}>
              <span>Marca</span><SortIcon col="marca" />
            </th>
            <th className={`${styles.th} ${styles.thSortable}`} onClick={() => onSort('modelo')}>
              <span>Modelo</span><SortIcon col="modelo" />
            </th>
            <th className={`${styles.th} ${styles.thSortable}`} onClick={() => onSort('estado')}>
              <span>Estado</span><SortIcon col="estado" />
            </th>
          </tr>
        </thead>
        <tbody>
          {datos.map(h => (
            <tr key={h.id_activo} className={styles.tr}>
              <td className={styles.td}>
                <div className={styles.activoCell}>
                  <HerramientaMiniatura tipo={h.tipo_herramienta} />
                  <span className={styles.activoNombre}>{h.nombre_activo}</span>
                </div>
              </td>
              <td className={styles.td}>
                <span className={styles.tipoTag}>{h.tipo_herramienta}</span>
              </td>
              <td className={styles.td}>
                <span className={styles.textoSecundario}>{h.marca}</span>
              </td>
              <td className={styles.td}>
                <span className={styles.textoSecundario}>{h.modelo}</span>
              </td>
              <td className={styles.td}>
                <Badge
                  label={ESTADO_HERR_LABEL[h.estado] ?? h.estado}
                  variant={ESTADO_HERR_VARIANT[h.estado] ?? 'muted'}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={styles.resultCount}>
        Mostrando {datos.length} de {MOCK_HERRAMIENTAS.length} herramientas
      </p>
    </div>
  )
}
 
/* ── Tabla Materiales ────────────────────────────────────────────────────── */
function TablaMateriales({ busqueda, filtroEstado, sortConfig, onSort }) {
  const SortIcon = ({ col }) => {
    if (sortConfig.key !== col) return <span className={styles.sortNeutral}><IconChevronsUpDown /></span>
    return sortConfig.dir === 'asc'
      ? <span className={styles.sortActive}><IconChevronUp /></span>
      : <span className={styles.sortActive}><IconChevronDown /></span>
  }
 
  const datos = useMemo(() => {
    let lista = MOCK_MATERIALES.filter(m => {
      const q = busqueda.toLowerCase()
      const coincide = !q ||
        m.nombre_activo.toLowerCase().includes(q) ||
        (m.tipo_material ?? '').toLowerCase().includes(q) ||
        (m.unidad_medida ?? '').toLowerCase().includes(q)
      // Para materiales el filtro de estado aplica a stock bajo vs normal
      if (filtroEstado === 'stock_bajo') return coincide && m.cantidad_disponible <= m.stock_minimo
      if (filtroEstado === 'normal')     return coincide && m.cantidad_disponible > m.stock_minimo
      return coincide
    })
    if (sortConfig.key) {
      lista = [...lista].sort((a, b) => {
        const va = sortConfig.key === 'cantidad_disponible'
          ? (a[sortConfig.key] ?? 0)
          : String(a[sortConfig.key] ?? '').toLowerCase()
        const vb = sortConfig.key === 'cantidad_disponible'
          ? (b[sortConfig.key] ?? 0)
          : String(b[sortConfig.key] ?? '').toLowerCase()
        if (va < vb) return sortConfig.dir === 'asc' ? -1 : 1
        if (va > vb) return sortConfig.dir === 'asc' ?  1 : -1
        return 0
      })
    }
    return lista
  }, [busqueda, filtroEstado, sortConfig])
 
  if (datos.length === 0) {
    return (
      <div className={styles.emptyState}>
        <div className={styles.emptyIcon}><IconBox /></div>
        <p className={styles.emptyMsg}>No se encontraron materiales con esos criterios.</p>
      </div>
    )
  }
 
  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead className={styles.thead}>
          <tr>
            <th className={styles.th}>Material</th>
            <th className={`${styles.th} ${styles.thSortable}`} onClick={() => onSort('tipo_material')}>
              <span>Tipo</span><SortIcon col="tipo_material" />
            </th>
            <th className={`${styles.th} ${styles.thSortable}`} onClick={() => onSort('unidad_medida')}>
              <span>Unidad</span><SortIcon col="unidad_medida" />
            </th>
            <th className={`${styles.th} ${styles.thSortable}`} onClick={() => onSort('cantidad_disponible')}>
              <span>Cantidad</span><SortIcon col="cantidad_disponible" />
            </th>
            <th className={styles.th}>Stock mínimo</th>
            <th className={styles.th}>Nivel</th>
          </tr>
        </thead>
        <tbody>
          {datos.map(m => {
            const stockBajo = m.cantidad_disponible <= m.stock_minimo
            const pct = Math.min(100, Math.round((m.cantidad_disponible / Math.max(m.stock_minimo * 3, 1)) * 100))
            return (
              <tr key={m.id_activo} className={styles.tr}>
                <td className={styles.td}>
                  <div className={styles.activoCell}>
                    <MaterialMiniatura tipo={m.tipo_material} />
                    <span className={styles.activoNombre}>{m.nombre_activo}</span>
                  </div>
                </td>
                <td className={styles.td}>
                  <span className={styles.tipoTag}>{m.tipo_material}</span>
                </td>
                <td className={styles.td}>
                  <span className={styles.textoSecundario}>{m.unidad_medida}</span>
                </td>
                <td className={styles.td}>
                  <span className={`${styles.cantidadNum} ${stockBajo ? styles.cantidadBaja : ''}`}>
                    {m.cantidad_disponible.toLocaleString()}
                  </span>
                </td>
                <td className={styles.td}>
                  <span className={styles.textoSecundario}>{m.stock_minimo.toLocaleString()}</span>
                </td>
                <td className={styles.td}>
                  <div className={styles.stockBarWrap}>
                    <div className={styles.stockBar}>
                      <div
                        className={`${styles.stockBarFill} ${stockBajo ? styles.stockBarBajo : styles.stockBarOk}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <Badge
                      label={stockBajo ? 'Stock bajo' : 'Normal'}
                      variant={stockBajo ? 'danger' : 'success'}
                    />
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className={styles.resultCount}>
        Mostrando {datos.length} de {MOCK_MATERIALES.length} materiales
      </p>
    </div>
  )
}
 
/* ── Configuración de tabs ───────────────────────────────────────────────── */
const TABS = [
  {
    id: 'vehiculos',
    label: 'Vehículos',
    Icon: IconCar,
    total: MOCK_VEHICULOS.length,
    estados: [
      { value: 'todos',         label: 'Todos los estados' },
      { value: 'disponible',    label: 'Disponible' },
      { value: 'en_uso',        label: 'En uso' },
      { value: 'mantenimiento', label: 'Mantenimiento' },
      { value: 'fuera_servicio',label: 'Fuera de servicio' },
    ],
  },
  {
    id: 'herramientas',
    label: 'Herramientas',
    Icon: IconTool,
    total: MOCK_HERRAMIENTAS.length,
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
    Icon: IconBox,
    total: MOCK_MATERIALES.length,
    estados: [
      { value: 'todos',      label: 'Todos' },
      { value: 'normal',     label: 'Stock normal' },
      { value: 'stock_bajo', label: 'Stock bajo' },
    ],
  },
]
 
/* ── Componente principal ────────────────────────────────────────────────── */
export default function InventarioPage() {
  const [tabActiva,    setTabActiva]    = useState('vehiculos')
  const [busqueda,     setBusqueda]     = useState('')
  const [filtroEstado, setFiltroEstado] = useState('todos')
  const [sortConfig,   setSortConfig]   = useState({ key: null, dir: 'asc' })
 
  const tabInfo = TABS.find(t => t.id === tabActiva)
 
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
 
  return (
    <div className={styles.page}>
      {/* ── Header ── */}
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.title}>Inventario</h1>
          <p className={styles.subtitle}>Consulta y seguimiento de activos operativos</p>
        </div>
      </div>
 
      {/* ── Tabs ── */}
      <div className={styles.tabsWrapper}>
        <div className={styles.tabs}>
          {TABS.map(tab => (
            <button
              key={tab.id}
              className={`${styles.tab} ${tabActiva === tab.id ? styles.tabActive : ''}`}
              onClick={() => handleCambiarTab(tab.id)}
            >
              <span className={styles.tabIcon}><tab.Icon /></span>
              <span className={styles.tabLabel}>{tab.label}</span>
              <span className={`${styles.tabCount} ${tabActiva === tab.id ? styles.tabCountActive : ''}`}>
                {tab.total}
              </span>
            </button>
          ))}
        </div>
      </div>
 
      {/* ── Toolbar: buscador + filtro ── */}
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
            <button className={styles.searchClear} onClick={() => setBusqueda('')} aria-label="Limpiar">
              <IconX />
            </button>
          )}
        </div>
        <div className={styles.filterWrap}>
          <span className={styles.filterIcon}><IconFilter /></span>
          <select
            className={styles.filterSelect}
            value={filtroEstado}
            onChange={e => { setFiltroEstado(e.target.value); setSortConfig({ key: null, dir: 'asc' }) }}
          >
            {tabInfo?.estados.map(e => (
              <option key={e.value} value={e.value}>{e.label}</option>
            ))}
          </select>
        </div>
      </div>
 
      {/* ── Contenido por tab ── */}
      <div className={styles.tabContent}>
        {tabActiva === 'vehiculos' && (
          <TablaVehiculos
            busqueda={busqueda}
            filtroEstado={filtroEstado}
            sortConfig={sortConfig}
            onSort={handleSort}
          />
        )}
        {tabActiva === 'herramientas' && (
          <TablaHerramientas
            busqueda={busqueda}
            filtroEstado={filtroEstado}
            sortConfig={sortConfig}
            onSort={handleSort}
          />
        )}
        {tabActiva === 'materiales' && (
          <TablaMateriales
            busqueda={busqueda}
            filtroEstado={filtroEstado}
            sortConfig={sortConfig}
            onSort={handleSort}
          />
        )}
      </div>
    </div>
  )
}
 