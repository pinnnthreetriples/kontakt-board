import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['app-icon.svg'],
      manifest: {
        name: 'Контакты — рабочая доска',
        short_name: 'Контакты',
        description: 'Офлайн-доска для заявок, контактов и звонков',
        lang: 'ru',
        theme_color: '#f5f7fb',
        background_color: '#f5f7fb',
        display: 'standalone',
        start_url: './#/board',
        icons: [{ src: 'app-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,svg,woff2}'], navigateFallback: 'index.html' },
    }),
  ],
  server: {
    port: 4173,
    watch: { ignored: ['**/.npm-cache/**', '**/coverage/**', '**/test-results/**', '**/aislop-state/**'] },
  },
  preview: { port: 4173 },
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-mui': ['@mui/material', '@mui/icons-material', '@mui/x-date-pickers', '@emotion/react', '@emotion/styled'],
          'vendor-data': ['dexie', 'dexie-react-hooks', 'date-fns', 'zod'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    fileParallelism: false,
    setupFiles: './src/test/setup.ts',
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/shared/lib/**/*.ts', 'src/entities/**/model/**/*.ts', 'src/features/**/model/**/*.ts', 'src/infrastructure/database/**/*.ts'],
      thresholds: { lines: 75, functions: 70, branches: 65, statements: 75 },
      exclude: ['**/*.test.ts', 'src/test/**'],
    },
  },
});
