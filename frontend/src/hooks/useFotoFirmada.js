/**
 * hooks/useFotoFirmada.js
 * ---------------------------------------------------------------------------
 * Qué hacer cuando un <img> con enlace firmado (HU-S10-02) no carga.
 *
 * El enlace que entrega la API vence a los 10 minutos. Si la pantalla sigue
 * abierta, el siguiente intento de cargar la foto da 403. Ante el primer
 * fallo de una foto se llama una sola vez a `alExpirar` (la recarga que ya
 * tiene la pantalla) para pedir un enlace nuevo. Si el enlace nuevo de la
 * misma foto también falla, el archivo ya no está: se marca como fallida y
 * no se vuelve a pedir, así no hay ciclos con una foto borrada.
 *
 * La foto se identifica por su ruta sin el query (`exp` y `firma` cambian en
 * cada enlace). El contador solo se reinicia si cambia esa ruta.
 * ---------------------------------------------------------------------------
 */
import { useState } from 'react'

/** Ruta de la foto sin `?exp=...&firma=...`. */
export function rutaBase(src) {
  return src ? src.split('?')[0] : null
}

/**
 * @param {string|null} src         URL firmada ya resuelta contra BASE_URL.
 * @param {Function}    [alExpirar] recarga que trae un enlace nuevo.
 * @returns {{ fallida: boolean, alFallar: Function }}
 */
export function useFotoFirmada(src, alExpirar) {
  const base = rutaBase(src)
  const [intento, setIntento] = useState({ base, pidioNueva: false, fallida: false })
  const actual = intento.base === base
    ? intento
    : { base, pidioNueva: false, fallida: false }

  const alFallar = () => {
    if (alExpirar && !actual.pidioNueva) {
      setIntento({ base, pidioNueva: true, fallida: false })
      alExpirar()
      return
    }
    setIntento({ base, pidioNueva: actual.pidioNueva, fallida: true })
  }

  return { fallida: actual.fallida, alFallar }
}
