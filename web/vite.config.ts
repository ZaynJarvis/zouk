import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const SERVER_TARGET = process.env.VITE_SERVER_TARGET || 'http://localhost:7777';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  server: {
    proxy: {
      '/api': { target: SERVER_TARGET, changeOrigin: true },
      '/ws': { target: SERVER_TARGET, ws: true, changeOrigin: true },
    },
  },
});
