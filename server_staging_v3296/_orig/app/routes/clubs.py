"""ClubSquad(v3.245) — 커뮤니티 클럽 코어 (Phase 1b).

Mongo `clubs`/`club_members` + 클럽 게시판은 feeds kind='club'(routes/feeds.py),
클럽 공유 플레이리스트는 PG playlists.club_id(routes/playlists.py).

정책(PLAN v3.243+ 대표 결정 기본값):
- 개설 무료 · 계정당 소유 1개(409 code=club_limit) · 이름 대소문자 무구분 유니크(409 code=club_name_taken)
- MVP 는 공개 클럽만(비공개 없음) — 목록·상세·게시판 읽기는 비회원도 가능
- 어린이: 가입 허용 · **개설 차단(v3.247 대표 확정 — 403 child_restricted, feature='club_create')** ·
  글 이미지 금지·feed_write/comment 권한 준용은 feeds 쪽 _kids_feed_gate 가 담당
- v3.247 클럽장 위임: POST /{id}/transfer-owner (owner 전용) — 자격 = 해당 클럽 활동
  (게시글≥1 or 댓글≥1 or 클럽 플리 곡 추가≥1) 또는 가입 7일 경과. 미달 400 transferee_not_eligible.
  위임 후에야 owner 탈퇴 가능(owner_cannot_leave 정책 불변). 후보 목록 GET /{id}/transfer-candidates.
- 신고 블라인드(clubs.report_blinded=True) 클럽은 목록 제외 + 비관리자 상세 404
- v3.249 멤버 관리(대표 결정 — 운영자의 멤버 신고·내보내기 권한):
  GET /{id}/members(멤버 전용 — 닉네임 PG 조인, before 커서) ·
  DELETE /{id}/members/{user_id}(owner 전용 kick — 작성물·플리 곡 보존,
  club_kicks 기록 = 후속 '가입 차단' 기반, 재가입은 MVP 허용).
  멤버 신고는 reports.py target_type='club_member'(신고는 멤버 보편 권리 — kick 만 owner).
- v3.252 크루(대표 확정 — 노출 명칭 '클럽'→'크루', 코드 내부·라우트는 club 유지):
  ① 가입 승인제 전면 전환 — POST /{id}/join 은 즉시 가입 대신 club_join_requests
    {club_id,user_id,status,requested_at,message?} pending 생성 → 202 {status:'pending'}
    (중복 신청 멱등 202 · 이미 멤버 200 기존 응답 · kicked 이력자도 동일 경유 — 자동 거부 없음).
    owner 전용: GET /{id}/join-requests(was_kicked 표시) · POST /{id}/join-requests/{uid}/approve
    (기존 가입 로직 재사용 — member 편입 + member_count $inc) · /reject(status=rejected, 재신청 가능).
    DELETE /{id}/join 은 비멤버+pending 이면 신청 철회(withdrawn), 멤버면 기존 탈퇴.
    상세·목록에 join_status('none'|'pending'|'member', viewer 기준) 가산. 어린이 가입 신청 허용(기존 정책).
  ② 크루 단톡방 — Mongo club_chat_messages {club_id,sender_id,text≤1000,created_at,deleted}.
    POST /{id}/chat(멤버 전용·어린이 403 child_restricted·워드필터 where='club_chat'·
    Redis 슬라이딩 레이트리밋 10건/30초 429 rate_limited) · GET /{id}/chat(커서, 닉네임 조인,
    deleted 마스킹) · POST /{id}/chat/read(club_members.last_read_chat_id) ·
    DELETE /{id}/chat/{msg_id}(작성자 본인 or owner — deleted:true 소프트 삭제).
    /mine 에 unread_chat(커서 계산 — 대화문서 맵 방식 금지, PLAN 명시) 가산.
    실시간 = dm_service.publish_to_club → Redis `club:{club_id}` → dm.py 리스너 팬아웃.
    dm_blocks 차단자 메시지도 저장·팬아웃(전체 채팅 — 차단은 클라 표시 필터 소관, 설계 판단).

- v3.253 크루 플리 혜택(대표 확정 — 크루 RP·레벨):
  clubs.recognition {rp, level 1..5, label} (services/recognition.py 크루 섹션 — 임계 0/100/500/2000/8000,
  Lv1 신생~Lv5 전설 크루). 적립 = 비멤버 청취자의 크루 플리 재생 +2(charts.record-play source 검증,
  유저·크루·KST일 상한 30) · 재생 시작(담기) +10(POST /{id}/playlists/{plid}/play-start —
  유저·플리·KST일 1회, Mongo crew_rp_events 유니크). 멤버 자기 재생·담기 = 미적립, 게스트 미적립.

- v3.257 크루 인지도 노출 제거(대표 확정 — "크루는 인지도가 필요없어. 크루원들한테 혜택이 가는 형태면 되."):
  목록·상세·mine·play-start 응답에서 recognition 키 삭제(노출 중단 — v3.253 에서 갓 추가된 가산 키라
  하위호환 문제 없음, v3.257 앱도 미사용 처리 완료). 적립 파이프는 전부 유지 — clubs.recognition
  내부 필드(필드명 그대로)·crew_rp_events 원장·record-play +2·play-start +10(granted 로직)은
  멤버 혜택 정산의 원천 점수로 계속 축적된다(⭐ 정산 수치는 별도 확정 대기).
  sort=popular 는 존치하되 비노출(앱 미사용) — v3.253 계약 구간의 앱이 호출해도 400 이 나지 않게
  유지(라우트·정렬·커서 로직 무변경). 문서상 공식 정렬은 new|members.

- v3.261 크루 홍보 + 멤버 창 공개(대표 확정):
  ① 멤버 창 공개 구조 — GET /{id}/members 를 비멤버·비로그인에게도 200 으로 개방하되 **익명 모드**:
    {anonymous:true, member_count, members:[{role,joined_at}], next_before} — user_id·nickname 미포함
    (운영자 행도 역할만 노출). 멤버·관리자 viewer 는 기존 응답 그대로(user_id 유지 — 앱 탭→채널 이동용)
    + anonymous:false 명시(앱 분기 단순화). 커서는 양 모드 동일(before=<멤버십 doc id>). 블라인드 404 유지.
  ② 크루 홍보 — POST /{id}/promote {genres?,moods?,message?} (owner 전용 403 · genres+moods 합 1~5개
    400 · message ≤100 워드필터 where='club_profile' · 크루당 쿨다운 7일 429 promo_cooldown).
    타겟 = tracks 최근 90일 공개곡의 genre/mood 키워드 일치 uploader(중복 제거·자기 크루 멤버 제외·
    어린이 제외(kids_policy)·**유저당 크루 홍보 수신 주간 상한 2건** — Mongo club_promo_receipts
    {user_id,club_id,promo_id,week(KST ISO 주),at} 카운트, 초과 유저는 이번 대상에서 제외).
    감사 추적 Mongo club_promos {club_id,by,keywords,message,targeted,at} — 쿨다운 판정도 이 기록
    (Redis 키 대신 Mongo: 재시작·페일오버 생존 + 감사 일원화, crew_rp_events 관행).
    발송 = notifications.push_notification type='club_promo'(VALID_TYPES 1줄 추가 — 구앱은 TYPE_META
    fallback(feed 렌더러)으로 안전 렌더: actor_nickname=크루명 + preview 노출, 탭=피드 탭 무해),
    preview="취향이 비슷한 크루 '{크루명}'가 멤버를 찾고 있어요( – message)"(120자 절단),
    target_type='club_promo', target_id=club_id, extra {club_name, promo_message}(신앱 렌더·탭 이동용 —
    앱 조 처리). 알림·수신기록은 best-effort 루프(1인 실패 격리). 응답 {targeted, next_at}.

라우터 등록: main.py 무변경 원칙 — referral.public_router 합류(v3.233/235/237 관행).
로그 prefix [Club]/[CrewRecog] — club_id/user_id 앞 8자만, 이름·설명·채팅 원문 로그 금지(길이만).
"""
import logging
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..auth import get_current_user, get_current_user_optional
from ..database.mongodb import get_mongo
from ..database.postgres import get_pg
from ..database.redis import get_redis  # v3.252 — 크루 채팅 레이트리밋(실패는 fail-open)
from ..services import dm_service  # v3.252 — 크루 채팅 실시간 publish(club:{id})
from ..services import kids_policy  # v3.247 — 어린이 개설 차단(킬 스위치 OFF 면 no-op)
from ..services import recognition as recognition_svc  # v3.253 — 크루 RP(레벨) 동봉·담기 적립
from ..services.word_filter import word_filter_response
from .notifications import push_notification  # v3.261 — 크루 홍보 알림(type='club_promo')

router = APIRouter(prefix="/api/clubs", tags=["Clubs"])

logger = logging.getLogger(__name__)

MAX_NAME_LEN = 30
MAX_DESC_LEN = 300
LIST_MAX_LIMIT = 50
LIST_SORTS = ("new", "members", "popular")  # v3.257 — popular 존치·비노출(구간 호환, 공식 정렬은 new|members)

CLUB_LIMIT_CODE = "club_limit"
CLUB_NAME_TAKEN_CODE = "club_name_taken"
OWNER_CANNOT_LEAVE_CODE = "owner_cannot_leave"
CLUB_MEMBERS_ONLY_CODE = "club_members_only"
# v3.249 멤버 관리 — 내보내기(kick)는 owner 전용, owner(=본인) 대상 불가
CANNOT_KICK_OWNER_CODE = "cannot_kick_owner"

# v3.247 클럽장 위임 — 자격 기본값(대표 확인 항목): 활동 1건 이상 또는 가입 7일 경과
TRANSFER_MIN_TENURE_DAYS = 7
TRANSFEREE_NOT_ELIGIBLE_CODE = "transferee_not_eligible"
TRANSFEREE_NOT_MEMBER_CODE = "transferee_not_member"

# v3.252 가입 승인제 — club_join_requests.status 전이: pending → approved | rejected | withdrawn
JOIN_PENDING = "pending"
JOIN_APPROVED = "approved"
JOIN_REJECTED = "rejected"
JOIN_WITHDRAWN = "withdrawn"
MAX_JOIN_MESSAGE_LEN = 200
JOIN_REQUEST_NOT_FOUND = {"error": "가입 신청을 찾을 수 없습니다."}

# v3.252 크루 단톡방
CHAT_MAX_TEXT_LEN = 1000
CHAT_LIST_MAX_LIMIT = 50
CHAT_RATE_LIMIT = 10          # 슬라이딩 윈도우 안 최대 송신 수
CHAT_RATE_WINDOW_SEC = 30     # 슬라이딩 윈도우(초)
RATE_LIMITED_CODE = "rate_limited"
CHAT_DELETED_TEXT = "삭제된 메시지예요"
UNREAD_CHAT_CAP = 99          # /mine unread_chat 상한(배지용 — 카운트 폭주 방지)

CLUB_NOT_FOUND = {"error": "크루를 찾을 수 없습니다."}

# v3.261 크루 홍보(키워드 타겟) — owner 전용·쿨다운 7일·유저당 수신 주간 상한 2건
PROMO_COOLDOWN_DAYS = 7
PROMO_MAX_KEYWORDS = 5           # genres+moods 합계(1~5개 필수)
PROMO_MAX_KEYWORD_LEN = 30       # 키워드 1개 최대 길이(장르·무드 명 — 비정상 입력 방어)
PROMO_MAX_MESSAGE_LEN = 100
PROMO_RECENT_TRACK_DAYS = 90     # 타겟 원천 — 최근 발매(업로드) 공개곡
PROMO_WEEKLY_RECEIPT_CAP = 2     # 유저당 크루 홍보 수신 주간 상한(KST ISO 주)
PROMO_COOLDOWN_CODE = "promo_cooldown"
PROMO_NOTIF_TYPE = "club_promo"
# v3.266 — 자유 키워드 타겟 정확도 컷(대표 지적: "검색은 관련성 낮아도 다 보여줌" — 홍보는
# precision 우선): ES 점수 절대 하한 = settings.search_es_weak_score(아무말 게이트와 동일 축),
# 상대 컷 = top1 * PROMO_ES_REL_CUT 미만 탈락. 타겟 상한 PROMO_MAX_TARGETS.
PROMO_ES_REL_CUT = 0.5
PROMO_MAX_TARGETS = 100
PROMO_MIN_KEYWORD_LEN = 2

KST = timezone(timedelta(hours=9))


def _kst_week(dt: Optional[datetime] = None) -> str:
    """KST 기준 ISO 주 문자열(예: '2026W40') — 수신 상한 카운트 키(v3.259 주차 표기 관행)."""
    d = dt or datetime.now(timezone.utc)
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    y, w, _ = d.astimezone(KST).isocalendar()
    return f"{y}W{w:02d}"


def _short(value) -> str:
    """로그 추적자 — id 앞 8자."""
    return str(value)[:8] if value else "?"


class ClubCreate(BaseModel):
    name: str
    description: Optional[str] = None


class TransferOwnerBody(BaseModel):
    new_owner_id: str


class JoinRequestBody(BaseModel):
    """v3.252 가입 신청(선택 body) — 구 클라이언트는 body 없이 호출(하위호환)."""
    message: Optional[str] = None


class ChatSendBody(BaseModel):
    text: str = ""


class ChatReadBody(BaseModel):
    last_id: str


class PromoteBody(BaseModel):
    """v3.261 크루 홍보 → v3.266 자유 키워드 타겟(대표 확정 2026-09-29).

    keyword: 자유 주제어(예: "고양이") — 그 주제로 곡을 만든 이력이 있는 유저 타겟.
    genres/moods: v3.261 레거시 경로(웹 구버전 호환) — keyword 있으면 무시.
    """
    keyword: Optional[str] = None
    genres: Optional[list] = None
    moods: Optional[list] = None
    message: Optional[str] = None


def _serialize_club(doc: dict, is_member: bool = False, role: Optional[str] = None) -> dict:
    out = {
        "id": str(doc["_id"]),
        "name": doc.get("name"),
        "description": doc.get("description"),
        "member_count": int(doc.get("member_count") or 0),
        "owner_id": doc.get("owner_id"),
        "is_member": bool(is_member),
        "created_at": doc["created_at"].isoformat()
        if isinstance(doc.get("created_at"), datetime) else doc.get("created_at"),
        # v3.257 — recognition 키 삭제(v3.253 동봉 중단, 대표 확정: 크루 인지도 미노출).
        # clubs.recognition 내부 필드는 멤버 혜택 정산 원천으로 계속 축적된다(노출만 중단).
    }
    if role is not None:
        out["role"] = role
    return out


def _is_admin(current_user) -> bool:
    return bool(current_user) and current_user.get("role") == "admin"


async def get_club_or_404(mongo, club_id: str, viewer=None):
    """(doc, error) — 비정상 id/미존재/블라인드(비관리자) 모두 404.

    feeds._get_feed_or_404 관행 복제. 블라인드 클럽은 관리자에게만 보인다.
    routes/feeds.py·routes/playlists.py 의 클럽 검증도 이 함수를 공용한다.
    """
    if not ObjectId.is_valid(club_id):
        logger.info("[Club] lookup invalid_id club=%s", _short(club_id))
        return None, JSONResponse(status_code=404, content=CLUB_NOT_FOUND)
    doc = await mongo.clubs.find_one({"_id": ObjectId(club_id)})
    if not doc:
        logger.info("[Club] lookup not_found club=%s", _short(club_id))
        return None, JSONResponse(status_code=404, content=CLUB_NOT_FOUND)
    if doc.get("report_blinded") and not _is_admin(viewer):
        logger.info("[Club] lookup blinded club=%s", _short(club_id))
        return None, JSONResponse(status_code=404, content=CLUB_NOT_FOUND)
    return doc, None


async def get_membership(mongo, club_id: str, user_id) -> Optional[dict]:
    """club_members 문서 (없으면 None). club_id 는 str(ObjectId) 저장 관행(feed_id 동일)."""
    if not user_id:
        return None
    return await mongo.club_members.find_one({"club_id": str(club_id), "user_id": str(user_id)})


async def _memberships_map(mongo, club_ids: list, user_id) -> dict:
    """{club_id(str): role} — 목록 하이드레이션용 1쿼리 $in."""
    if not user_id or not club_ids:
        return {}
    docs = await mongo.club_members.find(
        {"club_id": {"$in": [str(c) for c in club_ids]}, "user_id": str(user_id)}
    ).to_list(length=len(club_ids))
    return {d["club_id"]: d.get("role") or "member" for d in docs}


# ---------------------------------------------------------------- v3.252 승인제·채팅 공용 헬퍼


async def get_pending_request(mongo, club_id: str, user_id) -> Optional[dict]:
    """pending 가입 신청 문서(없으면 None) — (club_id,user_id) 1문서 upsert 관행."""
    if not user_id:
        return None
    return await mongo.club_join_requests.find_one(
        {"club_id": str(club_id), "user_id": str(user_id), "status": JOIN_PENDING}
    )


async def _pending_map(mongo, club_ids: list, user_id) -> set:
    """viewer 의 pending 신청 club_id(str) 집합 — 목록 하이드레이션 1쿼리 $in."""
    if not user_id or not club_ids:
        return set()
    docs = await mongo.club_join_requests.find(
        {"club_id": {"$in": [str(c) for c in club_ids]}, "user_id": str(user_id),
         "status": JOIN_PENDING},
        {"club_id": 1},
    ).to_list(length=len(club_ids))
    return {d["club_id"] for d in docs}


def _join_status(is_member: bool, is_pending: bool) -> str:
    """viewer 기준 가입 상태 — 'member' | 'pending' | 'none'."""
    if is_member:
        return "member"
    return "pending" if is_pending else "none"


async def _nickname_map(conn, user_ids: list, club_id: str, what: str) -> dict:
    """PG users 닉네임 1쿼리 조인 — 실패는 {} 강등(목록 유지, v3.249 members 관행)."""
    if not user_ids:
        return {}
    try:
        rows = await conn.fetch(
            "SELECT id::text AS id, nickname FROM users WHERE id::text = ANY($1)", user_ids
        )
        return {r["id"]: r["nickname"] for r in rows}
    except Exception as e:  # noqa: BLE001
        logger.warning("[Club] %s profile_failed club=%s err=%s", what, _short(club_id), type(e).__name__)
        return {}


def _iso(dt) -> Optional[str]:
    """UTC aware 로 정규화 후 isoformat — naive(구 저장분)는 UTC 로 간주(dm_service 관행)."""
    if dt is None:
        return None
    if isinstance(dt, datetime):
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.isoformat()
    return str(dt)


def _serialize_chat_message(doc: dict, nickname=None) -> dict:
    """채팅 메시지 직렬화 — deleted 는 본문을 마스킹(원문은 DB 보존 — 신고·어드민 조치용)."""
    deleted = bool(doc.get("deleted"))
    return {
        "id": str(doc["_id"]),
        "club_id": doc.get("club_id"),
        "sender_id": doc.get("sender_id"),
        "nickname": nickname,
        "text": CHAT_DELETED_TEXT if deleted else doc.get("text"),
        "created_at": _iso(doc.get("created_at")),
        "deleted": deleted,
    }


async def _chat_rate_limited(club_id: str, user_id: str) -> bool:
    """Redis 슬라이딩 윈도우(ZSET) — 10건/30초. Redis 미가용·오류는 fail-open(False)."""
    try:
        redis = get_redis()
        if redis is None:
            return False
        key = f"rl:club_chat:{club_id}:{user_id}"
        now = time.time()
        await redis.zremrangebyscore(key, 0, now - CHAT_RATE_WINDOW_SEC)
        n = await redis.zcard(key)
        if int(n or 0) >= CHAT_RATE_LIMIT:
            logger.info("[Club] chat rate_limited club=%s user=%s n=%s", _short(club_id), _short(user_id), n)
            return True
        # member 는 유니크해야 함(같은 초 다중 송신 대비 uuid 꼬리)
        await redis.zadd(key, {f"{now:.6f}:{uuid.uuid4().hex[:8]}": now})
        await redis.expire(key, CHAT_RATE_WINDOW_SEC * 2)
        return False
    except Exception as e:  # noqa: BLE001 — 레이트리밋 실패가 채팅을 막지 않게(fail-open)
        logger.warning("[Club] chat ratelimit failed club=%s err=%s -> allow", _short(club_id), type(e).__name__)
        return False


# ---------------------------------------------------------------- CRUD


@router.post("/", status_code=201)
async def create_club(body: ClubCreate, current_user=Depends(get_current_user), conn=Depends(get_pg)):
    """클럽 개설 — 무료·계정당 소유 1개·이름 대소문자 무구분 유니크. 개설자 자동 owner 가입."""
    mongo = get_mongo()
    user_id = str(current_user["id"])
    name = (body.name or "").strip()
    description = (body.description or "").strip()
    logger.info(
        "[Club] create enter user=%s name_len=%d desc_len=%d",
        _short(user_id), len(name), len(description),
    )

    # v3.247 — 어린이 클럽 개설 차단(가입은 join_club 기존대로 허용). 킬 스위치 OFF 면 DB 0회 no-op.
    _kids_block = await kids_policy.kids_guard(user_id, "club_create", conn)
    if _kids_block is not None:
        logger.info("[Club] create child_blocked user=%s", _short(user_id))
        return _kids_block

    if not name:
        return JSONResponse(status_code=400, content={"error": "크루 이름을 입력해주세요."})
    if len(name) > MAX_NAME_LEN:
        return JSONResponse(status_code=400, content={"error": f"크루 이름은 {MAX_NAME_LEN}자 이하여야 합니다."})
    if len(description) > MAX_DESC_LEN:
        return JSONResponse(status_code=400, content={"error": f"크루 소개는 {MAX_DESC_LEN}자 이하여야 합니다."})

    # 금칙어 — 이름+소개, where='club_profile'(SOCIAL_WHERE 포함 — 소통 전체 적용 시 성인도)
    filtered = await word_filter_response(user_id, [name, description], "club_profile", conn)
    if filtered is not None:
        return filtered

    # 계정당 소유 1개 (사전 점검 — 경쟁은 clubs.owner_id 유니크 인덱스가 최종 방어)
    owned = await mongo.clubs.find_one({"owner_id": user_id}, {"_id": 1})
    if owned:
        logger.info("[Club] create limit user=%s existing=%s", _short(user_id), _short(owned["_id"]))
        return JSONResponse(
            status_code=409,
            content={"error": "이미 운영 중인 크루가 있어요. 크루는 계정당 1개만 만들 수 있습니다.",
                     "code": CLUB_LIMIT_CODE},
        )

    # 이름 유니크(대소문자 무구분) — 사전 점검 + name_lc 유니크 인덱스가 경쟁 방어
    name_lc = name.lower()
    dup = await mongo.clubs.find_one({"name_lc": name_lc}, {"_id": 1})
    if dup:
        logger.info("[Club] create name_taken user=%s", _short(user_id))
        return JSONResponse(
            status_code=409,
            content={"error": "이미 사용 중인 크루 이름입니다.", "code": CLUB_NAME_TAKEN_CODE},
        )

    now = datetime.utcnow()
    doc = {
        "name": name,
        "name_lc": name_lc,
        "description": description,
        "owner_id": user_id,
        "member_count": 1,
        "report_blinded": False,
        "created_at": now,
        "updated_at": now,
    }
    try:
        result = await mongo.clubs.insert_one(doc)
    except Exception as e:  # DuplicateKeyError(경쟁) — 인덱스 키로 사유 판별
        msg = str(e)
        if "name_lc" in msg:
            return JSONResponse(
                status_code=409,
                content={"error": "이미 사용 중인 크루 이름입니다.", "code": CLUB_NAME_TAKEN_CODE},
            )
        if "owner_id" in msg:
            return JSONResponse(
                status_code=409,
                content={"error": "이미 운영 중인 크루가 있어요. 크루는 계정당 1개만 만들 수 있습니다.",
                         "code": CLUB_LIMIT_CODE},
            )
        raise
    club_id = str(result.inserted_id)

    # 개설자 자동 가입(owner) — 유니크(club_id,user_id) 인덱스 하 멱등
    try:
        await mongo.club_members.insert_one(
            {"club_id": club_id, "user_id": user_id, "role": "owner", "joined_at": now}
        )
    except Exception:
        logger.exception("[Club] create owner_join failed club=%s user=%s", _short(club_id), _short(user_id))

    logger.info("[Club] create ok club=%s user=%s", _short(club_id), _short(user_id))
    return {
        "id": club_id,
        "name": name,
        "description": description,
        "member_count": 1,
        "owner_id": user_id,
        "role": "owner",
    }


@router.get("/")
async def list_clubs(
    sort: str = Query("new"),
    limit: int = Query(20),
    before: Optional[str] = None,
    current_user=Depends(get_current_user_optional),
):
    """클럽 목록 — sort=new(최신)|members(인원순), before=<club id> 커서. 블라인드 제외.

    v3.253 popular: recognition.rp desc → 동률 member_count desc → _id desc(결정적).
    recognition.rp 부재(구 크루) = rp 0 그룹으로 정렬·커서 모두 일관 취급. new/members 는 기존 불변.
    v3.257: popular 는 비노출 존치 — 앱 미사용(v3.253 계약 구간 앱의 400 방지용 호환 유지,
    응답 항목에 recognition 키는 더 이상 없음 — 정렬 기준값은 내부 필드로만 산다).
    """
    mongo = get_mongo()
    if sort not in LIST_SORTS:
        return JSONResponse(status_code=400, content={"error": "지원하지 않는 정렬입니다."})
    limit = max(1, min(int(limit or 20), LIST_MAX_LIMIT))
    viewer_id = str(current_user.get("id")) if current_user else None

    query = {"report_blinded": {"$ne": True}}
    if before and not ObjectId.is_valid(before):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 커서입니다."})
    if before:
        if sort == "new":
            query["_id"] = {"$lt": ObjectId(before)}
        elif sort == "members":
            anchor = await mongo.clubs.find_one({"_id": ObjectId(before)}, {"member_count": 1})
            if anchor:
                mc = int(anchor.get("member_count") or 0)
                query["$or"] = [
                    {"member_count": {"$lt": mc}},
                    {"member_count": mc, "_id": {"$lt": ObjectId(before)}},
                ]
        else:
            # v3.253 popular 커서 — rp desc → member_count desc → _id desc. rp 부재는 0 그룹.
            anchor = await mongo.clubs.find_one(
                {"_id": ObjectId(before)}, {"member_count": 1, "recognition": 1}
            )
            if anchor:
                mc = int(anchor.get("member_count") or 0)
                raw_rp = (anchor.get("recognition") or {}).get("rp")
                has_rp = isinstance(raw_rp, (int, float)) and not isinstance(raw_rp, bool)
                ar = float(raw_rp or 0) if has_rp else 0.0
                tie = {"$or": [
                    {"member_count": {"$lt": mc}},
                    {"member_count": mc, "_id": {"$lt": ObjectId(before)}},
                ]}
                if ar > 0:
                    query["$or"] = [
                        {"recognition.rp": {"$lt": ar}},
                        {"recognition.rp": {"$exists": False}},  # rp 부재 — anchor 보다 항상 아래
                        {"$and": [{"recognition.rp": ar}, tie]},
                    ]
                elif has_rp:
                    # 저장 rp<=0 (실운영 미발생 — 방어): Mongo desc 정렬상 부재보다 위
                    query["$or"] = [
                        {"recognition.rp": {"$exists": False}},
                        {"$and": [{"recognition.rp": {"$lte": 0}}, tie]},
                    ]
                else:
                    # rp 부재(최하 그룹) — 그룹 안 member_count 동률 커서만 적용
                    query["$and"] = [{"recognition.rp": {"$exists": False}}, tie]

    if sort == "new":
        sort_spec = [("_id", -1)]
    elif sort == "members":
        sort_spec = [("member_count", -1), ("_id", -1)]
    else:  # popular (v3.253) — rp 부재는 Mongo desc 정렬에서 최하위(=rp0 그룹) 로 온다
        sort_spec = [("recognition.rp", -1), ("member_count", -1), ("_id", -1)]
    docs = await mongo.clubs.find(query).sort(sort_spec).limit(limit).to_list(length=limit)

    club_ids = [str(d["_id"]) for d in docs]
    roles = await _memberships_map(mongo, club_ids, viewer_id)
    pendings = await _pending_map(mongo, club_ids, viewer_id)  # v3.252 승인제
    clubs = []
    for d in docs:
        cid = str(d["_id"])
        item = _serialize_club(d, is_member=cid in roles)
        item["join_status"] = _join_status(cid in roles, cid in pendings)  # v3.252
        clubs.append(item)
    next_before = str(docs[-1]["_id"]) if len(docs) == limit else None
    logger.info(
        "[Club] list ok sort=%s returned=%d viewer=%s", sort, len(clubs),
        _short(viewer_id) if viewer_id else "anon",
    )
    return {"clubs": clubs, "next_before": next_before}


async def _unread_chat_count(mongo, club_id: str, last_read_chat_id) -> int:
    """v3.252 — unread_chat 커서 계산(대화문서 맵 방식 금지, PLAN 명시).

    last_read_chat_id(str ObjectId) 이후(_id $gt) 메시지 수 — 없으면 전체.
    UNREAD_CHAT_CAP 상한(배지 표시용 — 정확한 큰 수는 불필요).
    """
    query = {"club_id": str(club_id)}
    if last_read_chat_id and ObjectId.is_valid(str(last_read_chat_id)):
        query["_id"] = {"$gt": ObjectId(str(last_read_chat_id))}
    try:
        n = int(await mongo.club_chat_messages.count_documents(query))
    except Exception:  # noqa: BLE001 — unread 계산 실패는 0 강등(목록 유지)
        logger.warning("[Club] unread_chat failed club=%s", _short(club_id))
        return 0
    return min(n, UNREAD_CHAT_CAP)


@router.get("/mine")
async def list_my_clubs(current_user=Depends(get_current_user)):
    """내 크루 목록(role 포함) — 가입순 최신. v3.252: join_status='member'·unread_chat 가산."""
    mongo = get_mongo()
    user_id = str(current_user["id"])
    memberships = (
        await mongo.club_members.find({"user_id": user_id})
        .sort("joined_at", -1)
        .to_list(length=None)
    )
    role_by_id = {m["club_id"]: m.get("role") or "member" for m in memberships}
    last_read_by_id = {m["club_id"]: m.get("last_read_chat_id") for m in memberships}
    club_oids = [ObjectId(cid) for cid in role_by_id if ObjectId.is_valid(cid)]
    docs = await mongo.clubs.find({"_id": {"$in": club_oids}}).to_list(length=len(club_oids)) if club_oids else []
    doc_by_id = {str(d["_id"]): d for d in docs}
    clubs = []
    for m in memberships:
        d = doc_by_id.get(m["club_id"])
        if not d or d.get("report_blinded"):
            continue
        item = _serialize_club(d, is_member=True, role=role_by_id[m["club_id"]])
        item["join_status"] = "member"  # v3.252
        item["unread_chat"] = await _unread_chat_count(mongo, m["club_id"], last_read_by_id.get(m["club_id"]))
        clubs.append(item)
    logger.info("[Club] mine ok user=%s returned=%d", _short(user_id), len(clubs))
    return {"clubs": clubs}


@router.get("/{club_id}")
async def get_club(club_id: str, current_user=Depends(get_current_user_optional)):
    """크루 상세 — is_member/role/join_status(viewer-aware). 블라인드는 비관리자 404."""
    mongo = get_mongo()
    doc, err = await get_club_or_404(mongo, club_id, viewer=current_user)
    if err:
        return err
    viewer_id = str(current_user.get("id")) if current_user else None
    membership = await get_membership(mongo, str(doc["_id"]), viewer_id)
    role = (membership.get("role") or "member") if membership else None
    club = _serialize_club(doc, is_member=membership is not None, role=role)
    club["role"] = role  # 비회원 null 포함(상세는 role 키 상시 노출)
    # v3.252 승인제 — pending 조회는 비멤버 viewer 일 때만(멤버는 'member' 확정)
    pending = None
    if membership is None and viewer_id:
        pending = await get_pending_request(mongo, str(doc["_id"]), viewer_id)
    club["join_status"] = _join_status(membership is not None, pending is not None)
    logger.info(
        "[Club] get ok club=%s viewer=%s member=%s",
        _short(club_id), _short(viewer_id) if viewer_id else "anon", membership is not None,
    )
    return {"club": club}


# ---------------------------------------------------------------- 가입/탈퇴


async def _admit_member(mongo, club_doc, user_id: str) -> bool:
    """멤버 편입(v3.245 즉시 가입 로직 재사용) — insert + member_count $inc. 경쟁 중복은 멱등 False."""
    try:
        await mongo.club_members.insert_one(
            {"club_id": str(club_doc["_id"]), "user_id": str(user_id),
             "role": "member", "joined_at": datetime.utcnow()}
        )
        inserted = True
    except Exception:  # DuplicateKeyError — 경쟁 재가입은 멱등 처리
        inserted = False
    if inserted:
        await mongo.clubs.update_one({"_id": club_doc["_id"]}, {"$inc": {"member_count": 1}})
    return inserted


@router.post("/{club_id}/join")
async def join_club(
    club_id: str,
    body: Optional[JoinRequestBody] = None,
    current_user=Depends(get_current_user),
    conn=Depends(get_pg),
):
    """가입 신청(v3.252 승인제 전면 전환 — 대표 확정: 가입·재가입은 운영자 승인 후에만).

    - 즉시 가입 대신 club_join_requests pending 생성 → 202 {status:'pending'}.
    - 중복 신청 멱등(기존 pending → 202 재응답) · 이미 멤버 → 200 기존 응답 셰이프 유지.
    - kicked 이력자(club_kicks 존재)도 동일 신청 경유 — 자동 거부 없음(운영자 판단, was_kicked 표시).
    - 어린이 가입 신청 허용(PLAN 기본값 유지). rejected/withdrawn 후 재신청 = 같은 문서 pending 전환.
    """
    mongo = get_mongo()
    user_id = str(current_user["id"])
    doc, err = await get_club_or_404(mongo, club_id, viewer=current_user)
    if err:
        return err
    cid = str(doc["_id"])

    existing = await get_membership(mongo, cid, user_id)
    if existing:
        role = existing.get("role") or "member"
        logger.info("[Club] join noop club=%s user=%s role=%s", _short(cid), _short(user_id), role)
        fresh = await mongo.clubs.find_one({"_id": doc["_id"]}, {"member_count": 1})
        return {"member_count": int((fresh or {}).get("member_count") or 0), "role": role}

    pending = await get_pending_request(mongo, cid, user_id)
    if pending:
        logger.info("[Club] join request noop(pending) club=%s user=%s", _short(cid), _short(user_id))
        return JSONResponse(status_code=202, content={"status": JOIN_PENDING})

    message = (getattr(body, "message", None) or "").strip()[:MAX_JOIN_MESSAGE_LEN] or None
    if message:
        # 운영자에게 노출되는 텍스트 — 채팅과 같은 where 로 금칙어 검사(어린이 개인정보 포함)
        filtered = await word_filter_response(user_id, [message], "club_chat", conn)
        if filtered is not None:
            return filtered

    now = datetime.utcnow()
    # (club_id,user_id) 1문서 upsert — rejected/withdrawn 재신청은 pending 으로 재전환.
    # 동시 최초 신청 경쟁은 (club_id,user_id) 유니크 인덱스 + DuplicateKeyError 흡수로 멱등(202 동일 응답).
    try:
        await mongo.club_join_requests.update_one(
            {"club_id": cid, "user_id": user_id},
            {"$set": {"status": JOIN_PENDING, "requested_at": now, "message": message,
                      "decided_at": None, "decided_by": None},
             "$setOnInsert": {"created_at": now}},
            upsert=True,
        )
    except Exception:  # DuplicateKeyError(동시 upsert 경쟁) — 이미 신청 문서 존재 = 멱등
        logger.info("[Club] join request race(noop) club=%s user=%s", _short(cid), _short(user_id))
    logger.info("[Club] join request ok club=%s user=%s msg_len=%d", _short(cid), _short(user_id), len(message or ""))
    return JSONResponse(status_code=202, content={"status": JOIN_PENDING})


@router.delete("/{club_id}/join")
async def leave_club(club_id: str, current_user=Depends(get_current_user)):
    """탈퇴 — owner 는 400(code=owner_cannot_leave). member_count 음수 방지 가드.

    v3.252: 비멤버 + pending 신청이면 신청 철회(withdrawn)로 동작 — 재신청 가능.
    """
    mongo = get_mongo()
    user_id = str(current_user["id"])
    doc, err = await get_club_or_404(mongo, club_id, viewer=current_user)
    if err:
        return err
    cid = str(doc["_id"])

    membership = await get_membership(mongo, cid, user_id)
    if not membership:
        # v3.252 승인제 — pending 신청 철회
        pending = await get_pending_request(mongo, cid, user_id)
        if pending:
            await mongo.club_join_requests.update_one(
                {"club_id": cid, "user_id": user_id, "status": JOIN_PENDING},
                {"$set": {"status": JOIN_WITHDRAWN, "decided_at": datetime.utcnow(), "decided_by": user_id}},
            )
            logger.info("[Club] join request withdrawn club=%s user=%s", _short(cid), _short(user_id))
            return {"message": "가입 신청을 취소했어요.", "status": JOIN_WITHDRAWN}
        logger.info("[Club] leave noop club=%s user=%s", _short(cid), _short(user_id))
        return {"message": "가입하지 않은 크루입니다."}
    if (membership.get("role") or "member") == "owner":
        logger.info("[Club] leave owner_blocked club=%s user=%s", _short(cid), _short(user_id))
        return JSONResponse(
            status_code=400,
            content={"error": "크루장은 탈퇴할 수 없습니다.", "code": OWNER_CANNOT_LEAVE_CODE},
        )

    result = await mongo.club_members.delete_one({"club_id": cid, "user_id": user_id})
    if result.deleted_count:
        # 음수 방지 가드 (feeds like_count 관행 동일)
        await mongo.clubs.update_one(
            {"_id": doc["_id"], "member_count": {"$gt": 0}}, {"$inc": {"member_count": -1}}
        )
    logger.info("[Club] leave ok club=%s user=%s", _short(cid), _short(user_id))
    return {"message": "크루에서 탈퇴했습니다."}


# ---------------------------------------------------------------- 가입 승인 (v3.252 — owner 전용)


@router.get("/{club_id}/join-requests")
async def list_join_requests(
    club_id: str,
    limit: int = Query(30),
    before: Optional[str] = None,
    current_user=Depends(get_current_user),
    conn=Depends(get_pg),
):
    """가입 신청 목록(owner 전용 — 비owner 403). 최신 신청순(_id DESC), before=<신청 doc id>.

    was_kicked = club_kicks 이력 존재(v3.249 계약 — 자동 거부 아님, 운영자 판단 참고용).
    닉네임 PG 1쿼리 조인 — 실패 시 None 강등(목록 유지).
    """
    mongo = get_mongo()
    user_id = str(current_user["id"])
    doc, err = await get_club_or_404(mongo, club_id, viewer=current_user)
    if err:
        return err
    cid = str(doc["_id"])
    if doc.get("owner_id") != user_id:
        logger.info("[Club] join_requests forbidden club=%s user=%s", _short(cid), _short(user_id))
        return JSONResponse(status_code=403, content={"error": "크루장만 가입 신청을 볼 수 있습니다."})

    limit = max(1, min(int(limit or 30), LIST_MAX_LIMIT))
    query = {"club_id": cid, "status": JOIN_PENDING}
    if before:
        if not ObjectId.is_valid(before):
            return JSONResponse(status_code=400, content={"error": "유효하지 않은 커서입니다."})
        query["_id"] = {"$lt": ObjectId(before)}
    rows = (
        await mongo.club_join_requests.find(query)
        .sort([("_id", -1)])
        .limit(limit)
        .to_list(length=limit)
    )

    ids = [str(r["user_id"]) for r in rows]
    nicknames = await _nickname_map(conn, ids, cid, "join_requests")
    kicked = set()
    if ids:
        try:
            kdocs = await mongo.club_kicks.find(
                {"club_id": cid, "user_id": {"$in": ids}}, {"user_id": 1}
            ).to_list(length=None)
            kicked = {str(k["user_id"]) for k in kdocs}
        except Exception:  # noqa: BLE001 — 이력 조회 실패는 False 강등(목록 유지)
            logger.warning("[Club] join_requests kicks_failed club=%s", _short(cid))

    requests = []
    for r in rows:
        uid = str(r["user_id"])
        requests.append({
            "user_id": uid,
            "nickname": nicknames.get(uid),
            "requested_at": _iso(r.get("requested_at")),
            "message": r.get("message"),
            "was_kicked": uid in kicked,
        })
    next_before = str(rows[-1]["_id"]) if len(rows) == limit else None
    logger.info("[Club] join_requests ok club=%s returned=%d", _short(cid), len(requests))
    return {"requests": requests, "next_before": next_before}


async def _decide_join_request(club_id: str, target_user_id: str, current_user, approve: bool):
    """approve/reject 공용 — owner 검증 + pending 조회 + 상태 전이."""
    mongo = get_mongo()
    actor_id = str(current_user["id"])
    doc, err = await get_club_or_404(mongo, club_id, viewer=current_user)
    if err:
        return None, None, None, err
    cid = str(doc["_id"])
    if doc.get("owner_id") != actor_id:
        logger.info("[Club] join_decide forbidden club=%s user=%s by=%s",
                    _short(cid), _short(target_user_id), _short(actor_id))
        return None, None, None, JSONResponse(
            status_code=403, content={"error": "크루장만 가입 신청을 처리할 수 있습니다."}
        )
    target_id = str(target_user_id or "").strip()
    pending = await get_pending_request(mongo, cid, target_id) if target_id else None
    if not pending:
        logger.info("[Club] join_decide not_found club=%s user=%s approve=%s",
                    _short(cid), _short(target_id), approve)
        return None, None, None, JSONResponse(status_code=404, content=JOIN_REQUEST_NOT_FOUND)
    return mongo, doc, pending, None


@router.post("/{club_id}/join-requests/{user_id}/approve")
async def approve_join_request(club_id: str, user_id: str, current_user=Depends(get_current_user)):
    """가입 신청 승인(owner 전용) — 멤버 편입(기존 가입 로직 재사용) + status=approved."""
    mongo, doc, pending, err = await _decide_join_request(club_id, user_id, current_user, approve=True)
    if err:
        return err
    cid = str(doc["_id"])
    target_id = str(pending["user_id"])
    actor_id = str(current_user["id"])

    already = await get_membership(mongo, cid, target_id)
    if not already:
        await _admit_member(mongo, doc, target_id)
    await mongo.club_join_requests.update_one(
        {"club_id": cid, "user_id": target_id, "status": JOIN_PENDING},
        {"$set": {"status": JOIN_APPROVED, "decided_at": datetime.utcnow(), "decided_by": actor_id}},
    )
    fresh = await mongo.clubs.find_one({"_id": doc["_id"]}, {"member_count": 1})
    logger.info("[Club] join approve ok club=%s user=%s by=%s", _short(cid), _short(target_id), _short(actor_id))
    return {
        "message": "가입 신청을 승인했어요.",
        "club_id": cid,
        "user_id": target_id,
        "role": "member",
        "member_count": int((fresh or {}).get("member_count") or 0),
    }


@router.post("/{club_id}/join-requests/{user_id}/reject")
async def reject_join_request(club_id: str, user_id: str, current_user=Depends(get_current_user)):
    """가입 신청 거절(owner 전용) — status=rejected(재신청 가능)."""
    mongo, doc, pending, err = await _decide_join_request(club_id, user_id, current_user, approve=False)
    if err:
        return err
    cid = str(doc["_id"])
    target_id = str(pending["user_id"])
    actor_id = str(current_user["id"])
    await mongo.club_join_requests.update_one(
        {"club_id": cid, "user_id": target_id, "status": JOIN_PENDING},
        {"$set": {"status": JOIN_REJECTED, "decided_at": datetime.utcnow(), "decided_by": actor_id}},
    )
    logger.info("[Club] join reject ok club=%s user=%s by=%s", _short(cid), _short(target_id), _short(actor_id))
    return {
        "message": "가입 신청을 거절했어요.",
        "club_id": cid,
        "user_id": target_id,
        "status": JOIN_REJECTED,
    }


# ---------------------------------------------------------------- 크루 단톡방 (v3.252)


async def _chat_member_gate(mongo, club_id: str, current_user, allow_admin: bool = True):
    """채팅 공용 게이트 — (doc, cid, err). 멤버 전용 403(관리자는 열람 목적 허용 — members 목록 관행)."""
    doc, err = await get_club_or_404(mongo, club_id, viewer=current_user)
    if err:
        return None, None, err
    cid = str(doc["_id"])
    user_id = str(current_user["id"])
    membership = await get_membership(mongo, cid, user_id)
    if not membership and not (allow_admin and _is_admin(current_user)):
        logger.info("[Club] chat forbidden club=%s user=%s", _short(cid), _short(user_id))
        return None, None, JSONResponse(
            status_code=403,
            content={"error": "크루 멤버만 이용할 수 있습니다.", "code": CLUB_MEMBERS_ONLY_CODE},
        )
    return doc, cid, None


@router.post("/{club_id}/chat")
async def send_club_chat(
    club_id: str,
    body: ChatSendBody,
    current_user=Depends(get_current_user),
    conn=Depends(get_pg),
):
    """크루 채팅 송신 — 멤버 전용(관리자 예외 없음 — 송신은 멤버만) · 어린이 403 child_restricted ·
    워드필터 where='club_chat' · Redis 슬라이딩 레이트리밋(10건/30초 → 429 rate_limited).

    dm_blocks 상호 차단자의 메시지도 저장·팬아웃한다 — 전체 채팅이라 서버 필터링 시
    커서·읽음 계산이 viewer 마다 갈라지므로 차단 표시는 클라 필터 소관(설계 판단).
    송신 성공 시 Redis `club:{club_id}` publish {type:'club_chat', club_id, message}.
    """
    mongo = get_mongo()
    user_id = str(current_user["id"])
    doc, err = await get_club_or_404(mongo, club_id, viewer=current_user)
    if err:
        return err
    cid = str(doc["_id"])

    membership = await get_membership(mongo, cid, user_id)
    if not membership:
        logger.info("[Club] chat send forbidden club=%s user=%s", _short(cid), _short(user_id))
        return JSONResponse(
            status_code=403,
            content={"error": "크루 멤버만 채팅할 수 있습니다.", "code": CLUB_MEMBERS_ONLY_CODE},
        )

    # 어린이 전면 차단(PLAN 기본값 — 킬 스위치 OFF 면 DB 0회 no-op)
    _kids_block = await kids_policy.kids_guard(user_id, "club_chat", conn)
    if _kids_block is not None:
        logger.info("[Club] chat send child_blocked club=%s user=%s", _short(cid), _short(user_id))
        return _kids_block

    text = (body.text or "").strip()
    if not text or len(text) > CHAT_MAX_TEXT_LEN:
        return JSONResponse(
            status_code=400, content={"error": f"메시지는 1~{CHAT_MAX_TEXT_LEN}자여야 합니다."}
        )

    filtered = await word_filter_response(user_id, [text], "club_chat", conn)
    if filtered is not None:
        return filtered

    if await _chat_rate_limited(cid, user_id):
        return JSONResponse(
            status_code=429,
            content={"error": "메시지를 너무 빨리 보내고 있어요. 잠시 후 다시 보내주세요.",
                     "code": RATE_LIMITED_CODE},
        )

    now = datetime.now(timezone.utc)
    msg_doc = {
        "club_id": cid,
        "sender_id": user_id,
        "text": text,
        "created_at": now,
        "deleted": False,
    }
    res = await mongo.club_chat_messages.insert_one(msg_doc)
    msg_doc["_id"] = res.inserted_id

    # 본인 last_read 전진 — 자기 메시지가 unread_chat 로 잡히지 않게
    try:
        await mongo.club_members.update_one(
            {"club_id": cid, "user_id": user_id},
            {"$set": {"last_read_chat_id": str(res.inserted_id)}},
        )
    except Exception:  # noqa: BLE001
        logger.warning("[Club] chat send last_read_failed club=%s user=%s", _short(cid), _short(user_id))

    nickname = None
    try:
        nickname = await conn.fetchval(
            "SELECT nickname FROM users WHERE id = $1", uuid.UUID(user_id)
        )
    except Exception:  # noqa: BLE001 — 닉네임 실패는 None 강등(전송 유지)
        pass

    message = _serialize_chat_message(msg_doc, nickname=nickname)
    await dm_service.publish_to_club(cid, {"type": "club_chat", "club_id": cid, "message": message})
    logger.info("[Club] chat send ok club=%s user=%s len=%d", _short(cid), _short(user_id), len(text))
    return {"message": message}


@router.get("/{club_id}/chat")
async def list_club_chat(
    club_id: str,
    limit: int = Query(30),
    before: Optional[str] = None,
    after: Optional[str] = None,
    current_user=Depends(get_current_user),
    conn=Depends(get_pg),
):
    """크루 채팅 목록(멤버 전용 — 관리자는 모더레이션 열람 허용).

    - 기본/before: _id DESC(최신부터 과거로 — 프론트 reverse), next_before 커서.
    - after: _id > after ASC(재접속 캐치업 — 소켓 재연결 시 마지막 수신 이후분), next_after 커서.
      before 와 after 동시 지정은 400. 응답엔 next_before/next_after 둘 다 상시 포함(미해당 null).
    - 어린이는 채팅 전면 차단(PLAN 기본값) — 읽기도 403 child_restricted.
    - deleted 메시지는 본문 마스킹('삭제된 메시지예요') 후 자리 유지(커서 안정).
    """
    mongo = get_mongo()
    user_id = str(current_user["id"])
    doc, cid, err = await _chat_member_gate(mongo, club_id, current_user)
    if err:
        return err

    _kids_block = await kids_policy.kids_guard(user_id, "club_chat", conn)
    if _kids_block is not None:
        return _kids_block

    if before and after:
        return JSONResponse(status_code=400, content={"error": "before 와 after 는 함께 쓸 수 없습니다."})
    limit = max(1, min(int(limit or 30), CHAT_LIST_MAX_LIMIT))
    query = {"club_id": cid}
    catchup = bool(after)
    cursor = after if catchup else before
    if cursor:
        if not ObjectId.is_valid(cursor):
            return JSONResponse(status_code=400, content={"error": "유효하지 않은 커서입니다."})
        query["_id"] = {"$gt": ObjectId(cursor)} if catchup else {"$lt": ObjectId(cursor)}
    rows = (
        await mongo.club_chat_messages.find(query)
        .sort([("_id", 1 if catchup else -1)])
        .limit(limit)
        .to_list(length=limit)
    )

    nicknames = await _nickname_map(conn, sorted({str(r["sender_id"]) for r in rows}), cid, "chat")
    messages = [_serialize_chat_message(r, nickname=nicknames.get(str(r["sender_id"]))) for r in rows]
    tail = str(rows[-1]["_id"]) if len(rows) == limit else None
    logger.info(
        "[Club] chat list ok club=%s returned=%d mode=%s viewer=%s",
        _short(cid), len(messages), "after" if catchup else "before", _short(user_id),
    )
    return {
        "messages": messages,
        "next_before": None if catchup else tail,
        "next_after": tail if catchup else None,
    }


@router.post("/{club_id}/chat/read")
async def read_club_chat(
    club_id: str,
    body: ChatReadBody,
    current_user=Depends(get_current_user),
):
    """읽음 커서 갱신 — club_members.last_read_chat_id(단조 전진 — 뒤로 가는 갱신은 무시)."""
    mongo = get_mongo()
    user_id = str(current_user["id"])
    doc, err = await get_club_or_404(mongo, club_id, viewer=current_user)
    if err:
        return err
    cid = str(doc["_id"])
    membership = await get_membership(mongo, cid, user_id)
    if not membership:
        return JSONResponse(
            status_code=403,
            content={"error": "크루 멤버만 이용할 수 있습니다.", "code": CLUB_MEMBERS_ONLY_CODE},
        )
    last_id = str(body.last_id or "").strip()
    if not ObjectId.is_valid(last_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 커서입니다."})

    current = str(membership.get("last_read_chat_id") or "")
    # str(ObjectId) 는 등장 순 증가·등길이 — 문자열 비교로 단조 전진 판정
    if not current or last_id > current:
        await mongo.club_members.update_one(
            {"club_id": cid, "user_id": user_id},
            {"$set": {"last_read_chat_id": last_id}},
        )
        effective = last_id
    else:
        effective = current
    logger.info("[Club] chat read ok club=%s user=%s", _short(cid), _short(user_id))
    return {"ok": True, "last_read_chat_id": effective}


@router.delete("/{club_id}/chat/{message_id}")
async def delete_club_chat_message(
    club_id: str,
    message_id: str,
    current_user=Depends(get_current_user),
):
    """채팅 메시지 삭제 — 작성자 본인 or 크루장(owner). deleted:true 소프트 삭제(본문 마스킹).

    원문은 DB 보존 — 신고 증거·어드민 조치용. 이미 삭제된 메시지는 멱등 200.
    """
    mongo = get_mongo()
    user_id = str(current_user["id"])
    doc, err = await get_club_or_404(mongo, club_id, viewer=current_user)
    if err:
        return err
    cid = str(doc["_id"])

    if not ObjectId.is_valid(message_id):
        return JSONResponse(status_code=404, content={"error": "메시지를 찾을 수 없습니다."})
    msg = await mongo.club_chat_messages.find_one({"_id": ObjectId(message_id), "club_id": cid})
    if not msg:
        return JSONResponse(status_code=404, content={"error": "메시지를 찾을 수 없습니다."})

    is_owner = doc.get("owner_id") == user_id
    if str(msg.get("sender_id")) != user_id and not is_owner:
        logger.info("[Club] chat delete forbidden club=%s msg=%s by=%s", _short(cid), _short(message_id), _short(user_id))
        return JSONResponse(status_code=403, content={"error": "본인 메시지 또는 크루장만 삭제할 수 있습니다."})

    if not msg.get("deleted"):
        await mongo.club_chat_messages.update_one(
            {"_id": ObjectId(message_id)},
            {"$set": {"deleted": True, "deleted_by": user_id,
                      "deleted_at": datetime.now(timezone.utc)}},
        )
    logger.info("[Club] chat delete ok club=%s msg=%s by=%s owner=%s",
                _short(cid), _short(message_id), _short(user_id), is_owner)
    return {"ok": True, "id": str(msg["_id"]), "deleted": True}


# ---------------------------------------------------------------- 멤버 관리 (v3.249)


@router.get("/{club_id}/members")
async def list_club_members(
    club_id: str,
    limit: int = Query(30),
    before: Optional[str] = None,
    current_user=Depends(get_current_user_optional),
    conn=Depends(get_pg),
):
    """멤버 목록 — v3.261 공개 구조(외부 익명, 내부 실명. 대표 확정).

    - 멤버·관리자 viewer: 기존 응답 그대로(user_id·nickname·role·joined_at — user_id 는 앱의
      탭→채널 이동에 사용) + anonymous:false 명시(앱 분기 단순화).
    - 비멤버·비로그인 viewer: 200 익명 모드 {anonymous:true, member_count, members:[{role,joined_at}],
      next_before} — user_id·nickname 미포함(운영자 행도 역할만). PG 닉네임 조인도 생략(개인정보 0회 조회).
    - 커서는 양 모드 동일: 최신 가입순(club_members _id DESC), before=<멤버십 doc id>.
    - 블라인드 크루는 비관리자 404 유지(get_club_or_404 — 익명 viewer 포함).
    닉네임은 PG users 1쿼리 조인 — 조회 실패 시 None(목록 자체는 유지, 후보 목록 관행).
    """
    mongo = get_mongo()
    viewer_id = str(current_user["id"]) if current_user else None
    doc, err = await get_club_or_404(mongo, club_id, viewer=current_user)
    if err:
        return err
    cid = str(doc["_id"])

    membership = await get_membership(mongo, cid, viewer_id) if viewer_id else None
    anonymous = membership is None and not _is_admin(current_user)

    limit = max(1, min(int(limit or 30), LIST_MAX_LIMIT))
    query = {"club_id": cid}
    if before:
        if not ObjectId.is_valid(before):
            return JSONResponse(status_code=400, content={"error": "유효하지 않은 커서입니다."})
        query["_id"] = {"$lt": ObjectId(before)}
    rows = (
        await mongo.club_members.find(query)
        .sort([("_id", -1)])
        .limit(limit)
        .to_list(length=limit)
    )
    next_before = str(rows[-1]["_id"]) if len(rows) == limit else None

    if anonymous:
        members = [{
            "role": m.get("role") or "member",
            "joined_at": m["joined_at"].isoformat()
            if isinstance(m.get("joined_at"), datetime) else m.get("joined_at"),
        } for m in rows]
        logger.info("[Club] members ok(anon) club=%s returned=%d viewer=%s",
                    _short(cid), len(members), _short(viewer_id) if viewer_id else "anon")
        return {
            "anonymous": True,
            "member_count": int(doc.get("member_count") or 0),
            "members": members,
            "next_before": next_before,
        }

    ids = [str(m["user_id"]) for m in rows]
    nicknames = {}
    if ids:
        try:
            profs = await conn.fetch(
                "SELECT id::text AS id, nickname FROM users WHERE id::text = ANY($1)", ids
            )
            nicknames = {r["id"]: r["nickname"] for r in profs}
        except Exception as e:  # noqa: BLE001 — 닉네임 조인 실패는 None 강등(목록 유지)
            logger.warning("[Club] members profile_failed club=%s err=%s", _short(cid), type(e).__name__)

    members = []
    for m in rows:
        uid = str(m["user_id"])
        joined_at = m.get("joined_at")
        members.append({
            "user_id": uid,
            "nickname": nicknames.get(uid),
            "role": m.get("role") or "member",
            "joined_at": joined_at.isoformat() if isinstance(joined_at, datetime) else joined_at,
        })
    logger.info("[Club] members ok club=%s returned=%d viewer=%s", _short(cid), len(members), _short(viewer_id))
    return {"anonymous": False, "members": members, "next_before": next_before}


@router.delete("/{club_id}/members/{user_id}")
async def kick_club_member(club_id: str, user_id: str, current_user=Depends(get_current_user)):
    """멤버 내보내기(kick) — owner 전용. 대상 작성물(글·댓글)·클럽 플리 곡 추가분은 보존.

    - 본인(=owner)·owner 대상 400 cannot_kick_owner · 미멤버 404 · 비owner 403.
    - member_count 는 leave_club 과 동일한 음수 방지 $inc 가드.
    - club_kicks 기록{club_id,user_id,by,at} — 후속 '가입 차단' 옵션 기반(재가입은 MVP 허용,
      기록 실패는 로그만 — 내보내기 자체는 유효).
    """
    mongo = get_mongo()
    actor_id = str(current_user["id"])
    doc, err = await get_club_or_404(mongo, club_id, viewer=current_user)
    if err:
        return err
    cid = str(doc["_id"])

    if doc.get("owner_id") != actor_id:
        logger.info("[Club] kick forbidden club=%s user=%s by=%s", _short(cid), _short(user_id), _short(actor_id))
        return JSONResponse(status_code=403, content={"error": "크루장만 멤버를 내보낼 수 있습니다."})

    target_id = str(user_id or "").strip()
    if not target_id or target_id == actor_id:
        return JSONResponse(
            status_code=400,
            content={"error": "크루장은 내보낼 수 없습니다.", "code": CANNOT_KICK_OWNER_CODE},
        )

    target = await get_membership(mongo, cid, target_id)
    if not target:
        logger.info("[Club] kick not_member club=%s user=%s", _short(cid), _short(target_id))
        return JSONResponse(status_code=404, content={"error": "크루 멤버가 아닙니다."})
    if (target.get("role") or "member") == "owner":
        # 방어 — clubs.owner_id 와 roles 불일치(위임 경쟁 등) 시에도 owner 는 kick 불가
        return JSONResponse(
            status_code=400,
            content={"error": "크루장은 내보낼 수 없습니다.", "code": CANNOT_KICK_OWNER_CODE},
        )

    result = await mongo.club_members.delete_one({"club_id": cid, "user_id": target_id})
    if result.deleted_count:
        # 음수 방지 가드 (leave_club 관행 동일)
        await mongo.clubs.update_one(
            {"_id": doc["_id"], "member_count": {"$gt": 0}}, {"$inc": {"member_count": -1}}
        )
        try:
            await mongo.club_kicks.insert_one(
                {"club_id": cid, "user_id": target_id, "by": actor_id, "at": datetime.utcnow()}
            )
        except Exception:  # noqa: BLE001
            logger.exception("[Club] kick log failed club=%s user=%s", _short(cid), _short(target_id))

    logger.info("[Club] kick ok club=%s user=%s by=%s", _short(cid), _short(target_id), _short(actor_id))
    fresh = await mongo.clubs.find_one({"_id": doc["_id"]}, {"member_count": 1})
    return {
        "message": "멤버를 내보냈습니다.",
        "club_id": cid,
        "user_id": target_id,
        "member_count": int((fresh or {}).get("member_count") or 0),
    }


# ---------------------------------------------------------------- 크루 홍보 (v3.261)


def _promo_keywords(raw) -> list:
    """키워드 정규화 — strip·빈값 제거·순서 보존 중복 제거. list 외 타입은 빈 목록."""
    if not isinstance(raw, list):
        return []
    out = []
    for k in raw:
        if not isinstance(k, str):
            continue
        k = k.strip()
        if k and k not in out:
            out.append(k)
    return out


@router.post("/{club_id}/promote")
async def promote_club(
    club_id: str,
    body: PromoteBody,
    current_user=Depends(get_current_user),
    conn=Depends(get_pg),
):
    """크루 홍보(키워드 타겟) — owner 전용. 무인증 401 · 비owner 403 · 블라인드 404.

    - genres/moods 합쳐 1~5개 필수(400) · 키워드 1개 ≤30자(400) ·
      message ≤100자(400) + 워드필터 where='club_profile'.
    - 크루당 쿨다운 7일: Mongo club_promos 최근 기록 기준 — 7일 내면 429
      {code:'promo_cooldown', next_at}(Redis 키 대신 Mongo — 재시작 생존·감사 추적 일원화).
    - 타겟 = tracks 최근 90일 공개곡(genre∈genres or mood∈moods)의 uploader 중복 제거
      → 자기 크루 멤버 제외 → 어린이 제외(kids_policy — 킬 스위치 OFF 면 전원 통과, PG 실패는
      fail-open + forced 목록만 차단: is_child_user 관행) → 주간 수신 상한 2건 초과 유저 제외
      (club_promo_receipts {user_id,week(KST ISO 주)} 카운트). 차단 여부 확인 불필요(알림이라).
    - 기록: club_promos {club_id, by, keywords{genres,moods}, message, targeted, at} 선기록(감사·쿨다운).
    - 발송: push_notification type='club_promo'(자체 예외 흡수) + club_promo_receipts 발송 시도 기록,
      1인 실패 격리 best-effort(receipt 실패 유저는 다음 홍보 상한에 미산입). 응답 {targeted, next_at}.
    """
    mongo = get_mongo()
    user_id = str(current_user["id"])
    doc, err = await get_club_or_404(mongo, club_id, viewer=current_user)
    if err:
        return err
    cid = str(doc["_id"])

    if doc.get("owner_id") != user_id:
        logger.info("[ClubPromo] forbidden club=%s user=%s", _short(cid), _short(user_id))
        return JSONResponse(status_code=403, content={"error": "크루장만 홍보를 보낼 수 있습니다."})

    # v3.266 — 자유 키워드 모드 우선, 없으면 v3.261 장르·무드 레거시
    keyword = (body.keyword or "").strip()
    genres = _promo_keywords(body.genres)
    moods = _promo_keywords(body.moods)
    if keyword:
        if not (PROMO_MIN_KEYWORD_LEN <= len(keyword) <= PROMO_MAX_KEYWORD_LEN):
            return JSONResponse(
                status_code=400,
                content={"error": f"키워드는 {PROMO_MIN_KEYWORD_LEN}~{PROMO_MAX_KEYWORD_LEN}자로 입력해주세요."},
            )
        # 키워드도 노출면(알림 preview에 실림) — 크루 소개와 동일 워드필터
        kw_filtered = await word_filter_response(user_id, [keyword], "club_profile", conn)
        if kw_filtered is not None:
            return kw_filtered
    else:
        total_kw = len(genres) + len(moods)
        if not (1 <= total_kw <= PROMO_MAX_KEYWORDS):
            return JSONResponse(
                status_code=400,
                content={"error": "홍보 키워드를 입력해주세요."},
            )
        if any(len(k) > PROMO_MAX_KEYWORD_LEN for k in genres + moods):
            return JSONResponse(
                status_code=400,
                content={"error": f"키워드는 {PROMO_MAX_KEYWORD_LEN}자 이하여야 합니다."},
            )

    message = (body.message or "").strip()
    if len(message) > PROMO_MAX_MESSAGE_LEN:
        return JSONResponse(
            status_code=400,
            content={"error": f"홍보 메시지는 {PROMO_MAX_MESSAGE_LEN}자 이하여야 합니다."},
        )
    if message:
        # 크루 이름·소개와 동일 노출면 — where='club_profile'(SOCIAL_WHERE 포함)
        filtered = await word_filter_response(user_id, [message], "club_profile", conn)
        if filtered is not None:
            return filtered
    message = message or None

    # 쿨다운 7일 — club_promos 최근 기록 기준(있으면 429 + next_at)
    last = await mongo.club_promos.find_one({"club_id": cid}, sort=[("at", -1)])
    now = datetime.utcnow()
    if last and isinstance(last.get("at"), datetime):
        last_at = last["at"]
        if last_at.tzinfo is not None:
            last_at = last_at.astimezone(timezone.utc).replace(tzinfo=None)
        next_allowed = last_at + timedelta(days=PROMO_COOLDOWN_DAYS)
        if now < next_allowed:
            logger.info("[ClubPromo] cooldown club=%s user=%s", _short(cid), _short(user_id))
            return JSONResponse(
                status_code=429,
                content={"error": "크루 홍보는 7일에 한 번만 보낼 수 있어요.",
                         "code": PROMO_COOLDOWN_CODE, "next_at": _iso(next_allowed)},
            )

    # 타겟 선정 ①
    if keyword:
        # v3.266 — ES 관련도 검색 + 정확도 컷: "그 주제로 곡을 만든 이력"이 있는 uploader만.
        # 검색 화면(recall 우선)과 달리 절대 하한(search_es_weak_score) + 상대 컷(top1*0.5)로
        # 저관련 꼬리를 자른다. ES 불능 시 빈 타겟(400 대신 targeted=0 응답 — 쿨다운 미소모).
        from ..services.search_service import es_keyword_affinity
        from ..config import settings as _settings
        try:
            # v3.267 — 검색용 es_search(구절 보너스·인기 보정) 대신 순수 관련도 쿼리:
            # 제목 정확일치가 top1을 끌어올려 상대 컷이 진짜 관련곡을 자르던 실사고 수정
            # (실측 '고양이' top1 28.96 → kept=1 → 타겟 0).
            scored, _top1 = await es_keyword_affinity(keyword, PROMO_MAX_TARGETS)
        except Exception as e:
            logger.warning("[ClubPromo] affinity failed kw_len=%d: %s", len(keyword), str(e)[:120])
            scored, _top1 = [], 0.0
        floor = float(getattr(_settings, "search_es_weak_score", 0.0) or 0.0)
        rel_cut = _top1 * PROMO_ES_REL_CUT
        kept = [tid for tid, sc in scored if sc >= max(floor, rel_cut)]
        logger.info(
            "[ClubPromo] keyword target kw_len=%d hits=%d kept=%d top1=%.2f floor=%.2f",
            len(keyword), len(scored), len(kept), _top1, floor,
        )
        if not kept:
            # 관련 곡 자체가 없음 — 쿨다운·기록 없이 명시 응답(오발송 0)
            return JSONResponse(
                status_code=200,
                content={"targeted": 0, "next_at": None,
                         "note": "이 키워드로 곡을 만든 유저를 찾지 못했어요. 다른 키워드로 시도해보세요."},
            )
        from bson import ObjectId as _OID
        obj_ids = [_OID(t) for t in kept if _OID.is_valid(t)]
        track_rows = await mongo.tracks.find(
            {"_id": {"$in": obj_ids}, "is_public": True},
            {"uploader_id": 1},
        ).to_list(length=None)
    else:
        # v3.261 레거시 — 최근 90일 공개곡 genre/mood 일치
        since = now - timedelta(days=PROMO_RECENT_TRACK_DAYS)
        or_terms = []
        if genres:
            or_terms.append({"genre": {"$in": genres}})
        if moods:
            or_terms.append({"mood": {"$in": moods}})
        track_rows = await mongo.tracks.find(
            {"is_public": True, "created_at": {"$gte": since}, "$or": or_terms},
            {"uploader_id": 1},
        ).to_list(length=None)
    uploader_ids = sorted({str(t["uploader_id"]) for t in track_rows if t.get("uploader_id")})[:PROMO_MAX_TARGETS]

    # ② 자기 크루 멤버 제외(owner 포함)
    member_rows = await mongo.club_members.find({"club_id": cid}, {"user_id": 1}).to_list(length=None)
    member_ids = {str(m["user_id"]) for m in member_rows}
    candidates = [u for u in uploader_ids if u not in member_ids]

    # ③ 어린이 계정 제외 — 배치 1쿼리(birth_date) + is_child_from_row(킬 스위치 OFF 면 PG 0회 전원 통과)
    if candidates and kids_policy.kids_enabled():
        birth_by_id = {}
        try:
            rows = await conn.fetch(
                "SELECT id::text AS id, birth_date FROM users WHERE id::text = ANY($1)", candidates
            )
            birth_by_id = {r["id"]: r["birth_date"] for r in rows}
        except Exception as e:  # noqa: BLE001 — fail-open(is_child_user 관행) + forced 목록은 여전히 차단
            logger.warning("[ClubPromo] birth_lookup_failed club=%s err=%s", _short(cid), type(e).__name__)
        candidates = [u for u in candidates
                      if not kids_policy.is_child_from_row(u, birth_by_id.get(u))]

    # ④ 유저당 크루 홍보 수신 주간 상한(KST ISO 주 — 어느 크루에서 받았든 합산)
    week = _kst_week()
    targets = candidates
    if candidates:
        receipt_rows = await mongo.club_promo_receipts.find(
            {"week": week, "user_id": {"$in": candidates}}, {"user_id": 1}
        ).to_list(length=None)
        recv_count = {}
        for r in receipt_rows:
            u = str(r["user_id"])
            recv_count[u] = recv_count.get(u, 0) + 1
        targets = [u for u in candidates if recv_count.get(u, 0) < PROMO_WEEKLY_RECEIPT_CAP]

    # v3.267 — 필터(멤버·어린이·주간 상한) 후 타겟 0 = 발송할 사람이 없음:
    # 쿨다운·감사 기록을 소모하지 않고 사유를 돌려준다(재시도 가능).
    if not targets:
        logger.info("[ClubPromo] zero-target after filters club=%s kw_len=%d", _short(cid), len(keyword or ""))
        return JSONResponse(
            status_code=200,
            content={"targeted": 0, "next_at": None,
                     "note": "관련 곡을 만든 유저가 모두 이미 크루 멤버이거나, 이번 주 알림 한도에 도달했어요."},
        )

    # 감사 기록 선삽입(쿨다운 기준점 — 발송 실패와 무관하게 1회 시도로 계산)
    promo_doc = {
        "club_id": cid,
        "by": user_id,
        "keywords": {"keyword": keyword or None, "genres": genres, "moods": moods},
        "message": message,
        "targeted": len(targets),
        "at": now,
    }
    res = await mongo.club_promos.insert_one(promo_doc)
    promo_id = str(res.inserted_id)

    # 발송 — best-effort 루프(1인 실패 격리). preview 는 push_notification 이 120자 절단.
    club_name = doc.get("name") or ""
    if keyword:
        # v3.266 — 타겟 근거(키워드)를 밝혀 수신 맥락 제공
        preview = f"'{keyword}' 곡을 만든 당신께 — 크루 '{club_name}'가 멤버를 찾고 있어요"
    else:
        preview = f"취향이 비슷한 크루 '{club_name}'가 멤버를 찾고 있어요"
    if message:
        preview += f" – {message}"
    sent = 0
    for uid in targets:
        try:
            await push_notification(
                mongo,
                user_id=uid,
                ntype=PROMO_NOTIF_TYPE,
                actor_id=user_id,
                actor_nickname=club_name,
                target_id=cid,
                target_type="club_promo",
                preview=preview,
                extra={"club_name": club_name, "promo_message": message},
            )
            await mongo.club_promo_receipts.insert_one(
                {"user_id": uid, "club_id": cid, "promo_id": promo_id, "week": week, "at": now}
            )
            sent += 1
        except Exception:  # noqa: BLE001 — 1인 실패 격리(다음 유저 계속)
            logger.warning("[ClubPromo] send_failed club=%s to=%s", _short(cid), _short(uid))

    next_at = _iso(now + timedelta(days=PROMO_COOLDOWN_DAYS))
    logger.info(
        "[ClubPromo] ok club=%s by=%s mode=%s targeted=%d sent=%d msg_len=%d",
        _short(cid), _short(user_id), ("keyword" if keyword else "genre_mood"),
        len(targets), sent, len(message or ""),
    )
    return {"targeted": len(targets), "next_at": next_at}


# ---------------------------------------------------------------- 클럽장 위임 (v3.247)


def _tenure_ok(joined_at) -> bool:
    """가입 7일 경과 여부 — joined_at 은 utcnow naive 저장 관행(aware 는 naive 로 정규화)."""
    if not isinstance(joined_at, datetime):
        return False
    if joined_at.tzinfo is not None:
        joined_at = joined_at.replace(tzinfo=None)
    return (datetime.utcnow() - joined_at) >= timedelta(days=TRANSFER_MIN_TENURE_DAYS)


async def _club_feed_ids(mongo, club_id: str) -> list:
    """해당 클럽 게시판 글 id 목록(str) — 댓글 활동 판정용(_id 만 프로젝션)."""
    docs = await mongo.feeds.find({"kind": "club", "club_id": str(club_id)}, {"_id": 1}).to_list(length=None)
    return [str(d["_id"]) for d in docs]


async def _member_activity(mongo, conn, club_id: str, user_id, club_feed_ids=None) -> dict:
    """해당 클럽 내 활동 요약 {posts, comments, playlist_adds} — 위임 자격 판정·후보 목록 공용.

    playlist_adds 조회 실패는 0 취급(fail-open 아님 — 활동 OR 조건의 한 갈래일 뿐,
    가입 7일 경과가 있어 자격이 완전히 막히지 않는다) + warning 로그.
    """
    uid = str(user_id)
    posts = await mongo.feeds.count_documents({"kind": "club", "club_id": str(club_id), "author_id": uid})
    if club_feed_ids is None:
        club_feed_ids = await _club_feed_ids(mongo, club_id)
    comments = 0
    if club_feed_ids:
        comments = await mongo.feed_comments.count_documents(
            {"feed_id": {"$in": club_feed_ids}, "author_id": uid}
        )
    playlist_adds = 0
    try:
        playlist_adds = int(
            await conn.fetchval(
                "SELECT COUNT(*) FROM playlist_tracks pt JOIN playlists p ON p.id = pt.playlist_id"
                " WHERE p.club_id = $1 AND pt.added_by = $2",
                str(club_id), uuid.UUID(uid),
            ) or 0
        )
    except Exception as e:  # noqa: BLE001 — PG 오류·비정상 uid 는 0 취급
        logger.warning(
            "[Club] transfer activity pg_failed club=%s user=%s err=%s",
            _short(club_id), _short(uid), type(e).__name__,
        )
    return {"posts": int(posts), "comments": int(comments), "playlist_adds": playlist_adds}


def _activity_eligible(activity: dict, joined_at) -> bool:
    """자격 기본값(v3.247 대표 확인 항목): 활동 1건 이상 OR 가입 7일 경과."""
    return _tenure_ok(joined_at) or any(v > 0 for v in activity.values())


@router.get("/{club_id}/transfer-candidates")
async def list_transfer_candidates(
    club_id: str,
    current_user=Depends(get_current_user),
    conn=Depends(get_pg),
):
    """위임 가능 멤버 목록(owner 전용) — 닉네임·가입일·활동 요약. 자격 미달·어린이 계정 제외.

    owns_other_club=True 멤버는 목록에 남긴다(앱이 비활성 표시) — 실제 위임 시 409 club_limit.
    """
    mongo = get_mongo()
    user_id = str(current_user["id"])
    doc, err = await get_club_or_404(mongo, club_id, viewer=current_user)
    if err:
        return err
    cid = str(doc["_id"])
    if doc.get("owner_id") != user_id:
        logger.info("[Club] transfer candidates forbidden club=%s user=%s", _short(cid), _short(user_id))
        return JSONResponse(status_code=403, content={"error": "크루장만 볼 수 있습니다."})

    memberships = await mongo.club_members.find({"club_id": cid}).to_list(length=None)
    memberships = [m for m in memberships if str(m.get("user_id")) != user_id]
    if not memberships:
        logger.info("[Club] transfer candidates ok club=%s returned=0", _short(cid))
        return {"candidates": []}

    ids = [str(m["user_id"]) for m in memberships]
    profiles = {}
    try:
        rows = await conn.fetch(
            "SELECT id::text AS id, nickname, birth_date FROM users WHERE id::text = ANY($1)", ids
        )
        profiles = {r["id"]: dict(r) for r in rows}
    except Exception as e:  # noqa: BLE001 — 프로필 조회 실패 시 닉네임 None(목록 자체는 유지)
        logger.warning("[Club] transfer candidates profile_failed club=%s err=%s", _short(cid), type(e).__name__)

    other_owners = set()
    try:
        odocs = await mongo.clubs.find(
            {"owner_id": {"$in": ids}, "_id": {"$ne": doc["_id"]}}, {"owner_id": 1}
        ).to_list(length=len(ids))
        other_owners = {d.get("owner_id") for d in odocs}
    except Exception:  # noqa: BLE001
        logger.warning("[Club] transfer candidates owner_lookup_failed club=%s", _short(cid))

    club_feed_ids = await _club_feed_ids(mongo, cid)
    candidates = []
    for m in sorted(memberships, key=lambda x: (x.get("joined_at") or datetime.max)):
        uid = str(m["user_id"])
        prof = profiles.get(uid) or {}
        # v3.247 §1 과 일관 — 어린이 계정은 클럽 소유 불가(킬 스위치 OFF 면 전원 통과)
        if kids_policy.is_child_from_row(uid, prof.get("birth_date")):
            continue
        activity = await _member_activity(mongo, conn, cid, uid, club_feed_ids)
        joined_at = m.get("joined_at")
        tenure = _tenure_ok(joined_at)
        if not (_activity_eligible(activity, joined_at)):
            continue
        candidates.append({
            "user_id": uid,
            "nickname": prof.get("nickname"),
            "joined_at": joined_at.isoformat() if isinstance(joined_at, datetime) else joined_at,
            "tenure_ok": tenure,
            "posts": activity["posts"],
            "comments": activity["comments"],
            "playlist_adds": activity["playlist_adds"],
            "owns_other_club": uid in other_owners,
        })
    logger.info("[Club] transfer candidates ok club=%s returned=%d", _short(cid), len(candidates))
    return {"candidates": candidates}


@router.post("/{club_id}/transfer-owner")
async def transfer_owner(
    club_id: str,
    body: TransferOwnerBody,
    current_user=Depends(get_current_user),
    conn=Depends(get_pg),
):
    """클럽장 위임(owner 전용) — 성공 시 roles 스왑(대상→owner·본인→member)·clubs.owner_id 갱신.

    자격: 해당 클럽 활동(게시글·댓글·클럽 플리 곡 추가 각 ≥1 중 하나) 또는 가입 7일 경과.
    대상이 이미 다른 클럽 owner 면 409 club_limit(계정당 소유 1개 규칙과 일관 —
    clubs.owner_id 유니크 인덱스가 경쟁 최종 방어). 위임 뒤 본인은 일반 탈퇴 가능.
    """
    mongo = get_mongo()
    user_id = str(current_user["id"])
    doc, err = await get_club_or_404(mongo, club_id, viewer=current_user)
    if err:
        return err
    cid = str(doc["_id"])
    if doc.get("owner_id") != user_id:
        logger.info("[Club] transfer forbidden club=%s user=%s", _short(cid), _short(user_id))
        return JSONResponse(status_code=403, content={"error": "크루장만 위임할 수 있습니다."})

    new_owner_id = str(body.new_owner_id or "").strip()
    if not new_owner_id or new_owner_id == user_id:
        return JSONResponse(status_code=400, content={"error": "위임할 다른 멤버를 선택해주세요."})

    target = await get_membership(mongo, cid, new_owner_id)
    if not target:
        logger.info("[Club] transfer not_member club=%s to=%s", _short(cid), _short(new_owner_id))
        return JSONResponse(
            status_code=400,
            content={"error": "크루 멤버에게만 위임할 수 있어요.", "code": TRANSFEREE_NOT_MEMBER_CODE},
        )

    # v3.247 §1 과 일관 — 어린이 계정은 클럽 소유 불가(개설 차단 우회 방지). 킬 스위치 OFF 면 no-op.
    if await kids_policy.is_child_user(new_owner_id, conn):
        logger.info("[Club] transfer child_blocked club=%s to=%s", _short(cid), _short(new_owner_id))
        return JSONResponse(
            status_code=400,
            content={"error": "어린이 계정에는 크루를 위임할 수 없어요.", "code": TRANSFEREE_NOT_ELIGIBLE_CODE},
        )

    other = await mongo.clubs.find_one({"owner_id": new_owner_id, "_id": {"$ne": doc["_id"]}}, {"_id": 1})
    if other:
        logger.info("[Club] transfer club_limit club=%s to=%s other=%s", _short(cid), _short(new_owner_id), _short(other["_id"]))
        return JSONResponse(
            status_code=409,
            content={"error": "이미 다른 크루를 운영 중인 멤버예요. 크루는 계정당 1개만 운영할 수 있습니다.",
                     "code": CLUB_LIMIT_CODE},
        )

    activity = await _member_activity(mongo, conn, cid, new_owner_id)
    if not _activity_eligible(activity, target.get("joined_at")):
        logger.info(
            "[Club] transfer not_eligible club=%s to=%s activity=%r", _short(cid), _short(new_owner_id), activity,
        )
        return JSONResponse(
            status_code=400,
            content={"error": "크루 활동이 있는 멤버에게만 위임할 수 있어요.", "code": TRANSFEREE_NOT_ELIGIBLE_CODE},
        )

    # 커밋 포인트: clubs.owner_id 원자 갱신(owner_id 유니크 인덱스가 경쟁 최종 방어).
    now = datetime.utcnow()
    try:
        result = await mongo.clubs.update_one(
            {"_id": doc["_id"], "owner_id": user_id},
            {"$set": {"owner_id": new_owner_id, "updated_at": now}},
        )
    except Exception as e:  # DuplicateKeyError(경쟁 — 대상이 그 사이 다른 클럽 owner)
        if "owner_id" in str(e):
            return JSONResponse(
                status_code=409,
                content={"error": "이미 다른 크루를 운영 중인 멤버예요. 크루는 계정당 1개만 운영할 수 있습니다.",
                         "code": CLUB_LIMIT_CODE},
            )
        raise
    if not getattr(result, "matched_count", 0):
        logger.info("[Club] transfer conflict club=%s user=%s", _short(cid), _short(user_id))
        return JSONResponse(
            status_code=409,
            content={"error": "크루장 정보가 방금 변경되었습니다. 새로고침 후 다시 시도해주세요.", "code": "conflict"},
        )

    # roles 스왑 — owner_id 갱신이 커밋된 뒤 순서대로(대상 승격 → 본인 강등). 실패는 로그만(응답 불변).
    try:
        await mongo.club_members.update_one(
            {"club_id": cid, "user_id": new_owner_id}, {"$set": {"role": "owner"}}
        )
        await mongo.club_members.update_one(
            {"club_id": cid, "user_id": user_id}, {"$set": {"role": "member"}}
        )
    except Exception:  # noqa: BLE001
        logger.exception("[Club] transfer role_swap failed club=%s from=%s to=%s",
                         _short(cid), _short(user_id), _short(new_owner_id))

    logger.info("[Club] transfer ok club=%s from=%s to=%s", _short(cid), _short(user_id), _short(new_owner_id))
    return {
        "message": "크루장을 위임했습니다. 이제 크루에서 탈퇴할 수 있어요.",
        "club_id": cid,
        "previous_owner_id": user_id,
        "new_owner_id": new_owner_id,
        "role": "member",
    }


# ---------------------------------------------------------------- 클럽 플레이리스트


@router.get("/{club_id}/playlists")
async def list_club_playlists(
    club_id: str,
    current_user=Depends(get_current_user_optional),
    conn=Depends(get_pg),
):
    """클럽 공유 플레이리스트 목록(track_count 포함) — 공개 클럽이라 비회원도 조회 가능."""
    mongo = get_mongo()
    doc, err = await get_club_or_404(mongo, club_id, viewer=current_user)
    if err:
        return err
    cid = str(doc["_id"])

    rows = await conn.fetch(
        """SELECT p.id, p.user_id, p.title, p.description, p.is_public, p.created_at, p.club_id,
                  (SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = p.id) as track_count
           FROM playlists p WHERE p.club_id = $1 ORDER BY p.created_at DESC""",
        cid,
    )
    playlists = [
        {
            "id": str(r["id"]),
            "user_id": str(r["user_id"]),
            "title": r["title"],
            "description": r["description"],
            "is_public": r["is_public"],
            "club_id": r["club_id"],
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
            "track_count": r["track_count"],
        }
        for r in rows
    ]
    logger.info("[Club] playlists ok club=%s returned=%d", _short(cid), len(playlists))
    return {"playlists": playlists}


# ---------------------------------------------------------------- 크루 플리 혜택 (v3.253)


@router.post("/{club_id}/playlists/{playlist_id}/play-start")
async def start_club_playlist_play(
    club_id: str,
    playlist_id: str,
    current_user=Depends(get_current_user),
    conn=Depends(get_pg),
):
    """크루 플리 재생 시작(담기) — 비멤버 청취자면 크루 RP +10 (v3.253 대표 확정).

    - auth 필수(무인증 401) · 크루 미존재/블라인드 404 · 플리 미존재/club_id 불일치 404.
    - 멤버 본인 = 미적립 200 {granted: 0} (자기 크루 부양 차단 — record-play source 검증과 동일 원칙).
    - 멱등: 유저·플리·KST일 1회 — Mongo crew_rp_events 유니크 인덱스(user_id,action,playlist_id,day).
      Redis SETNX 대신 Mongo 를 택함: 재시작·페일오버에도 기록 유지, KST일 경계 TTL 오차 없음,
      recognition_events/point_events 관행과 감사 추적 일관(services/recognition.py 참고).
    - 성공 200 {granted: 10} / 오늘 이미 지급 {granted: 0}.
      v3.257: 응답의 recognition 동봉 삭제(크루 인지도 미노출 — 적립 granted 로직은 불변,
      v3.253 앱 clubService 는 recognition 부재를 null 로 방어 수용).
    """
    mongo = get_mongo()
    user_id = str(current_user["id"])
    doc, err = await get_club_or_404(mongo, club_id, viewer=current_user)
    if err:
        return err
    cid = str(doc["_id"])

    try:
        pl_uuid = uuid.UUID(str(playlist_id))
    except (TypeError, ValueError, AttributeError):
        logger.info("[CrewRecog] play-start invalid_plid club=%s user=%s", _short(cid), _short(user_id))
        return JSONResponse(status_code=404, content={"error": "플레이리스트를 찾을 수 없습니다."})
    row = await conn.fetchrow("SELECT club_id FROM playlists WHERE id = $1", pl_uuid)
    if not row or not row["club_id"] or str(row["club_id"]) != cid:
        logger.info("[CrewRecog] play-start not_found club=%s plid=%s", _short(cid), _short(playlist_id))
        return JSONResponse(status_code=404, content={"error": "크루 플레이리스트를 찾을 수 없습니다."})

    membership = await get_membership(mongo, cid, user_id)
    if membership:
        logger.info("[CrewRecog] play-start member_skip club=%s user=%s", _short(cid), _short(user_id))
        return {"granted": 0}

    if not await recognition_svc.crew_claim_playlist_once(mongo, user_id, str(pl_uuid), cid):
        logger.info("[CrewRecog] play-start dedup club=%s user=%s plid=%s",
                    _short(cid), _short(user_id), _short(playlist_id))
        return {"granted": 0}

    # v3.257: 적립(원장·clubs.recognition $inc)은 그대로 — 반환값만 미사용(응답 recognition 삭제).
    # award best-effort 실패(클레임 소모)여도 기존과 동일하게 성공 경로 유지(재대사는 원장 기준).
    awarded = await recognition_svc.crew_award(
        mongo, cid, recognition_svc.RP_CREW_PLAYLIST, "club_playlist_save",
        actor=user_id, ref=str(pl_uuid),
    )
    if awarded is None:
        logger.info("[CrewRecog] play-start award_degraded club=%s plid=%s", _short(cid), _short(playlist_id))
    logger.info("[CrewRecog] play-start ok club=%s user=%s plid=%s granted=%d",
                _short(cid), _short(user_id), _short(playlist_id), recognition_svc.RP_CREW_PLAYLIST)
    return {"granted": recognition_svc.RP_CREW_PLAYLIST}
