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