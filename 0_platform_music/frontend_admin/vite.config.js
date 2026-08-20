import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

// v162 — 관리자 독립 앱(포트 4001). HTTPS 인증서는 자체 ./certs 우선,
// 없으면 사용자 앱 사이드카(../frontend/certs) 재사용 — 인증서 파일 중복 방지.
function resolveCertDir() {
  const candidates = [
    path.resolve(rootDir, 'certs'),
    path.resolve(rootDir, '../frontend/certs'),
  ]
  for (const dir of candidates) {
    if (
      fs.existsSync(path.join(dir, 'cert.pem')) &&
      fs.existsSync(path.join(dir, 'key.pem'))
    ) {
      return dir
    }
  }
  return null
}

const certDir = resolveCertDir()
const useHttps = !!certDir

// v187 — 구번들 오인 방지(관리자 앱 한정): 번들 생성 시각을 상수로 주입한다.
// define 은 "빌드 타임 상수" 치환이므로 dev 서버에서는 HMR 로 갱신되지 않는다
// → dev 에서 이 값의 의미는 "vite dev 프로세스 기동 시각"(사이드바 툴팁에 하드 새로고침 안내 병기).
// 라이브러리 추가 없음 / dev 캐시 정책 무변경.
const BUILD_TIME = new Date().toISOString()

if (useHttps) {
  console.info(`[vite] HTTPS enabled (mkcert cert at ${certDir})`)
} else {
  console.info('[vite] HTTP only (no cert at ./certs or ../frontend/certs)')
}

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
  server: {
    port: 4001,
    host: '0.0.0.0',
    watch: {
      usePolling: true, // WSL2 /mnt/d(drvfs) inotify 미지원 → 폴링 감시
      interval: 1000,   // drvfs stat 비용 고려 1s
    },
    ...(useHttps && {
      https: {
        key: fs.readFileSync(path.join(certDir, 'key.pem')),
        cert: fs.readFileSync(path.join(certDir, 'cert.pem')),
      },
    }),
    proxy: {
      '/api': {
        target: 'http://localhost:9006',
        changeOrigin: true,
        secure: false,
        ws: true,
      },
    },
  },
})
