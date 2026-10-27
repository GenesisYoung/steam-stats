/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

// Firebase App Hosting injects the web app config at build time as FIREBASE_WEBAPP_CONFIG.
// Map it to the VITE_* variables unless they were set explicitly.
const webappConfig = (() => {
  try {
    return JSON.parse(process.env.FIREBASE_WEBAPP_CONFIG ?? '{}') as Record<string, string | undefined>;
  } catch {
    return {};
  }
})();
for (const [viteKey, configKey] of [
  ['VITE_FIREBASE_API_KEY', 'apiKey'],
  ['VITE_FIREBASE_AUTH_DOMAIN', 'authDomain'],
  ['VITE_FIREBASE_PROJECT_ID', 'projectId'],
  ['VITE_FIREBASE_APP_ID', 'appId'],
] as const) {
  const value = webappConfig[configKey];
  if (!process.env[viteKey] && value) process.env[viteKey] = value;
}

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
