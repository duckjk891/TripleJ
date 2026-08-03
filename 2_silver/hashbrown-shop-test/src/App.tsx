import { HashbrownProvider } from '@hashbrownai/react';
import { useState } from 'react';
import { ProductGrid } from './components/ProductGrid';
import { CartPanel } from './components/CartPanel';
import { ChatPanel } from './components/ChatPanel';

// 5180(vite)의 /api 프록시를 경유 — 외부 IP로 접속해도 채팅이 동작
const CHAT_URL = '/api/chat';

export function App() {
  // 모바일에서 채팅 시트 열림/닫힘 (데스크톱에서는 항상 표시)
  const [chatOpen, setChatOpen] = useState(false);

  return (
    <HashbrownProvider url={CHAT_URL}>
      <div className="layout">
        <div className="shop-side">
          <header className="shop-header">
            <h1>🏥 실버케어몰</h1>
            <p>어르신을 위한 의료·보조용품 (Hashbrown AI 쇼핑 테스트)</p>
          </header>
          <ProductGrid />
          <CartPanel />
        </div>
        <aside className={`chat-side ${chatOpen ? 'chat-side-open' : ''}`}>
          <ChatPanel />
        </aside>
        <button
          className="chat-fab"
          onClick={() => {
            const next = !chatOpen;
            if (import.meta.env.DEV) {
              console.info('[App] 채팅 시트:', next ? '열기' : '닫기');
            }
            setChatOpen(next);
          }}
          aria-label={chatOpen ? 'AI 채팅 닫기' : '말로 주문하기 — AI 채팅 열기'}
        >
          {chatOpen ? '✕' : '🎤 말로 주문하기'}
        </button>
      </div>
    </HashbrownProvider>
  );
}

export default App;
