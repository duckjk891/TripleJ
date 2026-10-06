"""
Character API routes — generate, save, retrieve, delete user's AI character sheet.
"""

import asyncio
import hashlib
import io
import json
import logging
import mimetypes
import os
import re
import uuid as uuid_lib
from datetime import datetime, timedelta
from typing import List, Optional

import jwt
from bson import ObjectId
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, Request, UploadFile
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from ..auth import JWT_ALGORITHM, JWT_SECRET, get_current_user
from ..config import settings
from ..database.minio import get_minio
from ..database.mongodb import get_mongo
from ..services.face_search_service import (
    BLOCKED_SOURCE_PHOTO_RESPONSE,
    is_blocked_source_photo,
)
from ..services.points_service import POINT_COSTS, refund_points, spend_points
from ..services.strike_service import check_generation_allowed
from ..services import kids_policy  # v3.232 F4 — 어린이 사진 입구 차단(킬 스위치 OFF 면 no-op)
from ..services.word_filter import word_filter_response  # v3.232 G1
from ..services.recognition import serialize_recognition  # v3.251 — 아티스트 인지도(RP·레벨)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/character", tags=["Character"])


async def _kids_cartoon_gate(user_id, has_photo_input: bool, user_text):
    """v3.232 F4+G1 — 그림체(가상) 시트: 어린이는 텍스트·프리셋·저장 시트만 허용, 얼굴 사진(file)·화풍 이미지
    (style_image) 업로드가 하나라도 있으면 403. 사용자 설명은 금칙어 검사. ⭐ 차감·잡 생성 전에 호출.
    킬 스위치·전체 적용 모두 OFF 면 DB 0회로 None."""
    if not kids_policy.kids_enabled() and not getattr(settings, "word_filter_all_users", False):
        return None
    child = await kids_policy.is_child_user(user_id)
    if child and has_photo_input:
        return kids_policy.child_restricted("character_photo", user_id)
    return await word_filter_response(user_id, [user_text], "character", child=child)

ALLOWED_IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp"}
MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10MB

# 캐릭터 시트 생성 비용 (실사/가상, 동기/비동기 공통). 요청 시 선차감,
# 생성 실패 시 환불. 잔액 부족이면 402 로 차단.
# StarEcon(v158) — 단가는 POINT_COSTS 단일 소스 (character: 2 → 10).
CHARACTER_POINT_COST = POINT_COSTS["character"]
INSUFFICIENT_POINTS_RESPONSE = {
    "error": "포인트가 부족합니다 (필요: {})".format(CHARACTER_POINT_COST)
}

# v55: image model enum — Nano Banana Pro (default) / GPT Image 2.
# (v217 이후 용도: refine 판별 재해석·save persist 검증용으로 존치)
ALLOWED_IMAGE_MODELS = {"nb_pro", "gpt_image_2"}

# ── v217 [ModelPin] — 시트 모델 백엔드 고정 (앱팀 확정 사양) ─────────────────
# 실사(generate-sheet 계열) = gpt_image_2 / 만화·가상화(cartoon 계열) = nb_pro.
# 수신 image_model 은 **무시**(에러 불발생 — 400 분기 소멸), 관측 로그만 남긴다.
REAL_SHEET_MODEL = "gpt_image_2"
CARTOON_SHEET_MODEL = "nb_pro"


def _forced_sheet_model(mode: str) -> str:
    """v217 — 시트 생성 모델 강제: mode 'cartoon' → nb_pro, 그 외(real) → gpt_image_2."""
    return CARTOON_SHEET_MODEL if mode == "cartoon" else REAL_SHEET_MODEL


def _normalize_image_model(raw: Optional[str]) -> Optional[str]:
    """Return validated image_model string, or None if input is invalid.

    Empty/whitespace/None → default ("nb_pro"). Any other unknown value → None
    so the route can return 400.
    """
    if raw is None:
        return "nb_pro"
    v = raw.strip()
    if not v:
        return "nb_pro"
    if v in ALLOWED_IMAGE_MODELS:
        return v
    return None


# ── Cartoon (가상화) art-style presets ──────────────────────────────────────
#
# 번들 샘플 화풍 reference 이미지 3종. 사용자가 직접 이미지를 업로드하지 않은 경우
# style_preset 으로 이 중 하나를 골라 reference 로 사용한다.
# 실제 저작권 안전 이미지는 infra/style_samples/ 에서 교체 (README 참고).
STYLE_PRESETS = {
    "webtoon": {"label": "웹툰", "art_style_label": "Korean webtoon style", "file": "webtoon.png"},
    "anime": {"label": "애니", "art_style_label": "Japanese anime style", "file": "anime.png"},
    "manga90": {"label": "90년대 만화", "art_style_label": "1990s retro manga style", "file": "manga90.png"},
}

# infra/style_samples/ — character.py 는 app/routes/ 이므로 두 단계 위가 9005 루트.
STYLE_SAMPLES_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "infra",
    "style_samples",
)

# 사용자 업로드 화풍일 때 art_style_label.
UPLOADED_STYLE_LABEL = "the art style of the attached style reference image"

# v223 — 가상 아티스트 꾸미기(use_saved_sheet) 화풍 복원용 역매핑.
# doc.art_style 에는 프리셋 키("webtoon"), 한글 라벨("웹툰"),
# 영문 라벨("Korean webtoon style") 중 무엇이 저장돼 있어도 프리셋으로 매핑한다.
# (참고: 화풍→모델 매핑은 존재한 적 없음 — v217 이후 cartoon 계열은 nb_pro 고정,
#  화풍은 style reference 이미지 + art_style_label 프롬프트로만 표현된다.)
_ART_STYLE_TO_PRESET_KEY = {}
for _k, _p in STYLE_PRESETS.items():
    _ART_STYLE_TO_PRESET_KEY[_k] = _k
    _ART_STYLE_TO_PRESET_KEY[_p["label"]] = _k
    _ART_STYLE_TO_PRESET_KEY[_p["art_style_label"].lower()] = _k


def _load_style_preset_bytes(key: str) -> Optional[bytes]:
    """Read a bundled style-sample PNG by preset key, or None if missing."""
    preset = STYLE_PRESETS.get(key)
    if not preset:
        return None
    path = os.path.join(STYLE_SAMPLES_DIR, preset["file"])
    try:
        with open(path, "rb") as f:
            return f.read()
    except Exception as e:
        logger.warning("_load_style_preset_bytes: read failed for %s: %s", key, e)
        return None

DEFAULT_PERSONALITY_TAGS = [
    "내향적", "외향적", "감성적", "이성적", "유머러스", "진지함",
    "쿨함", "따뜻함", "반항적", "순수함", "냉소적", "낙천적",
]

NAME_MAX_LEN = 50
AGE_MAX_LEN = 30
PERSONALITY_TEXT_MAX_LEN = 500
PERSONALITY_TAG_MAX_LEN = 20
PERSONALITY_TAGS_MAX_COUNT = 20
# v212 — 성별 자유 문자열 (enum 비강제, 빈값 허용)
GENDER_MAX_LEN = 20

# v212 — 아티스트 character_id 형식 (uuid4().hex — 32 lower hex)
CID_RE = re.compile(r"^[0-9a-f]{32}$")

# v213 — 아티스트↔목소리 연결 (PLAN V1)
# characters.persona_id = voice_clones 의 **clone_id** (Suno voice_id 아님 —
# 곡 생성 주입용 Suno id 는 응답의 파생 필드 persona_voice_id 로만 노출).
PERSONA_MODEL_WHITELIST = {"voice_persona", "style_persona"}
PERSONA_MODEL_DEFAULT = "voice_persona"
# v231 — 간편 목소리(프리셋) 저장 형식 "gender:style" (persona 와 상호 배타)
VOICE_PRESET_GENDERS = {"male", "female"}
VOICE_PRESET_STYLE_MAX = 30


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
    # Permanent original photo object name (uploaded via /upload-original-photo).
    original_photo_object_name: Optional[str] = None
    # v55: 마지막 사용한 이미지 생성 모델 (frontend 가 generate-sheet/refine 응답에서 받은 값을 그대로 전송).
    image_model: Optional[str] = None
    # 가상화(그림/만화 화풍) 저장 분리: 'real'(기본, 실사 슬롯) | 'virtual'(가상화 슬롯).
    # virtual 이면 sheet_virtual.png 로 저장하고 virtual_* 필드만 갱신(실사 슬롯 무손상).
    variant: Optional[str] = None
    # virtual 저장 시 사용된 화풍 라벨(예: "Korean webtoon style"). real 이면 무시.
    art_style: Optional[str] = None
    # ── v212 아티스트 다중화 (PLAN D4 save 3-경로) ──────────────────────────
    # ① character_id 지정: 해당 아티스트 시트 교체 + 프로필 전송분 갱신
    # ② character_id 미지정 + kind 지정: 신규 아티스트 (슬롯 검사, 초과 409)
    # ③ 둘 다 미지정: legacy 경로 (variant 정규화, 슬롯 검사 면제 — 구계약 보존)
    character_id: Optional[str] = None
    kind: Optional[str] = None       # 'real' | 'virtual'
    gender: Optional[str] = None     # 자유 문자열 ≤20자, 빈값 허용
    # ── v213 아티스트↔목소리 연결 (①cid·②kind 경로만 — ③legacy 미수용) ─────
    # persona_id = voice_clones 의 clone_id. None=유지 / ""=해제 / 값=연결(ready 검증)
    persona_id: Optional[str] = None
    persona_model: Optional[str] = None  # 'voice_persona'(기본) | 'style_persona'


# ── v212 아티스트 다중화 헬퍼 ────────────────────────────────────────────────


def _persona_fields(doc: dict, clone: Optional[dict]) -> dict:
    """v213 — 저장 2필드 + 파생 3필드 (additive). dangling → persona_status 'missing'.

    persona_voice_id 가 /generate 주입용 Suno id — persona_id(clone_id)와 구분.
    읽기 경로 무쓰기 — dangling 이어도 lazy cleanup 하지 않는다.

    planner 확정 계약: **5키 생략 금지·항상 존재.**
      미연결: persona_id ""·persona_model ""·persona_name ""(v212 문자열 관행)
              ·persona_voice_id null·persona_status null
      dangling: persona_id/persona_model 잔존값·persona_name ""·voice_id null·status 'missing'
      연결: 클론 실값 + status 그대로.
    """
    pid = doc.get("persona_id") or None
    if not pid:
        return {
            "persona_id": "",
            "persona_model": "",
            "persona_name": "",
            "persona_voice_id": None,
            "persona_status": None,
        }
    if not clone:
        return {
            "persona_id": pid,
            "persona_model": doc.get("persona_model") or PERSONA_MODEL_DEFAULT,
            "persona_name": "",
            "persona_voice_id": None,
            "persona_status": "missing",
        }
    return {
        "persona_id": pid,
        "persona_model": doc.get("persona_model") or PERSONA_MODEL_DEFAULT,
        "persona_name": clone.get("voice_name") or "",
        "persona_voice_id": clone.get("voice_id") or None,
        "persona_status": clone.get("status") or "missing",
    }


async def _resolve_persona_clone(mongo, doc: dict) -> Optional[dict]:
    """v213 — 단건 경로용 clone resolve (persona_id 없거나 무효/실종 시 None)."""
    pid = doc.get("persona_id")
    if not pid:
        return None
    try:
        oid = ObjectId(pid)
    except Exception:
        return None
    return await mongo.voice_clones.find_one(
        {"_id": oid},
        {"voice_name": 1, "voice_id": 1, "status": 1},
    )


async def _validate_persona_link(mongo, user_id: str, persona_id_raw, persona_model_raw,
                                 currently_linked: bool):
    """v213 — persona 연결/해제 판정 공용 헬퍼 (PATCH · save ①② 경로).

    규약: None=유지 / ""=해제 / 값=연결 (본인 소유 + status ready 검증).
    persona_model 단독 전송: 기연결 시 갱신, 미연결 시 400.

    Returns (error_response|None, action, fields)
      action ∈ {'none', 'unset', 'set'} — 'set' 은 fields 를 $set.
    """
    pid = persona_id_raw
    pmodel = persona_model_raw

    if pid is None and pmodel is None:
        return None, "none", {}

    # 해제 — persona_id 빈 문자열 (persona_model 은 동시 unset)
    if pid is not None and not str(pid).strip():
        return None, "unset", {}

    # persona_model 정규화 (전송 시)
    model_val = None
    if pmodel is not None:
        model_val = (pmodel or "").strip().lower()
        if model_val not in PERSONA_MODEL_WHITELIST:
            return JSONResponse(
                status_code=400,
                content={"error": "persona_model 은 'voice_persona' 또는 'style_persona' 여야 합니다."},
            ), None, None

    if pid is None:
        # model 단독 — 기연결 시 갱신, 미연결 시 400
        if not currently_linked:
            return JSONResponse(
                status_code=400,
                content={"error": "먼저 목소리를 연결해주세요."},
            ), None, None
        return None, "set", {"persona_model": model_val}

    # 연결 — 본인 소유 + ready 검증
    pid_str = str(pid).strip()
    try:
        oid = ObjectId(pid_str)
    except Exception:
        logger.warning("[VoiceLink] invalid persona_id user=%s pid=%s", user_id[:8], pid_str[:36])
        return JSONResponse(
            status_code=400,
            content={"error": "연결할 목소리를 찾을 수 없습니다."},
        ), None, None
    clone = await mongo.voice_clones.find_one({"_id": oid, "user_id": user_id}, {"status": 1})
    if not clone:
        logger.warning("[VoiceLink] clone not found/owned user=%s clone=%s", user_id[:8], pid_str)
        return JSONResponse(
            status_code=400,
            content={"error": "연결할 목소리를 찾을 수 없습니다."},
        ), None, None
    if clone.get("status") != "ready":
        logger.warning(
            "[VoiceLink] clone not ready user=%s clone=%s status=%s",
            user_id[:8], pid_str, clone.get("status"),
        )
        return JSONResponse(
            status_code=400,
            content={"error": "준비된 목소리만 연결할 수 있습니다."},
        ), None, None
    return None, "set", {
        "persona_id": pid_str,
        "persona_model": model_val or PERSONA_MODEL_DEFAULT,
    }


def _serialize_artist(doc: dict, persona_clone: Optional[dict] = None) -> dict:
    """cid 보유 아티스트 doc → /list·단건 응답용 직렬화.

    v213: persona 저장 2필드+파생 3필드 동봉 — persona_id 보유 doc 은 호출측이
    resolve 한 persona_clone 을 넘겨야 status 가 정확하다 (미전달 시 'missing').
    """
    sheet = doc.get("sheet_object_name") or ""
    return {
        **_persona_fields(doc, persona_clone),
        # v231 — 간편 목소리 프리셋 ("male:소프트" | "") — persona 와 상호 배타
        "voice_preset": doc.get("voice_preset") or "",
        # v3.251 — 아티스트 인지도 (부재 시 연습생 5 기본, 레벨은 rp 재계산 자가 치유)
        "recognition": serialize_recognition(doc.get("recognition")),
        "character_id": doc.get("character_id"),
        "kind": doc.get("kind") or "real",
        "is_default": bool(doc.get("is_default")),
        "name": doc.get("name") or "",
        "age": doc.get("age") or "",
        "gender": doc.get("gender") or "",
        "personality_tags": doc.get("personality_tags") or [],
        "personality_text": doc.get("personality_text") or "",
        "sheet_object_name": sheet,
        "sheet_url": "/api/character/preview/{}".format(sheet) if sheet else None,
        "art_style": doc.get("art_style") or "",
        "used_items": doc.get("used_items") or [],
        # v222: 앱 아티스트 상세의 "만들 때 사용한 사진" 표시용 — 기존 직렬화 누락 보완
        "original_photo_object_name": doc.get("original_photo_object_name") or None,
        "image_model": doc.get("image_model") or "nb_pro",
        "created_at": doc.get("created_at").isoformat() if doc.get("created_at") else None,
        "updated_at": doc.get("updated_at").isoformat() if doc.get("updated_at") else None,
    }


def _normalize_legacy_real(doc: dict) -> Optional[dict]:
    """legacy(무cid) doc 의 real 슬롯 → 정규화 뷰 (시트 없으면 None)."""
    if not doc.get("sheet_object_name"):
        return None
    return {
        "character_id": None,
        "kind": "real",
        "is_default": True,
        "sheet_object_name": doc.get("sheet_object_name"),
        "used_items": doc.get("used_items") or [],
        "name": doc.get("name") or "",
        "age": doc.get("age") or "",
        "gender": doc.get("gender") or "",
        "personality_tags": doc.get("personality_tags") or [],
        "personality_text": doc.get("personality_text") or "",
        "art_style": "",
        "original_photo_object_name": doc.get("original_photo_object_name") or "",
        "image_model": doc.get("image_model") or "nb_pro",
        "_doc": doc,
    }


def _normalize_legacy_virtual(doc: dict) -> Optional[dict]:
    """legacy(무cid) doc 의 virtual 슬롯 → 정규화 뷰 (시트 없으면 None)."""
    if not doc.get("virtual_sheet_object_name"):
        return None
    return {
        "character_id": None,
        "kind": "virtual",
        "is_default": False,
        "sheet_object_name": doc.get("virtual_sheet_object_name"),
        "used_items": doc.get("virtual_used_items") or [],
        "name": doc.get("name") or "",
        "age": doc.get("age") or "",
        "gender": doc.get("gender") or "",
        "personality_tags": doc.get("personality_tags") or [],
        "personality_text": doc.get("personality_text") or "",
        "art_style": doc.get("virtual_art_style") or "",
        "original_photo_object_name": doc.get("original_photo_object_name") or "",
        "image_model": doc.get("image_model") or "nb_pro",
        "_doc": doc,
    }


def _normalize_cid_artist(doc: dict) -> dict:
    """cid 보유 doc → 정규화 뷰 (kind 무관 동일 키)."""
    return {
        "character_id": doc.get("character_id"),
        "kind": doc.get("kind") or "real",
        "is_default": bool(doc.get("is_default")),
        "sheet_object_name": doc.get("sheet_object_name") or "",
        "used_items": doc.get("used_items") or [],
        "name": doc.get("name") or "",
        "age": doc.get("age") or "",
        "gender": doc.get("gender") or "",
        "personality_tags": doc.get("personality_tags") or [],
        "personality_text": doc.get("personality_text") or "",
        "art_style": doc.get("art_style") or "",
        "original_photo_object_name": doc.get("original_photo_object_name") or "",
        "image_model": doc.get("image_model") or "nb_pro",
        "_doc": doc,
    }


async def resolve_representative_artists(mongo, user_id: str) -> dict:
    """v212 공용 해석 (PLAN D4) — me/mv/albums/legacy-save 공유.

    Returns {"real": 정규화뷰|None, "virtual": 정규화뷰|None}
    - real 대표: is_default(kind=real) 우선 → kind=real 최신 → legacy real 슬롯
    - virtual 대표: is_default(kind=virtual) 우선 → kind=virtual 최신 → legacy virtual 슬롯
    """
    docs = await mongo.characters.find({"user_id": user_id}).sort("updated_at", -1).to_list(length=None)
    cid_docs = [d for d in docs if d.get("character_id")]
    legacy_docs = [d for d in docs if not d.get("character_id")]

    def _pick(kind: str):
        of_kind = [d for d in cid_docs if (d.get("kind") or "real") == kind]
        for d in of_kind:
            if d.get("is_default"):
                return _normalize_cid_artist(d)
        if of_kind:
            return _normalize_cid_artist(of_kind[0])  # updated_at 최신 (sort 기승계)
        for d in legacy_docs:
            norm = _normalize_legacy_real(d) if kind == "real" else _normalize_legacy_virtual(d)
            if norm:
                return norm
        return None

    return {"real": _pick("real"), "virtual": _pick("virtual")}


async def _find_artist_by_cid(mongo, user_id: str, character_id: str) -> Optional[dict]:
    """(user_id, character_id) 아티스트 doc — 형식 불일치/부재/타인은 None (호출측 404)."""
    cid = (character_id or "").strip().lower()
    if not CID_RE.match(cid):
        return None
    return await mongo.characters.find_one({"user_id": user_id, "character_id": cid})


async def _sync_artist_name_if_changed(mongo, user_id: str, character_id: str, old_name, new_name, source: str):
    """v3.229 N2 — 이름이 실제로 바뀐 경우에만 곡 표기 일괄 갱신(artist_name_sync).

    앱은 편집 저장 때 name 을 항상 보내므로 같은 이름이면 건너뛴다(불필요한 재색인 방지).
    실패해도 개명 자체는 성공이다 — 경고 로그만(복구 경로 = 소급 스크립트, 멱등).
    """
    if (old_name or "").strip() == (new_name or "").strip():
        return None
    try:
        from ..services.artist_name_sync import sync_artist_name

        return await sync_artist_name(mongo, user_id, character_id, new_name, source=source)
    except Exception as e:
        logger.warning(
            "[ArtistNameSync] propagate failed source=%s user=%s cid=%s: %s",
            source, (user_id or "")[:8], (character_id or "")[:8], e,
        )
        return None


async def _artist_fatigue_gate(user_id: str):
    """v220 — 아티스트 디렉터 피로 게이트 (generate-sheet* 4종 공용, 슬롯/⭐ 전).

    활성 쿨다운이면 429 {"error":"director_fatigue","director":"artist",...},
    아니면 None. 완성 훅은 시트 생성 성공 시점(sync 반환 직전 / async 잡 done).
    """
    from .fatigue import fatigue_gate_response

    return await fatigue_gate_response(user_id, director="artist")


async def _gate_artist_generation(user_id: str, character_id: Optional[str], expected_kind: str):
    """v212 generate 4종 공용 게이트 (⭐차감 전 — job 미생성 단계에서 호출).

    Returns (error_response|None, normalized_cid|None)
    - character_id 지정: 부재/타인/형식 불일치 404, kind 불일치 400, 통과 시 재생성(슬롯 무검사)
    - 미지정: 슬롯 검사 — used >= max → 409 slot_limit_exceeded
    """
    mongo = get_mongo()
    if character_id and character_id.strip():
        doc = await _find_artist_by_cid(mongo, user_id, character_id)
        if not doc:
            logger.warning("[ArtistV212] generate cid not found user=%s cid=%s", user_id[:8], character_id[:36])
            return JSONResponse(status_code=404, content={"error": "아티스트를 찾을 수 없습니다."}), None
        if (doc.get("kind") or "real") != expected_kind:
            logger.warning(
                "[ArtistV212] generate kind mismatch user=%s cid=%s doc_kind=%s expected=%s",
                user_id[:8], doc["character_id"], doc.get("kind"), expected_kind,
            )
            return JSONResponse(
                status_code=400,
                content={"error": "아티스트 종류가 일치하지 않습니다. (재생성은 동일 종류 API 로만 가능합니다)"},
            ), None
        return None, doc["character_id"]

    # 미지정 신규 — 슬롯 검사는 단일 관문(check_slot_available) 경유 (save ②형과 동일 409)
    from ..services.slots_service import check_slot_available

    err = await check_slot_available(user_id)
    if err is not None:
        return err, None
    return None, None


def _copy_sheet_to_permanent(minio_client, src_object: str, permanent_object: str) -> None:
    """temp 시트 → 영구 경로 복사 (기존 save 인라인 로직 추출 — 동작 동일)."""
    try:
        from minio.commonconfig import CopySource

        minio_client.copy_object(
            bucket_name=settings.minio_bucket_images,
            object_name=permanent_object,
            source=CopySource(
                bucket_name=settings.minio_bucket_images,
                object_name=src_object,
            ),
        )
    except Exception as e:
        logger.warning("MinIO copy failed, fallback to download+upload: %s", e)
        # Fallback: download and re-upload
        resp = minio_client.get_object(
            bucket_name=settings.minio_bucket_images,
            object_name=src_object,
        )
        data = resp.read()
        resp.close()
        resp.release_conn()
        minio_client.put_object(
            bucket_name=settings.minio_bucket_images,
            object_name=permanent_object,
            data=io.BytesIO(data),
            length=len(data),
            content_type="image/png",
        )


# ── GET /api/character/personality-tags ─────────────────────────────────────


@router.get("/personality-tags")
async def get_personality_tags():
    """Return curated default personality tag list for character setup UI."""
    return {"tags": DEFAULT_PERSONALITY_TAGS}


# ── POST /api/character/upload-original-photo ──────────────────────────────
#
# Separate endpoint for uploading the user's original face photo to a
# *permanent* MinIO location. The /generate-sheet endpoint only writes to
# a /temp/... path that is never linked back to the saved character
# document, so a permanent path is required for re-use across sheet
# regenerations.


@router.post("/upload-original-photo")
async def upload_original_photo(
    file: UploadFile = File(...),
    current_user=Depends(get_current_user),
):
    """Upload original face photo. Saves to MinIO at a permanent path
    (`characters/{user_id}/original.{ext}`) and upserts
    `characters.original_photo_object_name`.
    """
    # v3.232 F4 — 어린이 얼굴 원본 사진 업로드 차단(파일 읽기 전). OFF 면 DB 0회.
    _kids_block = await kids_policy.kids_guard(current_user["id"], "character_photo")
    if _kids_block is not None:
        return _kids_block
    # Validate ext
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_IMAGE_EXT:
        return JSONResponse(
            status_code=400,
            content={"error": "허용되지 않는 이미지 형식입니다. (jpg, png, webp)"},
        )

    # Validate size
    contents = await file.read()
    if len(contents) == 0:
        return JSONResponse(
            status_code=400,
            content={"error": "이미지 파일이 비어 있습니다."},
        )
    if len(contents) > MAX_IMAGE_SIZE:
        return JSONResponse(
            status_code=400,
            content={"error": "이미지 크기는 10MB 이하여야 합니다."},
        )

    mime_type = mimetypes.guess_type(file.filename or "")[0] or "image/jpeg"
    user_id = current_user["id"]

    # Permanent path. Extension is preserved from the upload so downstream
    # consumers can sniff content correctly.
    # v229 (B-13): 업로드마다 고유 파일명 — 기존 고정 경로(original.{ext})는
    # 아티스트가 여러 명일 때 서로의 원본 사진을 덮어썼다. 문서 연결은
    # /save 의 original_photo_object_name 전송으로만 이뤄진다 (cid 단위 영속).
    object_name = "characters/{}/original_{}{}".format(
        user_id, uuid_lib.uuid4().hex[:8], ext
    )

    minio_client = get_minio()
    try:
        minio_client.put_object(
            bucket_name=settings.minio_bucket_images,
            object_name=object_name,
            data=io.BytesIO(contents),
            length=len(contents),
            content_type=mime_type,
        )
    except Exception as e:
        logger.warning("upload_original_photo: MinIO put failed: %s", e)
        return JSONResponse(
            status_code=500,
            content={"error": "이미지 업로드에 실패했습니다."},
        )

    # v229 (B-13): characters 무cid upsert 제거 — 다중 아티스트(v212) 체제에서
    # {"user_id"} 매칭 업서트는 ① cid 없는 유령 문서를 계속 생성하고
    # ② 임의 아티스트 문서를 잘못 갱신할 수 있었다(2026-08-31 실측).
    # 문서 연결은 FE 가 /save 에 original_photo_object_name 을 보내는 경로가
    # 유일한 정본이다. 여기서는 스토리지 업로드만 수행한다.
    logger.info(
        "[character] original photo uploaded (no doc upsert — v229 B-13) user=%s obj=%s bytes=%d",
        user_id[:8], object_name, len(contents),
    )

    return {
        "object_name": object_name,
        "message": "원본 사진이 업로드되었습니다.",
    }


# ── POST /api/character/generate-sheet ──────────────────────────────────────


async def _read_optional_image(upload: Optional[UploadFile]) -> tuple:
    """Read an optional UploadFile and return (bytes, mime_type) or (None, None)."""
    if upload is None or upload.filename is None or upload.filename == "":
        return None, None
    ext = os.path.splitext(upload.filename)[1].lower()
    if ext not in ALLOWED_IMAGE_EXT:
        return None, None
    data = await upload.read()
    if len(data) > MAX_IMAGE_SIZE or len(data) == 0:
        return None, None
    mime = mimetypes.guess_type(upload.filename)[0] or "image/jpeg"
    return data, mime


def _load_item_image(object_name: Optional[str]) -> tuple:
    """Load an ad-product item image from MinIO by object_name.

    Used to wire the user's *selected* outfit/footwear product (top/bottom/shoes)
    — stored at `image_object_name` in the images bucket — into character sheet
    generation so the chosen item is actually worn.

    Returns (bytes, mime_type) on success, or (None, None) on any failure
    (missing key, MinIO error, empty/oversized object) — never raises, so the
    request keeps going with that item simply un-referenced.
    """
    name = (object_name or "").strip()
    if not name:
        return None, None
    try:
        minio_client = get_minio()
        resp = minio_client.get_object(
            bucket_name=settings.minio_bucket_images,
            object_name=name,
        )
        data = resp.read()
        content_type = None
        try:
            content_type = (resp.headers or {}).get("Content-Type")
        except Exception:
            content_type = None
        resp.close()
        resp.release_conn()
    except Exception as e:
        logger.warning("_load_item_image: MinIO read failed for %s: %s", name[:80], e)
        return None, None
    if not data or len(data) == 0 or len(data) > MAX_IMAGE_SIZE:
        logger.warning("_load_item_image: invalid size for %s (%d bytes)", name[:80], len(data or b""))
        return None, None
    mime = content_type or mimetypes.guess_type(name)[0] or "image/jpeg"
    return data, mime


async def _resolve_item_image(
    object_name: Optional[str],
    upload: Optional[UploadFile],
) -> tuple:
    """Resolve an outfit item image: ad-product object_name takes priority,
    then a direct UploadFile. Returns (bytes, mime, source) where source is
    "object_name" | "upload" | None."""
    name = (object_name or "").strip()
    if name:
        data, mime = _load_item_image(name)
        if data:
            return data, mime, "object_name"
    data, mime = await _read_optional_image(upload)
    if data:
        return data, mime, "upload"
    return None, None, None


def _store_temp_sheet(
    user_id: str,
    contents: Optional[bytes],
    mime_type: Optional[str],
    ext: str,
    sheet_bytes: bytes,
) -> dict:
    """Persist the original photo + generated sheet to MinIO temp paths.

    Shared by the sync generate-sheet(-cartoon) handlers and the async job
    runner. Paths mirror the original inline logic exactly:
      - characters/temp/{user_id}/original_{hex8}{ext}
      - characters/temp/{user_id}/{hex32}.png
    v161 — 텍스트-only 경로(contents=None)에서는 원본 사진 업로드를 건너뛰고
    original_object_name=None 을 반환한다 (사진 경로는 기존과 동일).
    Raises on MinIO failure (callers decide how to surface the error).
    Returns {object_name, original_object_name, preview_url}.
    """
    minio_client = get_minio()

    original_object = None
    if contents is not None:
        original_object = "characters/temp/{}/original_{}{}".format(
            user_id, uuid_lib.uuid4().hex[:8], ext
        )
        minio_client.put_object(
            bucket_name=settings.minio_bucket_images,
            object_name=original_object,
            data=io.BytesIO(contents),
            length=len(contents),
            content_type=mime_type or "image/jpeg",
        )

    sheet_object = "characters/temp/{}/{}.png".format(user_id, uuid_lib.uuid4().hex)
    minio_client.put_object(
        bucket_name=settings.minio_bucket_images,
        object_name=sheet_object,
        data=io.BytesIO(sheet_bytes),
        length=len(sheet_bytes),
        content_type="image/png",
    )

    return {
        "object_name": sheet_object,
        "original_object_name": original_object,
        "preview_url": "/api/character/preview/{}".format(sheet_object),
    }


@router.post("/generate-sheet")
async def generate_sheet(
    file: Optional[UploadFile] = File(None),
    top_image: Optional[UploadFile] = File(None),
    bottom_image: Optional[UploadFile] = File(None),
    shoes_image: Optional[UploadFile] = File(None),
    top_object_name: Optional[str] = Form(None),
    bottom_object_name: Optional[str] = Form(None),
    shoes_object_name: Optional[str] = Form(None),
    user_text: str = Form(""),
    image_model: str = Form("nb_pro"),
    portrait_confirmed: Optional[str] = Form(None),  # v137 — FE 확약 체크 전달(로그용, 미전달 허용)
    character_id: Optional[str] = Form(None),  # v212 — 지정=재생성, 미지정=신규(슬롯 검사)
    # v3.227 (H-1) — 파일 없이 서버에 남은 본인 원본(characters/[temp/]{uid}/original_*)을
    # 얼굴 사진으로 재사용. 소유권 검증(타인 403), 얼굴 인증 게이트는 같은 바이트로 그대로 수행.
    original_object_name: Optional[str] = Form(None),
    current_user=Depends(get_current_user),
):
    """Upload a reference photo and generate a photorealistic character sheet.

    Outfit items can be supplied two ways (object_name takes priority over upload):
      - `*_object_name`: MinIO object_name of a selected ad-product item image
        (the `image_object_name` from the product), loaded from the images bucket.
      - `*_image`: a direct UploadFile.
    Each resolved item overrides the corresponding outfit section in the prompt.
    """
    # v3.232 F4 — 어린이 실사(얼굴 사진) 시트 차단 — 피로 게이트·⭐ 차감 전. OFF 면 DB 0회.
    _kids_block = await kids_policy.kids_guard(current_user["id"], "character_photo")
    if _kids_block is not None:
        return _kids_block
    # v137 — 확약 체크 수신 기록 (값 강제 없음 — 앱팀 9004 하위호환)
    logger.info("[character] portrait_confirmed=%s user=%s", portrait_confirmed, str(current_user["id"])[:8])
    # v217 [ModelPin] — 실사 시트 = gpt_image_2 백엔드 고정. 수신 image_model 은
    # 무시(에러 불발생 — v55 400 분기 소멸). 키 가드는 고정 모델(openai) 것만.
    norm_image_model = _forced_sheet_model("real")
    _recv_model = (image_model or "").strip()
    if _recv_model and _recv_model != norm_image_model:
        logger.info(
            "[ModelPin] ignored client value mode=real recv=%s forced=%s user=%s",
            _recv_model[:24], norm_image_model, str(current_user["id"])[:8],
        )
    if not settings.openai_api_key:
        return JSONResponse(
            status_code=503,
            content={"error": "OpenAI API 키가 설정되지 않았습니다."},
        )

    # v220 — 아티스트 디렉터 피로 게이트 (슬롯/⭐ 검사 **전** — 429 무과금).
    _fatigued = await _artist_fatigue_gate(current_user["id"])
    if _fatigued is not None:
        return _fatigued

    # v3.227 — 진행 중 job 이 있으면 과금 전 409 generation_in_progress (stale 은 먼저 lazy 정리).
    _dup = await _generation_in_progress_gate(current_user["id"], "generate-sheet")
    if _dup is not None:
        return _dup

    # v212 — 아티스트 게이트 (image_model 검증 직후·payload 검증 이전 최선두, ⭐차감 전):
    # cid 지정=재생성(404/400), 미지정=슬롯 409 (만석이면 payload 무효여도 409 선행).
    _gate_err, norm_cid = await _gate_artist_generation(current_user["id"], character_id, "real")
    if _gate_err is not None:
        return _gate_err

    # v161 — 텍스트-only 경로: 사진(file)과 외모 설명(user_text) 중 하나는 필수.
    user_text_clean = (user_text or "").strip()
    has_photo = file is not None and bool(file.filename)
    # v3.227 (H-1) — 원본 재사용: 파일이 없고 original_object_name 이 오면 서버 원본을 사진으로.
    reused_bytes = None
    reused_ext = ""
    reused_mime = None
    if not has_photo and (original_object_name or "").strip():
        _r_err, reused_bytes, reused_ext, reused_mime = _load_owned_original(
            current_user["id"], original_object_name
        )
        if _r_err is not None:
            return _r_err
        has_photo = True
    if not has_photo and len(user_text_clean) < 2:
        return JSONResponse(
            status_code=400,
            content={"error": "얼굴 사진 또는 외모 설명 중 하나는 필요합니다."},
        )

    # Validate file (사진 첨부 시에만 — 텍스트-only 는 contents=None 로 진행)
    contents = None
    ext = ""
    mime_type = None
    if reused_bytes is not None:
        contents = reused_bytes
        ext = reused_ext
    elif has_photo:
        ext = os.path.splitext(file.filename or "")[1].lower()
        if ext not in ALLOWED_IMAGE_EXT:
            return JSONResponse(
                status_code=400,
                content={"error": "허용되지 않는 이미지 형식입니다. (jpg, png, webp)"},
            )

        contents = await file.read()
        if len(contents) > MAX_IMAGE_SIZE:
            return JSONResponse(
                status_code=400,
                content={"error": "이미지 크기는 10MB 이하여야 합니다."},
            )

    # TrustSquad(v138) — 신고 확정 도용 원본 사진 재사용 차단 (포인트 차감 전).
    # v161 — 사진 SHA 기반 게이트이므로 사진 첨부 시에만 검사 (텍스트-only 자연 스킵).
    if contents is not None:
        if await is_blocked_source_photo(contents, current_user["id"]):
            return JSONResponse(status_code=403, content=dict(BLOCKED_SOURCE_PHOTO_RESPONSE))

    # TrustSquad(v139) — 스트라이크 생성 제한 게이트 (포인트 차감 전 403)
    # 사용자 단위 게이트 — 텍스트-only 경로에도 동일 적용.
    denied = await check_generation_allowed(None, current_user["id"])
    if denied:
        return denied

    if reused_bytes is not None:
        mime_type = reused_mime or "image/jpeg"
    elif has_photo:
        mime_type = mimetypes.guess_type(file.filename or "")[0] or "image/jpeg"

    # Resolve outfit items: ad-product object_name takes priority over upload.
    top_bytes, top_mime, top_src = await _resolve_item_image(top_object_name, top_image)
    bottom_bytes, bottom_mime, bottom_src = await _resolve_item_image(bottom_object_name, bottom_image)
    shoes_bytes, shoes_mime, shoes_src = await _resolve_item_image(shoes_object_name, shoes_image)

    # v41: LoRA system removed — sheet generation is Nano Banana only.
    user_id = current_user["id"]

    # FaceGuardSquad(v135) — 실사화 경로 얼굴 인증 게이트 (flag ON + 사진 첨부 시,
    # photo SHA256 가 face_photo_verifications 에 없으면 403). cartoon·flag OFF 불변.
    # v161 — 사진 SHA 기반 게이트이므로 사진 첨부 시에만 검사 (텍스트-only 자연 스킵).
    if settings.face_verify_enabled and contents is not None:
        from ..services.face_verify_service import is_photo_verified

        if not await is_photo_verified(user_id, contents):
            return JSONResponse(
                status_code=403,
                content={"error": "face_verification_required", "message": "얼굴 인증이 필요합니다."},
            )

    # Points — 검증 통과 후 생성 시작 전 2포인트 선차감 (부족 시 402 차단).
    point_ref = uuid_lib.uuid4().hex
    if not await spend_points(user_id, "character", CHARACTER_POINT_COST, point_ref):
        return JSONResponse(status_code=402, content=dict(INSUFFICIENT_POINTS_RESPONSE))

    try:
        from ..services.character_generator import generate_character_sheet

        source = "photo+text" if (has_photo and user_text_clean) else ("photo" if has_photo else "text")
        logger.info(
            "[character.gen] mode=real source=%s image_model=%s user=%s items=top:%s/bottom:%s/shoes:%s",
            source, norm_image_model, user_id, top_src, bottom_src, shoes_src,
        )
        sheet_bytes = await generate_character_sheet(
            photo_bytes=contents,
            mime_type=mime_type or "image/jpeg",
            top_bytes=top_bytes,
            top_mime=top_mime,
            bottom_bytes=bottom_bytes,
            bottom_mime=bottom_mime,
            shoes_bytes=shoes_bytes,
            shoes_mime=shoes_mime,
            user_text=user_text.strip(),
            image_model=norm_image_model,
        )
    except Exception as e:
        # Points — 생성 실패 시 선차감분 환불.
        await refund_points(user_id, "character", CHARACTER_POINT_COST, point_ref)
        return JSONResponse(
            status_code=500,
            content={"error": "캐릭터 시트 생성 실패: {}".format(str(e)[:200])},
        )

    # Save original photo + generated sheet to MinIO temp paths (the *permanent*
    # original is uploaded separately via /upload-original-photo).
    try:
        stored = _store_temp_sheet(user_id, contents, mime_type, ext, sheet_bytes)
    except Exception:
        # Points — MinIO 저장 실패도 사용자에게는 생성 실패 → 환불 후 기존 500 동작 유지.
        await refund_points(user_id, "character", CHARACTER_POINT_COST, point_ref)
        raise

    # v220 — 아티스트 완성 훅: artist 카운트 +1 + 사다리 쿨다운 시작 (재생성 포함,
    # best-effort — on_generation_completed 는 절대 raise 하지 않음)
    from ..services.fatigue_service import on_generation_completed
    await on_generation_completed(user_id, director="artist")

    return {
        "object_name": stored["object_name"],
        "original_object_name": stored["original_object_name"],
        "preview_url": stored["preview_url"],
        "image_model": norm_image_model,  # v55 — echo back so client can persist
        "character_id": norm_cid,  # v212 — 재생성 대상 echo (미지정 신규는 None)
        "message": "캐릭터 시트가 생성되었습니다.",
    }


# ── GET /api/character/style-samples ────────────────────────────────────────


@router.get("/style-samples")
async def list_style_samples():
    """Return the 3 bundled cartoon art-style presets for the 가상화 UI."""
    return {
        "samples": [
            {
                "key": key,
                "label": preset["label"],
                "art_style": preset["art_style_label"],
                "preview_url": "/api/character/style-sample/{}".format(key),
            }
            for key, preset in STYLE_PRESETS.items()
        ]
    }


# ── GET /api/character/style-sample/{key} ───────────────────────────────────


@router.get("/style-sample/{key}")
async def get_style_sample(key: str):
    """Serve a bundled style-sample PNG by preset key."""
    data = _load_style_preset_bytes(key)
    if data is None:
        return JSONResponse(
            status_code=404,
            content={"error": "화풍 샘플을 찾을 수 없습니다."},
        )
    return Response(content=data, media_type="image/png")


# ── POST /api/character/generate-sheet-cartoon ──────────────────────────────


@router.post("/generate-sheet-cartoon")
async def generate_sheet_cartoon(
    file: Optional[UploadFile] = File(None),
    top_image: Optional[UploadFile] = File(None),
    bottom_image: Optional[UploadFile] = File(None),
    shoes_image: Optional[UploadFile] = File(None),
    top_object_name: Optional[str] = Form(None),
    bottom_object_name: Optional[str] = Form(None),
    shoes_object_name: Optional[str] = Form(None),
    user_text: str = Form(""),
    image_model: str = Form("nb_pro"),
    portrait_confirmed: Optional[str] = Form(None),  # v137 — FE 확약 체크 전달(로그용, 미전달 허용)
    style_preset: str = Form(""),
    style_image: Optional[UploadFile] = File(None),
    character_id: Optional[str] = Form(None),  # v212 — 지정=재생성, 미지정=신규(슬롯 검사)
    current_user=Depends(get_current_user),
):
    """Generate a CARTOON / illustration-style character sheet (가상화).

    Style reference resolution:
      - If `style_image` is uploaded → use its bytes (art_style = uploaded label).
      - Else if `style_preset` in {webtoon, anime, manga90} → load bundled sample.
      - Else → 400.
    Outfit items resolve like /generate-sheet (`*_object_name` ad-product image
    takes priority over `*_image` upload) and are converted into the chosen style.
    """
    # v3.232 F4+G1 — 어린이: 사진·화풍 이미지 업로드 거부, 설명 금칙어(피로 게이트·⭐ 차감 전)
    _kids_block = await _kids_cartoon_gate(current_user["id"], file is not None or style_image is not None, user_text)
    if _kids_block is not None:
        return _kids_block
    logger.info("[character] portrait_confirmed=%s user=%s", portrait_confirmed, str(current_user["id"])[:8])
    user_id = current_user["id"]

    # v217 [ModelPin] — 만화(가상화) 시트 = nb_pro 백엔드 고정. 수신 image_model
    # 무시(에러 불발생 — 400 분기 소멸). 키 가드는 고정 모델(google) 것만.
    norm_image_model = _forced_sheet_model("cartoon")
    _recv_model = (image_model or "").strip()
    if _recv_model and _recv_model != norm_image_model:
        logger.info(
            "[ModelPin] ignored client value mode=cartoon recv=%s forced=%s user=%s",
            _recv_model[:24], norm_image_model, str(current_user["id"])[:8],
        )
    if not settings.google_api_key:
        return JSONResponse(
            status_code=503,
            content={"error": "Google API 키가 설정되지 않았습니다."},
        )

    # v220 — 아티스트 디렉터 피로 게이트 (슬롯/⭐ 검사 **전** — 429 무과금).
    _fatigued = await _artist_fatigue_gate(current_user["id"])
    if _fatigued is not None:
        return _fatigued

    # v3.227 — 진행 중 job 이 있으면 과금 전 409 generation_in_progress (stale 은 먼저 lazy 정리).
    _dup = await _generation_in_progress_gate(current_user["id"], "generate-sheet-cartoon")
    if _dup is not None:
        return _dup

    # v212 — 아티스트 게이트 (image_model 검증 직후·payload 검증 이전 최선두, ⭐차감 전):
    # cid 지정=재생성(404/400), 미지정=슬롯 409 (만석이면 payload 무효여도 409 선행).
    _gate_err, norm_cid = await _gate_artist_generation(current_user["id"], character_id, "virtual")
    if _gate_err is not None:
        return _gate_err

    # v161 — 텍스트-only 경로: 사진(file)과 외모 설명(user_text) 중 하나는 필수.
    user_text_clean = (user_text or "").strip()
    has_photo = file is not None and bool(file.filename)
    if not has_photo and len(user_text_clean) < 2:
        return JSONResponse(
            status_code=400,
            content={"error": "얼굴 사진 또는 외모 설명 중 하나는 필요합니다."},
        )

    # Validate main face photo (사진 첨부 시에만 — 텍스트-only 는 contents=None).
    contents = None
    ext = ""
    mime_type = None
    if has_photo:
        ext = os.path.splitext(file.filename or "")[1].lower()
        if ext not in ALLOWED_IMAGE_EXT:
            return JSONResponse(
                status_code=400,
                content={"error": "허용되지 않는 이미지 형식입니다. (jpg, png, webp)"},
            )
        contents = await file.read()
        if len(contents) == 0 or len(contents) > MAX_IMAGE_SIZE:
            return JSONResponse(
                status_code=400,
                content={"error": "이미지 크기는 10MB 이하여야 하며 비어있을 수 없습니다."},
            )

    # TrustSquad(v138) — 신고 확정 도용 원본 사진 재사용 차단 (포인트 차감 전).
    # v161 — 사진 SHA 기반 게이트이므로 사진 첨부 시에만 검사 (텍스트-only 자연 스킵).
    if contents is not None:
        if await is_blocked_source_photo(contents, current_user["id"]):
            return JSONResponse(status_code=403, content=dict(BLOCKED_SOURCE_PHOTO_RESPONSE))

    # TrustSquad(v139) — 스트라이크 생성 제한 게이트 (포인트 차감 전 403)
    # 사용자 단위 게이트 — 텍스트-only 경로에도 동일 적용.
    denied = await check_generation_allowed(None, current_user["id"])
    if denied:
        return denied

    if has_photo:
        mime_type = mimetypes.guess_type(file.filename or "")[0] or "image/jpeg"

    # Resolve outfit items: ad-product object_name takes priority over upload.
    top_bytes, top_mime, top_src = await _resolve_item_image(top_object_name, top_image)
    bottom_bytes, bottom_mime, bottom_src = await _resolve_item_image(bottom_object_name, bottom_image)
    shoes_bytes, shoes_mime, shoes_src = await _resolve_item_image(shoes_object_name, shoes_image)

    # Resolve style reference: uploaded image takes priority over preset.
    style_ref_bytes, style_ref_mime = await _read_optional_image(style_image)
    if style_ref_bytes:
        art_style_label = UPLOADED_STYLE_LABEL
        art_style_key = "uploaded"
    else:
        preset_key = (style_preset or "").strip()
        preset = STYLE_PRESETS.get(preset_key)
        if not preset:
            return JSONResponse(
                status_code=400,
                content={
                    "error": "화풍을 선택하거나 화풍 이미지를 업로드해주세요. "
                             "(style_preset: webtoon|anime|manga90 또는 style_image)"
                },
            )
        style_ref_bytes = _load_style_preset_bytes(preset_key)
        if style_ref_bytes is None:
            logger.error(
                "generate-sheet-cartoon: bundled style sample missing key=%s user=%s",
                preset_key, user_id,
            )
            return JSONResponse(
                status_code=500,
                content={"error": "화풍 샘플 이미지를 로드하지 못했습니다."},
            )
        style_ref_mime = "image/png"
        art_style_label = preset["art_style_label"]
        art_style_key = preset_key

    source = "photo+text" if (has_photo and user_text_clean) else ("photo" if has_photo else "text")
    logger.info(
        "[character.gen] mode=cartoon source=%s image_model=%s art_style=%s user=%s "
        "items=top:%s/bottom:%s/shoes:%s",
        source, norm_image_model, art_style_label, user_id, top_src, bottom_src, shoes_src,
    )

    # Points — 검증 통과 후 생성 시작 전 2포인트 선차감 (부족 시 402 차단).
    point_ref = uuid_lib.uuid4().hex
    if not await spend_points(user_id, "character", CHARACTER_POINT_COST, point_ref):
        return JSONResponse(status_code=402, content=dict(INSUFFICIENT_POINTS_RESPONSE))

    try:
        from ..services.character_generator import generate_character_sheet_cartoon

        sheet_bytes = await generate_character_sheet_cartoon(
            photo_bytes=contents,
            mime_type=mime_type or "image/jpeg",
            top_bytes=top_bytes,
            top_mime=top_mime,
            bottom_bytes=bottom_bytes,
            bottom_mime=bottom_mime,
            shoes_bytes=shoes_bytes,
            shoes_mime=shoes_mime,
            user_text=user_text.strip(),
            image_model=norm_image_model,
            art_style_label=art_style_label,
            style_ref_bytes=style_ref_bytes,
            style_ref_mime=style_ref_mime,
        )
    except Exception as e:
        logger.error(
            "generate-sheet-cartoon failed: user=%s art_style=%s err=%s",
            user_id, art_style_label, str(e)[:200],
        )
        # Points — 생성 실패 시 선차감분 환불.
        await refund_points(user_id, "character", CHARACTER_POINT_COST, point_ref)
        return JSONResponse(
            status_code=500,
            content={"error": "가상화 캐릭터 시트 생성 실패: {}".format(str(e)[:200])},
        )

    # Temp original + generated sheet — mirrors /generate-sheet behavior.
    try:
        stored = _store_temp_sheet(user_id, contents, mime_type, ext, sheet_bytes)
    except Exception:
        # Points — MinIO 저장 실패도 사용자에게는 생성 실패 → 환불 후 기존 500 동작 유지.
        await refund_points(user_id, "character", CHARACTER_POINT_COST, point_ref)
        raise

    # v220 — 아티스트 완성 훅 (가상화 sync — 재생성 포함, best-effort)
    from ..services.fatigue_service import on_generation_completed
    await on_generation_completed(user_id, director="artist")

    return {
        "object_name": stored["object_name"],
        "original_object_name": stored["original_object_name"],
        "preview_url": stored["preview_url"],
        "image_model": norm_image_model,
        "art_style": art_style_label,
        "art_style_key": art_style_key,
        "character_id": norm_cid,  # v212 — 재생성 대상 echo (미지정 신규는 None)
        "message": "가상화 캐릭터 시트가 생성되었습니다.",
    }


# ── Async job pattern (job accept + background runner + polling) ────────────
#
# 캐릭터 시트 생성은 3~6분+ 걸려 프론트 고정 타임아웃에 걸리므로, 접수 즉시
# job_id 를 반환하고 백그라운드에서 생성 후 프론트가 GET /job/{job_id} 로
# 폴링하는 비동기 패턴을 제공한다 (동기 엔드포인트는 하위호환으로 유지).
# Mongo 컬렉션: `character_jobs`. status: processing → done | failed.


async def refund_character_job_points(mongo, job_oid) -> bool:
    """Refund the pre-deducted character points of a failed job, exactly once.

    Atomically claims the job's `refunded` flag (absent/False → True) via
    find_one_and_update, so the async runner and the startup stale-recovery
    can never both refund the same job. Jobs without a `point_ref`
    (pre-points era, or claim already taken) are skipped. Never raises.
    Returns True when a refund was actually issued.
    """
    try:
        claimed = await mongo.character_jobs.find_one_and_update(
            {"_id": job_oid, "point_ref": {"$ne": None}, "refunded": {"$ne": True}},
            {"$set": {"refunded": True}},
        )
        if not claimed:
            return False
        user_id = claimed.get("user_id")
        point_ref = claimed.get("point_ref")
        if not user_id or not point_ref:
            return False
        await refund_points(user_id, "character", CHARACTER_POINT_COST, point_ref)
        return True
    except Exception as e:  # noqa: BLE001 - refund must never break callers
        logger.warning(
            "[CharJob] refund claim failed job=%s: %s", str(job_oid), str(e)[:200]
        )
        return False


# ── v3.227 (A-보완) 생성 job 추적 — 회수·중복 차단·stale lazy 정리 ─────────────
#
# 서버는 접수 즉시 백그라운드로 끝까지 생성한다. 앱은 화면이 아니라 job 을 추적하고,
# 결과 확정(save)은 앱이 한 번만 한다. 여기서는
#   ① 미소비 결과 목록(GET /jobs/recoverable) ② 버리기(POST /job/{id}/dismiss)
#   ③ save 시 소비 표시(consumed_at — 신규 아티스트 경로는 원자적 claim 으로 이중 저장 차단)
#   ④ 진행 중 job 이 있으면 새 생성 409 generation_in_progress(과금 전)
#   ⑤ 30분 넘은 processing 은 재기동을 기다리지 않고 lazy 로 failed+1회 환불
# 을 제공한다. main.py 는 건드리지 않는다(인덱스는 여기서 프로세스당 1회 lazy 생성).

STALE_JOB_MINUTES = 30  # main.py 기동 시 stale 복구와 같은 기준
RECOVERABLE_LIST_LIMIT = 10  # 목록 상한(보관 기간은 무제한 — 사용자 결정 4)
RECOVERABLE_FAILED_HOURS = 24  # 실패 안내 노출 창
# 소비 표시가 없던 배포 이전 job 은 다시 나타나지 않게 하는 하한. 사용자 결정 2 에 따라
# 2026-09-24 유실 1차 job(6ab4c16e)이 회수 목록에 '도착'으로 뜨도록 06:00Z 로 둔다.
# 이 하한 이후라도 배포 전 job(consume_tracked 없음)은 저장 시트와 바이트 일치(etag+size)면
# 이미 저장된 것으로 보고 숨긴다(2차 job 6ab4c22b = '샘플' 로 저장됨 → 비노출).
RECOVERABLE_SINCE = datetime(2026, 9, 24, 6, 0, 0)
SAVE_CLAIM_STALE_SECONDS = 120  # save 도중 프로세스가 죽어 남은 claim 재사용 기준

_JOB_INDEX_READY = False
_USER_GEN_LOCKS: dict = {}
_LEGACY_CONSUMED_CACHE: dict = {}  # job_id → bool (배포 이전 job 의 저장 여부 판정 캐시)


def _u8(user_id) -> str:
    return str(user_id or "")[:8]


async def _ensure_job_indexes(mongo) -> None:
    """character_jobs (user_id, status, created_at) 인덱스 — 프로세스당 1회, 멱등."""
    global _JOB_INDEX_READY
    if _JOB_INDEX_READY:
        return
    _JOB_INDEX_READY = True
    try:
        name = await mongo.character_jobs.create_index(
            [("user_id", 1), ("status", 1), ("created_at", -1)],
            name="user_status_created",
            background=True,
        )
        logger.info("[CharJob][migration] character_jobs index ensured name=%s", name)
    except Exception as e:  # noqa: BLE001 — 인덱스 실패는 기능을 막지 않음(소규모 컬렉션)
        logger.warning("[CharJob][migration] character_jobs index failed: %s", str(e)[:200])


def _user_gen_lock(user_id: str) -> asyncio.Lock:
    """사용자별 접수 직렬화 락 (uvicorn 단일 워커 — Dockerfile '--workers 없음')."""
    lock = _USER_GEN_LOCKS.get(user_id)
    if lock is None:
        if len(_USER_GEN_LOCKS) > 5000:
            for k in [k for k, v in _USER_GEN_LOCKS.items() if not v.locked()][:2500]:
                _USER_GEN_LOCKS.pop(k, None)
        lock = asyncio.Lock()
        _USER_GEN_LOCKS[user_id] = lock
    return lock


async def _sweep_stale_jobs(mongo, user_id: str) -> int:
    """이 사용자의 30분 넘은 processing job 을 failed 로 전환 + 1회 환불 (멱등).

    main.py 기동 시 stale 복구와 같은 claim(status=processing 조건부 전환) +
    refund_character_job_points(refunded 플래그 원자 claim) 를 재사용한다.
    Returns 정리한 건수. Never raises.
    """
    fixed = 0
    try:
        cutoff = datetime.utcnow() - timedelta(minutes=STALE_JOB_MINUTES)
        async for job in mongo.character_jobs.find(
            {"user_id": user_id, "status": "processing", "created_at": {"$lt": cutoff}},
            {"_id": 1},
        ):
            claimed = await mongo.character_jobs.find_one_and_update(
                {"_id": job["_id"], "status": "processing"},
                {"$set": {
                    "status": "failed",
                    "error": "생성 시간이 초과되어 중단됨",
                    "stale_swept_at": datetime.utcnow(),
                    "updated_at": datetime.utcnow(),
                }},
            )
            if not claimed:
                continue
            fixed += 1
            refunded = await refund_character_job_points(mongo, job["_id"])
            logger.info(
                "[CharJob] stale-swept job=%s user=%s refunded=%s",
                str(job["_id"]), _u8(user_id), refunded,
            )
    except Exception as e:  # noqa: BLE001
        logger.warning("[CharJob] stale sweep failed user=%s: %s", _u8(user_id), str(e)[:200])
    return fixed


async def _find_active_job(mongo, user_id: str) -> Optional[dict]:
    """30분 이내 processing job (최신 1건) — stale 은 호출 전에 정리돼 있어야 한다."""
    cutoff = datetime.utcnow() - timedelta(minutes=STALE_JOB_MINUTES)
    return await mongo.character_jobs.find_one(
        {"user_id": user_id, "status": "processing", "created_at": {"$gte": cutoff}},
        sort=[("created_at", -1)],
    )


def _in_progress_response(job: dict) -> JSONResponse:
    created = job.get("created_at")
    return JSONResponse(
        status_code=409,
        content={
            "error": "generation_in_progress",
            "job_id": str(job["_id"]),
            "mode": job.get("mode"),
            "character_id": job.get("character_id"),
            "created_at": created.isoformat() if isinstance(created, datetime) else None,
            "message": "이미 아티스트를 만드는 중이에요. 완성된 뒤에 새로 만들 수 있어요.",
        },
    )


async def _generation_in_progress_gate(user_id: str, route: str) -> Optional[JSONResponse]:
    """generate 4종 공용 — 과금 전 중복 생성 차단. stale 을 먼저 정리해 영구 잠김 방지."""
    mongo = get_mongo()
    await _ensure_job_indexes(mongo)
    await _sweep_stale_jobs(mongo, user_id)
    job = await _find_active_job(mongo, user_id)
    if job is None:
        return None
    logger.info(
        "[CharJob] dup-blocked user=%s job=%s route=%s", _u8(user_id), str(job["_id"]), route,
    )
    return _in_progress_response(job)


_ORIGINAL_REUSE_RE = re.compile(r"^characters/(?:temp/)?([^/]+)/original[^/]*$")


def _load_owned_original(user_id: str, object_name: str):
    """H-1 원본 재사용 — 소유권(경로의 uid == 본인) 검증 후 MinIO 바이트 로드.

    Returns (error_response|None, bytes|None, ext, mime).
    """
    name = (object_name or "").strip()
    m = _ORIGINAL_REUSE_RE.match(name)
    if not m or ".." in name or "//" in name:
        return JSONResponse(status_code=400, content={"error": "원본 사진 경로가 올바르지 않습니다."}), None, "", None
    if m.group(1) != str(user_id):
        logger.warning("[CharJob] reuse original forbidden user=%s owner=%s", _u8(user_id), _u8(m.group(1)))
        return JSONResponse(status_code=403, content={"error": "original_forbidden"}), None, "", None
    ext = os.path.splitext(name)[1].lower()
    if ext not in ALLOWED_IMAGE_EXT:
        return JSONResponse(status_code=400, content={"error": "허용되지 않는 이미지 형식입니다. (jpg, png, webp)"}), None, "", None
    data, mime = _load_item_image(name)
    if not data:
        return JSONResponse(status_code=404, content={"error": "원본 사진을 찾을 수 없습니다."}), None, "", None
    sniffed = _sniff_image_mime(data)
    logger.info(
        "[CharJob] reuse original user=%s obj=…/%s bytes=%d", _u8(user_id), os.path.basename(name)[:40], len(data),
    )
    return None, data, ext, sniffed or mime or "image/jpeg"


def _sniff_image_mime(data: Optional[bytes]) -> Optional[str]:
    head = (data or b"")[:16]
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    if head[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    return None


async def _legacy_job_already_saved(mongo, minio_client, job: dict, user_sheet_stats: Optional[list]) -> tuple:
    """배포 이전(consume_tracked 없음) done job 이 이미 아티스트로 저장됐는지 판정.

    save 는 temp 시트를 영구 경로로 copy_object 하므로 (size, etag) 가 같다. 사용자의
    저장 시트들과 비교해 일치하면 '소비됨'으로 본다. DB 쓰기 없음(프로세스 캐시만).
    Returns (saved: bool, user_sheet_stats) — stats 는 호출 간 재사용.
    """
    jid = str(job["_id"])
    if jid in _LEGACY_CONSUMED_CACHE:
        return _LEGACY_CONSUMED_CACHE[jid], user_sheet_stats
    obj = job.get("object_name") or ""
    try:
        st = minio_client.stat_object(bucket_name=settings.minio_bucket_images, object_name=obj)
        key = (st.size, (st.etag or "").strip('"'))
    except Exception:
        # temp 결과가 사라졌으면 회수할 수 없다 → 목록에서 제외
        _LEGACY_CONSUMED_CACHE[jid] = True
        return True, user_sheet_stats
    if user_sheet_stats is None:
        user_sheet_stats = []
        async for doc in mongo.characters.find(
            {"user_id": job.get("user_id")},
            {"sheet_object_name": 1, "virtual_sheet_object_name": 1},
        ):
            for f in ("sheet_object_name", "virtual_sheet_object_name"):
                so = doc.get(f)
                if not so:
                    continue
                try:
                    s2 = minio_client.stat_object(bucket_name=settings.minio_bucket_images, object_name=so)
                    user_sheet_stats.append((s2.size, (s2.etag or "").strip('"')))
                except Exception:
                    continue
    saved = any(key[0] == s[0] and (not key[1] or not s[1] or key[1] == s[1]) for s in user_sheet_stats)
    _LEGACY_CONSUMED_CACHE[jid] = saved
    return saved, user_sheet_stats


async def _mark_job_consumed(mongo, user_id: str, sheet_object_name: str, character_id: Optional[str], via: str) -> Optional[str]:
    """save 성공 후 best-effort 소비 표시 (경로 ①·③ — 같은 시트 재저장은 덮어쓰기라 멱등).

    v3.235 — 표시한 job 의 _id(str) 를 반환(없음·실패 = None). 기존 호출부는 반환값을 쓰지 않는다.
    """
    if not sheet_object_name or not sheet_object_name.startswith("characters/temp/"):
        return None
    try:
        now = datetime.utcnow()
        job = await mongo.character_jobs.find_one_and_update(
            {"user_id": user_id, "object_name": sheet_object_name},
            {"$set": {"consumed_character_id": character_id, "consumed_via": via, "updated_at": now}},
        )
        if job is None:
            return None  # sync 생성(job 없음) 결과 저장 — 표시할 대상 없음
        if not job.get("consumed_at"):
            await mongo.character_jobs.update_one(
                {"_id": job["_id"], "consumed_at": {"$exists": False}}, {"$set": {"consumed_at": now}},
            )
        logger.info(
            "[CharJob] consumed job=%s user=%s cid=%s via=%s", str(job["_id"]), _u8(user_id), character_id, via,
        )
        return str(job["_id"])
    except Exception as e:  # noqa: BLE001
        logger.warning("[CharJob] consume mark failed user=%s: %s", _u8(user_id), str(e)[:200])
        return None


async def _outfit_follow_after_save(mongo, user_id: str, character_id: Optional[str], job_id: Optional[str], via: str) -> None:
    """v3.235 S6 — 저장된 옷 입히기 job 을 발매 시점에 추적 표시(outfit_follow)한 곡에 착장 반영.

    tracks.apply_outfit_follow(지연 import) 위임. 전 과정 best-effort — save 응답·과금·consume 표시 불변.
    """
    if not job_id or not character_id:
        return
    try:
        from .tracks import apply_outfit_follow

        await apply_outfit_follow(mongo, user_id, character_id, job_id, via)
    except Exception as e:  # noqa: BLE001
        logger.warning("[OutfitFollow] error user=%s job=%s err=%s — save continues", _u8(user_id), job_id, str(e)[:160])


async def _claim_job_for_new_artist(mongo, user_id: str, sheet_object_name: str) -> tuple:
    """경로 ②(신규 아티스트) 이중 저장 차단 — 원자적 claim.

    Returns (state, job): state ∈ {"none"(job 없는 시트), "claimed", "saved"(이미 저장된
    아티스트 있음 — job.consumed_character_id), "busy"(다른 요청이 저장 중)}.
    """
    if not sheet_object_name or not sheet_object_name.startswith("characters/temp/"):
        return "none", None
    job = await mongo.character_jobs.find_one(
        {"user_id": user_id, "object_name": sheet_object_name}, sort=[("created_at", -1)],
    )
    if not job:
        return "none", None
    now = datetime.utcnow()
    claimed = await mongo.character_jobs.find_one_and_update(
        {"_id": job["_id"], "consumed_at": {"$exists": False}},
        {"$set": {"consumed_at": now, "consumed_via": "save:create"}},
    )
    if claimed:
        return "claimed", job
    fresh = await mongo.character_jobs.find_one({"_id": job["_id"]}) or {}
    if fresh.get("consumed_character_id"):
        return "saved", fresh
    # 저장 결과 없이 claim 만 남은 경우 — 동시 요청이 진행 중이거나(짧게) 이전 저장이 중간에 죽음.
    old = fresh.get("consumed_at")
    if isinstance(old, datetime) and (now - old).total_seconds() > SAVE_CLAIM_STALE_SECONDS:
        reclaimed = await mongo.character_jobs.find_one_and_update(
            {"_id": job["_id"], "consumed_at": old, "consumed_character_id": {"$exists": False}},
            {"$set": {"consumed_at": now, "consumed_via": "save:create(reclaim)"}},
        )
        if reclaimed:
            return "claimed", fresh
    return "busy", fresh


async def _already_saved_artist_response(mongo, user_id: str, sheet_object_name: str, job: Optional[dict] = None):
    """이미 소비된 job 결과(consumed_character_id → 현존 아티스트)면 200 already_saved 응답, 아니면 None.

    읽기 전용(쓰기 없음) — save 경로 ② 의 슬롯 검사 전 선판정과 claim 'saved' 분기가 공용으로 쓴다.
    """
    if job is None:
        if not sheet_object_name or not sheet_object_name.startswith("characters/temp/"):
            return None
        job = await mongo.character_jobs.find_one(
            {"user_id": user_id, "object_name": sheet_object_name}, sort=[("created_at", -1)],
        )
    if not job or not job.get("consumed_character_id"):
        return None
    prev = await _find_artist_by_cid(mongo, user_id, job.get("consumed_character_id") or "")
    if not prev:
        return None  # 저장됐던 아티스트가 이후 삭제됨 — 재저장 허용(호출부가 계속 진행)
    logger.info(
        "[CharJob] dup-save blocked job=%s user=%s cid=%s",
        str(job.get("_id")), _u8(user_id), prev.get("character_id"),
    )
    resp = _serialize_artist(prev, await _resolve_persona_clone(mongo, prev))
    resp["message"] = "이미 저장된 아티스트입니다."
    resp["already_saved"] = True
    return resp


async def _release_job_claim(mongo, job_oid) -> None:
    try:
        await mongo.character_jobs.update_one(
            {"_id": job_oid, "consumed_character_id": {"$exists": False}},
            {"$unset": {"consumed_at": "", "consumed_via": ""}},
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("[CharJob] claim release failed job=%s: %s", str(job_oid), str(e)[:200])


async def _run_character_job(
    job_id: str,
    user_id: str,
    mode: str,
    contents: Optional[bytes],
    mime_type: Optional[str],
    ext: str,
    top_bytes: Optional[bytes],
    top_mime: Optional[str],
    bottom_bytes: Optional[bytes],
    bottom_mime: Optional[str],
    shoes_bytes: Optional[bytes],
    shoes_mime: Optional[str],
    user_text: str,
    image_model: str,
    art_style_label: Optional[str] = None,
    art_style_key: Optional[str] = None,
    style_ref_bytes: Optional[bytes] = None,
    style_ref_mime: Optional[str] = None,
):
    """Background runner for async character sheet jobs.

    Generates the sheet (real or cartoon), stores results to MinIO temp paths,
    and updates the `character_jobs` document. Never raises — any failure marks
    the job as failed with a truncated error message.
    """
    mongo = get_mongo()
    oid = ObjectId(job_id)
    try:
        if mode == "cartoon":
            from ..services.character_generator import generate_character_sheet_cartoon

            sheet_bytes = await generate_character_sheet_cartoon(
                photo_bytes=contents,
                mime_type=mime_type or "image/jpeg",
                top_bytes=top_bytes,
                top_mime=top_mime,
                bottom_bytes=bottom_bytes,
                bottom_mime=bottom_mime,
                shoes_bytes=shoes_bytes,
                shoes_mime=shoes_mime,
                user_text=user_text,
                image_model=image_model,
                art_style_label=art_style_label,
                style_ref_bytes=style_ref_bytes,
                style_ref_mime=style_ref_mime,
            )
        else:
            from ..services.character_generator import generate_character_sheet

            sheet_bytes = await generate_character_sheet(
                photo_bytes=contents,
                mime_type=mime_type or "image/jpeg",
                top_bytes=top_bytes,
                top_mime=top_mime,
                bottom_bytes=bottom_bytes,
                bottom_mime=bottom_mime,
                shoes_bytes=shoes_bytes,
                shoes_mime=shoes_mime,
                user_text=user_text,
                image_model=image_model,
            )

        stored = _store_temp_sheet(user_id, contents, mime_type, ext, sheet_bytes)

        now = datetime.utcnow()
        update_fields = {
            "status": "done",
            "object_name": stored["object_name"],
            "original_object_name": stored["original_object_name"],
            "preview_url": stored["preview_url"],
            "image_model": image_model,
            "updated_at": now,
            "completed_at": now,
        }
        if mode == "cartoon":
            update_fields["art_style"] = art_style_label
            update_fields["art_style_key"] = art_style_key
        _prev = await mongo.character_jobs.find_one_and_update({"_id": oid}, {"$set": update_fields})
        if _prev is not None and _prev.get("status") != "processing":
            # v3.227 — lazy stale 정리(30분)가 먼저 failed+환불한 뒤 늦게 완성된 경우.
            # 결과는 그대로 전달(done)하고 관측만 남긴다(환불 회수 없음).
            logger.warning(
                "[CharJob] job=%s late-complete after status=%s refunded=%s user=%s",
                job_id, _prev.get("status"), _prev.get("refunded"), _u8(user_id),
            )
        logger.info(
            "[CharJob] job=%s mode=%s status=done object=%s",
            job_id, mode, stored["object_name"],
        )
        # v220 — 아티스트 완성 훅 (async 잡 done — real/cartoon 공통, 재생성 포함).
        # BackgroundTasks 는 메인 루프에서 돌지만 명시적으로 이 러너의 mongo 를 주입.
        # best-effort — on_generation_completed 는 절대 raise 하지 않음.
        from ..services.fatigue_service import on_generation_completed
        await on_generation_completed(user_id, db=mongo, director="artist")
    except Exception as e:
        logger.error(
            "[CharJob] job=%s mode=%s status=failed err=%s",
            job_id, mode, str(e)[:200],
        )
        try:
            await mongo.character_jobs.update_one(
                {"_id": oid},
                {"$set": {
                    "status": "failed",
                    "error": str(e)[:200],
                    "updated_at": datetime.utcnow(),
                }},
            )
        except Exception as e2:
            logger.error(
                "[CharJob] job=%s failed-state write also failed: %s",
                job_id, str(e2)[:200],
            )
        # Points — 실패한 job 의 선차감분 환불 (refunded 플래그로 1회 보장).
        if await refund_character_job_points(mongo, oid):
            logger.info("[CharJob] job=%s points refunded", job_id)


@router.post("/generate-sheet-async")
async def generate_sheet_async(
    background_tasks: BackgroundTasks,
    file: Optional[UploadFile] = File(None),
    top_image: Optional[UploadFile] = File(None),
    bottom_image: Optional[UploadFile] = File(None),
    shoes_image: Optional[UploadFile] = File(None),
    top_object_name: Optional[str] = Form(None),
    bottom_object_name: Optional[str] = Form(None),
    shoes_object_name: Optional[str] = Form(None),
    user_text: str = Form(""),
    image_model: str = Form("nb_pro"),
    portrait_confirmed: Optional[str] = Form(None),  # v137 — FE 확약 체크 전달(로그용, 미전달 허용)
    character_id: Optional[str] = Form(None),  # v212 — 지정=재생성, 미지정=신규(슬롯 검사)
    # v3.227 (H-1) — 파일 없이 본인 서버 원본을 얼굴 사진으로 재사용 (sync 와 동일 규약).
    original_object_name: Optional[str] = Form(None),
    current_user=Depends(get_current_user),
):
    """Async variant of /generate-sheet — same form fields, returns a job_id
    immediately; generation runs in the background. Poll GET /job/{job_id}."""
    # v3.232 F4 — 어린이 실사(얼굴 사진) 시트 차단 — 피로 게이트·중복 409·⭐ 차감 전. OFF 면 DB 0회.
    _kids_block = await kids_policy.kids_guard(current_user["id"], "character_photo")
    if _kids_block is not None:
        return _kids_block
    logger.info("[character] portrait_confirmed=%s user=%s", portrait_confirmed, str(current_user["id"])[:8])
    # Validation — identical to the sync handler.
    # v217 [ModelPin] — 실사 시트 = gpt_image_2 백엔드 고정 (sync 와 동일 정책).
    norm_image_model = _forced_sheet_model("real")
    _recv_model = (image_model or "").strip()
    if _recv_model and _recv_model != norm_image_model:
        logger.info(
            "[ModelPin] ignored client value mode=real(async) recv=%s forced=%s user=%s",
            _recv_model[:24], norm_image_model, str(current_user["id"])[:8],
        )
    if not settings.openai_api_key:
        return JSONResponse(
            status_code=503,
            content={"error": "OpenAI API 키가 설정되지 않았습니다."},
        )

    # v220 — 아티스트 디렉터 피로 게이트 (슬롯/⭐ 검사 **전** — 429 무과금).
    _fatigued = await _artist_fatigue_gate(current_user["id"])
    if _fatigued is not None:
        return _fatigued

    # v3.227 — 진행 중 job 이 있으면 과금 전 409 generation_in_progress (stale 은 먼저 lazy 정리).
    _dup = await _generation_in_progress_gate(current_user["id"], "generate-sheet-async")
    if _dup is not None:
        return _dup

    # v212 — 아티스트 게이트 (image_model 검증 직후·payload 검증 이전 최선두, ⭐차감 전):
    # cid 지정=재생성(404/400), 미지정=슬롯 409 (만석이면 payload 무효여도 409 선행).
    _gate_err, norm_cid = await _gate_artist_generation(current_user["id"], character_id, "real")
    if _gate_err is not None:
        return _gate_err

    # v161 — 텍스트-only 경로: 사진(file)과 외모 설명(user_text) 중 하나는 필수.
    user_text_clean = (user_text or "").strip()
    has_photo = file is not None and bool(file.filename)
    # v3.227 (H-1) — 원본 재사용: 파일이 없고 original_object_name 이 오면 서버 원본을 사진으로.
    reused_bytes = None
    reused_ext = ""
    reused_mime = None
    if not has_photo and (original_object_name or "").strip():
        _r_err, reused_bytes, reused_ext, reused_mime = _load_owned_original(
            current_user["id"], original_object_name
        )
        if _r_err is not None:
            return _r_err
        has_photo = True
    if not has_photo and len(user_text_clean) < 2:
        return JSONResponse(
            status_code=400,
            content={"error": "얼굴 사진 또는 외모 설명 중 하나는 필요합니다."},
        )

    contents = None
    ext = ""
    mime_type = None
    if reused_bytes is not None:
        contents = reused_bytes
        ext = reused_ext
    elif has_photo:
        ext = os.path.splitext(file.filename or "")[1].lower()
        if ext not in ALLOWED_IMAGE_EXT:
            return JSONResponse(
                status_code=400,
                content={"error": "허용되지 않는 이미지 형식입니다. (jpg, png, webp)"},
            )
        contents = await file.read()
        if len(contents) == 0 or len(contents) > MAX_IMAGE_SIZE:
            return JSONResponse(
                status_code=400,
                content={"error": "이미지 크기는 10MB 이하여야 하며 비어있을 수 없습니다."},
            )

    # TrustSquad(v138) — 신고 확정 도용 원본 사진 재사용 차단 (포인트 차감 전).
    # v161 — 사진 SHA 기반 게이트이므로 사진 첨부 시에만 검사 (텍스트-only 자연 스킵).
    if contents is not None:
        if await is_blocked_source_photo(contents, current_user["id"]):
            return JSONResponse(status_code=403, content=dict(BLOCKED_SOURCE_PHOTO_RESPONSE))

    # TrustSquad(v139) — 스트라이크 생성 제한 게이트 (포인트 차감 전 403)
    # 사용자 단위 게이트 — 텍스트-only 경로에도 동일 적용.
    denied = await check_generation_allowed(None, current_user["id"])
    if denied:
        return denied

    if reused_bytes is not None:
        mime_type = reused_mime or "image/jpeg"
    elif has_photo:
        mime_type = mimetypes.guess_type(file.filename or "")[0] or "image/jpeg"

    # Resolve ALL bytes inside the handler — UploadFile objects are closed
    # after the response is sent, so nothing may be read in the background.
    top_bytes, top_mime, top_src = await _resolve_item_image(top_object_name, top_image)
    bottom_bytes, bottom_mime, bottom_src = await _resolve_item_image(bottom_object_name, bottom_image)
    shoes_bytes, shoes_mime, shoes_src = await _resolve_item_image(shoes_object_name, shoes_image)

    user_id = current_user["id"]

    # FaceGuardSquad(v135) — 실사화 경로 얼굴 인증 게이트 (sync 핸들러와 동일).
    # v161 — 사진 SHA 기반 게이트이므로 사진 첨부 시에만 검사 (텍스트-only 자연 스킵).
    if settings.face_verify_enabled and contents is not None:
        from ..services.face_verify_service import is_photo_verified

        if not await is_photo_verified(user_id, contents):
            return JSONResponse(
                status_code=403,
                content={"error": "face_verification_required", "message": "얼굴 인증이 필요합니다."},
            )

    # Points — 검증 통과 후 job 접수 전 2포인트 선차감 (부족 시 402, job 미생성).
    # ref 는 시도당 유니크 (point_events 유니크 인덱스와의 재시도 충돌 회피),
    # job doc 에 point_ref 로 저장해 실패/stale 복구 시 환불에 사용.
    point_ref = uuid_lib.uuid4().hex
    mongo = get_mongo()
    # v3.227 — 재확인 + 차감 + 접수를 사용자 락 안에서 (동시 요청 2건의 이중 접수·이중 과금 차단).
    async with _user_gen_lock(user_id):
        _active = await _find_active_job(mongo, user_id)
        if _active is not None:
            logger.info("[CharJob] dup-blocked(race) user=%s job=%s route=generate-sheet-async", _u8(user_id), str(_active["_id"]))
            return _in_progress_response(_active)
        if not await spend_points(user_id, "character", CHARACTER_POINT_COST, point_ref):
            return JSONResponse(status_code=402, content=dict(INSUFFICIENT_POINTS_RESPONSE))

        now = datetime.utcnow()
        result = await mongo.character_jobs.insert_one({
            "user_id": user_id,
            "mode": "real",
            "status": "processing",
            "image_model": norm_image_model,
            "character_id": norm_cid,  # v212 — 재생성 대상 (신규는 None)
            "point_ref": point_ref,
            "refunded": False,
            "consume_tracked": True,  # v3.227 — 소비 표시 추적 대상(배포 이후 job)
            "has_photo": contents is not None,
            "created_at": now,
            "updated_at": now,
        })
    job_id = str(result.inserted_id)

    source = "photo+text" if (has_photo and user_text_clean) else ("photo" if has_photo else "text")
    logger.info(
        "[CharJob] job=%s mode=real source=%s status=processing image_model=%s user=%s "
        "items=top:%s/bottom:%s/shoes:%s",
        job_id, source, norm_image_model, user_id, top_src, bottom_src, shoes_src,
    )

    background_tasks.add_task(
        _run_character_job,
        job_id=job_id,
        user_id=user_id,
        mode="real",
        contents=contents,
        mime_type=mime_type,
        ext=ext,
        top_bytes=top_bytes,
        top_mime=top_mime,
        bottom_bytes=bottom_bytes,
        bottom_mime=bottom_mime,
        shoes_bytes=shoes_bytes,
        shoes_mime=shoes_mime,
        user_text=user_text.strip(),
        image_model=norm_image_model,
    )

    return {"job_id": job_id, "status": "processing"}


@router.post("/generate-sheet-cartoon-async")
async def generate_sheet_cartoon_async(
    background_tasks: BackgroundTasks,
    file: Optional[UploadFile] = File(None),
    top_image: Optional[UploadFile] = File(None),
    bottom_image: Optional[UploadFile] = File(None),
    shoes_image: Optional[UploadFile] = File(None),
    top_object_name: Optional[str] = Form(None),
    bottom_object_name: Optional[str] = Form(None),
    shoes_object_name: Optional[str] = Form(None),
    user_text: str = Form(""),
    image_model: str = Form("nb_pro"),
    portrait_confirmed: Optional[str] = Form(None),  # v137 — FE 확약 체크 전달(로그용, 미전달 허용)
    style_preset: str = Form(""),
    style_image: Optional[UploadFile] = File(None),
    character_id: Optional[str] = Form(None),  # v212 — 지정=재생성, 미지정=신규(슬롯 검사)
    # v223 — 가상 아티스트 꾸미기(outfit): character_id 지정 재생성에서 file 없이
    # 저장된 doc.sheet_object_name 을 [인물 사진] 기준 입력으로 로드. 화풍
    # (style_preset/style_image) 미전송 시 doc.art_style 로 복원(프리셋 역매핑,
    # 미매핑=업로드 화풍이면 저장 시트 자체를 화풍 reference 로 사용 — 화풍 붕괴 금지).
    use_saved_sheet: Optional[str] = Form(None),
    current_user=Depends(get_current_user),
):
    """Async variant of /generate-sheet-cartoon — same form fields, returns a
    job_id immediately; generation runs in the background. Poll GET /job/{job_id}."""
    # v3.232 F4+G1 — 어린이: 사진·화풍 이미지 업로드 거부(use_saved_sheet·프리셋·텍스트 허용), 설명 금칙어
    _kids_block = await _kids_cartoon_gate(current_user["id"], file is not None or style_image is not None, user_text)
    if _kids_block is not None:
        return _kids_block
    logger.info("[character] portrait_confirmed=%s user=%s", portrait_confirmed, str(current_user["id"])[:8])
    user_id = current_user["id"]

    # Validation — identical to the sync cartoon handler.
    # v217 [ModelPin] — 만화(가상화) 시트 = nb_pro 백엔드 고정 (sync 와 동일 정책).
    norm_image_model = _forced_sheet_model("cartoon")
    _recv_model = (image_model or "").strip()
    if _recv_model and _recv_model != norm_image_model:
        logger.info(
            "[ModelPin] ignored client value mode=cartoon(async) recv=%s forced=%s user=%s",
            _recv_model[:24], norm_image_model, str(current_user["id"])[:8],
        )
    if not settings.google_api_key:
        return JSONResponse(
            status_code=503,
            content={"error": "Google API 키가 설정되지 않았습니다."},
        )

    # v220 — 아티스트 디렉터 피로 게이트 (슬롯/⭐ 검사 **전** — 429 무과금).
    _fatigued = await _artist_fatigue_gate(current_user["id"])
    if _fatigued is not None:
        return _fatigued

    # v3.227 — 진행 중 job 이 있으면 과금 전 409 generation_in_progress (stale 은 먼저 lazy 정리).
    _dup = await _generation_in_progress_gate(current_user["id"], "generate-sheet-cartoon-async")
    if _dup is not None:
        return _dup

    # v212 — 아티스트 게이트 (image_model 검증 직후·payload 검증 이전 최선두, ⭐차감 전):
    # cid 지정=재생성(404/400), 미지정=슬롯 409 (만석이면 payload 무효여도 409 선행).
    _gate_err, norm_cid = await _gate_artist_generation(current_user["id"], character_id, "virtual")
    if _gate_err is not None:
        return _gate_err

    # v223 — use_saved_sheet 플래그 (character_id 지정 재생성 전용, ⭐차감 전 400)
    use_saved = (use_saved_sheet or "").strip().lower() in ("1", "true", "yes")
    if use_saved and not norm_cid:
        return JSONResponse(
            status_code=400,
            content={"error": "use_saved_sheet 는 character_id 지정 시에만 사용할 수 있습니다."},
        )

    # v161 — 텍스트-only 경로: 사진(file)과 외모 설명(user_text) 중 하나는 필수.
    # v223 — use_saved_sheet 는 저장 시트가 기준 이미지가 되므로 이 검사 면제.
    user_text_clean = (user_text or "").strip()
    has_photo = file is not None and bool(file.filename)
    if not has_photo and not use_saved and len(user_text_clean) < 2:
        return JSONResponse(
            status_code=400,
            content={"error": "얼굴 사진 또는 외모 설명 중 하나는 필요합니다."},
        )

    contents = None
    ext = ""
    mime_type = None
    if has_photo:
        ext = os.path.splitext(file.filename or "")[1].lower()
        if ext not in ALLOWED_IMAGE_EXT:
            return JSONResponse(
                status_code=400,
                content={"error": "허용되지 않는 이미지 형식입니다. (jpg, png, webp)"},
            )
        contents = await file.read()
        if len(contents) == 0 or len(contents) > MAX_IMAGE_SIZE:
            return JSONResponse(
                status_code=400,
                content={"error": "이미지 크기는 10MB 이하여야 하며 비어있을 수 없습니다."},
            )

    # TrustSquad(v138) — 신고 확정 도용 원본 사진 재사용 차단 (포인트 차감 전).
    # v161 — 사진 SHA 기반 게이트이므로 사진 첨부 시에만 검사 (텍스트-only 자연 스킵).
    if contents is not None:
        if await is_blocked_source_photo(contents, current_user["id"]):
            return JSONResponse(status_code=403, content=dict(BLOCKED_SOURCE_PHOTO_RESPONSE))

    # TrustSquad(v139) — 스트라이크 생성 제한 게이트 (포인트 차감 전 403)
    # 사용자 단위 게이트 — 텍스트-only 경로에도 동일 적용.
    denied = await check_generation_allowed(None, current_user["id"])
    if denied:
        return denied

    if has_photo:
        mime_type = mimetypes.guess_type(file.filename or "")[0] or "image/jpeg"

    # Resolve ALL bytes inside the handler (UploadFile closes after response).
    top_bytes, top_mime, top_src = await _resolve_item_image(top_object_name, top_image)
    bottom_bytes, bottom_mime, bottom_src = await _resolve_item_image(bottom_object_name, bottom_image)
    shoes_bytes, shoes_mime, shoes_src = await _resolve_item_image(shoes_object_name, shoes_image)

    # v223 — 저장 시트 로드 (⭐차감 전 — 실패 시 무과금 에러).
    # file 미첨부 + use_saved_sheet 이면 doc.sheet_object_name 을 [인물 사진]
    # 기준 입력으로 사용한다 (가상 꾸미기 = 실사 outfit 의 원본 사진과 등가).
    saved_doc = None
    saved_sheet_bytes = None
    if use_saved:
        saved_doc = await _find_artist_by_cid(get_mongo(), user_id, norm_cid)
        sheet_obj = (saved_doc or {}).get("sheet_object_name") or ""
        if not sheet_obj:
            return JSONResponse(
                status_code=404,
                content={"error": "저장된 캐릭터 시트가 없습니다."},
            )
        if has_photo:
            logger.info(
                "[ArtistOutfit] use_saved_sheet ignored (file attached) user=%s cid=%s",
                user_id[:8], norm_cid,
            )
        else:
            saved_sheet_bytes, _sheet_mime = _load_item_image(sheet_obj)
            if not saved_sheet_bytes:
                return JSONResponse(
                    status_code=500,
                    content={"error": "저장된 시트 이미지를 불러오지 못했습니다."},
                )
            contents = saved_sheet_bytes
            mime_type = _sheet_mime or "image/png"
            ext = os.path.splitext(sheet_obj)[1].lower() or ".png"
            logger.info(
                "[ArtistOutfit] base=saved_sheet user=%s cid=%s obj=%s bytes=%d",
                user_id[:8], norm_cid, sheet_obj[:80], len(saved_sheet_bytes),
            )

    # Resolve style reference in the handler: uploaded image beats preset.
    style_ref_bytes, style_ref_mime = await _read_optional_image(style_image)
    if style_ref_bytes:
        art_style_label = UPLOADED_STYLE_LABEL
        art_style_key = "uploaded"
    else:
        preset_key = (style_preset or "").strip()
        preset = STYLE_PRESETS.get(preset_key)
        if not preset and use_saved and saved_doc is not None:
            # v223 — 화풍 미전송 시 doc.art_style 로 복원 (화풍 붕괴 금지 — v217 정합):
            # ① 프리셋 역매핑되면 번들 샘플을 reference 로,
            # ② 미매핑(업로드 화풍 등)이면 저장 시트 자체를 화풍 reference 로 사용.
            raw_style = (saved_doc.get("art_style") or "").strip()
            mapped_key = (
                _ART_STYLE_TO_PRESET_KEY.get(raw_style)
                or _ART_STYLE_TO_PRESET_KEY.get(raw_style.lower())
            )
            if mapped_key:
                style_ref_bytes = _load_style_preset_bytes(mapped_key)
            if style_ref_bytes is not None:
                style_ref_mime = "image/png"
                art_style_label = STYLE_PRESETS[mapped_key]["art_style_label"]
                art_style_key = mapped_key
                logger.info(
                    "[ArtistOutfit] style=preset(%s) from art_style=%s user=%s cid=%s",
                    mapped_key, raw_style[:40], user_id[:8], norm_cid,
                )
            elif saved_sheet_bytes is not None:
                style_ref_bytes = saved_sheet_bytes
                style_ref_mime = "image/png"
                art_style_label = (
                    raw_style
                    if raw_style and raw_style.lower() not in ("custom", "uploaded")
                    else UPLOADED_STYLE_LABEL
                )
                art_style_key = "saved_sheet"
                logger.info(
                    "[ArtistOutfit] style=saved_sheet label=%s user=%s cid=%s",
                    art_style_label[:40], user_id[:8], norm_cid,
                )
            else:
                return JSONResponse(
                    status_code=400,
                    content={
                        "error": "화풍을 선택하거나 화풍 이미지를 업로드해주세요. "
                                 "(style_preset: webtoon|anime|manga90 또는 style_image)"
                    },
                )
        elif not preset:
            return JSONResponse(
                status_code=400,
                content={
                    "error": "화풍을 선택하거나 화풍 이미지를 업로드해주세요. "
                             "(style_preset: webtoon|anime|manga90 또는 style_image)"
                },
            )
        else:
            style_ref_bytes = _load_style_preset_bytes(preset_key)
            if style_ref_bytes is None:
                logger.error(
                    "generate-sheet-cartoon-async: bundled style sample missing key=%s user=%s",
                    preset_key, user_id,
                )
                return JSONResponse(
                    status_code=500,
                    content={"error": "화풍 샘플 이미지를 로드하지 못했습니다."},
                )
            style_ref_mime = "image/png"
            art_style_label = preset["art_style_label"]
            art_style_key = preset_key

    # Points — 검증 통과 후 job 접수 전 2포인트 선차감 (부족 시 402, job 미생성).
    point_ref = uuid_lib.uuid4().hex
    mongo = get_mongo()
    # v3.227 — 재확인 + 차감 + 접수를 사용자 락 안에서 (동시 요청 2건의 이중 접수·이중 과금 차단).
    async with _user_gen_lock(user_id):
        _active = await _find_active_job(mongo, user_id)
        if _active is not None:
            logger.info("[CharJob] dup-blocked(race) user=%s job=%s route=generate-sheet-cartoon-async", _u8(user_id), str(_active["_id"]))
            return _in_progress_response(_active)
        if not await spend_points(user_id, "character", CHARACTER_POINT_COST, point_ref):
            return JSONResponse(status_code=402, content=dict(INSUFFICIENT_POINTS_RESPONSE))

        now = datetime.utcnow()
        result = await mongo.character_jobs.insert_one({
            "user_id": user_id,
            "mode": "cartoon",
            "status": "processing",
            "image_model": norm_image_model,
            "art_style": art_style_label,
            "art_style_key": art_style_key,
            "character_id": norm_cid,  # v212 — 재생성 대상 (신규는 None)
            "point_ref": point_ref,
            "refunded": False,
            "consume_tracked": True,  # v3.227 — 소비 표시 추적 대상(배포 이후 job)
            "has_photo": has_photo,
            "created_at": now,
            "updated_at": now,
        })
    job_id = str(result.inserted_id)

    source = "photo+text" if (has_photo and user_text_clean) else ("photo" if has_photo else "text")
    logger.info(
        "[CharJob] job=%s mode=cartoon source=%s status=processing image_model=%s art_style=%s "
        "user=%s items=top:%s/bottom:%s/shoes:%s",
        job_id, source, norm_image_model, art_style_label, user_id, top_src, bottom_src, shoes_src,
    )

    background_tasks.add_task(
        _run_character_job,
        job_id=job_id,
        user_id=user_id,
        mode="cartoon",
        contents=contents,
        mime_type=mime_type,
        ext=ext,
        top_bytes=top_bytes,
        top_mime=top_mime,
        bottom_bytes=bottom_bytes,
        bottom_mime=bottom_mime,
        shoes_bytes=shoes_bytes,
        shoes_mime=shoes_mime,
        user_text=user_text.strip(),
        image_model=norm_image_model,
        art_style_label=art_style_label,
        art_style_key=art_style_key,
        style_ref_bytes=style_ref_bytes,
        style_ref_mime=style_ref_mime,
    )

    return {"job_id": job_id, "status": "processing"}


# ── GET /api/character/job/{job_id} ─────────────────────────────────────────


@router.get("/job/{job_id}")
async def get_character_job(
    job_id: str,
    current_user=Depends(get_current_user),
):
    """Poll an async character sheet job. Own jobs only — invalid/unknown/
    others' ids all return 404 (no existence leak). Recommended interval: 5s."""
    not_found = JSONResponse(
        status_code=404,
        content={"error": "작업을 찾을 수 없습니다."},
    )
    if not ObjectId.is_valid(job_id):
        return not_found

    mongo = get_mongo()
    job = await mongo.character_jobs.find_one({"_id": ObjectId(job_id)})
    if not job or job.get("user_id") != current_user["id"]:
        return not_found

    # debug level — 5s polling would flood info logs.
    logger.debug("[CharJob] poll job=%s status=%s", job_id, job.get("status"))

    def _iso(v):
        return v.isoformat() if isinstance(v, datetime) else None

    resp = {
        "job_id": job_id,
        "mode": job.get("mode"),
        "status": job.get("status"),
        "created_at": _iso(job.get("created_at")),
        "updated_at": _iso(job.get("updated_at")),
    }
    for key in ("object_name", "original_object_name", "preview_url",
                "image_model", "art_style", "art_style_key", "character_id", "error"):
        if job.get(key) is not None:
            resp[key] = job[key]
    if job.get("completed_at") is not None:
        resp["completed_at"] = _iso(job.get("completed_at"))
    # v3.227 — 회수 상태(가산 필드): 이미 저장됐거나 버린 결과인지.
    resp["consumed"] = bool(job.get("consumed_at"))
    resp["dismissed"] = bool(job.get("dismissed_at"))
    if job.get("consumed_character_id"):
        resp["consumed_character_id"] = job["consumed_character_id"]
    if job.get("refunded") is not None:
        resp["refunded"] = bool(job.get("refunded"))
    return resp


# ── v3.227 GET /api/character/jobs/recoverable ──────────────────────────────


def _iso_dt(v):
    return v.isoformat() if isinstance(v, datetime) else None


def _recoverable_item(job: dict) -> dict:
    status = job.get("status")
    item = {
        "job_id": str(job["_id"]),
        "mode": job.get("mode"),
        "status": status,
        "character_id": job.get("character_id"),
        "created_at": _iso_dt(job.get("created_at")),
    }
    if status == "done":
        item.update({
            "object_name": job.get("object_name"),
            "preview_url": job.get("preview_url"),
            "original_object_name": job.get("original_object_name"),
            "has_photo": bool(job.get("original_object_name")),
            "image_model": job.get("image_model"),
            "art_style": job.get("art_style"),
            "art_style_key": job.get("art_style_key"),
            "completed_at": _iso_dt(job.get("completed_at")),
        })
    elif status == "processing":
        created = job.get("created_at")
        if isinstance(created, datetime):
            item["elapsed_sec"] = max(0, int((datetime.utcnow() - created).total_seconds()))
        item["has_photo"] = job.get("has_photo")
    elif status == "failed":
        item.update({
            "error": (job.get("error") or "")[:200],
            "refunded": bool(job.get("refunded")),
            "updated_at": _iso_dt(job.get("updated_at")),
        })
    return item


@router.get("/jobs/recoverable")
async def list_recoverable_jobs(current_user=Depends(get_current_user)):
    """v3.227 — 내 미소비 생성 결과(done) + 진행 중(processing) + 최근 실패(failed, 24h).

    - done: consumed_at·dismissed_at 없음, created_at >= RECOVERABLE_SINCE (보관 기간 무제한).
      배포 이전 job(consume_tracked 없음)은 저장된 시트와 바이트 일치하면 제외.
    - 조회 시 30분 넘은 processing 은 즉시 failed + 1회 환불(lazy — 재기동 불필요).
    - 최신순, done+processing 최대 RECOVERABLE_LIST_LIMIT 건 + failed 최대 5건.
    Response: {"jobs": [...], "count": n, "stale_fixed": k}
    """
    user_id = current_user["id"]
    mongo = get_mongo()
    await _ensure_job_indexes(mongo)
    stale_fixed = await _sweep_stale_jobs(mongo, user_id)

    base = {
        "user_id": user_id,
        "created_at": {"$gte": RECOVERABLE_SINCE},
        "consumed_at": {"$exists": False},
        "dismissed_at": {"$exists": False},
    }
    live: list = []
    minio_client = None
    sheet_stats = None
    legacy_hidden = 0
    cursor = mongo.character_jobs.find(
        {**base, "status": {"$in": ["processing", "done"]}},
    ).sort("created_at", -1).limit(RECOVERABLE_LIST_LIMIT * 3)
    async for job in cursor:
        if job.get("status") == "done" and not job.get("consume_tracked"):
            if minio_client is None:
                minio_client = get_minio()
            saved, sheet_stats = await _legacy_job_already_saved(mongo, minio_client, job, sheet_stats)
            if saved:
                legacy_hidden += 1
                continue
        live.append((job.get("created_at") or datetime.min, _recoverable_item(job)))
        if len(live) >= RECOVERABLE_LIST_LIMIT:
            break

    failed: list = []
    fail_cutoff = datetime.utcnow() - timedelta(hours=RECOVERABLE_FAILED_HOURS)
    async for job in mongo.character_jobs.find(
        {**base, "status": "failed", "updated_at": {"$gte": fail_cutoff}},
    ).sort("created_at", -1).limit(5):
        failed.append((job.get("created_at") or datetime.min, _recoverable_item(job)))

    merged = sorted(live + failed, key=lambda t: t[0], reverse=True)
    jobs = [item for _, item in merged]
    logger.info(
        "[CharJob] recoverable user=%s n=%d done=%d processing=%d failed=%d stale_fixed=%d legacy_hidden=%d",
        _u8(user_id), len(jobs),
        sum(1 for _, j in live if j["status"] == "done"),
        sum(1 for _, j in live if j["status"] == "processing"),
        len(failed), stale_fixed, legacy_hidden,
    )
    return {"jobs": jobs, "count": len(jobs), "stale_fixed": stale_fixed}


# ── v3.227 POST /api/character/job/{job_id}/dismiss ─────────────────────────


@router.post("/job/{job_id}/dismiss")
async def dismiss_character_job(job_id: str, current_user=Depends(get_current_user)):
    """v3.227 — 결과 버리기(회수 목록에서 숨김). 본인 done/failed job 만, 환불 없음.

    404 = 형식 오류·없음·타인 job (존재 비노출), 409 job_processing = 아직 생성 중.
    이미 버렸거나 저장된 job 은 200 (멱등).
    """
    not_found = JSONResponse(status_code=404, content={"error": "작업을 찾을 수 없습니다."})
    if not ObjectId.is_valid(job_id):
        return not_found
    user_id = current_user["id"]
    mongo = get_mongo()
    job = await mongo.character_jobs.find_one({"_id": ObjectId(job_id)})
    if not job or job.get("user_id") != user_id:
        return not_found
    status = job.get("status")
    if status == "processing":
        return JSONResponse(
            status_code=409,
            content={"error": "job_processing", "message": "아직 만드는 중인 작업은 버릴 수 없어요."},
        )
    if job.get("dismissed_at") or job.get("consumed_at"):
        return {
            "job_id": job_id, "status": status, "dismissed": bool(job.get("dismissed_at")),
            "consumed": bool(job.get("consumed_at")), "already": True,
        }
    await mongo.character_jobs.update_one(
        {"_id": job["_id"], "dismissed_at": {"$exists": False}},
        {"$set": {"dismissed_at": datetime.utcnow(), "updated_at": datetime.utcnow()}},
    )
    logger.info("[CharJob] dismissed job=%s user=%s status=%s", job_id, _u8(user_id), status)
    return {"job_id": job_id, "status": status, "dismissed": True, "consumed": False, "already": False}


# ── POST /api/character/refine ─────────────────────────────────────────────


@router.post("/refine")
async def refine_sheet(
    sheet_image: UploadFile = File(...),
    photo: UploadFile = File(...),
    refine_request: str = Form(...),
    image_model: str = Form("nb_pro"),
    # v217 — 판별 1순위: 아티스트 kind 정본 (real→gpt_image_2 / virtual→nb_pro). 전송 권장.
    character_id: Optional[str] = Form(None),
    current_user=Depends(get_current_user),
):
    """Refine an existing character sheet based on user's modification request.

    v217 [ModelPin] — refine 모델 3순위 자동 판별 (수신값 무효여도 400 없음):
      ① character_id 지정 → (user, cid) 아티스트 kind 가 정본 (부재·타인 404)
      ② 미지정 → 수신 image_model 정규화값 재해석 (v55 echo 관행 — 고정 체제에선
        generate 응답 echo 가 곧 고정 모델이라 자동 수렴)
      ③ 무효·누락 → nb_pro 폴백 (400 분기 소멸)
    """
    # v3.232 F4 — 어린이 다듬기(photo 필수 = 얼굴 사진 입구) 차단 — ⭐ 차감 전. OFF 면 DB 0회.
    _kids_block = await kids_policy.kids_guard(current_user["id"], "character_photo")
    if _kids_block is not None:
        return _kids_block
    _refine_cid = (character_id or "").strip()
    if _refine_cid:
        _mongo_for_kind = get_mongo()
        _artist = await _find_artist_by_cid(_mongo_for_kind, current_user["id"], _refine_cid)
        if not _artist:
            logger.warning(
                "[ModelPin] refine cid not found user=%s cid=%s",
                str(current_user["id"])[:8], _refine_cid[:36],
            )
            return JSONResponse(status_code=404, content={"error": "아티스트를 찾을 수 없습니다."})
        _kind = _artist.get("kind") or "real"
        norm_image_model = _forced_sheet_model("cartoon" if _kind == "virtual" else "real")
        logger.info(
            "[ModelPin] refine model=%s via character_id kind=%s cid=%s user=%s",
            norm_image_model, _kind, _artist["character_id"], str(current_user["id"])[:8],
        )
    else:
        _norm = _normalize_image_model(image_model)
        if _norm is not None:
            # ② echo 재해석 (누락/공백은 _normalize 가 nb_pro 로 수렴 — ③과 동일 결과)
            norm_image_model = _norm
            logger.info(
                "[ModelPin] refine model=%s via echo recv=%s user=%s",
                norm_image_model, (image_model or "")[:24], str(current_user["id"])[:8],
            )
        else:
            # ③ 무효값 → nb_pro 폴백 (구 400 소멸)
            norm_image_model = CARTOON_SHEET_MODEL
            logger.warning(
                "[ModelPin] refine invalid recv=%s -> fallback %s user=%s",
                (image_model or "")[:24], norm_image_model, str(current_user["id"])[:8],
            )
    # 키 가드 — 결정된 모델 것만
    if norm_image_model == "nb_pro" and not settings.google_api_key:
        return JSONResponse(
            status_code=503,
            content={"error": "Google API 키가 설정되지 않았습니다."},
        )
    if norm_image_model == "gpt_image_2" and not settings.openai_api_key:
        return JSONResponse(
            status_code=503,
            content={"error": "OpenAI API 키가 설정되지 않았습니다."},
        )

    # Read sheet image
    sheet_bytes = await sheet_image.read()
    if len(sheet_bytes) > MAX_IMAGE_SIZE or len(sheet_bytes) == 0:
        return JSONResponse(
            status_code=400,
            content={"error": "캐릭터 시트 이미지가 유효하지 않습니다."},
        )

    # Read original photo
    photo_ext = os.path.splitext(photo.filename or "")[1].lower()
    if photo_ext not in ALLOWED_IMAGE_EXT:
        return JSONResponse(
            status_code=400,
            content={"error": "허용되지 않는 이미지 형식입니다. (jpg, png, webp)"},
        )
    photo_bytes = await photo.read()
    if len(photo_bytes) > MAX_IMAGE_SIZE or len(photo_bytes) == 0:
        return JSONResponse(
            status_code=400,
            content={"error": "사진 이미지가 유효하지 않습니다."},
        )
    photo_mime = mimetypes.guess_type(photo.filename or "")[0] or "image/jpeg"

    if not refine_request.strip():
        return JSONResponse(
            status_code=400,
            content={"error": "수정 요청 내용을 입력해주세요."},
        )

    # Call refine service
    try:
        from ..services.character_generator import refine_character_sheet

        refined_bytes = await refine_character_sheet(
            current_sheet_bytes=sheet_bytes,
            photo_bytes=photo_bytes,
            photo_mime=photo_mime,
            refine_request=refine_request.strip(),
            image_model=norm_image_model,
        )
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": "캐릭터 시트 수정 실패: {}".format(str(e)[:200])},
        )

    # Save refined sheet to MinIO (temp location)
    user_id = current_user["id"]
    sheet_object = "characters/temp/{}/{}.png".format(
        user_id, uuid_lib.uuid4().hex
    )
    minio_client = get_minio()
    minio_client.put_object(
        bucket_name=settings.minio_bucket_images,
        object_name=sheet_object,
        data=io.BytesIO(refined_bytes),
        length=len(refined_bytes),
        content_type="image/png",
    )

    preview_url = "/api/character/preview/{}".format(sheet_object)

    return {
        "object_name": sheet_object,
        "preview_url": preview_url,
        "image_model": norm_image_model,  # v55
        "message": "캐릭터 시트가 수정되었습니다.",
    }


# ── POST /api/character/save ────────────────────────────────────────────────


@router.post("/save")
async def save_character(
    body: SaveCharacterRequest,
    current_user=Depends(get_current_user),
):
    """Save generated character sheet as the user's character."""
    user_id = current_user["id"]
    minio_client = get_minio()
    mongo = get_mongo()

    name_val = (body.name or "").strip()
    age_val = (body.age or "").strip()
    personality_text_val = (body.personality_text or "").strip()
    raw_tags = body.personality_tags or []
    personality_tags_val = [t.strip() for t in raw_tags if isinstance(t, str) and t.strip()]

    if len(name_val) > NAME_MAX_LEN:
        return JSONResponse(
            status_code=400,
            content={"error": "이름은 {}자 이하여야 합니다.".format(NAME_MAX_LEN)},
        )
    if len(age_val) > AGE_MAX_LEN:
        return JSONResponse(
            status_code=400,
            content={"error": "나이는 {}자 이하여야 합니다.".format(AGE_MAX_LEN)},
        )
    if len(personality_text_val) > PERSONALITY_TEXT_MAX_LEN:
        return JSONResponse(
            status_code=400,
            content={"error": "성격 설명은 {}자 이하여야 합니다.".format(PERSONALITY_TEXT_MAX_LEN)},
        )
    if len(personality_tags_val) > PERSONALITY_TAGS_MAX_COUNT:
        return JSONResponse(
            status_code=400,
            content={"error": "성격 태그는 최대 {}개까지 선택할 수 있습니다.".format(PERSONALITY_TAGS_MAX_COUNT)},
        )
    for tag in personality_tags_val:
        if len(tag) > PERSONALITY_TAG_MAX_LEN:
            return JSONResponse(
                status_code=400,
                content={"error": "각 성격 태그는 {}자 이하여야 합니다.".format(PERSONALITY_TAG_MAX_LEN)},
            )

    # v212 — 성별 (자유 문자열, 빈값 허용, enum 비강제)
    gender_val = (body.gender or "").strip()
    if len(gender_val) > GENDER_MAX_LEN:
        return JSONResponse(
            status_code=400,
            content={"error": "성별은 {}자 이하여야 합니다.".format(GENDER_MAX_LEN)},
        )

    # Verify the temp sheet exists in MinIO (전 경로 공통 선행 검사)
    try:
        stat = minio_client.stat_object(
            bucket_name=settings.minio_bucket_images,
            object_name=body.sheet_object_name,
        )
    except Exception:
        return JSONResponse(
            status_code=404,
            content={"error": "캐릭터 시트 이미지를 찾을 수 없습니다."},
        )

    used_items_data = [item.model_dump() for item in (body.used_items or [])]

    # v212 — kind 정규화 (지정 시에만 유효성 검사)
    kind_val = (body.kind or "").strip().lower()
    if kind_val and kind_val not in ("real", "virtual"):
        return JSONResponse(
            status_code=400,
            content={"error": "kind 는 'real' 또는 'virtual' 이어야 합니다."},
        )
    cid_val = (body.character_id or "").strip().lower()

    # ── v212 경로 ①: character_id 지정 — 해당 아티스트 시트 교체 + 프로필 전송분 갱신
    if cid_val:
        artist = await _find_artist_by_cid(mongo, user_id, cid_val)
        if not artist:
            logger.warning("[ArtistV212] save cid not found user=%s cid=%s", user_id[:8], cid_val[:36])
            return JSONResponse(status_code=404, content={"error": "아티스트를 찾을 수 없습니다."})
        if kind_val and kind_val != (artist.get("kind") or "real"):
            return JSONResponse(
                status_code=400,
                content={"error": "아티스트 종류(kind)는 변경할 수 없습니다."},
            )
        permanent_object = "characters/{}/{}/sheet.png".format(user_id, artist["character_id"])
        _copy_sheet_to_permanent(minio_client, body.sheet_object_name, permanent_object)

        set_fields = {"sheet_object_name": permanent_object, "updated_at": datetime.utcnow()}
        if body.used_items is not None:
            set_fields["used_items"] = used_items_data
        if body.name is not None:
            set_fields["name"] = name_val
        if body.age is not None:
            set_fields["age"] = age_val
        if body.gender is not None:
            set_fields["gender"] = gender_val
        if body.personality_tags is not None:
            set_fields["personality_tags"] = personality_tags_val
        if body.personality_text is not None:
            set_fields["personality_text"] = personality_text_val
        if body.art_style is not None and (artist.get("kind") or "real") == "virtual":
            set_fields["art_style"] = (body.art_style or "").strip()
        # v223(B-14 잔여 해소) — 원본 사진 persist 의 kind=real 제한 제거:
        # 가상(virtual) 아티스트도 사진 기반 생성이면 원본 사진을 보존한다.
        if body.original_photo_object_name:
            set_fields["original_photo_object_name"] = body.original_photo_object_name
        if body.image_model:
            _norm = _normalize_image_model(body.image_model)
            if _norm:
                set_fields["image_model"] = _norm

        # v213 — persona 연결/해제 (None=유지 / ""=해제 / clone_id=연결)
        _p_err, _p_action, _p_set = await _validate_persona_link(
            mongo, user_id, body.persona_id, body.persona_model,
            currently_linked=bool(artist.get("persona_id")),
        )
        if _p_err is not None:
            return _p_err
        if _p_action == "set":
            set_fields.update(_p_set)
            logger.info(
                "[VoiceLink] save link user=%s cid=%s clone=%s",
                user_id[:8], artist["character_id"], _p_set.get("persona_id"),
            )
        _update_doc = {"$set": set_fields}
        if _p_action == "unset":
            _update_doc["$unset"] = {"persona_id": "", "persona_model": ""}
            logger.info(
                "[VoiceLink] save unlink user=%s cid=%s prev_clone=%s",
                user_id[:8], artist["character_id"], artist.get("persona_id"),
            )

        await mongo.characters.update_one({"_id": artist["_id"]}, _update_doc)
        if "name" in set_fields:  # v3.229 N2 — 재생성 저장에서 이름을 바꾼 경우도 곡 표기 따라감
            await _sync_artist_name_if_changed(
                mongo, user_id, artist["character_id"], artist.get("name"), set_fields["name"], "save",
            )
        saved = await mongo.characters.find_one({"_id": artist["_id"]})
        logger.info(
            "[ArtistV212] save path=1(update) user=%s cid=%s kind=%s fields=%s",
            user_id[:8], artist["character_id"], artist.get("kind"),
            sorted(k for k in set_fields if k != "updated_at"),
        )
        # v3.227 — 소비 표시(best-effort, 같은 시트 재저장은 덮어쓰기라 멱등)
        _consumed_job = await _mark_job_consumed(mongo, user_id, body.sheet_object_name, artist["character_id"], "save:update")
        await _outfit_follow_after_save(mongo, user_id, artist["character_id"], _consumed_job, "save:update")  # v3.235 S6
        resp = _serialize_artist(saved, await _resolve_persona_clone(mongo, saved))
        resp["message"] = "아티스트가 저장되었습니다."
        return resp

    # ── v212 경로 ②: kind 지정 (신규 아티스트) — 슬롯 검사 (초과 409)
    if kind_val:
        from ..services.slots_service import check_slot_available, get_slots

        # v3.227 — 저장 재시도 멱등: 이미 소비된 job 결과(consumed_character_id 의 아티스트 존재)면
        # 슬롯 검사 **전에** already_saved 로 반환한다. (마지막 슬롯을 채운 저장의 재시도가
        # 슬롯 409 로 떨어지지 않게 — 신규 저장의 슬롯 검사는 아래에서 그대로 수행)
        _prev_saved = await _already_saved_artist_response(mongo, user_id, body.sheet_object_name)
        if _prev_saved is not None:
            return _prev_saved

        # 슬롯 검사는 단일 관문(check_slot_available) 경유 — generate 미지정과 동일 409
        _slot_err = await check_slot_available(user_id)
        if _slot_err is not None:
            logger.info("[ArtistV212] save path=2 slot 409 user=%s", user_id[:8])
            return _slot_err
        used, mx = await get_slots(user_id)  # is_default 판정·로그용

        # v213 — 신규 생성 시 persona 동시 연결 허용 (""/None 은 미연결,
        # persona_model 단독은 미연결 상태라 400 — 헬퍼 공용 규약)
        _p_err, _p_action, _p_set = await _validate_persona_link(
            mongo, user_id, body.persona_id, body.persona_model,
            currently_linked=False,
        )
        if _p_err is not None:
            return _p_err

        # v3.227 — 이중 저장 차단: 같은 job 결과로 신규 아티스트가 두 번 생기지 않게 원자적 claim.
        # 이미 저장된 결과면 기존 아티스트를 그대로 돌려준다(200, already_saved=true — 멱등).
        _claim_state, _claim_job = await _claim_job_for_new_artist(mongo, user_id, body.sheet_object_name)
        if _claim_state == "saved":
            _prev_saved = await _already_saved_artist_response(mongo, user_id, body.sheet_object_name, _claim_job)
            if _prev_saved is not None:
                return _prev_saved
            # 저장됐던 아티스트가 이후 삭제됨 — 다시 저장 허용(새 cid 로 소비 표시 갱신).
            _claim_state = "claimed"
        elif _claim_state == "busy":
            logger.info("[CharJob] save busy job=%s user=%s", str(_claim_job.get("_id")), _u8(user_id))
            return JSONResponse(
                status_code=409,
                content={"error": "save_in_progress", "message": "저장 중이에요. 잠시 후 다시 시도해주세요."},
            )

        new_cid = uuid_lib.uuid4().hex
        permanent_object = "characters/{}/{}/sheet.png".format(user_id, new_cid)
        try:
            _copy_sheet_to_permanent(minio_client, body.sheet_object_name, permanent_object)
        except Exception:
            if _claim_state == "claimed" and _claim_job is not None:
                await _release_job_claim(mongo, _claim_job["_id"])
            raise

        now = datetime.utcnow()
        new_doc = {
            "user_id": user_id,
            "character_id": new_cid,
            "kind": kind_val,
            "is_default": used == 0,  # 계정 첫 아티스트
            "name": name_val,
            "age": age_val,
            "gender": gender_val,
            "personality_tags": personality_tags_val,
            "personality_text": personality_text_val,
            "sheet_object_name": permanent_object,
            "used_items": used_items_data,
            "art_style": (body.art_style or "").strip() if kind_val == "virtual" else "",
            "image_model": _normalize_image_model(body.image_model) or "nb_pro",
            # v223(B-14) — kind 무관 persist (virtual 도 사진 기반 생성이면 보존)
            "original_photo_object_name": body.original_photo_object_name or "",
            "created_at": now,
            "updated_at": now,
        }
        if _p_action == "set":
            new_doc.update(_p_set)
            logger.info(
                "[VoiceLink] save link user=%s cid=%s clone=%s (create)",
                user_id[:8], new_cid, _p_set.get("persona_id"),
            )
        try:
            await mongo.characters.insert_one(new_doc)
        except Exception:
            if _claim_state == "claimed" and _claim_job is not None:
                await _release_job_claim(mongo, _claim_job["_id"])
            raise
        if _claim_job is not None:
            await _mark_job_consumed(mongo, user_id, body.sheet_object_name, new_cid, "save:create")
        logger.info(
            "[ArtistV212] save path=2(create) user=%s cid=%s kind=%s is_default=%s used=%d/%d",
            user_id[:8], new_cid, kind_val, new_doc["is_default"], used + 1, mx,
        )
        resp = _serialize_artist(new_doc, await _resolve_persona_clone(mongo, new_doc))
        resp["message"] = "아티스트가 저장되었습니다."
        return resp

    # ── 경로 ③: legacy (variant 계약 — 슬롯 검사 면제, 구계약 100% 보존) ──────
    # 가상화 분리: variant='virtual' 이면 별도 슬롯(sheet_virtual.png)에 저장하고
    # virtual_* 필드만 갱신 — 실사 슬롯(sheet_object_name 등)은 절대 건드리지 않는다.
    variant = (body.variant or "real").strip().lower()
    if variant not in ("real", "virtual"):
        return JSONResponse(
            status_code=400,
            content={"error": "variant 는 'real' 또는 'virtual' 이어야 합니다."},
        )
    is_virtual = variant == "virtual"

    # v212 — 마이그레이션 후 계정(cid 문서 보유): legacy 호출을 해당 kind 대표
    # 아티스트로 라우팅 (없으면 신규 doc — 자연 상한 real1+virtual1, 슬롯 면제).
    has_cid_docs = await mongo.characters.count_documents(
        {"user_id": user_id, "character_id": {"$exists": True, "$ne": None}}
    ) > 0
    if has_cid_docs:
        reps = await resolve_representative_artists(mongo, user_id)
        rep = reps.get(variant)
        rep_cid = rep.get("character_id") if rep else None
        if rep_cid:
            permanent_object = "characters/{}/{}/sheet.png".format(user_id, rep_cid)
            _copy_sheet_to_permanent(minio_client, body.sheet_object_name, permanent_object)
            set_fields = {
                "sheet_object_name": permanent_object,
                "used_items": used_items_data,
                "updated_at": datetime.utcnow(),
            }
            if is_virtual:
                set_fields["art_style"] = (body.art_style or "").strip()
                # v223(B-14) — virtual 대표(cid doc)도 원본 사진 persist (별도 doc — 안전)
                if body.original_photo_object_name:
                    set_fields["original_photo_object_name"] = body.original_photo_object_name
            else:
                # legacy real semantics — 항상 set (현행과 동일)
                set_fields.update({
                    "name": name_val,
                    "age": age_val,
                    "personality_tags": personality_tags_val,
                    "personality_text": personality_text_val,
                })
                if body.original_photo_object_name:
                    set_fields["original_photo_object_name"] = body.original_photo_object_name
            if body.image_model:
                _norm = _normalize_image_model(body.image_model)
                if _norm:
                    set_fields["image_model"] = _norm
            await mongo.characters.update_one(
                {"user_id": user_id, "character_id": rep_cid}, {"$set": set_fields}
            )
            if "name" in set_fields:  # v3.229 N2 — 레거시 저장 경로(실사 대표)의 이름 변경도 동일 처리
                await _sync_artist_name_if_changed(
                    mongo, user_id, rep_cid, rep.get("name"), set_fields["name"], "legacy_save",
                )
            target_cid = rep_cid
        else:
            # 해당 kind 대표 없음 — 신규 doc 생성 (슬롯 면제)
            target_cid = uuid_lib.uuid4().hex
            permanent_object = "characters/{}/{}/sheet.png".format(user_id, target_cid)
            _copy_sheet_to_permanent(minio_client, body.sheet_object_name, permanent_object)
            has_default = await mongo.characters.count_documents(
                {"user_id": user_id, "is_default": True}
            ) > 0
            now = datetime.utcnow()
            await mongo.characters.insert_one({
                "user_id": user_id,
                "character_id": target_cid,
                "kind": variant,
                "is_default": not has_default,
                "name": name_val if not is_virtual else "",
                "age": age_val if not is_virtual else "",
                "gender": gender_val,
                "personality_tags": personality_tags_val if not is_virtual else [],
                "personality_text": personality_text_val if not is_virtual else "",
                "sheet_object_name": permanent_object,
                "used_items": used_items_data,
                "art_style": (body.art_style or "").strip() if is_virtual else "",
                "image_model": _normalize_image_model(body.image_model) or "nb_pro",
                # v223(B-14) — kind 무관 persist (cid 신규 doc — 실사 슬롯과 분리돼 안전)
                "original_photo_object_name": body.original_photo_object_name or "",
                "created_at": now,
                "updated_at": now,
            })
        logger.info(
            "[ArtistV212] save path=3(legacy->cid) user=%s variant=%s cid=%s",
            user_id[:8], variant, target_cid,
        )
        saved_doc = await mongo.characters.find_one({"user_id": user_id, "character_id": target_cid}) or {}
        _consumed_job = await _mark_job_consumed(mongo, user_id, body.sheet_object_name, target_cid, "save:legacy")
        await _outfit_follow_after_save(mongo, user_id, target_cid, _consumed_job, "save:legacy")  # v3.235 S6
        if is_virtual:
            return {
                "variant": "virtual",
                "virtual_sheet_object_name": permanent_object,
                "virtual_art_style": saved_doc.get("art_style") or "",
                "sheet_object_name": (reps.get("real") or {}).get("sheet_object_name") or "",
                "character_id": target_cid,
                "message": "가상화 캐릭터가 저장되었습니다.",
            }
        return {
            "variant": "real",
            "sheet_object_name": permanent_object,
            "name": saved_doc.get("name") or "",
            "age": saved_doc.get("age") or "",
            "personality_tags": saved_doc.get("personality_tags") or [],
            "personality_text": saved_doc.get("personality_text") or "",
            "original_photo_object_name": saved_doc.get("original_photo_object_name") or "",
            "character_id": target_cid,
            "message": "캐릭터가 저장되었습니다.",
        }

    # ── legacy 원형 (마이그레이션 전 계정 — 기존 코드 보존) ──────────────────
    # Copy to permanent location (separate slot for virtual).
    if is_virtual:
        permanent_object = "characters/{}/sheet_virtual.png".format(user_id)
    else:
        permanent_object = "characters/{}/sheet.png".format(user_id)

    _copy_sheet_to_permanent(minio_client, body.sheet_object_name, permanent_object)

    if is_virtual:
        # virtual 슬롯: 실사 필드(sheet_object_name/used_items/name/age/...) 절대 미변경.
        set_fields = {
            "user_id": user_id,
            "virtual_sheet_object_name": permanent_object,
            "virtual_art_style": (body.art_style or "").strip(),
            "virtual_used_items": used_items_data,
            "updated_at": datetime.utcnow(),
        }
    else:
        set_fields = {
            "user_id": user_id,
            "sheet_object_name": permanent_object,
            "used_items": used_items_data,
            "name": name_val,
            "age": age_val,
            "personality_tags": personality_tags_val,
            "personality_text": personality_text_val,
            "updated_at": datetime.utcnow(),
        }
        # v40-3: only persist original_photo_object_name when the client supplied
        # one (else leave any existing value intact — the original photo upload
        # endpoint may have already set it).
        if body.original_photo_object_name:
            set_fields["original_photo_object_name"] = body.original_photo_object_name

        # v55: image_model 영속화. 유효한 enum 만 저장, 잘못된 값은 무시(기존값 유지).
        if body.image_model:
            _norm = _normalize_image_model(body.image_model)
            if _norm:
                set_fields["image_model"] = _norm

    await mongo.characters.update_one(
        {"user_id": user_id},
        {
            "$set": set_fields,
            "$setOnInsert": {
                "created_at": datetime.utcnow(),
            },
        },
        upsert=True,
    )

    # Re-read so we can return the (possibly previously-set) original photo
    # object name to the client.
    saved = await mongo.characters.find_one({"user_id": user_id}) or {}
    await _mark_job_consumed(mongo, user_id, body.sheet_object_name, saved.get("character_id"), "save:legacy0")

    if is_virtual:
        logger.info(
            "save_character: variant=virtual user=%s art_style=%s",
            user_id, set_fields["virtual_art_style"],
        )
        return {
            "variant": "virtual",
            "virtual_sheet_object_name": permanent_object,
            "virtual_art_style": set_fields["virtual_art_style"],
            # 실사 슬롯은 그대로 — 클라이언트 확인용으로 함께 반환.
            "sheet_object_name": saved.get("sheet_object_name") or "",
            "character_id": saved.get("character_id"),  # v212 — legacy doc 은 None (무해 추가)
            "message": "가상화 캐릭터가 저장되었습니다.",
        }

    return {
        "variant": "real",
        "sheet_object_name": permanent_object,
        "name": name_val,
        "age": age_val,
        "personality_tags": personality_tags_val,
        "personality_text": personality_text_val,
        "original_photo_object_name": saved.get("original_photo_object_name") or "",
        "character_id": saved.get("character_id"),  # v212 — legacy doc 은 None (무해 추가)
        "message": "캐릭터가 저장되었습니다.",
    }


# ── GET /api/character/me ───────────────────────────────────────────────────


@router.get("/me")
async def get_my_character(
    current_user=Depends(get_current_user),
):
    """Get current user's saved character.

    v212 — 아티스트 다중화 하위호환 조립 (PLAN D4): 대표 real 아티스트 →
    top-level 필드, 대표 virtual 아티스트 → virtual_* 필드. 응답 shape 는
    기존 100% 유지 + character_id / characters_count / gender 추가(무해).
    """
    mongo = get_mongo()
    user_id = current_user["id"]
    reps = await resolve_representative_artists(mongo, user_id)
    real = reps.get("real")
    virtual = reps.get("virtual")

    if not real and not virtual:
        return {"character": None}

    from ..services.slots_service import count_used_slots

    characters_count = await count_used_slots(user_id)

    profile_src = real or virtual  # real 전무 시 virtual 프로필 폴백 (legacy 단일 doc 동작 동등)
    meta_doc = (profile_src or {}).get("_doc") or {}

    sheet_object_name = (real or {}).get("sheet_object_name") or None
    sheet_url = "/api/character/preview/{}".format(sheet_object_name) if sheet_object_name else None

    virtual_sheet_object_name = (virtual or {}).get("sheet_object_name") or ""
    virtual_sheet_url = (
        "/api/character/preview/{}".format(virtual_sheet_object_name)
        if virtual_sheet_object_name else None
    )

    return {
        "character": {
            # v212 픽스: 구 키 user_id 복원 (planner 판정 — 미러링 표면 보존)
            "user_id": user_id,
            "sheet_object_name": sheet_object_name,
            "sheet_url": sheet_url,
            "used_items": (real or {}).get("used_items") or [],
            # 가상화(그림/만화 화풍) 슬롯 (없으면 빈값).
            "virtual_sheet_object_name": virtual_sheet_object_name,
            "virtual_sheet_url": virtual_sheet_url,
            "virtual_art_style": (virtual or {}).get("art_style") or "",
            "virtual_used_items": (virtual or {}).get("used_items") or [],
            "name": profile_src.get("name") or "",
            "age": profile_src.get("age") or "",
            "gender": profile_src.get("gender") or "",  # v212 신규 (무해 추가)
            "personality_tags": profile_src.get("personality_tags") or [],
            "personality_text": profile_src.get("personality_text") or "",
            # original photo object name (preserved for compatibility)
            "original_photo_object_name": profile_src.get("original_photo_object_name") or "",
            # v55: 마지막 사용한 이미지 생성 모델. 옛 도큐먼트는 기본 "nb_pro".
            "image_model": profile_src.get("image_model") or "nb_pro",
            "created_at": meta_doc.get("created_at").isoformat() if meta_doc.get("created_at") else None,
            "updated_at": meta_doc.get("updated_at").isoformat() if meta_doc.get("updated_at") else None,
            # v212 — 대표 real 아티스트 id (legacy doc 은 None) + 보유 아티스트 수
            "character_id": (real or {}).get("character_id"),
            "virtual_character_id": (virtual or {}).get("character_id"),
            "characters_count": characters_count,
            # v213 — 대표(profile_src) 아티스트의 목소리 연결 5키 (additive):
            # persona_id(clone_id)/persona_model/persona_name/persona_voice_id/persona_status
            **_persona_fields(meta_doc, await _resolve_persona_clone(mongo, meta_doc)),
        }
    }


# ── DELETE /api/character/me ────────────────────────────────────────────────


@router.delete("/me")
async def delete_my_character(
    current_user=Depends(get_current_user),
):
    """Delete current user's character.

    v137 ②: 원본 사진(original_photo_object_name)도 반드시 동반 삭제.
    `characters/{user_id}/` prefix 일괄 삭제가 기본 커버하지만,
    v40-3 경로로 temp 경로(`characters/temp/{user_id}/original_*`)가 박제된
    도큐먼트는 prefix 밖이라 명시 삭제로 보완한다.
    """
    user_id = current_user["id"]
    mongo = get_mongo()
    minio_client = get_minio()

    # v137 ②: 삭제 전 원본 사진 object name 확보 (doc 삭제 후엔 조회 불가).
    # v212 — 복수 아티스트 doc 전체에서 수집 (구계약 의미 보존: /me 삭제 = 전체 삭제).
    original_photos = set()
    async for _c in mongo.characters.find(
        {"user_id": user_id}, {"original_photo_object_name": 1}
    ):
        if _c.get("original_photo_object_name"):
            original_photos.add(_c["original_photo_object_name"])
    original_photo = next(iter(original_photos), "")

    # Delete from MongoDB — v212: 전체 아티스트 삭제 (delete_one → delete_many)
    result = await mongo.characters.delete_many({"user_id": user_id})
    logger.info("[ArtistV212] delete /me user=%s docs=%d", user_id[:8], result.deleted_count)

    # Delete MinIO objects under characters/{user_id}/
    prefix = "characters/{}/".format(user_id)
    try:
        objects = minio_client.list_objects(
            bucket_name=settings.minio_bucket_images,
            prefix=prefix,
            recursive=True,
        )
        from minio.deleteobjects import DeleteObject

        delete_list = [DeleteObject(obj.object_name) for obj in objects]
        if delete_list:
            errors = minio_client.remove_objects(
                bucket_name=settings.minio_bucket_images,
                delete_object_list=delete_list,
            )
            for err in errors:
                logger.warning("Failed to delete MinIO object: %s", err)
        if original_photo.startswith(prefix):
            logger.info(
                "[character] original_photo_deleted user=%s object=%s (prefix sweep)",
                user_id, original_photo,
            )
    except Exception as e:
        logger.warning("Failed to clean up MinIO objects for character: %s", e)

    # v137 ②: prefix 밖(temp 경로 등)에 저장된 원본 사진 명시 삭제.
    # v212 — 복수 doc 의 원본 전부 순회.
    for _photo in original_photos:
        if not _photo or _photo.startswith(prefix):
            continue
        try:
            minio_client.remove_object(
                bucket_name=settings.minio_bucket_images,
                object_name=_photo,
            )
            logger.info(
                "[character] original_photo_deleted user=%s object=%s (explicit)",
                user_id, _photo,
            )
        except Exception as e:
            logger.warning(
                "[character] original photo delete failed user=%s object=%s: %s",
                user_id, _photo, e,
            )

    return {"message": "캐릭터가 삭제되었습니다."}


# ── GET /api/character/preview/{object_name:path} ───────────────────────────


def _preview_path_invalid(name: str) -> bool:
    """경로 우회 차단: 빈/절대/역슬래시/빈 세그먼트('//')/'.'·'..' 세그먼트."""
    if not name or name.startswith("/") or "\\" in name:
        return True
    return any(seg in ("", ".", "..") for seg in name.split("/"))


def _original_photo_owner(name: str) -> Optional[str]:
    """v3.227 (H-3) — 원본 얼굴 사진 경로면 소유자 uid, 아니면 None.

    대상: characters/{uid}/original*  (upload-original-photo 영구본, 구 고정명 original.{ext} 포함)
          characters/temp/{uid}/original*  (generate 시 temp 원본)
    """
    parts = name.split("/")
    if len(parts) == 3 and parts[0] == "characters" and parts[1] != "temp" and parts[2].startswith("original"):
        return parts[1]
    if len(parts) == 4 and parts[0] == "characters" and parts[1] == "temp" and parts[3].startswith("original"):
        return parts[2]
    return None


async def _preview_viewer_from_header(request: Request) -> tuple:
    """Authorization: Bearer 헤더만 인정(쿼리 ?token= 미허용 — URL/액세스 로그 노출 방지).

    Returns (session|None, reason). get_current_user 와 같은 JWT+Redis 세션 검증.
    """
    auth = request.headers.get("authorization") or ""
    if not auth.startswith("Bearer "):
        return None, "no_token"
    token = auth[7:].strip()
    if not token:
        return None, "no_token"
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM], options={"verify_exp": True})
    except jwt.InvalidTokenError:
        return None, "bad_token"
    uid = payload.get("id")
    if not uid:
        return None, "bad_token"
    try:
        from ..database.redis import get_redis

        raw = await get_redis().get("session:{}".format(uid))
    except Exception:
        return None, "session_error"
    if not raw:
        return None, "no_session"
    try:
        session = json.loads(raw)
    except Exception:
        return None, "session_error"
    session.setdefault("role", "user")
    return session, "ok"


@router.get("/preview/{object_name:path}")
async def character_preview(object_name: str, request: Request):
    """Proxy character sheet image from MinIO for external access.

    v3.227 (H-3): 원본 얼굴 사진(characters/[temp/]{uid}/original*)은 **소유자 본인 또는
    관리자**의 Authorization 헤더가 있을 때만 200, 그 외 404(존재 비노출 — faces/ 관행).
    시트·아이템 등 나머지 경로는 기존대로 무인증 공개. media_type 은 매직바이트 판별.
    """
    not_found = JSONResponse(status_code=404, content={"error": "이미지를 찾을 수 없습니다."})
    # FaceGuardSquad(v135) — faces/ 는 암호화 얼굴 데이터(백엔드 전용) 경로. 프록시 노출 금지.
    # TrustSquad(v138) — evidence/ 는 신고 증거 격리 보존 경로(어드민 전용). 동일 차단.
    if object_name.startswith(("faces/", "evidence/")):
        return not_found
    if _preview_path_invalid(object_name):
        logger.info("[PreviewGuard] invalid path rejected len=%d", len(object_name))
        return not_found

    private = False
    owner = _original_photo_owner(object_name)
    if owner is not None:
        viewer, reason = await _preview_viewer_from_header(request)
        if viewer is None:
            logger.info("[PreviewGuard] original denied reason=%s owner=%s", reason, _u8(owner))
            return not_found
        is_admin = viewer.get("role") == "admin"
        if str(viewer.get("id")) != owner and not is_admin:
            logger.info(
                "[PreviewGuard] original denied reason=not_owner viewer=%s owner=%s",
                _u8(viewer.get("id")), _u8(owner),
            )
            return not_found
        private = True
        logger.info(
            "[PreviewGuard] original allowed viewer=%s owner=%s admin=%s",
            _u8(viewer.get("id")), _u8(owner), is_admin,
        )

    minio_client = get_minio()
    try:
        response = minio_client.get_object(
            bucket_name=settings.minio_bucket_images,
            object_name=object_name,
        )
        data = response.read()
        response.close()
        response.release_conn()
    except Exception:
        return not_found
    headers = {"Cache-Control": "private, no-store"} if private else None
    return Response(content=data, media_type=_sniff_image_mime(data) or "image/png", headers=headers)


# ── v42: User Location Library (CRUD) ───────────────────────────────────────
#
# 사용자가 등록한 실제 장소 사진을 라이브러리에 보관하고, 커버/MV 생성 시
# Mode B 앵커로 사용한다. Mongo 컬렉션: `character_locations`.
# MinIO 경로: `characters/{user_id}/locations/{loc_id_hex}{ext}`.

LOCATION_NAME_MAX_LEN = 50


async def _load_user_location(mongo, user_id: str, location_id: str) -> Optional[dict]:
    """Load a location document owned by `user_id` and return its bytes + meta.

    Returns dict {name, object_name, image_bytes} on success, or None when
    the id is invalid, the document does not exist, or it belongs to another
    user. Used by upload.py / mv.py to wire user locations into cover and MV
    generation.
    """
    if not location_id or not ObjectId.is_valid(location_id):
        return None
    oid = ObjectId(location_id)
    doc = await mongo.character_locations.find_one({"_id": oid, "user_id": user_id})
    if not doc:
        return None
    object_name = doc.get("object_name")
    if not object_name:
        return None
    image_bytes = None
    try:
        minio_client = get_minio()
        resp = minio_client.get_object(
            bucket_name=settings.minio_bucket_images,
            object_name=object_name,
        )
        image_bytes = resp.read()
        resp.close()
        resp.release_conn()
    except Exception as e:
        logger.warning("_load_user_location: MinIO read failed for %s: %s", object_name, e)
        return None
    return {
        "name": doc.get("name") or "",
        "object_name": object_name,
        "image_bytes": image_bytes,
    }


@router.post("/locations")
async def create_user_location(
    file: UploadFile = File(...),
    name: str = Form(...),
    current_user=Depends(get_current_user),
):
    """Upload a real-world location photo to the user's location library."""
    # v3.232 F4 — 어린이 실제 장소 사진 업로드 차단(파일 읽기 전). OFF 면 DB 0회.
    _kids_block = await kids_policy.kids_guard(current_user["id"], "location_photo")
    if _kids_block is not None:
        return _kids_block
    name_val = (name or "").strip()
    if not name_val:
        return JSONResponse(
            status_code=400,
            content={"error": "장소 이름을 입력해주세요."},
        )
    if len(name_val) > LOCATION_NAME_MAX_LEN:
        return JSONResponse(
            status_code=400,
            content={"error": "장소 이름은 {}자 이하여야 합니다.".format(LOCATION_NAME_MAX_LEN)},
        )

    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_IMAGE_EXT:
        return JSONResponse(
            status_code=400,
            content={"error": "허용되지 않는 이미지 형식입니다. (jpg, png, webp)"},
        )

    contents = await file.read()
    if len(contents) == 0:
        return JSONResponse(
            status_code=400,
            content={"error": "이미지 파일이 비어 있습니다."},
        )
    if len(contents) > MAX_IMAGE_SIZE:
        return JSONResponse(
            status_code=400,
            content={"error": "이미지 크기는 10MB 이하여야 합니다."},
        )

    mime_type = mimetypes.guess_type(file.filename or "")[0] or "image/jpeg"
    user_id = current_user["id"]

    oid = ObjectId()
    loc_id_hex = str(oid)
    object_name = "characters/{}/locations/{}{}".format(user_id, loc_id_hex, ext)

    minio_client = get_minio()
    try:
        minio_client.put_object(
            bucket_name=settings.minio_bucket_images,
            object_name=object_name,
            data=io.BytesIO(contents),
            length=len(contents),
            content_type=mime_type,
        )
    except Exception as e:
        logger.warning("create_user_location: MinIO put failed: %s", e)
        return JSONResponse(
            status_code=500,
            content={"error": "이미지 업로드에 실패했습니다."},
        )

    mongo = get_mongo()
    now = datetime.utcnow()
    await mongo.character_locations.insert_one({
        "_id": oid,
        "user_id": user_id,
        "name": name_val,
        "object_name": object_name,
        "created_at": now,
    })

    return {
        "id": loc_id_hex,
        "name": name_val,
        "object_name": object_name,
        "preview_url": "/api/character/preview/{}".format(object_name),
    }


@router.get("/locations")
async def list_user_locations(
    current_user=Depends(get_current_user),
):
    """Return the current user's saved location library, newest first."""
    mongo = get_mongo()
    user_id = current_user["id"]
    cursor = mongo.character_locations.find({"user_id": user_id}).sort(
        [("created_at", -1)]
    )
    items = []
    async for doc in cursor:
        object_name = doc.get("object_name") or ""
        created_at = doc.get("created_at")
        items.append({
            "id": str(doc.get("_id")),
            "name": doc.get("name") or "",
            "object_name": object_name,
            "preview_url": "/api/character/preview/{}".format(object_name) if object_name else None,
            "created_at": created_at.isoformat() if created_at else None,
        })
    return {"locations": items}


@router.delete("/locations/{location_id}")
async def delete_user_location(
    location_id: str,
    current_user=Depends(get_current_user),
):
    """Delete a saved location (own only — others' ids return 404)."""
    if not ObjectId.is_valid(location_id):
        return JSONResponse(
            status_code=400,
            content={"error": "유효하지 않은 장소 ID입니다."},
        )
    oid = ObjectId(location_id)
    mongo = get_mongo()
    user_id = current_user["id"]
    doc = await mongo.character_locations.find_one({"_id": oid, "user_id": user_id})
    if not doc:
        return JSONResponse(
            status_code=404,
            content={"error": "장소를 찾을 수 없습니다."},
        )

    # Best-effort MinIO removal (do not fail the request if MinIO is unhappy).
    object_name = doc.get("object_name")
    if object_name:
        try:
            minio_client = get_minio()
            minio_client.remove_object(
                bucket_name=settings.minio_bucket_images,
                object_name=object_name,
            )
        except Exception as e:
            logger.warning(
                "delete_user_location: MinIO remove failed for %s: %s",
                object_name, e,
            )

    await mongo.character_locations.delete_one({"_id": oid, "user_id": user_id})
    return {"message": "장소가 삭제되었습니다."}


# ── v212: 아티스트 다중화 API (PLAN D3) ──────────────────────────────────────
# 라우팅 가드: /{character_id} 계열은 파일 최말미 등록 — 기존 /me /list /job
# /preview /locations /personality-tags /style-samples 가 항상 선행 매치된다.
# 추가로 핸들러 진입 시 32-hex 정규식 불일치 → 404 (형식 위반 = 존재 비노출).


@router.get("/list")
async def list_artists(
    current_user=Depends(get_current_user),
):
    """v212 — 내 아티스트 목록 (cid 보유 문서만, updated_at 최신순) + slots 동봉.

    legacy 무cid 문서는 노출하지 않음 — 마이그레이션 전 계정은 /me 로만 접근.
    """
    from ..services.slots_service import get_slots

    mongo = get_mongo()
    user_id = current_user["id"]
    docs = await mongo.characters.find(
        {"user_id": user_id, "character_id": {"$exists": True, "$ne": None}}
    ).sort("updated_at", -1).to_list(length=None)

    # v213 — persona 파생 필드 배치 resolve: 유저 클론 1회 조회 (N+1 금지).
    # 매칭 실패(dangling)는 _persona_fields 가 persona_status 'missing' 처리 — 무쓰기.
    clone_map: dict = {}
    if any(d.get("persona_id") for d in docs):
        async for _cl in mongo.voice_clones.find(
            {"user_id": user_id},
            {"voice_name": 1, "voice_id": 1, "status": 1},
        ):
            clone_map[str(_cl["_id"])] = _cl

    used, mx = await get_slots(user_id)
    logger.info("[ArtistV212] list user=%s count=%d slots=%d/%d", user_id[:8], len(docs), used, mx)
    return {
        "characters": [
            _serialize_artist(d, clone_map.get(d.get("persona_id") or "")) for d in docs
        ],
        "slots": {"used": used, "max": mx},
    }


class PatchArtistRequest(BaseModel):
    name: Optional[str] = None
    age: Optional[str] = None
    gender: Optional[str] = None
    personality_tags: Optional[List[str]] = None
    personality_text: Optional[str] = None
    is_default: Optional[bool] = None
    # v213 — 목소리 연결: None=유지 / ""=해제 / clone_id=연결 (본인 소유+ready)
    persona_id: Optional[str] = None
    persona_model: Optional[str] = None
    # v231 — 간편 목소리: None=유지 / ""=해제 / "male:소프트"=설정 (persona 와 배타)
    voice_preset: Optional[str] = None


@router.get("/{character_id}")
async def get_artist(
    character_id: str,
    current_user=Depends(get_current_user),
):
    """v212 — 아티스트 단건 (타인/부재/형식 불일치 전부 404 — 존재 비노출)."""
    mongo = get_mongo()
    doc = await _find_artist_by_cid(mongo, current_user["id"], character_id)
    if not doc:
        return JSONResponse(status_code=404, content={"error": "아티스트를 찾을 수 없습니다."})
    return _serialize_artist(doc, await _resolve_persona_clone(mongo, doc))


@router.patch("/{character_id}")
async def patch_artist(
    character_id: str,
    body: PatchArtistRequest,
    current_user=Depends(get_current_user),
):
    """v212 — 프로필 수정 (전송 필드만). kind·sheet 변경 불가 (화이트리스트 외 무시).

    is_default:true → 본 아티스트 set 후 나머지 전부 false.
    is_default:false 단독 → 400 (기본 아티스트 0명 금지).
    """
    mongo = get_mongo()
    user_id = current_user["id"]
    doc = await _find_artist_by_cid(mongo, user_id, character_id)
    if not doc:
        return JSONResponse(status_code=404, content={"error": "아티스트를 찾을 수 없습니다."})

    updates = body.model_dump(exclude_unset=True)
    if not updates:
        return JSONResponse(status_code=400, content={"error": "수정할 필드가 없습니다."})

    set_fields = {}
    if "name" in updates:
        v = (updates["name"] or "").strip()
        if len(v) > NAME_MAX_LEN:
            return JSONResponse(status_code=400, content={"error": "이름은 {}자 이하여야 합니다.".format(NAME_MAX_LEN)})
        set_fields["name"] = v
    if "age" in updates:
        v = (updates["age"] or "").strip()
        if len(v) > AGE_MAX_LEN:
            return JSONResponse(status_code=400, content={"error": "나이는 {}자 이하여야 합니다.".format(AGE_MAX_LEN)})
        set_fields["age"] = v
    if "gender" in updates:
        v = (updates["gender"] or "").strip()
        if len(v) > GENDER_MAX_LEN:
            return JSONResponse(status_code=400, content={"error": "성별은 {}자 이하여야 합니다.".format(GENDER_MAX_LEN)})
        set_fields["gender"] = v
    if "personality_tags" in updates:
        tags = [t.strip() for t in (updates["personality_tags"] or []) if isinstance(t, str) and t.strip()]
        if len(tags) > PERSONALITY_TAGS_MAX_COUNT:
            return JSONResponse(
                status_code=400,
                content={"error": "성격 태그는 최대 {}개까지 선택할 수 있습니다.".format(PERSONALITY_TAGS_MAX_COUNT)},
            )
        for tag in tags:
            if len(tag) > PERSONALITY_TAG_MAX_LEN:
                return JSONResponse(
                    status_code=400,
                    content={"error": "각 성격 태그는 {}자 이하여야 합니다.".format(PERSONALITY_TAG_MAX_LEN)},
                )
        set_fields["personality_tags"] = tags
    if "personality_text" in updates:
        v = (updates["personality_text"] or "").strip()
        if len(v) > PERSONALITY_TEXT_MAX_LEN:
            return JSONResponse(
                status_code=400,
                content={"error": "성격 설명은 {}자 이하여야 합니다.".format(PERSONALITY_TEXT_MAX_LEN)},
            )
        set_fields["personality_text"] = v

    # v213 — persona 연결/해제 (None=유지 / ""=해제 / clone_id=연결, ready 검증)
    persona_action = "none"
    persona_set = {}
    if "persona_id" in updates or "persona_model" in updates:
        _p_err, persona_action, persona_set = await _validate_persona_link(
            mongo, user_id,
            updates.get("persona_id"),
            updates.get("persona_model"),
            currently_linked=bool(doc.get("persona_id")),
        )
        if _p_err is not None:
            return _p_err

    make_default = updates.get("is_default")
    if make_default is False and "is_default" in updates:
        # 기본 해제 단독 금지 — 기본 아티스트는 항상 정확히 1명.
        return JSONResponse(
            status_code=400,
            content={"error": "기본 아티스트 해제는 다른 아티스트를 기본으로 지정해 수행하세요."},
        )

    # v231 — 간편 목소리(프리셋) per-아티스트 저장: None=유지 / ""=해제 / "male:소프트"=설정.
    # persona(클론)와 상호 배타 — 한쪽 설정 시 반대쪽 자동 해제, 동시 설정 전송은 400.
    preset_action = "none"
    preset_value = None
    if "voice_preset" in updates:
        raw = updates.get("voice_preset")
        if raw is not None and not str(raw).strip():
            preset_action = "unset"
        elif raw is not None:
            if persona_action == "set" and persona_set.get("persona_id"):
                return JSONResponse(
                    status_code=400,
                    content={"error": "간편 목소리와 내 목소리는 동시에 설정할 수 없습니다."},
                )
            parts = str(raw).strip().split(":", 1)
            preset_gender = parts[0].strip().lower()
            preset_style = parts[1].strip() if len(parts) > 1 else ""
            if preset_gender not in VOICE_PRESET_GENDERS or not preset_style or len(preset_style) > VOICE_PRESET_STYLE_MAX:
                logger.warning(
                    "[VoicePreset] invalid value user=%s cid=%s raw=%s",
                    user_id[:8], doc["character_id"], str(raw)[:40],
                )
                return JSONResponse(
                    status_code=400,
                    content={"error": "간편 목소리 형식이 올바르지 않습니다. ('male|female:스타일')"},
                )
            preset_action = "set"
            preset_value = "{}:{}".format(preset_gender, preset_style)

    if not set_fields and not make_default and persona_action == "none" and preset_action == "none":
        return JSONResponse(status_code=400, content={"error": "수정할 필드가 없습니다."})

    set_fields["updated_at"] = datetime.utcnow()
    if make_default:
        set_fields["is_default"] = True
    if persona_action == "set":
        set_fields.update(persona_set)
    if preset_action == "set":
        set_fields["voice_preset"] = preset_value
    update_doc = {"$set": set_fields}
    unset_fields = {}
    if persona_action == "unset":
        unset_fields.update({"persona_id": "", "persona_model": ""})
    if preset_action == "unset":
        unset_fields["voice_preset"] = ""
    # v231 상호 배타: 프리셋 설정 → 기존 persona 해제 / persona 연결 → 기존 프리셋 해제
    if preset_action == "set" and doc.get("persona_id") and persona_action != "unset":
        unset_fields.update({"persona_id": "", "persona_model": ""})
    if persona_action == "set" and persona_set.get("persona_id") and doc.get("voice_preset") and preset_action == "none":
        unset_fields["voice_preset"] = ""
    if unset_fields:
        update_doc["$unset"] = unset_fields
    await mongo.characters.update_one({"_id": doc["_id"]}, update_doc)
    if make_default:
        await mongo.characters.update_many(
            {"user_id": user_id, "_id": {"$ne": doc["_id"]}},
            {"$set": {"is_default": False}},
        )
    if "name" in set_fields:
        # v3.229 N2 — 개명 시 그 아티스트 곡 표기(artist_name·스냅샷 이름·출처·MV 스냅샷) 따라감
        await _sync_artist_name_if_changed(
            mongo, user_id, doc["character_id"], doc.get("name"), set_fields["name"], "patch",
        )
    if persona_action == "set" and persona_set.get("persona_id"):
        logger.info(
            "[VoiceLink] link user=%s cid=%s clone=%s model=%s",
            user_id[:8], doc["character_id"], persona_set["persona_id"],
            persona_set.get("persona_model"),
        )
    elif persona_action == "set":
        logger.info(
            "[VoiceLink] model update user=%s cid=%s model=%s",
            user_id[:8], doc["character_id"], persona_set.get("persona_model"),
        )
    elif persona_action == "unset":
        logger.info(
            "[VoiceLink] unlink user=%s cid=%s prev_clone=%s",
            user_id[:8], doc["character_id"], doc.get("persona_id"),
        )
    if preset_action != "none":
        logger.info(
            "[VoicePreset] %s user=%s cid=%s value=%s",
            preset_action, user_id[:8], doc["character_id"], preset_value or "(해제)",
        )
    logger.info(
        "[ArtistV212] patch user=%s cid=%s fields=%s default=%s",
        user_id[:8], doc["character_id"],
        sorted(k for k in set_fields if k != "updated_at"), bool(make_default),
    )
    updated = await mongo.characters.find_one({"_id": doc["_id"]})
    return _serialize_artist(updated, await _resolve_persona_clone(mongo, updated))


@router.delete("/{character_id}")
async def delete_artist(
    character_id: str,
    current_user=Depends(get_current_user),
):
    """v212 — 아티스트 개별 삭제 (doc + characters/{uid}/{cid}/ prefix).

    default 삭제 시 잔여 중 real 우선·updated_at 최신 순으로 is_default 승계.
    마지막 아티스트 삭제 시 공유 원본 사진도 삭제 (/me v137② 로직 준용).
    """
    mongo = get_mongo()
    minio_client = get_minio()
    user_id = current_user["id"]
    doc = await _find_artist_by_cid(mongo, user_id, character_id)
    if not doc:
        return JSONResponse(status_code=404, content={"error": "아티스트를 찾을 수 없습니다."})

    cid = doc["character_id"]
    was_default = bool(doc.get("is_default"))
    original_photo = doc.get("original_photo_object_name") or ""

    await mongo.characters.delete_one({"_id": doc["_id"]})

    # MinIO: characters/{uid}/{cid}/ prefix 삭제
    prefix = "characters/{}/{}/".format(user_id, cid)
    try:
        objects = minio_client.list_objects(
            bucket_name=settings.minio_bucket_images, prefix=prefix, recursive=True,
        )
        from minio.deleteobjects import DeleteObject

        delete_list = [DeleteObject(obj.object_name) for obj in objects]
        if delete_list:
            errors = minio_client.remove_objects(
                bucket_name=settings.minio_bucket_images, delete_object_list=delete_list,
            )
            for err in errors:
                logger.warning("Failed to delete MinIO object: %s", err)
    except Exception as e:
        logger.warning("[ArtistV212] MinIO cleanup failed user=%s cid=%s: %s", user_id[:8], cid, e)

    remaining = await mongo.characters.find({"user_id": user_id}).sort("updated_at", -1).to_list(length=None)

    # default 승계 — real 우선, updated_at 최신
    if was_default and remaining:
        heir = None
        for d in remaining:
            if (d.get("kind") or "real") == "real":
                heir = d
                break
        heir = heir or remaining[0]
        await mongo.characters.update_one({"_id": heir["_id"]}, {"$set": {"is_default": True}})
        logger.info(
            "[ArtistV212] default inherited user=%s from=%s to=%s",
            user_id[:8], cid, heir.get("character_id") or "(legacy)",
        )

    # 마지막 아티스트 삭제 — 공유 원본 사진 삭제 (v137② 준용)
    if not remaining and original_photo:
        try:
            minio_client.remove_object(
                bucket_name=settings.minio_bucket_images, object_name=original_photo,
            )
            logger.info(
                "[character] original_photo_deleted user=%s object=%s (last artist)",
                user_id, original_photo,
            )
        except Exception as e:
            logger.warning(
                "[character] original photo delete failed user=%s object=%s: %s",
                user_id, original_photo, e,
            )

    logger.info("[ArtistV212] delete user=%s cid=%s remaining=%d", user_id[:8], cid, len(remaining))
    return {"message": "아티스트가 삭제되었습니다.", "remaining": len(remaining)}
