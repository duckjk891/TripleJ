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
        // ADMIN_API_TARGET=http://127.0.0.1:5198 로 로컬 모의 서버 검증 가능
        target: process.env.ADMIN_API_TARGET || 'https://api.maidol.ai.kr',
        changeOrigin: true,
      },
    },
  },
});
