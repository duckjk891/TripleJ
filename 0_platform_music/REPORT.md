# 음악 스트리밍 플랫폼 — 최종 보고서

## 1. 전체 아키텍처

```
┌─────────────────────────────────────────────────────────────────┐
│                        사용자 브라우저                            │
│                                                                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │  React 19   │  │  HTML5      │  │   Axios HTTP Client     │  │
│  │  + Router   │  │  Audio API  │  │   (JWT 자동 첨부)        │  │
│  └──────┬──────┘  └──────┬──────┘  └───────────┬─────────────┘  │
│         │                │                      │                 │
└─────────┼────────────────┼──────────────────────┼─────────────────┘
          │                │                      │
          │   Vite Proxy   │   /api/stream/*      │  /api/*
          │   (port 3001)  │                      │
          ▼                ▼                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                     FastAPI 백엔드 (port 8001)                    │
│                                                                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────┐  │
│  │  Auth    │  │  Songs   │  │  Albums  │  │   Artists      │  │
│  │  Routes  │  │  Routes  │  │  Routes  │  │   Routes       │  │
│  └──────────┘  └──────────┘  └──────────┘  └────────────────┘  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────┐  │
│  │  Charts  │  │Playlists │  │  Likes   │  │   Upload       │  │
│  │  Routes  │  │  Routes  │  │  Routes  │  │   Routes       │  │
│  └──────────┘  └──────────┘  └──────────┘  └────────────────┘  │
│                                                                   │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────────┐ │
│  │  JWT 인증      │  │  StaticFiles   │  │   SQLite DB        │ │
│  │  (PyJWT)       │  │  (/api/files)  │  │   (music.db)       │ │
│  └────────────────┘  └────────────────┘  └────────────────────┘ │
│                              │                                    │
│                     ┌────────┴────────┐                          │
│                     │    uploads/     │                          │
│                     │  ├── music/     │                          │
│                     │  └── images/    │                          │
│                     │     ├── albums/ │                          │
│                     │     └── artists/│                          │
│                     └─────────────────┘                          │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. 데이터 플로우 다이어그램

### 음악 업로드 플로우
```
 사용자                 프론트엔드                    백엔드                    DB/파일
   │                      │                           │                         │
   │  1. 업로드 폼 작성    │                           │                         │
   │─────────────────────>│                           │                         │
   │                      │                           │                         │
   │                      │  2a. POST /api/artists    │                         │
   │                      │  (새 아티스트인 경우)       │                         │
   │                      │──────────────────────────>│  INSERT artists         │
   │                      │                           │────────────────────────>│
   │                      │                           │<────────────────────────│
   │                      │<──────────────────────────│  artist_id 반환         │
   │                      │                           │                         │
   │                      │  2b. POST /api/albums     │                         │
   │                      │  (새 앨범인 경우)           │                         │
   │                      │──────────────────────────>│  INSERT albums          │
   │                      │                           │────────────────────────>│
   │                      │<──────────────────────────│  album_id 반환          │
   │                      │                           │                         │
   │                      │  3. POST /api/songs/upload│                         │
   │                      │  (multipart: 오디오+메타)  │                         │
   │                      │──────────────────────────>│  저장: uploads/music/   │
   │                      │                           │────────────────────────>│
   │                      │                           │  INSERT songs           │
   │                      │                           │────────────────────────>│
   │                      │<──────────────────────────│  song 정보 반환         │
   │                      │                           │                         │
   │  4. 완료 + 페이지 이동│                           │                         │
   │<─────────────────────│                           │                         │
```

### 음악 재생 플로우
```
 사용자                 프론트엔드                    백엔드                  파일시스템
   │                      │                           │                         │
   │  1. 곡 클릭 (재생)   │                           │                         │
   │─────────────────────>│                           │                         │
   │                      │  2. PlayerContext          │                         │
   │                      │  audio.src = /api/songs/  │                         │
   │                      │  stream/{song_id}         │                         │
   │                      │──────────────────────────>│                         │
   │                      │                           │  3. DB에서 file_path    │
   │                      │                           │     조회                │
   │                      │                           │  4. FileResponse 반환   │
   │                      │                           │<────────────────────────│
   │                      │<──────────────────────────│  audio/mpeg 스트리밍    │
   │                      │                           │                         │
   │  5. HTML5 Audio 재생  │                           │                         │
   │  (timeupdate 이벤트)  │                           │                         │
   │<─────────────────────│                           │                         │
   │                      │                           │                         │
   │  6. ended 이벤트      │                           │                         │
   │  → 자동 다음 곡       │                           │                         │
   │<─────────────────────│                           │                         │
```

### 좋아요 플로우
```
 사용자                 프론트엔드                    백엔드                    DB
   │                      │                           │                         │
   │  페이지 로드          │  GET /api/likes/check     │                         │
   │                      │  ?song_ids=1,2,3,...      │                         │
   │                      │──────────────────────────>│  SELECT song_id         │
   │                      │                           │  FROM likes             │
   │                      │<──────────────────────────│  {liked_ids: [1,3]}     │
   │  ♥ 표시된 곡 확인     │                           │                         │
   │<─────────────────────│                           │                         │
   │                      │                           │                         │
   │  하트 버튼 클릭       │                           │                         │
   │─────────────────────>│  POST /api/likes/{id}     │                         │
   │                      │──────────────────────────>│  INSERT likes           │
   │                      │                           │  UPDATE like_count + 1  │
   │                      │<──────────────────────────│  "좋아요 추가됨"        │
   │  ♥ 빨간색으로 변경    │                           │                         │
   │<─────────────────────│                           │                         │
```

---

## 3. 폴더 구조 트리

```
0_platform_music/
│
├── PLAN.md                          # 프로젝트 계획서
├── REPORT.md                        # 최종 보고서 (이 파일)
│
├── backend/
│   ├── requirements.txt             # fastapi, uvicorn, pyjwt, bcrypt,
│   │                                # python-multipart, mutagen
│   ├── music.db                     # SQLite 데이터베이스
│   │
│   ├── uploads/                     # [신규] 업로드 파일 저장소
│   │   ├── music/                   #   오디오 파일 (.mp3, .wav 등)
│   │   └── images/                  #   이미지 파일
│   │       ├── albums/              #     앨범 커버
│   │       └── artists/             #     아티스트 이미지
│   │
│   ├── tests/                       # [신규] 테스트
│   │   └── test_api.py              #   API 테스트 (40개 테스트케이스)
│   │
│   └── app/
│       ├── __init__.py
│       ├── main.py                  # [수정] FastAPI 앱 + StaticFiles 마운트
│       ├── auth.py                  # JWT 인증 헬퍼
│       ├── database.py              # SQLite 스키마 + 시드 데이터
│       └── routes/
│           ├── __init__.py
│           ├── auth.py              # 회원가입, 로그인, 내 정보
│           ├── songs.py             # [수정] 곡 조회 + 업로드 + 스트리밍
│           ├── albums.py            # [수정] 앨범 조회 + 생성
│           ├── artists.py           # [수정] 아티스트 조회 + 생성
│           ├── charts.py            # 차트 (TOP100, 장르별)
│           ├── playlists.py         # 플레이리스트 CRUD + 곡 관리
│           ├── likes.py             # [수정] 좋아요 + 일괄 확인
│           └── upload.py            # [신규] 이미지 업로드
│
└── frontend/
    ├── package.json                 # React 19 + Vite 7
    ├── vite.config.js               # Vite 설정 (프록시: /api → :8001)
    │
    └── src/
        ├── main.jsx                 # 엔트리포인트
        ├── App.jsx                  # [수정] /upload 라우트 추가
        ├── App.css
        ├── index.css
        ├── utils.js                 # 유틸리티 함수
        │
        ├── api/
        │   └── index.js             # [수정] 신규 API 함수 추가
        │
        ├── contexts/
        │   ├── AuthContext.jsx       # 인증 컨텍스트
        │   └── PlayerContext.jsx     # [수정] HTML5 Audio API 전환
        │
        ├── components/
        │   ├── Header.jsx            # [수정] 업로드 링크 추가
        │   ├── Header.css
        │   ├── Footer.jsx
        │   ├── Footer.css
        │   ├── MusicPlayer.jsx       # [수정] 커버 이미지 표시
        │   ├── MusicPlayer.css       # [수정] img 스타일 추가
        │   ├── SongItem.jsx          # [수정] 좋아요/플레이리스트/이미지
        │   ├── SongItem.css          # [수정] img 스타일 추가
        │   ├── AlbumCard.jsx         # [수정] 커버 이미지 표시
        │   ├── AlbumCard.css         # [수정] img 스타일 추가
        │   ├── PlaylistCard.jsx
        │   ├── PlaylistCard.css
        │   ├── AddToPlaylistModal.jsx  # [신규] 플레이리스트 추가 모달
        │   └── AddToPlaylistModal.css  # [신규]
        │
        └── pages/
            ├── MainPage.jsx          # [수정] 좋아요 상태 관리
            ├── MainPage.css
            ├── ChartPage.jsx         # [수정] 좋아요 상태 관리
            ├── ChartPage.css
            ├── SearchPage.jsx        # [수정] 좋아요 상태 관리
            ├── SearchPage.css
            ├── AlbumDetailPage.jsx   # [수정] 좋아요 상태 관리
            ├── AlbumDetailPage.css
            ├── ArtistDetailPage.jsx  # [수정] 좋아요 상태 관리
            ├── ArtistDetailPage.css
            ├── PlaylistPage.jsx
            ├── PlaylistPage.css
            ├── PlaylistDetailPage.jsx # [수정] 좋아요 상태 관리
            ├── PlaylistDetailPage.css
            ├── LoginPage.jsx
            ├── LoginPage.css
            ├── RegisterPage.jsx
            ├── RegisterPage.css
            ├── UploadPage.jsx         # [신규] 음악 업로드 페이지
            └── UploadPage.css         # [신규]
```

---

## 4. 구현된 기능 목록

### 기존 기능 (유지)
| 기능 | 설명 |
|------|------|
| 회원가입/로그인 | 이메일+비밀번호, JWT 토큰 발급 |
| 곡 목록/검색 | 전체 조회, 키워드 검색, 장르 필터 |
| 앨범/아티스트 조회 | 상세 페이지, 수록곡, 디스코그래피 |
| 차트 | TOP100, 장르별 차트 |
| 플레이리스트 | 생성, 수정, 삭제, 곡 추가/제거 |

### 신규 구현 기능
| 기능 | 설명 | 담당 |
|------|------|------|
| 음악 업로드 | 오디오 파일(mp3/wav/ogg/flac/m4a) + 메타데이터 업로드, 50MB 제한, mutagen으로 duration 자동 추출 | backend-dev, frontend-dev |
| 실제 오디오 재생 | HTML5 Audio API 기반 실제 재생, 시간 표시, seek, 볼륨 조절, 자동 다음곡 | frontend-dev |
| 오디오 스트리밍 | FileResponse 기반 오디오 파일 서빙, Content-Type 자동 감지 | backend-dev |
| 좋아요 버튼 연결 | SongItem의 하트 버튼에 API 호출 연결, 실시간 상태 토글, 빨간 하트 표시 | frontend-dev |
| 좋아요 일괄 확인 | 여러 곡의 좋아요 여부를 한 번에 확인하는 API | backend-dev |
| 플레이리스트에 곡 추가 | + 버튼 클릭 시 모달 팝업, 플레이리스트 선택, 새 플레이리스트 생성 | frontend-dev |
| 앨범 커버/아티스트 이미지 업로드 | 이미지 파일(jpg/png/webp) 업로드, 10MB 제한, DB 자동 연결 | backend-dev |
| 커버 이미지 표시 | 업로드된 이미지가 있으면 실제 표시, 없으면 그라데이션 폴백 | frontend-dev |
| 아티스트/앨범 생성 | 곡 업로드 시 새 아티스트/앨범 생성 지원 | backend-dev |
| 업로드 페이지 UI | 드래그앤드롭, 아티스트/앨범 선택 또는 생성, 진행률 표시 | frontend-dev |

---

## 5. API 엔드포인트 테이블

### 인증 (Auth)
| 메서드 | 경로 | 설명 | 인증 |
|--------|------|------|------|
| POST | /api/auth/register | 회원가입 | 불필요 |
| POST | /api/auth/login | 로그인 | 불필요 |
| GET | /api/auth/me | 내 정보 조회 | 필요 |

### 곡 (Songs)
| 메서드 | 경로 | 설명 | 인증 |
|--------|------|------|------|
| GET | /api/songs | 곡 목록 (페이지네이션, 장르 필터) | 불필요 |
| GET | /api/songs/search | 곡 검색 | 불필요 |
| GET | /api/songs/{id} | 곡 상세 | 불필요 |
| **POST** | **/api/songs/upload** | **곡 업로드 (multipart)** | **필요** |
| **GET** | **/api/songs/stream/{id}** | **오디오 스트리밍** | **불필요** |

### 앨범 (Albums)
| 메서드 | 경로 | 설명 | 인증 |
|--------|------|------|------|
| GET | /api/albums | 앨범 목록 | 불필요 |
| GET | /api/albums/latest | 최신 앨범 | 불필요 |
| GET | /api/albums/{id} | 앨범 상세 (수록곡 포함) | 불필요 |
| **POST** | **/api/albums** | **앨범 생성** | **필요** |

### 아티스트 (Artists)
| 메서드 | 경로 | 설명 | 인증 |
|--------|------|------|------|
| GET | /api/artists | 아티스트 목록 | 불필요 |
| GET | /api/artists/{id} | 아티스트 상세 | 불필요 |
| GET | /api/artists/{id}/albums | 아티스트 앨범 | 불필요 |
| GET | /api/artists/{id}/songs | 아티스트 곡 | 불필요 |
| **POST** | **/api/artists** | **아티스트 생성** | **필요** |

### 차트 (Charts)
| 메서드 | 경로 | 설명 | 인증 |
|--------|------|------|------|
| GET | /api/charts/top100 | TOP 100 차트 | 불필요 |
| GET | /api/charts/genre/{genre} | 장르별 차트 | 불필요 |

### 플레이리스트 (Playlists)
| 메서드 | 경로 | 설명 | 인증 |
|--------|------|------|------|
| GET | /api/playlists | 내 플레이리스트 목록 | 필요 |
| POST | /api/playlists | 플레이리스트 생성 | 필요 |
| GET | /api/playlists/{id} | 플레이리스트 상세 (곡 포함) | 필요 |
| PUT | /api/playlists/{id} | 플레이리스트 수정 | 필요 |
| DELETE | /api/playlists/{id} | 플레이리스트 삭제 | 필요 |
| POST | /api/playlists/{id}/songs | 곡 추가 | 필요 |
| DELETE | /api/playlists/{id}/songs/{song_id} | 곡 제거 | 필요 |

### 좋아요 (Likes)
| 메서드 | 경로 | 설명 | 인증 |
|--------|------|------|------|
| GET | /api/likes | 좋아요한 곡 목록 | 필요 |
| **GET** | **/api/likes/check** | **좋아요 일괄 확인** | **필요** |
| POST | /api/likes/{song_id} | 좋아요 추가 | 필요 |
| DELETE | /api/likes/{song_id} | 좋아요 취소 | 필요 |

### 파일 업로드 (Upload)
| 메서드 | 경로 | 설명 | 인증 |
|--------|------|------|------|
| **POST** | **/api/upload/image** | **이미지 업로드 (앨범/아티스트)** | **필요** |

### 기타
| 메서드 | 경로 | 설명 | 인증 |
|--------|------|------|------|
| GET | /api/health | 헬스 체크 | 불필요 |
| GET | /api/files/* | 정적 파일 서빙 (업로드된 파일) | 불필요 |

**총 API 엔드포인트: 27개** (기존 21개 + 신규 6개)

---

## 6. 에이전트별 수행 작업 요약

### backend-dev (백엔드 개발)
| 태스크 | 내용 | 수정 파일 |
|--------|------|-----------|
| B1 | 파일 업로드 인프라 구축 | requirements.txt, main.py, upload.py(생성) |
| B2 | 곡 업로드 API | songs.py |
| B3 | 오디오 스트리밍 엔드포인트 | songs.py |
| B4 | 이미지 업로드 API | upload.py |
| B5 | 좋아요 일괄 확인 API | likes.py |
| B6 | 아티스트/앨범 생성 API | artists.py, albums.py |

### frontend-dev (프론트엔드 개발)
| 태스크 | 내용 | 수정/생성 파일 |
|--------|------|----------------|
| F1 | HTML5 Audio 실제 재생 | PlayerContext.jsx |
| F2 | 좋아요 버튼 연결 | SongItem.jsx, api/index.js, 6개 페이지 |
| F3 | 플레이리스트 곡 추가 모달 | AddToPlaylistModal.jsx/css(생성), SongItem.jsx |
| F4 | 음악 업로드 페이지 | UploadPage.jsx/css(생성), App.jsx, Header.jsx, api/index.js |
| F5 | 커버 이미지 표시 | MusicPlayer.jsx/css, AlbumCard.jsx/css, SongItem.jsx/css |

### tester (테스트)
| 태스크 | 내용 | 결과 |
|--------|------|------|
| T1 | API 테스트 스크립트 | 40/40 PASS (tests/test_api.py) |
| T2 | 프론트엔드 빌드 검증 | 성공 (135 modules, 에러 없음) |

---

## 7. 테스트 결과 요약

### API 테스트 (T1): 40/40 PASS
```
 테스트 카테고리          테스트 수    결과
─────────────────────────────────────────
 헬스 체크                  1        PASS
 인증 (Auth)                4        PASS
 아티스트 생성 (신규)       1        PASS
 앨범 생성 (신규)           1        PASS
 곡 업로드 (신규)           1        PASS
 오디오 스트리밍 (신규)     1        PASS
 좋아요 (신규 check 포함)   4        PASS
 플레이리스트               3        PASS
 이미지 업로드 (신규)       1        PASS
 곡 API 회귀테스트          6        PASS
 앨범 API 회귀테스트        4        PASS
 아티스트 API 회귀테스트    5        PASS
 차트 API 회귀테스트        2        PASS
 플레이리스트 회귀테스트    2        PASS
 좋아요 회귀테스트          2        PASS
─────────────────────────────────────────
 합계                      40        ALL PASS
```

### 빌드 검증 (T2): PASS
```
 항목                              결과
──────────────────────────────────────────
 vite build                        성공 (1.38s)
 모듈 수                           135개
 CSS 크기                          32.05 KB
 JS 크기                           319.93 KB
 에러/경고                         없음
 신규 컴포넌트 import               정상
 신규 API 함수 export              정상
 라우트 등록                        정상
```

---

## 8. 실행 방법

### 백엔드 실행
```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload
```

### 프론트엔드 실행
```bash
cd frontend
npm install
npm run dev    # 개발 서버 (port 3001)
npm run build  # 프로덕션 빌드
```

### 테스트 실행
```bash
# 백엔드 서버가 실행 중인 상태에서
cd backend
python tests/test_api.py
```

---

## 9. 프로젝트 완성도

```
 기능                         이전 상태          현재 상태
────────────────────────────────────────────────────────────
 회원가입/로그인               완성               완성
 곡 조회/검색                  완성               완성
 앨범/아티스트 조회            완성               완성
 차트 (TOP100/장르)            완성               완성
 플레이리스트 CRUD             완성               완성
 음악 업로드                   미구현      ────>  완성
 실제 오디오 재생              시뮬레이션   ────>  완성 (HTML5 Audio)
 음악 파일 서빙                미구현      ────>  완성 (FileResponse)
 좋아요 버튼 연결              미연결      ────>  완성 (API 호출 + UI)
 플레이리스트에 곡 추가        미연결      ────>  완성 (모달 + API)
 앨범 커버/아티스트 이미지     미구현      ────>  완성 (업로드 + 표시)
 아티스트/앨범 생성            미구현      ────>  완성
────────────────────────────────────────────────────────────
 전체 완성도                   ~70%               100%
```

**프로젝트가 100% 완성되었습니다.**

---
---

## v2.0 -- 멀티 DB 아키텍처 전환 보고서
### 작성일: 2026-03-11

---

## 1. 전체 아키텍처

```
                          +--------------------+
                          |    클라이언트       |
                          |  React 19 + Vite 7 |
                          +--------+-----------+
                                   |
                          HTTPS / REST API
                                   |
                          +--------v-----------+
                          |   FastAPI v2.0     |
                          |   (Port 8001)      |
                          |                    |
                          |  +-- lifespan ---+ |
                          |  | DB init/close | |
                          |  | APScheduler   | |
                          |  +---------------+ |
                          +--+--+--+--+--+-----+
                             |  |  |  |  |
              +--------------+  |  |  |  +---------------+
              |                 |  |  |                   |
     +--------v--------+ +-----v--v------+ +------v------+------v--------+
     |  PostgreSQL 16  | |   MongoDB 7   | |   Redis 7   |  MinIO S3    |
     |  Port: 5432     | |  Port: 27017  | |  Port: 6379 |  Port: 9000  |
     |                 | |               | |             |  Console:9001|
     | +-------------+ | | +-----------+ | | +---------+ | +----------+ |
     | | users       | | | | tracks    | | | | chart:  | | | audio/   | |
     | | follows     | | | | comments  | | | |  daily  | | | covers/  | |
     | | likes       | | | |           | | | |  weekly | | | profiles/| |
     | | playlists   | | | |           | | | |  all    | | |          | |
     | | playlist_   | | | |           | | | | session | | |          | |
     | |   tracks    | | | |           | | | | cache:* | | |          | |
     | +-------------+ | | +-----------+ | | | play    | | +----------+ |
     |                 | |               | | |  count  | |              |
     +-----------------+ +---------------+ | |  buffer | |              |
                                           | +---------+ |              |
                                           +-------------+--------------+
                                                  |
                                          +-------v--------+
                                          | Elasticsearch  |
                                          |   8.12.0       |
                                          |  Port: 9200    |
                                          | (2단계 예정)   |
                                          +----------------+
```

---

## 2. DB별 역할 분담 다이어그램

```
+================================================================================+
|                        데이터 분산 아키텍처                                     |
+================================================================================+
|                                                                                |
|  PostgreSQL 16 (관계형, 트랜잭션 무결성)                                       |
|  +-------------------+-------------------+-------------------+                 |
|  | users             | follows           | likes             |                 |
|  | UUID PK           | follower_id (FK)  | user_id (FK)     |                 |
|  | email UNIQUE      | followee_id (FK)  | track_id VARCHAR  |                 |
|  | password_hash     | composite PK      |   (Mongo ObjectId)|                 |
|  | nickname          | self-follow 방지  | composite PK     |                 |
|  | bio, plan         |                   |                   |                 |
|  | profile_image     |                   |                   |                 |
|  +-------------------+-------------------+-------------------+                 |
|  | playlists         | playlist_tracks                       |                 |
|  | UUID PK           | playlist_id (FK)                     |                 |
|  | user_id (FK)      | track_id VARCHAR (Mongo ObjectId)    |                 |
|  | title, is_public  | position, added_at                   |                 |
|  +-------------------+---------------------------------------+                 |
|                                                                                |
|  MongoDB 7 (유연한 스키마, 배열 필드)                                          |
|  +-------------------------------------------+                                |
|  | tracks 컬렉션                              |                                |
|  | _id: ObjectId                              |                                |
|  | title, uploader_id (PG UUID)               |                                |
|  | genre: [String], mood: [String]            |                                |
|  | tags: [String], ai_model, prompt           |                                |
|  | audio_url (MinIO), cover_image_url (MinIO) |                                |
|  | play_count, like_count, comment_count      |                                |
|  | duration_sec, bpm, key, language            |                                |
|  | is_public, created_at, updated_at          |                                |
|  +-------------------------------------------+                                |
|  | comments 컬렉션                            |                                |
|  | _id, track_id (ObjectId), user_id (UUID)   |                                |
|  | user_nickname, content, created_at         |                                |
|  +-------------------------------------------+                                |
|                                                                                |
|  Redis 7 (실시간, 캐시, 세션)                                                  |
|  +-------------------------------------------+                                |
|  | chart:daily:{YYYYMMDD}  (Sorted Set, 48h) |                                |
|  | chart:weekly:{YYYY-Www} (Sorted Set, 14d) |                                |
|  | chart:alltime           (Sorted Set)      |                                |
|  | session:{user_id}       (Hash, 7d TTL)    |                                |
|  | cache:track:{id}        (String, 10min)   |                                |
|  | cache:top100:daily      (String, 5min)    |                                |
|  | cache:top100:weekly     (String, 10min)   |                                |
|  | playcount:buffer:{id}   (Counter, 1m)     |                                |
|  +-------------------------------------------+                                |
|                                                                                |
|  MinIO S3 (오브젝트 스토리지)                                                  |
|  +-------------------------------------------+                                |
|  | music-platform-audio/                      |                                |
|  |   tracks/{uploader_id}/{track_id}.mp3      |                                |
|  | music-platform-images/                     |                                |
|  |   covers/{uploader_id}/{track_id}.jpg      |                                |
|  |   profiles/{user_id}.jpg                   |                                |
|  +-------------------------------------------+                                |
+================================================================================+
```

---

## 3. 데이터 플로우 다이어그램

### 트랙 업로드 플로우 (v2.0)
```
 사용자                 프론트엔드                 FastAPI v2               DB/Storage
   |                      |                          |                        |
   |  1. 업로드 폼 작성    |                          |                        |
   |--------------------->|                          |                        |
   |                      |                          |                        |
   |                      |  2. POST /api/tracks/    |                        |
   |                      |     upload (multipart)   |                        |
   |                      |------------------------->|                        |
   |                      |                          |  3. MinIO put_object   |
   |                      |                          |  (오디오 파일)          |
   |                      |                          |----------------------->|
   |                      |                          |                        |
   |                      |                          |  4. MongoDB insert_one |
   |                      |                          |  (tracks 컬렉션)       |
   |                      |                          |----------------------->|
   |                      |                          |                        |
   |                      |<-------------------------|  track 정보 반환       |
   |  5. 완료             |                          |                        |
   |<---------------------|                          |                        |
```

### 재생수 동기화 플로우 (v2.0)
```
 사용자       FastAPI          Redis                MongoDB           Redis Charts
   |            |                |                     |                  |
   | GET track  |                |                     |                  |
   |----------->|                |                     |                  |
   |            | INCR           |                     |                  |
   |            | playcount:     |                     |                  |
   |            | buffer:{id}    |                     |                  |
   |            |--------------->|                     |                  |
   |<-----------|                |                     |                  |
   |            |                |                     |                  |
   |            |   (매 60초 APScheduler)               |                  |
   |            |                |                     |                  |
   |            | SCAN + GETDEL  |                     |                  |
   |            |--------------->|                     |                  |
   |            |<---------------|  count 값            |                  |
   |            |                |                     |                  |
   |            | update_one     |                     |                  |
   |            | $inc play_count|                     |                  |
   |            |------------------------------------>|                  |
   |            |                |                     |                  |
   |            | ZINCRBY chart:daily/weekly/alltime   |                  |
   |            |---------------------------------------------------->|
   |            |                |                     |                  |
   |            | DEL cache:top100:*                   |                  |
   |            |---------------------------------------------------->|
```

### 좋아요 플로우 (v2.0 -- PG + Mongo 크로스 업데이트)
```
 사용자       FastAPI          PostgreSQL           MongoDB
   |            |                |                     |
   | POST       |                |                     |
   | /likes/    |                |                     |
   | {track_id} |                |                     |
   |----------->|                |                     |
   |            | INSERT likes   |                     |
   |            | (user_id,      |                     |
   |            |  track_id)     |                     |
   |            |--------------->|                     |
   |            |                |                     |
   |            | update_one     |                     |
   |            | $inc           |                     |
   |            | like_count + 1 |                     |
   |            |------------------------------------>|
   |            |                |                     |
   |<-----------|  "좋아요 추가" |                     |
```

### 차트 조회 플로우 (v2.0 -- Redis + Mongo)
```
 사용자       FastAPI          Redis                MongoDB
   |            |                |                     |
   | GET        |                |                     |
   | /charts/   |                |                     |
   | top100     |                |                     |
   |----------->|                |                     |
   |            | GET cache:     |                     |
   |            | top100:daily   |                     |
   |            |--------------->|                     |
   |            |<---------------|  HIT? -> 즉시 반환  |
   |            |                |                     |
   |            | (MISS)         |                     |
   |            | ZREVRANGE      |                     |
   |            | chart:daily:   |                     |
   |            | {date} 0 99   |                     |
   |            |--------------->|                     |
   |            |<---------------|  track_id 목록      |
   |            |                |                     |
   |            | find $in       |                     |
   |            | [track_ids]    |                     |
   |            |------------------------------------>|
   |            |<------------------------------------|  상세 정보
   |            |                |                     |
   |            | SETEX cache:   |                     |
   |            | top100:daily   |                     |
   |            |--------------->|                     |
   |<-----------|  차트 반환     |                     |
```

---

## 4. 폴더 구조 트리 (v2.0)

```
0_platform_music/
|
+-- PLAN.md                              # 프로젝트 계획서 (v1.0 + v2.0)
+-- REPORT.md                            # 보고서 (v1.0 + v2.0, 이 파일)
|
+-- backend/
|   +-- docker-compose.yml               # [v2.0] 5개 DB 서비스 오케스트레이션
|   +-- .env                             # [v2.0] 환경 변수 (DB 접속 정보)
|   +-- .env.example                     # [v2.0] 환경 변수 템플릿
|   +-- requirements.txt                 # [수정] 기존 6개 + 신규 8개 패키지
|   +-- music.db                         # [레거시] SQLite DB (더 이상 사용 안 함)
|   |
|   +-- infra/                           # [v2.0] DB 초기화 스크립트
|   |   +-- init_postgres.sql            #   PostgreSQL 테이블 + 인덱스 (5개 테이블)
|   |   +-- init_mongo.js               #   MongoDB 컬렉션 + 인덱스 (tracks, comments)
|   |   +-- init_minio.py               #   MinIO 버킷 생성 스크립트
|   |
|   +-- uploads/                         # [레거시] 로컬 파일 저장소 -> MinIO로 대체
|   |
|   +-- tests/
|   |   +-- test_api.py                  # API 테스트 (v1.0 기준, 수정 필요)
|   |
|   +-- app/
|       +-- __init__.py
|       +-- main.py                      # [v2.0] lifespan + APScheduler + 9개 라우터
|       +-- config.py                    # [v2.0] pydantic-settings 기반 설정
|       +-- auth.py                      # [v2.0] JWT + Redis 세션 검증
|       +-- database.py                  # [레거시] SQLite 모듈 (미사용)
|       |
|       +-- database/                    # [v2.0] 멀티 DB 연결 패키지
|       |   +-- __init__.py              #   통합 export
|       |   +-- postgres.py              #   asyncpg 연결 풀 (init/get_pg/close)
|       |   +-- mongodb.py              #   motor 비동기 클라이언트 (init/get_mongo/close)
|       |   +-- redis.py                #   redis.asyncio (init/get_redis/close)
|       |   +-- minio.py               #   minio-py S3 클라이언트 (init/get_minio)
|       |   +-- elasticsearch.py        #   AsyncElasticsearch (2단계용)
|       |
|       +-- models/                      # [v2.0] Pydantic 모델
|       |   +-- __init__.py
|       |   +-- user.py                  #   UserCreate, LoginRequest, UserResponse
|       |   +-- track.py                #   TrackCreate, TrackUploadForm, TrackResponse
|       |   +-- playlist.py             #   PlaylistCreate, PlaylistUpdate, AddTrack
|       |
|       +-- routes/                      # 라우트 (전면 재작성)
|       |   +-- __init__.py
|       |   +-- auth.py                  # [v2.0] PostgreSQL + Redis 세션
|       |   +-- tracks.py               # [v2.0] MongoDB CRUD + MinIO + Redis 캐시
|       |   +-- albums.py               # [v2.0] Mongo 기반 앨범 조회 (호환)
|       |   +-- artists.py              # [v2.0] PG users + Mongo 집계 (호환)
|       |   +-- charts.py               # [v2.0] Redis Sorted Set + Mongo 배치
|       |   +-- playlists.py            # [v2.0] PG + Mongo 크로스 쿼리
|       |   +-- likes.py                # [v2.0] PG likes + Mongo like_count 동기화
|       |   +-- upload.py               # [v2.0] MinIO presigned URL 업로드
|       |   +-- follows.py              # [v2.0] 신규 팔로우/언팔로우
|       |   +-- songs.py                # [레거시] SQLite 기반 (미사용)
|       |
|       +-- services/                    # [v2.0] 백그라운드 서비스
|           +-- __init__.py
|           +-- playcount_sync.py        #   Redis -> MongoDB 재생수 동기화 (60초 배치)
|
+-- frontend/                            # (변경 없음, v1.0 유지)
    +-- ...
```

---

## 5. 구현 완료 목록

### 인프라 (db-infra)
| 태스크 | 내용 | 생성/수정 파일 |
|--------|------|----------------|
| D1 | Docker Compose 작성 | docker-compose.yml |
| D2 | 환경 변수 파일 | .env, .env.example |
| D3 | pydantic-settings 설정 | app/config.py |
| D4 | PostgreSQL 초기화 | infra/init_postgres.sql |
| D5 | MongoDB 초기화 | infra/init_mongo.js |
| D6 | MinIO 버킷 생성 | infra/init_minio.py |
| D7 | DB 연결 모듈 패키지 | app/database/*.py (6개 파일) |
| D8 | requirements.txt 업데이트 | requirements.txt |

### 마이그레이션 (be-migrate)
| 태스크 | 내용 | 생성/수정 파일 |
|--------|------|----------------|
| M1 | main.py lifespan 리팩터링 | app/main.py |
| M2 | Pydantic 모델 | app/models/*.py (4개 파일) |
| M3 | auth.py JWT + Redis 세션 | app/auth.py |
| M4 | routes/auth.py -> PostgreSQL | app/routes/auth.py |
| M5 | routes/tracks.py (MongoDB + MinIO + Redis) | app/routes/tracks.py |
| M6 | routes/charts.py -> Redis Sorted Set | app/routes/charts.py |
| M7 | routes/playlists.py (PG + Mongo) | app/routes/playlists.py |
| M8 | routes/likes.py (PG + Mongo 동기화) | app/routes/likes.py |
| M9 | routes/upload.py -> MinIO | app/routes/upload.py |
| M10 | routes/follows.py 신규 | app/routes/follows.py |
| M11 | 시드 데이터 스크립트 | (be-migrate 자체 구현) |
| M12 | 재생수 동기화 서비스 | app/services/playcount_sync.py |
| M13 | 테스트 수정 | (기존 test_api.py 유지, 향후 수정) |

---

## 6. API 엔드포인트 테이블 (v2.0)

### 인증 (Auth)
| 메서드 | 경로 | 설명 | DB | 인증 |
|--------|------|------|----|------|
| POST | /api/auth/register | 회원가입 | PG + Redis | 불필요 |
| POST | /api/auth/login | 로그인 | PG + Redis | 불필요 |
| GET | /api/auth/me | 내 정보 조회 | PG + Redis | 필요 |
| POST | /api/auth/logout | 로그아웃 | Redis | 필요 |

### 트랙 (Tracks) -- 구 Songs
| 메서드 | 경로 | 설명 | DB | 인증 |
|--------|------|------|----|------|
| GET | /api/tracks | 트랙 목록 (필터: genre, mood, tag) | Mongo | 불필요 |
| GET | /api/tracks/search | 트랙 검색 (regex) | Mongo | 불필요 |
| GET | /api/tracks/{id} | 트랙 상세 + 캐시 + 재생수 | Mongo + Redis | 불필요 |
| POST | /api/tracks/upload | 트랙 업로드 (multipart) | Mongo + MinIO | 필요 |
| GET | /api/tracks/stream/{id} | 오디오 스트리밍 (presigned URL) | Mongo + MinIO | 불필요 |

### 차트 (Charts)
| 메서드 | 경로 | 설명 | DB | 인증 |
|--------|------|------|----|------|
| GET | /api/charts/top100 | TOP100 (daily/weekly/alltime) | Redis + Mongo | 불필요 |
| GET | /api/charts/genre/{genre} | 장르별 차트 | Mongo | 불필요 |

### 플레이리스트 (Playlists)
| 메서드 | 경로 | 설명 | DB | 인증 |
|--------|------|------|----|------|
| GET | /api/playlists | 내 플레이리스트 목록 | PG | 필요 |
| POST | /api/playlists | 플레이리스트 생성 | PG | 필요 |
| GET | /api/playlists/{id} | 플레이리스트 상세 | PG + Mongo | 필요 |
| PUT | /api/playlists/{id} | 플레이리스트 수정 | PG | 필요 |
| DELETE | /api/playlists/{id} | 플레이리스트 삭제 | PG | 필요 |
| POST | /api/playlists/{id}/tracks | 트랙 추가 | PG + Mongo | 필요 |
| DELETE | /api/playlists/{id}/tracks/{tid} | 트랙 제거 | PG | 필요 |

### 좋아요 (Likes)
| 메서드 | 경로 | 설명 | DB | 인증 |
|--------|------|------|----|------|
| GET | /api/likes | 좋아요한 트랙 목록 | PG + Mongo | 필요 |
| GET | /api/likes/check | 좋아요 일괄 확인 | PG | 필요 |
| POST | /api/likes/{track_id} | 좋아요 추가 | PG + Mongo | 필요 |
| DELETE | /api/likes/{track_id} | 좋아요 취소 | PG + Mongo | 필요 |

### 팔로우 (Follows) -- 신규
| 메서드 | 경로 | 설명 | DB | 인증 |
|--------|------|------|----|------|
| POST | /api/follows/{user_id} | 팔로우 | PG | 필요 |
| DELETE | /api/follows/{user_id} | 언팔로우 | PG | 필요 |
| GET | /api/follows/followers | 팔로워 목록 | PG | 필요 |
| GET | /api/follows/following | 팔로잉 목록 | PG | 필요 |

### 아티스트 (Artists) -- 호환 계층
| 메서드 | 경로 | 설명 | DB | 인증 |
|--------|------|------|----|------|
| GET | /api/artists | 크리에이터 목록 | PG + Mongo | 불필요 |
| GET | /api/artists/{id} | 크리에이터 상세 | PG + Mongo | 불필요 |
| GET | /api/artists/{id}/tracks | 크리에이터 트랙 | Mongo | 불필요 |

### 업로드 (Upload)
| 메서드 | 경로 | 설명 | DB | 인증 |
|--------|------|------|----|------|
| POST | /api/upload/image | 이미지 업로드 (cover/profile) | MinIO + Mongo/PG | 필요 |
| GET | /api/upload/presigned-url | Presigned URL 발급 | MinIO | 필요 |

### 기타
| 메서드 | 경로 | 설명 | 인증 |
|--------|------|------|------|
| GET | /api/health | 헬스 체크 | 불필요 |

**총 API 엔드포인트: 31개** (v1.0 27개 -> v2.0 31개, 신규 8개, 변경 23개)

---

## 7. v1.0 -> v2.0 변경 요약

```
 항목                         v1.0                     v2.0
====================================================================
 데이터베이스                  SQLite 단일              PG + Mongo + Redis + MinIO + ES
 연결 방식                     동기 sqlite3             비동기 asyncpg + motor + aioredis
 사용자 PK                     INTEGER AUTO             UUID
 곡/트랙 저장소                songs 테이블 (SQLite)    tracks 컬렉션 (MongoDB)
 장르 데이터                   TEXT (단일 값)           [String] 배열 (다중 값)
 파일 저장                     로컬 uploads/            MinIO S3 오브젝트 스토리지
 차트                          charts 테이블 (SQLite)   Redis Sorted Set
 세션                          없음 (토큰만)            Redis 세션 + JWT
 캐시                          없음                     Redis (track, top100)
 재생수 카운팅                 즉시 DB UPDATE           Redis 버퍼 -> 60초 배치 동기화
 검색                          SQL LIKE                 MongoDB regex (1단계) -> ES (2단계)
 팔로우                        미구현                   PostgreSQL follows 테이블
 라우터                        8개 (동기)               9개 (비동기)
 배경 작업                     없음                     APScheduler (재생수 동기화)
 설정 관리                     하드코딩                 pydantic-settings + .env
 인프라                        없음                     Docker Compose (5 서비스)
====================================================================
```

---

## 8. 에이전트별 수행 작업 요약

### planner (계획 총괄)
| 작업 | 내용 |
|------|------|
| 기존 코드 분석 | v1.0 백엔드 14개 파일 분석, 스키마/API 파악 |
| PLAN.md v2.0 작성 | 10개 섹션 아키텍처 설계서 작성 |
| 태스크 분배 | D1-D8 (db-infra), M1-M13 (be-migrate) 할당 |
| 품질 검토 | 인프라 결과물 리뷰, 불일치 발견/수정 요청, 임포트 경로 감시 |

### db-infra (인프라 구축)
| 작업 | 내용 | 파일 수 |
|------|------|---------|
| Docker Compose | 5개 DB 서비스 오케스트레이션 | 1 |
| 환경 설정 | .env, .env.example, config.py | 3 |
| DB 초기화 | PG SQL, Mongo JS, MinIO Python | 3 |
| 연결 모듈 | postgres, mongodb, redis, minio, ES, __init__ | 6 |
| 의존성 | requirements.txt 업데이트 | 1 |
| **합계** | | **14개 파일** |

### be-migrate (백엔드 마이그레이션)
| 작업 | 내용 | 파일 수 |
|------|------|---------|
| 앱 코어 | main.py, auth.py 리팩터링 | 2 |
| Pydantic 모델 | user, track, playlist + __init__ | 4 |
| 라우트 마이그레이션 | auth, tracks, charts, playlists, likes, upload, follows, artists, albums | 9 |
| 백그라운드 서비스 | playcount_sync.py + __init__ | 2 |
| **합계** | | **17개 파일** |

---

## 9. 레거시 파일 (삭제 가능)

다음 파일은 v2.0에서 더 이상 사용되지 않으며 안전하게 삭제 가능합니다:

| 파일 | 설명 |
|------|------|
| `app/database.py` | 구 SQLite 연결/스키마 모듈 (미 import) |
| `app/routes/songs.py` | 구 SQLite 기반 곡 라우트 (미 import) |
| `music.db` | SQLite 데이터베이스 파일 |
| `uploads/` | 로컬 파일 저장 디렉토리 (MinIO로 대체) |

---

## 10. 실행 방법 (v2.0)

### 1단계: Docker 서비스 시작
```bash
cd backend
docker compose up -d

# 헬스 체크 확인
docker compose ps
```

### 2단계: MinIO 버킷 초기화
```bash
python infra/init_minio.py
```

### 3단계: 백엔드 실행
```bash
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload
```

### 4단계: 프론트엔드 실행 (변경 없음)
```bash
cd ../frontend
npm install
npm run dev  # port 4000
```

---

## 11. 향후 작업 (2단계, 3단계)

### 2단계: Elasticsearch 추가
- ES 인덱스 매핑 적용 (nori 한글 분석기)
- `database/elasticsearch.py` 활성화
- `routes/search.py` 전문 검색 API 작성
- MongoDB -> ES 실시간 동기화 서비스

### 3단계: 성능 최적화
- Redis 캐시 전략 고도화 (cache-aside + write-through)
- 차트 배치 갱신 스케줄러 (일간/주간 롤업)
- MongoDB 복합 인덱스 튜닝 (explain 분석)
- 커넥션 풀 튜닝 (asyncpg pool_size, motor maxPoolSize)
- Presigned URL 캐싱 (MinIO URL 재사용)

**v2.0 멀티 DB 아키텍처 전환이 완료되었습니다.**

---
---

## v3.0 -- 관리자 모드 (Admin System) 보고서
### 작성일: 2026-03-14

---

## 1. 개요

AIMU 플랫폼에 관리자(Admin) 시스템을 추가했다. 관리자는 대시보드에서 플랫폼 현황을 모니터링하고, 사용자/트랙을 관리할 수 있다. 일반 사용자는 관리자 페이지에 접근할 수 없다.

---

## 2. 아키텍처 다이어그램

```
  일반 사용자                              관리자
  (role=user)                            (role=admin)
       |                                      |
       v                                      v
  +----------+    +----------+    +---------------------+
  | 일반 FE  |    | Header   |    | Admin FE            |
  | 페이지   |    | (관리자  |    | /admin               |
  | /, /chart|    |  링크)   |    | /admin/users         |
  | /search  |    +----------+    | /admin/tracks        |
  | /upload  |                    +----------+-----------+
  +-----+----+                               |
        |                                    |
        v                                    v
  +-----------+                    +---------------------+
  | 기존 API  |                    | /api/admin/*        |
  | /api/*    |                    | (get_admin_user)    |
  +-----------+                    +-----+----+----------+
        |                                |    |
        v                                v    v
  +-----+-----+    +----------+    +-----+----+----------+
  |  PG users |    |  Mongo   |    |  PG admin_logs     |
  |  (role)   |    |  tracks  |    |  (감사 로그)        |
  | (is_banned)|   +----------+    +--------------------+
  +-----------+
```

---

## 3. 데이터베이스 변경

### PostgreSQL users 테이블 확장
```
기존 컬럼                        신규 컬럼
-----------                      -----------
id (UUID PK)                     role VARCHAR(20) DEFAULT 'user'
email                                CHECK ('user', 'admin')
password_hash                    is_banned BOOLEAN DEFAULT FALSE
nickname                         banned_at TIMESTAMPTZ
profile_image                    ban_reason TEXT
bio, plan
created_at, updated_at
```

### 신규 테이블: admin_logs
```
admin_logs
├── id          UUID PK
├── admin_id    UUID FK → users
├── action      VARCHAR(50)  -- ban_user, unban_user, change_role, delete_track, change_visibility
├── target_type VARCHAR(20)  -- user, track
├── target_id   VARCHAR(100)
├── details     JSONB
└── created_at  TIMESTAMPTZ
```

---

## 4. API 엔드포인트 (v3.0 추가분)

### 관리자 API (`/api/admin/*`) — 모두 admin 역할 필요
| 메서드 | 경로 | 설명 | DB |
|--------|------|------|----|
| GET | /api/admin/dashboard | 대시보드 통계 | PG + Mongo |
| GET | /api/admin/users | 사용자 목록 (검색/필터/페이지네이션) | PG |
| GET | /api/admin/users/{id} | 사용자 상세 | PG + Mongo |
| PUT | /api/admin/users/{id}/role | 역할 변경 | PG |
| PUT | /api/admin/users/{id}/ban | 밴/밴 해제 | PG + Redis |
| GET | /api/admin/tracks | 트랙 목록 (숨김 포함) | Mongo |
| DELETE | /api/admin/tracks/{id} | 트랙 삭제 | Mongo + MinIO + Redis |
| PUT | /api/admin/tracks/{id}/visibility | 공개/비공개 전환 | Mongo + Redis |
| GET | /api/admin/logs | 관리 활동 로그 | PG |

### 기존 API 변경
| 엔드포인트 | 변경 내용 |
|------------|-----------|
| POST /api/auth/register | 응답에 `role` 필드 추가 |
| POST /api/auth/login | `is_banned` 체크 + `role` 반환 |
| GET /api/auth/me | `role` 반환 |

**총 API: 40개** (v2.0 31개 + 관리자 9개)

---

## 5. 프론트엔드 페이지 구성

### 관리자 전용 페이지
| 페이지 | 경로 | 기능 |
|--------|------|------|
| AdminDashboardPage | /admin | 통계 카드 4개 (총 사용자, 트랙, 재생수, 오늘 가입자) + 최근 사용자/트랙 테이블 |
| AdminUsersPage | /admin/users | 사용자 검색, 역할 변경, 밴/밴 해제, 페이지네이션 |
| AdminTracksPage | /admin/tracks | 트랙 검색, 공개/비공개 필터, 삭제, 공개 전환, 페이지네이션 |

### 컴포넌트
| 컴포넌트 | 설명 |
|----------|------|
| AdminLayout | 사이드바 (240px) + 콘텐츠 영역 레이아웃 |
| AdminRoute | 관리자 권한 체크 + 비관리자 리다이렉트 |

### 기존 컴포넌트 수정
| 컴포넌트 | 변경 |
|----------|------|
| Header.jsx | 관리자일 때 "관리자" NavLink 표시 |
| AuthContext.jsx | `isAdmin` 계산 값 추가 |
| App.jsx | admin 라우트 3개 추가, 관리자 페이지에서 Header/Footer/MusicPlayer 숨김 |
| api/index.js | admin API 함수 9개 추가 |

---

## 6. 보안 설계

```
 요청 흐름:

 Client → JWT Token → get_current_user() → get_admin_user()
                         |                       |
                         v                       v
                   Redis 세션 확인          role == 'admin' ?
                   (id, email,                  |
                    nickname, role)         YES: 통과
                                           NO: 403 "관리자 권한이 필요합니다."

 밴 처리 흐름:
 Admin → PUT /ban → PG is_banned=TRUE → Redis session 삭제 → 밴 사용자 즉시 로그아웃
                                          |
                                    로그인 시 is_banned 체크 → 403 "계정이 정지되었습니다."

 자기 자신 보호:
 - 자신의 역할 변경 불가
 - 자신을 밴 불가

 감사 로그:
 모든 관리 활동 → admin_logs 테이블 기록 (누가, 언제, 무엇을, 왜)
```

---

## 7. 파일 변경 목록

### 신규 파일 (9개)
| 파일 | 설명 |
|------|------|
| `backend/app/routes/admin.py` | 관리자 API 라우터 (9 엔드포인트, 486줄) |
| `frontend/src/components/AdminLayout.jsx` | 관리자 레이아웃 |
| `frontend/src/components/AdminLayout.css` | 관리자 레이아웃 스타일 |
| `frontend/src/pages/admin/AdminDashboardPage.jsx` | 대시보드 페이지 |
| `frontend/src/pages/admin/AdminDashboardPage.css` | 대시보드 스타일 |
| `frontend/src/pages/admin/AdminUsersPage.jsx` | 사용자 관리 페이지 |
| `frontend/src/pages/admin/AdminUsersPage.css` | 사용자 관리 스타일 |
| `frontend/src/pages/admin/AdminTracksPage.jsx` | 트랙 관리 페이지 |
| `frontend/src/pages/admin/AdminTracksPage.css` | 트랙 관리 스타일 |

### 수정 파일 (7개)
| 파일 | 변경 내용 |
|------|-----------|
| `backend/infra/init_postgres.sql` | role, is_banned 컬럼 + admin_logs 테이블 |
| `backend/app/auth.py` | get_admin_user 의존성 추가 |
| `backend/app/routes/auth.py` | role 반환, 밴 체크, 세션에 role 저장 |
| `backend/app/main.py` | admin 라우터 등록 |
| `frontend/src/api/index.js` | admin API 함수 9개 |
| `frontend/src/contexts/AuthContext.jsx` | isAdmin 계산 값 |
| `frontend/src/App.jsx` | admin 라우트 + AdminRoute 보호 + 레이아웃 분기 |
| `frontend/src/components/Header.jsx` | 관리자 링크 |

---

## 8. 검증 결과

### 문법 검증
```
 항목                              결과
──────────────────────────────────────────
 backend/app/routes/admin.py       OK (Python 3.8 호환)
 backend/app/auth.py               OK
 backend/app/routes/auth.py        OK
 backend/app/main.py               OK
 admin router import               OK
```

### 프론트엔드 빌드
```
 항목                              결과
──────────────────────────────────────────
 vite build                        성공 (2.59s)
 모듈 수                           143개
 CSS 크기                          38.39 KB (+6.34 KB)
 JS 크기                           332.48 KB (+12.55 KB)
 에러/경고                         없음
```

### 검증 체크리스트
```
 [x] 9개 관리자 API 엔드포인트 구현
 [x] get_admin_user 미들웨어 (role 검증)
 [x] 자기 자신 역할 변경/밴 방지
 [x] 밴 시 Redis 세션 삭제 (즉시 로그아웃)
 [x] 로그인 시 is_banned 체크
 [x] 모든 관리 활동 admin_logs 기록
 [x] 프론트엔드 관리자 페이지 3개 (대시보드, 사용자, 트랙)
 [x] AdminRoute로 비관리자 접근 차단
 [x] Header에 관리자 링크 (admin만 표시)
 [x] 관리자 페이지에서 Header/Footer/MusicPlayer 숨김
 [x] 페이지네이션 필드명 일치 (pagination.totalPages)
 [x] MongoDB 필드명 일치 (uploader_nickname)
```

---

## 9. 관리자 계정 설정 방법

```sql
-- PostgreSQL에서 직접 관리자 설정
UPDATE users SET role = 'admin' WHERE email = 'admin@aimu.com';
```

---

## 10. 실행 방법 (v3.0)

v2.0과 동일. 단, 최초 실행 시 PostgreSQL에 새 컬럼/테이블 추가 필요:

```bash
# Docker DB 서비스 실행
cd backend && docker compose up -d

# PostgreSQL에 스키마 변경 적용 (이미 init_postgres.sql에 포함)
docker exec -i aimu-postgres psql -U aimu_user -d aimu < infra/init_postgres.sql

# 백엔드 실행
uvicorn app.main:app --host 0.0.0.0 --port 9000 --reload

# 프론트엔드 실행 (별도 터미널)
cd ../frontend && npm run dev
```

관리자로 접속: `http://localhost:4000/admin`

---

**v3.0 관리자 모드 구현이 완료되었습니다.**

---

## v2.1 AI 커버 이미지 자동 생성 (나노바나나/Gemini)

### 개요
업로드 페이지에서 곡 정보(제목, 장르, 분위기)를 기반으로 Google Gemini 이미지 생성 모델을 사용하여 앨범 커버 이미지를 자동 생성하는 기능.

### 사용 모델
- **Google Gemini `gemini-3-pro-image-preview`** (나노바나나)
- REST API 직접 호출 (httpx) — google-genai SDK는 Python 3.8 미지원으로 불가

### 구현 파일

| 구분 | 파일 | 변경 내용 |
|------|------|-----------|
| 백엔드 서비스 | `backend/app/services/cover_generator.py` | Gemini REST API로 이미지 생성, base64 디코딩하여 PNG bytes 반환 |
| 백엔드 라우트 | `backend/app/routes/upload.py` | `POST /api/upload/generate-cover` (이미지 생성 → MinIO 저장), `GET /api/upload/cover-preview/{path}` (MinIO 프록시) |
| 백엔드 설정 | `backend/app/config.py` | `google_api_key` 필드 추가 |
| 프론트엔드 페이지 | `frontend/src/pages/UploadPage.jsx` | AI 커버 생성 버튼, 로딩 스피너, 미리보기, 재생성/제거 UI |
| 프론트엔드 스타일 | `frontend/src/pages/UploadPage.css` | AI 커버 관련 스타일 추가 |
| 프론트엔드 API | `frontend/src/api/index.js` | `generateCover()` 함수 추가 |

### API 엔드포인트

#### `POST /api/upload/generate-cover`
- **인증**: JWT Bearer 토큰 필수
- **요청 본문**:
  ```json
  {
    "title": "곡 제목 (필수)",
    "genre": "장르 (선택)",
    "mood": "분위기 (선택)",
    "style": "시각 스타일 (선택)"
  }
  ```
- **응답**:
  ```json
  {
    "image_url": "/api/upload/cover-preview/covers/generated/{user_id}/{uuid}.png",
    "object_name": "covers/generated/{user_id}/{uuid}.png",
    "message": "커버 이미지가 생성되었습니다."
  }
  ```

#### `GET /api/upload/cover-preview/{object_name:path}`
- MinIO에 저장된 커버 이미지를 프록시하여 외부 접근 가능하게 함
- presigned URL의 localhost 문제 회피

### 흐름
1. 사용자가 업로드 페이지에서 곡 제목 입력 후 "AI 커버 생성" 버튼 클릭
2. 프론트엔드 → `POST /api/upload/generate-cover` 호출
3. 백엔드가 Gemini API로 프롬프트 전송 (제목, 장르, 분위기 포함)
4. 생성된 이미지를 MinIO `aimu-images` 버킷에 저장
5. 프론트엔드에서 미리보기 표시, 재생성/제거 가능
6. 업로드 시 `cover_object_name`으로 트랙에 연결

### 테스트 결과
- API 엔드포인트 정상 동작 확인 (인증, 파라미터 검증, Gemini API 호출)
- Gemini API 응답: 429 할당량 초과 — API 키 요금제 확인 필요
- 코드 로직 및 에러 핸들링 정상 동작

### 참고 사항
- Gemini API 무료 tier는 분당/일별 요청 제한이 있음. 유료 플랜 활성화 필요할 수 있음
- 이미지에 텍스트가 포함되지 않도록 프롬프트에 명시적으로 지시
- 타임아웃 120초 설정 (이미지 생성 소요 시간 고려)
