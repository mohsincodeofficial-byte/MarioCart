import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        landing: resolve(__dirname, 'index.html'),
        tv: resolve(__dirname, 'tv.html'),
        controller: resolve(__dirname, 'controller.html'),
      },
    },
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: {
      // Proxy Socket.IO HTTP & WebSocket upgrade to Node.js server (port 3000)
      '/socket.io': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      },
      // Proxy the info API endpoint
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
