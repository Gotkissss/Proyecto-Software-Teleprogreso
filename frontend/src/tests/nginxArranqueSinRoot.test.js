/**
 * tests/nginxArranqueSinRoot.test.js
 * ---------------------------------------------------------------------------
 * Regresión del frontend que estuvo cuatro días devolviendo 502.
 *
 * El contenedor de producción corre como `nginx` (uid 101), no como root. El
 * arranque genera la configuración de nginx a partir de las plantillas y la
 * escribía en /etc/nginx/conf.d: el Dockerfile le daba esa carpeta al usuario
 * `nginx` con un `chown`, pero el cambio de dueño no sobrevive a la imagen que
 * construye Railway y la carpeta llega con dueño root y modo 755. Así que
 * moría en "can't create ...: Permission denied" y reiniciaba en bucle. No se
 * notó porque el service worker seguía sirviendo la app desde la caché; el
 * único síntoma visible era el logo roto.
 *
 * Estos tests fijan dos cosas que tienen que seguir cuadrando entre el
 * Dockerfile y las plantillas, y que nada vuelve a escribir bajo /etc.
 * ---------------------------------------------------------------------------
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// Rutas relativas a la raíz del frontend, que es desde donde corre vitest.
const DOCKERFILE = readFileSync('Dockerfile', 'utf8')
const PLANTILLAS = ['nginx/default.conf.tpl', 'nginx/seguridad.conf.tpl'].map((ruta) => ({
  ruta,
  texto: readFileSync(ruta, 'utf8'),
}))

// El CMD de la etapa de producción, que es el último: el primero es el de la
// etapa de desarrollo, que levanta vite y no genera ninguna configuración.
const CMD = DOCKERFILE.split('\n')
  .filter((linea) => linea.startsWith('CMD '))
  .pop()

describe('arranque de nginx sin root', () => {
  it('el contenedor no escribe nada fuera de /tmp', () => {
    expect(CMD, 'el Dockerfile debe tener un CMD').toBeDefined()

    // Cada `> destino` del arranque tiene que caer en /tmp.
    const destinos = [...CMD.matchAll(/>\s*(\/\S+)/g)].map((m) => m[1])
    expect(destinos.length).toBeGreaterThan(0)
    for (const destino of destinos) {
      expect(destino, `el arranque escribe en ${destino}, que no es escribible sin root`).toMatch(
        /^\/tmp\//,
      )
    }
  })

  it('nginx lee la configuración de la misma carpeta donde el arranque la deja', () => {
    // La carpeta que crea el arranque...
    const creada = CMD.match(/mkdir -p (\/tmp\/[\w/.-]+)/)
    expect(creada, 'el arranque debe crear la carpeta de configuración').not.toBeNull()

    // ...es la que el Dockerfile le pone a nginx en su include...
    expect(DOCKERFILE).toContain(`include ${creada[1]}/*.conf;`)

    // ...y la misma de la que tiran las plantillas.
    for (const { ruta, texto } of PLANTILLAS) {
      for (const incluido of [...texto.matchAll(/include\s+(\S+);/g)].map((m) => m[1])) {
        expect(incluido, `${ruta} incluye ${incluido}, fuera de ${creada[1]}`).toContain(creada[1])
      }
    }
  })

  it('las carpetas temporales de nginx también salen de /var', () => {
    const { texto } = PLANTILLAS.find((p) => p.ruta.endsWith('default.conf.tpl'))
    const temporales = [...texto.matchAll(/^(\w+_temp_path)\s+(\S+);/gm)]

    expect(temporales.length).toBeGreaterThan(0)
    for (const [, directiva, ruta] of temporales) {
      expect(ruta, `${directiva} apunta a ${ruta}, que necesita root`).toMatch(/^\/tmp\//)
    }
  })
})
