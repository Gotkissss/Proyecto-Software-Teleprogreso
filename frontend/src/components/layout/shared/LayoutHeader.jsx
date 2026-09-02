/**
 * components/layout/shared/LayoutHeader.jsx
 * ---------------------------------------------------------------------------
 * Header compartido por AppLayout (técnico) y SupervisorLayout.
 * Misma estructura DOM para ambos: slot `leading` + logo + título/subtítulo a
 * la izquierda, slot libre `right` a la derecha. Las diferencias visuales
 * entre variantes (técnico vs supervisor) se resuelven solo con CSS (ver
 * módulo de estilos).
 *
 * `leading` lo usa el supervisor para el botón que abre la barra lateral
 * cuando esta se ha convertido en cajón; `logo` puede venir vacío porque en
 * ese panel la marca vive en la propia barra lateral.
 * ---------------------------------------------------------------------------
 */

import styles from './LayoutHeader.module.css'

export default function LayoutHeader({ variant = 'app', leading, logo, title, subtitle, right }) {
  return (
    <header className={`${styles.topBar} ${variant === 'supervisor' ? styles.supervisor : ''}`}>
      <div className={styles.topBarLeft}>
        {leading}
        {logo}
        {title && (
          <div className={styles.brandText}>
            <span className={styles.brandName}>{title}</span>
            {subtitle && <span className={styles.brandSub}>{subtitle}</span>}
          </div>
        )}
      </div>

      <div className={styles.topBarRight}>
        {right}
      </div>
    </header>
  )
}