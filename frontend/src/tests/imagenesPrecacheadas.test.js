/**
 * tests/imagenesPrecacheadas.test.js
 * ---------------------------------------------------------------------------
 * Regresión del logo que no cargaba "por ningún lado".
 *
 * La app es una PWA: el service worker guarda el shell (index.html, el JS y el
 * CSS) y lo sirve aunque el servidor no conteste. Pero solo guarda los
 * archivos de /public que estén en `includeAssets` de vite.config.js, y el
 * logo no estaba. Resultado: con el frontend caído o sin señal, la pantalla
 * salía entera desde la caché y la única imagen de la marca —login, cambio de
 * contraseña obligatorio y la barra del supervisor— se pedía a la red y salía
 * rota. Se veía como "se cayó el logo", no como "se cayó el servidor".
 *
 * El segundo test vigila que la extensión diga la verdad: el archivo se
 * llamaba .png y por dentro era un JPEG, así que se servía con un
 * Content-Type que no era el suyo.
 *
 * El tercero exige que el logo de la marca tenga canal alfa. Era un JPEG, que
 * no puede tenerlo, así que arrastraba su propio fondo #F7F7F7: dentro de la
 * tarjeta blanca del login se veía un rectángulo de otro blanco, y en la caja
 * azul clara de la barra del supervisor, un recuadro blanco. Volver a
 * exportarlo plano devolvería las dos cosas, y es el tipo de detalle que nadie
 * mira en un diff binario.
 * ---------------------------------------------------------------------------
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'

// Rutas relativas a la raíz del frontend: vitest corre desde ahí, y en jsdom
// `import.meta.url` es un http://, no un file:// del que sacar la carpeta.
const CONFIG = 'vite.config.js'
const PUBLIC = 'public'
const FUENTES = 'src'

/** Los `includeAssets: [...]` que vite.config.js le pasa a VitePWA. */
function assetsPrecacheados() {
  const config = readFileSync(CONFIG, 'utf8')
  const lista = config.match(/includeAssets:\s*\[([^\]]*)\]/s)
  expect(lista, 'vite.config.js debe declarar includeAssets').not.toBeNull()
  return [...lista[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
}

/** Rutas tipo src="/algo.png" que el código pide a la raíz del sitio. */
function imagenesReferenciadas() {
  const encontradas = new Set()
  const recorrer = (dir) => {
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      const ruta = join(dir, entrada.name)
      if (entrada.isDirectory()) {
        if (entrada.name !== 'tests') recorrer(ruta)
        continue
      }
      if (!/\.(jsx?|css)$/.test(entrada.name)) continue
      const texto = readFileSync(ruta, 'utf8')
      for (const m of texto.matchAll(/["'(]\/([\w.-]+\.(?:png|jpe?g|svg|webp|gif))["')]/g)) {
        encontradas.add(m[1])
      }
    }
  }
  recorrer(FUENTES)
  return [...encontradas]
}

// Firmas de los formatos que usa la app, para comparar con la extensión.
// WebP no entra aquí porque la suya no es un prefijo: son "RIFF" al principio
// y "WEBP" en el byte 8, con el tamaño del archivo en medio.
const FIRMAS = [
  { ext: ['.png'], bytes: [0x89, 0x50, 0x4e, 0x47] },
  { ext: ['.jpg', '.jpeg'], bytes: [0xff, 0xd8, 0xff] },
]

function esWebp(buf) {
  return buf.subarray(0, 4).toString('latin1') === 'RIFF'
    && buf.subarray(8, 12).toString('latin1') === 'WEBP'
}

/**
 * ¿El archivo puede ser transparente?
 *
 * No se decodifica la imagen: basta con la cabecera, que es justo lo que
 * cambia si alguien vuelve a exportar el logo aplanado.
 *
 *  - PNG: el byte 25 es el tipo de color del IHDR; 4 y 6 llevan alfa. Un PNG
 *    sin alfa todavía puede tener un trozo `tRNS` con la paleta transparente.
 *  - WebP: solo el contenedor extendido (VP8X) y el sin pérdida (VP8L) pueden
 *    llevar alfa. En VP8X es el bit 0x10 del byte 20; el VP8 simple nunca.
 *  - JPEG: no puede, y ese era justo el problema.
 */
function tieneAlfa(ruta) {
  const buf = readFileSync(ruta)
  const ext = extname(ruta).toLowerCase()
  if (ext === '.png') {
    const tipoColor = buf[25]
    return tipoColor === 4 || tipoColor === 6 || buf.includes('tRNS', 0, 'latin1')
  }
  if (ext === '.webp') {
    if (!esWebp(buf)) return false
    const formato = buf.subarray(12, 16).toString('latin1')
    if (formato === 'VP8X') return (buf[20] & 0x10) !== 0
    if (formato === 'VP8L') return true
    return false
  }
  if (ext === '.svg') return true
  return false
}

describe('imágenes de /public que pinta la app', () => {
  it('todas están en includeAssets, para que el service worker las guarde', () => {
    const precacheados = assetsPrecacheados()
    const referenciadas = imagenesReferenciadas()

    expect(referenciadas.length).toBeGreaterThan(0)
    for (const imagen of referenciadas) {
      expect(
        precacheados,
        `${imagen} se pinta en la app pero no está en includeAssets: sin servidor saldría rota`,
      ).toContain(imagen)
    }
  })

  it('todas existen y su extensión coincide con el contenido del archivo', () => {
    for (const imagen of imagenesReferenciadas()) {
      const ruta = join(PUBLIC, imagen)
      expect(existsSync(ruta), `falta public/${imagen}`).toBe(true)

      if (extname(imagen).toLowerCase() === '.webp') {
        expect(
          esWebp(readFileSync(ruta)),
          `public/${imagen} no es del formato que dice su extensión`,
        ).toBe(true)
        continue
      }

      const firma = FIRMAS.find((f) => f.ext.includes(extname(imagen).toLowerCase()))
      if (!firma) continue
      const cabecera = [...readFileSync(ruta).subarray(0, firma.bytes.length)]
      expect(cabecera, `public/${imagen} no es del formato que dice su extensión`).toEqual(
        firma.bytes,
      )
    }
  })

  it('el logo de la marca es transparente, no un recuadro con su propio blanco', () => {
    const logos = imagenesReferenciadas().filter((i) => i.includes('teleprogreso-logo'))

    expect(logos, 'la app tiene que pintar el logo de la marca en alguna parte').not.toHaveLength(0)
    for (const logo of logos) {
      expect(
        tieneAlfa(join(PUBLIC, logo)),
        `public/${logo} no tiene canal alfa: sobre la tarjeta blanca del login y
         sobre la caja azul del supervisor se vería su propio fondo como un
         recuadro de otro color`,
      ).toBe(true)
    }
  })
})
