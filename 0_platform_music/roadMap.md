# AIDOL 플랫폼 — 광고 아이템 착용 캐릭터 기반 음원 커버·구매 연동 시스템 설명서

> **용도**: 특허 출원 준비용 시스템 설명 문서
> **작성일**: 2026-07-10
> **코드 기준**: `backend_9005` (최신 작업 라인) + `frontend`
> **주의**: API 키·시크릿·환경변수 값은 본 문서에 포함하지 않음 (코드상 `settings.google_api_key` 등 참조만 존재)

---

## 0. 아키텍처 개요

- **백엔드**: Python 3.11 + FastAPI. PostgreSQL(asyncpg 직접, SQLAlchemy 미사용) + MongoDB(motor) + Redis + MinIO(오브젝트 스토리지) + Elasticsearch.
- **PostgreSQL** (`infra/init_postgres.sql`): 관계형 데이터만 — users, follows, likes, playlists, playlist_tracks, admin_logs. 유일한 DDL 파일.
- **MongoDB** (스키마리스): 본 문서의 핵심 엔티티 전부 — `tracks`, `characters`, `ad_items`, `business_profiles`, `mv_jobs`, `cover_sessions`, `character_jobs`, `ad_impressions`, `ad_clicks` 등. CREATE TABLE 문 없이 `insert_one()` 호출부의 dict 리터럴이 사실상의 스키마.
- **핵심 설계 원칙**: 캐릭터-아이템, 곡-캐릭터, 커버-캐릭터 연결은 모두 **FK나 중간 테이블이 아니라 MongoDB 문서 내부의 임베디드 배열/서브도큐먼트(값 복사 스냅샷)** 방식. 발행 시점의 상태를 박제하여 원본 변경/삭제로부터 격리한다.

---

## 1. 데이터 모델 (스키마)

### 1-1. 캐릭터 (캐릭터시트) — `characters` 컬렉션

사용자당 1문서(`user_id` 키 upsert). 시트 이미지 자체는 MinIO에 저장하고 문서에는 오브젝트 키(`sheet_object_name`)만 보관. 실사(real)/가상화(virtual, 만화 화풍) 두 슬롯이 한 문서 안에 분리 저장된다.

**입력 Pydantic 스키마** — `backend_9005/app/routes/character.py:105-128`

```python
class UsedItemPayload(BaseModel):
    id: Optional[str] = None
    name: Optional[str] = None
    image_object_name: Optional[str] = None
    product_url: Optional[str] = None
    category: Optional[str] = None  # "상의" | "하의" | "신발"


class SaveCharacterRequest(BaseModel):
    sheet_object_name: str
    used_items: Optional[List[UsedItemPayload]] = None
    name: Optional[str] = None
    age: Optional[str] = None
    personality_tags: Optional[List[str]] = None
    personality_text: Optional[str] = None
    original_photo_object_name: Optional[str] = None
    image_model: Optional[str] = None
    variant: Optional[str] = None
    art_style: Optional[str] = None
```

**저장 문서 구조 (real 슬롯)** — `backend_9005/app/routes/character.py:1299-1330`

```python
set_fields = {
    "user_id": user_id,
    "sheet_object_name": permanent_object,   # MinIO: characters/{user_id}/sheet.png
    "used_items": used_items_data,           # ← 착용 아이템 임베디드 배열 (1-3 참조)
    "name": name_val,
    "age": age_val,
    "personality_tags": personality_tags_val,
    "personality_text": personality_text_val,
    "updated_at": datetime.utcnow(),
}
# 조건부: original_photo_object_name, image_model

await mongo.characters.update_one(
    {"user_id": user_id},
    {
        "$set": set_fields,
        "$setOnInsert": {"created_at": datetime.utcnow()},
    },
    upsert=True,
)
```

**가상화(virtual) 슬롯** — `character.py:1291-1297`

```python
set_fields = {
    "user_id": user_id,
    "virtual_sheet_object_name": permanent_object,   # characters/{user_id}/sheet_virtual.png
    "virtual_art_style": (body.art_style or "").strip(),
    "virtual_used_items": used_items_data,
    "updated_at": datetime.utcnow(),
}
```

### 1-2. 광고 아이템 (브랜드 상품) — `ad_items` + `business_profiles` 컬렉션

광고주(비즈니스 계정)가 상품명·판매 URL·이미지·카테고리·성별을 등록한다. `product_url`이 최종적으로 곡 상세 페이지의 "쇼핑몰에서 보기" 링크가 되는 **원천 필드**다.

**허용 카테고리 상수** — `backend_9005/app/routes/business.py:24-27`

```python
MAX_AD_IMAGE_SIZE = 10 * 1024 * 1024  # 10MB
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}
ALLOWED_AD_CATEGORIES = {"상의", "하의", "신발", "장소"}
ALLOWED_AD_GENDERS = {"남성용", "여성용", "공용"}
```

**`ad_items` 문서 구조** — `business.py:174-186`. 등록 엔드포인트는 `POST /api/business/ads` (`business.py:142-149`, 입력 폼: `image(UploadFile)`, `name`, `product_url`, `category`, `gender`)

```python
doc = {
    "user_id": user["id"],
    "name": name,                          # 상품명
    "image_object_name": object_name,      # MinIO: ads/{user_id}/{hex}.ext
    "product_url": product_url,            # 판매/쇼핑몰 URL ← 구매 링크 원천
    "category": category,                  # 상의|하의|신발|장소
    "gender": gender,                      # 남성용|여성용|공용
    "is_active": True,
    "created_at": now,
    "updated_at": now,
}
result = await mongo.ad_items.insert_one(doc)
```

**`business_profiles` (브랜드/광고주 프로필)** — `business.py:61-70`, Pydantic `76-80`

```python
new_profile = {
    "user_id": user["id"],
    "company_name": "",
    "industry": "",
    "contact_name": "",
    "contact_phone": "",
    "created_at": now,
    "updated_at": now,
}

class ProfileUpdate(BaseModel):
    company_name: Optional[str] = None
    industry: Optional[str] = None
    contact_name: Optional[str] = None
    contact_phone: Optional[str] = None
```

**노출/클릭 집계** — `ad_impressions`, `ad_clicks` 컬렉션 (`business.py:428-432`, `456-460`): 각각 `{item_id, user_id, timestamp}`, 6시간 내 중복 차단.

관계 방식: 광고주↔상품은 `user_id` 공유로 묵시적 연결(명시적 FK 없음). 광고주 닉네임은 조회 시 Postgres `users`에서 결합(`business.py:392-396`).

### 1-3. 캐릭터-아이템 연결 (착용 관계)

**FK도 중간 테이블도 아닌, `characters.used_items` 임베디드 배열(JSON 값 복사)이다.**

- 각 원소 = `{id, name, image_object_name, product_url, category}` — 광고 아이템의 필드를 **값으로 복사(스냅샷)**하여 캐릭터 문서에 내장.
- `id`는 원본 `ad_items._id`를 가리키는 약한 참조(참조 무결성 미강제) — 광고 클릭 집계에 사용.
- 직렬화 코드: `used_items_data = [item.model_dump() for item in (body.used_items or [])]` (`character.py:1287`).
- 가상화 슬롯은 `virtual_used_items`로 분리(`character.py:1295`).

### 1-4. 곡 (트랙) — `tracks` 컬렉션

**Pydantic 응답 모델** — `backend_9005/app/models/track.py:38-61`

```python
class TrackResponse(BaseModel):
    id: str
    title: str
    uploader_id: str
    uploader_nickname: str
    genre: List[str] = []
    mood: List[str] = []
    tags: List[str] = []
    categories: List[str] = []
    ai_model: Optional[str] = None
    prompt: Optional[str] = None
    duration_sec: int = 0
    audio_url: Optional[str] = None
    cover_image_url: Optional[str] = None
    play_count: int = 0
    like_count: int = 0
    comment_count: int = 0
    is_public: bool = True
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class TrackInDB(TrackResponse):
    waveform_data: List[float] = []
```

**AI 생성 곡 발행 시 실제 MongoDB 문서** — `backend_9005/app/routes/tracks.py:1001-1033` (수동 업로드 문서는 `tracks.py:741-777`, 동일 골격)

```python
doc = {
    "_id": track_id,                    # ObjectId
    "title": title,
    "uploader_id": uploader_id,
    "uploader_nickname": current_user.get("nickname", ""),
    "genre": genre_list, "mood": mood_list, "tags": tags_list,
    "categories": categories_list,
    "bpm": gen_doc.get("bpm"), "key": gen_doc.get("key"), "duration_sec": duration_sec,
    "audio_url": dest_object_name,                   # MinIO: 트랙 오디오 오브젝트 키
    "lyrics": body.lyrics,
    "cover_image_url": body.cover_object_name,       # ← 커버 이미지 (곡의 속성, 1-6)
    "generation_id": str(gen_doc["_id"]),            # generations 컬렉션 참조
    "variant_index": variant_index,
    "user_character_snapshot": user_character_snapshot,   # ← 곡-캐릭터 연결 (1-5)
    "play_count": 0, "like_count": 0, "comment_count": 0,
    "is_public": True,
    "created_at": now, "updated_at": now,
    "beats_status": "pending", "tempo": None, "beats": [], "downbeats": [],
    ...
}
await mongo.tracks.insert_one(doc)
```

관계 방식: `tracks._id`는 ObjectId. Postgres의 likes/playlist_tracks는 `track_id VARCHAR(24)`로 이 문자열을 저장하는 cross-DB 약한 참조(`init_postgres.sql:39,54`).

### 1-5. 곡-캐릭터 연결 — `tracks.user_character_snapshot` 서브도큐먼트

**FK가 아니라 발행 시점의 캐릭터 상태를 통째로 값 복사한 임베디드 스냅샷.**

**스냅샷 구조 정의** — `backend_9005/app/routes/mv.py:505-514` (tracks의 것도 동일 구조, `tracks.py:808-815` 주석 명시)

```python
user_character_snapshot = {
    "name": char.get("name") or "",
    "age": char.get("age") or "",
    "personality_tags": char.get("personality_tags") or [],
    "personality_text": char.get("personality_text") or "",
    "sheet_object_name": _snapfix_copied or snapshot_sheet,
    "used_items": snapshot_items,        # ← 착용 아이템(product_url 포함)이 그대로 승계
}
if _snapfix_copied:
    user_character_snapshot["sheet_object_name_origin"] = snapshot_sheet
```

**SnapFix (불변 사본)**: 발행 시 캐릭터 시트 이미지를 불변 경로 `character_snapshots/`로 **복사**하여, 이후 사용자가 캐릭터를 재생성/삭제해도 이미 발행된 곡의 캐릭터 표시가 고정된다 — `tracks.py:955-968`:

```python
user_character_snapshot = body.user_character_snapshot
if user_character_snapshot and user_character_snapshot.get("sheet_object_name"):
    from ..services.snapshot_service import snapshot_sheet_copy
    _origin_sheet = user_character_snapshot.get("sheet_object_name")
    _copied_sheet = snapshot_sheet_copy(minio_client, uploader_id, _origin_sheet)
    if _copied_sheet:
        user_character_snapshot = dict(user_character_snapshot)
        user_character_snapshot["sheet_object_name"] = _copied_sheet
        user_character_snapshot["sheet_object_name_origin"] = _origin_sheet
```

### 1-6. 커버 이미지

커버는 별도 엔티티가 아니라 **곡의 속성 컬럼 `tracks.cover_image_url`**(MinIO 오브젝트 키)이다. 부가적으로:

- **`cover_sessions` 컬렉션** (`upload.py:364-381`): 커버 생성/리파인 이력만 버전 배열로 보관. **캐릭터 참조 컬럼 없음.**

```python
session_doc = {
    "user_id": current_user["id"],
    "image_model": norm_image_model,
    "cover_object_name": object_name,     # MinIO: covers/generated/{user_id}/{hex}.png
    "current_version": 0,
    "cover_refine_history": [
        {"version": 0, "object_name": object_name,
         "refine_prompt": None, "image_model": norm_image_model, "created_at": now_utc}
    ],
    "created_at": now_utc, "updated_at": now_utc,
}
result = await mongo.cover_sessions.insert_one(session_doc)
```

- **커버↔캐릭터 결합**은 `user_character_snapshot`(mv_jobs 또는 tracks에 임베디드)이 담당하며, 곡 상세 조회 시 `cover_character` 응답 객체로 동적 합성된다(4장 참조). 커버 생성 입력으로는 `character_object_name`(시트의 MinIO 키)이 일회성으로 사용된다(3장).

---

## 2. 캐릭터시트 생성 플로우

**요약**: 얼굴 사진 + 선택 아이템(상의/하의/신발)의 `image_object_name`을 multipart FormData로 수신 → MinIO에서 아이템 이미지 로드 → **(a) 프롬프트 텍스트 지시 + (b) 역할 라벨 이미지 레퍼런스, 이중 전달** → 2단계(텍스트 분석 → 이미지 생성) 파이프라인 → 저장 시 `characters.used_items`에 착용관계 기록.

### 2-1. 입력 API — `POST /api/character/generate-sheet` (`character.py:345-365`)

아이템은 두 방식으로 공급 가능하며 **광고상품 `*_object_name`이 직접 업로드보다 우선**한다.

```python
@router.post("/generate-sheet")
async def generate_sheet(
    file: UploadFile = File(...),                       # 얼굴 사진
    top_image: Optional[UploadFile] = File(None),
    bottom_image: Optional[UploadFile] = File(None),
    shoes_image: Optional[UploadFile] = File(None),
    top_object_name: Optional[str] = Form(None),        # 광고상품 이미지의 MinIO 키
    bottom_object_name: Optional[str] = Form(None),
    shoes_object_name: Optional[str] = Form(None),
    user_text: str = Form(""),
    image_model: str = Form("nb_pro"),
    current_user=Depends(get_current_user),
):
    """Upload a reference photo and generate a photorealistic character sheet.

    Outfit items can be supplied two ways (object_name takes priority over upload):
      - `*_object_name`: MinIO object_name of a selected ad-product item image
        (the `image_object_name` from the product), loaded from the images bucket.
      - `*_image`: a direct UploadFile.
    Each resolved item overrides the corresponding outfit section in the prompt.
    """
```

변형 엔드포인트: `/generate-sheet-cartoon`(가상화, `style_preset`/`style_image` 추가, line 497), `/generate-sheet-async`(job_id 즉시 반환 — 프론트 실사용, line 795), `/generate-sheet-cartoon-async`(line 899).

생성 시작 전 포인트 2점을 선차감하고(`spend_points`, `character.py:410-413`, 부족 시 402 차단), 생성 실패 시 환불한다(`refund_points`, `character.py:434-436`).

**아이템 이미지 해석: object_name 우선 → MinIO 로드** — `character.py:244-297`

```python
def _load_item_image(object_name: Optional[str]) -> tuple:
    """Load an ad-product item image from MinIO by object_name. ..."""
    name = (object_name or "").strip()
    if not name:
        return None, None
    minio_client = get_minio()
    resp = minio_client.get_object(
        bucket_name=settings.minio_bucket_images,
        object_name=name,
    )
    data = resp.read()
    ...

async def _resolve_item_image(object_name, upload) -> tuple:
    """ad-product object_name takes priority, then a direct UploadFile."""
    name = (object_name or "").strip()
    if name:
        data, mime = _load_item_image(name)
        if data:
            return data, mime, "object_name"
    data, mime = await _read_optional_image(upload)
    if data:
        return data, mime, "upload"
    return None, None, None
```

**해석 후 생성 서비스 호출** — `character.py:402-433`

```python
top_bytes, top_mime, top_src = await _resolve_item_image(top_object_name, top_image)
bottom_bytes, bottom_mime, bottom_src = await _resolve_item_image(bottom_object_name, bottom_image)
shoes_bytes, shoes_mime, shoes_src = await _resolve_item_image(shoes_object_name, shoes_image)
...
sheet_bytes = await generate_character_sheet(
    photo_bytes=contents, mime_type=mime_type,
    top_bytes=top_bytes, top_mime=top_mime,
    bottom_bytes=bottom_bytes, bottom_mime=bottom_mime,
    shoes_bytes=shoes_bytes, shoes_mime=shoes_mime,
    user_text=user_text.strip(), image_model=norm_image_model,
)
```

### 2-2. 이미지 생성 모델로의 아이템 전달 — 프롬프트 + 이미지 레퍼런스 이중 전달

파일: `backend_9005/app/services/character_generator.py`

**2단계 파이프라인**: Step A — Gemini 텍스트 모델이 사진+마스터 프롬프트로 캐릭터시트 스펙 텍스트 생성 → Step B — 이미지 모델(Nano Banana Pro=`gemini-3-pro-image-preview` 또는 GPT Image 2)이 그 스펙+참조 이미지들로 시트 이미지 생성.

**(a) 텍스트 지시 — STEP 1 답변 동적 조립** (`_build_step1_answer`, line 766-817): 선택된 아이템 조합에 따라 "해당 역할 라벨 이미지를 분석해 반영하라"는 문장을 동적 생성.

```python
def _build_step1_answer(has_top, has_bottom, has_shoes, user_text=""):
    parts = [
        "첨부된 [인물 사진] 참조 이미지의 외모 특징"
        "(성별/나이/인종/체형/얼굴/머리/눈/피부톤)을 정밀 분석해 반영하라."
        ...
    ]
    if has_top:
        parts.append("[Outfit > Top] 항목은 [상의 참조] 이미지를 분석해 반영하라.")
    else:
        parts.append("상의는 [인물 사진]에서 보이면 반영, 안 보이면 자유 생성하라.")
    if has_bottom:
        parts.append("[Outfit > Skirt/Bottom] 항목은 [하의 참조] 이미지를 분석해 반영하라.")
    else:
        parts.append("하의는 [인물 사진]에서 보이면 반영, 안 보이면 자유 생성하라.")
    if has_shoes:
        parts.append("[Footwear] 항목은 [신발 참조] 이미지를 분석해 반영하라.")
    else:
        parts.append("신발은 [인물 사진]에서 보이면 반영, 안 보이면 자유 생성하라.")
    ...
    return " ".join(parts)
```

**(b) 이미지 레퍼런스 — 역할 라벨을 붙여 아이템 이미지 첨부** (`_build_inline_images`, line 820-856): 각 이미지 앞에 라벨 텍스트 파트를 삽입해 모델이 순서와 무관하게 역할을 식별하게 한다.

```python
def _build_inline_images(photo_b64, photo_mime, top_bytes, top_mime,
                         bottom_bytes, bottom_mime, shoes_bytes, shoes_mime):
    parts = [
        {"text": "[인물 사진]:"},
        {"inlineData": {"mimeType": photo_mime, "data": photo_b64}},
    ]
    if top_bytes:
        parts.append({"text": "[상의 참조]:"})
        parts.append({"inlineData": {"mimeType": top_mime or "image/jpeg",
                                     "data": base64.b64encode(top_bytes).decode("utf-8")}})
    if bottom_bytes:
        parts.append({"text": "[하의 참조]:"})
        parts.append({"inlineData": {"mimeType": bottom_mime or "image/jpeg",
                                     "data": base64.b64encode(bottom_bytes).decode("utf-8")}})
    if shoes_bytes:
        parts.append({"text": "[신발 참조]:"})
        parts.append({"inlineData": {"mimeType": shoes_mime or "image/jpeg",
                                     "data": base64.b64encode(shoes_bytes).decode("utf-8")}})
    return parts
```

**2단계 오케스트레이션** (`generate_character_sheet`, line 993-1075)

```python
step1_answer = _build_step1_answer(
    has_top=bool(top_bytes), has_bottom=bool(bottom_bytes),
    has_shoes=bool(shoes_bytes), user_text=user_text,
)
image_parts = _build_inline_images(photo_b64, mime_type, top_bytes, top_mime,
    bottom_bytes, bottom_mime, shoes_bytes, shoes_mime)

# Step A: 텍스트 모델로 시트 프롬프트 생성
step_a_prompt = (
    "아래 마스터 프롬프트의 절차를 따라 캐릭터 시트 프롬프트를 생성하라.\n"
    "STEP 1, STEP 2에는 이미 사용자 답변이 포함되어 있으므로 "
    "질문 단계를 건너뛰고 바로 STEP 4부터 진행하여 "
    "최종 캐릭터 시트 프롬프트를 코드블록으로 출력하라.\n\n"
    + MASTER_PROMPT.format(step1_answer=step1_answer)
)
sheet_prompt_text = await _call_gemini_text(step_a_prompt, image_parts)
sheet_prompt_text = _extract_code_block(sheet_prompt_text)

# Step B: 이미지 모델로 시트 이미지 생성
step_b_prompt = (
    "아래의 캐릭터 시트 프롬프트를 기반으로 캐릭터 시트 이미지를 생성하라.\n"
    "[인물 사진] 라벨이 붙은 이미지는 이 캐릭터의 참조 사진이다. "
    "생성되는 캐릭터는 반드시 이 참조 사진 속 인물과 동일한 외모를 가져야 한다.\n\n"
    "=== 캐릭터 시트 프롬프트 ===\n\n"
    "{}"
).format(sheet_prompt_text)
image_bytes = await _call_image_backend(step_b_prompt, image_parts, image_model=image_model)
```

**마스터 프롬프트**: 실사용 `MASTER_PROMPT`(line 39-379, `{step1_answer}` placeholder + `[Outfit]`/`[Footwear]` 템플릿 섹션 포함), 가상화용 `MASTER_PROMPT_CARTOON`(line 393-754, `{art_style}` 추가). 가상화 버전의 아이템 착용·화풍 변환 핵심 규칙(line 415-433):

```
[화풍 변환 규칙]
- 이 캐릭터 시트는 **실사(Photorealistic)가 아니라 위 STEP 2 에서 지정한 그림/만화 화풍**으로
  렌더링되어야 한다.
- 첨부 이미지 중 **[화풍 참조] 라벨이 붙은 이미지가 "화풍(Art Style) reference 이미지"**다.
  ...스타일만 차용... 정체성은 오직 [인물 사진]에서만 가져온다.
- 선택된 아이템([상의 참조]/[하의 참조]/[신발 참조] 라벨 이미지)은 **현실 의류 사진**이지만,
  그대로 사실적으로 그리지 말고 **지정 화풍으로 변환**하여 캐릭터가 착용한 상태로 그리시오.
- 선택된 아이템은 반드시 캐릭터가 착용한 상태로 모든 섹션에 일관되게 표현되어야 한다.
```

**이미지 백엔드 디스패치** (`_call_image_backend`, line 919-946): `nb_pro`(Gemini) / `gpt_image_2`(OpenAI) 분기. GPT Image 2는 라벨된 inlineData를 raw 바이트로 되돌려 `/v1/images/edits` 멀티레퍼런스(`image[]` multipart)로 전달(`services/openai_image.py:93-200`).

```python
async def _call_image_backend(prompt, image_parts, image_model="nb_pro") -> bytes:
    if image_model == "gpt_image_2":
        from .openai_image import generate_image
        ref_bytes: list = []
        for part in image_parts or []:
            inline = part.get("inlineData") if isinstance(part, dict) else None
            data_b64 = (inline or {}).get("data")
            if data_b64:
                ref_bytes.append(base64.b64decode(data_b64))
        return await generate_image(prompt=prompt, ref_images=ref_bytes)
    return await _call_gemini_image(prompt, image_parts)  # default nb_pro
```

### 2-3. 생성 완료 후 캐릭터-아이템 관계 DB 저장 — `POST /api/character/save` (`character.py:1185-1359`)

저장 직전 임시 시트를 영구 경로 `characters/{user_id}/sheet.png`로 복사(`copy_object`, line 1250-1284)한 뒤, `used_items` 배열을 upsert한다.

```python
# Upsert in MongoDB
used_items_data = [item.model_dump() for item in (body.used_items or [])]
...
set_fields = {
    "user_id": user_id,
    "sheet_object_name": permanent_object,
    "used_items": used_items_data,          # ← 착용관계 저장
    ...
}
await mongo.characters.update_one(
    {"user_id": user_id},
    {"$set": set_fields, "$setOnInsert": {"created_at": datetime.utcnow()}},
    upsert=True,
)
```

### 2-4. 프론트엔드 — 아이템 선택과 요청 payload

**아이템 선택** — `frontend/src/pages/ItemSelectPage.jsx:41-56`: 카테고리별 광고상품 목록에서 선택 시 노출 집계 후 슬롯을 라우터 state로 전달.

```jsx
const handleSelect = (item) => {
  api.recordAdImpression(item.id).catch(() => {});
  navigate('/my-music', {
    state: {
      selectedItem: {
        id: item.id,
        name: item.name,
        image_object_name: item.image_object_name,
        product_url: item.product_url,
        advertiser_nickname: item.advertiser_nickname,
      },
      category,
      tab: 'character',
    },
  });
};
```

**FormData 부착 + used_items 조립** — `frontend/src/pages/MyMusicPage.jsx:324-336`

```jsx
// 선택분만 생성 formData 에 부착(백엔드 generate-sheet / -cartoon 의 *_object_name 필드)
const appendItemObjectNames = (formData) => {
  if (selectedTop) formData.append('top_object_name', selectedTop.image_object_name);
  if (selectedBottom) formData.append('bottom_object_name', selectedBottom.image_object_name);
  if (selectedShoes) formData.append('shoes_object_name', selectedShoes.image_object_name);
};

// save 페이로드의 used_items 배열
const buildUsedItems = () =>
  [selectedTop, selectedBottom, selectedShoes].filter(Boolean).map((it) => ({
    id: it.id, name: it.name,
    image_object_name: it.image_object_name,
    product_url: it.product_url, category: it.category,
  }));
```

**생성 요청(비동기 job 폴링) 및 저장 요청** — `MyMusicPage.jsx:348-407`

```jsx
const handleGenerate = async () => {
  const formData = new FormData();
  formData.append('file', photoFile);          // 얼굴 사진
  formData.append('image_model', imageModel);
  appendItemObjectNames(formData);
  const { data } = await api.generateCharacterSheetAsync(formData);  // job_id 즉시 반환
  pollCharacterJob(data.job_id, { ... });      // 5초 폴링 → 완료 시 미리보기
};

const handleSave = async () => {
  await api.saveCharacter({
    sheet_object_name: previewObjectName,
    used_items: buildUsedItems(),              // ← 착용관계가 여기서 백엔드로 전달
  });
};
```

---

## 3. 커버 이미지 생성 플로우

**요약**: "내 캐릭터 포함하기" 선택 시 **캐릭터 시트 이미지(MinIO 키) 한 장만** 생성 모델에 레퍼런스로 전달된다. 아이템 ID/구매링크는 이미지 파이프라인에 **전달되지 않는다** — 아이템은 이미 시트에 시각적으로 "착용"되어 있고, 프롬프트의 의상 보존 지시로 커버에 승계된다. 아이템 메타데이터(구매링크)는 이미지 경로와 완전히 분리된 **스냅샷 경로**로 트랙 문서에 박제된다.

### 3-1. 캐릭터시트가 생성 모델에 전달되는 방식

**요청 → MinIO 로드** — `backend_9005/app/routes/upload.py:276-297`

```python
character_image_bytes = None
if body.character_object_name:
    minio_client = get_minio()
    response = minio_client.get_object(
        bucket_name=settings.minio_bucket_images,
        object_name=body.character_object_name,
    )
    character_image_bytes = response.read()
    ...
    logger.info(
        "[CoverGenEntry] character bytes loaded len=%d from %s",
        len(character_image_bytes), body.character_object_name,
    )
```

**생성기 호출** — `upload.py:330-342`

```python
image_bytes = await generate_cover_image(
    title=title,
    genre=body.genre, mood=body.mood, style=body.style,
    character_image_bytes=character_image_bytes,   # ← 시트 이미지 바이트
    user_prompt=body.user_prompt,
    prompt_model=body.prompt_model,
    user_location_image_bytes=user_location_image_bytes,
    user_location_name=user_location_name,
    image_model=norm_image_model,
    vocal_gender=norm_vocal_gender,
)
```

**모델 payload 첨부** — `backend_9005/app/services/cover_generator.py:232-300`: 시트가 base64 `inlineData`로 프롬프트와 함께 전달.

```python
request_parts = [{"text": prompt}]
if character_image_bytes:
    char_b64 = base64.b64encode(character_image_bytes).decode("utf-8")
    request_parts.append({
        "inlineData": {"mimeType": "image/png", "data": char_b64}
    })
...
payload = {
    "systemInstruction": {"parts": [{"text": system_text}]},
    "contents": [{"parts": request_parts}],
    "generationConfig": {"responseModalities": ["TEXT", "IMAGE"]},
}
```

**의상 보존 지시 (아이템 승계의 핵심 프롬프트)** — `cover_generator.py:160-167`

```python
prompt_parts.append(
    "IMPORTANT: The provided character reference sheet shows the main character. "
    "Feature this person prominently in the album cover as the main subject. "
    "Maintain the person's exact appearance (face, hair, features) from the reference. "
    "Also PRESERVE THE WARDROBE / OUTFIT (top, bottom, shoes, accessories) shown in "
    "the reference sheet — do not change clothing items even if the cover theme suggests otherwise. "
    "The character must be photorealistic, not illustrated or stylized."
)
```

(GPT Image 2 분기도 동일하게 `character_image_bytes`를 `ref_images`로 전달 — `cover_generator.py:220-230`.)

### 3-2. 아이템 정보 동반 전달 여부

**커버 생성 단계에서 아이템 정보(ID/이름/product_url)는 이미지 모델에 전달되지 않는다.** 전달되는 것은 캐릭터 시트 이미지 한 장뿐이다. 아이템 이미지가 별도 레퍼런스로 모델에 들어가는 곳은 캐릭터시트 생성 단계(2-2)이며, 커버 단계에서는 **완성된 시트 이미지 안에 시각적으로 합성된 형태**로만 전파된다. 아이템의 메타데이터(`product_url` 등)는 이미지 파이프라인과 분리된 스냅샷 경로(3-3)로만 이동한다.

### 3-3. 생성된 커버가 캐릭터를 참조하는 방식

관계형 FK가 아니라 **문서 임베딩 스냅샷** 2경로:

**(a) MV 작업 생성 시** — `backend_9005/app/routes/mv.py:479-520` → `mv_jobs` 문서에 저장(`mv.py:561-564`)

```python
user_character_snapshot = None
if bool(body.include_my_character):
    char = await mongo.characters.find_one({"user_id": current_user["id"]})
    if not char:
        return JSONResponse(
            status_code=400,
            content={"error": "저장된 내 캐릭터가 없습니다. 먼저 프로필을 설정해주세요."},
        )
    # 실사/가상 variant 별로 시트·착용 아이템 슬롯을 선택해 승계
    if character_variant == "virtual":
        snapshot_sheet = char.get("virtual_sheet_object_name")
        snapshot_items = char.get("virtual_used_items") or []
    else:
        snapshot_sheet = char.get("sheet_object_name")
        snapshot_items = char.get("used_items") or []
    # SnapFix — 시트를 불변 경로(character_snapshots/)로 복사해 이후
    # 캐릭터 재생성/삭제로부터 격리 (best-effort, MV 생성은 절대 실패 X).
    _snapfix_copied = None
    if snapshot_sheet:
        from ..services.snapshot_service import snapshot_sheet_copy
        _snapfix_copied = snapshot_sheet_copy(get_minio(), current_user["id"], snapshot_sheet)
    user_character_snapshot = {
        "name": char.get("name") or "",
        "age": char.get("age") or "",
        "personality_tags": char.get("personality_tags") or [],
        "personality_text": char.get("personality_text") or "",
        "sheet_object_name": _snapfix_copied or snapshot_sheet,
        "used_items": snapshot_items,
    }
    if _snapfix_copied:
        user_character_snapshot["sheet_object_name_origin"] = snapshot_sheet
```

```python
# mv_jobs 문서에:
"include_my_character": bool(body.include_my_character),
"character_variant": character_variant,
"user_character_snapshot": user_character_snapshot,
```

**(b) MV 없이 커버만 만든 곡의 발행 시** — `tracks.py:955-968`(SnapFix 사본) + `tracks.py:1027`

```python
doc = {
    "_id": track_id,
    ...
    "cover_image_url": body.cover_object_name,
    "user_character_snapshot": user_character_snapshot,   # ← 커버→캐릭터 링크 저장 컬럼
    ...
}
```

즉 커버→캐릭터 참조 저장처는 `tracks.user_character_snapshot`(및 `mv_jobs.user_character_snapshot`)이며, 그 안의 `sheet_object_name`(불변 사본) + `used_items`(product_url 포함)가 캐릭터와 착용 아이템을 함께 박제한다. `cover_sessions`에는 캐릭터 참조가 없다(리파인 이력 전용).

### 3-4. 프론트엔드 — "내 캐릭터 포함하기" 송신

**토글 UI** — `frontend/src/pages/UploadPage.jsx:1863-1880`

```jsx
<label className="upload-character-toggle" ...>
  <input
    type="checkbox"
    checked={includeCharacter && (hasReal || hasVirtual)}
    disabled={!(hasReal || hasVirtual)}
    onChange={(e) => setIncludeCharacter(e.target.checked)}
  />
  내 캐릭터 포함하기
</label>
```

**variant별 시트/아이템 선택 헬퍼** — `UploadPage.jsx:124-135`

```jsx
const selectedCharSheet = () => {
  if (!myCharacter) return null;
  return characterVariant === 'virtual'
    ? (myCharacter.virtual_sheet_object_name || null)
    : (myCharacter.sheet_object_name || null);
};
const selectedCharItems = () => {
  if (!myCharacter) return [];
  return characterVariant === 'virtual'
    ? (myCharacter.virtual_used_items || [])
    : (myCharacter.used_items || []);
};
```

**커버 생성 요청 (시트 키만 전송, 아이템 미전송)** — `UploadPage.jsx:450-461`

```jsx
const { data } = await api.generateCover({
  title: title.trim(),
  genre: genre || null, mood: mood || null, style: null,
  character_object_name: includeCharacter ? selectedCharSheet() : null,
  user_prompt: coverUserPrompt.trim() || null,
  prompt_model: coverPromptModel || null,
  location_id: selectedLocationId || null,
  image_model: coverImageModel,
  vocal_gender: vocalGender,
});
```

**곡 발행 시 캐릭터 스냅샷(아이템 포함) 전송 — 여기서 비로소 아이템 메타데이터가 이동** — `UploadPage.jsx:1506-1513`

```jsx
user_character_snapshot: includeCharacter && myCharacter ? {
  name: myCharacter.name || '',
  age: myCharacter.age || '',
  personality_tags: myCharacter.personality_tags || [],
  personality_text: myCharacter.personality_text || '',
  sheet_object_name: selectedCharSheet(),
  used_items: selectedCharItems(),           // ← product_url 포함 착용 아이템 승계
} : null,
```

---

## 4. 곡 상세 페이지 데이터 조회

**요약**: 관계형 JOIN이 아니라 **트랙 문서 조회 → 연결된 완료 MV 잡 조회(1순위) → 임베디드 스냅샷을 `cover_character` 응답 객체로 합성**하는 방식. "곡→캐릭터→아이템" 체인은 `tracks` → `user_character_snapshot` → `used_items[]` 임베딩을 펼치는 구조다.

### 4-1. 주인공 캐릭터 + 착용 아이템 섹션 데이터 조립 — `backend_9005/app/routes/tracks.py:589-660`

```python
doc = await mongo.tracks.find_one({"_id": ObjectId(track_id)})
if not doc:
    return JSONResponse(status_code=404, content={"error": "트랙을 찾을 수 없습니다."})

track = _serialize_track(doc)

# Look up linked completed mv_job once; reuse for both music_video and cover_character.
mv_job = await _find_completed_mv(mongo, track.get("generation_id"))
...
# v71: mv_job 의 snapshot 이 1순위, 없으면 트랙 도큐먼트 자체의 snapshot 으로 fallback
snap_source = None
if (
    mv_job
    and mv_job.get("include_my_character") is True
    and mv_job.get("user_character_snapshot")
):
    snap_source = mv_job.get("user_character_snapshot")
elif track.get("user_character_snapshot"):
    snap_source = track.get("user_character_snapshot")

if snap_source:
    snap = snap_source or {}
    cover_character = {
        "name": snap.get("name") or "",
        "age": snap.get("age") or "",
        "personality_tags": snap.get("personality_tags") or [],
        "personality_text": snap.get("personality_text") or "",
        "sheet_preview_path": (
            "/api/character/preview/" + snap["sheet_object_name"]
            if snap.get("sheet_object_name") else None
        ),
        "used_items": [
            {
                "id": it.get("id"),
                "name": it.get("name") or "",
                "image_object_name": it.get("image_object_name") or "",
                "product_url": it.get("product_url"),     # ← "쇼핑몰에서 보기" 링크
                "category": it.get("category"),
            }
            for it in (snap.get("used_items") or [])
        ],
    }

track["cover_character"] = cover_character
```

응답은 Redis `cache:track:v2:{id}`에 10분 캐시된다.

### 4-2. "쇼핑몰에서 보기" 링크의 필드 계보

필드명은 전 경로에서 일관되게 **`product_url`** (shop_url/purchase_url 별칭 없음):

1. **원천**: 광고주 등록 → `ad_items.product_url` (`business.py:174-184`)
2. **착용 시 복사**: `characters.used_items[].product_url` (`character.py` `UsedItemPayload.product_url`, line 105-110)
3. **발행 시 박제**: `tracks.user_character_snapshot.used_items[].product_url` (`tracks.py:1027`)
4. **조회 시 직렬화**: `cover_character.used_items[].product_url` (`tracks.py:645-654`)

### 4-3. 프론트엔드 렌더링

**소비 지점** — `frontend/src/pages/PlayerPage.jsx:371-375`

```jsx
{activeTab === 'prompt' && trackDetail && (
  <section className="player-page__character-section">
    <CharacterCoverCard character={trackDetail?.cover_character ?? null} />
  </section>
)}
```

**렌더링 컴포넌트** — `frontend/src/components/CharacterCoverCard.jsx`
섹션 제목: `<h3>이 곡의 주인공 캐릭터</h3>`(L103), 아이템 영역 라벨: `착용 아이템`(L149).

카테고리별 슬롯 매핑 (L53-64):

```jsx
const byCategory = {};
if (Array.isArray(character?.used_items)) {
  for (const it of character.used_items) {
    if (it?.category) byCategory[it.category] = it;
  }
}
const outfitSlots = [
  { label: '상의', data: byCategory['상의'] || null },
  { label: '하의', data: byCategory['하의'] || null },
  { label: '신발', data: byCategory['신발'] || null },
];
```

"쇼핑몰에서 보기" 링크 + 광고 클릭 집계 (L66-79, L200-210):

```jsx
const handleItemClick = (item) => (e) => {
  if (!item?.product_url) return;      // product_url 없으면 동작 없음
  e.preventDefault();
  if (item.id) {
    api.recordAdClick(item.id).catch(() => {});   // POST /business/ads/{id}/click
  }
  window.open(item.product_url, '_blank', 'noopener,noreferrer');
};
```

```jsx
{hasUrl && (
  <a
    href={data.product_url}
    target="_blank"
    rel="noopener noreferrer"
    className="character-cover-card__outfit-link"
    onClick={handleItemClick(data)}
  >
    쇼핑몰에서 보기 ▶
  </a>
)}
```

아이템 이미지 URL: `api.adImageUrl(image_object_name)` → `GET /api/business/items/image/{object_name}` (`api/index.js:550-551`).

---

## 5. 전체 데이터 흐름 요약

아이템 ID와 판매 URL(`product_url`)은 **이미지 경로(시각적 착용·승계)**와 **메타데이터 경로(값 복사 스냅샷)** 두 갈래로 나뉘어 각 단계에 전달·보존된다.

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ ① 아이템 등록 (브랜드/광고주)                                                     │
│    POST /api/business/ads                                                       │
│    ad_items: { _id, name, image_object_name, product_url, category, gender }    │
│              └ 이미지 실물: MinIO ads/{user_id}/{hex}.ext                        │
└──────────────┬─────────────────────────────────────────────────────────────────┘
               │  사용자가 ItemSelectPage 에서 선택 (노출 집계: ad_impressions)
               │  → 슬롯 {id, name, image_object_name, product_url, category}
               ▼
┌────────────────────────────────────────────────────────────────────────────────┐
│ ② 캐릭터 생성 (착용)                                                             │
│    POST /api/character/generate-sheet(-async)                                   │
│      [이미지 경로] top/bottom/shoes_object_name → MinIO 로드                     │
│         → 프롬프트 지시("[상의 참조] 이미지를 분석해 반영하라")                     │
│           + 역할 라벨 이미지 레퍼런스([상의 참조]: <inlineData>)                   │
│         → 2단계 생성(Gemini 텍스트 → NB Pro/GPT Image 2)                         │
│         → 아이템이 시각적으로 "착용된" 시트 이미지 산출                             │
│    POST /api/character/save                                                     │
│      [메타 경로] characters.used_items[] ← {id, name, image_object_name,        │
│                                            product_url, category} 값 복사       │
│      시트: MinIO characters/{user_id}/sheet.png                                 │
└──────────────┬─────────────────────────────────────────────────────────────────┘
               │  "내 캐릭터 포함하기" 체크
               ▼
┌────────────────────────────────────────────────────────────────────────────────┐
│ ③ 커버 생성 (승계)                                                               │
│    POST /api/upload/generate-cover                                              │
│      [이미지 경로] character_object_name(시트 키)만 전송                          │
│         → 시트 이미지 inlineData 첨부 + "PRESERVE THE WARDROBE" 프롬프트         │
│         → 착용 상태가 시각적으로 커버에 승계 (아이템 ID/URL 은 모델에 미전달)       │
│      커버: MinIO covers/generated/{user_id}/{hex}.png (+ cover_sessions 이력)    │
│    곡 발행: POST /api/tracks (variant)                                          │
│      [메타 경로] tracks.user_character_snapshot ← { name, age, ...,             │
│         sheet_object_name(SnapFix 불변사본 character_snapshots/),               │
│         used_items[](product_url 포함) } 발행 시점 값 박제                        │
│      tracks.cover_image_url ← 커버 오브젝트 키                                   │
│      (MV 경로는 mv_jobs.user_character_snapshot 에 동일 구조 저장)                │
└──────────────┬─────────────────────────────────────────────────────────────────┘
               │  곡 상세 조회
               ▼
┌────────────────────────────────────────────────────────────────────────────────┐
│ ④ 곡 페이지 노출 (구매 링크)                                                      │
│    GET /api/tracks/{id}                                                         │
│      tracks → user_character_snapshot(mv_jobs 1순위, tracks fallback)           │
│             → cover_character { sheet_preview_path, used_items[] } 동적 합성     │
│    PlayerPage → CharacterCoverCard                                              │
│      "이 곡의 주인공 캐릭터" + "착용 아이템"(상의/하의/신발 슬롯)                   │
│      "쇼핑몰에서 보기 ▶" = used_items[].product_url (①에서 등록한 원천 값)        │
│      클릭 시 recordAdClick(item.id) → ad_clicks 집계 → 새 창으로 판매 URL 이동    │
└────────────────────────────────────────────────────────────────────────────────┘
```

**단계별 아이템 ID / product_url 보존 방식 정리:**

| 단계 | 저장 위치 | 전달 방식 | product_url 보존 |
|---|---|---|---|
| ① 등록 | `ad_items` 문서 | — | 원천 필드 |
| ② 착용 | `characters.used_items[]` | 프론트가 선택 슬롯을 save payload로 전송, 값 복사 | 복사됨 |
| ③ 승계 | `tracks.user_character_snapshot.used_items[]` (또는 `mv_jobs`) | 발행 payload에 스냅샷 포함, 값 박제 + 시트 불변 사본(SnapFix) | 복사됨 (이미지 모델에는 미전달) |
| ④ 노출 | `cover_character.used_items[]` (응답 객체, 비저장) | 조회 시 스냅샷을 펼쳐 동적 합성 | 그대로 직렬화 → 링크 |

**특허 관점 특징 요약:**

1. **이중 전달 착용 메커니즘**: 아이템을 (a) 역할 라벨(`[상의 참조]:`)이 붙은 이미지 레퍼런스와 (b) 동적 조립되는 프롬프트 텍스트 지시로 동시에 생성 모델에 주입하여, 실제 판매 상품이 캐릭터시트에 시각적으로 착용된 상태로 합성됨.
2. **시각적 승계와 메타데이터 승계의 분리**: 커버/MV 생성 시 이미지 모델에는 시트 이미지만 전달("PRESERVE THE WARDROBE" 지시로 착용 상태 유지)하고, 상품 식별자·구매 URL은 별도의 스냅샷 경로로 이동 — 생성 AI 파이프라인에 상거래 데이터를 노출하지 않으면서 구매 연결이 보존됨.
3. **발행 시점 박제(스냅샷 + SnapFix)**: FK 대신 값 복사 임베딩과 시트 이미지 불변 사본(`character_snapshots/`)을 사용해, 캐릭터/아이템 원본이 이후 변경·삭제되어도 발행된 곡의 주인공 캐릭터 표시와 구매 링크가 영구 고정됨.
4. **광고 성과 폐루프**: 선택 시 노출(`ad_impressions`), 곡 페이지 클릭 시(`ad_clicks`) 집계로 브랜드 상품의 노출→착용→발행→구매 유입 전 과정이 추적 가능.
