"""
v17.2 — Phase 2: 씬 이미지 생성 서비스.

각 씬마다 reference 이미지(캐릭터 시트 + 장소 + 옵션 wedding_photo) 와
scene.image_prompt 를 결합해 PNG 한 장을 생성한다. 결과는 MinIO `photos` 버킷의
`pre_mv/{pre_mv_job_id}/scenes/{N:03d}.png` 객체로 저장한다.

흐름:
  1) scene.ref_sheet_ids / scene.ref_place_ids 와 wedding_assets / character_sheets
     를 이용해 ref bytes 를 로드 (자동 분기 금지, @멘션이 가리킨 것만).
  2) Step A — Gemini text 로 두 인물(신랑+신부)을 모두 반영하는 영문 prompt 합성
     (`wedding_photo_generator` 의 패턴 차용). user_text 는 scene.image_prompt.
  3) Step B — image_model 분기:
       · "gpt_image_2" → openai_image.generate_image (multi-ref).
       · "nb_pro"      → character_generator._call_gemini_image (inlineData).
  4) PNG bytes 반환. 호출자(routes/pre_mv.py) 가 MinIO 업로드와 doc 업데이트.

로그 prefix: `[PreMVSceneImage]`. 추적자: pre_mv_job_id, scene_number, phase=phase2,
image_model, refs_count, elapsed_ms, bytes. 본문은 길이만 — 키/base64/원문 금지.

사용자 합의(엄격):
  · 캐릭터 시트 = `groom_casual` / `groom_wedding` / `bride_casual` / `bride_wedding`
    4종 중 ref_sheet_ids 가 가리킨 slot 만. 자동 분기 금지.
  · 장소·웨딩사진 = ref_place_ids 가 가리킨 wedding_assets (type=place|wedding_photo).
  · 두 인물이 ref 로 들어가도 단수 표현 회피("the bride and the groom — both must
    match their reference sheets").
"""

from __future__ import annotations

import base64
import logging
import mimetypes
import time
from typing import Any, Optional

from bson import ObjectId
from bson.errors import InvalidId

from ..config import settings
from ..database.minio import get_minio
from ..database.mongodb import get_mongo
from .character_generator import _call_claude_text, _call_gemini_image  # v52 — Step A → Claude
from .openai_image import generate_image as openai_generate_image

logger = logging.getLogger(__name__)


SHEET_SLOTS = ("groom_casual", "groom_wedding", "bride_casual", "bride_wedding")
ALLOWED_IMAGE_MODELS = ("gpt_image_2", "nb_pro")
STYLE_LABEL = {"casual": "평상복", "wedding": "웨딩 촬영복"}

# Step B 호출에 동시 첨부할 ref 이미지 최대 개수 (gpt_image_2 / nb_pro 양쪽 공통).
# v24 챕터 체인: 신랑·신부 시트 2장 + 이전 씬 1장 + 장소 1장 = 최대 4장. wedding_photo 는
# 양보(4장 한도 안에 들어갈 때만).
_MAX_REFS = 4


# v24 — 이전 씬 이미지 가이드 (chapter 내 연쇄 carry).
PREV_SCENE_BLOCK_PRESENT = (
    "If a previous-scene reference image is provided, treat it as the same "
    "world/lighting/props/camera-style context. Maintain the EXACT same coffee cup, "
    "chair, umbrella, etc. across scenes."
)


SCENE_IMAGE_SYSTEM_PROMPT = """역할: 결혼식 식전영상의 단일 씬을 photorealistic 한 장면 사진으로 그리기 위한
이미지 모델 프롬프트를 작성하는 디렉터.

[입력 컨텍스트]
- 씬 영문 image_prompt (씬 디렉터가 미리 작성): {scene_prompt}
- 씬 한국어 보조 설명: {scene_prompt_ko}
- 신랑 캐릭터 시트 (이미지 참조): {groom_block}
- 신부 캐릭터 시트 (이미지 참조): {bride_block}
- 이전 씬 (이미지 참조, 챕터 내 연쇄): {prev_scene_block}
- 장소 (이미지 참조): {place_block}
- 보조 참조 (이미지 참조): {extra_block}

[규칙]
① ref_image 들은 인물·장소 일관성 강제용. 각 인물 블록 끝의 [full-match] / [face-only]
   태그를 반드시 준수:
     · [full-match]  — 시트의 얼굴·체형·머리·옷·액세서리를 **모두** 정확히 매칭
                       (사용자가 명시적으로 이 시트를 ref 로 선택했음)
     · [face-only]   — 시트의 **얼굴·체형·머리만** 매칭. 옷·액세서리·계절감은
                       scene_prompt 묘사에 맞춰 자유 변주 (예: 시트가 정장이어도
                       여름 비치 씬이면 가벼운 셔츠로 갈아입은 동일 인물).
   캐릭터 시트가 둘 다 있으면 두 인물이 모두 등장해야 한다.
② 인물 시트가 한쪽만 있는 씬이면 그 한 명만 그린다. 절대 자동으로 다른 인물을 추가하지 않는다.
③ 장소 ref 가 있으면 배경 톤/구조를 그대로 따른다. 없으면 image_prompt 의 묘사를 우선.
④ Photorealistic, cinematic wedding film tone. natural lighting. 4K still.
⑤ 출력은 이미지 모델용 prompt 영문 1단락. 따옴표/머리말/번호매김/해설 없음.
⑥ image_prompt 가 짧거나 비어 있어도 자연스럽고 따뜻한 컷으로 보강.
⑦ 음란/노출/위험 표현 금지. "glamorous" 같은 자극적 단어는 사용하지 않는다.
⑧ {prev_scene_guidance}
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


async def _load_image_from_photos(object_name: str) -> tuple[Optional[bytes], Optional[str]]:
    """Best-effort fetch of a MinIO photos-bucket object. Never raises."""
    if not object_name:
        return None, None
    minio_client = get_minio()
    if minio_client is None:
        logger.warning(
            "[PreMVSceneImage] phase=phase2 minio not initialized object=%s",
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
            "[PreMVSceneImage] phase=phase2 minio get failed object=%s: %s: %s",
            object_name, type(e).__name__, str(e)[:200],
        )
        return None, None


def _to_oid(value: str) -> Optional[ObjectId]:
    try:
        return ObjectId(value)
    except (InvalidId, TypeError):
        return None


async def _resolve_sheet_ref(
    *,
    owner_user_id: str,
    slot: str,
) -> tuple[Optional[bytes], Optional[str], str, str]:
    """Resolve a character sheet slot → (bytes, mime, display_name, style).

    slot ∈ SHEET_SLOTS. 미존재 시 (None, None, "", "").
    """
    if slot not in SHEET_SLOTS:
        return None, None, "", ""
    mongo = get_mongo()
    try:
        cs_doc = await mongo.wedding_character_sheets.find_one(
            {"user_id": owner_user_id}
        )
    except Exception as e:  # noqa: BLE001
        logger.warning(
            "[PreMVSceneImage] phase=phase2 sheet lookup failed user_id=%s slot=%s: %s: %s",
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

    Accepts type=place OR type=wedding_photo. 미존재 시 모두 빈 값.
    """
    oid = _to_oid(asset_id)
    if oid is None:
        return None, None, "", "", ""
    mongo = get_mongo()
    try:
        doc = await mongo.wedding_assets.find_one({"_id": oid})
    except Exception as e:  # noqa: BLE001
        logger.warning(
            "[PreMVSceneImage] phase=phase2 asset lookup failed asset_id=%s: %s: %s",
            asset_id, type(e).__name__, str(e)[:200],
        )
        return None, None, "", "", ""
    if not doc:
        return None, None, "", "", ""
    # 자산 owner 검증 — owner_user_id 일치여야 함 (다른 사람 자산 차단)
    asset_owner = doc.get("user_id")
    if asset_owner != owner_user_id:
        logger.warning(
            "[PreMVSceneImage] phase=phase2 asset owner mismatch asset_id=%s "
            "expected=%s got=%s",
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


def _is_wedding_prep_slot(story_slot: Optional[str]) -> bool:
    return (story_slot or "").lower() == "wedding_prep"


async def _wedding_photo_fallback_for_owner(owner_user_id: str) -> Optional[ObjectId]:
    """Pick the most recent wedding_photo asset for the owner (fallback only)."""
    mongo = get_mongo()
    try:
        doc = await mongo.wedding_assets.find_one(
            {"user_id": owner_user_id, "type": "wedding_photo"},
            sort=[("created_at", -1)],
        )
        if doc and doc.get("_id"):
            return doc["_id"]
    except Exception as e:  # noqa: BLE001
        logger.warning(
            "[PreMVSceneImage] phase=phase2 wedding_photo fallback failed "
            "user_id=%s: %s: %s",
            owner_user_id, type(e).__name__, str(e)[:200],
        )
    return None


async def generate_scene_image(
    *,
    pre_mv_job_id: str,
    scene_number: int,
    image_model: str,
    scene: dict,
    owner_user_id: str,
    prev_scene_image_bytes: Optional[bytes] = None,
) -> bytes:
    """Generate one scene PNG.

    Args:
      pre_mv_job_id: tracing tag.
      scene_number: 1-based scene number.
      image_model: ALLOWED_IMAGE_MODELS 중 하나.
      scene: pre_mv_jobs.scenes[N-1] 원소. 필수 키:
        - image_prompt, image_prompt_ko
        - ref_sheet_ids (list[str])  — SHEET_SLOTS 중 일부
        - ref_place_ids (list[str])  — wedding_assets _id (place|wedding_photo)
        - story_slot (str, 옵션)     — wedding_prep fallback 판단용
      owner_user_id: 자산 owner. 자산 owner 가 다른 사용자면 제외.
      prev_scene_image_bytes:
        v24 — 챕터 안 직렬 carry. 같은 챕터의 이전 씬 image_object_name 을
        MinIO 에서 fetch 한 PNG bytes. 첫 씬이거나 carry 불가 fallback 일 때는 None.
        존재 시 ref 우선순위 — 신랑 시트, 신부 시트, prev_scene, place, (양보) wedding_photo
        순으로 4 슬롯 안에 배치된다.

    Returns:
      PNG bytes.

    Raises:
      ValueError: Step A Gemini 빈 응답일 때만. ref 0개여도 진행 (v33 — text-only).
      Exception: 외부 API 실패는 호출자 측에서 except 후 image_status=failed 처리.
    """
    started = time.time()

    if image_model not in ALLOWED_IMAGE_MODELS:
        raise ValueError("unsupported image_model: {}".format(image_model))

    image_prompt = (scene.get("image_prompt") or "").strip()
    image_prompt_ko = (scene.get("image_prompt_ko") or "").strip()
    ref_sheet_ids: list[str] = list(scene.get("ref_sheet_ids") or [])
    ref_place_ids: list[str] = list(scene.get("ref_place_ids") or [])
    story_slot = scene.get("story_slot") or ""

    has_prev_scene = bool(prev_scene_image_bytes)
    logger.info(
        "[PreMVSceneImage] phase=phase2 entry pre_mv_job_id=%s scene_number=%d "
        "image_model=%s prompt_len=%d prompt_ko_len=%d "
        "ref_sheet_ids=%s ref_place_ids=%s story_slot=%s prev_scene=%s",
        pre_mv_job_id, scene_number, image_model,
        len(image_prompt), len(image_prompt_ko),
        ",".join(ref_sheet_ids) or "(none)",
        ",".join(ref_place_ids) or "(none)",
        story_slot, has_prev_scene,
    )

    # ── ref 로드 ─────────────────────────────────────────────────────────────
    groom_bytes: Optional[bytes] = None
    groom_mime: Optional[str] = None
    groom_display = ""
    groom_style = ""
    # v34 — explicit ref_sheet_ids 에서 왔는지(full-match) vs v32 fallback(face-only) 구분.
    groom_is_explicit = False
    bride_bytes: Optional[bytes] = None
    bride_mime: Optional[str] = None
    bride_display = ""
    bride_style = ""
    bride_is_explicit = False
    place_bytes: Optional[bytes] = None
    place_mime: Optional[str] = None
    place_display = ""
    place_memo = ""
    extra_bytes: Optional[bytes] = None
    extra_mime: Optional[str] = None
    extra_display = ""
    extra_memo = ""

    # 1) sheet slots — 사용자가 지정한 것만, 자동 분기 금지.
    #    같은 시점에 groom_* 2개를 다 지정한 경우(드물지만) 첫 번째만 사용.
    for slot in ref_sheet_ids:
        if slot not in SHEET_SLOTS:
            logger.warning(
                "[PreMVSceneImage] phase=phase2 unknown sheet slot pre_mv_job_id=%s "
                "scene_number=%d slot=%s — skipping",
                pre_mv_job_id, scene_number, slot,
            )
            continue
        data, mime, display, style = await _resolve_sheet_ref(
            owner_user_id=owner_user_id, slot=slot,
        )
        if not data:
            logger.warning(
                "[PreMVSceneImage] phase=phase2 sheet bytes missing pre_mv_job_id=%s "
                "scene_number=%d slot=%s",
                pre_mv_job_id, scene_number, slot,
            )
            continue
        if slot.startswith("groom_") and groom_bytes is None:
            groom_bytes, groom_mime = data, mime
            groom_display, groom_style = display, style
            groom_is_explicit = True
        elif slot.startswith("bride_") and bride_bytes is None:
            bride_bytes, bride_mime = data, mime
            bride_display, bride_style = display, style
            bride_is_explicit = True

    # 2) place / wedding_photo — 첫 ref 를 place 슬롯, 그 외 첫 번째를 extra 슬롯에.
    resolved_assets: list[tuple[bytes, str, str, str, str]] = []
    for aid in ref_place_ids:
        data, mime, display, memo, a_type = await _resolve_asset_ref(
            owner_user_id=owner_user_id, asset_id=aid,
        )
        if not data:
            continue
        resolved_assets.append((data, mime or "image/png", display, memo, a_type))

    # 3) wedding_prep 시점이고 ref_place_ids 비어 있으면 wedding_photo fallback.
    if not resolved_assets and _is_wedding_prep_slot(story_slot):
        fb_oid = await _wedding_photo_fallback_for_owner(owner_user_id)
        if fb_oid is not None:
            data, mime, display, memo, a_type = await _resolve_asset_ref(
                owner_user_id=owner_user_id, asset_id=str(fb_oid),
            )
            if data:
                resolved_assets.append((data, mime or "image/png", display, memo, a_type))
                logger.info(
                    "[PreMVSceneImage] phase=phase2 wedding_prep fallback applied "
                    "pre_mv_job_id=%s scene_number=%d asset_id=%s",
                    pre_mv_job_id, scene_number, str(fb_oid),
                )

    # place 슬롯과 extra(wedding_photo) 슬롯 분배 — 첫 ref 를 place, 두 번째를 extra.
    if resolved_assets:
        place_bytes, place_mime, place_display, place_memo, _ = resolved_assets[0]
    if len(resolved_assets) >= 2:
        extra_bytes, extra_mime, extra_display, extra_memo, _ = resolved_assets[1]

    # v32 — 최종 fallback: 캐릭터 시트 기본값.
    # scenario_events 의 refs 가 비어있어서 Phase 1 이 ref_ids 를 못 채운 케이스
    # (사용자가 @멘션을 안 한 회상 등). 이 시점까지 groom_bytes/bride_bytes 가 비어있고
    # ref_sheet_ids 에 명시도 없었으면 default 시트로 시도한다.
    # v54.5 — chapter (story_slot) 에 따라 fallback 순서 분기:
    #   · wedding_prep → wedding 시트 우선 (예복 차림 어울림)
    #   · 그 외 → casual 시트 우선 (= 사용자가 처음 만든 것, 일상 컨텍스트에 맞음)
    #   이전엔 무조건 wedding 먼저라 첫 데이트/회상 씬에 예복 차림이 들어가던 버그.
    is_wedding_chapter = _is_wedding_prep_slot(story_slot)
    groom_fb_order = (
        ("groom_wedding", "groom_casual") if is_wedding_chapter
        else ("groom_casual", "groom_wedding")
    )
    bride_fb_order = (
        ("bride_wedding", "bride_casual") if is_wedding_chapter
        else ("bride_casual", "bride_wedding")
    )

    has_groom_in_refs = any(s.startswith("groom_") for s in ref_sheet_ids)
    if not groom_bytes and not has_groom_in_refs:
        for fb_slot in groom_fb_order:
            data, mime, display, style = await _resolve_sheet_ref(
                owner_user_id=owner_user_id, slot=fb_slot,
            )
            if data:
                groom_bytes, groom_mime = data, mime
                groom_display, groom_style = display, style
                logger.info(
                    "[PreMVSceneImage] phase=phase2 default sheet fallback "
                    "pre_mv_job_id=%s scene_number=%d slot=%s",
                    pre_mv_job_id, scene_number, fb_slot,
                )
                break

    has_bride_in_refs = any(s.startswith("bride_") for s in ref_sheet_ids)
    if not bride_bytes and not has_bride_in_refs:
        for fb_slot in bride_fb_order:
            data, mime, display, style = await _resolve_sheet_ref(
                owner_user_id=owner_user_id, slot=fb_slot,
            )
            if data:
                bride_bytes, bride_mime = data, mime
                bride_display, bride_style = display, style
                logger.info(
                    "[PreMVSceneImage] phase=phase2 default sheet fallback "
                    "pre_mv_job_id=%s scene_number=%d slot=%s",
                    pre_mv_job_id, scene_number, fb_slot,
                )
                break

    # v24 — ref 우선순위 재배치 (c안):
    #   1) 캐릭터 시트 groom
    #   2) 캐릭터 시트 bride
    #   3) prev_scene_image_bytes (있을 때만)
    #   4) place
    #   5) wedding_photo (extra) — 4 슬롯 한도 안에 들어가면 첨부, 아니면 양보.
    refs_count = sum(
        1 for x in (groom_bytes, bride_bytes, prev_scene_image_bytes, place_bytes, extra_bytes)
        if x
    )
    if refs_count == 0:
        # v33 — ref 0개여도 진행 (text-only). 두 image_model 모두 ref 없이 text-to-image 가능:
        # · openai_generate_image: ref_images 빈 리스트면 /v1/images/generations 호출
        # · _call_gemini_image: image_parts 빈 리스트면 nano-banana text-only 모드
        # Step A Gemini 합성도 image_parts 빈 채로 호출 가능 (text-only synthesis).
        # 캐릭터·장소 일관성은 떨어질 수 있지만 ValueError 로 실패하는 것보다 나음.
        logger.warning(
            "[PreMVSceneImage] phase=phase2 no refs resolved — proceeding text-only "
            "pre_mv_job_id=%s scene_number=%d sheet_ids=%s place_ids=%s",
            pre_mv_job_id, scene_number, ref_sheet_ids, ref_place_ids,
        )

    # 최종 슬롯 채움 — 우선순위 1~4 까지는 무조건 채우고, 5는 한도 남으면 채움.
    prioritized_slots: list[tuple[bytes, str, str]] = []  # (bytes, mime, slot_label)
    if groom_bytes:
        prioritized_slots.append((groom_bytes, groom_mime or "image/png", "groom_sheet"))
    if bride_bytes:
        prioritized_slots.append((bride_bytes, bride_mime or "image/png", "bride_sheet"))
    if prev_scene_image_bytes:
        prioritized_slots.append((prev_scene_image_bytes, "image/png", "prev_scene"))
    if place_bytes:
        prioritized_slots.append((place_bytes, place_mime or "image/png", "place"))
    if extra_bytes and len(prioritized_slots) < _MAX_REFS:
        prioritized_slots.append((extra_bytes, extra_mime or "image/png", "wedding_photo"))
    # 한도 초과 시 우선순위 낮은 슬롯부터 잘라낸다.
    prioritized_slots = prioritized_slots[:_MAX_REFS]
    image_prev_scene_ref_used = any(
        slot == "prev_scene" for _, _, slot in prioritized_slots
    )
    logger.info(
        "[PreMVSceneImage] phase=phase2 ref_priority pre_mv_job_id=%s scene_number=%d "
        "slots=%s prev_scene_used=%s",
        pre_mv_job_id, scene_number,
        ",".join(s for _, _, s in prioritized_slots) or "(none)",
        image_prev_scene_ref_used,
    )

    # ── Step A — Gemini text 합성 ─────────────────────────────────────────────
    def _block(display: str, style_label: str = "", memo: str = "", face_only: bool = False) -> str:
        if not display and not style_label and not memo:
            return "(없음 — 이 슬롯의 참조 이미지는 사용하지 않음)"
        parts = []
        if display:
            parts.append(display)
        if style_label:
            parts.append("스타일: {}".format(style_label))
        if memo:
            parts.append("메모: {}".format(memo))
        base = " / ".join(parts) or "(설명 없음)"
        # v34 — 인물 시트 전용 매칭 모드 마커.
        if face_only:
            base += " [face-only]"
        elif display and style_label:
            # 캐릭터 시트 (display+style 양쪽 다 있음) 인 케이스만 full-match 마커.
            base += " [full-match]"
        return base

    groom_block = _block(
        groom_display, STYLE_LABEL.get(groom_style, groom_style),
        face_only=(not groom_is_explicit),
    ) if groom_bytes else "(이 씬에는 신랑이 등장하지 않습니다 — 신랑 ref 추가 금지)"
    bride_block = _block(
        bride_display, STYLE_LABEL.get(bride_style, bride_style),
        face_only=(not bride_is_explicit),
    ) if bride_bytes else "(이 씬에는 신부가 등장하지 않습니다 — 신부 ref 추가 금지)"
    place_block = _block(
        place_display, "", place_memo,
    ) if place_bytes else "(장소 참조 없음 — image_prompt 묘사 기준)"
    extra_block = _block(
        extra_display, "", extra_memo,
    ) if extra_bytes else "(없음)"
    prev_scene_block = (
        "이전 씬의 PNG 가 참조 이미지로 첨부되어 있습니다. 같은 챕터의 직전 컷이며, "
        "world/lighting/props/camera-style 의 동일한 컨텍스트로 다뤄야 합니다."
        if image_prev_scene_ref_used
        else "(이전 씬 참조 없음 — 챕터의 첫 씬이거나 carry 가 적용되지 않음)"
    )
    prev_scene_guidance = (
        PREV_SCENE_BLOCK_PRESENT
        if image_prev_scene_ref_used
        else "이전 씬 참조가 없으므로 본 규칙은 적용하지 않습니다."
    )

    step_a_prompt = SCENE_IMAGE_SYSTEM_PROMPT.format(
        scene_prompt=image_prompt or "(영문 prompt 비어 있음 — 한국어 보조 설명을 따른다)",
        scene_prompt_ko=image_prompt_ko or "(한국어 보조 설명 없음)",
        groom_block=groom_block,
        bride_block=bride_block,
        prev_scene_block=prev_scene_block,
        place_block=place_block,
        extra_block=extra_block,
        prev_scene_guidance=prev_scene_guidance,
    )

    # Gemini inlineData parts — 우선순위 슬롯 순으로 (최대 _MAX_REFS).
    image_parts: list[dict] = [
        _inline_part(b, mime) for b, mime, _ in prioritized_slots
    ]

    logger.info(
        "[PreMVSceneImage] phase=phase2 step_a calling gemini text pre_mv_job_id=%s "
        "scene_number=%d image_model=%s prompt_len=%d parts=%d refs_count=%d",
        pre_mv_job_id, scene_number, image_model,
        len(step_a_prompt), len(image_parts), refs_count,
    )
    step_a_text = await _call_claude_text(  # v52 — Step A → Claude
        step_a_prompt, image_parts,
        role=None, style=None, user_id=owner_user_id,
    )
    step_a_text = (step_a_text or "").strip()
    if not step_a_text:
        raise ValueError("Gemini Step A returned empty text")

    logger.info(
        "[PreMVSceneImage] phase=phase2 step_a done pre_mv_job_id=%s scene_number=%d "
        "text_len=%d",
        pre_mv_job_id, scene_number, len(step_a_text),
    )

    # ── Step B — 이미지 모델 호출 ────────────────────────────────────────────
    if image_model == "gpt_image_2":
        # openai_image.generate_image 는 raw bytes list 를 받는다.
        # v24 — Gemini Step A 와 동일한 우선순위 슬롯 순서 사용.
        ref_bytes_list: list[bytes] = [b for b, _, _ in prioritized_slots]
        logger.info(
            "[PreMVSceneImage] phase=phase2 step_b calling openai_image "
            "pre_mv_job_id=%s scene_number=%d ref_count=%d",
            pre_mv_job_id, scene_number, len(ref_bytes_list),
        )
        image_bytes = await openai_generate_image(
            prompt=step_a_text,
            ref_images=ref_bytes_list,
            size="2048x1152",  # v29 — 16:9 통일 (씬 이미지)
            quality="high",
        )
    elif image_model == "nb_pro":
        logger.info(
            "[PreMVSceneImage] phase=phase2 step_b calling gemini image "
            "pre_mv_job_id=%s scene_number=%d ref_count=%d",
            pre_mv_job_id, scene_number, len(image_parts),
        )
        image_bytes = await _call_gemini_image(
            step_a_text, image_parts,
            role=None, style=None, user_id=owner_user_id,
            aspect_ratio="16:9",  # v29 — 16:9 통일 (씬 이미지)
        )
    else:
        # ALLOWED_IMAGE_MODELS 게이팅으로 도달 불가.
        raise ValueError("unsupported image_model: {}".format(image_model))

    elapsed_ms = int((time.time() - started) * 1000)
    logger.info(
        "[PreMVSceneImage] phase=phase2 ok pre_mv_job_id=%s scene_number=%d "
        "image_model=%s refs_count=%d prev_scene_used=%s elapsed_ms=%d bytes=%d",
        pre_mv_job_id, scene_number, image_model, refs_count,
        image_prev_scene_ref_used, elapsed_ms, len(image_bytes or b""),
    )
    return image_bytes
