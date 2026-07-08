import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5180,
    // Cloudflare 터널 등 외부 도메인으로 접속 허용
    allowedHosts: ['.trycloudflare.com'],
    // /mnt/d (Windows 드라이브)에서는 inotify가 안 먹혀서 폴링으로 변경 감지
    watch: {
      usePolling: true,
      interval: 500,
    },
    proxy: {
      '/api': 'http://localhost:3100',
    },
  },
});
