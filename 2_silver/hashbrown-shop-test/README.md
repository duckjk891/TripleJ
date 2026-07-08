# 실버케어몰 — Hashbrown AI 쇼핑 테스트

[Hashbrown](https://hashbrown.dev)(`@hashbrownai/*` v0.4.1, MIT)을 이용해
**AI 채팅으로 쇼핑몰 상품(노인 지원용 의료·보조용품)을 구매**하는 테스트 페이지.

## 구조

```
server.mjs            Express 어댑터 서버 (포트 3100) → OpenAI 스트리밍
src/
  App.tsx             HashbrownProvider + 레이아웃 (좌: 쇼핑몰 / 우: AI 채팅)
  data/products.ts    상품 8종 (지팡이, 휠체어, 보행보조차, 욕실 안전용품, 혈압계…)
  store.ts            zustand — 장바구니/주문 상태 (버튼과 AI 툴이 같은 상태 공유)
  components/
    ProductGrid.tsx   상품 목록 (수동 담기 버튼)
    CartPanel.tsx     장바구니 + 주문하기 + 주문 내역
    ChatPanel.tsx     ★ 핵심 — useUiChat + 툴 5종 + AI 생성 UI 컴포넌트 4종
    chat/             AI가 채팅 안에 직접 그리는 컴포넌트들
```

## AI가 쓸 수 있는 툴 (useTool)

| 툴 | 설명 |
|---|---|
| `getProducts` | 전체 상품 목록 조회 |
| `getCart` | 현재 장바구니 조회 |
| `addToCart` | 상품 담기 (productId, quantity) |
| `removeFromCart` | 상품 빼기 |
| `checkout` | 주문 실행 — 사용자 확인 후에만 호출하도록 시스템 프롬프트로 제한 |

## AI가 그릴 수 있는 컴포넌트 (exposeComponent)

`Markdown`, `ProductCard`(담기 버튼 포함), `CartCard`, `OrderCard`

## 실행

```bash
cp .env.example .env   # OPENAI_API_KEY 입력
npm install
npm run dev            # 서버(3100) + 클라이언트(5180) 동시 실행
```

→ http://localhost:5180

## 외부(다른 네트워크)에서 접속 — Cloudflare 퀵 터널

```bash
npm run tunnel   # 출력되는 https://xxx.trycloudflare.com 주소로 접속
```

- 주소는 터널 프로세스가 살아있는 동안만 유효, 재시작하면 새 주소 발급
- 주소를 아는 사람은 누구나 채팅(= OpenAI 비용) 사용 가능 → 테스트 후 종료 권장
- 모바일 반응형 적용됨 (768px 이하: 1단 배치 + 💬 플로팅 채팅)

## 테스트 시나리오

1. "무릎이 안 좋은 어머니께 드릴 지팡이 추천해줘" → AI가 ProductCard로 상품 제시
2. "그거 2개 담아줘" → `addToCart` 툴 호출 → 왼쪽 장바구니에 실제 반영
3. "장바구니 보여줘" → CartCard
4. "주문해줘" → AI가 금액 확인 → "응 확인했어" → `checkout` → OrderCard + 주문 내역 반영
