import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    build: {
      externalizeDeps: { exclude: ['@studio/shared'] },
      lib: {
        entry: resolve(import.meta.dirname, 'electron/main.ts'),
      },
    },
  },
  preload: {
    build: {
      lib: {
        entry: resolve(import.meta.dirname, 'electron/preload.ts'),
      },
    },
  },
  renderer: {
    root: resolve(import.meta.dirname, 'src'),
    build: {
      rollupOptions: {
        input: resolve(import.meta.dirname, 'src/index.html'),
      },
    },
    resolve: {
      alias: {
        '@': resolve(import.meta.dirname, 'src'),
      },
    },
    plugins: [react(), tailwindcss()],
  },
})
