import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' + HashRouter — /admin 하위 정적 서빙(StaticFiles)에서 리프레시에도 안전
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5199,
    proxy: {
      '/api': {
        target: 'https://api.maidol.ai.kr',
        changeOrigin: true,
      },
    },
  },
});
