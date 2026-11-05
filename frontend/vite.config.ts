import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 3000, proxy: { '/api': { target: 'http://localhost:8000', changeOrigin: true } } },
  build: {
    target: 'esnext', outDir: 'dist', sourcemap: false,
    rollupOptions: { output: { manualChunks: { konvaEngine: ['konva', 'react-konva'] } } }
  }
});
