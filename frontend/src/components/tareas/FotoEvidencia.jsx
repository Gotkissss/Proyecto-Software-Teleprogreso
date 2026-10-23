/**
 * components/tareas/FotoEvidencia.jsx
 * ---------------------------------------------------------------------------
 * Foto de evidencia con aviso cuando el archivo no se puede cargar.
 *
 * Una foto que el backend ya no tiene devuelve 404, y un <img> roto no dice
 * nada: se ve el icono de imagen partida y el texto alternativo, sin ninguna
 * pista de qué pasó. Cuando el disco del contenedor se vacía en un deploy eso
 * le ocurre a TODAS las evidencias subidas antes, y desde la pantalla parece
 * que la aplicación se rompió.
 *
 * Aquí se captura el `onError` del <img> y se pinta un aviso en su lugar. El
 * envoltorio (el enlace o el botón que amplía la foto) también desaparece: sin
 * imagen que abrir, un enlace que lleva a una página vacía es peor que nada.
 *
 * El enlace firmado vence a los 10 minutos (HU-S10-02). Con `alExpirar`, el
 * primer fallo de una foto pide un enlace nuevo antes de mostrar el aviso; si
 * el nuevo también falla, sale el aviso (ver hooks/useFotoFirmada.js).
 *
 * `envolver` recibe el <img> ya montado y devuelve el árbol que lo contiene:
 *
 *   <FotoEvidencia
 *     src={urlArchivo(ev.foto_evidencia)}
 *     alt={`Evidencia de ${tarea.titulo}`}
 *     imgClassName={styles.foto}
 *     alExpirar={recargarEvidencias}
 *     envolver={(img) => <a href={foto} target="_blank" rel="noopener noreferrer">{img}</a>}
 *   />
 * ---------------------------------------------------------------------------
 */
import { useFotoFirmada } from '../../hooks/useFotoFirmada'
import styles from './FotoEvidencia.module.css'

const IconFotoRota = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <path d="M21 15l-5-5L5 21" />
  </svg>
)

export default function FotoEvidencia({
  src,
  alt,
  imgClassName,
  envolver,
  alExpirar,
  textoNoDisponible = 'No se pudo cargar la foto',
}) {
  const { fallida, alFallar } = useFotoFirmada(src, alExpirar)

  if (!src || fallida) {
    return (
      <span className={styles.noDisponible} role="img" aria-label={textoNoDisponible}>
        <IconFotoRota />
        <span className={styles.texto}>{textoNoDisponible}</span>
      </span>
    )
  }

  const img = (
    <img
      src={src}
      alt={alt}
      className={imgClassName}
      loading="lazy"
      onError={alFallar}
    />
  )

  return envolver ? envolver(img) : img
}
