# MV Wedding — PLAN

## v37 — 2026-06-01 — wizard mount useEffect race condition 가드 (step 5→1 강제 튐 버그)

### 요청 (버그 보고)
"5단계에서 [이전] 누르면 4단계로 가야 하는데 1단계로 빈 화면이 떠. 4단계에 입력했던 게 그대로 있어야 하는데."

### Plan verification findings — 진단

`frontend/src/pages/StoryWizardPage.jsx:419-456` 마운트 useEffect 가 비동기 `api.getMyDraft()` 호출 후 응답이 도착하면 **무조건** `setStep / setData` 호출:

```js
const { data: res } = await api.getMyDraft();
const draft = res?.draft;
if (draft && draft.payload && typeof draft.payload === 'object') {
  setData(merged);                              // ← 사용자 입력 덮어쓰기
  setStep(draft.step >= 1 && <= 6 ? draft.step : 1);  // ← 사용자 진행 덮어쓰기
}
```

**Race**:
1. 마운트 → backend fetch 시작 (비동기)
2. 사용자가 step 1→5 진행 + 입력
3. 사용자 [이전] 클릭 → `goPrev` → setStep(4) ✅
4. **그 직후 (2) 의 응답 도착** — stale draft (예: step=1) 들고 옴
5. `setStep(1)` / `setData(옛값)` 덮어쓰기 → **step 5/4 → 1 강제 튐 + 입력 손실**

### 갭

| 항목 | 현재 | 목표 |
|---|---|---|
| 마운트 useEffect 의 setStep | 무조건 덮어쓰기 | 현재 step > 1 (사용자 진행) 면 보존 |
| 마운트 useEffect 의 setData | 무조건 덮어쓰기 | 사용자가 의미있는 입력 했으면 (sheet face/couple name/story meeting 등) 보존 |

### 변경 매트릭스

| # | 파일 | 변경 | 추적자 |
|---|---|---|---|
| 1 | `pages/StoryWizardPage.jsx` mount useEffect | (a) `setStep` → functional updater 로 `cur > 1` 이면 보존. (b) `setData` → functional updater 로 `hasUserInput(cur)` 면 보존. (c) DEV 로그에 "guarded skip" 케이스 명시 | `[StoryWizard]` (기존) |

### `hasUserInput` 판단 기준

핵심 필드 1개라도 비어있지 않으면 "사용자 입력 있음":
- sheets 슬롯 중 하나라도 `face_object_name` 있음
- `couple.partner_a.name` 또는 `couple.partner_b.name` 있음
- `story.meeting` 본문 있음
- `current_job_id` 있음 (잡 만들고 돌아온 케이스)

### 회귀 테스트

1. **버그 재현**: mount useEffect 가 stale draft 응답 받기 전에 사용자 step 진행 → [이전] 누름 → step 4 유지 (1로 안 튐) ✅
2. **정상 복원**: 사용자가 빈 wizard 진입 + 입력 없이 대기 → backend draft 복원 ✅
3. **회귀**: outfit round-trip — sessionStorage rehydrate 우선 → mount useEffect skip (기존 그대로) ✅
4. **회귀**: `?new=1` — backend draft 삭제 + 빈 wizard (기존 그대로) ✅

### 비범위
- `userInteractedRef` 보호 (더 정석이지만 patch helpers 모두에 박아야 함 — 핵심 필드 검사만으로 충분)
- backend draft 의 `step` 자체가 stale 한 게 근본 — wizard 진행 중 매 변경마다 PUT 으로 갱신하므로 race window 최소화하지만 응답 timing 못 막음. 가드가 최종 방어선.

---

## v36 — 2026-06-01 — 장소 owner 분리 (draft vs 잡) + 잡 선택 삭제

### 요청
[새로 만들기] = 빈 wizard (장소도 0개). [작성중 카드 클릭] = 그 draft 의 장소들 그대로 복원. 잡 생성 시 장소들이 그 잡 소속이 됨. + "내 작품" 카드 선택해서 삭제.

### Plan verification findings — 현재 코드

- `wedding_assets` (type=place) 컬렉션의 owner 필드:
  - 현재: `user_id` 만. **mv_job_id 와 무관**.
  - 결과: 모든 wizard 에서 같은 장소가 보임 (user 전체).
- `PlaceAssetPanel.jsx` 는 wizard 안에서만 마운트됨 (StoryWizardPage.jsx:797). GenerationStatusPage 에선 안 씀.
- `routes/places.py`:
  - `POST /generate` (line 325) asset_doc 에 mv_job_id 필드 없음
  - `POST /upload` (line 163) asset_doc 도 동일
  - `GET ""` (line 516) filter `{user_id, type=place}` — mv_job_id 무관
- `routes/mv.py POST /jobs` (line 135) — 잡 생성 후 자산 transfer 로직 없음
- `routes/mv_drafts.py DELETE /mine` (line 162) — `mv_drafts.delete_one` 만. 장소 cleanup 없음
- `MyWeddingMVPage.jsx` — 잡 삭제 UI 없음. 백엔드 `DELETE /jobs/{id}` 도 없음

### 데이터 모델 (확정)

`wedding_assets` (type=place) `meta` 안에 1개 필드 추가:
```
meta: {
  memo, image_model,
  mv_job_id: Optional[str],   # null = draft 단계, "ObjId" = 그 잡에 묶임
}
```

- INSERT 시 `meta.mv_job_id = None` (draft 단계)
- 잡 생성 시 `update_many({type=place, user_id, meta.mv_job_id=None}, {$set: {meta.mv_job_id: new_job_id}})` — 그 user 의 draft 장소들이 새 잡에 묶임
- draft DELETE 시 `delete_many({type=place, user_id, meta.mv_job_id=None})` — draft 장소 청소
- 잡 DELETE 시 `delete_many({type=place, user_id, meta.mv_job_id=job_id})` — 그 잡 장소 청소

### 변경 매트릭스

| # | 파일 | 변경 | 추적자 |
|---|---|---|---|
| 1 | `routes/places.py POST /generate` | asset_doc 에 `meta.mv_job_id = None` 추가 | `[PlaceRoute]` |
| 2 | `routes/places.py POST /upload` | 동일 | 동일 |
| 3 | `routes/places.py GET ""` | filter 에 `"meta.mv_job_id": None` 추가 (draft 컨텍스트만 반환) | 동일 |
| 4 | `routes/mv.py POST /jobs` | 잡 INSERT 직후 `wedding_assets.update_many({type=place, user_id, meta.mv_job_id: None}, {$set: {meta.mv_job_id: job_id}})` | `[MVRoute]` |
| 5 | `routes/mv.py` (신설) `DELETE /jobs/{job_id}` | 잡 도큐먼트 DELETE + 그 잡의 wedding_assets (place) DELETE. owner 가드 | `[MVRoute] /delete` |
| 6 | `routes/mv_drafts.py DELETE /mine` | `wedding_assets.delete_many({type=place, user_id, meta.mv_job_id: None})` 같이 호출 | `[MVDraftRoute]` |
| 7 | `frontend/src/api/index.js` | `deleteMVJob(jobId)` 추가 | — |
| 8 | `frontend/src/pages/MyWeddingMVPage.jsx` | 카드별 체크박스 + [선택 삭제] 버튼 + confirm. 선택 모드 toggle | `[MyWeddingMV]` |

### 흐름 매트릭스

| 케이스 | 동작 |
|---|---|
| wizard 진입 (작성중) | 장소 패널: GET /places → meta.mv_job_id null 인 user 장소만 |
| 작성중 → 장소 만듦 | INSERT with meta.mv_job_id=None |
| 잡 생성 (가사 시작) | 새 잡 INSERT + 그 user 의 draft 장소들에 meta.mv_job_id=new_job_id 박음 |
| [내 작품] → [새로 만들기] + 기존 draft | confirm → deleteMyDraft → backend 가 draft + draft 장소 cleanup |
| [내 작품] → [작성중 카드 클릭] | wizard 재진입 + draft 복원. 장소 패널 listPlaces → draft 장소 그대로 ✅ |
| [내 작품] → 잡 카드 [선택 + 삭제] | bulk DELETE /jobs/{id} → 잡 + 그 잡 장소 cleanup |

### 회귀 테스트

1. **새로 만들기 → 장소 0개** ✅
2. **작성중 카드 클릭 → 장소 그대로 복원** ✅
3. **잡 생성 → 장소가 그 잡으로 transfer (다른 wizard 에선 안 보임)** ✅
4. **[새로 만들기] confirm → draft + draft 장소 모두 삭제** ✅
5. **잡 선택 삭제 → 그 잡 + 그 잡 장소 cleanup, 다른 잡 영향 없음** ✅
6. **GenerationStatusPage 등 잡 별 화면 — 변경 없음 (PlaceAssetPanel 안 씀)** ✅

### 비범위 (이번 작업 외)

- 캐릭터 시트 동일 패턴 (사용자가 명시적으로 caveat 안 함 — 재사용성 위해 일단 유지)
- 웨딩사진은 이미 meta.mv_job_id 가 있음 — 변경 불요
- 장소 자산을 잡 별로 분리 후 잡 화면 (GenerationStatusPage) 에서 그 잡 장소만 보여주는 별도 UI — 추후
- 다중 동시 진행 작품 (draft 1개 정책 유지)

---

## v35 — 2026-06-01 — 작품 1건 정책: lyrics/music 덮어쓰기 + GenerationStatus 에 [이전 수정] 활성/비활성

### 요청
가사·음악 생성 후 마음에 안 들면 이전 단계로 돌아가 수정 → 다시 생성하면 **같은 job 안의 lyrics/music 갈아엎기**. 새 job 안 만듦. 생성 중에는 [← 이전] 비활성, 완료 후 활성.

### Plan verification findings — 현재 코드

- `POST /api/mv/jobs` (mv.py:135) — **항상 새 도큐먼트 INSERT** + 백그라운드 가사 시작. 같은 사용자가 다시 누르면 "내 작품" 에 카드 1장 더 쌓임.
- `POST /api/mv/jobs/{id}/music` (mv.py:440) — 같은 job 안에서 음악 트리거 (status==lyrics_ready 강제).
- StoryWizardPage:
  - **step 6** (검토 & 생성) 에서 [가사 생성 시작] 클릭 → `createStory + createMVJob` → **`navigate('/projects/${jobId}')` — wizard 떠남**.
  - `current_job_id` 보관 안 함. 다음에 wizard 다시 들어와도 항상 새 잡 만듦.
- `GenerationStatusPage.jsx`:
  - 잡 폴링 + 결과 표시 + [음악 생성 시작] 트리거. **[← 이전] 버튼 없음**.
  - 사용자가 본 "5단계에 이전 없다" 의 정체. (사용자가 "5단계" 라 한 게 검토/생성 후 진행 상황 화면).
- "내 작품" 목록 (`MyWeddingMVPage`) — `GET /api/mv/jobs` 가 사용자의 모든 잡을 created_at desc 로 반환. 정책 변경 후엔 시도 회수 무관 1장만 보이게 됨.

### 갭

| 항목 | 현재 | 목표 |
|---|---|---|
| [생성] 재클릭 | 매번 새 mv_jobs INSERT → 카드 늘어남 | 사용자 1명당 진행 중 job 1개 — `current_job_id` 보관 + regenerate API |
| 진행 상황 화면 [이전] | 없음 | 추가. 진행 중 disabled, 완료/실패 후 활성 |
| [이전] 후 wizard 재진입 | draft 복원되지만 `current_job_id` 없음 → 새 잡 만듦 | `current_job_id` 도 복원 → 재진입 후 [생성] = regenerate |
| 백엔드 lyrics/music 덮어쓰기 API | 없음 | `POST /api/mv/jobs/{id}/regenerate` 신설 |

### 변경 매트릭스

| # | 파일 | 변경 | 추적자 prefix |
|---|---|---|---|
| 1 | `app/routes/mv.py` | `POST /jobs/{job_id}/regenerate` 신설 — body `{story_id, music_spec}` 받아 기존 job 의 `story_id`/`music_spec` 갱신 + `lyrics=None, audio_variants=[], status="generating_lyrics", progress=0, error_message=None` 초기화 + `_run_lyrics_generation(job_id)` 백그라운드 시작. owner 가드. 진행 중(`generating_*`)일 땐 409 거부 | `[MVRoute] /regenerate` |
| 2 | `frontend/src/api/index.js` | `regenerateMVJob(jobId, {story_id, music_spec})` 추가 | — |
| 3 | `frontend/src/pages/StoryWizardPage.jsx` | (a) draft payload + state 에 `current_job_id` 추가. (b) `onGenerate` 분기: `current_job_id` 있으면 createStory + `regenerateMVJob`, 없으면 기존대로 createStory + createMVJob. (c) 새 잡 생성 시 받은 job_id 를 state + draft 에 저장. (d) URL `?resume={jobId}` 또는 location.state 로도 받아 복원. | `[StoryWizard]` |
| 4 | `frontend/src/pages/GenerationStatusPage.jsx` | (a) [← 이전 (수정)] 버튼 추가. (b) `disabled = status ∈ {queued, generating_lyrics, generating_music}` — 진행 중 잠금. (c) 클릭 시 `navigate('/wizard', { state: { resume_job_id: jobId } })` — wizard 가 state 받아 `current_job_id` 복원 | `[GenStatus]` |

### 흐름 매트릭스

| 상황 | 동작 |
|---|---|
| 첫 [가사 생성 시작] | `createMVJob` → 새 job_id → wizard state 저장 + navigate to `/projects/{id}` |
| 생성 중 [← 이전] | **비활성** (회색) |
| 생성 완료 후 [← 이전] | **활성** → `/wizard?resume={id}` (또는 location.state) — wizard rehydrate 시 current_job_id 복원 |
| wizard 에서 수정 후 다시 step 6 [생성] | `current_job_id` 있음 → **regenerate API 호출** → 같은 job 의 lyrics/music 갈아엎기 → 같은 `/projects/{id}` 로 navigate |
| 잡 생성 완료 (music_ready) | draft + `current_job_id` 모두 삭제 — 다음 [새로 만들기] 는 백지 |

### 회귀 테스트

1. 첫 생성 — 잡 1개 INSERT, wizard 떠나서 GenerationStatus 진입 ✅
2. 진행 중 GenerationStatus 의 [← 이전] disabled ✅
3. music_ready 후 [← 이전] 활성 → wizard 복원 (state.current_job_id 포함) ✅
4. wizard 에서 수정 후 [생성] → regenerate 호출 (새 잡 INSERT X) ✅
5. "내 작품" 목록 — 시도 회수 무관 카드 1장만 ✅
6. music_ready 후 draft + current_job_id 정리 — 다음 새로 만들기 백지 ✅
7. 회귀: 빈 슬롯(첫 작품) 사용자 — 기존 흐름 유지 ✅

### 비범위

- step 5 안에서 가사/음악 결과 직접 청취 (큰 UI 재구성 필요 — v36 후보)
- 자동 음악 트리거 (가사 ready 시 즉시 음악 시작 — 현재는 사용자 클릭)
- 다중 진행 중 job (1명당 1개 정책 유지)

---

## v34 — 2026-06-01 — 장소 자산 "새로 생성" 덮어쓰기 + 큰 후보 미리보기

### 요청
같은 장소 슬롯에서 [이미지 생성] 다시 누르면 새 자산이 별도 항목으로 추가되어 중복 발생. 새 후보 이미지를 **크게** 보여주고 [덮어쓰기]/[취소] 선택받기. 승인 시 기존 자산 삭제, 취소 시 새 자산 삭제.

### Plan verification findings — 현재 코드

- `frontend/src/components/PlaceAssetPanel.jsx::handleGenerate` (line 340~)
  - 슬롯 상태 무관하게 `api.generatePlace(...)` 호출 → 응답의 `place_id` 로 슬롯 `place_id` 를 교체 (line 367-378)
  - 기존 슬롯이 이미 저장된 (`is_draft=false`, object_name 있음) 상태였어도 그대로 새 자산으로 교체 — DB 에는 기존 자산 그대로 + 새 자산 INSERT
- `backend_8000/app/routes/places.py:325 POST /generate`
  - 항상 **새 `ObjectId` 생성 + insert_one** (line 389-407). 기존 자산 update 분기 없음. 같은 display_name 두 개 발생.
- `DELETE /places/{place_id}` (line 647) — 기존 자산 삭제 API 존재 (재사용 가능)
- v32 `<ZoomableImage>` 가 이미 도입돼있음 — 모달 안 큰 미리보기 클릭 시 lightbox 풀스크린 가능

### 갭

| 항목 | 현재 | 목표 |
|---|---|---|
| 같은 슬롯 [이미지 생성] 재클릭 | 새 자산 INSERT + 기존 자산 그대로 → 중복 | confirm 모달 → 덮어쓰기/취소 분기 |
| 후보 이미지 표시 크기 | 카드 안 작은 미리보기 | 모달 안에 큰 미리보기 (좌: 기존 / 우: 후보) |
| 백엔드 API | INSERT-only, UPDATE 없음 | 변경 없음 — DELETE 기존 활용 |

### 변경 매트릭스

| # | 파일 | 변경 | 추적자 prefix |
|---|---|---|---|
| 1 | `components/PlaceOverwriteModal.jsx` (신설) | 좌(기존) ↔ 우(후보) 큰 미리보기 + [덮어쓰기 확정 / 취소] 두 버튼. 이미지는 `<ZoomableImage>` 로 — 클릭 시 v32 lightbox 풀스크린 | `[PlaceOverwriteModal]` |
| 2 | `components/PlaceOverwriteModal.css` (신설) | 50/50 split + 사진 max-width:42vw, max-height:60vh | — |
| 3 | `components/PlaceAssetPanel.jsx` | (a) 슬롯에 `pending_candidate: null \| {place_id, job_id, object_name?, preview_url?}` 필드 추가. (b) `handleGenerate` 분기 — 기존 저장 상태(`is_draft=false && object_name`) 이면 candidate 로 별도 보관, 기존 자산 그대로 유지. (c) polling done 시점에 candidate 완성되면 자동 모달 open. (d) 승인 시 `DELETE /places/{oldId}` 후 candidate 를 본 슬롯으로 promote. (e) 취소 시 `DELETE /places/{newId}` + candidate 만 제거 | `[PlaceAssetPanel]` |

### 분기 흐름 매트릭스

| 케이스 | 동작 |
|---|---|
| 첫 생성 (slot 비어있음) | 기존 흐름 그대로 — 자산 INSERT + 슬롯에 직접 박힘 |
| 기존 자산 있음 + [이미지 생성] | 새 자산 INSERT (candidate) → polling done → 자동 모달 |
| 모달 [덮어쓰기 확정] | `DELETE /places/{oldId}` → slot.place_id = newId, slot.object_name = newObj |
| 모달 [취소] | `DELETE /places/{newId}` → slot 의 candidate 만 비움, 기존 자산 그대로 |

### 디버깅 로그
- `[PlaceAssetPanel] overwrite candidate generated`
- `[PlaceAssetPanel] overwrite confirmed (old=X new=Y)`
- `[PlaceAssetPanel] overwrite cancelled (new=Y deleted)`
- `[PlaceOverwriteModal] image clicked → lightbox`

### 회귀 테스트

1. 빈 슬롯에서 [이미지 생성] → 기존 흐름 그대로 (모달 X) ✅
2. 기존 이미지 슬롯에서 [이미지 생성] → 잡 done 후 모달 자동 노출 ✅
3. 모달 [덮어쓰기] → 기존 사라짐, 새 이미지로 갱신 + mention 풀 갱신 ✅
4. 모달 [취소] → 새 이미지 삭제, 기존 그대로 ✅
5. 모달 안 이미지 클릭 → lightbox 풀스크린 (v32) ✅
6. 같은 슬롯에서 캐릭터 시트와 결합 영향 0 (분리 동작) ✅

### 비범위
- 백엔드 `/generate` 에 update 모드 추가 (현재는 INSERT-only + DELETE 조합으로 처리)
- 다른 자산 (웨딩사진, 캐릭터 시트는 v31 별도) 동일 패턴 — 별도 작업

---

## v33 — 2026-06-01 — wizard 작성중 draft 백엔드 영속화 + 내작품 작성중 카드

### 요청
작성 중인 wizard 가 sessionStorage 만 있어 다른 디바이스/탭 닫기 시 사라짐 + "내 작품" 에서 보이지 않음. **(c) 정석** 으로 백엔드 drafts 컬렉션에 영속화. "내 작품" 에 작성중 카드 노출. [새로 만들기] = 백지.

### Plan verification findings — 현재 코드

- `frontend/src/pages/StoryWizardPage.jsx`
  - `DRAFT_KEY = 'wedding-wizard-draft'` (line 14) → sessionStorage 만 사용
  - 진입 시 rehydrate (line 220~), 변경마다 자동 persist (line 372~), 잡 생성 완료 시 `sessionStorage.removeItem(DRAFT_KEY)` (line 574)
  - payload = `{step, data}` (data 안에 sheets / story / vow / wedding_context / music_spec / couple 등)
- `frontend/src/pages/MyWeddingMVPage.jsx`
  - `GET /api/mv/jobs` 호출해서 jobs state 채움 (line 17~27)
  - line 80: `<Link to="/wizard">새로 만들기</Link>` — draft 처리 없음
  - jobs 카드 렌더만 (작성중 카드 X)
- `backend_8000/app/routes/mv.py:159 @router.get("/jobs")` — 사용자별 mv_jobs 목록
- `backend_8000/app/database/mongodb.py::ensure_indexes` (line 40~) — 기존 컬렉션 인덱스 ensure 패턴
- `backend_8000/app/main.py:108-117` — 라우터 include

### 데이터 모델

새 컬렉션 `mv_drafts`:
```
{
  _id: ObjectId,
  user_id: str (uuid),         # 인덱스 unique
  payload: dict,               # wizard data 통째로 (sheets/story/...)
  step: int,                   # 마지막 작성 단계 (카드 표시용)
  title: Optional[str],        # 작성 중 제목 단서 (없으면 "작성 중")
  created_at: datetime,
  updated_at: datetime,
}
```

**user 1명 = draft 1개** 정책 (간단함 우선). 다중 draft 필요 시 추후 확장.

### REST API 신설 (모두 `/api/mv/drafts/mine`)

| Method | 동작 | 응답 |
|---|---|---|
| `GET /api/mv/drafts/mine` | 내 draft 1개 조회 | 200 + `{draft: {payload, step, title, updated_at} \| null}` |
| `PUT /api/mv/drafts/mine` | upsert (없으면 생성, 있으면 갱신) | 200 + `{ok: true, updated_at}` |
| `DELETE /api/mv/drafts/mine` | 내 draft 삭제 | 200 + `{ok: true}` |

가드: 인증 필수. user_id 는 토큰에서 추출 — 클라가 박는 게 아님.

페이로드 크기: wizard data 는 base64 이미지 포함 X (object_name 만) → 일반적으로 50KB 이하 예상. 16MB BSON 한도 안전.

### 변경 매트릭스

| # | 파일 | 변경 | 추적자 prefix |
|---|---|---|---|
| 1 | `app/routes/mv_drafts.py` (신설) | `router = APIRouter(prefix="/api/mv/drafts")`. 3개 엔드포인트 (`GET/PUT/DELETE /mine`). 진입/외부호출/에러 로그 패턴 | `[MVDraftRoute]` |
| 2 | `app/main.py:117` 직후 | `app.include_router(mv_drafts.router)` 추가 | — |
| 3 | `app/database/mongodb.py::ensure_indexes` | `mv_drafts.user_id` unique 인덱스 추가 | 기존 `[Startup]` |
| 4 | `frontend/src/api/index.js` | `getMyDraft()`, `saveMyDraft(payload)`, `deleteMyDraft()` 함수 추가 | — |
| 5 | `frontend/src/pages/StoryWizardPage.jsx` | (a) 진입 시 `?new=1` 체크 + `getMyDraft()` 우선 → 빈 상태 또는 복원. (b) 매 변경마다 debounced (1.5초) `saveMyDraft(payload)`. (c) 잡 생성 완료 시 `deleteMyDraft()`. (d) sessionStorage 는 outfit-page round-trip 만 위해 유지 (cross-route 이동 시 백엔드와 같이 박음) | `[StoryWizard]` (기존) |
| 6 | `frontend/src/pages/MyWeddingMVPage.jsx` | (a) 마운트 시 `getMyDraft()` + `getMyJobs()` 병렬. (b) draft 있으면 카드 1개 prepend (작성중 배지 + "이어서 작성" 버튼 → `/wizard`). (c) [새로 만들기] 클릭 시 draft 있으면 confirm — 확인 시 `deleteMyDraft()` 후 `/wizard?new=1` 이동, 취소 시 no-op | `[MyWeddingMV]` |

### 디버깅 로그

- backend `mv_drafts.py` 3 엔드포인트 모두 진입(user_id 일부) + 응답 결과 로그. 에러는 `logger.exception`
- 프론트 wizard: `[StoryWizard] backend draft loaded` / `saved (debounced)` / `deleted (job created)`
- 프론트 MyWeddingMV: `[MyWeddingMV] new-button clicked (draft_present={t/f})`

### 회귀 테스트

1. **단위 (백엔드)**: GET on empty → null. PUT → upsert. PUT 다시 → 같은 _id, updated_at 갱신. DELETE → 200 + 다음 GET null. 인덱스 unique 위반 시 동일 user 두 번째 insert 발생 X.
2. **통합 (UI)**:
   - wizard 작성 중 다른 페이지 이동 → MyWeddingMV 에 작성중 카드 노출 ✅
   - 작성중 카드 클릭 → wizard 재진입 + 상태 복원 ✅
   - [새로 만들기] + draft 있음 → confirm → 확인 시 백지 ✅
   - [새로 만들기] + draft 있음 → confirm → 취소 시 페이지 그대로 (draft 보존) ✅
   - [새로 만들기] + draft 없음 → 바로 백지 ✅
   - 잡 생성 완료 → draft 삭제됨 (다음 진입 시 백지) ✅
3. **회귀**:
   - sessionStorage 기존 동작 (outfit 라운드트립) 영향 없음 — 백엔드 + sessionStorage 둘 다 박는 패턴
   - 기존 mv_jobs 목록 응답 무변형
   - 인덱스 ensure 멱등

### 비범위

- 다중 draft (user 당 N개)
- draft 자동 만료 (TTL)
- draft conflict resolution (다른 디바이스에서 동시에 편집)

---

## v32 — 2026-06-01 — 미리보기 이미지 클릭 확대 (Lightbox)

### 요청
모든 미리보기 이미지를 클릭 시 전체화면 확대로 보기. 백엔드 변경 없음 — 프론트 단일 작업.

### Plan verification findings — 식별된 미리보기 사이트

| 파일 | 위치 | 이미지 종류 |
|---|---|---|
| `CharacterSheetPanel.jsx:611` | 얼굴 업로드 미리보기 | 사용자 업로드 face |
| `CharacterSheetPanel.jsx:704` | 의상 아이템 thumbnail | 옷 자산 |
| `CharacterSheetPanel.jsx:779` | 시트 결과물 preview | 생성된 시트 PNG |
| `PlaceAssetPanel.jsx:443` | 장소 카드 이미지 | 장소 PNG |
| `WeddingPhotoPanel.jsx:620, 662` | 시트 ref 카드 | 시트 reference |
| `WeddingPhotoPanel.jsx:729` | 자산 이미지 | 웨딩 사진 |
| `WeddingPhotoPanel.jsx:935` | 갤러리 카드 | 결과 PNG |
| `WeddingPhotoDetailModal.jsx:399` | 버전 carousel thumb | 결과 버전 |
| `WeddingPhotoDetailModal.jsx:412` | 메인 미리보기 | 결과 큰 이미지 |
| `WeddingPhotoDetailModal.jsx:535` | 헤더 thumb | 결과 thumb |
| `ExtraVideoStudioPanel.jsx:654` | 업로드 미리보기 | 업로드 PNG |
| `ExtraVideoStudioPanel.jsx:1512` | ref 이미지 | 씬 ref |
| `PreCeremonyMVPanel.jsx:1661` | 씬 이미지 미리보기 | 씬 PNG |
| `PreCeremonyMVPanel.jsx:2368` | 씬 이미지 (라이브) | 씬 PNG |
| `PreCeremonyMVPanel.jsx:2498` | LiveSceneCard ref thumb | ref 이미지 |
| `PreCeremonyMVPanel.jsx:3146` | 결과 이미지 | 씬 PNG |

**제외**:
- `Header.jsx:24` (로고)
- `MentionField.jsx:472` (자동완성 드롭다운 작은 thumb — 즉시 클릭 확대는 UX 흐름 깨짐)
- `<video>` element (영상 element 는 별개)

### 변경 매트릭스

| # | 파일 | 변경 | 추적자 prefix |
|---|---|---|---|
| 1 | `components/ImageLightbox.jsx` (신설) | Provider + `useImageLightbox()` hook + `<ZoomableImage>` drop-in img + ESC/dim 클릭 닫기 + body scroll lock | `[ImageLightbox]` |
| 2 | `components/ImageLightbox.css` (신설) | overlay 스타일 (`max-width:92vw, max-height:92vh, dim 0.86`) + `.img-zoomable { cursor: zoom-in }` | — |
| 3 | `App.jsx` | `<AuthProvider>` 안쪽에 `<ImageLightboxProvider>` 감싸기 | — |
| 4 | 위 16개 사이트의 `<img ...>` | `<ZoomableImage ...>` drop-in 교체. import 추가 | 기존 prefix 유지 |

### 회귀 테스트

1. 캐릭터 시트 / 장소 / 웨딩사진 / 씬 이미지 클릭 시 확대 표시 ✅
2. dim 클릭 또는 ESC 키 누르면 닫힘 ✅
3. 이미지 클릭은 닫기 안 됨 (stopPropagation) ✅
4. body scroll lock 해제 — 닫은 후 페이지 스크롤 정상 ✅
5. Header 로고 / 자동완성 thumb 는 그대로 (확대 X)

### 비범위
- 영상 element 확대 (별개 — 영상 모달은 이미 WeddingPhotoDetailModal 등에 있음)
- 줌/팬 인터랙션 (휠 확대 등) — 단순 fit-to-screen 으로 충분

---

## v31 — 2026-06-01 — 캐릭터 시트 자동저장 + 재생성 확인 다이얼로그

### 요청
생성 직후 [저장] 버튼 없이 **자동 DB 저장**. 같은 slot 재생성 시 **확인 다이얼로그** — 취소하면 새 PNG 폐기 + 기존 시트 유지. 4 slot 모두 동일.

### Plan verification findings — 현재 코드

- `frontend/src/components/CharacterSheetPanel.jsx`
  - `handleGenerate` (line 178~) → backend job 생성 → `value.generate_job_id` set
  - polling done 시 (line 387~) → `value.generated = {object_name, preview_url}` set, **저장은 사용자 수동 [저장]** 만
  - `handleSave` (line 228~) → `api.saveCharacterSheet({sheet_object_name, role, style, used_items, image_model, display_name})` 호출 후 `onMentionablesChanged` 콜백
  - UI: line 760~775 — "[다시 생성]" + "[저장]" 두 버튼
- `frontend/src/pages/StoryWizardPage.jsx`
  - `reloadMentionOptions` (line 278~) — `api.getCharacterSheets()` 호출 후 `sheets[slotKey]` map → mentionOptions 갱신
  - 저장된 slot 정보는 이미 sheets 응답에 들어있음 (별도 fetch 불필요)
- 백엔드 `api.saveCharacterSheet` 는 동일 slot 덮어쓰기 이미 지원 (기존 동작) — **백엔드 변경 없음**

### 변경 매트릭스

| # | 파일 | 변경 | 추적자 prefix |
|---|---|---|---|
| 1 | `StoryWizardPage.jsx` | `reloadMentionOptions` 안에서 sheets 응답 기반 `savedSheetSlots` (Set) state 저장. `CharacterSheetPanel` 에 `hasExistingSaved` prop 전달 | `[StoryWizard]` |
| 2 | `CharacterSheetPanel.jsx` | 1) 폴링 done 분기에서 `hasExistingSaved` 보고 분기: false → 자동 `handleSave()`, true → confirm 다이얼로그. 2) 다이얼로그 취소 시 `value.generated = null` 로 폐기. 3) UI 의 [저장] 버튼 제거. 4) `handleSave` 는 다이얼로그 확인 / 첫 저장 모두에서 재사용 | `[CharSheetPanel]` (기존) |

### UX 결정
- **다이얼로그 시점**: 새 PNG 가 생성·표시된 직후 (사용자가 결과 보고 결정)
- **다이얼로그 형태**: `window.confirm("새 시트로 덮어쓰시겠습니까? 취소하면 새로 생성한 시트는 폐기되고 기존 시트가 그대로 유지됩니다.")` — 빠른 구현, 추가 모달 컴포넌트 불필요
- **취소 처리**: `value.generated = null` 만 set. 백엔드 임시 PNG 는 MinIO 에 남지만 다음 생성 시 새 object_name 으로 덮임 (cleanup 별도 작업 v32 후보)
- **첫 생성 (기존 시트 없음)**: 다이얼로그 없이 즉시 자동 저장

### 회귀 테스트

1. **첫 생성 (slot 비어있음)** → 다이얼로그 없이 즉시 자동 저장 → mention 풀 반영 ✅
2. **재생성 → 확인** → 새 PNG 로 덮어쓰기 → mention 풀 갱신 ✅
3. **재생성 → 취소** → 새 PNG 폐기, 기존 시트 그대로 ✅
4. 4 slot (groom_casual/wedding, bride_casual/wedding) 각각 독립 동작 ✅
5. handleRefine (보정 흐름) 영향 없음 ✅

### 비범위

- MinIO 임시 PNG 자동 cleanup (취소된 새 PNG 제거) — v32 후보
- 커스텀 모달 컴포넌트 (window.confirm 대신 inline UI) — UX 개선 후보

---

## v30 — 2026-05-31 — thinking ON 대응: LLM max_tokens 상향

### 요청
v27 의 thinking/reasoning ON 적용 후 thinking/reasoning 토큰이 `max_tokens` 안에 포함됨 → 작은 한도가 빈 응답/잘림 발생. 실측 후 상향.

### Plan verification findings — 웹검색 + 실측

**사양 (2026 공식)**:
- **Anthropic Claude Opus 4.7**: `max_tokens` 는 hard ceiling. **thinking tokens + output tokens 의 합**이 그 안에 들어가야 함. budget_tokens 자체가 deprecated (adaptive 가 자동 결정). Anthropic SDK 비-streaming 은 ~10분 예상 한도 — 너무 크면 ValueError. 우리 영역 16000 이하 안전.
- **OpenAI GPT-5.x**: `max_completion_tokens` 가 **reasoning_tokens + completion_tokens 합 한도**. reasoning_effort=high 면 reasoning_tokens 가 크게 늘어남.

**실호출 측정 결과**:

| 케이스 | max_tokens | 측정 결과 | 결과 |
|---|---|---|---|
| Claude trivial ("2+2") | 256 | input=18 output=23, thinking_blocks=**0** | 정상 (adaptive 가 안 켬) |
| Claude medium (5 씬 영문) | 1500 | input=103 output=181, thinking_blocks=**0** | 정상 |
| Claude heavy (12 씬 분할) | 8000 | input=249 output=2294, thinking_blocks=**0** | 정상 |
| **OpenAI title 호출 (현재 50)** | **50** | **comp=50 reasoning=50 text_len=0 finish=`length`** | ⚠ **빈 응답! CRITICAL** |
| OpenAI medium (5 씬) | 1500 | comp=415 reasoning=327 text=385자 | 정상 |
| OpenAI trivial | 256 | comp=4 reasoning=0 | 정상 |

**핵심 결론**:
- Claude adaptive 는 우리 입력 정도에선 thinking_blocks=0 으로 자동 절약 — 한도 부족 위험 낮음. 안전 마진만 추가.
- OpenAI reasoning_effort=high 는 **reasoning_tokens 50~400 정도 상시 소비**. 작은 한도(50/lyrics title) 가 즉시 깨짐.

### 현재 코드 max_tokens 매트릭스 + 상향안

| 사이트 | 함수/상수 | 현재 | 측정 위험 | **새 한도** |
|---|---|---|---|---|
| `pre_mv_phase0_mapper.py:302` | `_MAX_TOKENS = 10000` | 10000 | 안전, 마진 추가 | **12000** |
| `pre_mv_phase1_splitter.py:718-726` | `_max_tokens_for_scene_split` (base=6000, per=600, cap=12000) | base 6000 / cap 12000 | Anthropic SDK ~10분 timeout 안전선 12000 — 더 못 올림 | base 6000 / **cap 12000 유지** (Anthropic SDK 제약) |
| `pre_mv_scene_mirror.py:67` | `_MAX_TOKENS_MIRROR = 1500` | 1500 | reasoning=300+ 가능 → 출력 ~1200 | **4000** |
| `story_polisher.py:108` | `_max_tokens_for_text` `min(2048, max(256, len*4))` | min=256, max=2048 | reasoning 300+ 시 짧은 텍스트는 출력 부족 | **min 768, max 4096** |
| `lyrics_generator.py:536-542` | `_max_tokens_for_duration` 2분=1200, 3분=2000 | 1200/2000 | 가사 본문 길고 + reasoning 200~400 | 2분=**2400**, 3분=**4000**, 기본=**3000** |
| `lyrics_generator.py:571, 599, 615` | title `max_tokens=50` | **50** | **🚨 CRITICAL — 빈 응답 100% 재현** | **400** |

### 변경 매트릭스

| # | 파일 | 변경 | 추적자 prefix |
|---|---|---|---|
| 1 | `pre_mv_phase0_mapper.py` | `_MAX_TOKENS = 10000 → 12000` | 기존 |
| 2 | `pre_mv_phase1_splitter.py` | cap 12000 유지 (SDK 제약). 주석 갱신 | 기존 |
| 3 | `pre_mv_scene_mirror.py` | `_MAX_TOKENS_MIRROR = 1500 → 4000` | 기존 |
| 4 | `story_polisher.py` | `_max_tokens_for_text` 하한 256→768, 상한 2048→4096 | 기존 |
| 5 | `lyrics_generator.py` | duration map: 2분 1200→2400, 3분 2000→4000, default 1500→3000. **타이틀 4곳 50→400** | 기존 |

### 회귀 테스트

1. OpenAI title 호출 (50→400) — 정상 텍스트 1~5단어 출력.
2. mirror 1500→4000 — Claude/OpenAI 양쪽 응답 잘리지 않음.
3. Claude phase1 cap 12000 — 20+ 씬 입력에서 stop_reason != "max_tokens" 확인.
4. SDK timeout — Anthropic 비-streaming 요청 ValueError 없는지.

### 비범위

- phase1 cap 16000 상향 (SDK timeout 제약). 정말 필요해지면 streaming 도입.
- thinking 끄기 (`LLM_THINKING_DISABLED=1`) — 본 작업 범위 외.

---

## v29 — 2026-05-31 — 화면 비율 16:9 통일 (캐릭터 시트만 1:1 유지)

### 요청
씬 이미지 / 씬 영상 / 장소 / 웨딩사진 = **16:9** 통일. 캐릭터 시트만 1:1 유지. 씬 이미지 default 모델은 **GPT Image 2** 유지 (변경 금지).

### Plan verification findings — 코드 상태

**이미지 호출 (5개 진입 사이트)**:

| 사이트 | 현재 size / 비율 | 적용 후 |
|---|---|---|
| `app/services/openai_image.py:147` (default) | `size="2048x2048"` (1:1) | `"2048x1152"` (16:9) — 단 호출자가 명시 박으므로 default 는 형식만 변경 |
| `app/services/openai_image.py:37` (화이트리스트) | `("1024x1024","1024x1792","1792x1024","2048x2048","auto")` | `"1536x864", "2048x1152"` 추가 |
| `app/services/extra_scene_image_generator.py:492` (씬 이미지) | `size="1024x1024"` | `"2048x1152"` |
| `app/services/pre_mv_phase2_image_generator.py:499` (씬 이미지) | `size="1024x1024"` | `"2048x1152"` |
| `app/services/place_generator.py:87` (장소) | `size="1024x1024"` | `"2048x1152"` |
| `app/services/wedding_photo_generator.py:235` (웨딩사진) | `size="1024x1024"` | `"2048x1152"` |
| `app/services/character_generator.py` (캐릭터 시트) | `size="1024x1024"` | **유지** (1:1) |

**Nano Banana Pro 호출 (단일 진입)**:

| 사이트 | 현재 | 적용 후 |
|---|---|---|
| `app/services/character_generator.py::_call_gemini_image` | payload 에 imageConfig 키 **없음** | 함수 시그니처 `aspect_ratio: str = "1:1"` 옵션 추가. payload `generationConfig.imageConfig: {aspectRatio: ..., imageSize: "2K"}` 머지 |
| 호출자: character_generator self (line 698) | default | `aspect_ratio="1:1"` (캐릭터 시트) |
| 호출자: extra_scene_image_generator:501 | default | `aspect_ratio="16:9"` |
| 호출자: pre_mv_phase2_image_generator | default | `aspect_ratio="16:9"` |
| 호출자: place_generator:116 | default | `aspect_ratio="16:9"` |

**영상 호출 (4개 모델)**:

| 모델 | 현재 | 적용 후 |
|---|---|---|
| Veo 3.1 (`pre_mv_veo_generator.py:46`) | `aspectRatio: "16:9"` | **유지** ✅ |
| Kling 3.0 Omni (`pre_mv_kling_generator.py:167`) | `aspect_ratio: "16:9"` | **유지** ✅ |
| Seedance 2.0 (`pre_mv_seedance_generator.py:121-129`) | body 에 aspect_ratio 키 없음 (fal default = `"auto"`) | body 에 `"aspect_ratio": "16:9"` 추가 |
| Grok (`pre_mv_grok_generator.py:147`) | body 에 aspect_ratio 키 없음 (xAI default = `"16:9"`) | body 에 `"aspect_ratio": "16:9"` 명시 추가 (안전 마진) |

**프론트엔드**:
- 씬 이미지 default 모델 `'gpt_image_2'` (PreCeremonyMVPanel.jsx:59, 1869) → **변경 없음** (사용자 요구).
- 비율 선택 UI 없음 — 백엔드가 박은 값 그대로 사용.

### GPT Image 2 16:9 사이즈 결정

웹검색 사양: width/height 16배수, 비율 1:3~3:1 범위.

| 후보 | 픽셀 수 | 비율 | 비고 |
|---|---|---|---|
| 1536×864 | 1.33M | 16:9 ✓ | 빠르고 가벼움 |
| **2048×1152** | **2.36M** | **16:9 ✓** | **거의 1080p 와이드 — 영상 입력으로 최적** |
| 1920×1080 | 2.07M | 16:9 ✓ | 16배수 ❌ (1080/16=67.5) — 사용 불가 |

→ **`"2048x1152"`** 채택.

### 변경 매트릭스

| # | 파일 | 변경 | 추적자 prefix |
|---|---|---|---|
| 1 | `openai_image.py` | 화이트리스트 + default size 16:9 호환 확장 | 기존 |
| 2 | `extra_scene_image_generator.py` | size 1024×1024 → 2048×1152. _call_gemini_image 호출에 aspect_ratio="16:9" | 기존 |
| 3 | `pre_mv_phase2_image_generator.py` | 동일 | 기존 |
| 4 | `place_generator.py` | 동일 | 기존 |
| 5 | `wedding_photo_generator.py` | size 1024×1024 → 2048×1152 (GPT Image 2 only — Nano Banana 안 씀 확인) | 기존 |
| 6 | `character_generator.py` | self 시트는 1:1 유지. `_call_gemini_image` 에 `aspect_ratio` 옵션 추가 + payload imageConfig 머지 | 기존 |
| 7 | `pre_mv_seedance_generator.py` | body 에 `"aspect_ratio": "16:9"` 추가 | 기존 |
| 8 | `pre_mv_grok_generator.py` | body 에 `"aspect_ratio": "16:9"` 명시 | 기존 |

### 회귀 테스트 항목

1. 단위: 각 호출 사이트의 payload/kwargs 에 정확한 비율 키·값 박혔는지 inspect.
2. 캐릭터 시트는 여전히 1:1 (size + Nano Banana aspect_ratio 모두).
3. Seedance/Grok body 에 `"aspect_ratio": "16:9"` 박혔는지.
4. 화이트리스트 확장이 기존 호출 깨뜨리지 않는지 (1024×1024 도 여전히 허용).

### 비범위

- 사용자에게 비율 선택 UI 노출 (현재 16:9 강제 통일).
- 21:9 시네마틱 post-crop (별도 후처리 단계 필요 — 본 작업 범위 외).

---

## v28 — 2026-05-31 — 이미지/영상 모델 thinking 모드 검토 + 적용

### 요청
이미지 생성 모델 (GPT Image 2, Nano Banana Pro) + 영상 생성 모델 (Kling 3.0 Omni, Veo 3.1, Seedance 2.0, Grok) 의 thinking 모드 활성화. 모델별 사양을 **웹검색으로 확인** 후 지원하는 모델만 ON. 미지원 모델 명시.

### Plan verification findings — 웹검색 결과

| 모델 | thinking 모드 지원? | 비고 / 출처 |
|---|---|---|
| **GPT Image 2** | ❌ 미지원 | 공식 OpenAI 페이지 + aimlapi 페이지 둘 다 `thinking` 파라미터 **없음**. 이미지 생성 endpoint 의 정식 파라미터 목록(model/prompt/size/quality/output_format/background/moderation/n/output_compression/response_format) 어디에도 reasoning/thinking 키 없음. 초기 검색의 LLM 요약은 텍스트 모델 가이드와 혼동된 응답. |
| **Nano Banana Pro** (Gemini 3 Pro Image Preview) | ✅ 지원 (조건부) | Gemini 3 generateContent API 가 `generationConfig.thinkingConfig.thinkingLevel` 지원 (minimal/low/medium/high). 모델 default 가 high. **단** Image Preview 모델이 같은 옵션을 정식으로 받는지는 공식 페이지 404 라 100% 단정 불가 → 적용 후 400 fallback 분기로 검증. |
| **Kling 3.0 Omni** | ❌ API 미노출 | Chain-of-Thought 가 **모델 학습 단계 (SFT)** 에 내장. 추론 시 자동 동작하지만 **API 파라미터로 토글 불가**. fal.ai endpoint 사양에 관련 키 없음. |
| **Veo 3.1** | ❌ 미지원 | Gemini API 의 thinking 은 일반 텍스트 모델(Gemini 3 Pro Flash 등) 한정. Veo 3.1 predictLongRunning 사양에 thinking 키 없음. |
| **Seedance 2.0** | ❌ 미지원 | fal.ai bytedance/seedance-2.0 endpoint 사양 (prompt/image_url/duration/end_image_url/aspect_ratio/resolution) 어디에도 thinking 키 없음. |
| **Grok 영상 (Grok Imagine)** | ❌ 미지원 | xAI 의 `reasoning_effort` 는 **텍스트 모델 (Grok-4.x)** 만. Grok Imagine 의 영상 generation API 사양에 thinking 키 없음. |

### Plan verification findings — 현재 코드 (이미지 모델 호출 사이트)

- **GPT Image 2** 호출 단일 진입: `app/services/openai_image.py::generate_image`
  - 2개 endpoint: `/v1/images/generations` (text-to-image), `/v1/images/edits` (multi-ref).
  - 호출자: character_generator / place_generator / extra_scene_image_generator / pre_mv_phase2_image_generator 4곳에서 `openai_image.generate_image` 1단 호출.
  - 적용 불가 (모델 자체가 thinking 노출 안 함) → 변경 없음.
- **Nano Banana Pro** 호출 단일 진입: `app/services/character_generator.py::_call_gemini_image` (line 703)
  - URL: `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent`
  - 현재 payload `generationConfig: {responseModalities: ["TEXT","IMAGE"]}`.
  - 적용: `generationConfig.thinkingConfig: {thinkingLevel: "high"}` 추가.
  - 400 거부 시 안전 fallback (제거 후 재시도). 호출자: 같은 4 generator.

### 변경 매트릭스

| # | 파일 | 변경 | 추적자 prefix |
|---|---|---|---|
| 1 | `app/services/llm_thinking_config.py` | `gemini_image_thinking_config(model_url_or_name)` 헬퍼 추가 — `{"thinkingConfig":{"thinkingLevel":"high"}}` 반환. 글로벌 `LLM_THINKING_DISABLED` 적용 | `[ThinkingConfig]` |
| 2 | `app/services/character_generator.py::_call_gemini_image` | payload `generationConfig` 에 thinkingConfig 머지. 응답 400 + 메시지에 "thinking" 포함 시 폴백으로 thinkingConfig 제거 후 1회 재시도 | `[CharGen]` (기존) |

GPT Image 2 / Kling / Veo / Seedance / Grok — **코드 변경 없음** (모델 미지원).

### 회귀 테스트 항목 (Tester)

1. 헬퍼 `gemini_image_thinking_config(...)` → `{"thinkingConfig":{"thinkingLevel":"high"}}` 정상 반환. `LLM_THINKING_DISABLED=1` 시 빈 dict.
2. payload syntax 검증 — `generationConfig` 안에 `thinkingConfig.thinkingLevel="high"` 박혔는지 단위 테스트로 확인 (실 API 호출 없이).
3. fallback 분기 — 400 응답 (thinking 거부) 시 thinkingConfig 빼고 재시도하는지 mocked 테스트.
4. 회귀: GPT Image 2 호출 사이트는 변경 없음 — 기존 generate_image 동작 그대로.

### 사용자 보고 대상 (thinking 미지원 모델)

- **GPT Image 2**: 모델 자체에 thinking 노출 없음.
- **Veo 3.1**: 영상 generation 모델 — thinking API 노출 없음.
- **Kling 3.0 Omni**: Chain-of-Thought 가 모델 내장(자동 동작), API 토글 불가.
- **Seedance 2.0**: thinking 노출 없음.
- **Grok Imagine 영상**: thinking 노출 없음 (텍스트 모델 Grok-4.x 만 reasoning_effort 지원).

### 비범위

- Veo/Kling/Seedance/Grok 영상 모델은 코드 변경 없음 (사양 미지원).
- 영상 모델에서 chain-of-thought 모방하려는 prompt-side trick (체크리스트 prefix 등) — 별도 R&D.

---

## v27 — 2026-05-31 — LLM 호출 일괄 thinking/reasoning 모드 ON

### 요청
프로젝트의 모든 LLM 호출 (Claude Opus 4.7 / GPT-5.x) 을 thinking/reasoning 모드 켠 상태로 동작시키기. Anthropic SDK adaptive thinking + OpenAI reasoning_effort 적용. **2026년 시점 공식 사양을 웹검색으로 확인** 후 진행.

### Plan verification findings — 웹검색으로 확인한 2026 사양

- **Anthropic Claude Opus 4.7/4.8** (adaptive thinking)
  - 파라미터: `thinking={"type": "adaptive"}` — 권장. Opus 4.8 은 `adaptive` 만 지원.
  - **CRITICAL**: Opus 4.7+ 는 `temperature` / `top_p` / `top_k` 가 요청 본문에 있으면 **400 에러**. 키 존재 자체로 거부.
  - `max_tokens` 필수. streaming 호환 (필수 아님).
  - 출처: [Building with extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking), [Claude Opus 4.7 Temperature deprecation](https://blog.laozhang.ai/en/posts/claude-opus-4-7-temperature-parameter)
- **OpenAI GPT-5.x** (reasoning)
  - 파라미터: `reasoning_effort: "low" | "medium" | "high" | "xhigh"` (default=`medium`).
  - 사용자 요청 "다 켜라" → **`"high"`** 채택 (xhigh 는 비용/지연 큼).
  - **CRITICAL**: GPT-5 계열은 `temperature` / `top_p` 제거 필수 — 안 그러면 `"Unsupported parameter: 'temperature'"` 400 에러.
  - 출처: [GPT-5.4 API Developer Guide](https://www.nxcode.io/resources/news/gpt-5-4-api-developer-guide-reasoning-computer-use-2026), [LibreChat issue #10737](https://github.com/danny-avila/LibreChat/issues/10737)

### Plan verification findings — 현재 코드

LLM 호출 사이트 5곳 (image generation API 인 `openai_image.py` 는 reasoning 대상 아님 → 제외):

| 파일 | Anthropic 호출 | OpenAI 호출 | 현재 temperature |
|---|---|---|---|
| `pre_mv_phase0_mapper.py` | `messages.create(**kwargs)` line 315 | `chat.completions.create(**kwargs)` line 331/336 | 0.5 |
| `pre_mv_phase1_splitter.py` | `messages.create(**kwargs)` line 745 | `chat.completions.create(**kwargs)` line 781/786 | 0.5 |
| `pre_mv_scene_mirror.py` | `messages.create(**kwargs)` line 124 | `chat.completions.create(**kwargs)` line 141/147 | 0.3 |
| `story_polisher.py` | `messages.create(**kwargs)` line 149 | `chat.completions.create(**openai_kwargs)` line 175 | varies |
| `lyrics_generator.py` | `messages.create(**lyrics_kwargs)` 588, `messages.create(**title_kwargs)` 602 | `chat.completions.create(model=..., temperature=0.8, ...)` 547, 558 (inline) | 0.8 / 0.7 |

설정 모델:
- `settings.openai_model_advanced = "gpt-5.4"`
- `settings.wedding_lyrics_default_model = "claude-opus-4-7"`
- SDK: `anthropic==0.97.0`, `openai==2.33.0` — 둘 다 adaptive thinking / reasoning_effort 지원 버전.

### 변경 매트릭스

| # | 파일 | 변경 | 추적자 prefix |
|---|---|---|---|
| 1 | `backend_8000/app/services/llm_thinking_config.py` (신설) | 공통 헬퍼: `claude_thinking_kwargs(model)`, `openai_reasoning_kwargs(model)`, `strip_unsupported_sampling(kwargs, model)`. 환경 변수 `LLM_THINKING_DISABLED=1` 로 글로벌 off 옵션 | `[ThinkingConfig]` |
| 2 | `pre_mv_phase0_mapper.py` | `_call_claude` / `_call_openai` 마지막 단계에 헬퍼 머지 + sampling param strip | `[PreMVPhase0]` (기존) |
| 3 | `pre_mv_phase1_splitter.py` | 동일 | `[PreMVPhase1]` (기존) |
| 4 | `pre_mv_scene_mirror.py` | 동일 | `[SceneMirror]` (기존) |
| 5 | `story_polisher.py` | 동일 | `[Polisher]` (기존) |
| 6 | `lyrics_generator.py` | Anthropic 2건 + OpenAI 2건 inline 모두 적용 (inline 호출은 kwargs 빌더로 일반화) | `[LyricsGen]` (기존) |

### 헬퍼 동작 규약

```python
# 모델 → adaptive 지원 여부
_ADAPTIVE_MODELS = {"claude-opus-4-6", "claude-opus-4-7", "claude-opus-4-8", "claude-sonnet-4-6"}
_REASONING_OPENAI_PREFIXES = ("gpt-5", "o1", "o3", "o4")

def claude_thinking_kwargs(model: str) -> dict:
    if model in _ADAPTIVE_MODELS:
        return {"thinking": {"type": "adaptive"}}
    # 오래된 4.5/3.5 등은 legacy enabled+budget (or 빈 dict)
    return {}

def openai_reasoning_kwargs(model: str) -> dict:
    if any(model.startswith(p) for p in _REASONING_OPENAI_PREFIXES):
        return {"reasoning_effort": "high"}
    return {}

def strip_unsupported_sampling(kwargs: dict, model: str) -> dict:
    """Opus 4.7+ / GPT-5+ 는 temperature/top_p/top_k 400 거부 — 제거."""
    if model in _ADAPTIVE_MODELS or any(model.startswith(p) for p in _REASONING_OPENAI_PREFIXES):
        for k in ("temperature", "top_p", "top_k"):
            kwargs.pop(k, None)
    return kwargs
```

### 디버깅 로그 규약

각 LLM 호출 사이트 진입 직전에 추가:
```python
logger.info("[XxxModule] llm call model=%s thinking=%s reasoning=%s temperature_removed=%s",
    model, bool(thinking_kw), bool(reasoning_kw), removed_keys)
```

응답 후 thinking usage 메타 로깅 (Anthropic 응답의 `usage.thinking_tokens` 같은 필드가 있다면):
```python
logger.info("[XxxModule] llm done model=%s input=%d output=%d thinking=%d stop=%s",
    model, in_tok, out_tok, think_tok, stop_reason)
```

### 회귀 테스트 항목 (Tester)

1. **헬퍼 단위**: claude_thinking_kwargs("claude-opus-4-7") → `{"thinking":{"type":"adaptive"}}`. openai_reasoning_kwargs("gpt-5.4") → `{"reasoning_effort":"high"}`. strip 함수가 temperature/top_p 제거.
2. **실 호출 — Claude**: scene_mirror 등 짧은 호출 1건으로 실 API 호출. 200 응답 + thinking 메타 확인. 400 거부 0건.
3. **실 호출 — OpenAI**: 같은 호출의 OpenAI fallback 경로. 200 + reasoning_effort 메타.
4. **temperature 잔존 회귀**: grep 으로 `temperature=` 직접 박힌 곳이 호출 직전 strip 거치는지 확인.
5. **LLM_THINKING_DISABLED=1 글로벌 off**: 환경 변수 설정 시 모든 헬퍼 빈 dict 반환 + sampling strip 도 비활성. 기존 동작 복귀.
6. **응답 스키마 동일**: thinking 적용 후 응답 본문(content[0].text) 추출 방식 변화 없음 — 기존 파서 무변형.

### 비범위

- Gemini (Phase 2 image, scenario generator) 의 thinking 옵션 — 별도 SDK, 본 작업 범위 외.
- 영상 모델 (Seedance / Kling / Grok) — LLM 아님.
- 이미지 생성 (GPT Image 2) — reasoning 대상 아님.

---

## v26 — 2026-05-30 — 추가영상생성: 식전영상 씬 이미지 @멘션 추가 (다중 허용)

### 요청
추가영상생성 탭의 씬 이미지 생성 입력에서, 기존 `@캐릭터시트 / @장소 / @웨딩사진` 자동완성 풀에 **'식전영상' 탭에서 만들어진 씬 이미지들**을 `@챕터명_씬번호` 토큰으로 추가. 한 프롬프트 안에서 **여러 씬 이미지를 동시에** 멘션 가능해야 함. 동작은 기존 asset 토큰과 100% 동일 — 토큰 1개당 ref 이미지 1장 첨부.

### Plan verification findings (0단계 코드 분석 결과)

- 멘션 컴포넌트 `frontend/src/components/MentionField.jsx`
  - `options: {type, asset_id, display_name, object_name, group_label}[]` 받음 — 임의 type 자유. 새 type 추가가 자연스러움.
  - 본문에서 longest-match 로 `@display_name` 매칭 (story_slot 에 `_` 들어가도 안전).
  - 다중 동일 토큰 + 다중 type 혼용 모두 reconcile 됨 — 추가 작업 없이 다중 지원.
- 풀 생성처 `frontend/src/components/ExtraVideoStudioPanel.jsx:235-270`
  - `mentionOptions` useMemo 에 owner_sheets / owner_places / wedding_photos 만 매핑 중. `pre_mv_scenes` 추가 필요.
- 컨텍스트 fetch `backend_8000/app/routes/mv.py:200-286` GET `/api/mv/jobs/{job_id}/context`
  - 현재 응답에 `pre_mv_scenes` 필드 없음. 추가 필요.
- pre_mv 잡 연결: `pre_mv_jobs.mv_job_id == job_id` 로 연결됨 (1:1, 확인됨). `scenes[].image_object_name / story_slot / scene_number` 필드 존재.
- 백엔드 리졸버 `backend_8000/app/services/extra_scene_image_generator.py`
  - `_resolve_sheet_ref / _resolve_asset_ref` 패턴. `type ∈ {sheet, place, wedding_photo}` 만 처리. `scene_image` 분기 추가 필요.
  - `_ref_label` 도 `scene_image` 라벨 추가 필요.
  - `MAX_REFS = 4` 상수. scene_image ref 도 그 4장 안에서 계수 — 변경 없음.

### 갭 요약

| 항목 | 현재 | 목표 |
|---|---|---|
| context API 응답 | sheets / places / wedding_photos 만 | `pre_mv_scenes: [{token, label, object_name, scene_number, story_slot, seq_in_slot}]` 추가 |
| 프론트 mentionOptions | 3 type | 4 type (scene_image 그룹 추가) |
| backend ref resolver | sheet / place / wedding_photo | + scene_image (asset_id = 토큰 문자열) |
| `_ref_label` | 3 분기 | + scene_image 분기 ("씬 — {label}") |
| 다중 토큰 | 이미 가능 | 그대로 (MentionField reconcile 이 다중 처리) |

### 토큰 규약

- 토큰 형식: `@{story_slot}_{seq_in_slot}`
  - 예: `@meeting_1`, `@first_date_2`, `@memory_8`, `@wedding_prep_3`
- `seq_in_slot` 은 같은 story_slot 의 scene_number 오름차순 1-base 순번.
- frontend `asset_id` = 토큰 문자열 (`meeting_1`).
- backend 는 `pre_mv_jobs.scenes` 를 같은 규약으로 다시 indexing 해서 image_object_name lookup.
- 동일 mv_job 내에서만 풀 구성 (다른 잡의 씬을 끌어오지 않음).

### 변경 매트릭스

| # | 파일 | 변경 | 추적자 prefix |
|---|---|---|---|
| 1 | `backend_8000/app/routes/mv.py` `get_job_context` | `pre_mv_scenes` 필드 추가 (mv_job_id 로 pre_mv_jobs 1건 lookup → scenes 매핑) | `[MVRoute]` |
| 2 | `backend_8000/app/services/extra_scene_image_generator.py` | `_resolve_scene_image_ref(mv_job_id, token)` 신설. generate 메인 루프에 `t == "scene_image"` 분기 추가. `_ref_label` 에 scene_image 분기 추가. | `[ExtraSceneImage]` |
| 3 | `frontend/src/components/ExtraVideoStudioPanel.jsx` `mentionOptions` | `context.pre_mv_scenes` 매핑 추가 (group_label='🎬 식전영상 씬') | `[ExtraSceneImagesPanel]` (기존) |
| 4 | `frontend/src/components/MentionField.jsx` 팝업 placeholder 아이콘 | sheet/place 외 type 에 대해 placeholder 아이콘 추가 (현 코드는 sheet 만 🧑) | `[MentionField:*]` (기존) |

### 디버깅 로그 규약

- 백엔드 `_resolve_scene_image_ref`: 진입 `mv_job_id`, `token` 로깅. 실패 시 warning (없는 토큰/메타 누락).
- 백엔드 `get_job_context`: 응답의 `pre_mv_scenes` 개수 로깅.
- 프론트 `mentionOptions` useMemo: dev-가드 로 scene_image 옵션 개수 표시.

### 회귀 테스트 항목 (Tester)

1. 단일 scene_image 토큰: `@meeting_1` 만 → 그 PNG 가 ref 로 첨부.
2. 다중 scene_image 토큰: `@meeting_1 + @first_date_2` → 두 PNG 모두 ref 슬롯 점유.
3. 혼합: `@meeting_1 + @groom_casual + @한강공원` → 3 type 모두 ref 로 전달.
4. MAX_REFS 초과: 업로드 2장 + scene_image 토큰 3개 → 합산 4장에서 컷, 우선순위는 업로드 → @멘션 순(기존 정책 유지).
5. 잘못된 토큰: `@meeting_99` (존재하지 않는 seq) → warning + ref 누락 + 나머지로 진행.
6. story_slot 에 `_` 포함: `@first_date_2` 정확히 파싱.
7. 회귀: 기존 sheet/place/wedding_photo 단독 사용 그대로 동작.
8. 풀 빈 케이스: pre_mv_jobs 가 없는 mv_job → `pre_mv_scenes: []` 반환, 다른 풀은 정상.

### 비범위

- 씬 이미지 멘션을 "씬 영상 생성" 입력에 사용 (현 구현은 추가영상생성 탭의 "씬 이미지 생성" 입력만 대상). 영상 생성은 별개 흐름.
- 챕터(story_slot) 라벨링 변경 (현재 5종 고정).

---

## v25 — 2026-05-30 — 영상 모더레이션 안전망(Layer 1/2/3) 도입

### 요청
fal.ai Seedance 가 출력 모더레이션(`content_policy_violation` — Output {video|audio} has sensitive content)로 일부 씬을 422 거부함. 음악 플랫폼(`0_platform_music/backend_9004`) 에 누적된 2-stage 안전망(v64 sanitize + v65 시스템 프롬프트 가이드)을 wedding 백엔드에 이식하고, 추가로 실패 핸들링(Layer 3) 까지 도입.

### Plan verification findings (0단계 코드 분석 결과)

- `backend_8000/app/services/pre_mv_video_prompts.py:505-567`
  - `SAFETY_TRIGGER_PHRASES` 22개 + `sanitize_for_seedance()` 단순 needle-match 함수가 **이미 존재**.
- `backend_8000/app/services/pre_mv_seedance_generator.py:31,303`
  - `sanitize_for_seedance` 호출됨 — **Seedance 호출에는 이미 Layer 2 적용 중**.
- `backend_8000/app/services/pre_mv_kling_generator.py`, `pre_mv_grok_generator.py`
  - sanitize 호출 **없음** — Kling/Grok 호출 시 LLM 원본 prompt 가 그대로 들어감.
- `backend_8000/app/services/extra_video_generator.py`
  - 별도 호출 경로(추가영상). `extra_video_prompts.compose_extra_video_prompt` 결과를 사용. sanitize 호출 없음.
- `backend_8000/app/services/pre_mv_phase1_splitter.py`
  - LLM 으로 씬별 `image_prompt`/`video_prompt`/`image_prompt_ko`/`video_prompt_ko` 생성. **Layer 1 가이드 블록 없음**.
- `backend_8000/app/services/pre_mv_phase2_image_generator.py`
  - 이미지 생성 LLM 프롬프트. **Layer 1 가이드 블록 없음**.
- `backend_8000/app/services/pre_mv_video_prompts.py::compose_video_prompt`
  - 정적 코드 조합(LLM 호출 X) → 시스템 프롬프트 가이드 블록 추가 불가. Layer 2 sanitize 만 통과 가능.
- `backend_8000/app/routes/pre_mv.py:2287-2451`
  - phase3 worker. `video_error` 에 raw exception 문자열 박힘. `content_policy_violation` / `sensitive content` 키워드 감지 후 **즉시 fail / 한국어 사유 별도 보관** 로직 **없음**.
- `backend_8000/app/services/pre_mv_seedance_generator.py:121-129`
  - Seedance body 빌더에 audio 관련 옵션 없음. fal Seedance 2.0 endpoint 스펙상 `generate_audio` 같은 명시적 옵션이 노출됐는지 미확인 → 본 v25 작업 범위에서는 **다루지 않음**(별도 R&D).

### 갭 요약 (현재 ↔ 목표)

| 레이어 | 현재 | 목표 |
|---|---|---|
| L1: LLM 시스템 프롬프트 가이드 | 없음 | Phase 1 splitter 시스템 프롬프트에 "Video output filter — NEVER write..." 블록 추가 |
| L2: 영상 호출 직전 sanitize | Seedance 만 | Seedance + Kling + Grok + Extra Video 모두 적용. 함수명 `sanitize_video_prompt` 로 일반화하고 기존 `sanitize_for_seedance` 는 alias 로 유지(호환). 패턴은 regex 화(9004 v64 패턴 포팅) |
| L3: content_policy 실패 핸들링 | 일반 ValueError 로만 처리 | phase3 worker 에서 `content_policy_violation`/`sensitive content` 감지 시 한국어 사유 메시지 별도 필드(`video_error_reason: "content_policy"`)에 박고, 일반 video_error 텍스트는 사용자용 한국어 문구로 치환 |

### 변경 매트릭스

| # | 파일 | 변경 | 추적자 prefix |
|---|---|---|---|
| 1 | `backend_8000/app/services/pre_mv_video_prompts.py` | `_VIDEO_PROMPT_UNSAFE_PATTERNS` regex 리스트 추가, `sanitize_video_prompt()` 신설, `sanitize_for_seedance = sanitize_video_prompt` alias 유지 | `[PromptSanitize]` |
| 2 | `backend_8000/app/services/pre_mv_kling_generator.py` | 호출 직전 `sanitize_video_prompt(prompt)` 통과 | 기존 `[PreMVKling]` 유지 |
| 3 | `backend_8000/app/services/pre_mv_grok_generator.py` | 호출 직전 `sanitize_video_prompt(prompt)` 통과 | 기존 `[PreMVGrok]` 유지 |
| 4 | `backend_8000/app/services/extra_video_generator.py` | 모델 호출 전 prompt sanitize | 기존 `[ExtraVideo]` 유지 |
| 5 | `backend_8000/app/services/pre_mv_phase1_splitter.py` | 시스템 프롬프트 끝에 v65 가이드 블록 append | 기존 `[PreMVPhase1]` 유지 |
| 6 | `backend_8000/app/routes/pre_mv.py` | phase3 worker 의 ValueError 캐치 분기에 content_policy 감지 → `video_error_reason="content_policy"` + 한국어 user-facing 메시지 박기 | 기존 `[PreMVRoute]` 유지 |
| 7 | `frontend/src/components/PreCeremonyMVPanel.jsx` | `LiveSceneCard` 에서 `video_error_reason === "content_policy"` 분기 표시 | `[LiveSceneCard]` |

### Layer 1 가이드 블록 (Phase 1 splitter 시스템 프롬프트 끝에 append)

```
## v25 — Video output content safety (CRITICAL — Seedance / Kling / Grok 모두 출력 모더레이션 적용)
영상 모델은 GENERATED frame/오디오를 자동 스캔하여 위반 시 422 거부한다. STRICT:
- 다음 트리거 표현은 절대 금지(image_prompt / video_prompt 어느 슬롯이든):
  "alone faces camera directly", "alone faces camera", "alone facing camera",
  "mouth open", "singing with mouth open", "singing the chorus joyfully",
  "sparkling eyes", "expressive eyes", "bright expressive eyes",
  "bright smile", "joyful expression", "joyful gesture",
  "hair lifted by a gentle breeze", "hair lifting in the wind", "hair lifting",
  "slight head sway", "rhythmic shoulder movement", "shoulder sway",
  "hands lightly raised in a joyful gesture",
  "eyes closed, breathing in the scent",
  "drowning in a soft pink-petal storm",
  "K-pop MV grade", "K-pop MV".
- 안전 대체 표현 권장: "framed in a medium close-up", "softly mouthing the lyrics",
  "soft warm expression", "subtle smile", "natural pose",
  "soft breeze drifts in the air", "hands resting naturally",
  "surrounded by gently drifting petals", "with a gentle expression",
  "cinematic pastel grade".
- 인물 외모 강조(매력/매혹/유혹) 어휘 금지. 광고 모델 컷이 아닌 "영화 한 장면" 으로 묘사.
- 카메라 동작과 인물 동작은 별도 문장에 분리.
```

### Layer 2 — 패턴 규약

- `_VIDEO_PROMPT_UNSAFE_PATTERNS: list[tuple[regex, replacement]]`
- 9004 의 `mv_generator.py:43-70` 24개 패턴을 그대로 포팅
- 순서 중요(긴 매칭이 먼저 와야 부분 충돌 방지). case-insensitive.
- 빈 치환으로 생긴 연속 공백/양끝 공백 정리(`re.sub(r"\s{2,}", " ", out).strip()`)
- 적용 결과는 `logger.info("[PromptSanitize] ...")` 로 hit count 와 patterns 기록(원문/치환문 전체는 로그 안 함)

### Layer 3 — 실패 핸들링

- pre_mv.py phase3 worker 의 `except Exception as e` 분기:
  - `err_lower = str(e).lower()`
  - `is_content_policy = "content_policy_violation" in err_lower or "sensitive content" in err_lower`
  - True 면 mongo set:
    - `scenes.{i}.video_error_reason = "content_policy"`
    - `scenes.{i}.video_error = "콘텐츠 정책에 의해 거부됨 (모델 출력 모더레이션)"`
  - False 면 기존 동작 유지
- 자동 재시도는 본 작업 범위에서 도입하지 않음(별도 v26 후보). 사용자가 UI 에서 수동으로 부분 재생성하면 새 입력으로 다시 호출됨.

### 회귀 테스트 항목 (Tester)

1. **sanitize 단위 테스트**: 24개 트리거 phrase 가 각각 안전 대체로 치환되는지. 정상 wedding 문장(예: "warm afternoon light on the bride's veil")은 변형 0건이어야.
2. **Kling/Grok/Extra 호출 사이트 grep**: `grep -n "sanitize_video_prompt"` 로 4곳 모두 호출 확인.
3. **Phase 1 splitter 시스템 프롬프트**: v25 가이드 블록 문자열이 포함되는지(`SCENE_SPLIT_SYSTEM_PROMPT_V215` 또는 후속 버전에 append).
4. **Layer 3 분기**: 가짜 ValueError("Seedance 결과 조회 실패 HTTP 422: ... content_policy_violation ...") 발생시켰을 때 `video_error_reason == "content_policy"` 가 mongo 에 저장되는지(단위 테스트로 worker 함수 직접 호출).
5. **회귀**: 기존 정상 씬 생성 흐름이 깨지지 않는지(`sanitize_for_seedance` alias 가 그대로 동작). compose_video_prompt 출력 길이가 같은 입력에 대해 동일한지 ±5% 이내.

### 비범위 (Out of scope)

- fal Seedance `generate_audio` 옵션 같은 endpoint 자체 audio 끄기 — 별도 R&D 필요(공식 schema 확인 필요)
- 자동 재시도/모델 폴백
- 한국어 image_prompt_ko / video_prompt_ko 의 sanitize (한국어는 모더레이터가 거의 안 봄, 영문만 위험)
