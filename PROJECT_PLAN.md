# Generative Agents 프로젝트 구현 계획서

## 1. 프로젝트 개요

Smallville 논문(Stanford/Google)을 기반으로 한 생성형 에이전트 시뮬레이션 프로젝트.

**2단계 구현 전략:**
- **Phase A**: 게임 환경 + 캐릭터 시스템 (LLM 없음)
- **Phase B**: 에이전트 인지 시스템 (LLM 연결)

```
┌─────────────────────────────────────────────────────────────┐
│  Phase A: 껍데기 (Character)                                │
│  - 게임 환경, 맵, 캐릭터 스프라이트                          │
│  - 캐릭터 생성 버튼 + UI                                    │
│  - 규칙 기반 기본 행동                                      │
│  - LLM 없음                                                │
└─────────────────────────────────────────────────────────────┘
                              ↓
                         LLM 연결
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  Phase B: 두뇌 (Agent)                                      │
│  - Memory Stream, Retrieval                                │
│  - Perceive, Planning, Reacting, Reflection                │
│  - 대화 시스템, 사용자 개입                                  │
│  - LLM 연결됨                                              │
└─────────────────────────────────────────────────────────────┘
```

**핵심 원칙:** 같은 생성 버튼 → Phase A에서는 캐릭터, Phase B에서는 에이전트 생성

---

## 2. 기술 스택

### 프론트엔드
| 기술 | 용도 | Phase |
|------|------|-------|
| **Phaser.js 3** | 2D 웹 게임 프레임워크 | A |
| **Tiled Map Editor** | 맵 제작 | A |
| **TypeScript** | 타입 안정성 | A |
| **Vite** | 빌드 도구 | A |

### 백엔드
| 기술 | 용도 | Phase |
|------|------|-------|
| **FastAPI** | API 서버 | A |
| **Python 3.11+** | 런타임 | A |
| **WebSocket** | 실시간 통신 | A |

### AI/LLM (Phase B에서 추가)
| 기술 | 용도 | Phase |
|------|------|-------|
| **OpenAI API (GPT-3.5-turbo)** | 에이전트 인지 | B |
| **OpenAI Embedding API** | 텍스트 벡터화 | B |
| **NumPy** | 코사인 유사도 계산 | B |

---

# Phase A: 게임 환경 + 캐릭터 시스템

> **목표:** LLM 없이 동작하는 게임 환경과 캐릭터 생성 시스템 구축

---

## A-1. 시스템 아키텍처 (Phase A)

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (Phaser.js)                      │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐    │
│  │ Game View │ │ Character │ │  Creator  │ │   Info    │    │
│  │   (Map)   │ │ Sprites   │ │  Button   │ │  Panel    │    │
│  └───────────┘ └───────────┘ └───────────┘ └───────────┘    │
└─────────────────────────────┬───────────────────────────────┘
                              │ REST API / WebSocket
┌─────────────────────────────▼───────────────────────────────┐
│                   Backend (FastAPI)                          │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐    │
│  │   World   │ │ Character │ │   Time    │ │  Action   │    │
│  │  Manager  │ │  Manager  │ │  Manager  │ │  Manager  │    │
│  └───────────┘ └───────────┘ └───────────┘ └───────────┘    │
└─────────────────────────────────────────────────────────────┘
```

---

## A-2. Step별 구현 계획

### Step A-1: 프로젝트 초기 설정

**목표:** 개발 환경 구축 및 프로젝트 구조 생성

```
1_oneCompany/
├── frontend/                 # Phaser.js 게임
│   ├── src/
│   ├── assets/
│   ├── package.json
│   └── vite.config.ts
├── backend/                  # FastAPI 서버
│   ├── app/
│   ├── requirements.txt
│   └── Dockerfile
└── shared/                   # 공유 타입/상수
```

**작업 목록:**
- [x] frontend: Vite + Phaser.js + TypeScript 설정
- [x] backend: FastAPI + uvicorn 설정
- [x] 기본 폴더 구조 생성
- [ ] .gitignore, README.md 작성
- [x] 개발 서버 실행 확인 (프론트 3000, 백엔드 8000)

**완료 기준:** `npm run dev`와 `uvicorn` 실행 시 빈 화면/API 응답 확인 ✅

---

### Step A-2: Phaser.js 기본 게임 환경

**목표:** 빈 게임 캔버스와 기본 씬 구조

```typescript
// src/main.ts
const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    width: 1280,
    height: 720,
    scene: [MainScene, UIScene],
    physics: {
        default: 'arcade',
        arcade: { gravity: { y: 0 } }  // 탑다운 뷰
    }
};
```

**작업 목록:**
- [x] Phaser 게임 인스턴스 생성
- [x] MainScene (게임 월드)
- [x] UIScene (오버레이 UI)
- [x] 카메라 설정 (팬, 줌)
- [x] 키보드/마우스 입력 처리

**완료 기준:** 빈 게임 화면이 표시되고 카메라 이동 가능 ✅

---

### Step A-3: 맵 제작 및 로드

**목표:** Tiled로 제작한 맵을 Phaser에서 로드

**맵 구조:**
```
┌────────────────────────────────────────┐
│              Park                       │
│    🌳  🌳      🪑      🌳  🌳           │
├────────────────────────────────────────┤
│     Main Office          │    Cafe     │
│  ┌─────┐ ┌─────┐ ┌─────┐│  ┌─────┐    │
│  │Desk1│ │Desk2│ │Desk3││  │Table│    │
│  └─────┘ └─────┘ └─────┘│  └─────┘    │
│        ☕ Coffee Machine │   Counter   │
│  ┌──────────────────┐   │             │
│  │  Meeting Room    │   │             │
│  └──────────────────┘   │             │
└────────────────────────────────────────┘
```

**작업 목록:**
- [x] Tiled에서 맵 제작 (tileset, layers) - 코드로 대체 (mapData.ts)
- [x] Ground 레이어 (바닥)
- [x] Collision 레이어 (충돌 영역)
- [x] Objects 레이어 (상호작용 가능 오브젝트)
- [x] Phaser에서 Tiled JSON 로드 - 코드로 대체 (MapRenderer.ts)
- [x] 충돌 처리 설정

**파일 구조:**
```
assets/
├── tiles/
│   └── tileset.png          # 타일셋 이미지
├── maps/
│   └── main_map.json        # Tiled 맵 파일
└── sprites/
    └── characters/          # 캐릭터 스프라이트
```

**완료 기준:** 맵이 화면에 표시되고 충돌 영역 작동 ✅

---

### Step A-4: 캐릭터 스프라이트 시스템

**목표:** 캐릭터 표시 및 기본 이동

```typescript
class Character extends Phaser.GameObjects.Sprite {
    id: string;
    characterName: string;
    currentAction: string;

    // 이동 관련
    moveSpeed: number = 100;
    targetPosition: { x: number, y: number } | null = null;

    // 외형
    avatarKey: string;

    // 상태
    state: 'idle' | 'walking' | 'acting';
}
```

**작업 목록:**
- [x] Character 클래스 구현
- [x] 스프라이트 시트 로드 (idle, walk 애니메이션)
- [x] 4방향 이동 애니메이션
- [ ] 경로 이동 (A* pathfinding)
- [x] 이름 표시 (캐릭터 위 텍스트)
- [x] 현재 행동 표시 (말풍선 or 이모지)

**스프라이트 구조:**
```
character_spritesheet.png
┌─────┬─────┬─────┬─────┐
│idle │walk1│walk2│walk3│  ← 아래 방향
├─────┼─────┼─────┼─────┤
│idle │walk1│walk2│walk3│  ← 왼쪽 방향
├─────┼─────┼─────┼─────┤
│idle │walk1│walk2│walk3│  ← 오른쪽 방향
├─────┼─────┼─────┼─────┤
│idle │walk1│walk2│walk3│  ← 위 방향
└─────┴─────┴─────┴─────┘
```

**완료 기준:** 캐릭터가 화면에 표시되고 애니메이션과 함께 이동 ✅

---

### Step A-5: 캐릭터 생성 버튼 및 UI

**목표:** 버튼 클릭 → 캐릭터 생성 모달 → 캐릭터 스폰

```
┌─────────────────────────────────────────────────────────────┐
│  게임 화면                                    [+ 캐릭터 생성] │
│                                                             │
│     🧑 김서연                                               │
│        "커피 마시는 중"                                     │
│                                                             │
│              🧑 박민수                                      │
│                 "걷는 중"                                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
         ↓ 버튼 클릭
┌─────────────────────────────────────────────────────────────┐
│                   캐릭터 생성하기                            │
├─────────────────────────────────────────────────────────────┤
│  [아바타 선택]  👤 👤 👤 👤 👤 👤                           │
│                                                             │
│  이름: [________________]                                   │
│                                                             │
│  직업/역할: [________________]                              │
│                                                             │
│  시작 위치: [▼ Main Office > Open Space]                    │
│                                                             │
│  (Phase B에서 추가될 항목들 - 현재 비활성화)                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 🔒 성격, 배경스토리, 일과 등은 LLM 연결 후 활성화     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│           [취소]                    [생성하기]               │
└─────────────────────────────────────────────────────────────┘
```

**작업 목록:**
- [x] UI Scene에 생성 버튼 추가
- [x] 생성 모달 컴포넌트
- [x] 아바타 선택 UI
- [x] 이름 입력 필드
- [x] 직업 입력 필드
- [x] 시작 위치 선택 (드롭다운)
- [x] Phase B 미리보기 (비활성화 상태)
- [x] 생성 버튼 클릭 → API 호출 → 캐릭터 스폰

**API:**
```
POST /api/characters
{
    "name": "김서연",
    "occupation": "Software Engineer",
    "avatar_id": "avatar_01",
    "spawn_location": "Main Office > Open Space"
}

Response:
{
    "id": "char_001",
    "name": "김서연",
    "position": { "x": 100, "y": 200 },
    ...
}
```

**완료 기준:** 버튼 클릭 → 모달 → 정보 입력 → 캐릭터가 맵에 스폰 ✅

---

### Step A-6: 캐릭터 정보 패널

**목표:** 캐릭터 클릭 시 정보 표시

```
┌─────────────────────────────────────────┐
│  👤 김서연                    [X 닫기]  │
├─────────────────────────────────────────┤
│  직업: Software Engineer                │
│  위치: Main Office > Open Space         │
│  상태: 커피 마시는 중 ☕                 │
│                                         │
│  ─────────────────────────────────────  │
│  📍 이동 기록 (최근 5개)                 │
│  • 09:15 - Open Space 도착              │
│  • 09:10 - Kitchen에서 이동             │
│  • 09:00 - 출근                         │
│                                         │
│  (Phase B에서 추가)                      │
│  🔒 기억, 계획, 반성 등은 LLM 연결 후    │
└─────────────────────────────────────────┘
```

**작업 목록:**
- [x] 캐릭터 클릭 이벤트
- [x] 정보 패널 UI 컴포넌트
- [x] 기본 정보 표시 (이름, 직업, 위치, 상태)
- [x] 이동 기록 표시
- [x] Phase B 예고 섹션 (잠금 상태)

**완료 기준:** 캐릭터 클릭 시 정보 패널 표시 ✅

---

### Step A-7: 규칙 기반 행동 시스템

**목표:** LLM 없이 캐릭터가 자동으로 행동 (랜덤/규칙 기반)

```typescript
class BasicBehaviorSystem {
    // 간단한 행동 패턴 (LLM 없이)
    behaviors = [
        { action: "서 있기", duration: 5000, emoji: "🧍" },
        { action: "걷기", duration: 3000, emoji: "🚶" },
        { action: "커피 마시기", location: "Coffee Machine", duration: 8000, emoji: "☕" },
        { action: "책상에서 일하기", location: "Desk", duration: 15000, emoji: "💻" },
        { action: "대화하기", nearCharacter: true, duration: 10000, emoji: "💬" },
    ];

    getNextBehavior(character: Character): Behavior {
        // 랜덤 또는 시간/위치 기반 행동 선택
        return this.behaviors[Math.floor(Math.random() * this.behaviors.length)];
    }
}
```

**행동 패턴:**
| 시간대 | 가능한 행동 |
|--------|------------|
| 06:00-09:00 | 출근, 커피 마시기 |
| 09:00-12:00 | 책상에서 일하기, 회의 |
| 12:00-13:00 | 점심 (카페, 외출) |
| 13:00-18:00 | 책상에서 일하기, 회의, 휴식 |
| 18:00-22:00 | 퇴근, 공원 산책 |

**작업 목록:**
- [x] BasicBehaviorSystem 클래스 - CharacterManager에 통합
- [x] 시간대별 행동 확률 테이블
- [x] 랜덤 행동 선택
- [x] 행동 실행 (이동 + 상태 변경)
- [x] 행동 완료 후 다음 행동 선택
- [x] 두 캐릭터가 가까우면 "대화" 행동 트리거

**완료 기준:** 캐릭터들이 자동으로 돌아다니며 행동 수행 ✅

---

### Step A-8: 게임 시간 시스템

**목표:** 게임 내 시간 흐름 구현

```typescript
class GameTimeManager {
    gameTime: Date;              // 게임 내 시간
    timeSpeed: number = 60;      // 실제 1초 = 게임 60초
    isPaused: boolean = false;

    // UI 표시: "Day 1 - 09:15 AM"
    getDisplayTime(): string;

    // 시간 조절
    setSpeed(speed: number): void;
    pause(): void;
    resume(): void;
}
```

**UI:**
```
┌──────────────────────────────────┐
│  📅 Day 1    🕐 09:15 AM         │
│  [⏸️ 일시정지] [⏩x1] [⏩x2] [⏩x5] │
└──────────────────────────────────┘
```

**작업 목록:**
- [x] GameTimeManager 클래스
- [x] 시간 UI 표시
- [x] 일시정지/재생 버튼
- [x] 속도 조절 버튼 (1x, 2x, 5x)
- [x] 시간대에 따른 배경 변화 (선택)

**완료 기준:** 게임 시간이 흐르고 UI에 표시, 속도 조절 가능 ✅

---

### Step A-9: 월드 트리 구조 (데이터만)

**목표:** Phase B를 위한 월드 트리 데이터 구조 준비

```typescript
interface WorldNode {
    id: string;
    name: string;
    type: 'world' | 'area' | 'room' | 'object';
    state?: string;           // Phase B에서 사용
    children: WorldNode[];
    position?: { x: number, y: number };  // 맵 좌표
}

const worldTree: WorldNode = {
    id: "world",
    name: "OneCompany Village",
    type: "world",
    children: [
        {
            id: "main_office",
            name: "Main Office",
            type: "area",
            children: [
                {
                    id: "open_space",
                    name: "Open Space",
                    type: "room",
                    position: { x: 100, y: 200 },
                    children: [
                        { id: "desk_01", name: "Desk 01", type: "object", state: "empty" },
                        { id: "coffee_machine", name: "Coffee Machine", type: "object", state: "idle" },
                    ]
                },
                // ...
            ]
        },
        // ...
    ]
};
```

**작업 목록:**
- [x] WorldNode 인터페이스 정의
- [x] 월드 트리 데이터 작성
- [x] 트리 ↔ 맵 좌표 매핑
- [x] 위치 선택 드롭다운에 트리 활용

**완료 기준:** 월드 트리 데이터 구조 완성, 캐릭터 생성 시 위치 선택에 활용 ✅

---

### Step A-10: 백엔드 API 완성

**목표:** Phase A에 필요한 모든 API 구현

**API 목록:**

| Method | Endpoint | 설명 |
|--------|----------|------|
| **캐릭터** | | |
| GET | `/api/characters` | 모든 캐릭터 목록 |
| GET | `/api/characters/{id}` | 캐릭터 상세 |
| POST | `/api/characters` | 캐릭터 생성 |
| DELETE | `/api/characters/{id}` | 캐릭터 삭제 |
| PUT | `/api/characters/{id}/position` | 위치 업데이트 |
| PUT | `/api/characters/{id}/action` | 행동 업데이트 |
| **월드** | | |
| GET | `/api/world/tree` | 월드 트리 구조 |
| GET | `/api/world/locations` | 스폰 가능 위치 |
| GET | `/api/world/time` | 현재 게임 시간 |
| PUT | `/api/world/time/speed` | 시간 속도 조절 |
| **아바타** | | |
| GET | `/api/avatars` | 사용 가능 아바타 |

**작업 목록:**
- [x] 캐릭터 CRUD API
- [x] 월드/시간 API
- [x] 아바타 목록 API
- [x] WebSocket 연결 (실시간 상태 동기화)

**완료 기준:** 모든 API 동작 확인, 프론트엔드와 연동 ✅

---

### Step A-11: 통합 테스트 및 마무리

**목표:** Phase A 전체 기능 통합 테스트

**테스트 시나리오:**
1. 게임 시작 → 빈 맵 표시
2. [+ 캐릭터 생성] 버튼 클릭
3. 이름, 직업, 아바타, 위치 입력
4. [생성하기] → 캐릭터가 맵에 스폰
5. 캐릭터가 자동으로 행동 시작 (걷기, 서있기 등)
6. 캐릭터 클릭 → 정보 패널 표시
7. 시간 흐름 확인, 속도 조절
8. 추가 캐릭터 여러 명 생성
9. 캐릭터들이 서로 가까워지면 "대화" 행동

**작업 목록:**
- [x] 전체 플로우 테스트
- [x] 버그 수정
- [x] UI/UX 개선
- [x] 성능 확인 (캐릭터 10명 이상)

**완료 기준:** Phase A 모든 기능이 안정적으로 동작 ✅

---

## Phase A 완료 상태

Phase A 완료 시 결과물:

```
✅ Phaser.js 게임 환경 - 완료
✅ Tiled 맵 (Office, Cafe, Park) - 완료 (코드로 구현)
✅ 캐릭터 스프라이트 및 애니메이션 - 완료
✅ [+ 캐릭터 생성] 버튼 및 모달 - 완료
✅ 캐릭터 생성 → 맵에 스폰 - 완료
✅ 규칙 기반 자동 행동 - 완료 (기본)
✅ 캐릭터 정보 패널 - 완료
✅ 게임 시간 시스템 - 완료
✅ 백엔드 API - 완료
✅ 월드 트리 데이터 구조 (Phase B 준비) - 완료
```

---

# Phase B: 에이전트 인지 시스템

> **목표:** LLM을 연결하여 캐릭터를 에이전트로 업그레이드

---

## B-1. 시스템 아키텍처 (Phase B)

Phase A 아키텍처에 Agent Core 레이어 추가:

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (Phaser.js)                      │
│  [Phase A 그대로 유지 + 에이전트 정보 UI 확장]                 │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────┐
│                   Backend (FastAPI)                          │
│  [Phase A 그대로 유지 + Agent Manager 추가]                   │
└─────────────────────────────┬───────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────┐  ← 새로 추가
│                    Agent Core (Python)                       │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐│
│  │Perceive │→│Retrieve │→│  Plan   │→│  React  │→│Reflect  ││
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘│
│                              ↓                               │
│                    ┌─────────────────┐                      │
│                    │  Memory Stream  │                      │
│                    └─────────────────┘                      │
└─────────────────────────────┬───────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────┐  ← 새로 추가
│                      LLM Layer                               │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐    │
│  │ OpenAI API    │  │ Embedding API │  │ NumPy 유사도  │    │
│  └───────────────┘  └───────────────┘  └───────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

---

## B-2. Step별 구현 계획

### Step B-1: LLM 연동 기반 구축

**목표:** OpenAI API 직접 호출 래퍼 구현

```python
# agent_core/prompt_template/gpt_structure.py

import openai
from typing import Optional

class GPTWrapper:
    def __init__(self, api_key: str, model: str = "gpt-3.5-turbo"):
        openai.api_key = api_key
        self.model = model

    def call(self, prompt: str, max_tokens: int = 500) -> str:
        response = openai.ChatCompletion.create(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=max_tokens,
            temperature=0.7
        )
        return response.choices[0].message.content

    def get_embedding(self, text: str) -> list[float]:
        response = openai.Embedding.create(
            input=text,
            model="text-embedding-ada-002"
        )
        return response['data'][0]['embedding']
```

**작업 목록:**
- [x] OpenAI API 키 설정 (.env)
- [x] GPTWrapper 클래스 구현
- [x] Embedding 함수 구현
- [x] 에러 핸들링 (rate limit, timeout)
- [x] 테스트 스크립트

**완료 기준:** LLM 호출 및 임베딩 생성 확인 ✅

---

### Step B-2: Memory Stream 구현

**목표:** 에이전트의 모든 경험을 저장하고 검색하는 시스템

```python
@dataclass
class MemoryObject:
    id: str
    content: str
    created_at: datetime
    last_accessed_at: datetime
    importance: int              # 1-10
    embedding: list[float]       # 1536차원
    memory_type: str             # "observation" | "reflection" | "plan"

class MemoryStream:
    memories: list[MemoryObject] = []

    def add_observation(self, content: str) -> MemoryObject:
        importance = self._rate_importance(content)
        embedding = gpt.get_embedding(content)
        # ...

    def _rate_importance(self, content: str) -> int:
        prompt = f"""On the scale of 1 to 10, where 1 is purely mundane
(e.g., brushing teeth) and 10 is extremely poignant (e.g., a break up),
rate the likely poignancy of the following memory.

Memory: {content}
Rating:"""
        response = gpt.call(prompt)
        return int(response.strip())
```

**작업 목록:**
- [x] MemoryObject 데이터 클래스
- [x] MemoryStream 클래스
- [x] add_observation, add_reflection, add_plan 메서드
- [x] Importance 점수 생성 (LLM 프롬프트)
- [x] Embedding 생성 및 저장

**완료 기준:** 기억 추가 및 저장 확인 ✅

---

### Step B-3: Retrieval 모듈 구현

**목표:** Recency + Importance + Relevance 기반 기억 검색

```python
class RetrievalModule:
    decay_factor: float = 0.995  # 논문 설정값

    def retrieve(self, query: str, memory_stream: MemoryStream, k: int = 10) -> list[MemoryObject]:
        query_embedding = gpt.get_embedding(query)

        scored = []
        for memory in memory_stream.memories:
            # Recency (decay=0.995, sandbox game hours 기준)
            hours = get_game_hours_since(memory.last_accessed_at)
            recency = self.decay_factor ** hours

            # Importance (1-10 정규화)
            importance = memory.importance / 10.0

            # Relevance (코사인 유사도)
            relevance = cosine_similarity(query_embedding, memory.embedding)

            # 가중합 (논문: 모두 1)
            score = recency + importance + relevance
            scored.append((memory, score))

        # 상위 k개 반환
        scored.sort(key=lambda x: x[1], reverse=True)
        top_k = [m for m, _ in scored[:k]]

        # last_accessed_at 업데이트
        for m in top_k:
            m.last_accessed_at = get_game_time()

        return top_k
```

**작업 목록:**
- [x] RetrievalModule 클래스
- [x] Recency 계산 (decay=0.995)
- [x] Importance 정규화
- [x] Relevance (코사인 유사도)
- [x] 가중합 및 정렬
- [x] last_accessed_at 업데이트

**완료 기준:** 쿼리에 대해 관련 기억 k개 반환 확인 ✅

---

### Step B-4: Perceive 모듈 구현

**목표:** 에이전트 시야 범위 내 환경 감지

```python
class PerceiveModule:
    vision_radius: int = 8  # 타일 단위

    def perceive(self, agent, world_state) -> list[str]:
        observations = []

        # 주변 에이전트 감지
        for other in get_nearby_agents(agent, self.vision_radius):
            obs = f"{agent.name} saw {other.name} {other.current_action} at {other.location}"
            observations.append(obs)

        # 주변 오브젝트 상태 감지
        for obj in get_nearby_objects(agent, self.vision_radius):
            obs = f"{agent.name} noticed {obj.name} is {obj.state}"
            observations.append(obs)

        # Memory Stream에 저장
        for obs in observations:
            agent.memory_stream.add_observation(obs)

        return observations
```

**작업 목록:**
- [x] PerceiveModule 클래스
- [x] 시야 범위 내 에이전트 감지
- [x] 시야 범위 내 오브젝트 감지
- [x] 관찰 내용 Memory Stream 저장
- [ ] 에이전트별 개인 환경 서브트리 업데이트 ← 관찰은 메모리에 저장하지만, 월드 트리의 개인 복사본(spatial subtree) 미구현

**완료 기준:** 에이전트가 주변 환경을 관찰하고 기억에 저장 ✅

---

### Step B-5: Planning 모듈 구현

**목표:** 3단계 계획 분해 (Daily → Hourly → Action)

```python
class PlanningModule:
    def create_daily_plan(self, agent) -> list[PlanItem]:
        prompt = f"""{agent.name}'s information:
- Age: {agent.age}, Occupation: {agent.occupation}
- Traits: {agent.traits}
- Yesterday: {agent.yesterday_summary}

Today is {get_game_date()}. Create a daily plan (5-8 activities).
Format: [HH:MM-HH:MM] Activity
"""
        response = gpt.call(prompt)
        return parse_daily_plan(response)

    def decompose_to_actions(self, plan_item) -> list[PlanItem]:
        # 5-15분 단위로 분해
        prompt = f"""Break down into 5-15 minute actions:
{plan_item.description} ({plan_item.duration} minutes)

Format: [HH:MM] Action at Location
"""
        response = gpt.call(prompt)
        return parse_actions(response)
```

**작업 목록:**
- [x] PlanningModule 클래스
- [x] Daily plan 생성 (5-8 청크)
- [x] Hourly decomposition
- [x] Action decomposition (5-15분)
- [x] 계획을 Memory Stream에 저장

**완료 기준:** 에이전트가 하루 계획 생성 확인 ✅

---

### Step B-6: Reacting 모듈 구현

**목표:** 관찰에 대해 React vs Continue 판단

```python
class ReactingModule:
    def should_react(self, agent, observation: str) -> tuple[bool, str]:
        # 컨텍스트 수집
        relationship = self._get_relationship_context(agent, observation)
        status = self._get_status_context(observation)

        prompt = f"""{agent.name} is currently {agent.current_action}.
Current plan: {agent.current_plan}

Observation: {observation}
Relationship context: {relationship}
Status context: {status}

Should {agent.name} react or continue with the plan?
Answer: [REACT] or [CONTINUE]
If REACT, what should they do?
"""
        response = gpt.call(prompt)

        if "[REACT]" in response:
            return True, extract_reaction(response)
        return False, None
```

**작업 목록:**
- [x] ReactingModule 클래스
- [x] 관계 컨텍스트 요약
- [x] 상태 컨텍스트 요약
- [x] React/Continue 판단 프롬프트
- [ ] 반응 시 계획 재생성 ← simulation_loop에서 reaction 기록만 하고 agent.plan() 재호출 안 함

**완료 기준:** 에이전트가 새로운 관찰에 적절히 반응 ✅

---

### Step B-7: Reflection 모듈 구현

**목표:** 중요도 누적 시 고차원 인사이트 생성

```python
class ReflectionModule:
    threshold: int = 150

    def check_and_reflect(self, agent) -> list[str]:
        # 중요도 합산
        recent = agent.memory_stream.get_recent(100)
        total_importance = sum(m.importance for m in recent)

        if total_importance < self.threshold:
            return []

        # 반성 생성
        reflections = self._generate_reflections(agent, recent)
        return reflections

    def _generate_reflections(self, agent, memories):
        # Step 1: 중요 질문 3개 생성
        prompt = f"""Given these statements, what are 3 most salient high-level questions?

{format_memories(memories)}
"""
        questions = gpt.call(prompt)

        # Step 2: 각 질문에 대한 인사이트 도출
        reflections = []
        for q in parse_questions(questions):
            relevant = agent.retrieve(q)
            insight = self._generate_insight(relevant)
            reflections.append(insight)
            agent.memory_stream.add_reflection(insight, importance=8)

        return reflections
```

**작업 목록:**
- [x] ReflectionModule 클래스
- [x] 중요도 누적 추적
- [x] 임계값(150) 체크
- [x] 질문 생성 프롬프트
- [x] 인사이트 도출 프롬프트
- [x] Reflection을 Memory Stream에 저장

**완료 기준:** 에이전트가 주기적으로 반성 생성 ✅

---

### Step B-8: 대화 시스템 구현

**목표:** 에이전트 간 자연스러운 대화

```python
class ConversationModule:
    def check_start_conversation(self, agent, other) -> bool:
        if not is_nearby(agent, other):
            return False

        prompt = f"""{agent.name} sees {other.name}.
{agent.name} is: {agent.current_action}
{other.name} is: {other.current_action}

Should {agent.name} start a conversation?
Answer: [YES] or [NO]
"""
        return "[YES]" in gpt.call(prompt)

    def generate_dialogue(self, initiator, responder) -> list[dict]:
        conversation = []
        # ... 대화 생성 로직
        return conversation
```

**작업 목록:**
- [x] ConversationModule 클래스
- [x] 대화 개시 조건 판단
- [x] 대화 생성 (턴제)
- [x] 대화 종료 조건
- [x] 대화 내용 Memory Stream 저장

**완료 기준:** 에이전트들이 자연스럽게 대화 ✅

---

### Step B-9: 에이전트 생성 UI 확장

**목표:** Phase A의 캐릭터 생성 UI에 에이전트 옵션 추가

```
┌─────────────────────────────────────────────────────────────┐
│                   에이전트 생성하기                          │
├─────────────────────────────────────────────────────────────┤
│  [아바타 선택]  👤 👤 👤 👤 👤 👤                           │
│                                                             │
│  이름: [________________]                                   │
│  나이: [__]세                                               │
│  직업: [________________]                                   │
│                                                             │
│  ✅ [Phase B 활성화됨]                                      │
│                                                             │
│  성격 특성:                                                  │
│    [✓] 호기심  [ ] 내성적  [✓] 친절한  [ ] 분석적           │
│                                                             │
│  배경 스토리 (세미콜론으로 구분):                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 3년차 개발자; 커피를 좋아함; 박민수와 친한 사이       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  일과 패턴:                                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 9시 출근, 점심은 카페에서, 6시 퇴근                   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  시작 위치: [▼ Main Office > Open Space]                    │
│                                                             │
│           [취소]                    [생성하기]               │
└─────────────────────────────────────────────────────────────┘
```

**작업 목록:**
- [x] Phase A UI에 추가 필드 활성화
- [x] 성격 특성 선택 UI
- [x] 배경 스토리 입력 (세미콜론 구분)
- [x] 일과 패턴 입력
- [x] Seed Memory 자동 생성
- [x] 생성 시 Memory Stream 초기화

**완료 기준:** 에이전트 생성 시 초기 기억 자동 생성 ✅

---

### Step B-10: 사용자 개입 시스템

**목표:** 논문의 5가지 개입 방식 구현

**5가지 모드:**
1. **관찰자**: 클릭 → 에이전트 상세 정보 (기억, 계획, 반성)
2. **외부 페르소나**: 특정 역할로 에이전트와 대화
3. **내면의 목소리**: 에이전트에게 직접 지시
4. **환경 조작**: 오브젝트 상태 변경
5. **직접 참여**: 사용자가 에이전트로 참여

**작업 목록:**
- [x] 관찰자 모드 (정보 패널 확장)
- [ ] 외부 페르소나 모드 UI
- [ ] 내면의 목소리 모드 UI
- [ ] 환경 조작 UI
- [ ] 직접 참여 모드

**완료 기준:** 5가지 개입 방식 모두 동작 (관찰자 모드 완료, 나머지 추후)

---

### Step B-11: 정보 패널 확장

**목표:** 에이전트의 인지 상태 표시

```
┌─────────────────────────────────────────┐
│  👤 김서연                    [X 닫기]  │
├─────────────────────────────────────────┤
│  직업: Software Engineer                │
│  위치: Main Office > Open Space         │
│  상태: 코드 리뷰 중 💻                   │
│                                         │
│  ─────────────────────────────────────  │
│  📋 현재 계획                            │
│  • 09:00-12:00 코드 작업                │
│  • 12:00-13:00 점심 (카페)              │
│  • 13:00-15:00 회의                     │
│                                         │
│  ─────────────────────────────────────  │
│  🧠 최근 기억 (5개)                      │
│  • 박민수와 프로젝트에 대해 이야기함      │
│  • 커피머신이 고장난 것을 봄             │
│  • ...                                  │
│                                         │
│  ─────────────────────────────────────  │
│  💭 최근 반성                            │
│  • "박민수는 믿을 수 있는 동료다"         │
│                                         │
│  ─────────────────────────────────────  │
│  🎭 개입하기                             │
│  [💬 대화] [🧠 내면의 목소리] [🎮 조종]    │
└─────────────────────────────────────────┘
```

**작업 목록:**
- [x] 현재 계획 표시
- [x] 최근 기억 표시
- [ ] 최근 반성 표시 ← recent_memories에 모든 타입 혼합 표시, 반성(reflection) 전용 섹션 없음
- [ ] 개입 버튼들

**완료 기준:** 에이전트의 인지 상태 실시간 확인 가능 ✅

---

### Step B-12: 시뮬레이션 루프 통합

**목표:** 모든 모듈을 연결하여 행동 사이클 실행

```python
class SimulationLoop:
    def run_timestep(self):
        for agent in self.agents:
            # 1. Perceive
            observations = agent.perceive(self.world_state)

            # 2. Retrieve (현재 상황 관련 기억)
            relevant_memories = agent.retrieve(str(observations))

            # 3. React or Continue
            for obs in observations:
                should_react, reaction = agent.should_react(obs)
                if should_react:
                    agent.regenerate_plan(reaction)

            # 4. Act
            action = agent.get_current_action()
            self.execute_action(agent, action)

            # 5. Reflect
            agent.check_and_reflect()

        # 시간 진행
        self.time_manager.advance()
```

**작업 목록:**
- [x] SimulationLoop 클래스
- [x] 모든 모듈 연결
- [x] 타임스텝별 실행
- [x] Phase A의 규칙 기반 → Phase B의 LLM 기반으로 전환

**완료 기준:** 에이전트들이 자율적으로 행동 ✅

---

### Step B-13: 통합 테스트 및 최적화

**목표:** 전체 시스템 테스트 및 비용 최적화

**테스트 시나리오:**
1. 에이전트 생성 (성격, 배경 포함)
2. 하루 계획 자동 생성 확인
3. 에이전트 간 대화 발생
4. Reflection 생성 확인
5. 사용자 개입 테스트

**최적화:**
- [x] 임베딩 캐싱 — GPTWrapper에 LRU 캐시 (OrderedDict, 500개), get_embedding/get_embeddings_batch 모두 캐시 연동
- [x] 배치 처리 — Agent.initialize()에서 seed memory를 add_observations_batch로 일괄 처리, 캐시 미스만 API 호출
- [x] 불필요한 LLM 호출 제거 — _rate_importance에 휴리스틱 우선 평가 (일상/중요 키워드), 애매한 경우만 LLM 호출
- [x] agent_id 중복 버그 수정 — itertools.count로 단조 증가 ID 보장
- [x] API 통계 엔드포인트 — GET /api/agents/stats/api (call_count, embedding_count, cache_hits 등)

**완료 기준:** 안정적인 시뮬레이션 실행, 합리적인 API 비용 ✅

---

## Phase B 완료 상태

Phase B 완료 시 결과물:

```
✅ OpenAI API 연동 (GPT + Embedding)
✅ Memory Stream (Observation, Reflection, Plan)
✅ Retrieval (Recency + Importance + Relevance)
✅ Perceive (시야 범위 감지)
✅ Planning (3단계 분해)
✅ Reacting (React vs Continue)
✅ Reflection (고차원 인사이트)
✅ 대화 시스템
✅ 에이전트 생성 UI (확장)
✅ 사용자 개입 5가지 모드
✅ 정보 패널 (인지 상태 표시)
✅ 시뮬레이션 루프
```

---

## 디렉토리 구조 (전체)

```
1_oneCompany/
├── frontend/                     # Phaser.js 게임
│   ├── src/
│   │   ├── main.ts
│   │   ├── scenes/
│   │   │   ├── MainScene.ts     # 게임 월드
│   │   │   └── UIScene.ts       # UI 오버레이
│   │   ├── entities/
│   │   │   ├── Character.ts     # Phase A: 캐릭터
│   │   │   └── WorldObject.ts
│   │   ├── ui/
│   │   │   ├── CreateButton.ts  # [+ 캐릭터/에이전트 생성]
│   │   │   ├── CreateModal.ts   # 생성 모달
│   │   │   ├── InfoPanel.ts     # 정보 패널
│   │   │   ├── TimeDisplay.ts   # 시간 표시
│   │   │   └── InterventionUI/  # Phase B: 개입 UI
│   │   ├── systems/
│   │   │   ├── BehaviorSystem.ts     # Phase A: 규칙 기반
│   │   │   └── PathfindingSystem.ts
│   │   └── utils/
│   ├── assets/
│   │   ├── sprites/
│   │   ├── tiles/
│   │   └── maps/
│   ├── package.json
│   └── vite.config.ts
│
├── backend/                      # FastAPI 서버
│   ├── app/
│   │   ├── main.py
│   │   ├── api/
│   │   │   ├── characters.py    # Phase A
│   │   │   ├── world.py
│   │   │   ├── agents.py        # Phase B
│   │   │   └── intervention.py  # Phase B
│   │   ├── models/
│   │   ├── services/
│   │   │   ├── character_manager.py   # Phase A
│   │   │   ├── time_manager.py
│   │   │   └── simulation_loop.py     # Phase B
│   │   └── core/
│   ├── requirements.txt
│   └── .env                     # API 키 (Phase B)
│
├── agent_core/                   # Phase B: 에이전트 핵심 로직
│   ├── memory/
│   │   ├── stream.py
│   │   ├── retrieval.py
│   │   └── importance.py
│   ├── cognition/
│   │   ├── perceive.py
│   │   ├── planning.py
│   │   ├── reacting.py
│   │   └── reflection.py
│   ├── conversation/
│   │   └── dialogue.py
│   ├── prompt_template/
│   │   ├── gpt_structure.py
│   │   └── templates/
│   └── agent.py
│
├── world/
│   ├── tree.py                  # 월드 트리 구조
│   ├── maps/
│   └── data/
│
├── PROJECT_PLAN.md
└── README.md
```

---

## 참고 자료

- [원본 논문 (arXiv)](https://arxiv.org/abs/2304.03442)
- [공식 GitHub](https://github.com/joonspk-research/generative_agents)
- [Phaser.js 문서](https://phaser.io/docs)
- [FastAPI 문서](https://fastapi.tiangolo.com/)
- [OpenAI API 문서](https://platform.openai.com/docs)
- [Tiled Map Editor](https://www.mapeditor.org/)

---

*작성일: 2026-02-19*
*버전: 3.0 (Phase A/B 분리)*
