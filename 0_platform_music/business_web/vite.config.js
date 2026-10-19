import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// MAIDOL 광고주 사이트 — business.maidol.ai.kr (EC2 nginx 정적 서빙 + /api/business 프록시)
// base './' + HashRouter: 어느 경로에서 새로고침해도 index.html 하나로 동작
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5197,
    proxy: {
      '/api': {
        // BIZ_API_TARGET=http://127.0.0.1:5196 으로 로컬 모의 서버 검증 가능
        target: process.env.BIZ_API_TARGET || 'https://api.maidol.ai.kr',
        changeOrigin: true,
      },
    },
  },
});
