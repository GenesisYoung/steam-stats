/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    strictPort: true,
    // Same-origin /api in development (mirrors Firebase Hosting rewrites in production).
    proxy: {
      '/api': { target: process.env.VITE_DEV_API_TARGET ?? 'http://127.0.0.1:8080', changeOrigin: false },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    // The ECharts chunk (~600 kB, ~200 kB gzip) is lazy-loaded with chart views only.
    chunkSizeWarningLimit: 700,
  },
  test: {
    environment: 'jsdom',
  },
});
