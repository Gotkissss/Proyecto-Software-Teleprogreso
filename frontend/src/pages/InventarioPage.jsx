import React, { useState, useMemo, useEffect, useCallback } from 'react'
import Badge from '../components/ui/Badge'
import Spinner from '../components/ui/Spinner'
import PageState from '../components/ui/PageState'
import { useToast } from '../components/ui/Toast'
import styles from './InventarioPage.module.css'
import {
  getCarros, getHerramientas, getMateriales,
  crearActivo, editarActivo, eliminarActivo,
  asignarTecnicoACarro,
  asignarHerramientaACarro,
} from '../api/inventarioService'
import { getTecnicosDisponibles } from '../api/tareaService'

/* ── Iconos ──────────────────────────────────────────────────────────────── */
const IconCar = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 17H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v9a2 2 0 0 1-2 2h-2"/>
    <circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>
  </svg>
)
const IconTool = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
  </svg>
)
const IconBox = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
    <polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>
  </svg>
)
const IconSearch = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
)
const IconX = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
)
const IconFilter = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
  </svg>
)
const IconChevronUp = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <polyline points="18 15 12 9 6 15"/>
  </svg>
)
const IconChevronDown = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <polyline points="6 9 12 15 18 9"/>
  </svg>
)
const IconChevronsUpDown = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <polyline points="7 15 12 20 17 15"/><polyline points="7 9 12 4 17 9"/>
  </svg>
)
const IconPlus = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
  </svg>
)
const IconEdit = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
  </svg>
)
const IconTrash = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
    <path d="M10 11v6"/><path d="M14 11v6"/>
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
  </svg>
)
const IconRefresh = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10"/>
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
  </svg>
)

/* ── Helpers ─────────────────────────────────────────────────────────────── */
const ESTADO_VEHICULO_VARIANT = {
  disponible: 'success', en_uso: 'info', mantenimiento: 'warning', fuera_servicio: 'danger',
}
const ESTADO_VEHICULO_LABEL = {
  disponible: 'Disponible', en_uso: 'En uso', mantenimiento: 'Mantenimiento', fuera_servicio: 'Fuera de servicio',
}
const ESTADO_HERR_VARIANT = {
  disponible: 'success', en_uso: 'info', mantenimiento: 'warning', dañada: 'danger',
}
const ESTADO_HERR_LABEL = {
  disponible: 'Disponible', en_uso: 'En uso', mantenimiento: 'Mantenimiento', dañada: 'Dañada',
}

const BASE_URL = import.meta.env.VITE_API_URL ||
  (window.location.hostname === 'localhost' ? 'http://localhost:8000' : 'https://backend-production-6d60.up.railway.app')

function fotoUrl(url) {
  if (!url) return null
  if (url.startsWith('http')) return url
  return BASE_URL + url
}

/* Miniaturas placeholder cuando no hay imagen */
function VehiculoMiniatura({ marca, fotoUrl: foto, color = '#1e3a5f' }) {
  if (foto) return <img src={foto} alt={marca} className={styles.miniaturaImg} />
  const inicial = marca?.[0]?.toUpperCase() ?? 'V'
  return (
    <div className={styles.miniatura} style={{ background: color + '18', borderColor: color + '30' }}>
      <svg viewBox="0 0 40 28" width="40" height="28" fill="none">
        <rect x="2" y="14" width="36" height="10" rx="2" fill={color} opacity="0.85"/>
        <path d="M8 14 L12 6 L28 6 L34 14 Z" fill={color}/>
        <path d="M13 13 L15 8 L26 8 L29 13 Z" fill="white" opacity="0.4"/>
        <circle cx="10" cy="24" r="3.5" fill="#1a202c"/>
        <circle cx="10" cy="24" r="1.5" fill="#718096"/>
        <circle cx="30" cy="24" r="3.5" fill="#1a202c"/>
        <circle cx="30" cy="24" r="1.5" fill="#718096"/>
      </svg>
      <span className={styles.miniaturaLabel}>{inicial}</span>
    </div>
  )
}
function HerramientaMiniatura({ tipo, foto }) {
  if (foto) return <img src={foto} alt={tipo} className={styles.miniaturaImg} />
  return (
    <div className={styles.miniatura} style={{ background: '#e3f2fd', borderColor: '#1565c030' }}>
      <span style={{ color: '#1565c0', fontSize: 18, display: 'flex', alignItems: 'center' }}><IconTool /></span>
    </div>
  )
}
function MaterialMiniatura({ tipo, foto }) {
  if (foto) return <img src={foto} alt={tipo} className={styles.miniaturaImg} />
  return (
    <div className={styles.miniatura} style={{ background: '#e8f5e9', borderColor: '#2e7d3230' }}>
      <span style={{ color: '#2e7d32', fontSize: 18, display: 'flex', alignItems: 'center' }}><IconBox /></span>
    </div>
  )
}

/* ── MODAL: Asignar técnico ──────────────────────────────────────────────── */
function ModalAsignarTecnico({ vehiculo, onCerrar, onAsignado }) {
  const [tecnicos, setTecnicos] = useState([])
  const [loading, setLoading] = useState(true)
  const [tecnicoId, setTecnicoId] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    // Se usa el mismo endpoint que el resto de la app para pedir técnicos.
    //
    // Antes iba contra `/empleados?rol=tecnico&estado=activo`, que es la
    // gestión de personal y exige rol admin: a un supervisor le respondía 403
    // y este modal le mostraba "No se pudo cargar la lista de técnicos" sin
    // más pistas. `/empleados/tecnicos/disponibles` existe justamente para
    // esto, lo admite el supervisor y además trae la carga de trabajo de cada
    // uno, así que la lista dice lo mismo aquí que en Reasignación.
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
      setError(err?.response?.data?.detail || 'Error al asignar técnico.')
      setGuardando(false)
    }
  }

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(11,30,58,0.5)',backdropFilter:'blur(6px)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:300,padding:'24px'}} onClick={onCerrar}>
      <div style={{background:'var(--color-surface)',border:'1px solid var(--color-border)',borderRadius:'var(--radius-2xl)',boxShadow:'var(--shadow-xl)',width:'100%',maxWidth:'480px',padding:'32px'}} onClick={e=>e.stopPropagation()}>
        <h2 style={{fontSize:'1.125rem',fontWeight:800,color:'var(--color-text)',margin:'0 0 4px'}}>Asignar técnico</h2>
        <p style={{fontSize:'0.875rem',color:'var(--color-text-secondary)',margin:'0 0 20px'}}>
          Vehículo: <strong>{vehiculo.placa}</strong> — {vehiculo.nombre_activo}
        </p>
        {error && <div style={{background:'var(--color-danger-bg)',border:'1px solid var(--color-danger-light)',color:'var(--color-danger-dark)',borderRadius:'var(--radius-md)',padding:'10px 14px',fontSize:'0.8125rem',marginBottom:'16px'}}>{error}</div>}
        {loading ? <div style={{textAlign:'center',padding:'20px'}}><Spinner size="md"/></div> : (
          <>
            <label style={{display:'block',fontSize:'0.75rem',fontWeight:700,color:'var(--color-text-secondary)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:'8px'}}>Seleccionar técnico</label>
            <select value={tecnicoId} onChange={e=>setTecnicoId(e.target.value)} disabled={guardando}
              style={{width:'100%',height:'46px',padding:'0 40px 0 14px',border:'1.5px solid var(--color-border)',borderRadius:'var(--radius-md)',fontSize:'0.9375rem',color:'var(--color-text)',background:'var(--color-bg)',outline:'none',appearance:'none',backgroundImage:"url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23475569' d='M6 8L1 3h10z'/%3E%3C/svg%3E\")",backgroundRepeat:'no-repeat',backgroundPosition:'right 12px center',fontFamily:'var(--font-sans)',marginBottom:'24px'}}>
              <option value="">— Selecciona un técnico —</option>
              {tecnicos.map(tec => (
                <option key={tec.id_empleado} value={tec.id_empleado}>
                  {tec.nombre_completo ?? `${tec.nombre} ${tec.apellido}`}
                  {' — '}
                  {tec.tareas_activas ?? 0} tarea
                  {tec.tareas_activas === 1 ? '' : 's'} activa
                  {tec.tareas_activas === 1 ? '' : 's'}
                </option>
              ))}
            </select>
            <div style={{display:'flex',gap:'12px',justifyContent:'flex-end'}}>
              <button onClick={onCerrar} disabled={guardando} style={{padding:'10px 20px',background:'var(--color-bg-alt)',color:'var(--color-text)',border:'1.5px solid transparent',borderRadius:'var(--radius-md)',fontSize:'0.875rem',fontWeight:600,cursor:'pointer',fontFamily:'var(--font-sans)'}}>Cancelar</button>
              <button onClick={handleConfirmar} disabled={!tecnicoId||guardando} style={{padding:'10px 22px',background:'var(--gradient-primary)',color:'#fff',border:'none',borderRadius:'var(--radius-md)',fontSize:'0.875rem',fontWeight:600,cursor:'pointer',fontFamily:'var(--font-sans)',boxShadow:'var(--shadow-primary-sm)',opacity:(!tecnicoId||guardando)?0.55:1}}>
                {guardando?'Asignando...':'Asignar'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/* ── MODAL: Nuevo Activo ─────────────────────────────────────────────────── */
function ModalNuevoActivo({ tipoInicial = 'carro', onCerrar, onCreado }) {
  const [tipo, setTipo] = useState(tipoInicial)
  const [form, setForm] = useState({
    nombre_activo: '', descripcion: '',
    placa: '', marca: '', modelo: '', capacidad: '', estado_vehiculo: 'disponible',
    tipo_herramienta: '', estado: 'disponible',
    cantidad_disponible: '0', stock_minimo: '0', unidad_medida: '', tipo_material: '',
  })
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const handleGuardar = async () => {
    if (!form.nombre_activo.trim()) { setError('El nombre es obligatorio.'); return }
    if (tipo === 'carro' && !form.placa.trim()) { setError('La placa es obligatoria para vehículos.'); return }
    setGuardando(true); setError(null)
    try {
      let body = { tipo, nombre_activo: form.nombre_activo.trim(), descripcion: form.descripcion.trim() || undefined }
      if (tipo === 'carro') body = { ...body, placa: form.placa.trim(), marca: form.marca||undefined, modelo: form.modelo||undefined, capacidad: form.capacidad?Number(form.capacidad):undefined, estado_vehiculo: form.estado_vehiculo }
      else if (tipo === 'herramienta') body = { ...body, tipo_herramienta: form.tipo_herramienta||undefined, marca: form.marca||undefined, modelo: form.modelo||undefined, estado: form.estado }
      else body = { ...body, cantidad_disponible: Number(form.cantidad_disponible)||0, stock_minimo: Number(form.stock_minimo)||0, unidad_medida: form.unidad_medida||undefined, tipo_material: form.tipo_material||undefined }
      const nuevo = await crearActivo(body)
      onCreado(nuevo)
    } catch (err) {
      setError(err?.response?.data?.detail || 'Error al crear el activo.')
      setGuardando(false)
    }
  }

  const inputStyle = { width:'100%', padding:'10px 14px', border:'1.5px solid var(--color-border)', borderRadius:'var(--radius-md)', fontSize:'0.9rem', color:'var(--color-text)', background:'var(--color-bg)', outline:'none', fontFamily:'var(--font-sans)', marginBottom:'14px', boxSizing:'border-box' }
  const labelStyle = { display:'block', fontSize:'0.75rem', fontWeight:700, color:'var(--color-text-secondary)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:'6px' }

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(11,30,58,0.5)',backdropFilter:'blur(6px)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:300,padding:'24px'}} onClick={onCerrar}>
      <div style={{background:'var(--color-surface)',border:'1px solid var(--color-border)',borderRadius:'var(--radius-2xl)',boxShadow:'var(--shadow-xl)',width:'100%',maxWidth:'520px',padding:'32px',maxHeight:'90vh',overflowY:'auto'}} onClick={e=>e.stopPropagation()}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'20px'}}>
          <h2 style={{fontSize:'1.125rem',fontWeight:800,color:'var(--color-text)',margin:0}}>Nuevo activo</h2>
          <button onClick={onCerrar} style={{background:'none',border:'none',cursor:'pointer',color:'var(--color-text-secondary)',display:'flex'}}><IconX/></button>
        </div>
        {error && <div style={{background:'var(--color-danger-bg)',border:'1px solid var(--color-danger-light)',color:'var(--color-danger-dark)',borderRadius:'var(--radius-md)',padding:'10px 14px',fontSize:'0.8125rem',marginBottom:'16px'}}>{error}</div>}
        <label style={labelStyle}>Tipo de activo</label>
        <div style={{display:'flex',gap:'8px',marginBottom:'20px'}}>
          {['carro','herramienta','material'].map(t => (
            <button key={t} onClick={()=>setTipo(t)} style={{flex:1,padding:'10px',border:`2px solid ${tipo===t?'var(--color-primary)':'var(--color-border)'}`,borderRadius:'var(--radius-md)',background:tipo===t?'var(--color-primary-light, #eff6ff)':'transparent',color:tipo===t?'var(--color-primary)':'var(--color-text)',fontWeight:600,cursor:'pointer',fontSize:'0.875rem',textTransform:'capitalize',fontFamily:'var(--font-sans)'}}>
              {t === 'carro' ? 'Vehículo' : t === 'herramienta' ? 'Herramienta' : 'Material'}
            </button>
          ))}
        </div>
        <label style={labelStyle}>Nombre *</label>
        <input value={form.nombre_activo} onChange={e=>set('nombre_activo',e.target.value)} placeholder="Ej: Pickup Toyota Hilux" style={inputStyle}/>
        <label style={labelStyle}>Descripción</label>
        <input value={form.descripcion} onChange={e=>set('descripcion',e.target.value)} placeholder="Descripción opcional" style={inputStyle}/>
        {tipo === 'carro' && <>
          <label style={labelStyle}>Placa *</label>
          <input value={form.placa} onChange={e=>set('placa',e.target.value)} placeholder="Ej: P-123ABC" style={inputStyle}/>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px'}}>
            <div><label style={labelStyle}>Marca</label><input value={form.marca} onChange={e=>set('marca',e.target.value)} placeholder="Toyota" style={{...inputStyle,marginBottom:0}}/></div>
            <div><label style={labelStyle}>Modelo</label><input value={form.modelo} onChange={e=>set('modelo',e.target.value)} placeholder="Hilux 2022" style={{...inputStyle,marginBottom:0}}/></div>
          </div>
          <div style={{marginTop:'14px',display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px'}}>
            <div><label style={labelStyle}>Capacidad</label><input type="number" value={form.capacidad} onChange={e=>set('capacidad',e.target.value)} placeholder="5" style={{...inputStyle,marginBottom:0}}/></div>
            <div><label style={labelStyle}>Estado</label>
              <select value={form.estado_vehiculo} onChange={e=>set('estado_vehiculo',e.target.value)} style={{...inputStyle,marginBottom:0,height:'42px',appearance:'none'}}>
                <option value="disponible">Disponible</option>
                <option value="en_uso">En uso</option>
                <option value="mantenimiento">Mantenimiento</option>
                <option value="fuera_servicio">Fuera de servicio</option>
              </select>
            </div>
          </div>
        </>}
        {tipo === 'herramienta' && <>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px'}}>
            <div><label style={labelStyle}>Tipo</label><input value={form.tipo_herramienta} onChange={e=>set('tipo_herramienta',e.target.value)} placeholder="Ej: Taladro" style={{...inputStyle,marginBottom:0}}/></div>
            <div><label style={labelStyle}>Marca</label><input value={form.marca} onChange={e=>set('marca',e.target.value)} placeholder="Bosch" style={{...inputStyle,marginBottom:0}}/></div>
          </div>
          <div style={{marginTop:'14px',display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px'}}>
            <div><label style={labelStyle}>Modelo</label><input value={form.modelo} onChange={e=>set('modelo',e.target.value)} placeholder="GSB 120" style={{...inputStyle,marginBottom:0}}/></div>
            <div><label style={labelStyle}>Estado</label>
              <select value={form.estado} onChange={e=>set('estado',e.target.value)} style={{...inputStyle,marginBottom:0,height:'42px',appearance:'none'}}>
                <option value="disponible">Disponible</option>
                <option value="en_uso">En uso</option>
                <option value="mantenimiento">Mantenimiento</option>
              </select>
            </div>
          </div>
        </>}
        {tipo === 'material' && <>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px'}}>
            <div><label style={labelStyle}>Tipo de material</label><input value={form.tipo_material} onChange={e=>set('tipo_material',e.target.value)} placeholder="Cable, Conector…" style={{...inputStyle,marginBottom:0}}/></div>
            <div><label style={labelStyle}>Unidad de medida</label><input value={form.unidad_medida} onChange={e=>set('unidad_medida',e.target.value)} placeholder="metro, unidad, caja" style={{...inputStyle,marginBottom:0}}/></div>
          </div>
          <div style={{marginTop:'14px',display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px'}}>
            <div><label style={labelStyle}>Cantidad disponible</label><input type="number" value={form.cantidad_disponible} onChange={e=>set('cantidad_disponible',e.target.value)} style={{...inputStyle,marginBottom:0}}/></div>
            <div><label style={labelStyle}>Stock mínimo</label><input type="number" value={form.stock_minimo} onChange={e=>set('stock_minimo',e.target.value)} style={{...inputStyle,marginBottom:0}}/></div>
          </div>
        </>}
        <div style={{display:'flex',gap:'12px',justifyContent:'flex-end',marginTop:'24px'}}>
          <button onClick={onCerrar} disabled={guardando} style={{padding:'10px 20px',background:'var(--color-bg-alt)',color:'var(--color-text)',border:'1.5px solid transparent',borderRadius:'var(--radius-md)',fontSize:'0.875rem',fontWeight:600,cursor:'pointer',fontFamily:'var(--font-sans)'}}>Cancelar</button>
          <button onClick={handleGuardar} disabled={guardando} style={{padding:'10px 22px',background:'var(--gradient-primary)',color:'#fff',border:'none',borderRadius:'var(--radius-md)',fontSize:'0.875rem',fontWeight:600,cursor:'pointer',fontFamily:'var(--font-sans)',boxShadow:'var(--shadow-primary-sm)',opacity:guardando?0.55:1}}>
            {guardando?<><Spinner size="sm" color="white"/> Guardando...</>:'Crear activo'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── MODAL: Editar Activo ────────────────────────────────────────────────── */
function ModalEditarActivo({ activo, onCerrar, onEditado }) {
  const [form, setForm] = useState({
    nombre_activo: activo.nombre_activo ?? '',
    descripcion:   activo.descripcion   ?? '',
    placa:              activo.placa              ?? '',
    marca:              activo.marca              ?? '',
    modelo:             activo.modelo             ?? '',
    capacidad:          activo.capacidad          ?? '',
    estado_vehiculo:    activo.estado_vehiculo    ?? 'disponible',
    tipo_herramienta:   activo.tipo_herramienta   ?? '',
    estado:             activo.estado             ?? 'disponible',
    cantidad_disponible:String(activo.cantidad_disponible ?? ''),
    stock_minimo:       String(activo.stock_minimo        ?? ''),
    unidad_medida:      activo.unidad_medida      ?? '',
    tipo_material:      activo.tipo_material      ?? '',
  })
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const handleGuardar = async () => {
    if (!form.nombre_activo.trim()) { setError('El nombre es obligatorio.'); return }
    setGuardando(true); setError(null)
    try {
      const cambios = { nombre_activo: form.nombre_activo.trim(), descripcion: form.descripcion.trim() || null }
      if (activo.tipo === 'carro') Object.assign(cambios, { placa: form.placa||undefined, marca: form.marca||undefined, modelo: form.modelo||undefined, capacidad: form.capacidad?Number(form.capacidad):undefined, estado_vehiculo: form.estado_vehiculo||undefined })
      else if (activo.tipo === 'herramienta') Object.assign(cambios, { tipo_herramienta: form.tipo_herramienta||undefined, marca: form.marca||undefined, modelo: form.modelo||undefined, estado: form.estado||undefined })
      else Object.assign(cambios, { cantidad_disponible: Number(form.cantidad_disponible)||0, stock_minimo: Number(form.stock_minimo)||0, unidad_medida: form.unidad_medida||undefined, tipo_material: form.tipo_material||undefined })
      const actualizado = await editarActivo(activo.id_activo, cambios)
      onEditado(actualizado)
    } catch (err) {
      setError(err?.response?.data?.detail || 'Error al editar.')
      setGuardando(false)
    }
  }

  const inputStyle = { width:'100%', padding:'10px 14px', border:'1.5px solid var(--color-border)', borderRadius:'var(--radius-md)', fontSize:'0.9rem', color:'var(--color-text)', background:'var(--color-bg)', outline:'none', fontFamily:'var(--font-sans)', marginBottom:'14px', boxSizing:'border-box' }
  const labelStyle = { display:'block', fontSize:'0.75rem', fontWeight:700, color:'var(--color-text-secondary)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:'6px' }

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(11,30,58,0.5)',backdropFilter:'blur(6px)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:300,padding:'24px'}} onClick={onCerrar}>
      <div style={{background:'var(--color-surface)',border:'1px solid var(--color-border)',borderRadius:'var(--radius-2xl)',boxShadow:'var(--shadow-xl)',width:'100%',maxWidth:'520px',padding:'32px',maxHeight:'90vh',overflowY:'auto'}} onClick={e=>e.stopPropagation()}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'20px'}}>
          <h2 style={{fontSize:'1.125rem',fontWeight:800,color:'var(--color-text)',margin:0}}>Editar activo</h2>
          <button onClick={onCerrar} style={{background:'none',border:'none',cursor:'pointer',color:'var(--color-text-secondary)',display:'flex'}}><IconX/></button>
        </div>
        {error && <div style={{background:'var(--color-danger-bg)',border:'1px solid var(--color-danger-light)',color:'var(--color-danger-dark)',borderRadius:'var(--radius-md)',padding:'10px 14px',fontSize:'0.8125rem',marginBottom:'16px'}}>{error}</div>}
        <label style={labelStyle}>Nombre *</label>
        <input value={form.nombre_activo} onChange={e=>set('nombre_activo',e.target.value)} style={inputStyle}/>
        <label style={labelStyle}>Descripción</label>
        <input value={form.descripcion} onChange={e=>set('descripcion',e.target.value)} style={inputStyle}/>
        {activo.tipo === 'carro' && <>
          <label style={labelStyle}>Placa</label>
          <input value={form.placa} onChange={e=>set('placa',e.target.value)} style={inputStyle}/>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px'}}>
            <div><label style={labelStyle}>Marca</label><input value={form.marca} onChange={e=>set('marca',e.target.value)} style={{...inputStyle,marginBottom:0}}/></div>
            <div><label style={labelStyle}>Modelo</label><input value={form.modelo} onChange={e=>set('modelo',e.target.value)} style={{...inputStyle,marginBottom:0}}/></div>
          </div>
          <div style={{marginTop:'14px',display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px'}}>
            <div><label style={labelStyle}>Capacidad</label><input type="number" value={form.capacidad} onChange={e=>set('capacidad',e.target.value)} style={{...inputStyle,marginBottom:0}}/></div>
            <div><label style={labelStyle}>Estado</label>
              <select value={form.estado_vehiculo} onChange={e=>set('estado_vehiculo',e.target.value)} style={{...inputStyle,marginBottom:0,height:'42px',appearance:'none'}}>
                <option value="disponible">Disponible</option><option value="en_uso">En uso</option>
                <option value="mantenimiento">Mantenimiento</option><option value="fuera_servicio">Fuera de servicio</option>
              </select>
            </div>
          </div>
        </>}
        {activo.tipo === 'herramienta' && <>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px'}}>
            <div><label style={labelStyle}>Tipo</label><input value={form.tipo_herramienta} onChange={e=>set('tipo_herramienta',e.target.value)} style={{...inputStyle,marginBottom:0}}/></div>
            <div><label style={labelStyle}>Marca</label><input value={form.marca} onChange={e=>set('marca',e.target.value)} style={{...inputStyle,marginBottom:0}}/></div>
          </div>
          <div style={{marginTop:'14px',display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px'}}>
            <div><label style={labelStyle}>Modelo</label><input value={form.modelo} onChange={e=>set('modelo',e.target.value)} style={{...inputStyle,marginBottom:0}}/></div>
            <div><label style={labelStyle}>Estado</label>
              <select value={form.estado} onChange={e=>set('estado',e.target.value)} style={{...inputStyle,marginBottom:0,height:'42px',appearance:'none'}}>
                <option value="disponible">Disponible</option><option value="en_uso">En uso</option><option value="mantenimiento">Mantenimiento</option>
              </select>
            </div>
          </div>
        </>}
        {activo.tipo === 'material' && <>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px'}}>
            <div><label style={labelStyle}>Tipo material</label><input value={form.tipo_material} onChange={e=>set('tipo_material',e.target.value)} style={{...inputStyle,marginBottom:0}}/></div>
            <div><label style={labelStyle}>Unidad</label><input value={form.unidad_medida} onChange={e=>set('unidad_medida',e.target.value)} style={{...inputStyle,marginBottom:0}}/></div>
          </div>
          <div style={{marginTop:'14px',display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px'}}>
            <div><label style={labelStyle}>Cantidad</label><input type="number" value={form.cantidad_disponible} onChange={e=>set('cantidad_disponible',e.target.value)} style={{...inputStyle,marginBottom:0}}/></div>
            <div><label style={labelStyle}>Stock mínimo</label><input type="number" value={form.stock_minimo} onChange={e=>set('stock_minimo',e.target.value)} style={{...inputStyle,marginBottom:0}}/></div>
          </div>
        </>}
        <div style={{display:'flex',gap:'12px',justifyContent:'flex-end',marginTop:'24px'}}>
          <button onClick={onCerrar} disabled={guardando} style={{padding:'10px 20px',background:'var(--color-bg-alt)',color:'var(--color-text)',border:'1.5px solid transparent',borderRadius:'var(--radius-md)',fontSize:'0.875rem',fontWeight:600,cursor:'pointer',fontFamily:'var(--font-sans)'}}>Cancelar</button>
          <button onClick={handleGuardar} disabled={guardando} style={{padding:'10px 22px',background:'var(--gradient-primary)',color:'#fff',border:'none',borderRadius:'var(--radius-md)',fontSize:'0.875rem',fontWeight:600,cursor:'pointer',fontFamily:'var(--font-sans)',opacity:guardando?0.55:1}}>
            {guardando?<><Spinner size="sm" color="white"/> Guardando...</>:'Guardar cambios'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── MODAL: Confirmar Eliminar ───────────────────────────────────────────── */
function ModalEliminar({ activo, onCerrar, onEliminado }) {
  const [eliminando, setEliminando] = useState(false)
  const [error, setError] = useState(null)
  const handleEliminar = async () => {
    setEliminando(true); setError(null)
    try {
      await eliminarActivo(activo.id_activo)
      onEliminado(activo.id_activo)
    } catch (err) {
      setError(err?.response?.data?.detail || 'Error al eliminar.')
      setEliminando(false)
    }
  }
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(11,30,58,0.5)',backdropFilter:'blur(6px)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:300,padding:'24px'}} onClick={onCerrar}>
      <div style={{background:'var(--color-surface)',border:'1px solid var(--color-border)',borderRadius:'var(--radius-2xl)',boxShadow:'var(--shadow-xl)',width:'100%',maxWidth:'420px',padding:'32px',textAlign:'center'}} onClick={e=>e.stopPropagation()}>
        <div style={{width:56,height:56,borderRadius:'50%',background:'var(--color-danger-bg)',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 16px',color:'var(--color-danger)'}}><IconTrash/></div>
        <h2 style={{fontSize:'1.125rem',fontWeight:800,color:'var(--color-text)',margin:'0 0 8px'}}>Eliminar activo</h2>
        <p style={{fontSize:'0.9rem',color:'var(--color-text-secondary)',margin:'0 0 20px'}}>¿Seguro que querés eliminar <strong>{activo.nombre_activo}</strong>? Esta acción no se puede deshacer.</p>
        {error && <div style={{background:'var(--color-danger-bg)',color:'var(--color-danger-dark)',borderRadius:'var(--radius-md)',padding:'10px',fontSize:'0.8125rem',marginBottom:'16px'}}>{error}</div>}
        <div style={{display:'flex',gap:'12px',justifyContent:'center'}}>
          <button onClick={onCerrar} disabled={eliminando} style={{padding:'10px 20px',background:'var(--color-bg-alt)',color:'var(--color-text)',border:'1.5px solid transparent',borderRadius:'var(--radius-md)',fontSize:'0.875rem',fontWeight:600,cursor:'pointer',fontFamily:'var(--font-sans)'}}>Cancelar</button>
          <button onClick={handleEliminar} disabled={eliminando} style={{padding:'10px 22px',background:'var(--color-danger)',color:'#fff',border:'none',borderRadius:'var(--radius-md)',fontSize:'0.875rem',fontWeight:600,cursor:'pointer',fontFamily:'var(--font-sans)',opacity:eliminando?0.55:1}}>
            {eliminando?'Eliminando...':'Eliminar'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Tablas ───────────────────────────────────────────────────────────────── */
function SortIcon({ col, sortConfig }) {
  if (sortConfig.key !== col) return <span className={styles.sortNeutral}><IconChevronsUpDown/></span>
  return sortConfig.dir === 'asc'
    ? <span className={styles.sortActive}><IconChevronUp/></span>
    : <span className={styles.sortActive}><IconChevronDown/></span>
}

function TablaVehiculos({ datos, loading, sortConfig, onSort, onAsignarTecnico, onEditar, onEliminar }) {
  if (loading || datos.length === 0) return (
    <PageState
      loading={loading}
      loadingLabel="Cargando vehículos..."
      empty
      emptyIcon={<IconCar/>}
      emptyTitle="Sin vehículos"
      emptyDescription="No se encontraron vehículos con esos criterios de búsqueda."
    />
  )
  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead className={styles.thead}>
          <tr>
            <th className={styles.th}>Vehículo</th>
            <th className={`${styles.th} ${styles.thSortable}`} onClick={()=>onSort('placa')}><span>Placa</span><SortIcon col="placa" sortConfig={sortConfig}/></th>
            <th className={`${styles.th} ${styles.thSortable}`} onClick={()=>onSort('marca')}><span>Marca/Modelo</span><SortIcon col="marca" sortConfig={sortConfig}/></th>
            <th className={`${styles.th} ${styles.thSortable}`} onClick={()=>onSort('estado_vehiculo')}><span>Estado</span><SortIcon col="estado_vehiculo" sortConfig={sortConfig}/></th>
            <th className={styles.th}>Técnico asignado</th>
            <th className={styles.th}>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {datos.map(v => (
            <tr key={v.id_activo} className={styles.tr}>
              <td className={styles.td}>
                <div className={styles.activoCell}>
                  <VehiculoMiniatura marca={v.marca} fotoUrl={fotoUrl(v.foto_url)} color="#1e3a5f"/>
                  <span className={styles.activoNombre}>{v.nombre_activo}</span>
                </div>
              </td>
              <td className={styles.td}><span className={styles.placaTag}>{v.placa}</span></td>
              <td className={styles.td}><span className={styles.textoSecundario}>{[v.marca,v.modelo].filter(Boolean).join(' · ') || '—'}</span></td>
              <td className={styles.td}><Badge label={ESTADO_VEHICULO_LABEL[v.estado_vehiculo]??v.estado_vehiculo} variant={ESTADO_VEHICULO_VARIANT[v.estado_vehiculo]??'muted'}/></td>
              <td className={styles.td}><span className={styles.textoSecundario}>{v.nombre_empleado_asignado||'Sin asignar'}</span></td>
              <td className={styles.td}>
                <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
                  <button onClick={()=>onAsignarTecnico(v)} style={{padding:'5px 10px',background:'var(--gradient-primary)',color:'#fff',border:'none',borderRadius:'var(--radius-md)',fontSize:'0.78rem',fontWeight:600,cursor:'pointer',fontFamily:'var(--font-sans)',whiteSpace:'nowrap'}}>Asignar técnico</button>
                  <button onClick={()=>onEditar(v)} style={{padding:'5px 8px',background:'var(--color-bg-alt)',color:'var(--color-text)',border:'1px solid var(--color-border)',borderRadius:'var(--radius-md)',cursor:'pointer',display:'flex',alignItems:'center',gap:'4px',fontSize:'0.78rem',fontFamily:'var(--font-sans)'}}><IconEdit/></button>
                  <button onClick={()=>onEliminar(v)} style={{padding:'5px 8px',background:'var(--color-danger-bg)',color:'var(--color-danger)',border:'1px solid var(--color-danger-light)',borderRadius:'var(--radius-md)',cursor:'pointer',display:'flex',alignItems:'center',fontSize:'0.78rem',fontFamily:'var(--font-sans)'}}><IconTrash/></button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={styles.resultCount}>Mostrando {datos.length} vehículo{datos.length!==1?'s':''}</p>
    </div>
  )
}

function TablaHerramientas({ datos, loading, sortConfig, onSort, onAsignarCarro, onEditar, onEliminar }) {
  if (loading || datos.length === 0) return (
    <PageState
      loading={loading}
      loadingLabel="Cargando herramientas..."
      empty
      emptyIcon={<IconTool/>}
      emptyTitle="Sin herramientas"
      emptyDescription="No se encontraron herramientas con esos criterios de búsqueda."
    />
  )
  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead className={styles.thead}>
          <tr>
            <th className={styles.th}>Herramienta</th>
            <th className={`${styles.th} ${styles.thSortable}`} onClick={()=>onSort('tipo_herramienta')}><span>Tipo</span><SortIcon col="tipo_herramienta" sortConfig={sortConfig}/></th>
            <th className={`${styles.th} ${styles.thSortable}`} onClick={()=>onSort('marca')}><span>Marca/Modelo</span><SortIcon col="marca" sortConfig={sortConfig}/></th>
            <th className={`${styles.th} ${styles.thSortable}`} onClick={()=>onSort('estado')}><span>Estado</span><SortIcon col="estado" sortConfig={sortConfig}/></th>
            <th className={styles.th}>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {datos.map(h => (
            <tr key={h.id_activo} className={styles.tr}>
              <td className={styles.td}><div className={styles.activoCell}><HerramientaMiniatura tipo={h.tipo_herramienta} foto={fotoUrl(h.foto_url)}/><span className={styles.activoNombre}>{h.nombre_activo}</span></div></td>
              <td className={styles.td}><span className={styles.tipoTag}>{h.tipo_herramienta||'—'}</span></td>
              <td className={styles.td}><span className={styles.textoSecundario}>{[h.marca,h.modelo].filter(Boolean).join(' · ')||'—'}</span></td>
              <td className={styles.td}><Badge label={ESTADO_HERR_LABEL[h.estado]??h.estado} variant={ESTADO_HERR_VARIANT[h.estado]??'muted'}/></td>
              <td className={styles.td}>
                <div style={{display:'flex',gap:'6px'}}>
                  <button onClick={()=>onAsignarCarro(h)} style={{padding:'5px 8px',background:'linear-gradient(135deg,var(--color-primary),var(--color-primary-dark,#0055cc))',color:'#fff',border:'none',borderRadius:'var(--radius-md)',cursor:'pointer',display:'flex',alignItems:'center',gap:'4px',fontSize:'0.78rem',fontFamily:'var(--font-sans)',fontWeight:600}}>Asignar a vehículo</button>
                  <button onClick={()=>onEditar(h)} style={{padding:'5px 8px',background:'var(--color-bg-alt)',color:'var(--color-text)',border:'1px solid var(--color-border)',borderRadius:'var(--radius-md)',cursor:'pointer',display:'flex',alignItems:'center',gap:'4px',fontSize:'0.78rem',fontFamily:'var(--font-sans)'}}><IconEdit/></button>
                  <button onClick={()=>onEliminar(h)} style={{padding:'5px 8px',background:'var(--color-danger-bg)',color:'var(--color-danger)',border:'1px solid var(--color-danger-light)',borderRadius:'var(--radius-md)',cursor:'pointer',display:'flex',alignItems:'center',fontSize:'0.78rem',fontFamily:'var(--font-sans)'}}><IconTrash/></button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={styles.resultCount}>Mostrando {datos.length} herramienta{datos.length!==1?'s':''}</p>
    </div>
  )
}

function TablaMateriales({ datos, loading, sortConfig, onSort, onEditar, onEliminar }) {
  if (loading || datos.length === 0) return (
    <PageState
      loading={loading}
      loadingLabel="Cargando materiales..."
      empty
      emptyIcon={<IconBox/>}
      emptyTitle="Sin materiales"
      emptyDescription="No se encontraron materiales con esos criterios de búsqueda."
    />
  )
  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead className={styles.thead}>
          <tr>
            <th className={styles.th}>Material</th>
            <th className={`${styles.th} ${styles.thSortable}`} onClick={()=>onSort('tipo_material')}><span>Tipo</span><SortIcon col="tipo_material" sortConfig={sortConfig}/></th>
            <th className={`${styles.th} ${styles.thSortable}`} onClick={()=>onSort('unidad_medida')}><span>Unidad</span><SortIcon col="unidad_medida" sortConfig={sortConfig}/></th>
            <th className={`${styles.th} ${styles.thSortable}`} onClick={()=>onSort('cantidad_disponible')}><span>Cantidad</span><SortIcon col="cantidad_disponible" sortConfig={sortConfig}/></th>
            <th className={styles.th}>Stock mínimo</th>
            <th className={styles.th}>Nivel</th>
            <th className={styles.th}>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {datos.map(m => {
            const stockBajo = m.cantidad_disponible <= m.stock_minimo
            const pct = Math.min(100,Math.round((m.cantidad_disponible/Math.max(m.stock_minimo*3,1))*100))
            return (
              <tr key={m.id_activo} className={styles.tr}>
                <td className={styles.td}><div className={styles.activoCell}><MaterialMiniatura tipo={m.tipo_material} foto={fotoUrl(m.foto_url)}/><span className={styles.activoNombre}>{m.nombre_activo}</span></div></td>
                <td className={styles.td}><span className={styles.tipoTag}>{m.tipo_material||'—'}</span></td>
                <td className={styles.td}><span className={styles.textoSecundario}>{m.unidad_medida||'—'}</span></td>
                <td className={styles.td}><span className={`${styles.cantidadNum} ${stockBajo?styles.cantidadBaja:''}`}>{m.cantidad_disponible?.toLocaleString()}</span></td>
                <td className={styles.td}><span className={styles.textoSecundario}>{m.stock_minimo?.toLocaleString()}</span></td>
                <td className={styles.td}>
                  <div className={styles.stockBarWrap}>
                    <div className={styles.stockBar}><div className={`${styles.stockBarFill} ${stockBajo?styles.stockBarBajo:styles.stockBarOk}`} style={{width:`${pct}%`}}/></div>
                    <Badge label={stockBajo?'Stock bajo':'Normal'} variant={stockBajo?'danger':'success'}/>
                  </div>
                </td>
                <td className={styles.td}>
                  <div style={{display:'flex',gap:'6px'}}>
                    <button onClick={()=>onEditar(m)} style={{padding:'5px 8px',background:'var(--color-bg-alt)',color:'var(--color-text)',border:'1px solid var(--color-border)',borderRadius:'var(--radius-md)',cursor:'pointer',display:'flex',alignItems:'center',gap:'4px',fontSize:'0.78rem',fontFamily:'var(--font-sans)'}}><IconEdit/></button>
                    <button onClick={()=>onEliminar(m)} style={{padding:'5px 8px',background:'var(--color-danger-bg)',color:'var(--color-danger)',border:'1px solid var(--color-danger-light)',borderRadius:'var(--radius-md)',cursor:'pointer',display:'flex',alignItems:'center',fontSize:'0.78rem',fontFamily:'var(--font-sans)'}}><IconTrash/></button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className={styles.resultCount}>Mostrando {datos.length} material{datos.length!==1?'es':''}</p>
    </div>
  )
}

/* ── Configuración de tabs ───────────────────────────────────────────────── */
const TABS = [
  { id:'vehiculos',    label:'Vehículos',    Icon:IconCar,
    estados:[{value:'todos',label:'Todos'},{value:'disponible',label:'Disponible'},{value:'en_uso',label:'En uso'},{value:'mantenimiento',label:'Mantenimiento'},{value:'fuera_servicio',label:'Fuera de servicio'}] },
  { id:'herramientas', label:'Herramientas', Icon:IconTool,
    estados:[{value:'todos',label:'Todos'},{value:'disponible',label:'Disponible'},{value:'en_uso',label:'En uso'},{value:'mantenimiento',label:'Mantenimiento'},{value:'dañada',label:'Dañada'}] },
  { id:'materiales',   label:'Materiales',   Icon:IconBox,
    estados:[{value:'todos',label:'Todos'},{value:'normal',label:'Stock normal'},{value:'stock_bajo',label:'Stock bajo'}] },
]

function filtrarYOrdenar(lista, busqueda, filtroEstado, sortConfig, tipo) {
  let result = lista.filter(item => {
    const q = busqueda.toLowerCase()
    let coincide = !q
    if (!coincide) {
      const campos = [item.nombre_activo, item.placa, item.marca, item.modelo, item.tipo_herramienta, item.tipo_material, item.unidad_medida].filter(Boolean)
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
      const va = typeof a[sortConfig.key] === 'number' ? a[sortConfig.key] : String(a[sortConfig.key]??'').toLowerCase()
      const vb = typeof b[sortConfig.key] === 'number' ? b[sortConfig.key] : String(b[sortConfig.key]??'').toLowerCase()
      if (va < vb) return sortConfig.dir === 'asc' ? -1 : 1
      if (va > vb) return sortConfig.dir === 'asc' ?  1 : -1
      return 0
    })
  }
  return result
}

/* ── Componente principal ────────────────────────────────────────────────── */

// ── Modal: Asignar herramienta a un carro ─────────────────────────────────
function ModalAsignarHerramientaACarro({ herramienta, carros, onCerrar, onAsignada }) {
  const [carroId, setCarroId] = React.useState('')
  const [guardando, setGuardando] = React.useState(false)
  const [error, setError] = React.useState(null)

  const handleConfirmar = async () => {
    if (!carroId) return
    setGuardando(true); setError(null)
    try {
      await asignarHerramientaACarro(Number(carroId), herramienta.id_activo)
      const carro = carros.find(c => c.id_activo === Number(carroId))
      onAsignada(herramienta.id_activo, carro)
    } catch (err) {
      setError(err?.response?.data?.detail || 'Error al asignar herramienta.')
    } finally {
      setGuardando(false)
    }
  }

  const overlayStyle = {position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:'16px'}
  const boxStyle    = {background:'var(--color-bg)',borderRadius:'var(--radius-lg)',padding:'28px',width:'100%',maxWidth:'420px',boxShadow:'var(--shadow-xl)'}
  const inputStyle  = {width:'100%',padding:'9px 12px',border:'1.5px solid var(--color-border)',borderRadius:'var(--radius-md)',fontSize:'0.875rem',fontFamily:'var(--font-sans)',background:'var(--color-bg)',color:'var(--color-text)',boxSizing:'border-box',cursor:'pointer'}

  return (
    <div style={overlayStyle} onClick={onCerrar}>
      <div style={boxStyle} onClick={e=>e.stopPropagation()}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'20px'}}>
          <h3 style={{margin:0,fontSize:'1.05rem',fontWeight:700,color:'var(--color-text)'}}>Asignar a vehículo</h3>
          <button onClick={onCerrar} style={{background:'none',border:'none',cursor:'pointer',color:'var(--color-text-secondary)',display:'flex',padding:'4px'}}><IconX/></button>
        </div>
        <p style={{fontSize:'0.875rem',color:'var(--color-text-secondary)',marginBottom:'18px'}}>
          Selecciona el vehículo al que deseas asignar <strong>{herramienta.nombre_activo}</strong>.
        </p>
        <select value={carroId} onChange={e=>setCarroId(e.target.value)} style={inputStyle}>
          <option value="">— Selecciona un vehículo —</option>
          {carros.filter(c=>c.estado_vehiculo!=='fuera_de_servicio').map(c => (
            <option key={c.id_activo} value={c.id_activo}>
              {c.placa} — {c.nombre_activo}{c.nombre_empleado_asignado ? ` (${c.nombre_empleado_asignado})` : ' (Sin técnico)'}
            </option>
          ))}
        </select>
        {error && <p style={{color:'var(--color-danger)',fontSize:'0.8rem',marginTop:'8px'}}>{error}</p>}
        <div style={{display:'flex',gap:'10px',justifyContent:'flex-end',marginTop:'22px'}}>
          <button onClick={onCerrar} disabled={guardando} style={{padding:'10px 20px',background:'var(--color-bg-alt)',color:'var(--color-text)',border:'1.5px solid transparent',borderRadius:'var(--radius-md)',fontSize:'0.875rem',fontWeight:600,cursor:'pointer',fontFamily:'var(--font-sans)'}}>Cancelar</button>
          <button onClick={handleConfirmar} disabled={!carroId||guardando} style={{padding:'10px 22px',background:'var(--gradient-primary)',color:'#fff',border:'none',borderRadius:'var(--radius-md)',fontSize:'0.875rem',fontWeight:600,cursor:'pointer',fontFamily:'var(--font-sans)',boxShadow:'var(--shadow-primary-sm)',opacity:(!carroId||guardando)?0.55:1}}>
            {guardando ? 'Asignando…' : 'Asignar'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function InventarioPage() {
  const toast = useToast()
  const [tabActiva, setTabActiva] = useState('vehiculos')
  const [busqueda, setBusqueda] = useState('')
  const [filtroEstado, setFiltroEstado] = useState('todos')
  const [sortConfig, setSortConfig] = useState({ key:null, dir:'asc' })

  // Datos cargados de la API
  const [vehiculos, setVehiculos] = useState([])
  const [herramientas, setHerramientas] = useState([])
  const [materiales, setMateriales] = useState([])
  const [loading, setLoading] = useState(false)
  const [errorCarga, setErrorCarga] = useState(null)

  // Modales
  const [modalNuevo, setModalNuevo] = useState(null)       // tipoInicial string
  const [modalEditar, setModalEditar] = useState(null)     // activo a editar
  const [modalEliminar, setModalEliminar] = useState(null) // activo a eliminar
  const [modalAsignarTecnico, setModalAsignarTecnico] = useState(null)
  const [modalAsignarHerramienta, setModalAsignarHerramienta] = useState(null)

  const tabInfo = TABS.find(t => t.id === tabActiva)

  const cargarDatos = useCallback(async () => {
    setLoading(true); setErrorCarga(null)
    try {
      const [v, h, m] = await Promise.all([getCarros(), getHerramientas(), getMateriales()])
      setVehiculos(v); setHerramientas(h); setMateriales(m)
    } catch (err) {
      setErrorCarga(err?.response?.data?.detail || 'No se pudo cargar el inventario.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { cargarDatos() }, [cargarDatos])

  const handleCambiarTab = (id) => {
    setTabActiva(id); setBusqueda(''); setFiltroEstado('todos'); setSortConfig({key:null,dir:'asc'})
  }
  const handleSort = (key) => setSortConfig(prev => ({ key, dir: prev.key===key&&prev.dir==='asc'?'desc':'asc' }))

  const datosFiltrados = useMemo(() => {
    const fuente = tabActiva==='vehiculos'?vehiculos : tabActiva==='herramientas'?herramientas : materiales
    return filtrarYOrdenar(fuente, busqueda, filtroEstado, sortConfig, tabActiva)
  }, [tabActiva, vehiculos, herramientas, materiales, busqueda, filtroEstado, sortConfig])

  // Callbacks de creación / edición / eliminación
  const handleCreado = (nuevo) => {
    if (nuevo.tipo === 'carro') setVehiculos(p => [nuevo, ...p])
    else if (nuevo.tipo === 'herramienta') setHerramientas(p => [nuevo, ...p])
    else setMateriales(p => [nuevo, ...p])
    setModalNuevo(null)
    toast.success(`${nuevo.nombre_activo} se agregó al inventario.`)
  }
  const handleEditado = (actualizado) => {
    if (actualizado.tipo === 'carro') setVehiculos(p => p.map(v => v.id_activo===actualizado.id_activo ? {...v,...actualizado} : v))
    else if (actualizado.tipo === 'herramienta') setHerramientas(p => p.map(h => h.id_activo===actualizado.id_activo ? {...h,...actualizado} : h))
    else setMateriales(p => p.map(m => m.id_activo===actualizado.id_activo ? {...m,...actualizado} : m))
    setModalEditar(null)
    toast.success(`${actualizado.nombre_activo} se actualizó correctamente.`)
  }
  const handleEliminado = (id) => {
    setVehiculos(p => p.filter(v => v.id_activo!==id))
    setHerramientas(p => p.filter(h => h.id_activo!==id))
    setMateriales(p => p.filter(m => m.id_activo!==id))
    setModalEliminar(null)
    toast.success('Activo eliminado del inventario.')
  }
  const handleAsignadaACarro = () => {
    // La asignación ya ocurrió en el modal; solo se cierra aquí
    setModalAsignarHerramienta(null)
    toast.success('Herramientas asignadas al vehículo.')
  }
  const handleAsignado = (idActivo, tec) => {
    setVehiculos(p => p.map(v => v.id_activo===idActivo ? {...v, nombre_empleado_asignado: tec?`${tec.nombre} ${tec.apellido}`:null, estado_vehiculo:'en_uso'} : v))
    setModalAsignarTecnico(null)
    toast.success(
      tec ? `Vehículo asignado a ${tec.nombre} ${tec.apellido}.` : 'Vehículo liberado.'
    )
  }

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.title}>Inventario</h1>
          <p className={styles.subtitle}>Consulta y gestión de activos operativos</p>
        </div>
        <div style={{display:'flex',gap:'10px',alignItems:'center'}}>
          <button onClick={cargarDatos} disabled={loading} title="Actualizar" style={{padding:'8px',background:'var(--color-bg-alt)',border:'1px solid var(--color-border)',borderRadius:'var(--radius-md)',cursor:'pointer',color:'var(--color-text-secondary)',display:'flex'}}>
            <IconRefresh/>
          </button>
          <button onClick={()=>setModalNuevo(tabActiva==='vehiculos'?'carro':tabActiva==='herramientas'?'herramienta':'material')}
            style={{padding:'8px 18px',background:'var(--gradient-primary)',color:'#fff',border:'none',borderRadius:'var(--radius-md)',fontWeight:700,cursor:'pointer',fontSize:'0.875rem',display:'flex',alignItems:'center',gap:'6px',fontFamily:'var(--font-sans)',boxShadow:'var(--shadow-primary-sm)'}}>
            <IconPlus/> Nuevo activo
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

      {/* Tabs */}
      <div className={styles.tabsWrapper}>
        <div className={styles.tabs}>
          {TABS.map(tab => (
            <button key={tab.id} className={`${styles.tab} ${tabActiva===tab.id?styles.tabActive:''}`} onClick={()=>handleCambiarTab(tab.id)}>
              <span className={styles.tabIcon}><tab.Icon/></span>
              <span className={styles.tabLabel}>{tab.label}</span>
              <span className={`${styles.tabCount} ${tabActiva===tab.id?styles.tabCountActive:''}`}>
                {tab.id==='vehiculos'?vehiculos.length:tab.id==='herramientas'?herramientas.length:materiales.length}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Toolbar */}
      <div className={styles.toolbar}>
        <div className={styles.searchWrap}>
          <span className={styles.searchIcon}><IconSearch/></span>
          <input type="search" className={styles.searchInput} placeholder={`Buscar ${tabInfo?.label.toLowerCase()}...`} value={busqueda} onChange={e=>setBusqueda(e.target.value)}/>
          {busqueda && <button className={styles.searchClear} onClick={()=>setBusqueda('')}><IconX/></button>}
        </div>
        <div className={styles.filterWrap}>
          <span className={styles.filterIcon}><IconFilter/></span>
          <select className={styles.filterSelect} value={filtroEstado} onChange={e=>setFiltroEstado(e.target.value)}>
            {tabInfo?.estados.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
          </select>
        </div>
      </div>

      {/* Tablas */}
      {tabActiva === 'vehiculos' && (
        <TablaVehiculos datos={datosFiltrados} loading={loading} sortConfig={sortConfig} onSort={handleSort}
          onAsignarTecnico={v=>setModalAsignarTecnico(v)} onEditar={v=>setModalEditar(v)} onEliminar={v=>setModalEliminar(v)}/>
      )}
      {tabActiva === 'herramientas' && (
        <TablaHerramientas datos={datosFiltrados} loading={loading} sortConfig={sortConfig} onSort={handleSort}
          onAsignarCarro={h=>setModalAsignarHerramienta(h)}
          onEditar={h=>setModalEditar(h)} onEliminar={h=>setModalEliminar(h)}/>
      )}
      {tabActiva === 'materiales' && (
        <TablaMateriales datos={datosFiltrados} loading={loading} sortConfig={sortConfig} onSort={handleSort}
          onEditar={m=>setModalEditar(m)} onEliminar={m=>setModalEliminar(m)}/>
      )}

      {/* Modales */}
      {modalNuevo && <ModalNuevoActivo tipoInicial={modalNuevo} onCerrar={()=>setModalNuevo(null)} onCreado={handleCreado}/>}
      {modalEditar && <ModalEditarActivo activo={modalEditar} onCerrar={()=>setModalEditar(null)} onEditado={handleEditado}/>}
      {modalEliminar && <ModalEliminar activo={modalEliminar} onCerrar={()=>setModalEliminar(null)} onEliminado={handleEliminado}/>}
      {modalAsignarTecnico && <ModalAsignarTecnico vehiculo={modalAsignarTecnico} onCerrar={()=>setModalAsignarTecnico(null)} onAsignado={handleAsignado}/>}
      {modalAsignarHerramienta && <ModalAsignarHerramientaACarro herramienta={modalAsignarHerramienta} carros={vehiculos} onCerrar={()=>setModalAsignarHerramienta(null)} onAsignada={handleAsignadaACarro}/>}
    </div>
  )
}
