import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { initRemoteLogger } from './utils/remoteLogger'

// v46-pre: 콘솔/오류 이벤트를 백엔드 frontend.log 로 자동 전송
initRemoteLogger()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
