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
  },
});
