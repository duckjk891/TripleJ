# OneCompany Village

Generative Agents 프로젝트 - Smallville 논문 기반 구현

## 프로젝트 구조

```
1_oneCompany/
├── frontend/          # Phaser.js 게임 (TypeScript)
├── backend/           # FastAPI 서버 (Python)
├── agent_core/        # Phase B: 에이전트 인지 시스템
├── world/             # 월드 데이터
└── shared/            # 공유 타입/상수
```

## 실행 방법

### Frontend (Phaser.js)

```bash
cd frontend
npm install
npm run dev
```

브라우저에서 http://localhost:3000 접속

### Backend (FastAPI)

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

API 문서: http://localhost:8000/docs

## 개발 단계

- **Phase A**: 게임 환경 + 캐릭터 시스템 (LLM 없음)
- **Phase B**: 에이전트 인지 시스템 (LLM 연결)

## 참고 자료

- [Generative Agents 논문](https://arxiv.org/abs/2304.03442)
- [Phaser.js 문서](https://phaser.io/docs)
- [FastAPI 문서](https://fastapi.tiangolo.com/)
