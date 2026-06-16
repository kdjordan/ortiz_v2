import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  // Dev-only: proxy the admin API so the client calls it same-origin (no CORS,
  // cookies just work). The admin backend runs locally on :3001 (see server/).
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  // vite-ssg: keep /admin out of the prerender. It's client-only and auth-gated,
  // so it must never be baked to static HTML or appear in the sitemap.
  ssgOptions: {
    includedRoutes(paths) {
      return paths.filter((path) => path !== '/admin')
    },
  },
})
