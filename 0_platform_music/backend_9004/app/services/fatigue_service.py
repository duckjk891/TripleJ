"""
Director Fatigue system (StarEcon v158 → v220 전 디렉터 일반화).

디렉터별 생성물이 완성될 때마다 그날의 완성 카운트가 올라가고, 카운트에
비례한 쿨다운이 시작된다. 쿨다운 중에는 해당 디렉터의 새 생성 지시가
429 로 게이트된다. 생성 진행 중 대기에는 어떤 과금/게이트도 없다.

디렉터 4종 (v220):
    composer  — 곡 완성 (suno_generator 완성 훅, 기존 그대로)
    lyricist  — POST /generate/lyrics 성공
    image     — POST /upload/generate-cover 성공 (refine 은 무과금 → 미카운트)
    artist    — 캐릭터 시트 생성 성공 (sync 2종 + async 잡 done, 재생성 포함)

사다리 (그날 n개째 완성 → 쿨다운) — 디렉터별 상수 분리(현재 동일 값,
추후 개별 튜닝 가능):
    1개 → 2h / 2개 → 4h / 3개 → 8h / 4개+ → 12h

KST 자정 리셋: day 불일치 시 lazy 리셋 — 전 디렉터 완성 카운트 0 + 잔여
쿨다운 해제.

Collection: `director_fatigue` (user_id unique, doc 1개에 4 디렉터 동거)
    { user_id, day: '%Y%m%d' (KST),
      completed_count, cooldown_until,                     # composer (legacy 필드 — 하위호환)
      lyricist_completed_count, lyricist_cooldown_until,   # 나머지는 접두 필드
      image_completed_count, image_cooldown_until,
      artist_completed_count, artist_cooldown_until,
      updated_at }

director 미지정 = composer — 기존 데이터/호출부(v3.94 프론트·구 앱) 무수정 동작.

모든 함수는 best-effort (절대 raise 하지 않는 쪽이 안전한 곳은 삼킴) 이며,
배경 루프 호출자는 루프-로컬 motor db 를 `db` 파라미터로 주입해야 한다
(suno_generator 의 완성 훅 등 — 메인 루프 get_mongo() 클라이언트 사용 금지).
"""

import logging
from datetime import datetime, timedelta, timezone

from pymongo import ReturnDocument

from ..database.mongodb import get_mongo
from .points_service import POINT_COSTS, _kst_day

logger = logging.getLogger(__name__)

# 스킵 1회당 단축 분 (⭐ 또는 광고권 1장 = 30분)
SKIP_MINUTES = 30

# ── 디렉터 차원 (v220) ──────────────────────────────────────────────────────
DIRECTORS = ("composer", "lyricist", "image", "artist")
DEFAULT_DIRECTOR = "composer"

# 스킵 1회당 ⭐ 비용 — 디렉터별 차등 (v220 대표 정책).
# 근거 규칙: 해당 디렉터 생성비(POINT_COSTS)의 1/3 반올림, 최소 1.
#   composer: compose 15 → ⭐5 (기존 fatigue_skip=5 유지)
#   lyricist: lyrics   5 → ⭐2
#   image:    cover    5 → ⭐2
#   artist:   character 10 → ⭐3
# POINT_COSTS["fatigue_skip"](=5) 단일값 의존 제거 — 신규 키 추가 없이
# 디렉터별 실비용은 GET /api/fatigue/status 의 skip_point_cost 로 노출한다
# (FE 는 status 값만 표기 — 하드코딩 금지).
SKIP_POINT_COSTS = {
    "composer": 5,
    "lyricist": 2,
    "image": 2,
    "artist": 3,
}

# legacy alias (composer) — 구 참조 하위호환용. 신규 코드는 skip_point_cost() 사용.
SKIP_POINT_COST = SKIP_POINT_COSTS["composer"]
assert SKIP_POINT_COST == POINT_COSTS["fatigue_skip"], "composer skip cost drifted from POINT_COSTS"


def skip_point_cost(director: str = DEFAULT_DIRECTOR) -> int:
    """해당 디렉터의 쿨다운 30분 스킵 ⭐ 비용."""
    return SKIP_POINT_COSTS.get(director, SKIP_POINT_COSTS[DEFAULT_DIRECTOR])

# 완성 카운트 → 쿨다운 시간(시) 사다리 — 디렉터별 상수 분리 (현재 전원 동일,
# 추후 개별 튜닝 시 이 dict 만 수정).
LADDER_HOURS_BY_DIRECTOR = {
    "composer": {1: 2, 2: 4, 3: 8},
    "lyricist": {1: 2, 2: 4, 3: 8},
    "image": {1: 2, 2: 4, 3: 8},
    "artist": {1: 2, 2: 4, 3: 8},
}
LADDER_MAX_HOURS_BY_DIRECTOR = {
    "composer": 12,
    "lyricist": 12,
    "image": 12,
    "artist": 12,
}

_indexes_ready = False


def normalize_director(raw) -> str:
    """director 파라미터 정규화 — 미지정/빈값 = composer, 미지원 값은 None."""
    if raw is None:
        return DEFAULT_DIRECTOR
    value = str(raw).strip().lower()
    if not value:
        return DEFAULT_DIRECTOR
    return value if value in DIRECTORS else None


def _count_field(director: str) -> str:
    """완성 카운트 필드명 — composer 는 legacy 필드(하위호환)."""
    return "completed_count" if director == "composer" else f"{director}_completed_count"


def _until_field(director: str) -> str:
    """쿨다운 만료 필드명 — composer 는 legacy 필드(하위호환)."""
    return "cooldown_until" if director == "composer" else f"{director}_cooldown_until"


def _ladder(count: int, director: str = DEFAULT_DIRECTOR) -> timedelta:
    """해당 디렉터가 그날 `count`개째 완성 시 적용할 쿨다운 길이."""
    if count <= 0:
        return timedelta(0)
    hours = LADDER_HOURS_BY_DIRECTOR.get(director, LADDER_HOURS_BY_DIRECTOR[DEFAULT_DIRECTOR])
    max_hours = LADDER_MAX_HOURS_BY_DIRECTOR.get(
        director, LADDER_MAX_HOURS_BY_DIRECTOR[DEFAULT_DIRECTOR]
    )
    return timedelta(hours=hours.get(count, max_hours))


def ladder_spec(director: str = DEFAULT_DIRECTOR) -> dict:
    """FE 노출용 사다리 사양 {완성수: 쿨다운시간(h)} — 기존 shape 유지."""
    hours = LADDER_HOURS_BY_DIRECTOR.get(director, LADDER_HOURS_BY_DIRECTOR[DEFAULT_DIRECTOR])
    max_hours = LADDER_MAX_HOURS_BY_DIRECTOR.get(
        director, LADDER_MAX_HOURS_BY_DIRECTOR[DEFAULT_DIRECTOR]
    )
    spec = {str(k): v for k, v in sorted(hours.items())}
    spec["{}+".format(max(hours) + 1)] = max_hours
    return spec


def _db(db=None):
    return db if db is not None else get_mongo()


async def _ensure_indexes(db=None):
    global _indexes_ready
    if _indexes_ready:
        return
    await _db(db).director_fatigue.create_index("user_id", unique=True)
    _indexes_ready = True


def _as_utc(dt):
    """Mongo 가 돌려준 naive datetime 을 UTC aware 로 정규화."""
    if isinstance(dt, datetime) and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _empty_doc(user_id: str, day: str) -> dict:
    doc = {"user_id": user_id, "day": day}
    for d in DIRECTORS:
        doc[_count_field(d)] = 0
        doc[_until_field(d)] = None
    return doc


async def _load(user_id: str, db=None) -> dict:
    """유저 피로 doc 로드 + KST day 불일치 시 lazy 리셋 (전 디렉터).

    리셋 = 전 디렉터 completed_count 0 + cooldown_until 해제 (자정에 쿨다운도 해제).
    doc 이 없으면 저장 없이 오늘자 빈 상태를 돌려준다 (완성/스킵 시점에 upsert).
    """
    mongo = _db(db)
    await _ensure_indexes(db)
    today = _kst_day()
    doc = await mongo.director_fatigue.find_one({"user_id": user_id})
    if doc is None:
        return _empty_doc(user_id, today)
    if doc.get("day") != today:
        # KST 자정 경과 — 전 디렉터 카운트/쿨다운 모두 해제 (lazy 저장)
        reset_fields = {"day": today, "updated_at": datetime.now(timezone.utc)}
        for d in DIRECTORS:
            reset_fields[_count_field(d)] = 0
            reset_fields[_until_field(d)] = None
        await mongo.director_fatigue.update_one(
            {"user_id": user_id}, {"$set": reset_fields}
        )
        logger.info(
            "[fatigue] daily reset user=%s old_day=%s -> %s (all directors count+cooldown cleared)",
            user_id[:8], doc.get("day"), today,
        )
        return _empty_doc(user_id, today)
    for d in DIRECTORS:
        doc[_until_field(d)] = _as_utc(doc.get(_until_field(d)))
    return doc


async def on_generation_completed(user_id: str, db=None, director: str = DEFAULT_DIRECTOR) -> None:
    """생성물 최종 완성 훅 — 해당 디렉터의 그날 완성 카운트 +1, 사다리 쿨다운 시작.

    composer 는 suno_generator 배경 루프에서 호출되므로 반드시 루프-로컬 db 를
    넘겨야 한다. best-effort — 어떤 실패도 생성 완료 흐름에 영향을 주지 않는다.
    """
    if not user_id:
        return
    director = normalize_director(director) or DEFAULT_DIRECTOR
    try:
        mongo = _db(db)
        doc = await _load(user_id, db)
        new_count = int(doc.get(_count_field(director), 0) or 0) + 1
        now = datetime.now(timezone.utc)
        cooldown_until = now + _ladder(new_count, director)
        await mongo.director_fatigue.update_one(
            {"user_id": user_id},
            {
                "$set": {
                    "day": _kst_day(),
                    _count_field(director): new_count,
                    _until_field(director): cooldown_until,
                    "updated_at": now,
                },
                "$setOnInsert": {"user_id": user_id, "created_at": now},
            },
            upsert=True,
        )
        logger.info(
            "[fatigue:%s] completed user=%s today_count=%d cooldown_until=%s",
            director, user_id[:8], new_count, cooldown_until.isoformat(),
        )
    except Exception:
        logger.exception(
            "[fatigue:%s] on_generation_completed failed user=%s",
            director, (user_id or "?")[:8],
        )


async def check_gate(user_id: str, db=None, director: str = DEFAULT_DIRECTOR) -> int:
    """디렉터 게이트 — 활성 쿨다운 남은 초를 반환 (없으면 0).

    조회 실패 시 0 (게이트 오픈 — 피로 시스템 장애가 생성을 막지 않는다).
    """
    if not user_id:
        return 0
    director = normalize_director(director) or DEFAULT_DIRECTOR
    try:
        doc = await _load(user_id, db)
        until = doc.get(_until_field(director))
        if not until:
            return 0
        remaining = (until - datetime.now(timezone.utc)).total_seconds()
        return max(0, int(remaining))
    except Exception:
        logger.exception(
            "[fatigue:%s] check_gate failed user=%s (gate open)",
            director, (user_id or "?")[:8],
        )
        return 0


async def get_status(user_id: str, db=None, director: str = DEFAULT_DIRECTOR) -> dict:
    """피로 상태 조회 (API /api/fatigue/status 의 코어 payload).

    기존 shape 유지 + director 키 추가 (v220).
    """
    director = normalize_director(director) or DEFAULT_DIRECTOR
    doc = await _load(user_id, db)
    return _status_from_doc(doc, director)


def _status_from_doc(doc: dict, director: str) -> dict:
    until = doc.get(_until_field(director))
    now = datetime.now(timezone.utc)
    remaining = max(0, int((until - now).total_seconds())) if until else 0
    active = remaining > 0
    return {
        "director": director,
        "today_completed": int(doc.get(_count_field(director), 0) or 0),
        "cooldown_active": active,
        "cooldown_until": until.isoformat() if (until and active) else None,
        "cooldown_remaining_sec": remaining,
        "skip_point_cost": skip_point_cost(director),
        "skip_minutes": SKIP_MINUTES,
        "ladder": ladder_spec(director),
    }


async def get_status_all(user_id: str, db=None) -> dict:
    """4 디렉터 일괄 상태 — Map 휴식 티켓용 1회 조회 (v220).

    반환: {director: status_payload} (doc 1회 로드 — 디렉터별 재조회 없음).
    """
    doc = await _load(user_id, db)
    return {d: _status_from_doc(doc, d) for d in DIRECTORS}


async def reduce_cooldown(
    user_id: str, minutes: int = SKIP_MINUTES, db=None, director: str = DEFAULT_DIRECTOR
):
    """해당 디렉터의 활성 쿨다운을 `minutes`분 단축 (바닥은 now — 음수 잔여 없음).

    aggregation-pipeline update 로 원자 실행: cooldown_until =
    max(now, cooldown_until - minutes). 활성 쿨다운이 없으면 None 을
    반환한다 (과금 호출자는 이 경우 환불해야 함). 성공 시 갱신된 doc 반환.
    """
    if not user_id:
        return None
    director = normalize_director(director) or DEFAULT_DIRECTOR
    until_field = _until_field(director)
    mongo = _db(db)
    await _ensure_indexes(db)
    now = datetime.now(timezone.utc)
    updated = await mongo.director_fatigue.find_one_and_update(
        {"user_id": user_id, until_field: {"$gt": now}},
        [{
            "$set": {
                until_field: {
                    "$max": [now, {"$subtract": ["${}".format(until_field), minutes * 60 * 1000]}]
                },
                "updated_at": now,
            }
        }],
        return_document=ReturnDocument.AFTER,
    )
    if updated is None:
        logger.info(
            "[fatigue:%s] reduce no-op (no active cooldown) user=%s", director, user_id[:8]
        )
        return None
    updated[until_field] = _as_utc(updated.get(until_field))
    logger.info(
        "[fatigue:%s] reduce user=%s -%dmin new_until=%s",
        director, user_id[:8], minutes,
        updated[until_field].isoformat() if updated.get(until_field) else None,
    )
    return updated
