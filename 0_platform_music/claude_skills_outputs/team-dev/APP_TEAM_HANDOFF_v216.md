# 앱팀 회신 — 9004 미러링 안내 및 B-1~B-5 계약 확정본 (v216, 2026-08-31)

> 대상: 앱팀 / 작성: 웹 백엔드 팀(team-dev planner)
> **:9004 가 최신 코드(v212~v215 반영본)로 미러링되었습니다.** 아래 계약은 9004 기준 정본입니다.
> 인증은 기존과 동일(Bearer JWT). 예시의 id 값은 전부 가상입니다.

## 0. 요약 — 무엇이 달라졌나

| 요청 | 상태 | 핵심 |
|---|---|---|
| B-1 아티스트 다중화 + 프로필 | ✅ 반영 | characters 복수 문서·목록/개별 CRUD·슬롯(⭐15) |
| B-2 작사실 서버 저장 | ⛔ 미구현(§6 — 대체 안내) | 가사 draft = generations API로 이미 가능 |
| B-3 아티스트↔목소리 연결 | ✅ 반영 | persona_id = **clone_id** (Suno id 아님 — §3 필독) |
| B-4 곡 출처 기록 | ✅ 반영 | 업로드 4필드 + source_meta·역매핑 흡수 |
| B-5 커버 보관함 | ✅ 반영 | 실경로 **/api/upload/cover-sessions** (가안 /api/covers 아님) |
| 구버전 앱 | 하위호환 유지 | me/save 기존 계약 그대로 — §7 주의사항 확인 |

앱팀 자체 스모크를 요청드립니다(§8).

---

## 1. B-1 — 아티스트 다중화 (v212)

아티스트 1명 = 문서 1개. `kind: "real" | "virtual"`. 계정당 기본(is_default) 아티스트 정확히 1명.

### 목록·개별 CRUD
```
GET    /api/character/list
→ 200 { "characters": [ {
        "character_id": "3f2a...(32-hex)", "kind": "real", "is_default": true,
        "name": "...", "age": "...", "gender": "...",
        "personality_tags": ["..."], "personality_text": "...",
        "sheet_object_name": "characters/{uid}/{cid}/sheet.png", "sheet_url": "/api/character/preview/...",
        "art_style": "", "used_items": [...], "image_model": "nb_pro",
        "persona_id": "", "persona_model": "", "persona_name": "",       ← v213 (§3)
        "persona_voice_id": null, "persona_status": null,
        "created_at": "...", "updated_at": "..." } ],
      "slots": { "used": 1, "max": 1 } }

GET    /api/character/{character_id}     → 200 단건 (타인/부재/형식 오류 404)
PATCH  /api/character/{character_id}     body: { name?, age?, gender?, personality_tags?,
                                                personality_text?, is_default?, persona_id?, persona_model? }
       — 미전송(None)=유지 / 빈 문자열=클리어(해제). is_default:false 단독 → 400
DELETE /api/character/{character_id}     → 개별 삭제. 기본 아티스트 삭제 시 잔여 중 승계(real 우선·최신)
```

### 생성·재생성 (기존 4종 API에 `character_id` 추가)
- `POST /api/character/generate-sheet(-async)` = real, `generate-sheet-cartoon(-async)` = virtual
- `character_id` **지정** → 해당 아티스트 재생성 (kind 불일치 400, 타인/부재 404)
- **미지정** → 신규 생성 취급 → 슬롯 검사: `used >= max` 시 **409** (⭐ 차감 전, job 미생성)
```
409 { "error": "slot_limit_exceeded", "used": 1, "max": 1, "message": "..." }
```
- `POST /api/character/save` 3-경로: ①`character_id` 지정=해당 문서 갱신 ②`kind` 지정=신규 생성(슬롯 검사 동일 409) ③둘 다 없음=구버전 variant 계약 그대로(하위호환 — 슬롯 면제)
- 프로필 필드(name/age/**gender(신규, ≤20자)**/personality_tags/personality_text)는 save·PATCH 모두 수용

### 슬롯 구매
```
POST /api/points/spend  body { "action": "extra_slot" }
→ 200 { "ok": true, "action": "extra_slot", "spent": 15, "balance": n, "max_slots": 2 }
```
성공 시 max_slots 영구 +1 (v212에서 "차감만 되고 효과 없음" 버그 수정 완료). 잔액 부족 402.

### 하위호환
- `GET /api/character/me` — 기존 shape 100% 유지(기본 아티스트 조립) + **추가 키**: `user_id`·`character_id`·`characters_count` (전부 v212 신규 additive — 기존 키 제거 없음)
- `DELETE /api/character/me` — **전체 아티스트 삭제**(구계약 의미 유지 — §7 주의)

---

## 2. B-3 — 아티스트↔목소리 연결 (v213)

### ⚠ 핵심: persona_id 의 의미
- `characters.persona_id` = **목소리 자산 id(= voice_clones 의 clone_id)** — **Suno persona id 가 아닙니다.**
- **곡 생성(POST /api/generate/)에 주입할 값은 응답의 `persona_voice_id`** 입니다.

### 연결/해제 — PATCH(§1) 또는 save 로
```
PATCH /api/character/{cid}  body { "persona_id": "<clone_id>" }        # 연결 (ready 클론만 — 아니면 400)
PATCH /api/character/{cid}  body { "persona_id": "" }                  # 해제
```
`persona_model`: "voice_persona"(기본) | "style_persona".

### 응답 5키 × 3상태 (me·list·단건 공통 — 키 생략 없음)
| 키 | 미연결 | 연결 | 목소리 소멸(dangling) |
|---|---|---|---|
| persona_id | "" | clone_id | 잔존값 |
| persona_model | "" | voice_persona 등 | 잔존값 |
| persona_name | "" | voice_name | "" |
| persona_voice_id | null | Suno voice_id | null |
| persona_status | null | 클론 status("ready" 등) | "missing" |

### 자동 정리
목소리 삭제(개별 DELETE·만료 자동삭제·일괄 정리 전 경로) 시 이를 참조하는 아티스트의 persona 필드는 서버가 자동 해제합니다. `persona_status:"missing"` 을 받으면 미연결로 표시하고 재연결을 유도하세요.

---

## 3. B-4 — 곡 출처 기록 (v214)

### 업로드 시 optional 4필드 (양 경로: POST /api/tracks/upload-from-generation JSON · POST /api/tracks/upload Form)
```
character_id?  persona_id?  persona_model?  lyrics_id?     (각 문자열, 64자 초과분은 절단)
```
- **받은 값 그대로 저장** — 무효/타인 id 여도 업로드는 절대 실패하지 않습니다(400 없음)
- **역매핑 흡수**: persona_id 에 Suno voice_id 를 보내도 서버가 clone_id 로 정규화 저장합니다(실패 시 원값 유지)
- 미전송 시 from-generation 경로는 generation 문서에서 자동 승계(persona·가사 출처)

### 응답 (my·상세·charts·artists/{id}/tracks 전면 동봉)
```
"character_id": ..., "persona_id": ..., "persona_model": ..., "lyrics_id": ...,
"source_meta": { "artist_name": "...", "persona_name": "...", "lyrics_title": "...", "lyrics_is_mine": true }
```
- source_meta 는 **서버가 업로드 시점에 생성**(본인 소유 문서로 검증된 경우만 — 클라이언트가 보낸 명칭은 무시)
- 신곡 무출처 = 4필드·source_meta **null 키 존재** / 기존 곡(v214 이전) = **키 부재** — 둘 다 "표기 생략" 처리
- 표시 정책: 기록 없는 곡은 출처 표기 생략(소급 없음)

### 작곡 시 가사 출처 스냅샷
```
POST /api/generate/  body 에 optional  "lyrics_source": { "lyrics_id": "<draft id>", "title": "...", "is_mine": true }
```
가사 draft 를 삭제하는 워크플로에서도 출처가 보존됩니다.

---

## 4. B-5 — 커버 보관함 (v215)

### ⚠ 실경로: `/api/upload/cover-sessions` (요청서 가안 `/api/covers` 가 아닙니다)
```
GET /api/upload/cover-sessions?page=1&limit=20        (updated_at 최신순)
→ 200 { "covers": [ {
        "cover_session_id": "...", "cover_object_name": "covers/generated/{uid}/{hex}.png",
        "image_url": "/api/upload/cover-preview/...", "title": "...",            ← 구형 세션은 null
        "image_model": "nb_pro", "current_version": 0, "history_count": 1,
        "gen_params": { ... } | null, "source": "coverstudio" | null,
        "linked_tracks": [ { "id": "...", "title": "..." } ],                    ← 미사용이면 []
        "created_at": "...", "updated_at": "..." } ],
      "pagination": { ... } }

DELETE /api/upload/cover-sessions/{cover_session_id}
→ 200 삭제(미사용만 — 이력 전 버전 오브젝트 포함 완전 삭제)
→ 409 { "error": "...", "linked_tracks": [ { "id", "title" } ] }   # 곡이 사용 중이면 거부
→ 404 타인/부재
```

### 재사용·수명 규약
- 보관함 커버(cover_object_name)는 **여러 곡에 재사용 가능** — 업로드(cover_object_name)·곡 커버 수정(PUT /api/tracks/{id} cover_image_url)·MV 생성(cover_object_name) 검증을 모두 통과합니다(본인 세션 산출물 한정)
- **곡을 삭제해도 보관함 커버 오브젝트는 보존**됩니다(곡=참조자, 보관함=소유자). 파기는 보관함 DELETE 로만
- MV 생성의 cover_object_name 은 v215부터 검증됩니다: 본인 세션 산출물/본인 파일 커버/선택 트랙의 현재 커버만 허용, 그 외 400
- 기존 refine(추가수정)·revert(되돌리기)·cover-history API 는 그대로입니다

---

## 5. 소멸 API 고지 (미러링으로 제거 — 9006에서 기제거분, 백업 tar 실측 + 미러 후 404 확인 완료)

| 제거된 prefix | 제거된 엔드포인트 | 비고 |
|---|---|---|
| `/api/vocal-repair` | POST /upload · POST /{repair_id}/enhance · GET /{repair_id}/status · GET /{repair_id}/{original,enhanced}/{stream,download} · GET /list | 보컬 다듬기(Demucs/LALAL) — v199 제거 |
| `/api/voice-convert` | POST /{generation_id} · GET /{generation_id}/{status,stream,download} · GET /{generation_id}/{converted-vocal,backing}/stream · POST /{generation_id}/{preview-mr,merge} · **GET /api/kits/voice-models** | 내 목소리로 변환(Kits.AI) — v199 제거 |
| `/api/voice-persona` | POST /create · GET /list · GET /{persona_id} · GET /{persona_id}/{vocal,cover}/{stream,download} · DELETE /{persona_id} | 구버전 voice persona 워크플로 — 현행은 voice_clones(§2) |

전부 호출 시 404 (미러 후 실측 확인). 사용 중인 화면이 있으면 회신 바랍니다(사전 협의 판정: 미사용).

## 6. B-2(작사실 서버 저장) 미구현 사유와 대체

별도 컬렉션 신설 대신 **기존 generations 컬렉션의 무과금 draft** 로 동일 기능이 이미 제공됩니다(웹 작사실이 사용 중인 방식):

```
POST   /api/generate/            body { ..., "start_music_gen": false }   # 무과금 draft 생성 (⭐0)
PATCH  /api/generate/{id}        # draft 수정 (제목·가사 등)
GET    /api/generate/            # 목록 — draft 판별: status=="pending" && !point_ref && !result_audio_url
DELETE /api/generate/{id}        # draft 삭제
```
작곡 시 draft 를 삭제하는 UX 라면 §3 의 `lyrics_source` 스냅샷으로 출처를 보존하세요.

## 7. 구버전 앱 주의사항

1. **슬롯 만석 409**: character_id 없이 generate-sheet(-cartoon) 호출 시 슬롯이 가득 차면 409(§1) — 재생성 UI 는 반드시 `character_id` 를 보내세요. me/save 만 쓰는 구버전은 영향 없음
2. `DELETE /api/character/me` 는 **모든 아티스트 삭제**입니다. 개별 삭제는 `DELETE /api/character/{cid}`
3. `GET /api/character/me` 의 `user_id` 키는 **v212 신규 키**입니다(기존 키 복원이 아님 — 회귀표 작성 시 참고)
4. 곡 생성 persona 주입은 반드시 `persona_voice_id`(§2) — characters.persona_id 를 그대로 넣으면 서버가 흡수하지만(§3 역매핑) 권장 경로가 아닙니다
5. 기존 계정의 실사+가상 캐릭터 → 아티스트 2명 분리 마이그레이션은 **아직 미실행**(별도 공지 예정). 그 전까지 구 문서 계정은 me/save 로만 온전히 동작합니다

## 8. 요청 사항
- 앱팀 자체 스모크(:9004): 로그인 → 캐릭터 목록/생성 UI → 곡 업로드 → 커버 → 재생. 이상 발견 시 재현 절차와 함께 회신 바랍니다
- 본 문서 기준 회귀표 갱신(§1~§4 계약이 정본, §5 소멸 목록 확인)

— 웹 백엔드 team-dev (v216). 문의는 기존 채널로.
