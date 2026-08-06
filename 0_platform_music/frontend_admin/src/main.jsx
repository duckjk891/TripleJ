import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'

// v162 — 관리자 독립 앱: remoteLogger 미포함
// (관리자 콘솔 로그가 사용자 frontend.log 에 섞이는 것 방지)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
