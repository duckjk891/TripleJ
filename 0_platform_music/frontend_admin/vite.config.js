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

if (useHttps) {
  console.info(`[vite] HTTPS enabled (mkcert cert at ${certDir})`)
} else {
  console.info('[vite] HTTP only (no cert at ./certs or ../frontend/certs)')
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4001,
    host: '0.0.0.0',
    ...(useHttps && {
      https: {
        key: fs.readFileSync(path.join(certDir, 'key.pem')),
        cert: fs.readFileSync(path.join(certDir, 'cert.pem')),
      },
    }),
    proxy: {
      '/api': {
        target: 'http://localhost:9005',
        changeOrigin: true,
        secure: false,
        ws: true,
      },
    },
  },
})
