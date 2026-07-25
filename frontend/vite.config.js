import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Teleprogreso S.A.',
        short_name: 'Teleprogreso',
        description: 'Control de personal y supervisión de rutas',
        theme_color: '#1a56db',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }
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
