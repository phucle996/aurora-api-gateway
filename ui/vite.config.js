import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  build: { outDir: '../control-plane/internal/console/dist', emptyOutDir: true },
  // Preserve the browser-facing Host so Go can enforce same-origin requests.
  server: { proxy: { '/api': { target: 'http://127.0.0.1:8080', changeOrigin: false } } },
});
