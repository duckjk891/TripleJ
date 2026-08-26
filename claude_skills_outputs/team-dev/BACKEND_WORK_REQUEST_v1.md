# 백엔드 작업요청서 v1 — AIDOL 자산 독립화 (2026-08-26)

> 발신: aidol-parity 프론트 팀 (team-dev) / 수신: 백엔드 팀 (backend_9004, WSL·backend 브랜치)
> 근거: 2026-08-26 자산 구조 전수 검증 (앱 코드 + backend_9004 소스 + openapi 실측). 상세는 `REPORT_v3.md` v3.77 항목.
> 원칙: **기존 앱과의 하위 호환 유지** — 모든 변경은 additive(필드 추가·신규 엔드포인트)로. 기존 `/character/me` 계약은 유지하거나 alias로 보존.

## 목표 (제품 비전)

사용자가 **아티스트를 여러 명** 보유하고, **가사·목소리·곡·커버가 각각 독립 자산**으로 저장·재조합되는 구조:
"작사 → 아티스트 선택 → 그 아티스트에 연결된 목소리(voice persona)로 작곡 → 곡 선택 → 커버 생성"

---

## B-1. 다중 캐릭터(아티스트) 모델 【우선순위 1】

### 현재 상태 (실측)
- `mongo.characters`가 `user_id` 키 **단일 문서 upsert** (`app/routes/character.py:1474-1487`, 조회 `:1524` `find_one({"user_id"})`, 삭제 `:1587`).
- 시트 저장 경로 고정: `characters/{user_id}/sheet.png` / `sheet_virtual.png` (`:1405-1407`) — 새 생성 시 기존 덮어씀.
- 프론트의 "추가 아티스트 슬롯(⭐15, `POST /points/spend {action:'extra_slot'}`)"이 **슬롯 없이 과금만 되던 버그** → 프론트 v3.77에서 과금 임시 차단함. 백엔드 슬롯 구현 후 유료화 재개 예정.

### 요구 사항
1. characters 컬렉션을 `{user_id, character_id(신규 ObjectId/uuid), name?, ...기존 필드}` **복수 문서** 구조로 확장.
2. 신규 엔드포인트:
   - `GET /api/character/list` → `{characters: [{character_id, name, sheet_url, virtual_sheet_url, is_default, created_at, ...}]}`
   - `GET /api/character/{character_id}` / `DELETE /api/character/{character_id}` (슬롯 단위 삭제 — 현재는 전체 삭제뿐)
   - `PATCH /api/character/{character_id}` (name 등 메타 수정, B-3 persona 연결 포함)
3. 기존 계약 호환:
   - `GET /api/character/me` = 기본(default) 캐릭터 반환 유지. `POST /character/save`에 `character_id?` 추가 — 미지정 시 기존 동작(기본 캐릭터 upsert).
   - `generate-sheet(-async)`/`generate-sheet-cartoon(-async)`에 `character_id?` 추가 (미지정 = 기본 캐릭터 대상).
4. 스토리지 경로: `characters/{user_id}/{character_id}/sheet.png` 등으로 분리. **기존 단일 경로 데이터 마이그레이션**(기존 문서 → character_id 부여 + is_default=true) 포함.
5. 슬롯 정책: 기본 1슬롯, `POST /points/spend {action:'extra_slot'}` 성공 시 `max_slots` +1 (계정 필드로 영속 — 현재는 아무 효과 없음). 슬롯 초과 생성 시 409 등 명시 에러.
6. real/virtual variant는 **캐릭터 문서당 필드**로 유지 (variant ≠ 별도 캐릭터. 프론트 v3.77 가상화 계획과 정합).

### 수용 기준
- 계정에 캐릭터 2개 생성 → list에 2건, 각각 독립 시트 경로, 한쪽 삭제해도 다른 쪽 무손상.
- 구버전 앱(me/save만 사용)이 그대로 동작.
- extra_slot 결제가 실제 슬롯 증가로 이어지고, 화면 이탈 후에도 유지.

---

## B-2. 가사(작사) 서버 자산화 【우선순위 4】

### 현재 상태 (실측)
- `POST /api/generate/lyrics/`는 ChatGPT 호출+포인트 차감만 하고 **DB 저장 없음** (`app/routes/generate.py:363-408`). 가사 목록/조회 API 부재.
- 가사는 곡 생성 요청의 `lyrics` 문자열 필드로 일회성 소비, 트랙 문서에 문자열로만 내장.

### 요구 사항
1. `lyrics` 컬렉션: `{lyrics_id, user_id, title, content, genre?, mood?, source('ai'|'manual'), created_at}`.
2. 엔드포인트: `POST /api/lyrics`(저장) / `GET /api/lyrics`(내 목록) / `GET·PATCH·DELETE /api/lyrics/{id}`.
3. `POST /api/generate/lyrics/`에 `save: true?` 옵션 — 생성 즉시 자산 저장하고 `lyrics_id` 반환.

### 수용 기준
- 가사 저장 → 앱 재설치/다른 기기에서도 목록 조회 → 곡 생성에 재사용 가능.

---

## B-3. 아티스트 ↔ 목소리(voice persona) 매핑 【우선순위 2】

### 현재 상태 (실측)
- `voice_personas` = `{user_id, name, description, suno persona_id}` (`app/routes/voice_persona.py:157-160`) — 계정 자산, **캐릭터 연결 필드 없음**.
- 곡 생성 `POST /api/generate/`는 `persona_id`+`persona_model` 수용 (`generate.py:71-76, 481-486`) — 연결만 없을 뿐 사용 준비는 완료.

### 요구 사항
1. characters 문서에 `persona_id?`, `persona_model?` 필드 추가 (B-1의 PATCH 또는 save로 설정/해제).
2. `GET /character/me`·`/character/list` 응답에 위 필드 포함.
3. (선택) `DELETE /voice-persona/{id}` 시 해당 persona를 참조하는 캐릭터 필드 정리(orphan 방지).

### 수용 기준
- 캐릭터에 persona 연결 → me/list 응답에 반영 → 프론트가 "이 아티스트의 목소리로 작곡" 시 해당 persona_id 자동 주입 가능.

---

## B-4. 트랙에 자산 참조 기록 【우선순위 3】

### 현재 상태 (실측)
- `POST /api/tracks/upload-from-generation`은 lyrics(문자열)·`user_character_snapshot`·`cover_object_name`을 내장 기록. **persona는 트랙에 미기록**(generation 문서에만), lyrics_id/character_id 참조 없음.

### 요구 사항
1. `upload-from-generation`(및 파일 업로드 경로)에 optional 필드 추가: `persona_id`, `persona_model`, `character_id`, `lyrics_id` — 받은 값 그대로 트랙 문서에 저장.
2. `GET /tracks/my`(및 트랙 상세) 응답에 위 필드 포함.

### 수용 기준
- 곡 상세에서 "어느 아티스트·어느 목소리·어느 가사로 만든 곡인지" 역참조 가능.

---

## B-5. 커버 라이브러리 【우선순위 5 — 후순위】

### 현재 상태 (실측)
- 커버는 `POST /upload/generate-cover` 세션(`cover_session_id`, refine/revert/history 존재) → 트랙에 `cover_object_name` 부착. 미부착 커버는 orphan, 계정 커버 목록 없음.

### 요구 사항 (여유 시)
- `GET /api/covers`(내 커버 자산 목록: object_name, 생성 파라미터, 연결 트랙) + 재사용(다른 트랙 부착) 허용.

---

## 공통 요구

- 모든 신규/수정 엔드포인트에 기존 logger 관행대로 진입/외부호출/에러 로그 + 추적자(user_id, character_id, lyrics_id 등) 포함.
- openapi 스키마 반영 (프론트가 openapi.json으로 계약 확인함).
- 완료 시 프론트 팀에 엔드포인트별 샘플 요청/응답 공유 부탁드립니다 — 프론트 연동(아티스트 목록 UI·가사 보관함·목소리 연결)은 스펙 확정 즉시 착수 가능.

## 우선순위 요약

| 순위 | 항목 | 프론트 대기 상태 |
|---|---|---|
| 1 | B-1 다중 캐릭터 | ⭐15 슬롯 과금 차단해둠 — 슬롯 구현 시 유료화 재개 |
| 2 | B-3 아티스트↔목소리 매핑 | 프론트는 우선 로컬 매핑으로 선행 (Phase 1) |
| 3 | B-4 트랙 참조 기록 | 프론트가 값은 이미 보낼 준비 가능 |
| 4 | B-2 가사 서버 자산 | 프론트는 우선 로컬 보관함으로 선행 |
| 5 | B-5 커버 라이브러리 | 후순위 |
