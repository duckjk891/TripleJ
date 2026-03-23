import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3002,
    host: '0.0.0.0',
    cors: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
