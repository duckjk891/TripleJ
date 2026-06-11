import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

const certDir = path.resolve(__dirname, 'certs')
const certPath = path.join(certDir, 'cert.pem')
const keyPath = path.join(certDir, 'key.pem')
const useHttps = fs.existsSync(certPath) && fs.existsSync(keyPath)

if (useHttps) {
  // eslint-disable-next-line no-console
  console.info('[vite] HTTPS enabled (mkcert cert at ./certs)')
} else {
  // eslint-disable-next-line no-console
  console.info('[vite] HTTP only (no cert at ./certs)')
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4000,
    host: '0.0.0.0',
    ...(useHttps && {
      https: {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
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
