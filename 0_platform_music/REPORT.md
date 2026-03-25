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
