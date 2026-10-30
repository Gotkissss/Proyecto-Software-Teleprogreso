import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Los archivos de /public que deben acompañar al service worker. El
      // logo va aquí porque es la única imagen de la marca que pinta la app
      // (login, cambio de contraseña y la barra del supervisor) y fuera de
      // esta lista no se guarda: el shell salía de la caché y el logo se
      // pedía a la red, así que con el servidor caído o sin señal la pantalla
      // aparecía entera y con el hueco roto donde va la marca.
      includeAssets: [
        'icon-192.png',
        'icon-512.png',
        'apple-touch-icon.png',
        'teleprogreso-logo.jpg',
      ],
      manifest: {
        name: 'Teleprogreso S.A.',
        short_name: 'Teleprogreso',
        description: 'Control de personal y supervisión de rutas',
        // Azul de la marca (mismo valor que --color-primary en index.css)
        theme_color: '#1e88e5',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        lang: 'es',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          // "maskable" evita que Android recorte el logo al aplicar su máscara:
          // los íconos se generaron con margen suficiente para ese recorte.
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      }
    })
  ],
  // Configuración de Vitest (pruebas unitarias)
  test: {
    environment: 'jsdom',       // simula el DOM del navegador
    globals: true,              // describe/it/expect sin imports
    setupFiles: './src/tests/setup.js',
    css: false,                 // no procesar CSS modules en tests
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://backend:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  }
})
