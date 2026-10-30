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
const FIRMAS = [
  { ext: ['.png'], bytes: [0x89, 0x50, 0x4e, 0x47] },
  { ext: ['.jpg', '.jpeg'], bytes: [0xff, 0xd8, 0xff] },
]

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

      const firma = FIRMAS.find((f) => f.ext.includes(extname(imagen).toLowerCase()))
      if (!firma) continue
      const cabecera = [...readFileSync(ruta).subarray(0, firma.bytes.length)]
      expect(cabecera, `public/${imagen} no es del formato que dice su extensión`).toEqual(
        firma.bytes,
      )
    }
  })
})
