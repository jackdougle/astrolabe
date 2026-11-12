import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', chunkSizeWarningLimit: 8000, target: 'chrome130' },
  worker: { format: 'es' },
  server: { port: 5173, strictPort: true },
});
