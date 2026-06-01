# MV Wedding — REPORT

## v37 — 2026-06-01 — wizard mount useEffect race condition 가드 (step 강제 튐 버그 픽스)

### 버그
"5단계에서 [이전] 누르면 4단계로 가야 하는데 1단계로 빈 화면이 떴다."

### 원인
`StoryWizardPage.jsx` 마운트 useEffect 가 비동기 `api.getMyDraft()` 응답을 받을 때 **무조건** `setStep` / `setData` 호출. 사용자가 그 사이 step 진행 + 입력 + [이전] 누른 상태였어도 stale 응답이 도착하면 그냥 덮어쓰기 → step 1 + 빈 화면 강제 진입.

### 변경

| 위치 | 변경 |
|---|---|
| `pages/StoryWizardPage.jsx` mount useEffect | `setStep` / `setData` 를 **functional updater** 로 변경. `cur > 1` (사용자 step 진행) 또는 `hasUserInput(cur)` (sheets face / couple name / story meeting / current_job_id) 이면 stale 응답 무시 |

### 가드 동작

```
응답 도착 시:
  setStep((cur) => cur > 1 ? cur : validatedDraftStep)
  setData((cur) => hasUserInput(cur) ? cur : merged)
```

- 사용자가 빈 wizard 진입 + 가만히 → 응답으로 정상 복원
- 사용자가 입력하거나 step 진행 → 응답 도착해도 **현재 상태 보존**

### 검증
- 구조 grep — `v37` 가드 4곳 적용 ✅
- Vite HMR — 자동 리로드 ✅

### 회귀
- outfit round-trip — sessionStorage rehydrate 우선, mount useEffect 가 hasSession=true 면 자체 return (기존 그대로) ✅
- `?new=1` — backend draft 삭제 + 빈 wizard (기존 그대로) ✅

---

## v36 — 2026-06-01 — 장소 owner 분리 (draft vs 잡) + 작품 선택 삭제

### 요청
[새로 만들기] = 장소도 0개. [작성중 카드 클릭] = 그 draft 의 장소 복원. 잡 생성 시 장소가 그 잡 소유로 이전. + "내 작품" 카드 **선택 삭제**.

### 변경 요약

**백엔드 — 장소 owner 모델**
| 위치 | 변경 |
|---|---|
| `routes/places.py POST /generate` | asset_doc 에 `meta.mv_job_id = None` 추가 (draft 단계) |
| `routes/places.py POST /upload` | 동일 |
| `routes/places.py GET ""` | filter 에 `meta.mv_job_id` null/없음 조건 추가 — wizard(draft) 컨텍스트만 반환 |
| `routes/mv.py POST /jobs` | 잡 INSERT 직후 `update_many` 로 그 user 의 draft 장소들에 `meta.mv_job_id=new_job_id` 박음 |
| `routes/mv.py DELETE /jobs/{id}` (신설) | 잡 + 그 잡 자산 cleanup. owner 가드 + 진행 중(`generating_*`) 409 |
| `routes/mv_drafts.py DELETE /mine` | draft 단계 장소(`mv_job_id` null) 도 `delete_many` cleanup |

**프론트엔드**
| 위치 | 변경 |
|---|---|
| `api/index.js` | `deleteMVJob(jobId)` |
| `pages/MyWeddingMVPage.jsx` | (a) 선택 모드 toggle. (b) 카드별 체크박스. (c) [선택 삭제] 버튼 (빨강) + confirm + 순차 DELETE. (d) 선택된 카드 outline 표시 |

### 흐름 매트릭스

| 케이스 | 동작 |
|---|---|
| wizard 진입 (작성중) | 장소 패널: `meta.mv_job_id` null 인 user 장소만 |
| 작성중 → 장소 추가 | INSERT with `meta.mv_job_id=None` |
| 잡 생성 (가사 시작) | 그 user 의 draft 장소들 → `meta.mv_job_id=new_job_id` 로 transfer |
| [내 작품] → [새로 만들기] (draft 있음) | confirm → `deleteMyDraft` → 백엔드가 draft + draft 장소 cleanup |
| [내 작품] → [작성중 카드] | wizard 재진입 → draft 장소 그대로 보임 (mv_job_id null) |
| [내 작품] → [☐ 선택 삭제] | 선택 모드 진입. 카드별 체크박스 노출 |
| [선택 삭제] (1개 이상 선택 시) | confirm → 순차 `deleteMVJob` → 잡 + 그 잡 장소 같이 삭제 |

### 테스터 검증 (모두 PASS)

```
T1: DELETE /api/mv/jobs/{job_id} 등록                  ✅
T1: DELETE /api/mv/drafts/mine 등록                    ✅
T2: places generate/upload meta.mv_job_id=None         ✅
T3: list_places filter mv_job_id null                  ✅
T4: 잡 생성 시 transferred + DELETE /jobs/{id} 신설    ✅
T5: mv_drafts DELETE 시 draft 장소 cleanup             ✅
프론트 wiring: api.deleteMVJob + selectMode + handleBulkDelete ✅
```

### 보안 / 가드
- `DELETE /jobs/{id}` — owner 검증, 진행 중(`queued`/`generating_*`) 409
- 모든 cleanup 은 user_id 일치 조건 필수

### 비범위
- 캐릭터 시트 동일 패턴 (재사용 위해 user 영구 자산 유지)
- 잡 별 장소 조회 UI (GenerationStatusPage 에 장소 패널 추가) — 추후
- 다중 동시 draft (1명당 1개 정책)

---

## v35 — 2026-06-01 — 작품 1건 정책: lyrics/music 덮어쓰기 + GenerationStatus [이전 수정] 버튼

### 요청
가사·음악 생성 후 별로면 이전 단계로 돌아가 수정 → 다시 생성하면 **같은 job 안의 lyrics/music 갈아엎기**. 새 job 안 만듦. 생성 중 [← 이전] 비활성.

### 변경

**백엔드**
| 위치 | 변경 |
|---|---|
| `routes/mv.py` (신설) | `POST /api/mv/jobs/{job_id}/regenerate` — body `{story_id, music_spec}`. owner 가드 + 진행 중(`generating_*`) 409 거부. 기존 lyrics/audio_variants/error 초기화 + `_run_lyrics_generation` 백그라운드 시작 |

**프론트엔드**
| 위치 | 변경 |
|---|---|
| `api/index.js` | `regenerateMVJob(jobId, {story_id, music_spec})` |
| `pages/StoryWizardPage.jsx` | (a) `data.current_job_id` 보관 + draft 영속화에 자동 포함. (b) `onGenerate` 분기: `current_job_id` 있으면 `regenerateMVJob`, 없으면 `createMVJob`. 새 잡이면 받은 id 를 state 에 저장. (c) 마운트 useEffect 가 `location.state.resume_job_id` 받으면 `current_job_id` 복원 |
| `pages/GenerationStatusPage.jsx` | [← 이전 (수정)] 버튼 추가. `disabled = isWorking` (queued/generating_lyrics/generating_music 중 비활성). 클릭 시 `navigate('/wizard', { state: { resume_job_id: id } })` |

### 흐름 매트릭스

| 상황 | 동작 |
|---|---|
| 첫 [가사 생성 시작] | `createMVJob` → 새 job_id → wizard state 저장 + `/projects/{id}` navigate |
| 진행 중 GenerationStatus | [← 이전 (수정)] **비활성** (회색, title="생성이 끝난 뒤에 활성화돼요") |
| 완료(`music_ready`) 후 | [← 이전 (수정)] **활성** → `/wizard` (location.state.resume_job_id 포함) |
| wizard 진입 후 수정 → [생성] | `current_job_id` 있음 → **regenerate** (같은 job, lyrics/music 덮어쓰기) → 같은 `/projects/{id}` 로 |
| "내 작품" | 시도 회수 무관 카드 **1장만** 유지 |

### 검증 (모두 PASS)

```
T1: POST /api/mv/jobs/{job_id}/regenerate 등록             ✅
api.regenerateMVJob 함수                                   ✅
wizard current_job_id state + regenerate 호출 + resume 복원  ✅
GenStatus 이전 버튼 + disabled 분기 + navigate.state 전달    ✅
```

### 디버깅 로그
- `[MVRoute] /regenerate entry/ok/busy(409)/forbidden`
- `[StoryWizard] regenerateMVJob {job_id}` / `createMVJob (first)` / `resume_job_id received`
- `[GenStatus] back-to-wizard {job_id, status}`

### 비범위
- step 5 안에서 결과 직접 청취 (UI 큰 재구성 — v36 후보)
- 자동 음악 트리거 (가사 ready 시 즉시 음악)
- 다중 동시 진행 잡

---

## v34 — 2026-06-01 — 장소 자산 "새로 생성" 덮어쓰기 + 큰 후보 미리보기

### 요청
같은 장소 슬롯에서 [이미지 생성] 다시 누르면 새 자산이 별도 항목으로 추가 → 중복. 새 후보를 크게 보여주고 [덮어쓰기]/[취소] 선택받기. 승인 시 기존 자산 삭제, 취소 시 새 자산 삭제.

### 변경

| 위치 | 변경 |
|---|---|
| `components/PlaceOverwriteModal.jsx` (신설) | 좌(기존) ↔ 우(후보) 큰 미리보기 모달. 이미지는 `<ZoomableImage>` (클릭 시 v32 lightbox). ESC = 취소. dim 클릭 무시 (실수 방지) |
| `components/PlaceOverwriteModal.css` (신설) | 50/50 grid, max-width 42vw, max-height 60vh. 720px 이하는 1열 stack |
| `components/PlaceAssetPanel.jsx` | (a) 슬롯에 `pending_candidate` 필드. (b) `handleGenerate` 분기 — `is_draft=false && object_name` 이면 candidate 모드. (c) polling 이 candidate jobs 도 같이 추적. (d) candidate 잡 done → 자동 모달 open. (e) `handleOverwriteConfirm` (DELETE old → slot promote). (f) `handleOverwriteCancel` (DELETE new → slot 유지). (g) 버튼 라벨: 기존 있으면 "새로 생성 (덮어쓰기)" |

**백엔드 변경 없음** — 기존 `POST /places/generate` (INSERT) + `DELETE /places/{id}` 조합으로 처리.

### 분기 매트릭스

| 케이스 | 동작 |
|---|---|
| 빈 슬롯 [이미지 생성] | 기존 흐름 — 자산 INSERT, 슬롯에 직접 박힘 |
| 기존 슬롯 [새로 생성 (덮어쓰기)] | candidate 자산 INSERT → polling → done → 자동 모달 |
| 모달 [덮어쓰기 확정] | `DELETE /places/{oldId}` → slot 갱신 + mention 풀 갱신 |
| 모달 [취소] | `DELETE /places/{newId}` → slot 그대로 |
| 모달 안 이미지 클릭 | v32 `<ZoomableImage>` lightbox 풀스크린 |
| candidate 잡 실패 | pending_candidate 폐기 + 슬롯에 에러 표시 |

### 미리보기 크기

- 모달 안 max **42vw × 60vh** (좌/우 각각)
- 모달 안에서 이미지 한 번 더 클릭 → v32 lightbox 풀스크린 (92vw × 92vh) 으로 더 크게

### 회귀 검증 (구조 grep — 모두 PASS)

```
imports (ZoomableImage + PlaceOverwriteModal)             ✅
pending_candidate state field                              ✅
setOverwrite + handleOverwriteConfirm/Cancel               ✅
polling 분기 (mode='slot' vs 'candidate')                  ✅
handleGenerate isOverwriteMode 분기                        ✅
<PlaceOverwriteModal> panel return wire                    ✅
Vite HMR 자동 reload                                       ✅
```

### 디버깅 로그
- `[PlaceAssetPanel]:{id} candidate generatePlace start`
- `[PlaceAssetPanel]:{id} overwrite candidate generated`
- `[PlaceAssetPanel]:{id} overwrite confirmed (old=X new=Y)`
- `[PlaceAssetPanel]:{id} overwrite cancelled — deleting candidate`
- `[PlaceOverwriteModal] ESC → cancel`

### 비범위
- 백엔드 `/generate` 에 update 모드 추가 (현재는 INSERT-only + DELETE 조합으로 처리, 자산 무결성 영향 없음)
- 웨딩사진/캐릭터 시트 (캐릭터는 v31 별도 흐름)

---

## v33 — 2026-06-01 — wizard 작성중 draft 백엔드 영속화 + 내작품 작성중 카드

### 요청
sessionStorage 만 의존하던 wizard draft 를 **백엔드 영속화 (c)** 로 격상. "내 작품" 에 작성중 카드 노출. [새로 만들기] = 백지.

### 변경 요약

**백엔드** (신설 컬렉션 + 3 endpoint)
| 위치 | 변경 |
|---|---|
| `routes/mv_drafts.py` (신설) | `APIRouter(prefix="/api/mv/drafts")` — GET/PUT/DELETE `/mine`. upsert + 짧은 user_id 마스킹 로그 |
| `main.py:25-38` (import) + `main.py:124` (include) | `mv_drafts` 라우터 등록 |
| `database/mongodb.py::ensure_indexes` | `mv_drafts` `user_id` unique 인덱스 |

**프론트엔드**
| 위치 | 변경 |
|---|---|
| `api/index.js` | `getMyDraft()` / `saveMyDraft({payload,step,title})` / `deleteMyDraft()` |
| `pages/StoryWizardPage.jsx` | (a) `?new=1` URL 분기 — sessionStorage + backend draft 모두 삭제 후 백지. (b) 마운트 시 sessionStorage 비어있을 때만 `getMyDraft()` 시도 (outfit round-trip 보호). (c) data/step 변경마다 1.5s debounced `saveMyDraft()`. (d) 잡 생성 완료 시 `deleteMyDraft()` |
| `pages/MyWeddingMVPage.jsx` | (a) 마운트 시 `getMVJobs()` + `getMyDraft()` 병렬. (b) draft 있으면 🟡 **작성중** 카드 1개 prepend ("이어서 작성" → `/wizard`). (c) [새로 만들기] 버튼 클릭 → draft 있으면 confirm → 확인 시 `deleteMyDraft()` 후 `/wizard?new=1` |

### 데이터 모델

`mv_drafts` 컬렉션 (user 1명 = draft 1개):
```
{
  _id: ObjectId,
  user_id: str (unique),
  payload: dict,         # wizard data 통째로
  step: int,             # 마지막 작성 단계
  title: Optional[str],  # 작성 중 제목 단서
  created_at, updated_at: datetime
}
```

### REST API

| Method | Path | 동작 | 응답 |
|---|---|---|---|
| GET | `/api/mv/drafts/mine` | 내 draft 조회 | `{draft: {...} \| null}` |
| PUT | `/api/mv/drafts/mine` | upsert | `{ok, updated_at}` |
| DELETE | `/api/mv/drafts/mine` | 삭제 | `{ok}` |

### 검증 (모두 PASS)

```
T1: 3 routes 등록 (/api/mv/drafts/mine GET/PUT/DELETE)              ✅
T2: ensure_indexes 에 mv_drafts unique 인덱스                       ✅
T3: API client 함수 3개 + Wizard 9곳 호출 + MyWeddingMV 6곳 호출      ✅
```

### 흐름 매트릭스

| 상황 | 동작 |
|---|---|
| 첫 wizard 진입 | 백지. (draft 도 sessionStorage 도 없음) |
| 작성 중 다른 페이지 이동 | **debounced 1.5s 후 backend 저장** + sessionStorage 도 박힘 |
| 내 작품 진입 (draft 있음) | 🟡 **작성중** 카드 1개 prepend + 완료 작품들 |
| 작성중 카드 [✎ 이어서 작성] | `/wizard` 이동 — backend draft 로 복원 |
| [새로 만들기] + draft 있음 | confirm — 확인 시 backend draft 삭제 + `/wizard?new=1` (백지) |
| [새로 만들기] + draft 없음 | 그대로 `/wizard?new=1` (백지) |
| 잡 생성 완료 | sessionStorage clear + backend draft 삭제 |
| outfit 페이지 round-trip | sessionStorage 가 우선 (외부 라운드트립 보호) |

### 특이사항

- 백엔드 draft 저장에 file 객체 못 들어감 (object_name 만). `sanitizeSheetsForStorage` 가 처리 (기존 함수 재사용).
- title 자동 추출: `couple.groom_name` + `couple.bride_name` 조합. 없으면 null (UI 에 "제목 미정" 표시).
- 다중 디바이스 동시 편집 → last-write-wins (별도 conflict 처리 없음 — v34 후보).
- 서버 재기동 필요 — 라우트와 인덱스 등록 위해.

---

## v32 — 2026-06-01 — 미리보기 이미지 클릭 확대 (Lightbox)

### 요청
모든 미리보기 이미지 클릭 → 전체화면 확대. 프론트 단일 작업, 백엔드 변경 없음.

### 변경

| 위치 | 변경 |
|---|---|
| `components/ImageLightbox.jsx` (신설) | Provider + `useImageLightbox()` hook + `<ZoomableImage>` drop-in. ESC/dim 클릭 닫기, body scroll lock, src 빈 입력 안전 처리 |
| `components/ImageLightbox.css` (신설) | overlay (dim 0.86 + fade-in 0.16s), max-width 92vw, max-height 92vh, `.img-zoomable { cursor: zoom-in }` |
| `App.jsx` | `<ImageLightboxProvider>` 로 `<div.app-shell>` 감싸기 |
| 8 파일의 `<img>` → `<ZoomableImage>` | drop-in 교체 (props 동일) |

### 적용 사이트 (총 22 ZoomableImage)

| 파일 | uses |
|---|---|
| `CharacterSheetPanel.jsx` (얼굴/의상/시트 결과) | 3 |
| `PlaceAssetPanel.jsx` (장소 카드) | 1 |
| `ExtraVideoStudioPanel.jsx` (업로드/ref) | 5 |
| `WeddingPhotoPanel.jsx` (시트 ref/자산/갤러리) | 4 |
| `WeddingPhotoDetailModal.jsx` (버전/메인/헤더) | 3 |
| `PreCeremonyMVPanel.jsx` (씬 이미지/ref) | 3 |
| `ItemManagePage.jsx` (관리자 자산) | 2 |
| `OutfitSelectPage.jsx` (옷 picker) | 1 |

### 제외 (의도)

- `Header.jsx:24` — AIDO 로고 (확대 의미 없음)
- `MentionField.jsx:470` — 자동완성 드롭다운 popup thumb (즉시 확대 시 멘션 흐름 깨짐)

### 테스터 검증 (모두 PASS)

```
ZoomableImage 사용 카운트 8 파일 모두 정상 (3/1/5/4/3/3/2/1)  ✅
모든 사용 파일에 import { ZoomableImage } from '...' 추가됨    ✅
Header / MentionField <img> 잔존 — 의도된 제외                 ✅
Vite HMR 정상 reload                                          ✅
```

### 인터랙션

- 미리보기 클릭 → 전체화면 dim + 큰 이미지 표시
- **dim 클릭 / ESC 키 / × 버튼** — 3가지 방법으로 닫기
- 이미지 자체 클릭은 닫지 않음 (`stopPropagation`)
- 열린 동안 body scroll lock — 페이지 스크롤 잠금

### 비범위
- 영상 element 확대 (별개)
- 줌/팬 (휠 확대 등) — 단순 fit-to-screen 으로 충분

---

## v31 — 2026-06-01 — 캐릭터 시트 자동저장 + 재생성 확인 다이얼로그

### 요청
[저장] 버튼 제거 → 생성 직후 자동 DB 저장. 같은 slot 재생성 시 확인 다이얼로그 — 취소하면 새 PNG 폐기, 기존 시트 유지. 4 slot 동일.

### 변경 요약

| 위치 | 변경 |
|---|---|
| `pages/StoryWizardPage.jsx` (line 282, 673) | `savedSheetSlots: Set` state 추가. `reloadMentionOptions` 가 sheets 응답에서 `sheet_object_name` 있는 slot key 모아 set 갱신. `<CharacterSheetPanel hasExistingSaved={savedSheetSlots.has(key)} />` 전달 |
| `components/CharacterSheetPanel.jsx` (props) | `hasExistingSaved` prop 추가 (default false) |
| `components/CharacterSheetPanel.jsx` (refs) | `hasExistingSavedRef`, `handleSaveRef` — 폴링 effect 가 항상 최신 prop / closure 참조 |
| `components/CharacterSheetPanel.jsx` (`handleSave`) | 시그니처 `(objectNameArg)` 추가 — 폴링에서 즉시 받은 object_name 으로 호출 가능 |
| `components/CharacterSheetPanel.jsx` (polling done 분기) | done 직후 분기: ① `hasExistingSaved === false` → 즉시 `handleSave(objectName)` (자동 저장). ② `hasExistingSaved === true` → `window.confirm(...)` — 확인 시 `handleSave`, 취소 시 `onChange({ generated: null })` 로 새 PNG 폐기 |
| `components/CharacterSheetPanel.jsx` (UI line 760~) | [저장] 버튼 (`btn-primary onClick={handleSave}`) **제거**. [다시 생성] 만 남음 |

### 흐름 매트릭스

| 상황 | 사용자 액션 | 결과 |
|---|---|---|
| 첫 생성 (slot 비어있음) | [생성] 클릭 | 자동 저장 + mention 풀 갱신, 다이얼로그 X |
| 재생성 → 확인 | [다시 생성] → 새 PNG done → confirm → "확인" | 새 PNG 저장 + mention 풀 갱신 |
| 재생성 → 취소 | [다시 생성] → 새 PNG done → confirm → "취소" | 새 PNG 폐기 (`generated=null`), 기존 시트 + mention 풀 그대로 |

### 검증 (구조 grep — 모두 PASS)

```
StoryWizardPage:
  L282 savedSheetSlots state                ✅
  L673 hasExistingSaved prop 전달            ✅

CharacterSheetPanel:
  L25  hasExistingSaved prop (default false) ✅
  L41-45 ref 2개 (Saved/handleSave)          ✅
  L241 handleSaveRef 매 렌더 갱신             ✅
  L425-451 polling done 자동저장/다이얼로그 분기 ✅
  [저장] btn-primary 잔존 0건                ✅ (제거 완료)
```

### 백엔드 변경 없음

`api.saveCharacterSheet` 가 동일 slot 덮어쓰기 이미 지원 (기존 sheets[slot] update). v31 은 호출 시점만 자동화한 프론트엔드 작업.

### 비범위 (v32 후보)

- 다이얼로그 취소 시 MinIO 의 새 임시 PNG cleanup (현재는 그대로 남음, 다음 생성 시 새 object 로 덮임)
- `window.confirm` 대신 inline modal (UX 개선)

---

## v30 — 2026-05-31 — thinking ON 대응: LLM max_tokens 상향

### 요청
v27 thinking/reasoning ON 적용 후 thinking/reasoning 토큰이 `max_tokens` 안에 포함됨. 작은 한도가 빈 응답을 일으킴. 실측 후 상향.

### 핵심 측정 (실호출)

**OpenAI gpt-5.4 + reasoning_effort=high — Title 호출 (max=50)**
```
이전: comp=50  reasoning=50  text_len=0  finish=length   ← 🚨 빈 응답 100% 발생
이후: comp=114 reasoning=100 text="너와의 모든 순간"   finish=stop   ✅ 정상
```

**Claude Opus 4.7 + adaptive thinking**: 우리 실제 사용 입력 범위 (trivial / 5씬 / 12씬) 에서 모두 `thinking_blocks=0` 으로 자동 절약 — 한도 부족 위험 낮음. 안전 마진만 추가.

### 적용 결과

| # | 파일 | 변경 | 측정 근거 |
|---|---|---|---|
| 1 | `pre_mv_phase0_mapper.py:302` | `_MAX_TOKENS = 10000 → 12000` | Claude adaptive 안전 마진 |
| 2 | `pre_mv_phase1_splitter.py:725` | cap **12000 유지** | Anthropic SDK 비-streaming ~10분 timeout 안전선. 더 올리려면 streaming 도입 필요 |
| 3 | `pre_mv_scene_mirror.py:67` | `_MAX_TOKENS_MIRROR = 1500 → 4000` | reasoning 200~400 + output 마진 |
| 4 | `story_polisher.py:108` | `_max_tokens_for_text` hard min 256→768, max 2048→4096 | reasoning 분 ×2 |
| 5 | `lyrics_generator.py:536-542` | duration map 2분 1200→2400, 3분 2000→4000, default 1500→3000 | 가사 본문 + reasoning 합산 |
| 6 | `lyrics_generator.py:583, 618` | **title 50 → 400** (OpenAI + Anthropic 양쪽) | 🚨 CRITICAL — 빈 응답 즉시 재현됐던 케이스 |

### 검증 (모두 PASS)

```
T1: 상수/함수 상향값                                                     ✅
    Phase0=12000  Mirror=4000  Polisher(빈)=768 / (long)=4096
    Lyrics 2분=2400  3분=4000  default=3000  Phase1 cap=12000

T2: lyrics 파일에 max_tokens=50 잔존 0건, max_tokens=400 양쪽 모두        ✅
T3: 실호출 — OpenAI title (max=400, reasoning_effort=high)               ✅
    text="너와의 모든 순간" finish=stop reasoning=100 → 정상 출력
```

### 비범위 / 다음 후보

- phase1 cap 12000 이상 상향 → Anthropic SDK 비-streaming 10분 timeout 위반 위험. streaming 도입이 선결 조건. 현재는 12000 으로 안정.
- thinking 글로벌 off (`LLM_THINKING_DISABLED=1`) — 디버깅용 비상 토글 그대로.

---

## v29 — 2026-05-31 — 화면 비율 16:9 통일 (캐릭터 시트만 1:1 유지)

### 요청
씬 이미지 / 씬 영상 / 장소 / 웨딩사진 = **16:9**. 캐릭터 시트만 **1:1**. 씬 이미지 default 모델 = **GPT Image 2** 유지.

### 적용 결과

**이미지 (GPT Image 2 — `2048x1152`, 16:9 16배수)**
| 위치 | 변경 |
|---|---|
| `openai_image.py:36-48` | `_png_size` 화이트리스트에 `1536x864`, `2048x1152` 추가. fallback default `2048x1152` |
| `openai_image.py:156` | `generate_image` default `size="2048x1152"` |
| `extra_scene_image_generator.py:492` | 1024×1024 → 2048×1152 |
| `pre_mv_phase2_image_generator.py:499` | 1024×1024 → 2048×1152 |
| `place_generator.py:87` | 1024×1024 → 2048×1152 |
| `wedding_photo_generator.py:235` | 1024×1024 → 2048×1152 |
| `character_generator.py:695` | **size=2048x2048 명시** (1:1 유지 — default 16:9 회피) |

**이미지 (Nano Banana Pro)**
| 위치 | 변경 |
|---|---|
| `character_generator.py::_call_gemini_image` | `aspect_ratio: str = "1:1"`, `image_size: str = "2K"` 옵션 추가. payload `generationConfig.imageConfig.{aspectRatio, imageSize}` 머지 |
| `character_generator.py:698` (self 시트) | default `1:1` 사용 |
| `extra_scene_image_generator.py:501` | `aspect_ratio="16:9"` 명시 |
| `pre_mv_phase2_image_generator.py:508` | `aspect_ratio="16:9"` 명시 |
| `place_generator.py:116` | `aspect_ratio="16:9"` 명시 |

**영상 (4종 모두 16:9 강제)**
| 모델 | 위치 | 비고 |
|---|---|---|
| Veo 3.1 | `pre_mv_veo_generator.py:46` | `_VEO_ASPECT="16:9"` 기존 ✅ |
| Kling 3.0 Omni | `pre_mv_kling_generator.py:167` | `"aspect_ratio":"16:9"` 기존 ✅ |
| Seedance 2.0 | `pre_mv_seedance_generator.py:125` | `"aspect_ratio":"16:9"` 추가 |
| Grok Imagine | `pre_mv_grok_generator.py:152` | `"aspect_ratio":"16:9"` 명시 (xAI default 도 16:9, 안전 마진) |

**프론트**: 변경 없음. 씬 이미지 default 모델은 `gpt_image_2` 그대로 (`PreCeremonyMVPanel.jsx:59, 1869`).

### 테스터 검증 (모두 PASS)

```
T1: openai_image._png_size 화이트리스트 (16:9 + 1:1 둘 다 허용, fallback=16:9)  ✅
T2: _call_gemini_image default aspect_ratio="1:1"                              ✅
T3: 호출자 3곳 (씬·장소) 모두 aspect_ratio="16:9" 명시                         ✅
T4: 영상 4종 (Veo/Kling/Seedance/Grok) 모두 16:9 명시                         ✅
T5: 캐릭터 시트 GPT Image 2 경로 size=2048x2048 (1:1) 명시                    ✅
T6: GPT Image 2 5곳 size=2048x1152 검증                                       ✅
T7: Nano Banana payload 구조 (generationConfig.imageConfig.{aspectRatio,imageSize}) ✅
```

### 특이사항

- **2048x1152 채택 이유**: GPT Image 2 사양 (width/height 16의 배수, 비율 1:3~3:1) 충족하면서 거의 1080p 와이드 (2.36M px). 1920x1080 은 1080/16=67.5 라 16배수 미충족.
- **캐릭터 시트 1:1 보존을 위한 명시 박기 2곳**:
  - `openai_image.py` default 가 16:9 로 바뀌었으므로 character_generator 의 GPT Image 호출은 `size="2048x2048"` 명시 박음.
  - `_call_gemini_image` default 가 `1:1` 이라 character_generator self-call 은 자연스럽게 시트 비율 유지.
- **출력 캔버스 vs reference 비율**: 1:1 캐릭터 시트 ref + 16:9 출력 캔버스 조합은 GPT Image 2 / Nano Banana Pro 모두 견고하게 처리. 프롬프트 컨텍스트(두 인물+장소+시네마틱 16:9 frame) 가 이미 와이드 구도를 유도.

---

## v28 — 2026-05-31 — 이미지/영상 모델 thinking 모드 검토 + 적용

### 요청
이미지 (GPT Image 2, Nano Banana Pro) + 영상 (Kling 3.0 Omni, Veo 3.1, Seedance 2.0, Grok) 6종 검토. 지원하는 모델만 ON.

### 웹검색 결과 — 모델별 thinking 지원 표

| 모델 | thinking 지원 | 적용 결과 |
|---|---|---|
| **Nano Banana Pro** (Gemini 3 Pro Image Preview) | ✅ | `generationConfig.thinkingConfig.thinkingLevel="high"` 적용 + 400 fallback |
| **GPT Image 2** | ❌ | 모델 자체에 thinking 노출 없음 — 변경 없음 |
| **Kling 3.0 Omni** | ❌ | Chain-of-Thought 가 학습 시 내장(SFT) — API 토글 불가 |
| **Veo 3.1** | ❌ | predictLongRunning 사양에 thinking 키 없음 |
| **Seedance 2.0** | ❌ | fal.ai endpoint 사양에 thinking 키 없음 |
| **Grok Imagine 영상** | ❌ | reasoning_effort 는 텍스트 모델 (Grok-4.x) 전용 |

### 적용 결과

| # | 파일 | 변경 |
|---|---|---|
| 1 | `app/services/llm_thinking_config.py` | `gemini_image_thinking_config()` + `apply_thinking_to_gemini_image_payload()` 추가. default level=`"high"`. 글로벌 `LLM_THINKING_DISABLED=1` 적용 |
| 2 | `app/services/character_generator.py::_call_gemini_image` | payload `generationConfig` 에 thinkingConfig 머지. 400 + 응답 본문 "thinking" 키 언급 시 자동 fallback (thinkingConfig 제거 후 1회 재시도) |

호출자 회귀 영향 없음 — `_call_gemini_image` 는 character/place/extra_scene_image/pre_mv_phase2 4 generator 에서 공통 사용. 응답 파싱 무변형.

### 테스터 검증 (모두 PASS)

```
T1: gemini_image_thinking_config() 기본값 → {"thinkingConfig":{"thinkingLevel":"high"}}  ✅
T2: level="medium" 옵션                                                                    ✅
T3: payload.generationConfig 머지 (기존 키 보존)                                          ✅
T4: generationConfig 없는 payload 도 처리                                                  ✅
T5: LLM_THINKING_DISABLED=1 시 변경 없음                                                  ✅
```

### 사용자 보고 — thinking 미지원 모델 (코드 변경 없음)

1. **GPT Image 2** — OpenAI 이미지 생성 모델 자체에 thinking 파라미터 노출 없음
2. **Veo 3.1** — Google 영상 모델, 사양에 thinking 키 없음
3. **Kling 3.0 Omni** — Chain-of-Thought 가 모델 학습 단계에 내장 (사용자가 켜는 게 아니라 항상 동작). API 토글 없음
4. **Seedance 2.0** — ByteDance, fal.ai endpoint 에 thinking 키 없음
5. **Grok Imagine 영상** — xAI 영상 generation 에 reasoning_effort 노출 없음

### Sources
- [GPT Image 2 official spec](https://developers.openai.com/api/docs/models/gpt-image-2)
- [Nano Banana Pro - Google DeepMind](https://deepmind.google/models/gemini-image/pro/)
- [Gemini 3 thinkingConfig spec](https://ai.google.dev/gemini-api/docs/gemini-3)
- [Kling 3.0 Omni overview (fal.ai)](https://fal.ai/kling-3)
- [Veo 3.1 spec](https://ai.google.dev/gemini-api/docs/models/veo-3.1-generate-preview)
- [Seedance 2.0 fal.ai endpoint](https://fal.ai/models/bytedance/seedance-2.0/image-to-video)
- [xAI Reasoning - text models only](https://docs.x.ai/developers/model-capabilities/text/reasoning)
- [xAI Video Generation](https://docs.x.ai/developers/model-capabilities/video/generation)

---

## v27 — 2026-05-31 — LLM 호출 일괄 thinking/reasoning ON

### 요청
모든 LLM 호출 (Claude Opus 4.7 / GPT-5.x) thinking 모드 켠 상태로. 웹검색으로 2026년 공식 사양 확인 후 진행.

### 웹검색으로 확정한 2026 사양 (출처)

- Adaptive thinking 권장: [Building with extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)
- Opus 4.7+ temperature/top_p/top_k 거부 (400): [Claude Opus 4.7 Temperature Deprecation](https://blog.laozhang.ai/en/posts/claude-opus-4-7-temperature-parameter)
- OpenAI reasoning_effort 파라미터: [GPT-5.4 API Developer Guide](https://www.nxcode.io/resources/news/gpt-5-4-api-developer-guide-reasoning-computer-use-2026)
- GPT-5+ temperature 미지원 400: [LibreChat issue #10737](https://github.com/danny-avila/LibreChat/issues/10737)

### 적용 결과

| # | 파일 | 변경 |
|---|---|---|
| 1 | `app/services/llm_thinking_config.py` (신설) | 공통 헬퍼: `claude_thinking_kwargs`, `openai_reasoning_kwargs`, `strip_unsupported_sampling`, `apply_thinking_to_anthropic`, `apply_reasoning_to_openai`. 환경변수 `LLM_THINKING_DISABLED=1` 로 글로벌 off |
| 2 | `app/services/pre_mv_phase0_mapper.py` | `_call_claude`/`_call_openai` 에 헬퍼 적용 |
| 3 | `app/services/pre_mv_phase1_splitter.py` | 동일 |
| 4 | `app/services/pre_mv_scene_mirror.py` | 동일 |
| 5 | `app/services/story_polisher.py` | Claude/OpenAI 양쪽 분기 모두 적용 |
| 6 | `app/services/lyrics_generator.py` | `_generate_via_openai` (lyrics + title 2건) + `_generate_via_anthropic` (lyrics + title 2건) 총 4호출 적용 |

### 헬퍼 규약

- **Adaptive Claude 모델 셋**: `claude-opus-4-6/4-7/4-8`, `claude-sonnet-4-6`
- **Reasoning OpenAI prefix**: `gpt-5`, `o1`, `o3`, `o4`
- 위 모델이면:
  - `thinking={"type":"adaptive"}` 또는 `reasoning_effort="high"` 자동 머지
  - `temperature` / `top_p` / `top_k` 키 존재 시 자동 제거 (400 거부 회피)
- 그 외 모델: 기존 동작 그대로 (sampling param 보존)
- Default reasoning_effort: **"high"** (사용자 요청 "다 켜라" 반영. xhigh 는 비용/지연 큼)

### 테스터 검증 (모두 PASS)

**T1~T8 헬퍼 단위 테스트**
```
T1: 모델 분류 (Opus 4.6/4.7/4.8/Sonnet 4.6 / GPT-5+/o1/o3/o4 vs 그 외)  ✅
T2~T3: claude_thinking_kwargs / openai_reasoning_kwargs                ✅
T4: Opus 4.7 strip — temperature/top_p 제거                            ✅
T5: 비-reasoning 모델 (sonnet 3.5) → strip 안 함                      ✅
T6: apply_thinking_to_anthropic — temperature 제거 + thinking 추가     ✅
T7: apply_reasoning_to_openai — temperature 제거 + reasoning_effort 추가 ✅
T8: LLM_THINKING_DISABLED=1 글로벌 off                                 ✅
```

**실 API 호출 검증** ("2+2 는?" 짧은 메시지)
```
[Claude] model=claude-opus-4-7
  kwargs after apply: [max_tokens, messages, model, thinking]
  thinking={'type': 'adaptive'}  temperature_present=False
  → OK text='4' input=27 output=6  ✅ (trivial → thinking_blocks=0)

[OpenAI] model=gpt-5.4
  kwargs after apply: [max_completion_tokens, messages, model, reasoning_effort]
  reasoning_effort=high  temperature_present=False
  → OK text='4' in=17 out=4  ✅ (trivial → reasoning_tokens=0)
```

### 특이사항

- **temperature 자동 strip 가 핵심**: 기존 코드의 `if "opus-4-7" not in model_id: kwargs["temperature"] = N` 분기 패턴을 헬퍼가 흡수. 호출자는 `temperature` 를 단순히 박아넣고 헬퍼가 모델 보고 알아서 제거함.
- adaptive thinking 은 Claude 가 자동 판단 — trivial 한 질문엔 thinking 안 함, 복잡한 시나리오 분할 같은 입력엔 자동으로 thinking 사용.
- `LLM_THINKING_DISABLED=1` 으로 글로벌 off 가능 — 비용/지연 디버깅용.
- Gemini (Phase 2 image 생성에 사용) 의 thinking 모드는 본 작업 범위 외 — Gemini SDK 가 별개 통합 경로.

---

## v26 — 2026-05-30 — 추가영상생성 @멘션 풀에 식전영상 씬 이미지 추가 (다중 허용)

### 요청
추가영상생성 탭의 씬 이미지 입력에 `@챕터명_씬번호` 토큰으로 식전영상 씬 이미지를 ref 첨부 가능. 한 프롬프트에 여러 토큰 동시 사용 허용.

### 변경 요약

| # | 파일 | 변경 |
|---|---|---|
| 1 | `app/routes/mv.py` `get_job_context` | 응답에 `pre_mv_scenes: [{token, label, story_slot, seq_in_slot, scene_number, object_name}]` 추가. mv_job_id 로 pre_mv_jobs 1건 lookup → image_object_name 가진 씬만 story_slot 별 그룹핑 → seq_in_slot 부여 |
| 2 | `app/services/extra_scene_image_generator.py` | `_resolve_scene_image_ref(mv_job_id, token)` 신설 (known story_slot prefix longest-match → seq_in_slot 파싱 → scene PNG bytes). 메인 루프에 `t == "scene_image"` 분기 추가. `_ref_label` 에 scene_image 분기 추가 |
| 3 | `frontend/src/components/ExtraVideoStudioPanel.jsx` | `mentionOptions` useMemo 에 `context.pre_mv_scenes` 매핑 (group_label='🎬 식전영상 씬'). DEV 가드로 풀 크기 로깅. 사용자 가이드 placeholder 와 도움말 문구도 새 풀 반영해 갱신 |
| 4 | `frontend/src/components/MentionField.jsx` | 팝업 placeholder 아이콘 분기 확장 (scene_image → 🎬, wedding_photo → 💞 등) |

### 토큰 규약
- `@{story_slot}_{seq_in_slot}` — 예: `@meeting_1`, `@first_date_2`, `@wedding_prep_3`
- story_slot 5종 고정: meeting / first_date / memory / proposal / wedding_prep
- seq_in_slot 은 같은 story_slot 의 scene_number 오름차순 1-base 순번
- 다중 사용 자유 (MentionField 의 longest-match reconcile 이 기존부터 지원)
- MAX_REFS=4 정책 유지 — 업로드 + @멘션 합산 4장 초과 시 우선순위는 업로드 → @멘션 순

### 테스터 검증 (모두 PASS)

```
T1: 실 잡 6a169ecc... context tokenization     → 23/23 토큰 정확 생성 ✅
T2: _resolve_scene_image_ref 단일 토큰         → bytes/mime/label 정상 ✅
    @meeting_1, @first_date_2, @memory_5, @wedding_prep_3 모두 1.5~1.8MB PNG 정상 로드
T3: 잘못된 토큰 (meeting_99 / unknown_slot_1 / garbage)
                                                → 모두 None + warning 로그 ✅
T4: _ref_label scene_image 분기                → "씬 — @meeting_1" 정상 ✅
회귀: 기존 sheet/place/wedding_photo 분기 영향 0 ✅
```

### 비범위 (다음 후보)

- 씬 영상 생성 입력에도 동일한 풀 노출 (현재는 씬 이미지 생성 입력만 대상)
- 다른 mv_job 의 씬을 cross-import (현재는 같은 mv_job 풀만)

### 특이사항

- backend 의 `_resolve_scene_image_ref` 는 known story_slot 5종 prefix 와 longest-match — `first_date_3` 같은 토큰도 정확히 파싱.
- pre_mv_jobs 가 없는 mv_job 의 경우 `pre_mv_scenes: []` 빈 배열 반환 — 기존 3 type 풀만 사용.

---

## v25 — 2026-05-30 — 영상 모더레이션 안전망 도입 완료

### 요청
음악 플랫폼(`0_platform_music/backend_9004`) v64/v65 안전망을 wedding 백엔드에 이식. Seedance 출력 모더레이션 422 거부(`content_policy_violation`)를 사전 차단.

### 적용 결과 (Layer 1 / 2 / 3)

| 레이어 | 위치 | 변경 |
|---|---|---|
| L1 | `app/services/pre_mv_phase1_splitter.py` (rule #14 신설) | Phase 1 LLM 시스템 프롬프트 끝에 v25 트리거 금지 + 안전 대체 권장 블록 append |
| L2 | `app/services/pre_mv_video_prompts.py` | `_VIDEO_PROMPT_UNSAFE_PATTERNS` regex 24개 + `sanitize_video_prompt()` 신설. `sanitize_for_seedance = sanitize_video_prompt` alias 로 하위 호환 |
| L2 | `app/services/pre_mv_kling_generator.py` (line 36, 370) | 호출 직전 `sanitize_video_prompt(raw_prompt)` 통과 |
| L2 | `app/services/pre_mv_grok_generator.py` (line 33, 303) | 호출 직전 `sanitize_video_prompt(raw_prompt)` 통과 |
| L2 | `app/services/pre_mv_seedance_generator.py` (line 31, 303) | 함수명 일반화 (`sanitize_for_seedance` → `sanitize_video_prompt`) |
| L2 | `app/services/extra_video_generator.py` | 자동 — `generate_scene_video_*` 3종을 그대로 호출하므로 동일 sanitize 적용됨 (별도 변경 불요) |
| L3 | `app/routes/pre_mv.py` (phase3 worker except 블록) | `content_policy_violation` / `sensitive content` 감지 시 `video_error_reason="content_policy"` + 한국어 user-facing 메시지로 `video_error` 치환 |
| FE | `frontend/src/components/PreCeremonyMVPanel.jsx` (line 1737~, 2407~) | `LiveSceneCard` / 일반 카드의 `is-failed` 분기에서 `video_error_reason === 'content_policy'` 시 🚫 + "콘텐츠 정책 거부, 다른 모델 시도 권장" 표시 |

### 회귀 테스트 결과 (Tester)

```
=== T1: alias 호환 ===                                          PASS
=== T2: 23개 트리거 표현 치환 (hits=23/23) ===                  PASS
=== T3: 정상 wedding 문장 변형 0 ===                           PASS
=== T4: 빈 입력 처리 ===                                         PASS
=== T5: regex 패턴 개수 = 24 ===                                PASS
=== Layer 3 분기 (content_policy True/False) ===                PASS
=== Phase 1 시스템 프롬프트 v25 가이드 포함 ===                PASS
=== 3 generator import 정상 ===                                  PASS
```

검증 명령:
```bash
grep -rn "sanitize_video_prompt\|sanitize_for_seedance" app/services app/routes
```
→ Seedance/Kling/Grok 3 generator 모두 호출 사이트 1건씩 확인.

### 비범위 (다음 후보)

- fal Seedance 2.0 의 `generate_audio` 같은 endpoint 자체 audio 끄기 옵션 — schema 확인 후 v26 에서 검토
- 자동 재시도 / 모델 폴백 (Seedance 거부 시 자동으로 Kling 로 전환)
- 한국어 prompt_ko 의 sanitize — 현재 영문만, 한국어 모더레이터 false positive 사례 누적 시 추가

### 특이사항

- 기존 `sanitize_for_seedance` 함수는 단순 needle-match 였음 → 9004 v64 의 정교한 regex (예: `alone faces? camera directly`) 로 업그레이드. 의미상 동일하지만 변형 트리거 (예: `alone face camera`, `alone, facing camera`) 까지 커버.
- `sanitize_for_seedance` 이름은 alias 로 유지해 외부 호출자 호환 (현 시점 호출자는 self-import 만이라 사실상 안전).
- Phase 1 LLM 가이드(L1)는 후속 모더레이션 거부 케이스가 누적되면 트리거 목록을 같은 블록에 추가.
