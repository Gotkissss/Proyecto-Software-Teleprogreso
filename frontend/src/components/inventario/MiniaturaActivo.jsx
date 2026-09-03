import React from 'react'
import styles from './MiniaturaActivo.module.css'

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

export function VehiculoMiniatura({ marca, fotoUrl: foto, color = '#1e3a5f' }) {
  if (foto) return <img src={foto} alt={marca} className={styles.miniaturaImg} />
  const inicial = marca?.[0]?.toUpperCase() ?? 'V'
  return (
    <div className={styles.miniatura} style={{ background: color + '18', borderColor: color + '30' }}>
      <svg viewBox="0 0 40 28" width="36" height="24" fill="none">
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

export function HerramientaMiniatura({ tipo, foto }) {
  if (foto) return <img src={foto} alt={tipo} className={styles.miniaturaImg} />
  return (
    <div className={styles.miniatura} style={{ background: 'var(--color-primary-light)', borderColor: 'var(--color-primary-dark)30' }}>
      <span style={{ color: 'var(--color-primary-dark)', display: 'flex', alignItems: 'center' }}><IconTool /></span>
    </div>
  )
}

export function MaterialMiniatura({ tipo, foto }) {
  if (foto) return <img src={foto} alt={tipo} className={styles.miniaturaImg} />
  return (
    <div className={styles.miniatura} style={{ background: 'var(--color-success-light)', borderColor: 'var(--color-success-dark)30' }}>
      <span style={{ color: 'var(--color-success-dark)', display: 'flex', alignItems: 'center' }}><IconBox /></span>
    </div>
  )
}
