/**
 * Badge de nivel de stock para usar en filas de la tabla de Materiales.
 *
 * Uso:
 *   <StockBadge disponible={5} minimo={20} />
 *
 * Variantes automáticas:
 *   - critico : disponible === 0           = rojo intenso + ícono ⊗
 *   - bajo    : disponible < minimo        = naranja + ícono ▼
 *   - normal  : disponible >= minimo       = verde + ícono de cheque ✓
 * ---------------------------------------------------------------------------
 */

import styles from './StockBadge.module.css'

const IconCritico = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
    strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="15" y1="9" x2="9" y2="15" />
    <line x1="9" y1="9" x2="15" y2="15" />
  </svg>
)

const IconBajo = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
    strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
)

const IconNormal = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
    strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
)

/**
 * @param {number}  disponible  - Cantidad actual disponible
 * @param {number}  minimo      - Stock mínimo configurado
 * @param {boolean} [showCount] - Si muestra el número disponible junto al badge
 */
export default function StockBadge({ disponible, minimo, showCount = false }) {
  const nivel = disponible === 0
    ? 'critico'
    : disponible < minimo
    ? 'bajo'
    : 'normal'

  const config = {
    critico: {
      label: 'Sin stock',
      Icon: IconCritico,
      className: styles.critico,
    },
    bajo: {
      label: 'Stock bajo',
      Icon: IconBajo,
      className: styles.bajo,
    },
    normal: {
      label: 'En stock',
      Icon: IconNormal,
      className: styles.normal,
    },
  }

  const { label, Icon, className } = config[nivel]

  return (
    <span className={`${styles.badge} ${className}`}>
      <span className={styles.icon}>
        <Icon />
      </span>
      <span className={styles.label}>{label}</span>
      {showCount && (
        <span className={styles.count}>
          {disponible}
        </span>
      )}
    </span>
  )
}