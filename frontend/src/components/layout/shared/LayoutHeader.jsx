/**
 * components/layout/shared/LayoutHeader.jsx
 * ---------------------------------------------------------------------------
 * Header compartido por AppLayout (técnico) y SupervisorLayout.
 * Misma estructura DOM para ambos: logo + título/subtítulo a la izquierda,
 * slot libre `right` a la derecha. Las diferencias visuales entre variantes
 * (técnico vs supervisor) se resuelven solo con CSS (ver módulo de estilos).
 * ---------------------------------------------------------------------------
 */

import styles from './LayoutHeader.module.css'

export default function LayoutHeader({ variant = 'app', logo, title, subtitle, right }) {
  return (
    <header className={`${styles.topBar} ${variant === 'supervisor' ? styles.supervisor : ''}`}>
      <div className={styles.topBarLeft}>
        {logo}
        <div className={styles.brandText}>
          <span className={styles.brandName}>{title}</span>
          {subtitle && <span className={styles.brandSub}>{subtitle}</span>}
        </div>
      </div>

      <div className={styles.topBarRight}>
        {right}
      </div>
    </header>
  )
}