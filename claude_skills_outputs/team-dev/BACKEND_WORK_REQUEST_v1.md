# 백엔드 작업요청서 v1.1 — AIDOL 자산 독립화 (2026-08-26, v1.1 개정 2026-08-27)

> **v1.1 개정**: B-1 모델 확정 — "한 아티스트에 실사/가상 2슬롯"이 아니라 **"아티스트 1명 = 슬롯 1개, kind('real'|'virtual')는 아티스트의 종류"**로 변경 (대표 지시). 기존 virtual_* 이중 필드 구조는 마이그레이션으로 분리.

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

### 핵심 모델 (2026-08-27 확정 — 대표 지시)
**아티스트 1명 = 슬롯 1개.** 실사/가상은 아티스트의 **종류(kind)**일 뿐이며, 한 아티스트가 실사+가상 두 시트를 갖지 않는다. 즉 현행 "한 문서에 sheet + virtual_sheet 이중 필드" 구조는 **폐기 대상**이고, 가상 캐릭터는 실사 캐릭터와 동급의 **별도 아티스트 문서**다.

### 요구 사항
1. characters 컬렉션을 **아티스트 단위 복수 문서**로 재구성: `{user_id, character_id(신규), kind: 'real'|'virtual', name?, gender?('male'|'female'|'other' — 아티스트 프로필 표시용, save/PATCH로 설정), sheet_object_name, art_style?(kind='virtual'일 때), used_items, original_photo_object_name?(kind='real'일 때), is_default, created_at, ...}`. `virtual_*` 이중 필드는 신규 모델에서 제거. (선행 가능: 현행 단일 문서에도 gender 필드+save 수용을 먼저 추가해주면 프론트가 즉시 사용)
2. 신규 엔드포인트:
   - `GET /api/character/list` → `{characters: [{character_id, kind, name, sheet_url, art_style?, is_default, created_at, ...}]}`
   - `GET /api/character/{character_id}` / `DELETE /api/character/{character_id}` (**아티스트 단위 삭제** — 현재는 전체 삭제뿐)
   - `PATCH /api/character/{character_id}` (name 등 메타 수정, B-3 persona 연결 포함)
3. 생성 계약:
   - `generate-sheet(-async)` = kind='real' 아티스트, `generate-sheet-cartoon(-async)` = kind='virtual' 아티스트 생성. 두 API 모두 `character_id?` 추가 — 지정 시 해당 아티스트 재생성(같은 kind만 허용), 미지정 시 **신규 아티스트 생성(슬롯 한도 검사 → 초과 시 409)**.
   - `POST /character/save`에 `character_id?` 추가. (기존 `variant` 파라미터는 구버전 앱 하위 호환용으로만 한시 유지 — 신규 계약은 kind/character_id 기준.)
4. 기존 계약 호환: `GET /api/character/me` = 기본(is_default) 아티스트 반환 유지. **마이그레이션**: 기존 문서의 실사 시트 → 아티스트①(kind='real', is_default), `virtual_sheet_object_name` 존재 시 → **별도 아티스트②(kind='virtual', art_style 이전)로 분리**. 스토리지 경로 `characters/{user_id}/{character_id}/sheet.png`로 이전.
5. 슬롯 정책: 기본 1슬롯(kind 무관 — 아티스트 수 기준), `POST /points/spend {action:'extra_slot'}` 성공 시 `max_slots` +1 (계정 필드로 영속 — 현재는 아무 효과 없음).
6. 커버/MV 등 캐릭터 선택: `character_object_name`(또는 `character_id`)로 **아티스트를 선택** — "실사/가상 variant 선택" 개념 아님. `CreateMVRequest.character_variant`는 character_id 기반으로 대체 검토.

### 수용 기준
- 실사 아티스트 1 + 가상 아티스트 1 생성 → list에 kind가 다른 2건, 각각 독립 시트 경로·독립 삭제(한쪽 삭제해도 다른 쪽 무손상).
- 기존 실사+가상 보유 계정이 마이그레이션 후 아티스트 2명으로 조회됨.
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
