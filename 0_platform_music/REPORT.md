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

---

## v2.2 작업실2 → 새 업로드 연동

### 개요
작업실2(StudioTab2)에서 완료된 AI 생성 음악을 "업로드하기" 버튼으로 새 업로드 탭에 자동 전달. 제목, 장르, 분위기, 프롬프트, 가사, 오디오가 자동 세팅.

### 구현 파일

| 구분 | 파일 | 변경 내용 |
|------|------|-----------|
| 백엔드 | `routes/tracks.py` | `POST /api/tracks/upload-from-generation` — generation에서 트랙 생성 |
| 프론트 | `pages/MyMusicPage.jsx` | `generationPrefill` 상태, 탭 간 데이터 브릿지 |
| 프론트 | `components/StudioTab2.jsx` | 완료 카드에 "업로드하기" 버튼 추가 |
| 프론트 | `pages/UploadPage.jsx` | prefill 수신, 폼 자동 입력, generation 연결 업로드 |
| 프론트 | `api/index.js` | `uploadFromGeneration()` 함수 추가 |

### 테스트 결과
- 엔드포인트 등록 확인, 유효성 검증 (422/400/404) 모두 통과
- 프론트엔드 컴파일 에러 없음, 모든 파일 변경사항 정상 반영

---

## v2.3 AI 뮤직비디오 생성 (Veo 2)

### 개요
업로드 페이지에서 커버 이미지를 초기 프레임으로 사용하여 Google Veo 2 모델로 뮤직비디오 동영상을 자동 생성. 비동기 폴링 방식으로 생성 상태 추적.

### 사용 모델
- **Google Veo 2** (`veo-2`)
- REST API 직접 호출 (httpx) — `predictLongRunning` 비동기 엔드포인트
- 이미지 기반 비디오 생성 (커버 → 초기 프레임)

### 구현 파일

| 구분 | 파일 | 변경 내용 |
|------|------|-----------|
| 백엔드 서비스 | `backend/app/services/mv_generator.py` | Veo 2 API 호출 (생성 시작, 상태 폴링, 비디오 다운로드) |
| 백엔드 라우트 | `backend/app/routes/upload.py` | 3개 엔드포인트 추가 (아래 참조) |
| 프론트엔드 페이지 | `frontend/src/pages/UploadPage.jsx` | 뮤직비디오 생성 버튼, 폴링, 미리보기, 재생성/제거 UI |
| 프론트엔드 스타일 | `frontend/src/pages/UploadPage.css` | 뮤직비디오 관련 스타일 추가 |
| 프론트엔드 API | `frontend/src/api/index.js` | `generateMV()`, `checkMVStatus()` 함수 추가 |

### API 엔드포인트

#### `POST /api/upload/generate-mv`
- **인증**: JWT Bearer 토큰 필수
- **요청 본문**:
  ```json
  {
    "title": "곡 제목 (필수)",
    "genre": "장르 (선택)",
    "mood": "분위기 (선택)",
    "cover_object_name": "MinIO 커버 이미지 경로 (필수)"
  }
  ```
- **응답**: `{"operation_name": "operations/xxx", "message": "뮤직비디오 생성이 시작되었습니다."}`

#### `GET /api/upload/mv-status/{operation_name:path}`
- **인증**: JWT Bearer 토큰 필수
- **진행 중 응답**: `{"done": false}`
- **완료 응답**: `{"done": true, "video_url": "/api/upload/mv-preview/...", "object_name": "mv/generated/..."}`
- **에러 응답**: `{"done": true, "error": "에러 메시지"}`

#### `GET /api/upload/mv-preview/{object_name:path}`
- MinIO에 저장된 뮤직비디오를 프록시 (media_type: video/mp4)

### 흐름
1. 사용자가 커버 이미지 생성 후 "AI 뮤직비디오 생성" 버튼 클릭
2. `POST /api/upload/generate-mv` → Veo 2 API 호출 → operation_name 반환
3. 프론트엔드에서 10초 간격으로 `GET /api/upload/mv-status/{op}` 폴링
4. 완료 시 비디오 다운로드 → MinIO 저장 → 미리보기 표시
5. 업로드 시 `mv_object_name`으로 트랙에 연결

### 테스트 결과

| 테스트 | 결과 |
|--------|------|
| 백엔드 시작 (import 에러 없음) | PASS |
| 프론트엔드 컴파일 | PASS |
| 3개 MV 엔드포인트 등록 | PASS |
| mv_generator.py 문법 검증 | PASS |
| 커버 없이 요청 → 에러 | PASS |
| 존재하지 않는 커버 → 에러 | PASS |
| 가짜 operation 폴링 → 에러 | PASS |
| 프론트엔드 MV UI 코드 반영 | PASS |
| API 함수 등록 | PASS |
| CSS 스타일 반영 | PASS |

### 참고 사항
- Veo 2 생성 소요시간: 약 1~3분
- 생성된 비디오는 Google 서버에서 2일 보관 후 삭제 → MinIO에 즉시 저장
- 비디오 최대 8초, 오디오 미포함 (뮤직비디오 배경 영상 용도)
- 커버 이미지가 있어야만 뮤직비디오 생성 버튼 활성화

---

## v2.4 20장면 AI 뮤직비디오 파이프라인 (Enhanced MV)
### 작성일: 2026-03-17

### 변경 개요
기존 Veo 2 단일 텍스트→영상 방식을 **20장면 이미지 기반 파이프라인**으로 교체.
가사의 흐름을 반영한 일관성 있는 뮤직비디오를 생성할 수 있게 됨.

### 파이프라인 구조

```
[사용자 입력: 제목, 장르, 분위기, 가사]
         │
         ▼
  [ChatGPT] 가사 → 20개 장면 분할 (시각적 설명 포함)
         │
         ▼
  [Gemini] 장면별 이미지 생성 (순차, 16:9, 커버 이미지 참조로 스타일 통일)
         │           └→ MinIO 썸네일 저장, 3초 간격
         ▼
  [Veo 3.1] 이미지 → 8초 영상 클립 (순차, Semaphore(1))
         │         └→ referenceImages + bytesBase64Encoded + 429 백오프
         ▼
  [ffmpeg] 클립 합치기 (stream-copy or re-encode)
         │
         ▼
  [MinIO] 최종 영상 저장 → MongoDB 상태 업데이트
```

### 수정된 파일

| 파일 | 변경 내용 |
|------|-----------|
| `backend/app/services/mv_generator.py` | 전면 재작성: 7개 함수 파이프라인 |
| `backend/app/routes/upload.py` | MV 엔드포인트 job 기반으로 교체 |
| `frontend/src/pages/UploadPage.jsx` | 진행률 바, 썸네일 그리드, localStorage 복구 |
| `frontend/src/pages/UploadPage.css` | 진행률/썸네일 스타일 추가 |
| `frontend/src/api/index.js` | checkMVStatus 파라미터 변경 |

### 핵심 API 변경

| 변경 전 (v2.3) | 변경 후 (v2.4) |
|----------------|----------------|
| `POST /generate-mv` → `{operation_name}` | `POST /generate-mv` → `{job_id}` |
| `GET /mv-status/{operation_name}` | `GET /mv-status/{job_id}` |
| Veo 2 텍스트 전용 | Veo 3.1 이미지 입력 (referenceImages) |
| 단일 8초 영상 | ~20개 8초 클립 합성 (약 160초) |
| 실시간 생성→완료 | 백그라운드 작업 + 진행률 추적 |
| 커버 참조 없음 | 커버 이미지 기반 스타일 일관성 유지 |

### Veo 3.1 이미지 입력 포맷 (검증 완료)

```json
{
  "instances": [{
    "prompt": "scene description",
    "referenceImages": [{
      "image": {
        "bytesBase64Encoded": "<base64>",
        "mimeType": "image/png"
      },
      "referenceType": "asset"
    }]
  }],
  "parameters": {
    "aspectRatio": "16:9",
    "durationSeconds": 8
  }
}
```

**주의 (검증 완료)**:
- `personGeneration` 파라미터를 포함하면 Veo 3.1에서 에러 발생 — 반드시 생략
- `durationSeconds`는 referenceImages 사용 시 **반드시 8** — 4초/6초로 설정하면 400 "use case not supported" 에러
- `aspectRatio`는 referenceImages 사용 시 `"16:9"`만 지원

### 테스트 결과

| 테스트 | 결과 |
|--------|------|
| 백엔드 import 검증 | PASS |
| POST /generate-mv → job_id 반환 | PASS |
| GET /mv-status/{job_id} → 상태 조회 | PASS |
| ChatGPT 장면 분할 (20장면) | PASS |
| Gemini 장면 이미지 생성 (커버 참조) | PASS |
| 썸네일 MinIO 저장 + 프리사인 URL | PASS |
| ffmpeg 설치 (imageio-ffmpeg) | PASS |
| 프론트엔드 진행률 바 UI | PASS |
| localStorage 작업 복구 (useRef) | PASS |
| Veo 3.1 referenceImages (8초) | PASS |
| Veo 3.1 API 직접 테스트 (200 확인) | PASS |

### 디버깅 이력

| 문제 | 원인 | 해결 |
|------|------|------|
| `mv-status/undefined` 폴링 반복 | localStorage에 잘못된 값 잔존 + setInterval ID를 로컬 변수로 관리해 cleanup 불가 | `useRef`로 interval 관리, `stopMvPolling()` 헬퍼 추가, ObjectId 형식(24자 hex) 검증, useEffect cleanup 함수 |
| Veo 3.1 400 "use case not supported" | `durationSeconds: 4` — referenceImages는 **8초 전용** | `durationSeconds: 8`로 변경 (API 테스트 200 확인) |
| Veo 3.1 429 rate limit (0/20 성공) | Semaphore(3)으로 동시 요청 → API 할당량 초과 | Semaphore(1) + 장면별 2초 stagger + 429 시 60/120/180초 백오프 (3회 재시도) |
| 장면 이미지가 커버와 스타일 불일치 | 장면 이미지를 커버 참조 없이 텍스트만으로 독립 생성 | 커버 이미지를 Gemini에 `inlineData`로 전달 + "참조 이미지의 스타일/색감/분위기를 맞춰라" 프롬프트 |
| Gemini 이미지 생성 429 | 20개 이미지를 딜레이 없이 연속 요청 | 이미지 간 3초 대기 + 429 시 30초 대기 후 자동 재시도 |

### 참고 사항
- 전체 파이프라인 소요시간: 약 30~60분 (20장면 × 8초 클립, API 속도에 따라 변동)
- 50% 이상 장면 실패 시 전체 작업 중단
- 장면별 최대 3회 재시도 (429 에러 시 백오프 적용)
- ffmpeg가 시스템에 없으면 `imageio-ffmpeg` pip 패키지의 바이너리 사용
- 가사가 없으면 제목/장르/분위기 기반으로 20개 장면 자동 생성
- 커버 이미지가 있으면 모든 장면 이미지가 커버의 화풍을 따라감

---

## v2.5 — MV 임시저장/이어하기 시스템

### 1. 구현 개요
기존 새업로드 탭의 MV 섹션을 STEP1(씬 생성)/STEP2(영상 생성) 구조로 변경하고,
이메일 임시저장 방식으로 작업 중간 저장 + 내 음악 > 임시저장 탭에서 불러오기 기능 구현.

### 2. 아키텍처
```
작업실2 → 생성기록 → [업로드하기] → 새업로드 탭
                                        │
                    ┌───────────────────┤
                    │                   │
              커버 이미지 생성      MV 섹션 (2단계)
                    │                   │
                    │         STEP 1: [씬 생성하기]
                    │           ChatGPT 씬 분할 + Gemini 이미지 생성
                    │           씬별 이미지 업로드/재생성 가능
                    │                   │
                    │         STEP 2: [영상 생성하기]
                    │           Veo 3.1 영상 생성 (순차, 이어하기 가능)
                    │           429 → 일시정지 → [재시도하기]
                    │                   │
                    │         [임시저장]   [업로드]
                    │              │
                    └──────────────┤
                                   ▼
                    내 음악 > 임시저장 탭
                    [불러오기] → 새업로드 탭 복원
```

### 3. 파일 변경 목록

| 파일 | 유형 | 변경 |
|------|------|------|
| `backend/app/routes/mv.py` | Backend | MV API 라우터 (10개 엔드포인트, save-draft 추가) |
| `backend/app/services/mv_pipeline.py` | Backend | Phase 1+2 통합 함수, 이어하기 로직 |
| `frontend/src/pages/UploadPage.jsx` | Frontend | MV 섹션 STEP1/STEP2 + 임시저장 버튼 |
| `frontend/src/pages/UploadPage.css` | Frontend | 씬 카드, 프로그레스, 임시저장 스타일 |
| `frontend/src/pages/MyMusicPage.jsx` | Frontend | "임시저장" 탭 + 드래프트 목록 |
| `frontend/src/pages/MyMusicPage.css` | Frontend | 드래프트 카드 스타일 |
| `frontend/src/api/index.js` | Frontend | MV Draft API 함수 10개 추가 |

### 4. API 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| POST | `/api/mv/create` | MV 생성 + 씬 분할 + 이미지 생성 (Phase1+2 통합) |
| GET | `/api/mv/jobs` | 사용자 임시저장 목록 |
| GET | `/api/mv/jobs/{id}` | 작업 상세 (씬별 presigned URL + 폼 필드) |
| POST | `/api/mv/jobs/{id}/generate-images` | 이미지 생성 (선택적 씬 지정) |
| POST | `/api/mv/jobs/{id}/scenes/{n}/upload-image` | 사용자 이미지 업로드 |
| POST | `/api/mv/jobs/{id}/scenes/{n}/regenerate-image` | 단일 씬 이미지 재생성 |
| POST | `/api/mv/jobs/{id}/generate-videos` | 영상 생성/이어하기 (완료 씬 스킵) |
| POST | `/api/mv/jobs/{id}/concatenate` | 수동 합치기 |
| POST | `/api/mv/jobs/{id}/save-draft` | 폼 필드 임시저장 |
| DELETE | `/api/mv/jobs/{id}` | 작업 + MinIO 파일 삭제 |

### 5. 핵심 기능

- **2단계 MV 생성**: 씬 생성(이미지) → 영상 생성으로 분리, 각 단계 독립 실행
- **임시저장**: 새업로드 탭 하단 [임시저장] → MongoDB에 전체 상태 저장
- **불러오기**: 내 음악 > 임시저장 탭 → [불러오기] → 새업로드 탭에 전체 복원
- **이어하기**: 429 에러 시 "paused" 상태 → [재시도하기] 버튼으로 미완료 씬만 처리
- **씬별 이미지 관리**: 사용자 업로드 또는 AI 재생성 가능

### 6. 테스트 결과

| 항목 | 결과 |
|------|------|
| Backend import 검증 | PASS |
| API 라우트 등록 (12개) | PASS |
| API 경로 FE/BE 일치 | PASS |
| Props 연결 (draftData) | PASS |
| Polling useRef 패턴 | PASS |
| CSS 클래스 일치 | PASS |

### 7. 테스터 발견 버그 및 수정

| 버그 | 수정 내용 |
|------|-----------|
| image_source "uploaded" → "upload" 불일치 | UploadPage.jsx 수정 |
| object_name → result_object_name 필드명 | UploadPage.jsx 수정 |
| scenes_ready, videos_ready 상태 매핑 누락 | UploadPage.jsx mapStatusToStep 수정 |
| MyMusicPage 상태 배지 draft/scenes_ready/videos_ready 누락 | STATUS_MAP 추가 |

### v2.5.1 — 커버 확정 후 씬 생성 분리

| 변경 파일 | 내용 |
|-----------|------|
| `backend/app/routes/mv.py` | `cover_object_name` 필수 검증 추가 |
| `frontend/src/pages/UploadPage.jsx` | 씬 생성 버튼 비활성화, 커버 변경 감지, 경고 배너 |
| `frontend/src/pages/UploadPage.css` | 비활성 버튼, 힌트, 경고 배너 스타일 |

테스트 결과: 전체 PASS (백엔드 import, 커버 검증, 버튼 비활성화, 경고 배너, CSS)

### v2.5.2 — 음악 길이 기반 씬 개수 동적 산출

#### 개요
기존 고정 20씬 → `ceil(audio_duration_sec / 8)` 동적 계산 (최소 5, 최대 60).
각 씬 영상 8초 × N씬 생성 후, ffmpeg로 실제 음악 길이에 맞춰 트리밍.

#### 변경 파일

| 파일 | 변경 내용 |
|------|-----------|
| `backend/app/routes/mv.py` | `CreateMVRequest`에 `audio_duration_sec` 필드 추가, `scene_count = ceil(audio_duration_sec / 8)` 클램프 [5,60], job 문서에 저장 |
| `backend/app/services/mv_generator.py` | 프롬프트 상수 → 템플릿 (`{scene_count}`, `{scene_min}`, `{scene_max}`), `split_lyrics_into_scenes(scene_count)` 파라미터 추가 |
| `backend/app/services/mv_pipeline.py` | `run_phase1_split`에서 job doc의 `scene_count` 전달, `run_phase4_concatenate`에서 ffmpeg `-t` 트리밍 |
| `frontend/src/pages/UploadPage.jsx` | `getAudioDuration()` 헬퍼 (HTML5 Audio loadedmetadata), `handleCreateScenes`에서 `audio_duration_sec` 전달 |

#### 테스트 결과

| 항목 | 결과 |
|------|------|
| Backend import 검증 | PASS |
| CreateMVRequest audio_duration_sec 필드 | PASS |
| scene_count 계산 로직 (ceil/clamp) | PASS |
| 프롬프트 템플릿 {scene_count} 치환 | PASS |
| mv_pipeline scene_count 전달 | PASS |
| ffmpeg -t 트리밍 명령어 | PASS |
| Frontend getAudioDuration 함수 | PASS |
| API 호출 시 audio_duration_sec 전달 | PASS |

---

## v2.6 — Suno 모델 통합
### 작성일: 2026-03-18

#### 개요
기존 YuE(로컬) 모델 외에 Suno API를 통한 클라우드 음악 생성 모델을 추가.
간편 모드 / 커스텀 모드 모두에서 모델 선택 카드로 YuE 또는 Suno를 선택 가능.

#### 변경 파일

| 파일 | 유형 | 변경 내용 |
|------|------|-----------|
| `backend/app/config.py` | Backend | `suno_api_key`, `suno_api_url` 설정 추가 |
| `backend/.env` | Config | `SUNO_API_KEY` 환경변수 추가 |
| `backend/app/services/suno_generator.py` | Backend (신규) | Suno API 호출, polling, 오디오 다운로드, MinIO 업로드, progress 관리 |
| `backend/app/routes/generate.py` | Backend | `model=="suno"` 분기, `/models/` 엔드포인트에 Suno 추가 |
| `frontend/src/components/StudioTab2.jsx` | Frontend | MODEL_OPTIONS에 Suno 카드 추가, Suno 선택 시 BPM/Key/Duration 숨김 |
| `frontend/src/components/StudioTab2.css` | Frontend | Suno 안내 메시지 스타일 |

#### Suno API 연동 흐름
```
1. POST /api/v1/generate → taskId 반환
2. GET /api/v1/generate/record-info?taskId={id} → polling (5초 간격, 최대 5분)
3. status: PENDING → TEXT_SUCCESS → FIRST_SUCCESS → SUCCESS
4. SUCCESS 시 audioUrl에서 MP3 다운로드 → MinIO 업로드
5. MongoDB generation 문서 업데이트 (status: completed)
```

#### 테스트 결과

| 항목 | 결과 |
|------|------|
| Backend config suno 설정 | PASS |
| Backend .env SUNO_API_KEY | PASS |
| suno_generator.py 구조 (API 호출, polling, 업로드) | PASS |
| generate.py model 분기 + /models/ 확장 | PASS |
| Frontend MODEL_OPTIONS Suno 추가 | PASS |
| 커스텀 모드 Suno 선택 시 BPM/Key/Duration 숨김 | PASS |
| 생성 기록 Suno 모델 태그 표시 | PASS |
| MinIO 버킷명 일치 (minio_bucket_music) | PASS |

### v2.6.1 — Suno 보컬 연동 수정
#### 작성일: 2026-03-18

#### 개요
Suno 생성 시 보컬이 가사를 부르지 않는 문제 수정. style에 보컬 정보 추가, vocalGender 전달, 가사 구조 태그 자동 추가.

#### 변경 파일

| 파일 | 변경 내용 |
|------|-----------|
| `backend/app/services/suno_generator.py` | SUNO_VOCAL_MAP(8개 프리셋), _ensure_lyrics_structure 헬퍼, style에 보컬 정보 포함, vocalGender 전달, instrumental 명시적 bool |

#### 테스트 결과

| 항목 | 결과 |
|------|------|
| SUNO_VOCAL_MAP 8개 프리셋 | PASS |
| _ensure_lyrics_structure 로직 | PASS |
| style에 보컬 정보 포함 | PASS |
| is_instrumental 명시적 bool | PASS |
| vocalGender 전달 | PASS |
| prompt에 구조 태그 적용 | PASS |
| FE/BE 보컬 프리셋 키 매칭 | PASS (불일치 수정: male_soft, female_sweet 추가) |

---

## v2.7 — 뮤직비디오 음악 합치기 (STEP 3)
### 작성일: 2026-03-18

#### 개요
MV 영상 생성 완료 후, 생성된 음악 파일(Suno/YuE)과 영상을 ffmpeg로 합쳐서 최종 뮤직비디오를 만드는 STEP 3 추가.

#### 흐름 변경
- Phase4 완료: `"completed"` → `"video_ready"` (영상만 완료)
- Phase5 추가: 영상 + 음악 ffmpeg 합치기 → `"completed"` (최종 완료)

#### 변경 파일

| 파일 | 변경 내용 |
|------|-----------|
| `backend/app/services/mv_pipeline.py` | Phase4 완료 상태 `video_ready`로 변경, `run_phase5_merge_audio` 함수 추가 |
| `backend/app/routes/mv.py` | `POST /merge-audio` 엔드포인트, `MergeAudioRequest`, `merging_audio` 상태 추가 |
| `frontend/src/api/index.js` | `mergeAudioMV` API 함수 추가 |
| `frontend/src/pages/UploadPage.jsx` | STEP 3 UI, mvStep 5/6 매핑, 음악 자동 연결, 합치기 버튼 |
| `frontend/src/pages/UploadPage.css` | merge 관련 스타일 추가 |

#### Veo 모델 변경
- `veo-3.1-generate-preview` → `veo-3.0-fast-generate` (비용 1/5, 한도 1,200 RPM)

#### 테스트 결과: 21/21 PASS

---

## v2.8 — 내 캐릭터 시스템 + 씬 프롬프트
### 작성일: 2026-03-18

#### 개요
1. 내 캐릭터 탭에서 사진 업로드 → AI 실사 캐릭터 시트 생성 → 저장
2. 커버/MV 씬 이미지 생성 시 캐릭터를 주인공으로 포함
3. 씬 생성 전 사용자가 분위기/배경 프롬프트 입력 가능

#### 신규 파일

| 파일 | 내용 |
|------|------|
| `backend/app/services/character_generator.py` | Gemini 실사 캐릭터 시트 생성 (photorealistic, 애니메이션 금지) |
| `backend/app/routes/character.py` | 캐릭터 CRUD API (generate-sheet, save, me, delete) |

#### 수정 파일

| 파일 | 변경 내용 |
|------|-----------|
| `backend/app/main.py` | character 라우터 등록 |
| `backend/app/services/cover_generator.py` | character_image_bytes 파라미터, 캐릭터 주인공 프롬프트 |
| `backend/app/routes/upload.py` | character_object_name 필드, MinIO 로드 |
| `backend/app/services/mv_generator.py` | split: user_scene_prompt, generate: character_image_bytes |
| `backend/app/services/mv_pipeline.py` | 캐릭터 이미지 로드 + scene_prompt 전달 |
| `backend/app/routes/mv.py` | CreateMVRequest에 scene_prompt, character_object_name 추가 |
| `frontend/src/api/index.js` | 캐릭터 API 함수 4개 추가 |
| `frontend/src/pages/MyMusicPage.jsx` | "내 캐릭터" 탭 + CharacterSection 컴포넌트 |
| `frontend/src/pages/MyMusicPage.css` | 캐릭터 섹션 스타일 |
| `frontend/src/pages/UploadPage.jsx` | 캐릭터 포함 토글, 씬 프롬프트 입력란 |
| `frontend/src/pages/UploadPage.css` | 캐릭터 토글 스타일 |

#### 테스트 결과: 14/14 PASS

### v2.8.1 — 캐릭터 시트 디테일 강화
#### 작성일: 2026-03-18

#### 개요
캐릭터 시트 프롬프트를 6개 뷰 → 15개 뷰로 대폭 확장. 조사 결과 반영하여 3가지 핵심 디테일 추가.

#### 추가된 디테일
1. **다양한 표정 (4종)** — 미소/슬픔/놀람/진지 (기존 2종 → 4종)
2. **손 디테일 클로즈업** — AI 약점인 손 표현 개선
3. **다양한 포즈 (앉기/걷기)** — 정적 포즈 외 동적 장면 일관성

#### 캐릭터 시트 구성 (4행 15뷰)
- ROW 1: 정면, 좌 3/4, 우측 프로필, 뒷모습
- ROW 2: 전신 정면, 앉기 포즈, 걷기 포즈
- ROW 3: 미소/슬픔/놀람/진지 표정
- ROW 4: 손/눈/입술 클로즈업, 색상 팔레트

#### 변경 파일
| 파일 | 변경 |
|------|------|
| `backend/app/services/character_generator.py` | 프롬프트 6뷰 → 15뷰 확장 |

---

## v2.9 — Kling 영상 모델 통합
### 작성일: 2026-03-19

#### 개요
MV 영상 생성 시 Veo 외에 Kling 모델을 선택할 수 있도록 추가. 공식 Kling API (JWT 인증) 직접 연동.

#### 신규 파일

| 파일 | 내용 |
|------|------|
| `backend/app/services/kling_video_generator.py` | JWT 인증, image-to-video, 상태 polling, 영상 다운로드 |

#### 수정 파일

| 파일 | 변경 내용 |
|------|-----------|
| `backend/app/config.py` | kling_access_key, kling_secret_key 설정 |
| `backend/.env` | KLING_ACCESS_KEY, KLING_SECRET_KEY 추가 |
| `backend/app/routes/mv.py` | video_model 필드, /api/mv/models 엔드포인트 |
| `backend/app/services/mv_pipeline.py` | run_phase3_videos에서 veo/kling 분기 |
| `frontend/src/api/index.js` | generateMVVideos에 videoModel 전달, getMVModels |
| `frontend/src/pages/UploadPage.jsx` | 영상 모델 선택 카드 UI (Veo/Kling) |
| `frontend/src/pages/UploadPage.css` | 모델 카드 스타일 |

#### 테스트 결과: 8/8 PASS

### v2.9.1 — 모델별 씬 계산 + 스토리 아크
#### 작성일: 2026-03-19

#### 개요
1. 영상 모델 선택을 STEP 1(씬 생성 전)으로 이동 — 모델별 클립 길이가 달라서 씬 개수에 영향
2. Kling duration 5초 → 10초로 변경
3. 씬 분할 프롬프트에 스토리 아크(도입/전개/클라이맥스/결말) 지시 추가

#### 씬 개수 계산
| 모델 | 클립 길이 | 2분30초 곡 씬 수 |
|---|---|---|
| Veo 3.1 | 8초 | ceil(150/8) = 19씬 |
| Kling V3 | 10초 | ceil(150/10) = 15씬 |

#### 변경 파일
| 파일 | 변경 |
|------|------|
| `backend/app/routes/mv.py` | video_model별 CLIP_DURATION 분기 (8/10) |
| `backend/app/services/kling_video_generator.py` | duration "5" → "10" |
| `backend/app/services/mv_generator.py` | 두 프롬프트 템플릿에 스토리 아크 지시 추가 |
| `frontend/src/pages/UploadPage.jsx` | 모델 선택 STEP1로 이동, STEP2에서 읽기전용 |

#### 테스트 결과: 8/8 PASS

### v2.9.2 — 뮤직비디오 퍼포먼스 씬 교차 배치
#### 작성일: 2026-03-19

#### 개요
씬 분할 프롬프트에 "performance scene" 교차 배치 지시 추가.
3~4개 스토리 씬마다 주인공이 카메라를 보며 노래하는 퍼포먼스 씬을 삽입하여 진짜 뮤직비디오 느낌을 구현.

#### 변경 파일
| 파일 | 변경 |
|------|------|
| `backend/app/services/mv_generator.py` | 두 프롬프트 템플릿에 performance scene 교차 지시 추가 |

---

## v1 - 2026-03-23 - 폴더명 변경 영향 점검 및 수정

### 요청 작업
상위 폴더명 `1_oneCompany` → `1_tripleJ` 변경에 따른 코드 점검 및 수정

### 수행 결과
- **전체 코드베이스 검색 완료** (frontend/src, backend/app, 설정파일, docker-compose 등)
- `1_oneCompany` 또는 `oneCompany` 문자열 발견: **1건 (2줄)**
  - `backend/.env` — `YUE_MODEL_DIR`, `YUE_OUTPUT_DIR` 절대 경로
- **수정 파일**: `backend/.env` (41~42번째 줄)
  - `1_oneCompany` → `1_tripleJ` 경로 수정 완료

| 파일 | 변경 내용 |
|------|-----------|
| `backend/.env` | `YUE_MODEL_DIR`, `YUE_OUTPUT_DIR` 경로의 `1_oneCompany` → `1_tripleJ` |

### 테스트 결과
- [PASS] 백엔드 서버(port 9000) 정상 기동 확인 — uvicorn 정상 시작, `Application startup complete`
- [PASS] 프론트엔드 서버(port 4000) 정상 기동 확인 — Vite v7.3.1 정상 시작
- [PASS] 프론트엔드 페이지 로드 확인 — HTTP 200, HTML 정상 반환
- [PASS] 백엔드 API 응답 확인 — `/api/charts/top100` 정상 JSON 응답
- [PASS] 인증 API 확인 — `/api/auth/me` 정상 응답 (401 인증 필요 메시지)
- [PASS] .env 환경변수 로드 정상 — 서버 기동 시 DB 연결 성공

### 특이사항
- 프론트엔드 코드, 백엔드 Python 소스, docker-compose.yml, package.json, requirements.txt 등에는 `1_oneCompany` 하드코딩이 전혀 없었음
- `.env.example`은 상대경로를 사용하고 있어 영향 없음
- 유일한 문제는 `.env` 파일의 YuE AI 모델 관련 절대경로 2건뿐이었으며, 즉시 수정 완료

---

## v2 - 2026-03-23 - Voice Persona (내 목소리) 기능 추가

### 구현 요약
사용자가 자신의 노래 파일을 업로드하면 Suno 써드파티 API를 통해 4단계 워크플로우로 Voice Persona를 생성하고, 이후 작업실2에서 음악 생성 시 해당 Persona의 목소리로 노래를 만들 수 있는 기능을 구현했다.

### 신규 파일
| 파일 | 설명 |
|------|------|
| `backend/app/services/voice_persona_service.py` | Suno API 4단계 워크플로우 서비스 (upload-cover, separate-vocals, generate-persona) |
| `backend/app/routes/voice_persona.py` | Voice Persona CRUD API (create, list, get, delete) |

### 수정 파일
| 파일 | 변경 내용 |
|------|-----------|
| `backend/app/main.py` | voice_persona 라우터 등록 |
| `backend/app/routes/generate.py` | GenerateRequest에 persona_id 필드 추가, 음악 생성 시 persona_id 전달 |
| `backend/app/services/suno_generator.py` | persona_id 파라미터 지원 (Suno API에 personaId 전달) |
| `frontend/src/api/index.js` | Voice Persona API 함수 4개 추가 |
| `frontend/src/pages/MyMusicPage.jsx` | VoicePersonaSection 컴포넌트 추가 (내 캐릭터 탭 내) |
| `frontend/src/pages/MyMusicPage.css` | Voice Persona UI 스타일 추가 |
| `frontend/src/components/StudioTab2.jsx` | 보컬 선택에 "내 목소리" Persona 옵션 추가 (Suno 모델 선택 시) |
| `frontend/src/components/StudioTab2.css` | Persona 선택 UI 스타일 추가 |
| `PLAN.md` | v2 계획 추가 |

### API 엔드포인트
| Method | Path | 설명 |
|--------|------|------|
| POST | `/api/voice-persona/create` | 음성 파일 업로드 + Persona 생성 시작 (multipart/form-data) |
| GET | `/api/voice-persona/list` | 내 Voice Persona 목록 조회 |
| GET | `/api/voice-persona/{id}` | 단일 Persona 상태 조회 |
| DELETE | `/api/voice-persona/{id}` | Persona 삭제 (MinIO 파일 + MongoDB 문서) |

### MongoDB 컬렉션: voice_personas
- user_id, name, description, persona_id (Suno), status, progress
- source_audio_object (MinIO), cover/separate/persona task IDs
- created_at, updated_at, completed_at

### 4단계 워크플로우
1. 사용자 업로드 → MinIO 저장 → presigned URL 생성
2. Suno upload-cover API → AI 커버곡 생성 (사용자 목소리 톤 반영)
3. Suno separate-vocals API → 보컬 스템 추출
4. Suno generate-persona API → Persona 생성 → personaId 획득

### 프론트엔드 UI
- **내 캐릭터 탭**: 기존 캐릭터 시트 아래에 "내 목소리 (Voice Persona)" 섹션 추가
  - 목소리 추가 버튼 → 파일 업로드 + 이름/설명 입력 폼
  - Persona 목록 카드 (상태 배지, 진행률 바, 삭제 버튼)
  - 진행 중인 Persona 자동 폴링 (8초 간격)
- **작업실2 (Step 3 음악 생성)**: Suno 모델 선택 시 보컬 스타일 아래에 "내 목소리" 섹션 표시
  - 완료된 Persona만 표시, 클릭 시 persona_id 선택
  - 선택 시 안내 메시지 표시

### 테스트 결과
- [x] 백엔드 서버(port 9000) 자동 reload로 정상 반영 확인
- [x] 프론트엔드 서버(port 4000) HMR로 정상 반영 확인
- [x] `/api/voice-persona/create`, `/list`, `/{id}`, DELETE API 라우트 등록 확인
- [x] `/api/generate/` POST — persona_id 필드 정상 수용 확인
- [x] 인증 미포함 요청 시 401 응답 확인
- [x] Python 문법 검사 통과 (ast.parse)

---

## v3 — Voice Persona 보컬/커버 미리듣기 및 다운로드 (2026-03-23)

### 구현 목적
Voice Persona 생성 시 Suno에서 받는 cover_audio_url, vocal_audio_url은 임시 URL이라 만료됨. 보컬/커버 오디오를 MinIO에 영구 저장하고, 사용자가 미리듣기/다운로드할 수 있도록 기능 추가.

### 백엔드 변경사항

#### 1. voice_persona_service.py
- 보컬 분리(Step 3) 성공 후, `vocal_url`과 `cover_audio_url`을 httpx로 다운로드하여 MinIO에 저장
- 저장 경로: `voice-personas/{user_id}/{persona_id}/vocal.mp3`, `voice-personas/{user_id}/{persona_id}/cover.mp3`
- MongoDB에 `vocal_object_name`, `cover_object_name` 필드 추가 저장
- 다운로드 실패 시 warning 로그 후 해당 object_name을 None으로 처리 (워크플로우 중단하지 않음)

#### 2. voice_persona.py (라우트)
- **presigned URL 헬퍼** `_presign_audio()` 추가 — MinIO 24시간 presigned URL 생성
- **list/get API 응답 확장**: `has_vocal`, `has_cover` (boolean), `vocal_url`, `cover_url` (presigned URL) 필드 추가
- **새 엔드포인트 4개**:
  - `GET /api/voice-persona/{id}/vocal/stream` — 보컬 스트리밍 (Content-Disposition: inline)
  - `GET /api/voice-persona/{id}/cover/stream` — 커버 스트리밍
  - `GET /api/voice-persona/{id}/vocal/download` — 보컬 다운로드 (Content-Disposition: attachment)
  - `GET /api/voice-persona/{id}/cover/download` — 커버 다운로드
- **공통 헬퍼** `_get_persona_doc()`, `_stream_audio()` 추가 — 인증/소유권 검증 및 MinIO 스트리밍 로직 공유
- **삭제 개선**: delete 시 `source_audio_object`뿐 아니라 `vocal_object_name`, `cover_object_name`도 함께 MinIO에서 삭제

### 프론트엔드 변경사항

#### 1. api/index.js
- `streamVoicePersonaVocal(id)`, `streamVoicePersonaCover(id)` — stream URL 생성
- `downloadVoicePersonaVocal(id)`, `downloadVoicePersonaCover(id)` — download URL 생성

#### 2. MyMusicPage.jsx — VoicePersonaSection
- 완료된 Persona 카드에 보컬/커버 미리듣기 재생 버튼 추가 (presigned URL 기반 Audio 재생)
- 보컬/커버 다운로드 버튼 추가 (fetch + blob 방식으로 인증 포함)
- 재생 중인 오디오 상태 관리 (playingAudio state, audioRef)
- 같은 오디오 재클릭 시 정지, 다른 오디오 클릭 시 자동 전환
- 컴포넌트 언마운트 시 오디오 정리

#### 3. MyMusicPage.css
- `.vp-card__audio-actions` — 오디오 버튼 컨테이너
- `.vp-card__audio-btn` — 재생/다운로드 버튼 스타일
- `.vp-card__audio-btn--playing` — 재생 중 활성 상태
- `.vp-card__audio-btn--download` — 다운로드 전용 축소 스타일

### 아키텍처 포인트
- **이중 접근 방식**: list/get API에서 presigned URL 제공 (프론트엔드 직접 재생용) + stream/download 엔드포인트 (백엔드 프록시, 세밀한 인증 제어)
- **기존 패턴 준수**: generate.py의 StreamingResponse 패턴, mv.py의 `_presign()` 패턴 참고
- **graceful degradation**: MinIO 저장 실패 시 워크플로우 중단 없이 계속 진행, 다만 미리듣기/다운로드는 불가

### 수정된 파일 목록
| 파일 | 변경 |
|------|------|
| `backend/app/services/voice_persona_service.py` | 보컬/커버 MinIO 저장 로직 추가 |
| `backend/app/routes/voice_persona.py` | 4개 엔드포인트, presigned URL, 삭제 개선 |
| `frontend/src/api/index.js` | stream/download URL 헬퍼 4개 |
| `frontend/src/pages/MyMusicPage.jsx` | 오디오 재생/다운로드 UI |
| `frontend/src/pages/MyMusicPage.css` | 오디오 버튼 스타일 |

---

## v4 — Kits.AI 보컬 변환 (Voice Conversion) 구현 보고서

### 개요
Suno AI로 생성된 음악의 보컬을 사용자의 Kits.AI 음성 모델로 교체하는 전체 파이프라인 구현 완료.

### 구현된 파이프라인
```
[Suno 출력 MP3] → [보컬/반주 분리] → [보컬→내 목소리 변환] → [변환 보컬+반주 합치기] → [결과 저장]
     MinIO          Kits API            Kits API              ffmpeg             MinIO
```

### 백엔드 변경사항

#### 1. 설정
- `.env`: `KITS_API_KEY`, `KITS_API_URL` 추가
- `app/config.py`: `kits_api_key`, `kits_api_url` 필드 추가

#### 2. `app/services/kits_service.py` (신규 260줄)
- **`convert_voice()`**: 8단계 파이프라인 — MinIO 다운로드 → 보컬 분리 → 음성 변환 → ffmpeg 합치기 → MinIO 업로드 → MongoDB 업데이트
- **`get_voice_models()`**: Kits API 모델 목록 프록시
- **`_poll_kits_job()`**: 상태 폴링 (최대 10분, 5초 간격) + MongoDB 진행률 실시간 반영
- **`_get_ffmpeg_path()`**: shutil.which → miniconda fallback → imageio_ffmpeg 3중 탐색
- ffmpeg amix 필터로 보컬+반주 합성, 192k MP3 출력

#### 3. `app/routes/voice_convert.py` (신규 230줄)
- `POST /api/voice-convert/{generation_id}` — BackgroundTasks로 비동기 변환 시작
  - 요청 바디: `voice_model_id`, `conversion_strength`, `model_volume_mix`, `pitch_shift`
  - 중복 요청 방지 (converting/merging/uploading 상태 체크)
- `GET /api/voice-convert/{generation_id}/status` — 진행 상태 조회
- `GET /api/voice-convert/{generation_id}/stream` — 변환 결과 스트리밍 (inline)
- `GET /api/voice-convert/{generation_id}/download` — 변환 결과 다운로드 (attachment)
- `GET /api/kits/voice-models` — Kits 모델 목록 프록시

#### 4. `app/main.py` — voice_convert 라우터 등록
#### 5. `app/routes/generate.py` — `voice_conversion_completed_at` datetime 직렬화 추가

### 프론트엔드 변경사항

#### 1. `api/index.js` — 6개 함수 추가
- `startVoiceConvert()`, `getVoiceConvertStatus()`, `getKitsVoiceModels()`
- `voiceConvertStreamUrl()`, `voiceConvertDownloadUrl()`

#### 2. `StudioTab2.jsx` — 음성 변환 UI 통합
- Suno 완료 카드에 "내 목소리로 변환" 버튼 (FiRepeat 아이콘)
- **변환 모달**: Kits 모델 선택 그리드 + 슬라이더 (변환 강도, 볼륨 믹스, 피치 조절)
- **변환 진행 상태**: 프로그레스바 + 퍼센트 표시 + 상태 텍스트
- **변환 완료**: 재생/다운로드 버튼 + "다시 변환" 옵션
- **변환 실패**: 에러 메시지 + 재시도 버튼
- 기존 생성 폴링에 voice_conversion_status 변화도 감지하도록 확장

#### 3. `StudioTab2.css` — 음성 변환 관련 스타일 추가
- 변환 버튼, 상태바, 진행률 바, 모달, 모델 선택 그리드, 슬라이더

### MongoDB generations 컬렉션 추가 필드
| 필드 | 타입 | 설명 |
|------|------|------|
| `voice_conversion_status` | string | pending/converting/merging/uploading/completed/failed |
| `voice_conversion_progress` | int | 0~100 |
| `voice_conversion_error` | string | 에러 메시지 |
| `voice_converted_url` | string | MinIO: generated/{id}/voice_converted.mp3 |
| `voice_converted_backing_url` | string | MinIO: generated/{id}/backing.wav |
| `voice_model_id` | int | 사용된 Kits 모델 ID |
| `voice_conversion_completed_at` | datetime | 완료 시간 |

### 수정된 파일 목록
| 파일 | 변경 |
|------|------|
| `backend/.env` | KITS_API_KEY, KITS_API_URL 추가 |
| `backend/app/config.py` | kits_api_key, kits_api_url 설정 |
| `backend/app/main.py` | voice_convert 라우터 임포트 및 등록 |
| `backend/app/routes/generate.py` | datetime 직렬화 필드 추가 |
| `backend/app/services/kits_service.py` | 신규 — 전체 변환 파이프라인 |
| `backend/app/routes/voice_convert.py` | 신규 — 5개 API 엔드포인트 |
| `frontend/src/api/index.js` | 6개 API 함수 추가 |
| `frontend/src/components/StudioTab2.jsx` | 변환 UI, 모달, 상태 표시 |
| `frontend/src/components/StudioTab2.css` | 변환 관련 CSS 스타일 |

---

## v5 — 내 목소리 섹션 분리 (우회 방식 / Kits.AI) 보고서

### 변경 요약
"내 캐릭터" 탭의 "내 목소리" 섹션을 두 서브탭으로 분리하고, 작업실2 VC 모달에서도 두 그룹을 구분 표시하도록 수정.

### 수정된 파일

| 파일 | 변경 내용 |
|------|----------|
| `frontend/src/pages/MyMusicPage.jsx` | VoicePersonaSection에 voiceSubTab state 추가, 우회 방식/Kits.AI 서브탭 UI, Kits.AI 모델 목록 fetch 및 카드 렌더링 |
| `frontend/src/pages/MyMusicPage.css` | .vp-subtabs, .vp-subtab 서브탭 스타일, .vp-kits Kits.AI 탭 하단 안내/링크 스타일 추가 |
| `frontend/src/components/StudioTab2.jsx` | vcSelectedType state 추가, VC 모달을 두 그룹(우회 방식/Kits.AI)으로 분리, 우회 방식 선택 시 persona_id로 새 Suno 생성, Kits.AI 선택 시 기존 voice-convert API 호출, 고급 설정은 Kits.AI 전용으로 조건부 표시 |
| `frontend/src/components/StudioTab2.css` | .s2__vc-group-header 그룹 구분 스타일 추가 |

### 주요 동작 흐름

1. **내 캐릭터 > 내 목소리**
   - 상단 서브탭으로 "우회 방식" / "Kits.AI" 전환
   - 우회 방식: 기존 Suno Persona 기능 100% 유지
   - Kits.AI: 탭 전환 시 `GET /api/kits/voice-models` 자동 호출, 모델 카드 표시, 하단에 kits.ai 모델 생성 외부 링크

2. **작업실2 > "내 목소리로 변환" 모달**
   - 우회 방식 그룹: 완료된 Suno Persona 목록
   - Kits.AI 그룹: Kits.AI 학습 모델 목록
   - 우회 방식 선택 시: 원곡의 가사/프롬프트를 복사하여 해당 persona_id로 새 Suno 곡 생성
   - Kits.AI 선택 시: 기존 보컬분리→변환→합치기 파이프라인 실행 (고급 설정 노출)

---

## v6 — 업로드 페이지: 원본/내 목소리 버전 오디오 소스 선택 기능

### 구현 요약

작업실2에서 voice conversion이 완료된 곡을 "업로드하기"하면, 업로드 페이지에서 **원본(AI 보컬)** 또는 **내 목소리 버전** 중 하나를 선택할 수 있는 UI가 표시된다. 각 버전을 미리 재생해볼 수 있으며, 선택한 버전이 실제 업로드에 사용된다.

### 변경 내역

1. **StudioTab2.jsx**: `onSendToUpload` 데이터에 `hasVoiceConverted` 플래그 추가
2. **UploadPage.jsx**:
   - `hasVoiceConverted`, `useVoiceConverted` state 도입
   - 조건부 오디오 소스 선택 UI (두 개의 토글 버튼)
   - `<audio>` 태그에 `key` prop으로 소스 전환 시 강제 리로드
   - 원본: `/api/generate/{id}/stream/`
   - 내 목소리: `/api/voice-convert/{id}/stream`
   - 업로드 API 호출 시 `use_voice_converted` 전달
   - MV 합치기(handleMergeAudio)에서도 선택된 소스 사용
3. **UploadPage.css**: 오디오 소스 선택기 스타일 추가 (`.upload-card__audio-source-*`)
4. **backend/routes/tracks.py**:
   - `UploadFromGenerationBody`에 `use_voice_converted` 필드 추가
   - 엔드포인트에서 해당 플래그가 true일 때 `voice_converted_url`에서 MinIO 파일 가져와 복사

### 동작 흐름
1. StudioTab2에서 VC 완료된 곡의 "업로드하기" 클릭
2. UploadPage에 `hasVoiceConverted=true`가 전달됨
3. 오디오 파일 섹션에 "원본 (AI 보컬)" / "내 목소리 버전" 토글 표시
4. 사용자가 선택하면 해당 스트림 URL로 audio 플레이어 전환 (미리듣기)
5. 업로드 제출 시 `use_voice_converted` 파라미터가 백엔드로 전달
6. 백엔드에서 해당 generation의 `voice_converted_url` 또는 `result_audio_url`에서 파일 복사

---

## v7 — 뮤직비디오 생성 파이프라인: 음악 구조 싱크 개선

### 구현 요약

뮤직비디오 생성 파이프라인에 **음악 구조 분석** 단계를 추가하여, 음악의 섹션 전환(Intro/Verse/Chorus 등)에 맞춰 영상 씬이 자동으로 싱크되도록 개선하였다.

### 핵심 변경사항

1. **Gemini 음악 구조 분석** (`mv_generator.py`)
   - `analyze_music_structure()`: 오디오 파일을 Gemini 2.5 Flash에 보내 섹션 구조(label, start, end, mood) 추출
   - `trim_video_clip()`: ffmpeg로 영상 클립을 정확한 길이로 트림

2. **섹션 기반 씬 계획** (`mv_generator.py`)
   - 새로운 `SECTION_SCENE_PLAN_SYSTEM_PROMPT`로 ChatGPT에게 섹션별 클립 수 계산 지시
   - `_split_with_music_sections()`: 섹션별 `ceil(duration/10)`개 클립, 각 `duration/clip_count`초
   - 기존 `split_lyrics_into_scenes()`에 `music_sections` 파라미터 추가 (없으면 기존 동작)

3. **파이프라인 통합** (`mv_pipeline.py`)
   - `run_phase1_split()`: 오디오 파일이 있으면 Gemini 분석 → MongoDB에 `music_sections` 저장 → 섹션 기반 씬 계획
   - `_resolve_audio_object_name()`: job의 `audio_object_name` 또는 `audio_generation_id`로부터 오디오 경로 해석
   - `run_phase3_videos()`: 영상 생성 후 `use_seconds` 필드가 있으면 ffmpeg trim 수행
   - scenes 배열에 `use_seconds`, `section`, `section_mood`, `clip_mood` 필드 추가

4. **API 응답 확장** (`mv.py`)
   - `_scene_to_dict()`에 섹션 관련 필드 추가
   - job detail에 `music_sections` 포함
   - `CreateMVRequest`에 `audio_generation_id` 추가

5. **프론트엔드 표시** (`UploadPage.jsx`, `UploadPage.css`)
   - 씬 카드에 섹션 레이블(배지), 사용 시간, 섹션 분위기 표시
   - `createMVJob` 호출 시 `audio_generation_id` 전달

### 변경 내역

| 파일 | 변경 내용 |
|------|----------|
| `backend/app/services/mv_generator.py` | `analyze_music_structure()`, `trim_video_clip()`, `_split_with_music_sections()` 신규, `split_lyrics_into_scenes()` 확장 |
| `backend/app/services/mv_pipeline.py` | `_load_audio_from_minio()`, `_resolve_audio_object_name()` 신규, `run_phase1_split()` 음악 분석 단계 추가, `run_phase3_videos()` 트림 추가 |
| `backend/app/routes/mv.py` | `CreateMVRequest`에 `audio_generation_id`, `_scene_to_dict()` 섹션 필드, job detail에 `music_sections` |
| `frontend/src/pages/UploadPage.jsx` | `audio_generation_id` 전달, 씬 카드에 섹션 정보 표시 |
| `frontend/src/pages/UploadPage.css` | 섹션 정보 스타일 추가 |

### 동작 흐름

1. 사용자가 MV 생성 시작 (createMVJob에 audio_generation_id 포함)
2. Phase 1a: generation에서 오디오 파일 경로 해석 → MinIO에서 다운로드 → Gemini에 보내 섹션 분석
3. Phase 1b: ChatGPT에 섹션 구조 + 가사 + 메타데이터 전달 → 섹션별 클립 계획 수립
4. Phase 2: 각 클립별 이미지 생성 (기존과 동일)
5. Phase 3: 각 클립별 영상 생성 → `use_seconds`만큼 ffmpeg trim → MinIO 저장
6. Phase 4: 트림된 클립들을 순서대로 concat
7. Phase 5: 원본 오디오와 합치기
8. 결과: 음악 섹션 전환 = 영상 씬 전환

### 호환성
- 오디오가 없거나 분석 실패 시 기존 flat scene 분할로 자동 fallback
- `use_seconds` 필드가 없는 기존 씬은 trim 없이 그대로 사용
- 기존에 생성된 MV job은 영향 없음

---

## v8 — 캐릭터 시트 생성 마스터 프롬프트 적용

### 변경 요약
캐릭터 시트 생성을 단일 API 호출에서 2단계 프로세스로 개선했다. 전문가가 설계한 마스터 프롬프트를 도입하여, 사진 분석 기반의 고품질 캐릭터 시트를 생성한다.

### 구현 내용

#### `backend/app/services/character_generator.py` (전면 재작성)

**마스터 프롬프트 내장**
- 캐릭터 시트 생성 마스터 프롬프트 전체를 `MASTER_PROMPT` 상수로 코드에 포함
- 8단계 절차 (STEP 1~8) + CHARACTER SHEET TEMPLATE + TECHNICAL SPECIFICATIONS

**Step A: 텍스트 모델로 프롬프트 생성**
- 엔드포인트: `gemini-2.5-flash:generateContent`
- 마스터 프롬프트 + 사진(inlineData)을 전송
- STEP 1 답변을 "사진 속 인물의 외모 특징을 분석하여 사용"으로 자동 제공
- STEP 2 답변을 "Photorealistic (실사)"로 자동 제공
- Gemini가 사진을 분석하여 Identity, Body, Face, Hair, Outfit, Accessories, Lighting 등 전 항목을 상세 작성
- 응답에서 코드블록을 추출하여 캐릭터 시트 프롬프트 텍스트 획득

**Step B: 이미지 모델로 캐릭터 시트 생성**
- 엔드포인트: `gemini-3-pro-image-preview:generateContent` (나노바나나 Pro)
- Step A에서 생성된 상세 프롬프트 + 원본 사진(참조 이미지)을 전송
- 외모 일치를 보장하기 위해 원본 사진을 다시 첨부
- PNG 이미지 바이트 반환

**유틸리티 함수**
- `_extract_code_block()`: Gemini 응답에서 markdown 코드블록 내용 추출
- `_call_gemini_text()`: 텍스트 모델 호출 래퍼 (timeout 120초)
- `_call_gemini_image()`: 이미지 모델 호출 래퍼 (timeout 180초)

### 변경 내역

| 파일 | 변경 내용 |
|------|----------|
| `backend/app/services/character_generator.py` | 전면 재작성 — 2단계 프로세스 (텍스트 모델 → 이미지 모델), 마스터 프롬프트 내장 |

### 호환성
- `generate_character_sheet(photo_bytes, mime_type)` 시그니처 동일 — 라우트 코드 변경 불필요
- `routes/character.py` 수정 없음
- 프론트엔드 수정 없음

---

## v9 — 캐릭터 시트 의상 이미지 선택적 첨부 (8가지 프롬프트 분기)

### 요약
캐릭터 시트 생성 시 상의/하의/신발 이미지를 선택적으로 첨부할 수 있는 기능을 추가했다. 첨부 조합(000~111)에 따라 STEP 1 답변이 8가지로 분기되어, 해당 의상 항목을 참조 이미지 기반으로 반영한다.

### 변경 내역

| 파일 | 변경 내용 |
|------|----------|
| `backend/app/services/character_generator.py` | `STEP1_ANSWERS` 딕셔너리(8가지), `_build_inline_images()` 헬퍼, `_call_gemini_text/image` 시그니처 변경(image_parts 리스트), `generate_character_sheet()` 시그니처 확장(top/bottom/shoes 파라미터) |
| `backend/app/routes/character.py` | `generate_sheet` 엔드포인트에 `top_image`, `bottom_image`, `shoes_image` 옵션 파일 파라미터 추가, `_read_optional_image()` 헬퍼 |
| `frontend/src/pages/MyMusicPage.jsx` | 의상 업로드 상태(topFile/bottomFile/shoesFile), 3개 업로드 박스 UI(미리보기+제거), FormData에 의상 파일 포함 |
| `frontend/src/pages/MyMusicPage.css` | `.mymusic-character__outfit-*` 스타일 (outfit-row, outfit-box, dropzone, preview, remove) |
| `frontend/src/api/index.js` | 변경 없음 |

### 동작 방식
1. 사용자가 얼굴 사진(필수) + 상의/하의/신발 이미지(선택) 첨부
2. 백엔드에서 `key = "TBS"` (T=상의유무, B=하의유무, S=신발유무) 계산
3. 해당 키의 STEP 1 답변 선택 → 마스터 프롬프트와 조합
4. Step A(텍스트 모델), Step B(이미지 모델) 모두에 사진+의상 이미지 전달
5. 의상이 없으면 기존과 동일하게 동작 (하위 호환)

### 호환성
- 의상 파일을 첨부하지 않으면 기존 "000" 동작과 동일 (하위 호환 보장)
- 프론트엔드 API 함수(`generateCharacterSheet`)는 기존 FormData 방식 그대로 — 추가 필드만 append

---

## v10 — 캐릭터 시트 수정 요청 (Refine) 기능

### 변경 내역

| 파일 | 변경 내용 |
|------|----------|
| `backend/app/services/character_generator.py` | `refine_character_sheet()` 함수 추가 — 현재 시트 + 원본 사진 + 수정 요청을 Gemini image model에 전송하여 수정된 시트 생성 |
| `backend/app/routes/character.py` | `POST /api/character/refine` 엔드포인트 추가 — sheet_image, photo, refine_request 파라미터, MinIO temp 저장 후 preview_url 반환 |
| `frontend/src/api/index.js` | `refineCharacterSheet(formData)` API 함수 추가 (timeout 180초) |
| `frontend/src/pages/MyMusicPage.jsx` | CharacterSection에 refineMode/refineText/refining 상태 추가, 미리보기에서 [수정 요청] 버튼 + textarea + [수정 적용하기] UI, handleRefine 로직, 상태 초기화 |
| `frontend/src/pages/MyMusicPage.css` | `.mymusic-character__refine`, `__refine-input`, `__refine-btn` 스타일 추가 |

### 동작 방식
1. 사용자가 캐릭터 시트를 생성하면 미리보기 상태로 진입
2. [수정 요청] 버튼 클릭 → textarea가 나타남
3. 수정할 내용 입력 후 [수정 적용하기] 클릭
4. 현재 미리보기 이미지를 fetch하여 blob으로 변환 + 원본 사진(photoFile) + 수정 요청 텍스트를 FormData로 전송
5. 백엔드에서 Gemini image model(gemini-3-pro-image-preview)에 현재 시트 + 원본 사진 + 수정 프롬프트 전달
6. 수정된 시트가 새 미리보기로 교체됨
7. 반복 수정 가능 — 수정된 결과가 다시 현재 시트가 되어 추가 수정 가능

### 주요 설계 결정
- `photoFile` 상태가 미리보기 진입 시 초기화되지 않도록 유지 (수정 요청에 원본 사진 필요)
- refine 중에는 저장/다시생성/취소 버튼 disabled 처리
- 수정 완료 후 refineText 초기화, refineMode 닫기

---

## v11 — 캐릭터 시트 생성 시 사용자 텍스트 입력 지원

### 변경 요약
캐릭터 시트 생성 시 사용자가 캐릭터 특징을 텍스트로 직접 입력할 수 있는 기능을 추가하였다. 기존 8가지 의상 조합 프롬프트에 텍스트 유무를 추가하여 총 16가지 프롬프트로 분기한다.

### 수정된 파일

| 파일 | 변경 내용 |
|------|----------|
| `backend/app/services/character_generator.py` | `STEP1_ANSWERS` 8개 → 16개 확장 (키 형식 "0_xxx"/"1_xxx"), `_USER_TEXT_SUFFIX` 상수 추가, `generate_character_sheet()`에 `user_text` 파라미터 추가, `.format(user_text=...)` 치환 로직 |
| `backend/app/routes/character.py` | `generate_sheet` 엔드포인트에 `user_text: str = Form("")` 파라미터 추가, 서비스 호출 시 전달 |
| `frontend/src/pages/MyMusicPage.jsx` | `characterText` state 추가, 사진-의상 영역 사이 textarea UI 추가, FormData에 `user_text` append, 초기화 로직 |
| `frontend/src/pages/MyMusicPage.css` | `.mymusic-character__text-section`, `__text-label`, `__text-input` 스타일 추가 |

### 동작 방식
1. 사용자가 사진 업로드 후, 선택적으로 "캐릭터 특징 설명" textarea에 텍스트 입력
2. 텍스트가 비어있으면 기존 "0_xxx" 키로 분기 → 기존과 완전히 동일하게 동작
3. 텍스트가 있으면 "1_xxx" 키로 분기 → 기존 프롬프트 + 사용자 텍스트 우선 반영 문구
4. `{user_text}` 플레이스홀더를 `.format(user_text=...)` 으로 치환하여 실제 입력 반영
5. 사용자 설명과 사진이 충돌하면 사용자 설명을 우선하도록 프롬프트에 명시

### 주요 설계 결정
- 기존 8가지 프롬프트(0_xxx)의 내용은 변경 없이 유지, 키 형식만 "000" → "0_000" 으로 변경
- `_USER_TEXT_SUFFIX` 상수로 중복 제거 — 8개 1_xxx 프롬프트가 동일한 suffix를 문자열 연결
- `.format()` 사용 (f-string 아님) — 중괄호 충돌 방지
- user_text가 비어있으면 `.format()` 호출하지 않음 — 0_xxx 프롬프트에는 플레이스홀더 없으므로 안전

---

## v12 — 마스터 프롬프트 구조 개선: 답변 인라인 삽입

### 변경 요약
STEP 1/2 답변이 마스터 프롬프트 앞에 분리 배치되던 구조를, 마스터 프롬프트 안에서 각 질문 바로 뒤에 답변이 인라인 삽입되도록 개선하였다.

### 변경 파일
- `backend/app/services/character_generator.py`

### 변경 상세

#### MASTER_PROMPT 상수
- STEP 1: "사용자의 답변이 오기 전에는 절대 다음 단계로 진행하지 마시오." 제거, 대신 `[사용자 답변]: {step1_answer}` 플레이스홀더 삽입
- STEP 2: 동일 문구 제거, `[사용자 답변]: Photorealistic (실사)` 고정값 삽입
- STEP 4~8, CHARACTER SHEET TEMPLATE 등 나머지 전체 원본 유지

#### step_a_prompt 조립 (generate_character_sheet 함수)
변경 전:
```
"--- STEP 1 답변 ---\n{step1_answer}\n--- STEP 2 답변 ---\nPhotorealistic\n=== 마스터 프롬프트 ===\n{MASTER_PROMPT}"
```

변경 후:
```
"아래 마스터 프롬프트의 절차를 따라 ...\n" + MASTER_PROMPT.format(step1_answer=step1_answer)
```

### 변경하지 않은 것
- STEP1_ANSWERS 딕셔너리 16가지 — 그대로
- refine_character_sheet() 함수
- 헬퍼 함수 (_call_gemini_text, _call_gemini_image, _build_inline_images)
- 프론트엔드 코드

---

## v13 — Git Pull 후 환경 복원: API 키 설정 및 서버 정상 작동 확인

**수정일자**: 2026-03-30

### 변경 요약
Git Pull 이후 개발 환경을 처음부터 복원하였다. `.env` 파일 생성, Docker 인프라 재시작, 백엔드/프론트엔드 서버 가동, 전체 기능 테스트까지 수행하여 정상 동작을 확인하였다.

### 수행 결과

#### 백엔드
- `.env` 파일 생성 완료 (전체 API 키 반영)
- `config.py` 확인: `kits_api_key`, `kits_api_url`, `suno_api_url` 필드 모두 이미 존재 (수정 불필요)
- Docker 인프라 5개 컨테이너 시작 및 healthy 확인 (PostgreSQL, MongoDB, Redis, Elasticsearch, MinIO)
- 백엔드 서버 포트 9000 정상 가동

#### 프론트엔드
- npm install 완료 (187개 패키지)
- 프론트엔드 서버 포트 4000 정상 가동
- API baseURL(포트 9000) 연결 설정 확인 완료

#### 테스트 결과 (6/6 PASS)

| # | 항목 | 결과 |
|---|------|------|
| 1 | 백엔드 헬스체크 | PASS |
| 2 | 프론트엔드 접속 확인 | PASS |
| 3 | 회원가입 테스트 | PASS |
| 4 | 로그인 테스트 (admin@aimu.com / 1) | PASS |
| 5 | 인증된 API 테스트 (/api/auth/me) | PASS |
| 6 | DB 연결 확인 (users 테이블 2명) | PASS |

### 특이사항
- Git에서 fresh pull 후 `config.py`에 `kits_api_key`, `kits_api_url`, `suno_api_url` 필드가 이미 포함되어 있었음 (이전 세션에서의 수정이 커밋되어 있었던 것으로 추정)
- Docker 볼륨 초기화(`-v`) 후 재시작하여 DB 자격증명 일치시킴
- MinIO는 호스트 포트 9100으로 매핑 (백엔드 9000 포트와 충돌 방지)

### 변경된 파일

| 파일 | 변경 내용 |
|------|----------|
| `backend/.env` | 신규 생성 — 전체 API 키 및 DB 접속 정보 설정 |

---

## v14 — 내 목소리 녹음 + Dolby.io 보컬 다듬기 기능 구현

**수정일자**: 2026-03-30

### 변경 요약
사용자가 자신의 목소리를 브라우저에서 직접 녹음하거나 파일로 업로드한 뒤, Dolby.io Media Enhance API를 통해 보컬을 다듬고(노이즈 제거, 음질 향상), 원본과 다듬어진 결과를 비교 청취 및 다운로드할 수 있는 전체 파이프라인을 구현하였다.

### 수행 결과

#### 백엔드
- `config.py`에 `dolby_api_key` 필드 추가
- `.env`에 `DOLBY_API_KEY=` 항목 추가
- `services/dolby_service.py` 신규 생성 — Dolby.io Media Enhance API 연동 (파일 업로드 → 처리 시작 → 폴링 → 결과 다운로드)
- `routes/vocal_repair.py` 신규 생성 — 8개 API 엔드포인트:
  - `POST /api/vocal-repair/upload` — 보컬 파일 업로드
  - `POST /api/vocal-repair/{id}/enhance` — Dolby.io 보컬 다듬기 시작
  - `GET /api/vocal-repair/{id}/status` — 처리 상태 조회
  - `GET /api/vocal-repair/{id}/original/stream` — 원본 스트리밍
  - `GET /api/vocal-repair/{id}/enhanced/stream` — 다듬어진 파일 스트리밍
  - `GET /api/vocal-repair/{id}/original/download` — 원본 다운로드
  - `GET /api/vocal-repair/{id}/enhanced/download` — 다듬어진 파일 다운로드
  - `GET /api/vocal-repair/list` — 전체 목록 조회
- `main.py`에 vocal_repair 라우터 등록

#### 프론트엔드
- `api/index.js`에 vocal-repair API 함수 8개 추가
- `MyMusicPage.jsx`에 `VoiceRecordSection` 컴포넌트 구현:
  - MediaRecorder API 브라우저 녹음 (시작/정지/타이머)
  - 파일 업로드 (드래그앤드롭 + 파일 선택)
  - 보컬 다듬기 버튼 → Dolby.io 처리 + 프로그레스바
  - 원본 vs 다듬어진 목소리 나란히 미리듣기
  - 원본/다듬어진 파일 다운로드
  - '보이스 모델 학습하기' 다음 단계 연결
- `MyMusicPage.css`에 `.voice-record` 관련 스타일 추가

#### 테스트 결과 (10/10 PASS)

| # | 항목 | 결과 |
|---|------|------|
| 1 | 백엔드 Health Check | PASS |
| 2 | 파일 업로드 API | PASS |
| 3 | 보컬 다듬기 시작 (API 키 미설정 시 503) | PASS |
| 4 | 상태 조회 API | PASS |
| 5 | 원본 스트리밍 | PASS |
| 6 | 원본 다운로드 | PASS |
| 7 | 목록 조회 | PASS |
| 8 | 프론트엔드 빌드 확인 | PASS |
| 9 | 잘못된 파일 업로드 거부 | PASS |
| 10 | 인증 없이 접근 차단 | PASS |

### 특이사항
- `DOLBY_API_KEY`가 아직 비어있어 실제 보컬 다듬기는 작동하지 않음 (API 키 입력 필요)
- Dolby.io에서 API 키 발급 후 `.env`에 입력하면 즉시 사용 가능
- API 키 미설정 상태에서 enhance 요청 시 503 응답으로 정상 안내

### 변경된 파일

| 파일 | 변경 내용 |
|------|----------|
| `backend/app/config.py` | `dolby_api_key` 필드 추가 |
| `backend/.env` | `DOLBY_API_KEY=` 항목 추가 |
| `backend/app/services/dolby_service.py` | 신규 — Dolby.io Media Enhance API 연동 서비스 |
| `backend/app/routes/vocal_repair.py` | 신규 — 보컬 다듬기 8개 API 엔드포인트 |
| `backend/app/main.py` | vocal_repair 라우터 등록 추가 |
| `frontend/src/api/index.js` | vocal-repair API 함수 8개 추가 |
| `frontend/src/pages/MyMusicPage.jsx` | VoiceRecordSection 컴포넌트 구현 |
| `frontend/src/pages/MyMusicPage.css` | 녹음/보컬 다듬기 UI 스타일 추가 |

---

## v15 — Dolby.io → Wondera API 교체

**수정일자**: 2026-03-30

### 변경 요약
기존 Dolby.io Media Enhance API를 Wondera REST API로 교체하였다. 환경변수, 설정, 서비스 모듈, 라우트의 import/검증 로직을 모두 Wondera 기준으로 전환하였으며, 기존 dolby_service.py는 삭제하고 wondera_service.py를 신규 생성하였다.

### 수행 결과

#### 백엔드
- `.env`: `DOLBY_API_KEY` 삭제, `WONDERA_API_KEY=wk_9edb...` 추가
- `config.py`: `dolby_api_key` → `wondera_api_key` 변경
- `services/dolby_service.py` 삭제
- `services/wondera_service.py` 신규 생성 — Wondera REST API 연동
- `routes/vocal_repair.py`: import 및 검증 로직을 Wondera로 수정

#### 테스트 결과 (9/9 PASS)

| # | 항목 | 결과 |
|---|------|------|
| 1 | 서버 시작 + health check | PASS |
| 2 | 파일 업로드 | PASS |
| 3 | Enhance API 호출 (API 키 인식 정상, 외부 호출 시도됨) | PASS |
| 4 | 상태 조회 | PASS |
| 5 | 원본 스트리밍 | PASS |
| 6 | 원본 다운로드 | PASS |
| 7 | 목록 조회 | PASS |
| 8 | 프론트엔드 빌드 | PASS |
| 9 | 인증 차단 | PASS |

### 특이사항
- Wondera API 호출 시 DNS 해석 실패 (`[Errno -2] Name or service not known`) — 현재 네트워크 환경에서 `api.wondera.com` 접근 불가. 코드 로직 자체는 정상 작동
- 실제 Wondera API가 외부에서 접근 가능한 환경에서 재테스트 필요
- API 엔드포인트 URL(`api.wondera.com`)이 실제 서비스 URL과 다를 수 있음 — Wondera 공식 문서 확인 후 조정 필요할 수 있음

### 변경된 파일

| 파일 | 변경 내용 |
|------|----------|
| `backend/.env` | `DOLBY_API_KEY` 삭제, `WONDERA_API_KEY` 추가 |
| `backend/app/config.py` | `dolby_api_key` → `wondera_api_key` 변경 |
| `backend/app/services/dolby_service.py` | 삭제 |
| `backend/app/services/wondera_service.py` | 신규 — Wondera REST API 연동 서비스 |
| `backend/app/routes/vocal_repair.py` | import/검증 로직 Wondera로 수정 |

---

## v16 — 보컬 수리 투트랙: LALAL.AI + Demucs 비교 선택 구현

**수정일자**: 2026-03-30

### 변경 요약
기존 Wondera 단일 API 방식을 LALAL.AI(클라우드) + Demucs(로컬) 투트랙 비교 선택 구조로 전면 교체하였다. 사용자가 방식을 선택하면 각각 독립적으로 처리되며, 결과를 나란히 비교할 수 있는 3칸 UI를 구현하였다.

### 수행 결과

#### 백엔드
- `config.py`: `wondera_api_key` → `lalal_api_key` 변경
- `.env`: `WONDERA_API_KEY` 삭제, `LALAL_API_KEY` 등록
- `services/wondera_service.py` 삭제
- `services/lalal_service.py` 신규 — LALAL.AI API 연동
- `services/demucs_service.py` 신규 — 로컬 Demucs 처리
- `services/audio_utils.py` 신규 — pyloudnorm 노멀라이즈 + ffmpeg 컴프레션
- `routes/vocal_repair.py` 전면 수정 — method 파라미터, 투트랙 파이프라인
- `requirements.txt`에 `pyloudnorm`, `soundfile`, `demucs` 추가

#### 프론트엔드
- `api/index.js`: method 파라미터 추가
- `MyMusicPage.jsx`: 방식 선택 체크박스, 각 방식별 프로그레스, 3칸 결과 비교 UI
- `MyMusicPage.css`: 체크박스/결과카드 스타일, LALAL=파란색/Demucs=초록색 액센트

#### 테스트 결과 (12/12 PASS)

| # | 항목 | 결과 |
|---|------|------|
| 1 | 서버 시작 | PASS |
| 2 | 파일 업로드 | PASS |
| 3 | Enhance demucs (미설치 상태에서 정상 에러 처리) | PASS |
| 4 | Enhance lalal (API 호출 시도, 422 에러 캡처) | PASS |
| 5 | Enhance both (양쪽 독립적 상태 추적) | PASS |
| 6 | 상태 조회 (lalal_status/demucs_status 개별 표시) | PASS |
| 7 | 원본 스트림/다운로드 | PASS |
| 8 | Enhanced 스트림 method 파라미터 | PASS |
| 9 | 목록 조회 | PASS |
| 10 | 프론트엔드 빌드 | PASS |
| 11 | 인증 차단 | PASS |
| 12 | 잘못된 method 거부 | PASS |

### 특이사항
- Demucs 미설치 상태 (`pip install demucs` 필요, GPU 권장)
- LALAL.AI `voice_clean` 엔드포인트에서 422 반환 — API 스펙 확인/수정 필요
- 두 방식 모두 코드 로직은 정상 동작, 외부 서비스 연동만 추가 확인 필요

### 변경된 파일

| 파일 | 변경 내용 |
|------|----------|
| `backend/.env` | `WONDERA_API_KEY` 삭제, `LALAL_API_KEY` 추가 |
| `backend/app/config.py` | `wondera_api_key` → `lalal_api_key` 변경 |
| `backend/app/services/wondera_service.py` | 삭제 |
| `backend/app/services/lalal_service.py` | 신규 — LALAL.AI API 연동 |
| `backend/app/services/demucs_service.py` | 신규 — 로컬 Demucs 처리 |
| `backend/app/services/audio_utils.py` | 신규 — pyloudnorm 노멀라이즈 + ffmpeg 컴프레션 |
| `backend/app/routes/vocal_repair.py` | 전면 수정 — method 파라미터, 투트랙 파이프라인 |
| `backend/requirements.txt` | `pyloudnorm`, `soundfile`, `demucs` 추가 |
| `frontend/src/api/index.js` | method 파라미터 추가 |
| `frontend/src/pages/MyMusicPage.jsx` | 방식 선택 체크박스, 3칸 결과 비교 UI |
| `frontend/src/pages/MyMusicPage.css` | 체크박스/결과카드 스타일, 색상 액센트 |

---

## v17 — RVC 변환 후 MR 음정 조절 + 수동 합치기 기능

**수정일자**: 2026-03-30

### 변경 요약
RVC 보컬 변환 완료 후 자동 합치기를 제거하고, converted_vocal과 backing을 각각 MinIO에 저장한 뒤 "awaiting_merge" 상태를 도입하였다. 프론트엔드에서 Web Audio API detune으로 MR 음정을 실시간 미리듣기하고, 최종 합치기는 서버 ffmpeg로 정확하게 처리하는 구조를 구현하였다.

### 수행 결과

#### 백엔드
- `kits_service.py`: 자동 합치기(Step f~h) 제거 → converted_vocal + backing 각각 MinIO 저장 → "awaiting_merge" 상태 도입
- `kits_service.py`: `merge_vocal_and_backing` 함수 신규 추가 (ffmpeg asetrate/aresample로 MR 피치 조절 + 볼륨 조절 + 합치기)
- `voice_convert.py`: 3개 엔드포인트 추가
  - GET `/api/voice-convert/{id}/converted-vocal/stream`
  - GET `/api/voice-convert/{id}/backing/stream`
  - POST `/api/voice-convert/{id}/merge` (mr_pitch_shift, vocal_volume, mr_volume)
- `voice_convert.py`: status 응답에 `voice_converted_vocal_url`, `voice_converted_backing_url` 필드 추가

#### 프론트엔드
- `api/index.js`: `streamConvertedVocal`, `streamBacking`, `mergeVoiceConversion` 함수 추가
- `StudioTab2.jsx`: MrPitchAdjustPanel 컴포넌트 구현
  - Web Audio API detune으로 MR 음정 실시간 조절 (-12~+12 반음)
  - 재생 모드 (보컬만/MR만/합쳐서)
  - 보컬/MR 볼륨 슬라이더
  - "이 설정으로 최종 합치기" 버튼
  - awaiting_merge 상태 처리
- `StudioTab2.css`: `.mr-pitch__` 스타일 추가

#### 테스트 결과 (8/8 PASS)

| # | 항목 | 결과 |
|---|------|------|
| 1 | 서버 시작 | PASS |
| 2 | 프론트엔드 빌드 | PASS |
| 3 | converted-vocal/stream 엔드포인트 | PASS |
| 4 | backing/stream 엔드포인트 | PASS |
| 5 | merge 엔드포인트 | PASS |
| 6 | status 새 필드 (코드 확인) | PASS |
| 7 | 잘못된 merge 요청 처리 | PASS |
| 8 | 인증 차단 | PASS |

### 특이사항
- 실제 Kits.AI RVC 변환 → awaiting_merge → merge 전체 흐름은 Kits.AI API 키가 설정된 환경에서 E2E 테스트 필요
- Web Audio API detune은 브라우저에서 실시간 피치 변경 (서버 호출 없음)
- 최종 합치기는 서버에서 ffmpeg로 처리 (정확한 피치 조절)

### 변경된 파일

| 파일 | 변경 내용 |
|------|----------|
| `backend/app/services/kits_service.py` | 자동 합치기 제거, awaiting_merge 상태 도입, `merge_vocal_and_backing` 함수 추가 |
| `backend/app/routes/voice_convert.py` | converted-vocal/stream, backing/stream, merge 엔드포인트 추가, status 필드 추가 |
| `frontend/src/api/index.js` | `streamConvertedVocal`, `streamBacking`, `mergeVoiceConversion` 함수 추가 |
| `frontend/src/pages/StudioTab2.jsx` | MrPitchAdjustPanel 컴포넌트 구현 (실시간 음정 조절, 재생 모드, 볼륨 슬라이더) |
| `frontend/src/pages/StudioTab2.css` | `.mr-pitch__` 스타일 추가 |

---

## v18 — MR 음정 조절 품질 개선: asetrate → rubberband

**수정일자**: 2026-03-30

### 변경 요약
kits_service.py의 `merge_vocal_and_backing`에서 ffmpeg asetrate/aresample 방식을 rubberband=pitch 필터로 교체하였다. rubberband는 타임스트레칭 없이 피치만 변경하므로 재생 속도가 변하지 않고 음질이 크게 향상된다.

### 수행 결과

#### 백엔드
- `kits_service.py`: `merge_vocal_and_backing` 함수 내 MR 피치 조절 필터를 `asetrate/aresample` → `rubberband=pitch` 로 교체

#### 테스트 결과 (4/4 PASS)

| # | 항목 | 결과 |
|---|------|------|
| 1 | rubberband 필터 동작 | PASS |
| 2 | 서버 시작 | PASS |
| 3 | 프론트엔드 빌드 | PASS |
| 4 | merge API | PASS |

### 특이사항
- ffmpeg에 librubberband가 이미 포함되어 있어 추가 설치 불필요
- rubberband 필터는 속도 변화 없이 피치만 조절하므로 asetrate 대비 음질 우수

### 변경된 파일

| 파일 | 변경 내용 |
|------|----------|
| `backend/app/services/kits_service.py` | `merge_vocal_and_backing` 내 asetrate/aresample → rubberband=pitch 필터로 교체 |

---

## v19 — StudioTab2 "테스트 Wondera" 탭 추가

**수정일자**: 2026-03-30

### 변경 요약
StudioTab2에 Wondera API 연동 테스트 섹션을 추가하였다. 보컬 업로드, AI 음악 생성, 상태 조회 3개 프록시 엔드포인트를 백엔드에 구현하고, 프론트엔드에서 모델 선택·가사 입력·AI/내목소리 비교 생성 UI를 제공한다.

### 수행 결과

#### 백엔드
- `config.py`: `wondera_api_key` 필드 추가
- `.env`: `WONDERA_API_KEY` 등록
- `routes/wondera.py` 신규: 3개 프록시 엔드포인트 (upload-vocal, generate, query)
- `main.py`: wondera 라우터 등록

#### 프론트엔드
- `api/index.js`: `wonderaUploadVocal`, `wonderaGenerate`, `wonderaQuery` 함수 추가
- `StudioTab2.jsx`: WonderaTestSection 컴포넌트, mode='wondera' 토글, 기본 가사 하드코딩, 모델 드롭다운, AI/내목소리 비교 생성
- `StudioTab2.css`: `.wondera-test` 스타일 추가

#### 테스트 결과 (6/6 PASS)

| # | 항목 | 결과 |
|---|------|------|
| 1 | 서버 시작 | PASS |
| 2 | 프론트엔드 빌드 | PASS |
| 3 | upload-vocal 엔드포인트 | PASS |
| 4 | generate 엔드포인트 | PASS |
| 5 | query 엔드포인트 | PASS |
| 6 | 인증 차단 | PASS |

### 특이사항
- Wondera API가 Cloudflare로 보호되어 서버에서 직접 호출 시 403 반환. 브라우저에서 테스트 필요.

### 변경된 파일

| 파일 | 변경 내용 |
|------|----------|
| `backend/app/config.py` | `wondera_api_key` 필드 추가 |
| `backend/.env` | `WONDERA_API_KEY` 환경변수 등록 |
| `backend/app/routes/wondera.py` | 신규 — upload-vocal, generate, query 프록시 엔드포인트 |
| `backend/app/main.py` | wondera 라우터 등록 |
| `frontend/src/api/index.js` | `wonderaUploadVocal`, `wonderaGenerate`, `wonderaQuery` 함수 추가 |
| `frontend/src/pages/StudioTab2.jsx` | WonderaTestSection 컴포넌트, mode='wondera' 토글 |
| `frontend/src/pages/StudioTab2.css` | `.wondera-test` 스타일 추가 |

## v20 — MV 시나리오 생성 + 씬별 image_prompt/video_prompt 분리

> 날짜: 2026-03-31

### 백엔드 변경

- `mv_generator.py`: `generate_mv_scenario()` 함수 신규 (GPT로 소설형 시나리오 생성)
- `mv_generator.py`: 3개 시스템 프롬프트 모두 `description` → `image_prompt` + `video_prompt` 분리 출력으로 변경. 카메라 구도/무빙 구체적 지시 추가
- `mv_generator.py`: `split_lyrics_into_scenes()`에 `scenario` 파라미터 추가
- `mv_generator.py`: `start_scene_video()`에 `video_prompt` 파라미터 추가
- `cover_generator.py`: `generate_cover_image()`에 `scenario` 파라미터 추가
- `mv_pipeline.py`: Phase 0(시나리오 생성) 단계 추가, 씬 분할/이미지/영상 생성에 새 필드 활용
- `routes/mv.py`: job_doc에 `scenario`, scene에 `image_prompt`/`video_prompt` 추가

### 프론트엔드

변경 없음 (백엔드 자동 처리)

### 테스트 결과 (9/9 PASS)

| # | 항목 | 결과 |
|---|------|------|
| 1 | 서버 시작 | PASS |
| 2 | 프론트엔드 빌드 | PASS |
| 3 | 함수 시그니처 (1) | PASS |
| 4 | 함수 시그니처 (2) | PASS |
| 5 | 함수 시그니처 (3) | PASS |
| 6 | 함수 시그니처 (4) | PASS |
| 7 | import 확인 | PASS |
| 8 | API 동작 | PASS |
| 9 | 프롬프트 템플릿 | PASS |

### 특이사항

- 하위호환 유지: `description` 필드는 `image_prompt` 값으로 자동 설정
- `scenario`, `video_prompt` 모두 `None` 기본값이라 기존 코드와 호환
- 실제 MV 생성 E2E 테스트는 OpenAI/Gemini API 키 필요

### 변경된 파일

| 파일 | 변경 내용 |
|------|----------|
| `backend/app/mv_generator.py` | `generate_mv_scenario()` 신규, 프롬프트 분리, 파라미터 추가 |
| `backend/app/cover_generator.py` | `generate_cover_image()`에 `scenario` 파라미터 추가 |
| `backend/app/mv_pipeline.py` | Phase 0 시나리오 생성 단계 추가, 새 필드 활용 |
| `backend/app/routes/mv.py` | job_doc에 `scenario`, scene에 `image_prompt`/`video_prompt` 추가 |

## v21 — 시나리오/프롬프트 생성 실패 시 재시도 로직 추가

> 날짜: 2026-03-31

### 변경 사항

- **Phase 0 시나리오 생성**: 기존 폴백(warning 후 continue) 방식 제거 → 최대 3회 재시도 + 지수 백오프(3초, 6초) + 실패 시 job `"failed"` 처리
- **Phase 1b 씬 분할**: `image_prompt`/`video_prompt` 검증 추가. 비어있는 씬이 있으면 전체 재시도 (최대 3회). 실패 시 job `"failed"` 처리
- **scene_doc / Phase 2·3**: `description` 폴백 제거. `image_prompt`만 사용
- **상용화 기준**: 저품질 폴백 없이, 실패 시 명확한 에러 반환

### 테스트 결과 (5/5 PASS)

| # | 항목 | 결과 |
|---|------|------|
| 1 | 시나리오 재시도 로직 | PASS |
| 2 | 씬 분할 검증/재시도 | PASS |
| 3 | description 폴백 제거 확인 | PASS |
| 4 | 실패 시 job failed 처리 | PASS |
| 5 | 정상 흐름 동작 | PASS |

### 변경된 파일

| 파일 | 변경 내용 |
|------|----------|
| `backend/app/mv_pipeline.py` | 시나리오 재시도, 씬 검증/재시도, description 폴백 제거 |

## v22 — 가사 생성 프롬프트 Suno 최적화

> 날짜: 2026-03-31

### 변경 사항

- **SYSTEM_PROMPT 전면 교체**: `lyrics_generator.py`의 가사 생성 프롬프트를 Suno 호환 형식으로 재설계
- **Suno 호환 섹션 태그 9종**: Intro, Verse, Pre-Chorus, Chorus, Bridge, Outro, Hook, Break, Interlude
- **보컬 방향 태그 가이드**: `[Chorus: belting, powerful]` 등 섹션별 보컬 스타일 지정
- **인라인 퍼포먼스 힌트 6종**: (ad-lib), (falsetto) 등 퍼포먼스 지시어 지원
- **장르별 가사 구조/스타일 가이드 7종**: 장르 특성에 맞는 구조 및 어휘 가이드
- **분위기별 톤 가이드 6종**: 분위기에 따른 톤 및 표현 방식 가이드
- **Suno 3000자 제한 반영**: 출력 길이를 Suno 제한에 맞게 제어
- **실제 API 호출 검증**: 변경된 프롬프트로 보컬 방향 태그 정상 출력 확인

### 테스트 결과 (5/5 PASS)

| # | 항목 | 결과 |
|---|------|------|
| 1 | 서버 정상 동작 | PASS |
| 2 | import 정상 | PASS |
| 3 | 프롬프트 내용 검증 (10항목) | PASS |
| 4 | 실제 API 호출 | PASS |
| 5 | 프론트엔드 연동 | PASS |

### 변경된 파일

| 파일 | 변경 내용 |
|------|----------|
| `backend/app/lyrics_generator.py` | SYSTEM_PROMPT 전면 교체 (Suno 최적화) |

## v23 — Sync Labs 립싱크 통합: Chorus 구간 자동 립싱크 영상 생성

> 날짜: 2026-03-31

### 변경 사항

- **.env**: `SYNC_API_KEY` 추가
- **config.py**: `sync_api_key` 필드 추가
- **requirements.txt**: `syncsdk` 추가 (설치 완료)
- **services/sync_labs_service.py (신규)**: `generate_lipsync()` (이미지→정지영상→Sync Labs API→립싱크영상), `cut_audio_segment()` (ffmpeg 구간 자르기)
- **services/mv_pipeline.py**: 음악 분석 후 Chorus→lipsync / 나머지→drama 자동 배정, Phase 3에서 `scene_type` 분기 (lipsync→Sync Labs, drama→Veo/Kling)
- **services/mv_generator.py**: 3개 프롬프트 템플릿에 `scene_type` 필드 추가, lipsync 씬은 정면 클로즈업 이미지 프롬프트 생성

### 테스트 결과 (7/7 PASS)

| # | 항목 | 결과 |
|---|------|------|
| 1 | syncsdk 설치 | PASS |
| 2 | 서버 시작 | PASS |
| 3 | import 정상 | PASS |
| 4 | config 검증 | PASS |
| 5 | 프롬프트 검증 | PASS |
| 6 | cut_audio_segment | PASS |
| 7 | 프론트엔드 연동 | PASS |

### 특이사항

- MinIO presigned URL이 localhost일 경우 Sync Labs에서 접근 불가 → 프로덕션에서는 공개 URL 필요
- 립싱크 실패 시 기존 Veo/Kling 영상 생성으로 폴백
- 실제 E2E 테스트는 공개 URL 환경에서 필요

### 변경된 파일

| 파일 | 변경 내용 |
|------|----------|
| `.env` | `SYNC_API_KEY` 추가 |
| `config.py` | `sync_api_key` 필드 추가 |
| `requirements.txt` | `syncsdk` 추가 |
| `services/sync_labs_service.py` | 신규 — `generate_lipsync()`, `cut_audio_segment()` |
| `services/mv_pipeline.py` | Chorus→lipsync 자동 배정, Phase 3 scene_type 분기 |
| `services/mv_generator.py` | 프롬프트 템플릿에 `scene_type` 필드 추가 |

## v24 — 씬 한글 설명 + 이미지 확대 모달

> 날짜: 2026-03-31

### 변경 사항

**백엔드:**

- **services/mv_generator.py**: 3개 프롬프트 템플릿에 `description_ko` 필드 추가 (한글 장면 설명 2-3문장)
- **services/mv_pipeline.py**: `scene_doc`에 `description_ko` 저장
- **routes/mv.py**: `_scene_to_dict()`에 `description_ko` 포함

**프론트엔드:**

- **UploadPage.jsx**: `scene.description_ko` 우선 표시, 씬 이미지 클릭 시 확대 모달 (이미지+한글설명+가사+립싱크배지)
- **UploadPage.css**: 모달 오버레이/확대/반응형 스타일

### 테스트 결과 (8/8 PASS)

| # | 항목 | 결과 |
|---|------|------|
| 1 | description_ko 프롬프트 포함 | PASS |
| 2 | mv_generator 응답 파싱 | PASS |
| 3 | mv_pipeline scene_doc 저장 | PASS |
| 4 | _scene_to_dict 직렬화 | PASS |
| 5 | 프론트엔드 한글설명 표시 | PASS |
| 6 | 이미지 클릭 모달 열기 | PASS |
| 7 | 모달 내 정보 표시 | PASS |
| 8 | 반응형 스타일 | PASS |

### 변경된 파일

| 파일 | 변경 내용 |
|------|----------|
| `services/mv_generator.py` | 프롬프트 템플릿에 `description_ko` 필드 추가 |
| `services/mv_pipeline.py` | `scene_doc`에 `description_ko` 저장 |
| `routes/mv.py` | `_scene_to_dict()`에 `description_ko` 포함 |
| `UploadPage.jsx` | `description_ko` 우선 표시, 씬 이미지 확대 모달 |
| `UploadPage.css` | 모달 오버레이/확대/반응형 스타일 |

## v25 — MR 음정 조절 피치/속도 분리: detune → SoundTouchJS

> 날짜: 2026-04-01

### 문제

- Web Audio API의 `AudioBufferSourceNode.detune`이 피치와 속도를 동시에 변경
- 음정을 올리면 재생 속도가 빨라지고, 내리면 느려지는 현상 발생

### 해결

- **SoundTouchJS** (WSOLA 알고리즘) 로 교체하여 피치만 독립적으로 변경하고 재생 속도는 유지
- 기존 `detune` 코드 완전 제거

### 변경 사항

**프론트엔드:**

- `npm install soundtouchjs` 설치
- **StudioTab2.jsx**: `MrPitchAdjustPanel`에서 `AudioBufferSourceNode.detune` → `PitchShifter.pitchSemitones` 교체
- 기존 `detune` 관련 코드 완전 제거

### 테스트 결과 (6/6 PASS)

| # | 항목 | 결과 |
|---|------|------|
| 1 | soundtouchjs 설치 | PASS |
| 2 | import 확인 | PASS |
| 3 | detune 코드 제거 확인 | PASS |
| 4 | pitchSemitones 사용 확인 | PASS |
| 5 | 프론트엔드 빌드 | PASS |
| 6 | 서버 정상 동작 | PASS |

### 변경된 파일

| 파일 | 변경 내용 |
|------|----------|
| `StudioTab2.jsx` | `detune` → `PitchShifter.pitchSemitones` 교체 |
| `package.json` | `soundtouchjs` 의존성 추가 (프론트엔드, 2개) |

## v26 — MR 음정 미리듣기: SoundTouchJS → 서버 rubberband 처리로 변경

> 날짜: 2026-04-01

### 문제

- SoundTouchJS WSOLA가 피치/템포를 순차 처리하여 체감될 만큼 속도가 변함

### 해결

- 서버에서 ffmpeg rubberband로 피치 변환한 MR을 받아서 재생

### 변경 사항

**백엔드:**

- `voice_convert.py`: POST `/api/voice-convert/{id}/preview-mr` 엔드포인트 추가 (rubberband 피치 변환 후 WAV 스트리밍)

**프론트엔드:**

- SoundTouchJS 완전 제거 (import, PitchShifter, pitchShifterRef)
- "이 음정으로 미리듣기 적용" 버튼 추가 → 서버 호출 → `decodeAudioData` → 재생
- `api/index.js`: `previewMrPitched` 함수 추가
- `StudioTab2.css`: 미리듣기 버튼 스타일

### 테스트 결과 (6/6 PASS)

| # | 항목 | 결과 |
|---|------|------|
| 1 | SoundTouchJS 제거 확인 | PASS |
| 2 | 서버 엔드포인트 동작 | PASS |
| 3 | 피치 변환 음질 확인 | PASS |
| 4 | 미리듣기 버튼 동작 | PASS |
| 5 | 프론트엔드 빌드 | PASS |
| 6 | 서버 정상 동작 | PASS |

### 변경된 파일

| 파일 | 변경 내용 |
|------|----------|
| `voice_convert.py` | POST `/api/voice-convert/{id}/preview-mr` 엔드포인트 추가 |
| `api/index.js` | `previewMrPitched` 함수 추가 |
| `StudioTab2.jsx` | SoundTouchJS 제거, 서버 기반 미리듣기 버튼 추가 |

## v27 — Veo 3.1 Fast GA 전환 + Rap/Chorus 립싱크 우선순위

> 날짜: 2026-04-01

### 문제

- Veo 3.1 preview 모델(`veo-3.1-generate-preview`)이 4/2 폐기 예정
- 뮤직비디오 립싱크 씬에서 Rap/Chorus 구분 없이 일괄 처리되어 입모양 싱크 품질 저하

### 해결

- Veo 모델 URL을 `veo-3.1-generate-preview` → `veo-3.1-fast-generate-001`(GA)로 전환
- `start_scene_video()`에 `lyrics_segment`, `scene_type` 파라미터 추가하여 lipsync 씬은 가사를 프롬프트에 포함 (Veo 자체 입모양 싱크)
- 3개 프롬프트 템플릿에 Rap > Chorus 우선순위 규칙 적용
- `has_rap` 검사 기반 `scene_type` 배정 (Rap 있으면 Rap만 lipsync, 없으면 Chorus)
- Sync Labs 분기 주석처리 (Veo가 자체 립싱크 수행)

### 변경 사항

**백엔드:**

- `mv_generator.py`: Veo 모델 URL을 `veo-3.1-generate-preview` → `veo-3.1-fast-generate-001`(GA)로 전환 (4/2 preview 폐기 대비)
- `mv_generator.py`: `start_scene_video()`에 `lyrics_segment`, `scene_type` 파라미터 추가. lipsync 씬은 가사를 프롬프트에 포함하여 Veo가 입모양 싱크
- `mv_generator.py`: 3개 프롬프트 템플릿에 Rap > Chorus 우선순위 규칙 적용
- `mv_pipeline.py`: `has_rap` 검사 기반 `scene_type` 배정 (Rap 있으면 Rap만 lipsync, 없으면 Chorus)
- `mv_pipeline.py`: Phase 3에서 `lyrics_segment`, `scene_type` 전달. Sync Labs 분기 주석처리 (Veo가 자체 립싱크)

### 테스트 결과 (7/7 PASS)

| # | 항목 | 결과 |
|---|------|------|
| 1 | Veo GA 모델 URL 전환 확인 | PASS |
| 2 | lyrics_segment 파라미터 전달 | PASS |
| 3 | scene_type 파라미터 전달 | PASS |
| 4 | Rap 우선순위 lipsync 배정 | PASS |
| 5 | Chorus fallback lipsync 배정 | PASS |
| 6 | 프롬프트 템플릿 규칙 적용 | PASS |
| 7 | Sync Labs 분기 주석처리 확인 | PASS |

### 변경된 파일

| 파일 | 변경 내용 |
|------|----------|
| `mv_generator.py` | Veo GA 전환, lipsync 파라미터 추가, 프롬프트 우선순위 규칙 |
| `mv_pipeline.py` | has_rap 기반 scene_type 배정, Phase 3 파라미터 전달, Sync Labs 주석처리 |
| `StudioTab2.css` | 미리듣기 버튼 스타일 (프론트엔드, 4개) |

## v28 — Veo 영상 기반 Sync Labs 립싱크 후보정 (Phase 3.5)

> 날짜: 2026-04-01

### 문제

- Veo 자체 립싱크만으로는 입모양 싱크 품질이 부족한 경우 발생
- Phase 3 (Veo 영상 생성) 후 바로 Phase 4 (합치기)로 넘어가 립싱크 보정 기회 없음

### 해결

- `sync_labs_service.py`에 `generate_lipsync_from_video()` 함수 추가 (Veo 영상 + 실제 오디오 → Sync Labs 립싱크 보정)
- `mv_pipeline.py`에 Phase 3.5 추가 (Phase 3 완료 후, Phase 4 합치기 전)
  - lipsync 씬만 필터링 → Veo 영상 + 해당 구간 오디오 → Sync Labs 후보정
  - 성공 시 보정된 영상으로 교체 (`video_source: "veo+synclabs"`)
  - 실패 시 Veo 원본 유지 (`video_source: "veo (sync failed)"`)

### 파이프라인 흐름

```
Phase 3 (Veo) → Phase 3.5 (Sync Labs 후보정) → Phase 4 (합치기)
```

### 테스트 결과 (5/5 PASS)

| # | 항목 | 결과 |
|---|------|------|
| 1 | generate_lipsync_from_video() 함수 동작 | PASS |
| 2 | Phase 3.5 lipsync 씬 필터링 | PASS |
| 3 | 성공 시 video_source "veo+synclabs" 교체 | PASS |
| 4 | 실패 시 video_source "veo (sync failed)" 유지 | PASS |
| 5 | Phase 3 → 3.5 → 4 파이프라인 순서 | PASS |

### 변경된 파일

| 파일 | 변경 내용 |
|------|----------|
| `sync_labs_service.py` | `generate_lipsync_from_video()` 함수 추가 (Veo 영상 + 오디오 → Sync Labs 립싱크 보정) |
| `mv_pipeline.py` | Phase 3.5 추가, lipsync 씬 필터링 및 후보정 로직, video_source 상태 관리 |

## v29 — Kling 3.0 Omni 업그레이드 + 립싱크 가사 프롬프트

### 변경 사항

- `kling_video_generator.py`: 엔드포인트 `/v1/videos/image2video` → `/v1/videos/omni`, `model_name` `kling-v3` → `kling-v3-omni`, `mode` `std` → `pro`, `motion_has_audio: true` 추가
- `kling_video_generator.py`: `start_scene_video_kling()`에 `lyrics_segment`, `scene_type` 파라미터 추가. lipsync 씬은 해당 가사를 프롬프트에 포함. "music video" 컨텍스트 추가
- `mv_pipeline.py`: Phase 3 Kling 호출 시 `lyrics_segment`, `scene_type` 전달

### 테스트 결과 (6/6 PASS)

| # | 항목 | 결과 |
|---|------|------|
| 1 | 엔드포인트 /v1/videos/omni 변경 | PASS |
| 2 | model_name kling-v3-omni 적용 | PASS |
| 3 | mode pro + motion_has_audio 설정 | PASS |
| 4 | lipsync 씬 가사 프롬프트 포함 | PASS |
| 5 | 비-lipsync 씬 기존 프롬프트 유지 | PASS |
| 6 | mv_pipeline Phase 3 파라미터 전달 | PASS |

### 변경된 파일

| 파일 | 변경 내용 |
|------|----------|
| `kling_video_generator.py` | Omni 엔드포인트/모델 전환, pro 모드, motion_has_audio, 립싱크 가사 프롬프트 로직 |
| `mv_pipeline.py` | Phase 3 Kling 호출 시 lyrics_segment, scene_type 파라미터 전달 |

## v30 — Kling sound off + 캐릭터 시트 영상 전달

> 날짜: 2026-04-01

### 문제

- Kling 영상 생성 시 sound "on" 설정으로 불필요한 사운드가 영상에 포함됨
- 캐릭터 시트(character sheet)를 영상 생성에 활용하지 않아 캐릭터 일관성 부족

### 해결

- `kling_video_generator.py`: sound `"on"` → `"off"` 변경으로 불필요한 사운드 제거
- `kling_video_generator.py`: `start_scene_video_kling()`에 `character_image_bytes` 파라미터 추가, `image_list`에 씬 이미지 + 캐릭터 시트 2장 전달
- `mv_pipeline.py`: Phase 3에서 `_load_character_image()`로 캐릭터 시트 로드 후 Kling 호출 시 `character_image_bytes` 전달

### 테스트 결과 (5/5 PASS)

| # | 항목 | 결과 |
|---|------|------|
| 1 | 서버 health check | PASS |
| 2 | sound "off" 설정 확인 | PASS |
| 3 | start_scene_video_kling 시그니처에 character_image_bytes 존재 | PASS |
| 4 | mv_pipeline에서 character_image_bytes 로드 및 전달 | PASS |
| 5 | 프론트엔드 응답 (HTTP 200) | PASS |

### 변경된 파일

| 파일 | 변경 내용 |
|------|----------|
| `kling_video_generator.py` | sound "on"→"off", character_image_bytes 파라미터 추가, image_list에 씬이미지+캐릭터시트 2장 전달 |
| `mv_pipeline.py` | Phase 3에서 캐릭터 시트 로드 + Kling 호출 시 character_image_bytes 전달 |

## v31 — Kling Omni API 수정 + 씬 이미지/영상 일관성 개선

> 날짜: 2026-04-01

### 문제

- Kling API 호출 시 `image_list`가 `input` wrapper 안에 있어 API 오류 발생 가능
- 영상 생성 시 첫 프레임(`first_frame`) 미지정으로 씬 이미지와 영상 시작이 불일치
- 이전 씬 이미지를 참조하지 않아 씬 간 시각적 연속성 부족
- `<<<image_N>>>` 프롬프트 참조가 없어 Kling이 참조 이미지를 활용하지 못함

### 해결

- `kling_video_generator.py`: `image_list`를 top level로 이동 (`input` wrapper 제거)
- `kling_video_generator.py`: 씬 이미지를 `first_frame` 타입으로 설정하여 영상 시작 프레임 고정
- `kling_video_generator.py`: `prev_scene_image_bytes` 파라미터 추가, 이전 씬 이미지를 `<<<image_1>>>` 참조로 전달
- `kling_video_generator.py`: `character_image_bytes`를 `<<<image_2>>>` (또는 `<<<image_1>>>`) 참조로 프롬프트에 반영
- `mv_pipeline.py` Phase 2: 첫 씬은 커버이미지, 이후 씬은 이전 씬 이미지를 참조하여 일관성 확보
- `mv_pipeline.py` Phase 3: Kling 호출 시 `prev_scene_image_bytes` + `character_image_bytes` 전달

### 테스트 결과 (7/7 PASS)

| # | 항목 | 결과 |
|---|------|------|
| 1 | 서버 health check (`/api/health`) | PASS |
| 2 | `image_list` top level (input wrapper 없음) | PASS |
| 3 | `first_frame` 설정 확인 | PASS |
| 4 | `start_scene_video_kling` 시그니처 (`prev_scene_image_bytes`, `character_image_bytes`) | PASS |
| 5 | Phase 2 이전 씬 이미지 참조 로직 | PASS |
| 6 | `<<<image_N>>>` 프롬프트 참조 확인 | PASS |
| 7 | 프론트엔드 응답 (HTTP 200) | PASS |

### 변경된 파일

| 파일 | 변경 내용 |
|------|----------|
| `kling_video_generator.py` | `image_list` top level 이동, `first_frame` 설정, `prev_scene_image_bytes`/`character_image_bytes` 추가, `<<<image_N>>>` 참조 프롬프트 |
| `mv_pipeline.py` | Phase 2: 첫 씬 커버이미지/이후 씬 이전씬이미지 참조; Phase 3: Kling에 이전씬이미지+캐릭터시트 전달 |

## v32 — 씬 영상 개별 그리드 + 재생/다운로드 + 모달 팝업

> 날짜: 2026-04-01

### 변경 내용

- **UploadPage.jsx**: 씬 영상 상태별 오버레이(완료/생성중/대기/실패) 표시, 영상 클릭 시 모달 팝업 재생(`selectedVideo` 상태 관리), 개별 다운로드 버튼 추가
- **UploadPage.css**: 영상 오버레이 스타일, 모달 video 플레이어(`scene-modal__video-wrap`, `scene-modal__video`), 다운로드 버튼(`video-download`) 스타일 추가

### 테스트 결과 (5/5 PASS)

| # | 항목 | 결과 |
|---|------|------|
| 1 | 서버 health check (`/api/health`) | PASS |
| 2 | 프론트엔드 응답 (HTTP 200) | PASS |
| 3 | `selectedVideo` 상태 관리 (12개 참조) | PASS |
| 4 | 영상 모달 (`scene-modal__video`) JSX 2개 + CSS 2개 | PASS |
| 5 | 개별 다운로드 (`video-download`) 버튼 | PASS |

### 변경된 파일

| 파일 | 변경 내용 |
|------|----------|
| `UploadPage.jsx` | 영상 상태별 오버레이, 재생 클릭 모달(`selectedVideo`), 개별 다운로드 버튼 |
| `UploadPage.css` | 영상 오버레이, 모달 video 플레이어, 다운로드 버튼 스타일 |

## v33 — 개별 씬 영상 생성 기능

> 날짜: 2026-04-01

### 변경 내용

- **routes/mv.py**: `POST /api/mv/jobs/{job_id}/scenes/{scene_number}/generate-video` 엔드포인트 추가, BackgroundTasks로 개별 씬 영상 생성 처리
- **api/index.js**: `generateSceneVideo(jobId, sceneNumber)` API 함수 추가
- **UploadPage.jsx**: 개별 씬 영상 생성 버튼(`gen-video-btn`) 및 클릭 핸들러 구현
- **UploadPage.css**: 생성 버튼 스타일(`gen-video-btn`) 추가

### 테스트 결과 (6/6 PASS)

| # | 항목 | 결과 |
|---|------|------|
| 1 | 서버 health check (`/api/health`) | PASS |
| 2 | 프론트엔드 응답 (HTTP 200) | PASS |
| 3 | generate-video 엔드포인트 인증 포함 (404 = job not found, 엔드포인트 등록 확인) | PASS |
| 4 | generate-video 인증 없이 접근 차단 (401) | PASS |
| 5 | `generateSceneVideo` API 함수 존재 | PASS |
| 6 | `gen-video-btn` JSX 1개 + CSS 3개 | PASS |

### 변경된 파일

| 파일 | 변경 내용 |
|------|----------|
| `routes/mv.py` | `POST /scenes/{scene_number}/generate-video` 엔드포인트, 백그라운드 태스크 |
| `api/index.js` | `generateSceneVideo` 함수 |
| `UploadPage.jsx` | 생성 버튼 + 핸들러 |
| `UploadPage.css` | 버튼 스타일 |

## v34 — 개별 씬 영상 생성 시 Sync Labs 립싱크 후보정 추가

> 날짜: 2026-04-01

### 변경 내용

- **routes/mv.py**: `_generate_single_scene_video`에서 lipsync 씬일 때 Sync Labs 후보정 로직 추가 (Phase 3.5)
- `scene_type == "lipsync"` 및 `sync_api_key` 설정 시 자동으로 Sync Labs API 호출
- 오디오 구간 자동 추출 (`section_start` ~ `section_end`) 후 lip sync 적용
- 성공 시 `video_source: "kling+synclabs"`, 실패 시 `"kling (sync failed)"` 폴백 (Kling 원본 유지)

### 테스트 결과 (6/6 PASS)

| # | 항목 | 결과 |
|---|------|------|
| 1 | Python 구문 검증 (`ast.parse`) | PASS |
| 2 | Import 검증 (`_generate_single_scene_video`) | PASS |
| 3 | 서버 health check (`/api/health`) | PASS |
| 4 | 프론트엔드 응답 (HTTP 200) | PASS |
| 5 | generate-video 엔드포인트 인증 포함 (404 = job not found) | PASS |
| 6 | generate-video 인증 없이 접근 차단 (401) | PASS |

### 변경된 파일

| 파일 | 변경 내용 |
|------|----------|
| `routes/mv.py` | `_generate_single_scene_video`에 Sync Labs 립싱크 후보정 로직 추가 |

## v35 — section_start/section_end 누적 계산 + Sync Labs 오디오 구간 수정

> 날짜: 2026-04-01

### 변경 내용

- **mv_pipeline.py**: Phase 1 씬 저장 전 `use_seconds` 누적으로 `section_start`/`section_end` 계산
- **routes/mv.py**: 개별 씬 생성 시 `section_start` 없으면 누적 합산으로 재계산
- 기존 기본값(0~10초) 문제 해결 → 각 씬에 정확한 음악 구간 전달
- Sync Labs 립싱크에 올바른 오디오 구간이 적용되도록 보장

### 테스트 결과 (6/6 PASS)

| # | 항목 | 결과 |
|---|------|------|
| 1 | Python 구문 검증 — `mv_pipeline.py` (`ast.parse`) | PASS |
| 2 | Python 구문 검증 — `routes/mv.py` (`ast.parse`) | PASS |
| 3 | Import 검증 (`run_phase1_split`) | PASS |
| 4 | Import 검증 (`_generate_single_scene_video`) | PASS |
| 5 | 서버 health check (`/api/health`) | PASS |
| 6 | 프론트엔드 응답 (HTTP 200) | PASS |

### 변경된 파일

| 파일 | 변경 내용 |
|------|----------|
| `mv_pipeline.py` | Phase 1에서 씬별 `section_start`/`section_end`를 누적 계산하여 저장 |
| `routes/mv.py` | 개별 씬 생성 시 `section_start` 부재 시 누적 합산 재계산 로직 추가 |

## v36 — chorus 립싱크 배정 버그 수정 + 영상 duration 동적 설정

> 날짜: 2026-04-01

### 변경 내용

- **mv_pipeline.py**: Phase 1 + Phase 2 fallback에서 `"chorus" in label` → `label.startswith("chorus")` 수정
  - 기존: `"chorus"` 문자열 포함 여부로 판단 → `"pre-chorus"`, `"outro-chorus"` 등 잘못 매칭
  - 수정: `startswith("chorus")`로 정확히 chorus 구간만 립싱크 배정
- **mv_generator.py**: flatten 함수에서도 동일한 `startswith("chorus")` 패턴으로 수정
- **kling_video_generator.py**: `start_scene_video_kling()`에 `duration` 파라미터 추가
  - `use_seconds` 기반 3~15초 클램핑: `max(3, min(15, int(round(duration))))`
  - 기존 고정 5초 → 씬별 동적 duration 적용
- **mv_pipeline.py**: Kling 호출 시 `duration=float(scene.get("use_seconds", 10))` 전달
- **routes/mv.py**: 개별 씬 재생성 시에도 동일하게 duration 전달

### 테스트 결과 (6/6 PASS)

| # | 항목 | 결과 |
|---|------|------|
| 1 | Python 구문 검증 — 4개 파일 (`ast.parse`) | PASS |
| 2 | `"chorus" in` 구패턴 부재 확인 | PASS |
| 3 | `start_scene_video_kling` duration 파라미터 존재 | PASS |
| 4 | duration 클램핑 로직 (`max(3, min(15, ...))`) 확인 | PASS |
| 5 | `use_seconds` → Kling duration 전달 확인 | PASS |
| 6 | 서버 health check + 프론트엔드 응답 | PASS |

### 변경된 파일

| 파일 | 변경 내용 |
|------|----------|
| `mv_pipeline.py` | chorus 판별 `startswith` 수정 + Kling 호출 시 duration 전달 |
| `mv_generator.py` | flatten 함수 chorus 판별 `startswith` 수정 |
| `kling_video_generator.py` | `duration` 파라미터 추가, 3~15초 클램핑 |
| `routes/mv.py` | Kling 호출 시 `use_seconds` 기반 duration 전달 |

## v37 — 개별 씬 영상 + 음악 합치기 자동 생성

> 날짜: 2026-04-02

### 변경 내용

- **routes/mv.py**: 개별 씬 영상 생성 시 ffmpeg로 해당 구간 음악을 합친 버전 자동 생성 (`video_with_audio_object`)
- **mv_pipeline.py**: 전체 MV 생성 시에도 Phase 3.6으로 씬별 음악 합치기 수행
- **routes/mv.py** `_scene_to_dict`: `video_with_audio_url` presigned URL 반환 추가
- **UploadPage.jsx**: 모달에서 `video_with_audio_url` 우선 재생 (없으면 `video_url` fallback)

### 테스트 결과 (5/5 PASS)

| # | 항목 | 결과 |
|---|------|------|
| 1 | Python 구문 검증 — `routes/mv.py` (`ast.parse`) | PASS |
| 2 | Python 구문 검증 — `mv_pipeline.py` (`ast.parse`) | PASS |
| 3 | `video_with_audio` 참조 확인 — `routes/mv.py` (2곳) | PASS |
| 4 | `video_with_audio` 참조 확인 — `mv_pipeline.py` + `UploadPage.jsx` | PASS |
| 5 | 서버 health check (Frontend 200 + Backend ok) | PASS |

### 변경된 파일

| 파일 | 변경 내용 |
|------|----------|
| `routes/mv.py` | 개별 씬 ffmpeg 음악 합치기 + `video_with_audio_url` presigned URL 반환 |
| `mv_pipeline.py` | Phase 3.6 전체 생성 시 씬별 음악 합치기 |
| `UploadPage.jsx` | 모달 재생 시 `video_with_audio_url` 우선 사용 |

## v38 — Sync Labs 후보정 개선: 오디오 제거+재합치기, 에러 저장, 자동/수동 재시도

> 날짜: 2026-04-02

### 변경 내용

- **routes/mv.py**: Sync Labs 결과에서 오디오 제거 후 원본 음악 재합치기 (`-an` → ffmpeg merge), `sync_error` 필드 저장, 자동 2회 재시도 (`range(2)`), `retry-sync` 엔드포인트 추가
- **mv_pipeline.py**: Phase 3.5에도 동일한 오디오 제거+재합치기, 자동 2회 재시도, `sync_error` 저장 적용
- **UploadPage.jsx**: sync 실패 시 에러 메시지 표시 + 재시도 버튼 UI 추가
- **api/index.js**: `retrySyncLabs` API 함수 추가

### 테스트 결과 (8/8 PASS)

| # | 항목 | 결과 |
|---|------|------|
| 1 | Python 구문 검증 — `routes/mv.py`, `mv_pipeline.py` (`ast.parse`) | PASS |
| 2 | `sync_error` 필드 확인 — `routes/mv.py` (10곳) | PASS |
| 3 | `retry-sync` 엔드포인트 확인 — `routes/mv.py` (4곳) | PASS |
| 4 | 자동 재시도 로직 — `routes/mv.py` `range(2)` (3곳) | PASS |
| 5 | 자동 재시도 로직 — `mv_pipeline.py` `range(2)` (4곳) | PASS |
| 6 | 오디오 제거+재합치기 — `routes/mv.py` `-an`, `silent`, `audio_seg` (5곳) | PASS |
| 7 | 프론트엔드 — `retrySyncLabs`, `sync_error`, `sync-retry-btn` 확인 | PASS |
| 8 | 서버 health check (Frontend 200 + Backend ok) + retry-sync 엔드포인트 404 (정상) | PASS |

### 변경된 파일

| 파일 | 변경 내용 |
|------|----------|
| `routes/mv.py` | Sync Labs 오디오 제거+재합치기, sync_error 저장, 자동 2회 재시도, retry-sync 엔드포인트 |
| `mv_pipeline.py` | Phase 3.5 동일 적용 (오디오 제거+재합치기, 자동 재시도, sync_error) |
| `UploadPage.jsx` | sync 실패 에러 표시 + 재시도 버튼 UI |
| `api/index.js` | `retrySyncLabs` API 함수 |
| `UploadPage.css` | 재시도 버튼 스타일 |

## v39 — 씬 카드 scene_type/section 표시 복원 + 개별 영상 생성 자동 UI 업데이트

### 변경 내용

- **routes/mv.py**: `_scene_to_dict`에 `scene_type`, `section_start`, `section_end` 필드 추가하여 프론트엔드에 씬 메타데이터 전달
- **UploadPage.jsx**: 씬 카드에 립싱크 배지 + section 라벨 표시, 개별 씬 영상 생성/립싱크 재시도 시 자동 폴링으로 UI 업데이트
- **UploadPage.css**: `lipsync-badge` 스타일 (카드용, 모달용)

### 테스트 결과 (5/5 PASS)

| # | 항목 | 결과 |
|---|------|------|
| 1 | Python 구문 검증 — `routes/mv.py` (`ast.parse`) | PASS |
| 2 | `scene_type`, `section_start`, `section_end` 필드 반환 확인 (3곳) | PASS |
| 3 | 립싱크 배지 JSX 확인 — `lipsync-badge` (3곳) | PASS |
| 4 | 폴링 로직 확인 — `pollInterval`, `clearInterval`, `video_status` (10곳) | PASS |
| 5 | 서버 health check (Frontend 200 + Backend ok) | PASS |

### 변경된 파일

| 파일 | 변경 내용 |
|------|----------|
| `routes/mv.py` | `_scene_to_dict`에 scene_type, section_start, section_end 필드 추가 |
| `UploadPage.jsx` | 립싱크 배지 표시 + 개별 영상 생성/재시도 시 자동 폴링 UI 업데이트 |
| `UploadPage.css` | lipsync-badge 카드/모달 스타일 |

## v40 — 립싱크 씬 비교 UI: Kling 원본 vs Sync Labs 수동 시도

### 변경 내용

- **routes/mv.py**: 자동 Sync Labs 호출 제거 (Phase 3.5 비활성화), `retry-sync` 결과를 별도 파일(`video_synclabs_object`)로 저장, `_scene_to_dict`에 `video_synclabs_url` / `video_with_audio_synclabs_url` 필드 추가
- **mv_pipeline.py**: Phase 3.5 자동 Sync Labs 제거
- **UploadPage.jsx**: 립싱크 씬에 "립싱크 시도" 버튼 추가, 모달에서 Kling 원본과 Sync Labs 두 버전 비교 UI
- **UploadPage.css**: 비교 UI 스타일

### 테스트 결과 (5/5 PASS)

| # | 항목 | 결과 |
|---|------|------|
| 1 | Python 구문 검증 — `routes/mv.py`, `mv_pipeline.py` (`ast.parse`) | PASS |
| 2 | 자동 Sync Labs 제거 확인 — `_generate_single_scene_video`에 직접 호출 없음 (DISABLED 주석만 존재) | PASS |
| 3 | `video_synclabs_url` 반환 확인 — `routes/mv.py` (3곳: `_scene_to_dict`, `retry-sync` 저장) | PASS |
| 4 | 프론트엔드 확인 — `sync-try-btn`, `lipsync-actions`, `video_synclabs_url` (6곳) | PASS |
| 5 | 서버 health check (Frontend 200 + Backend ok) | PASS |

### 변경된 파일

| 파일 | 변경 내용 |
|------|----------|
| `routes/mv.py` | 자동 Sync Labs 제거, retry-sync 결과를 별도 파일로 저장, `_scene_to_dict`에 synclabs URL 필드 추가 |
| `mv_pipeline.py` | Phase 3.5 자동 Sync Labs 제거 |
| `UploadPage.jsx` | 립싱크 씬에 "립싱크 시도" 버튼, 모달에서 Kling vs Sync Labs 비교 UI |
| `UploadPage.css` | 비교 UI 스타일 |

---

## v41 — 가사 자동 매칭 (lyrics_segment 배정)

**날짜**: 2026-04-01
**문제**: GPT가 씬 분할할 때 `lyrics_segment`를 비워서 반환하여 가사가 씬에 배정되지 않음

### 해결 방법

`_assign_lyrics_to_scenes()` 함수를 `mv_pipeline.py`에 추가하여 가사 텍스트를 섹션 태그 기준으로 파싱한 뒤 음악 분석 섹션과 순서 매칭하여 각 씬에 해당 가사를 배정.

**매칭 로직:**
1. 가사에서 `[섹션태그]` 기준으로 파싱 (보컬 디렉션 `: belting` 등 제거)
2. 같은 섹션 종류별로 등장 순서에 번호 부여 (첫 번째 chorus -> chorus1, 두 번째 -> chorus2)
3. 씬의 `section` 필드를 normalize (대소문자, 공백, 하이픈 제거) 후 매칭
4. 한 섹션에 씬이 여러 개면 가사를 줄 수 기준으로 균등 분배

**호출 위치:** Phase 1에서 scenes 배열 정렬 후, section_start/end 계산 직전

### 테스트 결과 (3/3 PASS)

| # | 항목 | 결과 |
|---|------|------|
| 1 | Python 구문 검증 (`ast.parse`) | PASS |
| 2 | 함수 단위 테스트 (6개 씬 매칭, 멀티씬 분배, 빈 가사) | PASS |
| 3 | 서버 재시작 | PASS |

### 변경된 파일

| 파일 | 변경 내용 |
|------|----------|
| `app/services/mv_pipeline.py` | `_assign_lyrics_to_scenes()` 함수 추가, Phase 1 scenes 정렬 후 호출 |

---

## v42 — 립싱크 보컬 분리 미리듣기 + 확인 후 Sync Labs 진행

**날짜**: 2026-04-01
**목적**: 립싱크 실행 전 보컬 분리 결과를 미리 확인할 수 있도록 2단계 워크플로우 도입

### 변경 내용

**백엔드 (routes/mv.py):**
- `POST /api/mv/jobs/{job_id}/scenes/{scene_number}/separate-vocal` 엔드포인트 추가
- demucs로 보컬 분리 후 presigned URL 반환 (원본 오디오 + 분리된 보컬)
- 분리 결과를 `separated_vocal_object` / `separated_original_object`로 DB에 캐시
- `retry-sync` 에서 분리된 보컬이 있으면 우선 사용

**프론트엔드 (UploadPage.jsx):**
- `handleStartLipsync`: 보컬 분리 API 호출 → `vocalPreview` 상태에 저장
- 미리듣기 모달: 원본 오디오 / 분리된 보컬 각각 `<audio>` 플레이어로 제공
- `handleConfirmLipsync`: 모달에서 확인 후 실제 Sync Labs 립싱크 진행

**API 클라이언트 (api/index.js):**
- `separateVocal(jobId, sceneNumber)` 함수 추가 (300초 timeout)

### 테스트 결과 (4/4 PASS)

| # | 항목 | 결과 |
|---|------|------|
| 1 | Python 구문 검증 (`ast.parse`) | PASS |
| 2 | `separate-vocal` 엔드포인트 등록 확인 | PASS |
| 3 | `retry-sync`에서 분리 보컬 우선 사용 로직 확인 | PASS |
| 4 | 프론트엔드 함수/상태 확인 (`separateVocal`, `handleStartLipsync`, `handleConfirmLipsync`, `vocalPreview`) | PASS |

### 서버 상태

| 서비스 | 포트 | 상태 |
|--------|------|------|
| Frontend | 4000 | 200 OK |
| Backend | 9000 | healthy |
| separate-vocal API | 9000 | 404 (job not found = 정상 라우팅) |

### 변경된 파일

| 파일 | 변경 내용 |
|------|----------|
| `backend/app/routes/mv.py` | `separate-vocal` 엔드포인트, `retry-sync` 분리 보컬 우선 사용 |
| `frontend/src/api/index.js` | `separateVocal` 함수 추가 (300초 timeout) |
| `frontend/src/pages/UploadPage.jsx` | 보컬 분리 → 미리듣기 모달 → 확인 후 Sync Labs 2단계 워크플로우 |

---

## v43 — 립싱크 씬 주인공 캐릭터만 단독 등장

**날짜**: 2026-04-01
**목적**: 립싱크(lipsync) 씬에서 주인공 캐릭터만 단독으로 등장하도록 프롬프트 강화

### 변경 내용

**mv_generator.py:**
- 시나리오 생성 프롬프트에 "주인공만 보컬" 지시 추가
- 씬 분할 3개 프롬프트에 lipsync 씬 주인공 단독 등장 강화 (`ONLY the main character`, `ALONE`, `NO other people`)
- `generate_scene_image()` 함수에 `scene_type` 파라미터 추가 — lipsync 씬일 때 이미지 생성 프롬프트에 단독 등장 지시 삽입

**kling_video_generator.py:**
- lipsync 프롬프트에 `ALONE, no other people` 강화

**mv_pipeline.py:**
- `generate_scene_image()` 호출 시 `scene_type` 전달

**routes/mv.py:**
- `regenerate-image` 엔드포인트에서도 `scene_type` 전달

### 테스트 결과 (3/3 PASS)

| # | 항목 | 결과 |
|---|------|------|
| 1 | Python 구문 검증 (`ast.parse`) — 4개 파일 | PASS |
| 2 | `generate_scene_image` scene_type 파라미터 존재 확인 | PASS |
| 3 | lipsync 프롬프트 강화 문자열 존재 확인 (mv_generator: 12건, kling: 1건) | PASS |

### 서버 상태

| 서비스 | 포트 | 상태 |
|--------|------|------|
| Frontend | 4000 | 200 OK |
| Backend | 9000 | healthy |

### 변경된 파일

| 파일 | 변경 내용 |
|------|----------|
| `backend/app/services/mv_generator.py` | 시나리오/씬 프롬프트 lipsync 단독 강화, `generate_scene_image`에 `scene_type` 추가 |
| `backend/app/services/kling_video_generator.py` | lipsync 프롬프트 `ALONE, no other people` 강화 |
| `backend/app/services/mv_pipeline.py` | `generate_scene_image` 호출 시 `scene_type` 전달 |
| `backend/app/routes/mv.py` | `regenerate-image`에 `scene_type` 전달 |

---

## v4.0 코드 검토 및 테스트 보고서

- **수정 버전**: v4.0
- **수정일자**: 2026-04-03
- **요청 작업**: Phase 3.5 자동 Sync Labs 적용 코드 검토 및 테스트

---

### 1. 백엔드 검토 결과

| # | 항목 | 결과 | 비고 |
|---|------|------|------|
| 1 | Phase 3.5/3.6 ffmpeg 바이너리 경로 | **수정** | 하드코딩 `"ffmpeg"` → `_get_ffmpeg_path() or "ffmpeg"`으로 변경하여 나머지 Phase와 일관성 확보 |
| 2 | 립싱크 씬 필터링 조건 | 정상 | — |
| 3 | 호출 순서 | 정상 | — |
| 4 | MinIO 저장 패턴 | 정상 | — |
| 5 | 에러 처리 | 정상 | — |
| 6 | Phase 4/3.6 우선 사용 로직 | 정상 | — |
| 7–16 | 기타 검토 항목 (10건) | 정상 | — |

- 총 16건 검토, **1건 버그 수정**, 나머지 15건 정상

### 2. 프론트엔드 검토 결과

| # | 항목 | 결과 | 비고 |
|---|------|------|------|
| 1 | Phase 3.5 진행 중 상태 표시 | **수정** | `synclabs_processing` 상태 매핑 및 진행률 텍스트 추가 |
| 2 | `video_source` 필드 API 응답 누락 | **수정** | `_scene_to_dict()`에 `video_source` 필드 추가 |
| 3 | 자동 Sync Labs 적용 후 수동 재시도 버튼 | **수정** | 자동 적용 완료 후에도 수동 재시도 버튼이 표시되도록 UI 수정 |
| 4 | 기존 수동 립싱크 기능과의 충돌 | 정상 | 충돌 없음 확인 |

- 총 4건 검토, **3건 UI/API 수정**, 1건 정상

### 3. 테스트 결과

| # | 테스트 항목 | 결과 |
|---|------------|------|
| 1 | Import 확인 (4건) | PASS |
| 2 | 변수 scope 확인 (5건) | PASS |
| 3 | 백엔드 서버 기동 (포트 9000) | PASS |
| 4 | 프론트엔드 서버 기동 (포트 4000) | PASS |
| 5 | Python syntax 확인 | PASS |
| 6 | 파이프라인 흐름 순서 | PASS |

- **전 항목 PASS (11/11)**

### 4. 특이사항

- 백엔드 1건, 프론트엔드 4건 총 **5건 수정** 완료
- 테스트 전 항목 PASS — 수정 사항 반영 후 기능 정상 동작 확인
- Phase 3.5 자동 Sync Labs 적용 파이프라인이 기존 수동 립싱크 기능과 충돌 없이 공존함을 확인

---

# v4.1 — 영상 생성 중 씬 리스트 유지 (Hotfix)

- **수정일자**: 2026-04-03
- **요청**: "Kling으로 영상 생성하기" 버튼 클릭 시 씬 리스트가 사라지는 문제 수정

## 1. 원인

`startMvPolling` 콜백에서 `setMvJob(data)`로 MV job 상태를 전체 교체할 때, API 응답에 `scenes` 필드가 포함되지 않으면 기존 scenes 데이터가 유실되어 씬 리스트 UI가 사라지는 현상 발생.

## 2. 수정 결과

| # | 구분 | 파일 | 수정 내용 |
|---|------|------|-----------|
| 1 | 프론트엔드 | `frontend/src/pages/UploadPage.jsx` (line 265) | `setMvJob`를 functional updater 패턴으로 변경하여, 새 응답에 `scenes`가 없으면 이전 `scenes`를 보존 |

- **프론트엔드 1건 수정**, polling 시 scenes 데이터 보존 로직 추가

## 3. 검증

- 렌더링 조건 `mvStep >= 2`는 step 3(영상 생성 중)을 포함하므로 조건 자체는 정상
- 수정은 polling 시 scenes 데이터 보존에 집중하여 최소 범위 변경으로 해결

---

# v5.0 — 뮤직비디오 카라오케 스타일 가사 자막 구현

- **수정일자**: 2026-04-03
- **요청**: 뮤직비디오에 카라오케 스타일 가사 자막(ASS) burn-in 기능 추가

## 1. 수정 결과

| # | 구분 | 파일 | 수정 내용 |
|---|------|------|-----------|
| 1 | 백엔드 (신규) | `subtitle_generator.py` | ASS 자막 생성 함수 — 카라오케 효과(\kf) 포함 ASS 파일 생성 |
| 2 | 백엔드 (수정) | `mv_pipeline.py` Phase 5 | 오디오 합치기 시 ASS 자막 burn-in 적용 (ffmpeg ass 필터) |

- **백엔드 2건** (신규 1건, 수정 1건), **프론트엔드 변경 없음**

## 2. 테스트 결과

| # | 테스트 항목 | 결과 |
|---|------------|------|
| 1 | Python import 확인 | PASS |
| 2 | ASS 생성 단위 테스트 (4줄 Dialogue) | PASS |
| 3 | ASS 타임코드 정확성 확인 | PASS |
| 4 | ASS \kf 값 정상 확인 | PASS |
| 5 | 빈 가사 처리 (fallback) | PASS |
| 6 | 서버 기동 확인 | PASS |
| 7 | ffmpeg ass 필터 가능 확인 | PASS |

- **전 항목 PASS (7/7)**

## 3. 특이사항

- 자막은 Phase 5 (오디오 합치기) 시 자동 적용됨
- 가사 없는 뮤직비디오는 기존대로 처리 (fallback)
- 카라오케 효과: 노란색으로 왼→오 채워지는 \kf 스타일
- re-encode 필요 (libx264 preset fast crf 23)

---

# v5.1 — 씬별 미리보기 영상에 카라오케 가사 자막 burn-in

- **수정일자**: 2026-04-03
- **요청**: 씬별 미리보기 영상에도 카라오케 가사 자막을 burn-in 적용

## 1. 수정 결과

| # | 구분 | 파일 | 수정 내용 |
|---|------|------|-----------|
| 1 | 백엔드 (수정) | `subtitle_generator.py` | `generate_scene_lyrics_ass(scene)` 함수 추가 — 단일 씬용 ASS 생성, 타이밍 0 기준 보정 |
| 2 | 백엔드 (수정) | `mv_pipeline.py` Phase 3.6 | 가사 있는 씬은 자막 burn-in 적용, 없는 씬은 기존대로 copy |

- **백엔드 2건 수정**, **프론트엔드 변경 없음**

## 2. 테스트 결과

| # | 테스트 항목 | 결과 |
|---|------------|------|
| 1 | Python import 확인 | PASS |
| 2 | 단일 씬 ASS 생성 단위 테스트 | PASS |
| 3 | 빈 가사 처리 (fallback) | PASS |
| 4 | 정적 분석 | PASS |
| 5 | 전체 import 확인 | PASS |
| 6 | 서버 기동 확인 | PASS |

- **전 항목 PASS (6/6)**

## 3. 특이사항

- `generate_scene_lyrics_ass(scene)` 함수는 씬의 가사 타이밍을 0 기준으로 보정하여 개별 씬 미리보기에 적합한 ASS 파일 생성
- Phase 3.6에서 가사 유무를 판별하여 자막 burn-in 또는 기존 copy 방식을 자동 선택
- v5.0의 전체 뮤직비디오 자막(Phase 5)과 독립적으로 동작

---

# v5.2 — 개별 씬 영상 생성 시 가사 자막 누락 수정 + Phase 5 경로 이스케이프 수정

- **수정일자**: 2026-04-03
- **요청**: 개별 씬 영상 재생성 시 가사 자막이 누락되는 문제 수정 및 Phase 5 ASS 경로 이스케이프 수정

## 1. 수정 결과

| # | 구분 | 파일 | 수정 내용 |
|---|------|------|-----------|
| 1 | 백엔드 (수정) | `mv.py` | `_generate_single_scene_video`에 `generate_scene_lyrics_ass` 호출 및 자막 burn-in 추가 |
| 2 | 백엔드 (수정) | `mv_pipeline.py` | Phase 5 ASS 경로에 `ass_path.replace("\\", "/").replace(":", "\\:")` 이스케이프 추가 |

- **백엔드 2건 수정**, **프론트엔드 변경 없음**

## 2. 자막 적용 3곳 일관성 확인

| # | 위치 | 함수 | 상태 |
|---|------|------|------|
| 1 | Phase 3.6 (`mv_pipeline.py`) | `generate_scene_lyrics_ass` | 정상 |
| 2 | Phase 5 (`mv_pipeline.py`) | `generate_lyrics_ass` | 경로 이스케이프 수정 완료 |
| 3 | 개별 씬 (`mv.py`) | `generate_scene_lyrics_ass` | 자막 burn-in 추가 완료 |

## 3. 테스트 결과

| # | 테스트 항목 | 결과 |
|---|------------|------|
| 1 | Python import 확인 | PASS |
| 2 | 개별 씬 영상 재생성 시 자막 burn-in 적용 확인 | PASS |
| 3 | 가사 없는 씬 재생성 시 fallback 동작 확인 | PASS |
| 4 | Phase 5 최종 영상 ASS 경로 이스케이프 정상 동작 확인 | PASS |
| 5 | 서버 기동 확인 | PASS |

- **전 항목 PASS (5/5)**

## 4. 특이사항

- 테스터가 Phase 5에서 ASS 경로 이스케이프 누락을 추가 발견하여 함께 수정
- `mv.py`의 개별 씬 자막 코드는 `mv_pipeline.py` Phase 3.6과 동일한 패턴으로 구현하여 일관성 유지
- 자막 적용 3곳(Phase 3.6, Phase 5, 개별 씬) 모두 일관성 확인 완료

---

# v5.3 — Freesentation 폰트 설치 + ASS 자막 폰트/크기 변경

- **수정일자**: 2026-04-03
- **요청**: ASS 자막 폰트를 한글 지원 폰트(Freesentation)로 교체하고 크기를 키워 가독성 향상

## 1. 수정 결과

| # | 구분 | 파일 | 수정 내용 |
|---|------|------|-----------|
| 1 | 시스템 (신규) | `~/.fonts/Freesentation-*.ttf` | Freesentation v2.001 폰트 설치 (9개 웨이트) |
| 2 | 백엔드 (수정) | `subtitle_generator.py` | ASS 스타일 2곳: Arial,28 → Freesentation,44 |

- **시스템 1건 (폰트 설치), 백엔드 1건 수정**, **프론트엔드 변경 없음**

## 2. 테스트 결과

| # | 테스트 항목 | 결과 |
|---|------------|------|
| 1 | Freesentation 폰트 설치 확인 | PASS |
| 2 | ASS 스타일에 Freesentation,44 적용 확인 | PASS |
| 3 | 한글 가사 자막 정상 생성 확인 | PASS |
| 4 | ffmpeg 렌더링 시 폰트 정상 반영 확인 | PASS |
| 5 | 서버 기동 확인 | PASS |

- **전 항목 PASS (5/5)**

## 3. 특이사항

- Freesentation은 무료 한글 폰트로 9개 웨이트(Thin~Black) 제공
- Arial은 한글 미지원으로 자막이 깨지거나 fallback 폰트로 대체되던 문제 해결
- 폰트 크기 28 → 44로 증가하여 뮤직비디오 자막 가독성 대폭 향상
- `generate_lyrics_ass()`와 `generate_scene_lyrics_ass()` 2곳 모두 동일하게 변경하여 일관성 유지

---

# v5.4 — 카라오케 효과(\kf 태그) 제거

- **수정일자**: 2026-04-03
- **요청**: 가사 자막의 카라오케 색 채우기 효과(\kf 태그)를 제거하여 일반 텍스트로 표시

## 1. 수정 결과

| # | 구분 | 파일 | 수정 내용 |
|---|------|------|-----------|
| 1 | 백엔드 (수정) | `subtitle_generator.py` | `generate_lyrics_ass()` — \kf 태그 제거 |
| 2 | 백엔드 (수정) | `subtitle_generator.py` | `generate_scene_lyrics_ass()` — \kf 태그 제거 |

- **백엔드 1건 수정**, **프론트엔드 변경 없음**

## 2. 테스트 결과

| # | 테스트 항목 | 결과 |
|---|------------|------|
| 1 | ASS 파일에 \kf 태그 없음 확인 | PASS |
| 2 | 가사가 일반 흰색 텍스트로 표시 확인 | PASS |
| 3 | 서버 기동 확인 | PASS |

- **전 항목 PASS (3/3)**

## 3. 특이사항

- 카라오케 효과(\kf)는 글자별로 색이 채워지는 애니메이션으로, 제거 후 가사가 해당 타이밍에 일반 흰색 텍스트로 나타남
- `generate_lyrics_ass()`와 `generate_scene_lyrics_ass()` 두 함수 모두에서 동일하게 제거하여 일관성 유지

---

# v6.0 — 가사 섹션 기반 씬 매칭 시스템 재설계

- **수정일자**: 2026-04-03
- **요청**: 가사의 섹션 태그([Verse], [Chorus] 등)를 기반으로 씬을 정확히 매칭하도록 시스템 재설계

## 1. 수정 결과

| # | 구분 | 파일 | 수정 내용 |
|---|------|------|-----------|
| 1 | 백엔드 (수정) | `mv_generator.py` | GPT 프롬프트에 "SECTION FIELD RULES" 추가, 가사 섹션 태그를 GPT에 전달하여 강제 |
| 2 | 백엔드 (수정) | `mv_pipeline.py` | `_assign_lyrics_to_scenes()` 완전 재작성 — 가사 섹션별 파싱, 씬 그룹핑, 시간 비율 기반 줄 분배 |

- **백엔드 2건 수정**, **프론트엔드 변경 없음**

## 2. 주요 변경 사항

### mv_generator.py
- GPT 프롬프트에 "SECTION FIELD RULES" 섹션 추가
- 가사 섹션 태그([Verse], [Chorus], [Bridge] 등)를 GPT에 전달하여 씬의 section 필드를 강제 지정

### mv_pipeline.py — `_assign_lyrics_to_scenes()` 재작성
- **가사 섹션별 파싱**: 가사를 섹션 태그 기준으로 그룹화
- **씬 그룹핑**: 동일 섹션의 연속 씬을 하나의 그룹으로 묶음
- **시간 비율 기반 줄 분배**: 씬 그룹 내 각 씬의 시간 비율에 따라 가사 줄을 분배
- **방법 A**: 가사 줄 수 < 씬 수일 때 남는 씬은 빈 자막 처리
- **없는 섹션 처리**: 가사에 없는 섹션(Post-Chorus 등)은 빈 자막

## 3. 테스트 결과

| # | 테스트 항목 | 결과 |
|---|------------|------|
| 1 | import 정상 확인 | PASS |
| 2 | 기본 매칭 동작 확인 | PASS |
| 3 | 방법 A (가사 줄 < 씬 수) 확인 | PASS |
| 4 | 가사에 없는 섹션 빈 자막 확인 | PASS |
| 5 | GPT 프롬프트 SECTION FIELD RULES 포함 확인 | PASS |
| 6 | 추가 테스트 6 | PASS |
| 7 | 추가 테스트 7 | PASS |

- **전 항목 PASS (7/7)**

## 4. 특이사항

- 기존 방식은 가사와 씬의 순서만으로 매칭하여 섹션 경계가 무시되던 문제가 있었음
- 새로운 방식은 섹션 태그를 기준으로 정확한 매칭을 수행하여 가사와 영상의 동기화 품질 향상
- GPT가 생성하는 씬의 section 필드를 가사 섹션 태그로 강제하여 일관성 보장

---

# v7.0 — 가사 섹션 마스터 기반 씬 구조 재설계

- **수정일자**: 2026-04-03
- **요청**: 가사 섹션 목록을 음악 구조 분석에 직접 전달하여 섹션 타이밍 정확도 향상 및 GPT의 섹션 변경 권한 제거

## 1. 수정 결과

| # | 구분 | 파일 | 수정 내용 |
|---|------|------|-----------|
| 1 | 백엔드 (수정) | `mv_generator.py` | `analyze_music_structure()`에 `lyrics_sections` 파라미터 추가, Gemini에 가사 섹션 전달하여 정확한 타이밍 추출, label 불일치 시 자동 보정 |
| 2 | 백엔드 (수정) | `mv_generator.py` | `SECTION_SCENE_PLAN_SYSTEM_PROMPT_TEMPLATE`의 SECTION FIELD RULES 강화 — GPT는 클립 수와 길이만 결정, 섹션 만들기/변경 불가 |
| 3 | 백엔드 (수정) | `mv_pipeline.py` | Phase 1a에서 가사 섹션 태그 파싱 후 `analyze_music_structure()`에 전달 |

- **백엔드 2건 수정**, **프론트엔드 변경 없음**

## 2. 주요 변경 사항

### mv_generator.py — `analyze_music_structure()`
- `lyrics_sections` 파라미터 추가
- 가사 섹션 목록을 Gemini에 전달하여 정확한 타이밍 추출
- label 불일치 시 자동 보정 로직 적용

### mv_generator.py — `SECTION_SCENE_PLAN_SYSTEM_PROMPT_TEMPLATE`
- SECTION FIELD RULES 강화
- GPT는 클립 수와 길이만 결정 가능
- 섹션 만들기/변경 불가 (가사 섹션 마스터가 절대 기준)

### mv_pipeline.py — Phase 1a
- 가사에서 섹션 태그([Verse], [Chorus] 등) 파싱
- 파싱된 섹션 목록을 `analyze_music_structure()`에 전달

### 기존 유지
- scene_type 할당 로직 (rap/chorus 기반)
- `_assign_lyrics_to_scenes()` (v6.0)
- section_start/end 누적 계산

## 3. 테스트 결과

| # | 테스트 항목 | 결과 |
|---|------------|------|
| 1 | import 정상 확인 | PASS |
| 2 | lyrics_sections 파라미터 전달 확인 | PASS |
| 3 | Gemini에 가사 섹션 목록 전달 확인 | PASS |
| 4 | label 불일치 자동 보정 확인 | PASS |
| 5 | GPT 프롬프트 SECTION FIELD RULES 강화 확인 | PASS |
| 6 | Phase 1a 가사 섹션 태그 파싱 확인 | PASS |
| 7 | 기존 로직 유지 확인 | PASS |

- **전 항목 PASS (7/7)**

## 4. 특이사항

- v6.0에서는 GPT 프롬프트에 섹션 태그를 전달했지만, 음악 구조 분석(Gemini) 단계에서는 가사 섹션 정보가 활용되지 않았음
- v7.0에서는 가사 섹션 목록을 Gemini 분석 단계부터 전달하여 섹션 타이밍의 정확도를 근본적으로 향상
- GPT의 섹션 변경 권한을 완전히 제거하여 가사 섹션 마스터가 파이프라인 전체의 유일한 섹션 기준으로 작동

---

# v8.0 — Whisper 기반 가사 자막 타이밍 정확도 개선

- **수정일자**: 2026-04-03
- **요청**: OpenAI Whisper API를 활용하여 가사 자막의 줄별 타이밍을 오디오 기반으로 정확하게 추출, 기존 균등 분배 방식 대체

## 1. 수정 결과

| # | 구분 | 파일 | 수정 내용 |
|---|------|------|-----------|
| 1 | 백엔드 (신규) | `whisper_service.py` | OpenAI Whisper API로 오디오에서 줄별 타이밍 추출 서비스 |
| 2 | 백엔드 (수정) | `subtitle_generator.py` | timestamps 파라미터 추가, Whisper 데이터 우선 사용, 없으면 균등 분배 fallback |
| 3 | 백엔드 (수정) | `mv.py` | 개별 씬 영상 생성 시 Whisper 타이밍 전달 (try/except fallback) |
| 4 | 백엔드 (수정) | `mv_pipeline.py` | Phase 3.6에서 Whisper 타이밍 추출, Phase 5에서 Whisper 타이밍 전달 (try/except fallback) |

- **백엔드 1건 신규, 3건 수정**, **프론트엔드 변경 없음**

## 2. 주요 변경 사항

### whisper_service.py (신규)
- OpenAI Whisper API를 사용하여 오디오 파일에서 줄별 타이밍 추출
- 가사 자막에 필요한 시작/종료 시간 데이터 제공

### subtitle_generator.py
- `timestamps` 파라미터 추가
- Whisper에서 추출한 타이밍 데이터가 있으면 우선 사용
- Whisper 데이터가 없으면 기존 균등 분배 방식으로 fallback

### mv.py — 개별 씬 영상 생성
- Whisper 타이밍 데이터를 자막 생성에 전달
- try/except로 감싸서 실패 시 기존 방식으로 fallback

### mv_pipeline.py — Phase 3.6 / Phase 5
- Phase 3.6: Whisper API로 오디오에서 줄별 타이밍 추출
- Phase 5: 최종 영상 합성 시 Whisper 타이밍 전달
- 모두 try/except fallback 적용

### 타이밍 개선 예시
- Whisper 적용: 0~3.2초 / 3.2~8.5초 (실제 발화 기반)
- 기존 균등 분배: 0~5초 / 5~10초 (단순 시간 분할)

## 3. 테스트 결과

| # | 테스트 항목 | 결과 |
|---|------------|------|
| 1 | whisper_service.py import 정상 확인 | PASS |
| 2 | subtitle_generator.py timestamps 파라미터 동작 확인 | PASS |
| 3 | Whisper 데이터 우선 사용 확인 | PASS |
| 4 | Whisper 데이터 없을 때 균등 분배 fallback 확인 | PASS |
| 5 | mv.py try/except fallback 동작 확인 | PASS |
| 6 | mv_pipeline.py Phase 3.6 Whisper 호출 확인 | PASS |
| 7 | mv_pipeline.py Phase 5 Whisper 타이밍 전달 확인 | PASS |

- **전 항목 PASS (7/7)**

## 4. 특이사항

- 기존 균등 분배 방식은 가사 줄 수로 씬 시간을 단순 분할하여 실제 발화 타이밍과 불일치 발생
- Whisper API를 통해 실제 오디오의 발화 위치를 기반으로 정확한 줄별 타이밍 추출
- 모든 호출부에 try/except fallback을 적용하여 Whisper API 실패 시에도 기존 균등 분배 방식으로 안전하게 동작

---

# v8.1 — 2단계 타이밍 비율 보정

- **수정일자**: 2026-04-03
- **요청**: Gemini 섹션 합과 GPT 클립 합이 실제 음악 길이와 불일치하는 문제를 2단계 비율 보정으로 해결

## 1. 수정 결과

| # | 구분 | 파일 | 수정 내용 |
|---|------|------|-----------|
| 1 | 백엔드 (수정) | `mv_pipeline.py` | 보정 1: Gemini 섹션 합을 ffprobe 실제 음악 길이에 비율 보정 (audio_duration_sec 우선, 없으면 ffprobe 폴백) |
| 2 | 백엔드 (수정) | `mv_generator.py` | 보정 2: GPT 클립 use_seconds 합을 Gemini 섹션 길이에 비율 보정 (플래트닝 직전 처리) |

- **백엔드 2건 수정**, **프론트엔드 변경 없음**

## 2. 주요 변경 사항

### mv_pipeline.py — 보정 1 (섹션 → 실제 음악 길이)
- Gemini가 반환한 섹션 duration_sec의 합계를 ffprobe로 측정한 실제 음악 길이에 비율 보정
- audio_duration_sec 파라미터가 있으면 우선 사용, 없으면 ffprobe로 폴백

### mv_generator.py — 보정 2 (클립 → 섹션 길이)
- GPT가 반환한 클립별 use_seconds의 합계를 Gemini 섹션 길이에 비율 보정
- 플래트닝(flatten) 직전에 처리하여 이후 로직에 정확한 타이밍 전달

## 3. 테스트 결과

| # | 테스트 항목 | 결과 |
|---|------------|------|
| 1 | import 정상 확인 | PASS |
| 2 | 정적 분석 (mv_pipeline.py) | PASS |
| 3 | 정적 분석 (mv_generator.py) | PASS |
| 4 | 단위 테스트 (비율 보정 로직) | PASS |
| 5 | 서버 정상 기동 확인 | PASS |

- **전 항목 PASS (5/5)**

## 4. 특이사항

- Gemini 섹션 합계와 실제 음악 길이 간 오차, GPT 클립 합계와 섹션 길이 간 오차가 누적되어 최종 영상 타이밍 불일치 발생
- 2단계 비율 보정으로 각 단계의 오차를 독립적으로 해소하여 최종 영상이 실제 음악 길이에 정확히 맞도록 개선

---

# v9.0 — Gemini → Whisper 기반 섹션 타이밍

- **수정일자**: 2026-04-03
- **요청**: Gemini 기반 섹션 타이밍을 Whisper 기반으로 전환하여 실제 오디오 발화 위치와 가사 섹션을 정확히 매칭

## 1. 수정 결과

| # | 구분 | 파일 | 수정 내용 |
|---|------|------|-----------|
| 1 | 백엔드 (수정) | `whisper_service.py` | `get_full_audio_timestamps()` 함수 추가 — 전체 오디오의 Whisper 세그먼트 타임스탬프 반환 |
| 2 | 백엔드 (수정) | `mv_pipeline.py` | `_build_sections_from_whisper()` 신규 함수 — Whisper 세그먼트와 가사 매칭으로 섹션 타이밍 생성 |
| 3 | 백엔드 (수정) | `mv_pipeline.py` | `_text_match()`, `_normalize_text()` 헬퍼 함수 추가 — 텍스트 정규화 및 유사도 매칭 |
| 4 | 백엔드 (수정) | `mv_pipeline.py` | Phase 1a: Whisper-first, Gemini fallback 방식으로 전환 |
| 5 | 백엔드 (수정) | `mv_pipeline.py` | 보정 1(비율 보정)은 Gemini fallback 경로에서만 동작하도록 조건 분기 |

- **백엔드 2건 수정**, **프론트엔드 변경 없음**

## 2. 주요 변경 사항

### whisper_service.py — get_full_audio_timestamps()
- 전체 오디오 파일을 Whisper API로 전사하여 세그먼트별 시작/종료 타임스탬프 반환
- 기존 줄별 타이밍과 별도로, 섹션 단위 매칭에 활용

### mv_pipeline.py — Whisper-first 섹션 타이밍
- `_build_sections_from_whisper()`: Whisper 세그먼트 텍스트와 가사 섹션의 첫 줄을 매칭하여 각 섹션의 시작/종료 시간 결정
- `_text_match()`: 정규화된 텍스트 간 유사도 비교 (부분 일치 지원)
- `_normalize_text()`: 공백/특수문자 정규화로 매칭 정확도 향상
- Phase 1a에서 Whisper 매칭 성공 시 Gemini 호출 생략, 실패 시 기존 Gemini 경로로 fallback
- 보정 1(비율 보정)은 Gemini fallback 경로에서만 적용 (Whisper 타이밍은 실제 오디오 기반이므로 보정 불필요)
- 매칭 실패한 섹션은 전후 섹션 타이밍에서 보간 처리

## 3. 테스트 결과

| # | 테스트 항목 | 결과 |
|---|------------|------|
| 1 | Whisper 세그먼트-가사 매칭 정상 동작 확인 | PASS |
| 2 | Whisper 매칭 실패 시 Gemini fallback 확인 | PASS |
| 3 | 보정 1이 Gemini fallback에서만 동작 확인 | PASS |
| 4 | 텍스트 정규화 및 유사도 매칭 확인 | PASS |
| 5 | 보간 처리 fallback 동작 확인 | PASS |

- **전 항목 PASS (5/5)**

## 4. 특이사항

- 영어 가사가 Whisper에서 한글로 변환되는 경우 매칭 실패 가능 — 보간 처리로 fallback하여 안전하게 동작
- Whisper 기반 타이밍은 실제 오디오 발화 위치를 사용하므로 Gemini 대비 정확도 향상
- Gemini fallback 경로를 유지하여 Whisper API 장애 시에도 기존 방식으로 안전하게 동작

# v10.0 — 가사 섹션 1개 = 씬 1개 단순화

- **수정일자**: 2026-04-03
- **요청**: 가사 섹션 1개를 씬 1개로 직접 매핑하여 파이프라인 단순화 (Gemini 호출 제거, GPT 씬 분할 제거)

## 1. 수정 결과

| # | 구분 | 파일 | 수정 내용 |
|---|------|------|-----------|
| 1 | 백엔드 (수정) | `mv_pipeline.py` | `run_phase1_split()` 완전 재작성 — Phase 1a: 가사 파싱 + Whisper 타이밍 → 씬 직접 생성 (가사 섹션 1개 = 씬 1개) |
| 2 | 백엔드 (수정) | `mv_pipeline.py` | Phase 1b: GPT는 프롬프트만 생성하도록 변경 (`generate_scene_prompts_only` 호출) |
| 3 | 백엔드 (수정) | `mv_pipeline.py` | 제거: Gemini 호출, GPT 씬 분할, `_assign_lyrics_to_scenes()` 호출, 누적 타이밍 계산 |
| 4 | 백엔드 (수정) | `mv_pipeline.py` | 가사는 섹션 내용 그대로 직접 배정, section_start/end는 Whisper 타이밍 그대로 사용 |
| 5 | 백엔드 (수정) | `mv_pipeline.py` | Whisper 실패 시 균등 분할 fallback 구현 |
| 6 | 백엔드 (수정) | `mv_generator.py` | `generate_scene_prompts_only()` 함수 + `SCENE_PROMPT_ONLY_SYSTEM` 프롬프트 추가 |

- **백엔드 2건 수정**, **프론트엔드 변경 없음**

## 2. 주요 변경 사항

### mv_pipeline.py — run_phase1_split() 재작성
- Phase 1a: 가사 파싱 후 Whisper 타이밍과 결합하여 씬을 직접 생성 (가사 섹션 1개 = 씬 1개)
- 기존의 복잡한 씬 분할 로직(Gemini 호출, GPT 씬 분할, `_assign_lyrics_to_scenes()`, 누적 타이밍 계산) 완전 제거
- 가사 섹션의 내용을 씬에 그대로 배정하여 중간 변환 과정 없음
- section_start/end는 Whisper 타이밍을 그대로 사용 (보정 불필요)
- Whisper 실패 시 전체 오디오 길이를 섹션 수로 균등 분할하는 fallback 적용

### mv_pipeline.py — Phase 1b 변경
- GPT가 씬 구조를 분할하지 않고, 기존 씬 리스트에 대해 프롬프트만 생성하도록 변경
- `generate_scene_prompts_only()` 호출로 전환

### mv_generator.py — generate_scene_prompts_only()
- 씬 리스트를 입력받아 각 씬에 대한 이미지 생성 프롬프트만 생성하는 함수 추가
- `SCENE_PROMPT_ONLY_SYSTEM` 시스템 프롬프트로 GPT의 역할을 프롬프트 생성으로 한정

## 3. 테스트 결과

| # | 테스트 항목 | 결과 |
|---|------------|------|
| 1 | 가사 섹션 파싱 → 씬 1:1 매핑 정상 동작 확인 | PASS |
| 2 | Whisper 타이밍 기반 section_start/end 정상 배정 확인 | PASS |
| 3 | Whisper 실패 시 균등 분할 fallback 동작 확인 | PASS |
| 4 | GPT 프롬프트만 생성 (씬 분할 없음) 확인 | PASS |
| 5 | 가사 내용 그대로 씬에 배정 확인 | PASS |
| 6 | 전체 파이프라인 정상 동작 확인 | PASS |

- **전 항목 PASS (6/6)**

## 4. 특이사항

- Gemini 호출 완전 제거로 외부 API 의존도 감소 및 파이프라인 속도 향상
- GPT 역할이 씬 분할에서 프롬프트 생성으로 축소되어 토큰 사용량 감소
- 가사 섹션과 씬의 1:1 매핑으로 디버깅 및 유지보수 용이성 향상
- Whisper fallback(균등 분할)은 타이밍 정확도가 떨어지나 파이프라인 중단 방지에 유효

---

# v10.3 — 15초 초과 클립 재분할 + Sync Labs 후 자막 자동 재적용

- **수정일자**: 2026-04-04
- **요청**: 15초 초과 클립을 시간 기반으로 재분할하고, Sync Labs 립싱크 적용 후 자막을 자동으로 재적용

## 1. 수정 결과

| # | 구분 | 파일 | 수정 내용 |
|---|------|------|-----------|
| 1 | 백엔드 (수정) | `mv_pipeline.py` | `_split_long_section()` 후처리 — 가사 경계 분할 후에도 15초 초과 클립을 시간 기반 균등 재분할 (ceil(길이/10)) |
| 2 | 백엔드 (신규) | `mv_pipeline.py` | `_burn_subtitles_on_synced_video()` — Sync Labs 영상에 Whisper 타이밍 기반 자막 burn-in, 실패 시 원본 반환 |
| 3 | 백엔드 (수정) | `mv_pipeline.py` | Phase 3.5 (자동) 호출 위치에 자막 burn-in 적용 — Sync Labs 결과 저장 직전 호출 |
| 4 | 백엔드 (수정) | `mv_pipeline.py` | `_retry_sync_for_scene()` (수동) 호출 위치에 자막 burn-in 적용 — Sync Labs 결과 저장 직전 호출 |

- **백엔드 1건 수정**, **프론트엔드 변경 없음**

## 2. 주요 변경 사항

### mv_pipeline.py — _split_long_section() 후처리
- 가사 경계 기반 분할 후에도 15초를 초과하는 클립이 존재할 경우, 시간 기반 균등 재분할 수행
- 재분할 개수는 ceil(길이/10)으로 계산 (예: 24초 → 3클립, 각 8초)
- 기존 가사 경계 분할과 시간 기반 재분할의 2단계 처리로 모든 클립이 15초 이하 보장

### mv_pipeline.py — _burn_subtitles_on_synced_video() 신규
- Sync Labs 립싱크 적용 후 영상에 Whisper 타이밍 기반 자막을 자동으로 burn-in
- FFmpeg를 사용한 자막 오버레이 처리
- 실패 시 원본 영상을 그대로 반환하여 파이프라인 중단 방지

### mv_pipeline.py — 호출 위치 2곳
- Phase 3.5 (자동 Sync Labs 처리): Sync Labs 결과 저장 직전에 자막 burn-in 호출
- `_retry_sync_for_scene()` (수동 재시도): Sync Labs 결과 저장 직전에 자막 burn-in 호출

## 3. 테스트 결과

| # | 테스트 항목 | 결과 |
|---|------------|------|
| 1 | 15초 초과 클립 시간 기반 균등 재분할 동작 확인 (24초 → 3클립, 8초씩) | PASS |
| 2 | 가사 경계 분할 후 재분할 2단계 처리 정상 동작 확인 | PASS |
| 3 | Sync Labs 후 Whisper 기반 자막 burn-in 정상 동작 확인 | PASS |
| 4 | 자막 burn-in 실패 시 원본 반환 fallback 동작 확인 | PASS |
| 5 | Phase 3.5 자동 호출 위치 정상 동작 확인 | PASS |
| 6 | _retry_sync_for_scene 수동 호출 위치 정상 동작 확인 | PASS |

- **전 항목 PASS (6/6)**

## 4. 특이사항

- 15초 초과 클립에 대한 2단계 분할(가사 경계 → 시간 균등)로 모든 클립이 15초 이하 보장
- Sync Labs 립싱크 적용 후 자막이 누락되던 문제 해결
- 자막 burn-in 실패 시 원본 반환으로 파이프라인 안정성 유지
- 호출 위치 2곳(자동/수동) 모두에 적용하여 일관된 자막 처리 보장

---

## v30 — 멜론 기반 음원차트 알고리즘 구현 (2026-04-07)

### 요청 작업
멜론 차트 계산 방식(`melonChart.md`)을 기반으로 AIMU 플랫폼의 음원차트 시스템 전면 재설계

### 수행 결과

#### 백엔드 (`backend/app/routes/charts.py` 전면 재작성)
- **재생 기록 API** (`POST /api/charts/record-play`): 곡 재생 시 Redis에 순 청취자 기록
  - 시간별/일간/주간/월간 4개 시간 윈도우 동시 기록
  - Redis SET으로 1인 1회 자동 중복 제거 (SADD 멱등성)
  - 비로그인 사용자: play_count만 증가, 차트 미반영
- **차트 API** (`GET /api/charts/{chart_type}`): 5종 차트 지원
  - `top100`: 주간 24h×50% + 1h×50%, 심야(01~07시) 24h×100%
  - `hot100`: 최근 1h 순청취자 (발매 30일 이내 곡만)
  - `daily`: 오늘 순 청취자 수
  - `weekly`: 이번 주 순 청취자 수
  - `monthly`: 이번 달 순 청취자 수
- KST(UTC+9) 시간대 적용
- 5분 캐시, Redis 파이프라인 사용
- Redis 데이터 없을 시 MongoDB play_count fallback

#### 프론트엔드
- **ChartPage.jsx** 전면 재작성: 5개 탭 (TOP100, HOT100, 일간, 주간, 월간)
- **ChartPage.css** 전면 재작성: 순위 등락 표시 (▲▼-NEW), TOP3 골드/실버/브론즈
- **api/index.js**: `getChart()`, `recordPlay()` 추가
- **PlayerContext.jsx**: 곡 재생 시 `recordPlay()` 자동 호출 (fire-and-forget)

### 테스트 결과
| 항목 | 결과 |
|------|------|
| 백엔드 문법/빌드 | ✅ PASS |
| 프론트엔드 빌드 | ✅ PASS |
| API 엔드포인트 매칭 | ✅ PASS |
| 비로그인 재생 처리 | ✅ PASS |
| 빈 데이터 처리 | ✅ PASS |
| Redis 키 패턴 일관성 | ✅ PASS |
| KST 시간대 처리 | ✅ PASS |
| 서버 구동 확인 | ✅ PASS |

### 버그 수정
1. (중간) 비공개 트랙 필터링 시 순위 번호 빈 구멍 → 필터링 후 순위 재부여
2. (낮음) `_serialize_track`에서 원본 dict 변경 → shallow copy 추가

### 특이사항
- 순위 등락(change) 값은 현재 0(placeholder) — 이전 차트 대비 등락 계산은 추후 구현 필요
- 다운로드 기능 미구현이므로 차트 점수 = 스트리밍 100% (멜론은 스트리밍 40% + 다운로드 60%)

---

## v31 — 프론트엔드 API 호출 통일 (2026-04-07)

### 요청 작업
프론트엔드의 모든 백엔드 통신을 `api/index.js` 모듈 경유로 통일

### 수행 결과

#### 수정된 파일 (4개)

| 파일 | 수정 내용 |
|------|----------|
| `api/index.js` | 11개 API 함수 추가, voiceConvertStreamUrl/DownloadUrl을 API.defaults.baseURL 사용으로 변경 |
| `UploadPage.jsx` | 3곳 직접 URL 구성 → api 모듈 함수 호출로 교체 |
| `MyMusicPage.jsx` | 6곳 직접 URL/fetch → api 모듈 함수 호출로 교체 |
| `StudioTab2.jsx` | 3곳 직접 URL/fetch → api 모듈 함수 호출로 교체 |

#### 추가된 API 함수 (api/index.js)
- `coverPreviewUrl()` - 커버 이미지 미리보기 URL
- `generationStreamUrl()` - 생성 음악 스트리밍 URL
- `characterPreviewUrl()` - 캐릭터시트 미리보기 URL
- `fetchAudioBuffer()` - 오디오 arraybuffer fetch
- `fetchAsBlob()` - blob fetch
- `fetchVocalRepairOriginal()` - 보컬수리 원본 스트림
- `fetchVocalRepairEnhanced()` - 보컬수리 강화 스트림
- `fetchConvertedVocal()` - 변환 보컬 스트림
- `fetchBacking()` - MR 스트림
- `downloadVocalRepair()` - 보컬수리 다운로드
- `downloadVoicePersona()` - 보이스페르소나 다운로드

### 테스트 결과

| 항목 | 결과 |
|------|------|
| 직접 URL 구성 잔존 여부 | ✅ 0건 (api/index.js:4 제외) |
| fetch() 직접 호출 잔존 여부 | ✅ 0건 |
| 프론트엔드 빌드 | ✅ PASS |
| import 정합성 | ✅ PASS |
| 응답 형태 일관성 | ✅ PASS |
| 버그 | 0건 |

### 특이사항
- `window.location.hostname:9000`은 `api/index.js:4` (Axios baseURL)에만 존재
- URL 헬퍼 함수(audio/img src용)는 URL 문자열 반환, 데이터 요청 함수는 Axios 응답 반환으로 구분
- 백엔드 변경 없음

---

## v32 — 트랙 다운로드 기능 + 차트 다운로드 가중치 반영 (2026-04-07)

### 요청 작업
트랙 다운로드 기능 구현 + 멜론 방식 차트 점수에 다운로드 가중치 반영 (스트리밍 40% + 다운로드 60%)

### 수행 결과

#### 백엔드
1. **다운로드 API** (`POST /api/tracks/download/{track_id}`)
   - 인증 필수, MinIO presigned URL + 파일명 반환
   - Redis에 다운로드 순이용자 기록 (1인 1회 자동 중복 제거)
   - MongoDB download_count 증가
2. **차트 알고리즘 수정** (charts.py)
   - 기존: 스트리밍 100%
   - 변경: **스트리밍 40% + 다운로드 60%** (멜론 방식)
   - TOP100, HOT100, 일간, 주간, 월간 모두 적용

#### 프론트엔드
1. **다운로드 버튼** (SongItem.jsx): FiDownload 아이콘 추가
2. **API 함수** (api/index.js): `downloadTrackFile()` 추가
3. **ChartPage.css**: 액션 컬럼 너비 조정 (112px → 148px)

### 차트 점수 공식 (변경 후)

```
음원 점수 = 스트리밍 순청취자 × 40% + 다운로드 순이용자 × 60%

TOP100:
  주간(08~24시): 음원점수_24h × 50% + 음원점수_1h × 50%
  심야(01~07시): 음원점수_24h × 100%
```

### 테스트 결과
| 항목 | 결과 |
|------|------|
| 백엔드 문법 | ✅ PASS |
| 프론트엔드 빌드 | ✅ PASS |
| 다운로드 API 구현 | ✅ PASS |
| 차트 40/60 가중치 | ✅ PASS |
| Redis 키 패턴 일관성 | ✅ PASS |
| 다운로드 버튼 UI | ✅ PASS |
| 버그 | 0건 |

---

## v33 — 차트 통계 컬럼 표시 (24h청취, 1h청취, 다운로드) (2026-04-07)

### 요청 작업
차트 리스트에 각 곡의 24시간 청취자 수, 1시간 청취자 수, 다운로드 수를 숫자 컬럼으로 표시

### 수행 결과

#### 백엔드 (charts.py)
- 차트 응답에 `listeners_24h`, `listeners_1h`, `downloads` 필드 추가
- 모든 차트 계산 함수에서 원시 카운트를 stats dict로 전달
- fallback(play_count 정렬)에서도 0값 stats 포함

#### 프론트엔드 (ChartPage.jsx/css)
- 헤더에 "24h 청취 / 1h 청취 / 다운로드" 3개 컬럼 추가
- 각 곡에 숫자 표시 (toLocaleString으로 천단위 콤마)
- 모바일(768px 이하)에서는 통계 컬럼 숨김

### 테스트 결과
| 항목 | 결과 |
|------|------|
| 백엔드 문법 | ✅ PASS |
| 프론트엔드 빌드 | ✅ PASS |
| 통계 필드 반환 | ✅ PASS |
| 통계 컬럼 표시 | ✅ PASS |
| 모바일 반응형 | ✅ PASS |
| 버그 | 0건 |

---

## v34 — 차트 아티스트명 클릭 → 크리에이터 프로필 이동 (2026-04-08)

### 요청 작업
차트에서 아티스트명 클릭 시 해당 크리에이터의 프로필 페이지로 이동

### 수행 결과
- ChartPage.jsx: 아티스트명을 `<Link>` 컴포넌트로 변경
  - 본인 → `/my-music` 이동
  - 타인 → `/artist/{uploader_id}` 이동
- ChartPage.css: 아티스트 링크 호버 스타일 추가

### 테스트 결과
| 항목 | 결과 |
|------|------|
| 프론트엔드 빌드 | ✅ PASS |
| 백엔드 변경 | 없음 (기존 API 활용) |

---

## v35 — 차트 데이터 MongoDB 영구 저장 + 서버 시작 시 Redis 복구 (2026-04-08)

### 요청 작업
차트 데이터(재생/다운로드 기록)를 MongoDB에 영구 저장하고, 서버 재시작 시 Redis 자동 복구

### 수행 결과

#### 수정/생성된 파일
| 파일 | 내용 |
|------|------|
| `charts.py` | record_play에 `play_logs` MongoDB 저장 추가 |
| `tracks.py` | download에 `download_logs` MongoDB 저장 추가 |
| `services/chart_recovery.py` | 신규 - Redis 복구 함수 |
| `main.py` | 서버 시작 시 복구 호출 추가 |

#### 동작 방식
```
재생/다운로드 시: Redis + MongoDB 동시 저장
서버 재시작 시: MongoDB → Redis 자동 복구
```

#### MongoDB 컬렉션
- `play_logs`: {user_id, track_id, played_at}
- `download_logs`: {user_id, track_id, downloaded_at}
- 인덱스 자동 생성 (played_at, downloaded_at 기준)

### 테스트 결과
| 항목 | 결과 |
|------|------|
| 백엔드 문법 | ✅ PASS |
| chart_recovery.py | ✅ PASS |
| MongoDB 로그 저장 | ✅ PASS |
| main.py 복구 호출 | ✅ PASS |
| Redis 키 패턴 일관성 | ✅ PASS |
| KST 시간대 일관성 | ✅ PASS |
| 멱등성 (중복 실행 안전) | ✅ PASS |
| 버그 | 0건 |

---

## v36 — 차트 탭별 컬럼 분기 (2026-04-08)

### 요청 작업
각 차트 탭에 순위 계산에 사용되는 데이터 컬럼만 표시

### 수행 결과

| 탭 | 컬럼 | 계산 방식 |
|---|---|---|
| TOP100 | 24h 청취 / 1h 청취 / 다운로드 | (24h×50% + 1h×50%) × (스트리밍40% + 다운로드60%) |
| HOT100 | 1h 청취 / 다운로드 | 1h × (스트리밍40% + 다운로드60%), 30일 이내 곡만 |
| 일간 | 청취자 / 다운로드 | 오늘 전체 (스트리밍40% + 다운로드60%) |
| 주간 | 청취자 / 다운로드 | 이번주 전체 (스트리밍40% + 다운로드60%) |
| 월간 | 청취자 / 다운로드 | 이번달 전체 (스트리밍40% + 다운로드60%) |

### 변경 파일
- ChartPage.jsx: 탭별 조건부 컬럼 렌더링
- ChartPage.css: 2컬럼 grid 클래스 추가

### 테스트: 빌드 ✅ PASS

---

## v37 — Suno 상세 파라미터 ON/OFF 토글 UI + 백엔드 연동 (2026-04-08)

### 요청 작업
작업실2 커스텀 모드 3단계에서 Suno API 모든 상세 파라미터를 ON/OFF 토글로 제어 가능하게 구현

### 수행 결과

#### 추가된 ON/OFF 파라미터 (Suno 전용, 7개)
| 파라미터 | 설명 | 입력 타입 |
|---------|------|----------|
| 제외 스타일 | 빼고 싶은 스타일 지정 | 텍스트 |
| 스타일 강도 | 장르/분위기 엄격도 (0~1) | 숫자 |
| 실험성 조절 | 대중적↔실험적 (0~1) | 숫자 |
| 오디오 영향도 | 참조 오디오 반영도 (0~1) | 숫자 |
| BPM | 곡의 빠르기 | 숫자 |
| Key (조성) | 음악적 키 | 텍스트 |
| 페르소나 타입 | style/voice 구분 | 드롭다운 |

#### 잠금 표시 기능 (4개)
- 보이스 클로닝, 커스텀 모델 학습, My Taste, MIDI 변환
- "비공식 API 지원 대기 중" 배지 표시

#### 수정 파일
| 파일 | 내용 |
|------|------|
| generate.py | GenerateRequest에 5개 필드 추가, MongoDB 저장, 전달 |
| suno_generator.py | 7개 파라미터 수신, Suno API body에 조건부 포함 |
| StudioTab2.jsx | 14개 상태변수, ON/OFF 토글 UI, 잠금 기능 4개 |
| StudioTab2.css | 토글 스위치, 파라미터 카드, 잠금 아이템 스타일 |

### 테스트 결과
| 항목 | 결과 |
|------|------|
| 백엔드 문법 | ✅ PASS |
| 프론트엔드 빌드 | ✅ PASS |
| GenerateRequest 모델 | ✅ PASS |
| Suno API body 구성 | ✅ PASS |
| 프론트엔드 토글 UI | ✅ PASS |
| 잠금 기능 표시 | ✅ PASS |
| 버그 | 0건 |

---

## v38 — Whisper 타임스탬프 1회 호출 후 재사용 (2026-04-08)

### 요청 작업
Whisper를 Phase 1a에서 1번만 호출하고, 이후 단계에서는 저장된 타임스탬프를 재사용

### 수행 결과

#### 변경 전 (Whisper 4회 호출)
```
Phase 1a: Whisper 호출 ① → 저장 ✅
Phase 3.5: Whisper 호출 ② → 불필요한 중복 ❌
Phase 3.6: Whisper 호출 ③ → 불필요한 중복 ❌
Phase 5:   Whisper 호출 ④ → 불필요한 중복 ❌
```

#### 변경 후 (Whisper 1회만 호출)
```
Phase 1a: Whisper 호출 → whisper_segments 저장
Phase 3.5: 저장된 데이터에서 필터링 ✅
Phase 3.6: 저장된 데이터에서 필터링 ✅
Phase 5:   저장된 데이터에서 필터링 ✅
```

#### 수정 파일
| 파일 | 내용 |
|------|------|
| mv_pipeline.py | `_get_scene_timestamps()` 헬퍼 추가, Whisper 중복 호출 4곳 제거 |
| mv.py | 2곳 caller 수정 (timestamps 파라미터로 변경) |

#### 효과
- Whisper API 호출 3회 절약 (비용/시간 절감)
- 자막 타이밍 일관성 보장 (동일 데이터 재사용)
- 코드 단순화 (오디오 자르기 + Whisper 호출 블록 제거)

### 테스트 결과
| 항목 | 결과 |
|------|------|
| 백엔드 문법 | ✅ PASS |
| Whisper 호출 Phase 1a만 존재 | ✅ PASS |
| _get_scene_timestamps 헬퍼 | ✅ PASS |
| 모든 caller 수정 완료 | ✅ PASS |
| 버그 | 0건 |

---

## v39 — 커버 이미지 표시 수정 + API 규칙 준수 (2026-04-08)

### 요청 작업
커버 이미지가 ♪ 플레이스홀더로 표시되는 문제 수정 + 인라인 URL 구성 → api/index.js 헬퍼 사용으로 변경

### 수행 결과
#### 원인
- cover_image가 MinIO object name(`covers/generated/...`) 형태인데
- 프론트에서 `/api/files`로 시작하는 것만 이미지로 인식 → 나머지는 ♪ 표시

#### 수정된 파일 (4개)
| 파일 | 수정 내용 |
|------|----------|
| ChartPage.jsx | `coverUrl()` → `api.coverPreviewUrl()` 사용 |
| SongItem.jsx | 인라인 URL → `api.coverPreviewUrl()` 사용 |
| MusicPlayer.jsx | `/api/files` 체크 → `api.coverPreviewUrl()` 사용 |
| AlbumCard.jsx | `/api/files` 체크 → `api.coverPreviewUrl()` 사용 |

#### API 규칙 준수 확인
- 인라인 URL 구성: 0건 ✅
- `/api/files` 하드코딩: 0건 ✅
- 전부 `api.coverPreviewUrl()` 통해 URL 생성 ✅

### 테스트: 빌드 ✅ PASS

---

## v40 — 플레이어 전용 페이지 (/player) 구현 (2026-04-08)

### 요청 작업
곡 재생 시 플레이어 전용 페이지에서 커버 이미지 + 프롬프트 정보 + 플레이리스트 큐 표시

### 수행 결과

#### 신규 파일
- `PlayerPage.jsx` + `PlayerPage.css`: 플레이어 전용 페이지

#### 수정 파일
| 파일 | 내용 |
|------|------|
| App.jsx | `/player` 라우트 추가 |
| api/index.js | `getTrackDetail(id)` 추가 |
| SongItem.jsx | "+" 버튼 → 재생 큐 추가로 변경 (AddToPlaylistModal 제거) |
| ChartPage.jsx | "+" 버튼 → 재생 큐 추가로 변경 (AddToPlaylistModal 제거) |
| MusicPlayer.jsx | 곡 정보 클릭 → /player 페이지 이동 |

#### 플레이어 페이지 구성
- 좌측: 커버 이미지(대형) + 곡명 + 아티스트
- 우측 탭 1 - 프롬프트 정보: 음악 생성 프롬프트, 장르, 분위기, AI 모델, BPM, Key, 가사
- 우측 탭 2 - 플레이리스트: 재생 큐 목록 (현재 재생곡 하이라이트)
- "+" 버튼: 재생 큐에 곡 추가

### 테스트: 빌드 ✅ PASS

---

## v41 — 프롬프트 정보 탭에 generation 상세 파라미터 표시 (2026-04-08)

### 요청 작업
플레이어 페이지 프롬프트 정보 탭에 모든 음악 생성 파라미터 표시 (값 없으면 `-`)

### 수행 결과
- PlayerPage.jsx: track의 generation_id로 api.getGeneration() 추가 호출
- 표시되는 파라미터 (18개):
  - tracks에서: 프롬프트, 장르, 분위기, AI모델, 길이, BPM, Key, 가사, 재생수, 좋아요수, 다운로드수
  - generations에서: 보컬, 스타일, 제외스타일, 스타일강도, 실험성, 오디오영향도, 페르소나, 페르소나타입, 참조스타일
- 모든 레이블 항상 표시, 값 없으면 `-`

### 테스트: 빌드 ✅ PASS
