"""v3.356 [RelatedVariety3] 자동 이어듣기(관련곡) 반복 감쇠.

대표 지적(2026-10-12) "같은 곡이 계속 반복되던데" — 실측(10-11~12) 한 사용자 362회 재생 중 상위 3곡이
12·10·9회, 셋 다 같은 제작자. 원인: 임베딩 공간의 hub 곡(여러 곡의 최근접 이웃)이 어느 곡에서 출발해도
상위 후보로 올라와 rank 가중 샘플링에서도 계속 뽑힌다(카탈로그 149곡).

이 모듈은 DB 비의존 순수 로직 + Redis 카운터만 담는다(라우트 tracks.get_related_tracks 가 사용).
  1) hub 감쇠: 최근 HUB_WINDOW_H 시간 동안 related 응답으로 뽑힌 횟수 c 로 가중 ×1/(1+c).
     로그인 = 사용자별 카운터, 비로그인 = 전체 카운터(곡별 평균 대비 정규화 — 트래픽이 늘어도 과벌점 없음).
  2) 탐색: EXPLORE_P 확률로 vector 대신 장르 무관 신곡·덜 들은 곡 풀에서 고른다.
  3) 같은 제작자 연속 상한: 직전 곡·기준곡이 같은 제작자면 그 제작자 곡은 후보에서 뺀다(대안이 없을 때만 허용).
모든 Redis 실패는 감쇠 없음(=종전 동작)으로 흡수한다.
"""
import logging
import random as _random
import time
from typing import Dict, Iterable, List, Optional

logger = logging.getLogger(__name__)

HUB_WINDOW_H = 6            # 감쇠 기억 시간(시간 버킷 개수)
HUB_KEY_TTL_S = (HUB_WINDOW_H + 1) * 3600
EXPLORE_P = 0.25            # 탐색 비율
EXPLORE_POOL_EACH = 20      # 탐색 풀 = 최신 N + 재생수 적은 N(합집합)
MAX_SAME_UPLOADER_RUN = 2   # 같은 제작자 연속 상한(기준곡 포함)


def scope_for(user: Optional[dict]) -> str:
    """카운터 범위 — 로그인 u:{id}, 비로그인 g."""
    uid = (user or {}).get("id") if isinstance(user, dict) else None
    return f"u:{uid}" if uid else "g"


def _key(scope: str, bucket: int) -> str:
    return f"related:picks:{scope}:{bucket}"


def _buckets(now: Optional[float] = None) -> List[int]:
    b = int((now if now is not None else time.time()) // 3600)
    return [b - i for i in range(HUB_WINDOW_H)]


def _s(x) -> str:
    return x.decode() if isinstance(x, (bytes, bytearray)) else str(x)


async def recent_pick_counts(redis, scope: str, now: Optional[float] = None) -> Dict[str, int]:
    """최근 HUB_WINDOW_H 시간 related 선택 횟수(곡 id → 횟수). 실패 시 {}."""
    if redis is None:
        return {}
    try:
        pipe = redis.pipeline()
        for b in _buckets(now):
            pipe.hgetall(_key(scope, b))
        res = await pipe.execute()
        out: Dict[str, int] = {}
        for h in res:
            for k, v in (h or {}).items():
                out[_s(k)] = out.get(_s(k), 0) + int(_s(v))
        return out
    except Exception as e:
        logger.warning("[related] pick counts read failed scope=%s err=%s", scope[:10], e)
        return {}


async def note_picks(redis, scope: str, ids: Iterable[str], now: Optional[float] = None) -> None:
    """이번 응답으로 뽑힌 곡을 현재 시간 버킷에 +1. 실패 무시."""
    ids = [str(i) for i in ids if i]
    if redis is None or not ids:
        return
    try:
        key = _key(scope, _buckets(now)[0])
        pipe = redis.pipeline()
        for tid in ids:
            pipe.hincrby(key, tid, 1)
        pipe.expire(key, HUB_KEY_TTL_S)
        await pipe.execute()
    except Exception as e:
        logger.warning("[related] pick counts write failed scope=%s err=%s", scope[:10], e)


def hub_mult(track_id: str, counts: Dict[str, int], scope: str) -> float:
    """hub 감쇠 배수. 사용자 범위는 1/(1+c), 전체 범위는 1/(1+c/평균) — 평균만큼 뽑힌 곡 ×0.5."""
    c = counts.get(str(track_id), 0)
    if c <= 0:
        return 1.0
    if scope == "g":
        avg = sum(counts.values()) / max(1, len(counts))
        return 1.0 / (1.0 + c / max(1.0, avg))
    return 1.0 / (1.0 + c)


def weighted_pick(weights: List[float], need: int) -> List[int]:
    """인덱스 0..n-1 에서 need 개 비복원 가중 추출. 가중 0 이하는 뽑지 않는다(전부 0 이면 빈 목록)."""
    idxs = [i for i, w in enumerate(weights) if w > 0]
    out: List[int] = []
    while idxs and len(out) < need:
        total = sum(weights[i] for i in idxs)
        r = _random.random() * total
        acc = 0.0
        pos = len(idxs) - 1
        for p, i in enumerate(idxs):
            acc += weights[i]
            if r < acc:
                pos = p
                break
        out.append(idxs.pop(pos))
    return out


def rank_weights(n: int, temp: float) -> List[float]:
    """rank 가중 w=1/(rank+temp) — 종전 _weighted_sample_ranks 와 같은 식."""
    return [1.0 / (i + temp) for i in range(n)]


def previous_track_id(exclude_order: List[str], seed_id: str) -> Optional[str]:
    """앱 exclude 는 최근 재생 순(앞=최근, 첫 항목은 보통 기준곡). 기준곡 바로 앞에 들은 곡."""
    for t in exclude_order:
        if t and t != seed_id:
            return t
    return None


def blocked_uploader(seed_uploader: str, prev_uploader: Optional[str]) -> Optional[str]:
    """직전 곡·기준곡이 같은 제작자면(=이미 2곡 연속) 다음 곡에서 그 제작자를 막는다."""
    if MAX_SAME_UPLOADER_RUN <= 2 and seed_uploader and prev_uploader and seed_uploader == prev_uploader:
        return seed_uploader
    return None


def apply_block(weights: List[float], docs: List[dict], blocked: Optional[str], strict: bool = True) -> List[float]:
    """막힌 제작자 곡 가중을 0으로. strict=False(마지막 단계)는 남는 후보가 없으면 원래 가중 그대로
    — 곡이 끊기는 것보다 같은 제작자 3연속이 낫다. strict=True 는 다음 단계(장르·인기)로 넘긴다."""
    if not blocked:
        return weights
    out = [0.0 if str(d.get("uploader_id") or "") == blocked else w for w, d in zip(weights, docs)]
    if strict or any(w > 0 for w in out):
        return out
    return weights


def should_explore(rng: Optional[_random.Random] = None) -> bool:
    return (rng or _random).random() < EXPLORE_P
