"""v211 — MV 부착 백필 후보 리포트 (read-only, 쓰기 0줄).

배경: v211 에서 트랙→MV 노출이 암묵 자동연결(`_find_completed_mv`:
mv_jobs.audio_generation_id == track.generation_id) → **명시 부착**
(mv_jobs.attached_track_id) 으로 전면 대체됐다. 기존에 암묵 링크로 노출되던
completed MV 페어는 부착 전까지 비노출로 전환된다 (PLAN v211 D4 — 손실 수용,
전건 90일+ dev 데이터).

이 스크립트는 그 암묵 페어(generation→track)를 **목록화만** 한다:
  - completed + result_music_video_url 보유 job 중 audio_generation_id 로
    발매 트랙과 이어지던 페어 (= 구 코드에서 플레이어 노출되던 집합)
  - 이미 명시 부착된 job / 미발매(트랙 없음) generation job 은 구분 표기
실백필($set attached_*)은 ▲사용자 승인 후 별도 — 본 스크립트는 mongo 읽기만
수행하며 어떤 update/insert/delete 도 하지 않는다 (v210 cleanup 리포트 관행).

Usage:
    cd backend_9006
    ./venv/bin/python scripts/mv_attach_backfill_report.py
"""

import asyncio
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from motor.motor_asyncio import AsyncIOMotorClient

from app.config import settings


def _fmt_dt(dt) -> str:
    if isinstance(dt, datetime):
        return dt.strftime("%Y-%m-%d %H:%M")
    return str(dt or "-")


async def run() -> int:
    mongo_client = AsyncIOMotorClient(settings.computed_mongo_url)
    db = mongo_client[settings.mongo_db]

    # 구 암묵 노출 조건과 동일 집합: completed + 최종 MV 보유
    jobs = await db.mv_jobs.find(
        {
            "status": "completed",
            "result_music_video_url": {"$exists": True, "$ne": None},
        },
        {
            "title": 1, "updated_at": 1,
            "audio_generation_id": 1, "audio_track_id": 1,
            "attached_track_id": 1, "attached_generation_id": 1, "attached_at": 1,
        },
    ).to_list(length=None)

    gen_ids = [j["audio_generation_id"] for j in jobs if j.get("audio_generation_id")]
    track_by_gen: dict = {}
    if gen_ids:
        async for t in db.tracks.find(
            {"generation_id": {"$in": gen_ids}},
            {"generation_id": 1, "title": 1, "is_public": 1},
        ):
            # 복수 발매 시 최초 매치 유지 (구 find_one 무정렬 동작과 동급 표기)
            track_by_gen.setdefault(t.get("generation_id"), t)

    implicit_pairs = []   # 구 코드에서 노출되던 페어 — 백필 후보
    already_attached = []
    unreleased = []       # generation 소스지만 발매 트랙 없음 (구 코드에서도 비노출)
    track_source = []     # track 소스 completed (구 코드 조회 경로 0 — 신규 부착 대상)

    for j in jobs:
        if j.get("attached_track_id") or j.get("attached_generation_id"):
            already_attached.append(j)
            continue
        gen_id = j.get("audio_generation_id")
        trk = track_by_gen.get(gen_id) if gen_id else None
        if trk is not None:
            implicit_pairs.append((j, trk))
        elif gen_id:
            unreleased.append(j)
        elif j.get("audio_track_id"):
            track_source.append(j)

    print("=" * 78)
    print(f"MV attach backfill report (READ-ONLY)  db={settings.mongo_db}  "
          f"generated_at={datetime.utcnow().isoformat(timespec='seconds')}Z")
    print("=" * 78)
    print(f"\ncompleted+final MV job 총 {len(jobs)}건")

    print(f"\n[1] 암묵 노출 페어 (구 _find_completed_mv 기준 — 백필 후보) {len(implicit_pairs)}건")
    print(f"    {'job_id':<26}{'updated_at':<18}{'track_id':<26}{'public':<8}track_title")
    for j, t in implicit_pairs:
        print(f"    {str(j['_id']):<26}{_fmt_dt(j.get('updated_at')):<18}"
              f"{str(t['_id']):<26}{str(bool(t.get('is_public', True))):<8}"
              f"{(t.get('title') or '')[:40]}")

    print(f"\n[2] 기부착 job: {len(already_attached)}건"
          + ("" if not already_attached
             else " — " + ", ".join(str(j["_id"]) for j in already_attached)))
    print(f"[3] generation 소스·미발매(구 코드에서도 비노출): {len(unreleased)}건"
          + ("" if not unreleased
             else " — " + ", ".join(str(j["_id"]) for j in unreleased)))
    print(f"[4] track 소스(구 조회 경로 0 — 부착으로 최초 노출 가능): {len(track_source)}건"
          + ("" if not track_source
             else " — " + ", ".join(str(j["_id"]) for j in track_source)))

    print("\n주의: 본 스크립트는 목록화 전용 — mongo 쓰기/백필을 일절 수행하지 않음.")
    print("실백필은 사용자 승인 후 별도 진행 (PLAN v211 §5 ▲).")
    mongo_client.close()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(run()))
