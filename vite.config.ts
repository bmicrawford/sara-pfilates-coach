import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'avatar/*.png', 'icons/*.png'],
      manifest: {
        name: 'Sara — PfilAtes Coach',
        short_name: 'Sara',
        description: 'Phone-first companion after your PfilAtes Kajabi purchase.',
        theme_color: '#7C8B70',
        background_color: '#F6F3EE',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
      },
    }),
  ],
  server: {
    port: 43147,
    host: true,
    proxy: {
      '/ask': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        bypass(req) {
          if (req.method !== 'POST') return '/index.html'
        },
      },
      '/speak': { target: 'http://127.0.0.1:8787', changeOrigin: true },
      '/talk': { target: 'http://127.0.0.1:8787', changeOrigin: true },
      '/health': { target: 'http://127.0.0.1:8787', changeOrigin: true },
    },
  },
  preview: {
    port: 43147,
    host: true,
    proxy: {
      '/ask': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        bypass(req) {
          if (req.method !== 'POST') return '/index.html'
        },
      },
      '/speak': { target: 'http://127.0.0.1:8787', changeOrigin: true },
      '/talk': { target: 'http://127.0.0.1:8787', changeOrigin: true },
      '/health': { target: 'http://127.0.0.1:8787', changeOrigin: true },
    },
  },
})
