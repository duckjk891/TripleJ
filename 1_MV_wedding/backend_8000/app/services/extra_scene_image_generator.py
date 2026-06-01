"""
v23.1 — Extra Scene Image Generator (편집자 공간 — Higgsfield 스타일 씬이미지 A 보드).

`pre_mv_phase2_image_generator.generate_scene_image` 의 Step A/B 패턴을 차용하지만,
입력 데이터가 다음과 같이 다르다:
  - scene_plan/scenes 가 아니라, 사용자가 직접 @-멘션한 자산 (sheet/place/wedding_photo)
    리스트 + 사용자가 직접 업로드한 PNG/JPG object_name 리스트.
  - ref 의 합(@멘션 + 업로드) 은 최대 4장.

흐름:
  1) refs → wedding_character_sheets / wedding_assets 에서 bytes resolve.
  2) extra_image_object_names → MinIO photos 버킷에서 직접 bytes 로드.
  3) 우선순위: 업로드 이미지 먼저, 그 다음 @멘션 ref. 합 4장으로 컷.
  4) Step A — Gemini 2.5 Flash 텍스트로 image_prompt 합성. 입력에 user_text 와
     ref 메타데이터 + inlineData parts.
  5) Step B — image_model 분기:
       · "gpt_image_2" → openai_image.generate_image (multi-ref, max 4).
       · "nb_pro"      → character_generator._call_gemini_image.
  6) MinIO photos 버킷 `extra/{mv_job_id}/scene_images/{extra_scene_image_id}.png`
     로 업로드. preview_url 은 `/api/character/preview/{object}` 규약.

로그 prefix: `[ExtraSceneImage]`.
추적자: `extra_scene_image_id`, `mv_job_id`, `image_model`, `refs_count`,
`uploaded_count`. 본문/키/base64 출력 금지.
"""

from __future__ import annotations

import base64
import io
import logging
import mimetypes
import time
from typing import Any, Optional

from bson import ObjectId
from bson.errors import InvalidId

from ..config import settings
from ..database.minio import get_minio
from ..database.mongodb import get_mongo
from .character_generator import _call_gemini_image, _call_gemini_text
from .openai_image import generate_image as openai_generate_image

logger = logging.getLogger(__name__)


SHEET_SLOTS = ("groom_casual", "groom_wedding", "bride_casual", "bride_wedding")
ALLOWED_IMAGE_MODELS = ("gpt_image_2", "nb_pro")
STYLE_LABEL = {"casual": "평상복", "wedding": "웨딩 촬영복"}

# Step B 호출에 동시 첨부할 ref 이미지 최대 개수 (gpt_image_2 / nb_pro 공통 규약).
MAX_REFS = 4


SCENE_IMAGE_SYSTEM_PROMPT = """역할: 결혼식 식전영상 외 별도 컷(편집자 공간 — A 보드)을 위한
photorealistic 한 장면 사진을 생성하기 위한 이미지 모델 프롬프트를 작성하는 디렉터.

[입력 컨텍스트]
- 사용자가 직접 작성한 한국어 지시 (자유 문장): {user_text}
- 참조 자산 목록 (이미지로 첨부됨, 순서대로):
{refs_block}

[규칙]
① 첨부된 ref_image 들은 인물·장소·분위기 일관성 강제용. 각 ref 의 메타데이터(역할)에
   맞춰 인물이 등장하는 컷이면 그 인물이 반드시 보여야 한다. 자동으로 다른 인물을
   추가하지 않는다.
② 사용자의 지시 문구를 최우선으로 따른다. ref 메타데이터는 보조 정보다.
③ 장소/웨딩사진 ref 가 있으면 배경 톤/구조/광원을 그대로 따른다. 없으면 사용자
   지시에 묘사된 배경을 자연스러운 결혼식·웨딩 분위기로 보강한다.
④ Photorealistic, cinematic wedding/portrait tone. natural lighting. high detail.
   4K still 품질로 출력되도록 묘사한다.
⑤ 출력은 이미지 모델용 prompt 영문 1단락. 따옴표/머리말/번호매김/해설 없음.
⑥ 사용자 지시가 짧거나 비어 있어도 자연스럽고 따뜻한 컷으로 보강한다.
⑦ 음란/노출/위험 표현 금지. "glamorous" 같은 자극적 단어 사용 금지.
"""


def _inline_part(image_bytes: bytes, mime_type: str) -> dict:
    """Gemini inlineData part dict from raw bytes."""
    b64 = base64.b64encode(image_bytes or b"").decode("utf-8")
    return {
        "inlineData": {
            "mimeType": mime_type or "image/png",
            "data": b64,
        }
    }


def _to_oid(value: str) -> Optional[ObjectId]:
    try:
        return ObjectId(value)
    except (InvalidId, TypeError):
        return None


async def _load_image_from_photos(
    object_name: str,
) -> tuple[Optional[bytes], Optional[str]]:
    """Best-effort fetch of a MinIO photos-bucket object. Never raises."""
    if not object_name:
        return None, None
    minio_client = get_minio()
    if minio_client is None:
        logger.warning(
            "[ExtraSceneImage] minio not initialized object=%s",
            object_name,
        )
        return None, None
    try:
        resp = minio_client.get_object(
            bucket_name=settings.minio_bucket_photos,
            object_name=object_name,
        )
        data = resp.read()
        resp.close()
        resp.release_conn()
        mime = mimetypes.guess_type(object_name)[0] or "image/png"
        return data, mime
    except Exception as e:  # noqa: BLE001
        logger.warning(
            "[ExtraSceneImage] minio get failed object=%s: %s: %s",
            object_name, type(e).__name__, str(e)[:200],
        )
        return None, None


async def _put_minio_bytes(
    object_name: str, data: bytes, content_type: str = "image/png",
) -> None:
    """Upload PNG bytes to MinIO photos bucket."""
    minio_client = get_minio()
    minio_client.put_object(
        bucket_name=settings.minio_bucket_photos,
        object_name=object_name,
        data=io.BytesIO(data),
        length=len(data),
        content_type=content_type,
    )


# ── Ref resolution ──────────────────────────────────────────────────────────


async def _resolve_sheet_ref(
    *,
    owner_user_id: str,
    slot: str,
) -> tuple[Optional[bytes], Optional[str], str, str]:
    """Resolve a character sheet slot → (bytes, mime, display_name, style)."""
    if slot not in SHEET_SLOTS:
        return None, None, "", ""
    mongo = get_mongo()
    try:
        cs_doc = await mongo.wedding_character_sheets.find_one(
            {"user_id": owner_user_id}
        )
    except Exception as e:  # noqa: BLE001
        logger.warning(
            "[ExtraSceneImage] sheet lookup failed user_id=%s slot=%s: %s: %s",
            owner_user_id, slot, type(e).__name__, str(e)[:200],
        )
        return None, None, "", ""
    sd = ((cs_doc or {}).get("sheets") or {}).get(slot) or {}
    obj = sd.get("sheet_object_name") or ""
    display = (sd.get("display_name") or "").strip() or slot
    style = slot.split("_", 1)[1] if "_" in slot else ""
    if not obj:
        return None, None, display, style
    data, mime = await _load_image_from_photos(obj)
    return data, mime, display, style


async def _resolve_asset_ref(
    *,
    owner_user_id: str,
    asset_id: str,
) -> tuple[Optional[bytes], Optional[str], str, str, str]:
    """Resolve a wedding_assets _id → (bytes, mime, display_name, memo, type).

    Accepts type ∈ {place, wedding_photo}. owner 검증 — 다른 사용자 자산은 거부.
    """
    oid = _to_oid(asset_id)
    if oid is None:
        return None, None, "", "", ""
    mongo = get_mongo()
    try:
        doc = await mongo.wedding_assets.find_one({"_id": oid})
    except Exception as e:  # noqa: BLE001
        logger.warning(
            "[ExtraSceneImage] asset lookup failed asset_id=%s: %s: %s",
            asset_id, type(e).__name__, str(e)[:200],
        )
        return None, None, "", "", ""
    if not doc:
        return None, None, "", "", ""
    asset_owner = doc.get("user_id")
    if asset_owner != owner_user_id:
        logger.warning(
            "[ExtraSceneImage] asset owner mismatch asset_id=%s expected=%s got=%s",
            asset_id, owner_user_id, asset_owner,
        )
        return None, None, "", "", ""
    a_type = doc.get("type") or ""
    if a_type not in ("place", "wedding_photo"):
        return None, None, "", "", a_type
    obj = doc.get("object_name") or ""
    display = (doc.get("display_name") or "").strip()
    memo = ((doc.get("meta") or {}).get("memo") or "").strip()
    if not obj:
        return None, None, display, memo, a_type
    data, mime = await _load_image_from_photos(obj)
    return data, mime, display, memo, a_type


async def _resolve_scene_image_ref(
    *,
    mv_job_id: str,
    token: str,
) -> tuple[Optional[bytes], Optional[str], str]:
    """v26 — 식전영상 씬 이미지 ref 해석.

    token = "{story_slot}_{seq_in_slot}" (예: "meeting_1", "first_date_3").
    pre_mv_jobs (mv_job_id 로 1:1) 의 scenes 중 story_slot 일치 후
    scene_number 오름차순 seq_in_slot 번째 씬의 image_object_name 을 사용.

    Returns: (bytes, mime, display_label).
    """
    if not token:
        return None, None, ""
    # 토큰 파싱 — known story_slot prefix 와 매칭. 식전영상의 story_slot 집합은
    # 5종 (meeting / first_date / memory / proposal / wedding_prep).
    known_slots = ("meeting", "first_date", "memory", "proposal", "wedding_prep")
    slot: Optional[str] = None
    seq_in_slot: Optional[int] = None
    for cand in sorted(known_slots, key=lambda s: -len(s)):
        prefix = cand + "_"
        if token.startswith(prefix):
            tail = token[len(prefix):]
            try:
                seq_in_slot = int(tail)
                slot = cand
            except ValueError:
                continue
            break
    if slot is None or seq_in_slot is None or seq_in_slot < 1:
        logger.warning(
            "[ExtraSceneImage] scene_image token unparseable mv_job_id=%s token=%s",
            mv_job_id, token,
        )
        return None, None, ""
    mongo = get_mongo()
    try:
        pre_doc = await mongo.pre_mv_jobs.find_one({"mv_job_id": mv_job_id})
    except Exception as e:  # noqa: BLE001
        logger.warning(
            "[ExtraSceneImage] pre_mv_jobs lookup failed mv_job_id=%s token=%s err=%s",
            mv_job_id, token, str(e)[:200],
        )
        return None, None, ""
    if not pre_doc:
        logger.warning(
            "[ExtraSceneImage] pre_mv_jobs missing mv_job_id=%s token=%s",
            mv_job_id, token,
        )
        return None, None, ""
    scenes = pre_doc.get("scenes") or []
    slot_scenes = [
        s for s in scenes
        if isinstance(s, dict)
        and (s.get("story_slot") or "").strip() == slot
        and (s.get("image_object_name") or "").strip()
    ]
    slot_scenes.sort(key=lambda x: int(x.get("scene_number") or 0))
    if seq_in_slot > len(slot_scenes):
        logger.warning(
            "[ExtraSceneImage] scene_image seq out of range mv_job_id=%s token=%s "
            "slot=%s seq=%d available=%d",
            mv_job_id, token, slot, seq_in_slot, len(slot_scenes),
        )
        return None, None, ""
    target = slot_scenes[seq_in_slot - 1]
    obj = (target.get("image_object_name") or "").strip()
    logger.info(
        "[ExtraSceneImage] scene_image ref resolved mv_job_id=%s token=%s "
        "scene_number=%s object=%s",
        mv_job_id, token, target.get("scene_number"), obj,
    )
    data, mime = await _load_image_from_photos(obj)
    return data, mime, "씬 — @{}".format(token)


def _ref_label(ref: dict) -> str:
    """Build a short human-readable label for a @-mention ref dict.

    ref shape (loose — frontend sends `MentionRef`-like dicts):
      {type: 'sheet'|'place'|'wedding_photo'|'scene_image', asset_id, display_name?, object_name?}
    """
    t = (ref.get("type") or "").strip()
    name = (ref.get("display_name") or "").strip()
    asset_id = (ref.get("asset_id") or "").strip()
    label = name or asset_id or "(이름 없음)"
    if t == "sheet":
        style = ""
        if asset_id in SHEET_SLOTS:
            style_key = asset_id.split("_", 1)[1] if "_" in asset_id else ""
            style = STYLE_LABEL.get(style_key, "")
        role = "신랑" if asset_id.startswith("groom_") else (
            "신부" if asset_id.startswith("bride_") else "캐릭터"
        )
        if style:
            return "{}({}) — {}".format(role, style, label)
        return "{} — {}".format(role, label)
    if t == "place":
        return "장소 — {}".format(label)
    if t == "wedding_photo":
        return "웨딩사진 — {}".format(label)
    if t == "scene_image":
        return "씬 — @{}".format(label)
    return "참조 — {}".format(label)


# ── Main entry ──────────────────────────────────────────────────────────────


async def generate_extra_scene_image(
    *,
    extra_scene_image_id: str,
    mv_job_id: str,
    user_id: str,
    refs: list[dict],
    extra_image_object_names: list[str],
    user_text: str,
    image_model: str,
) -> dict:
    """Generate one extra scene image PNG and persist to MinIO photos bucket.

    Args:
      extra_scene_image_id: mongo doc id (string of ObjectId).
      mv_job_id: parent mv_jobs id (used only for tracing + object key prefix).
      user_id: owner_user_id — refs/assets 의 owner 검증 + storage path.
      refs: @-멘션 dict 리스트 (type ∈ sheet|place|wedding_photo, asset_id, …).
      extra_image_object_names: 사용자 직접 업로드한 MinIO photos object_name 리스트.
      user_text: 자유 텍스트 지시.
      image_model: "gpt_image_2" | "nb_pro".

    Returns:
      {"object_name": str, "preview_url": str}

    Raises:
      ValueError: image_model 비지원, 입력 0장, Step A 빈 응답.
      Exception: 외부 API 실패 — 호출자가 except 후 status=failed 처리.
    """
    started = time.time()

    if image_model not in ALLOWED_IMAGE_MODELS:
        raise ValueError("unsupported image_model: {}".format(image_model))

    user_text = (user_text or "").strip()
    refs = list(refs or [])
    extra_image_object_names = list(extra_image_object_names or [])

    logger.info(
        "[ExtraSceneImage] entry extra_scene_image_id=%s mv_job_id=%s user_id=%s "
        "image_model=%s text_len=%d refs=%d uploaded=%d",
        extra_scene_image_id, mv_job_id, user_id, image_model,
        len(user_text), len(refs), len(extra_image_object_names),
    )

    # ── 1) Resolve refs (sheet / place / wedding_photo) ───────────────────────
    resolved: list[tuple[bytes, str, str]] = []  # (bytes, mime, label)

    # 1a) 업로드 이미지 먼저 — 사용자가 가장 우선시한 입력으로 가정.
    for obj_name in extra_image_object_names:
        if not obj_name:
            continue
        data, mime = await _load_image_from_photos(obj_name)
        if not data:
            logger.warning(
                "[ExtraSceneImage] uploaded ref missing extra_scene_image_id=%s "
                "mv_job_id=%s object=%s",
                extra_scene_image_id, mv_job_id, obj_name,
            )
            continue
        resolved.append((data, mime or "image/png", "사용자 업로드 이미지"))
        if len(resolved) >= MAX_REFS:
            break

    # 1b) @-멘션 ref — 업로드로 남은 슬롯이 있을 때만.
    if len(resolved) < MAX_REFS:
        for ref in refs:
            if len(resolved) >= MAX_REFS:
                break
            if not isinstance(ref, dict):
                continue
            t = (ref.get("type") or "").strip()
            asset_id = (ref.get("asset_id") or "").strip()
            if not asset_id:
                continue
            data: Optional[bytes] = None
            mime: Optional[str] = None
            if t == "sheet":
                data, mime, _disp, _style = await _resolve_sheet_ref(
                    owner_user_id=user_id, slot=asset_id,
                )
            elif t in ("place", "wedding_photo"):
                data, mime, _disp, _memo, _ty = await _resolve_asset_ref(
                    owner_user_id=user_id, asset_id=asset_id,
                )
            elif t == "scene_image":
                data, mime, _disp = await _resolve_scene_image_ref(
                    mv_job_id=mv_job_id, token=asset_id,
                )
            else:
                logger.warning(
                    "[ExtraSceneImage] unknown ref type extra_scene_image_id=%s "
                    "mv_job_id=%s type=%s asset_id=%s",
                    extra_scene_image_id, mv_job_id, t, asset_id,
                )
                continue
            if not data:
                logger.warning(
                    "[ExtraSceneImage] ref bytes missing extra_scene_image_id=%s "
                    "mv_job_id=%s type=%s asset_id=%s",
                    extra_scene_image_id, mv_job_id, t, asset_id,
                )
                continue
            resolved.append((data, mime or "image/png", _ref_label(ref)))

    refs_count = len(resolved)
    if refs_count == 0 and not user_text:
        # 그림 그릴 단서가 아예 없으면 실패 — 명확한 사용자 입력 1가지(이미지 or 글) 필요.
        raise ValueError(
            "no reference images and empty user_text — at least one required"
        )

    if refs_count == 0:
        logger.info(
            "[ExtraSceneImage] no refs — text-only generation extra_scene_image_id=%s "
            "mv_job_id=%s",
            extra_scene_image_id, mv_job_id,
        )

    # ── 2) Step A — Gemini text 합성 ──────────────────────────────────────────
    refs_block_lines: list[str] = []
    for idx, (_b, _m, label) in enumerate(resolved, start=1):
        refs_block_lines.append("  #{}: {}".format(idx, label))
    refs_block = "\n".join(refs_block_lines) or "  (참조 이미지 없음)"

    step_a_prompt = SCENE_IMAGE_SYSTEM_PROMPT.format(
        user_text=user_text or "(사용자 지시 없음 — 첨부된 참조를 자연스럽게 결합)",
        refs_block=refs_block,
    )

    image_parts: list[dict] = []
    for data, mime, _label in resolved:
        image_parts.append(_inline_part(data, mime))
    if len(image_parts) > MAX_REFS:
        image_parts = image_parts[:MAX_REFS]

    logger.info(
        "[ExtraSceneImage] step_a calling gemini text extra_scene_image_id=%s "
        "mv_job_id=%s image_model=%s prompt_len=%d parts=%d refs_count=%d",
        extra_scene_image_id, mv_job_id, image_model,
        len(step_a_prompt), len(image_parts), refs_count,
    )
    step_a_text = await _call_gemini_text(
        step_a_prompt, image_parts,
        role=None, style=None, user_id=user_id,
    )
    step_a_text = (step_a_text or "").strip()
    if not step_a_text:
        raise ValueError("Gemini Step A returned empty text")

    logger.info(
        "[ExtraSceneImage] step_a done extra_scene_image_id=%s mv_job_id=%s "
        "text_len=%d",
        extra_scene_image_id, mv_job_id, len(step_a_text),
    )

    # ── 3) Step B — 이미지 모델 호출 ──────────────────────────────────────────
    if image_model == "gpt_image_2":
        ref_bytes_list: list[bytes] = [d for (d, _m, _l) in resolved][:MAX_REFS]
        logger.info(
            "[ExtraSceneImage] step_b calling openai_image extra_scene_image_id=%s "
            "mv_job_id=%s ref_count=%d",
            extra_scene_image_id, mv_job_id, len(ref_bytes_list),
        )
        image_bytes = await openai_generate_image(
            prompt=step_a_text,
            ref_images=ref_bytes_list,
            size="2048x1152",  # v29 — 16:9 통일 (씬 이미지)
            quality="high",
        )
    elif image_model == "nb_pro":
        logger.info(
            "[ExtraSceneImage] step_b calling gemini image extra_scene_image_id=%s "
            "mv_job_id=%s ref_count=%d",
            extra_scene_image_id, mv_job_id, len(image_parts),
        )
        image_bytes = await _call_gemini_image(
            step_a_text, image_parts,
            role=None, style=None, user_id=user_id,
            aspect_ratio="16:9",  # v29 — 16:9 통일 (씬 이미지)
        )
    else:
        # ALLOWED_IMAGE_MODELS 게이팅으로 도달 불가.
        raise ValueError("unsupported image_model: {}".format(image_model))

    if not image_bytes:
        raise ValueError("image model returned empty bytes")

    # ── 4) MinIO 영구 저장 ───────────────────────────────────────────────────
    object_name = "extra/{}/scene_images/{}.png".format(
        mv_job_id, extra_scene_image_id,
    )
    try:
        await _put_minio_bytes(object_name, image_bytes, "image/png")
    except Exception as e:  # noqa: BLE001
        err = "{}: {}".format(type(e).__name__, str(e)[:200] or "(no message)")
        logger.exception(
            "[ExtraSceneImage] minio put failed extra_scene_image_id=%s "
            "mv_job_id=%s object=%s: %s",
            extra_scene_image_id, mv_job_id, object_name, err,
        )
        raise

    preview_url = "/api/character/preview/{}".format(object_name)
    elapsed_ms = int((time.time() - started) * 1000)
    logger.info(
        "[ExtraSceneImage] ok extra_scene_image_id=%s mv_job_id=%s image_model=%s "
        "refs_count=%d uploaded_count=%d bytes=%d elapsed_ms=%d object=%s",
        extra_scene_image_id, mv_job_id, image_model,
        refs_count, len(extra_image_object_names),
        len(image_bytes or b""), elapsed_ms, object_name,
    )
    return {"object_name": object_name, "preview_url": preview_url}
