"""v210 — MV 좀비 job 목록화 리포트 (read-only, 삭제 코드 없음).

mv_jobs 컬렉션과 MinIO `{bucket}/mv/` prefix 를 대조해:
  1. 상태(status) 분포
  2. 정리 후보 목록 — 기준 (PLAN.md v210 §1 D5):
       status ∈ (failed, paused)
       또는 updated_at < now-90d AND 최종 산출물 부재
       (최종 산출물 = status=="completed" 또는 result_music_video_url /
        result_video_url 보유 — video_ready final 포함 보존)
  3. MinIO mv/ 용량 집계 (job별 / status별 / 비-job 경로 / 고아 prefix)
를 stdout 표로 출력한다.

절대 준수: **mongo/MinIO 쓰기 0** — find/list 만 수행. 삭제는 사용자 승인 후
기존 owner DELETE API(/api/mv/jobs/{id}) 또는 차기 사이클 도구로 별도 진행.
접속 정보는 app.config settings 경유 — 산출물에 시크릿 미기재.

Usage:
    cd backend_9006
    ./venv/bin/python scripts/mv_cleanup_report.py
"""

import asyncio
import re
import sys
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from minio import Minio
from motor.motor_asyncio import AsyncIOMotorClient

from app.config import settings

STALE_DAYS = 90
HEX24_RE = re.compile(r"^[0-9a-f]{24}$")


def fmt_size(n: int) -> str:
    """Human size — B/KiB/MiB/GiB."""
    val = float(n)
    for unit in ("B", "KiB", "MiB", "GiB"):
        if val < 1024 or unit == "GiB":
            return f"{val:.0f}{unit}" if unit == "B" else f"{val:.2f}{unit}"
        val /= 1024
    return f"{val:.2f}GiB"


def _fmt_dt(dt) -> str:
    if isinstance(dt, datetime):
        return dt.strftime("%Y-%m-%d %H:%M")
    return str(dt or "-")


def scan_minio_mv():
    """MinIO mv/ 전체 list (read-only) → segment별 (bytes, objects)."""
    client = Minio(
        settings.minio_endpoint,
        access_key=settings.minio_access_key,
        secret_key=settings.minio_secret_key,
        secure=bool(settings.minio_secure),
    )
    seg_stats = defaultdict(lambda: [0, 0])  # "mv/<seg>/" 의 <seg> → [bytes, count]
    for obj in client.list_objects(
        bucket_name=settings.minio_bucket_images, prefix="mv/", recursive=True,
    ):
        parts = (obj.object_name or "").split("/")
        seg = parts[1] if len(parts) > 2 else "(root)"
        seg_stats[seg][0] += int(obj.size or 0)
        seg_stats[seg][1] += 1
    return seg_stats


def _has_final_output(job: dict) -> bool:
    """최종 산출물 보유 = 보존 대상 (completed / merge·concat 결과물 보유)."""
    return bool(
        job.get("status") == "completed"
        or job.get("result_music_video_url")
        or job.get("result_video_url")
    )


async def run() -> int:
    mongo_client = AsyncIOMotorClient(settings.computed_mongo_url)
    db = mongo_client[settings.mongo_db]

    jobs = await db.mv_jobs.find(
        {},
        {
            "status": 1, "updated_at": 1, "created_at": 1, "title": 1,
            "result_video_url": 1, "result_music_video_url": 1,
            "audio_generation_id": 1, "audio_track_id": 1,
        },
    ).to_list(length=None)

    seg_stats = scan_minio_mv()

    # ── 1. 상태 분포 ─────────────────────────────────────────────────────
    status_count = defaultdict(int)
    status_bytes = defaultdict(int)
    for j in jobs:
        sid = str(j["_id"])
        status_count[j.get("status") or "(none)"] += 1
        status_bytes[j.get("status") or "(none)"] += seg_stats.get(sid, [0, 0])[0]

    now = datetime.utcnow()
    stale_cutoff = now - timedelta(days=STALE_DAYS)

    # ── 2. 정리 후보 (read-only 목록화 — 삭제 없음) ──────────────────────
    candidates = []
    sourceless = []
    for j in jobs:
        st = j.get("status") or "(none)"
        upd = j.get("updated_at") or j.get("created_at")
        is_stale = isinstance(upd, datetime) and upd < stale_cutoff
        if st in ("failed", "paused") or (is_stale and not _has_final_output(j)):
            candidates.append(j)
        if not j.get("audio_generation_id") and not j.get("audio_track_id"):
            sourceless.append(j)

    # ── 3. MinIO 대조: job prefix / 비-job 경로 / 고아 prefix ────────────
    job_ids = {str(j["_id"]) for j in jobs}
    orphan_segs = [
        s for s in seg_stats
        if HEX24_RE.match(s) and s not in job_ids
    ]
    nonjob_segs = [s for s in seg_stats if not HEX24_RE.match(s)]
    total_bytes = sum(v[0] for v in seg_stats.values())
    total_objs = sum(v[1] for v in seg_stats.values())

    # ── 출력 ─────────────────────────────────────────────────────────────
    print("=" * 78)
    print(f"MV cleanup report (READ-ONLY)  bucket={settings.minio_bucket_images}  "
          f"generated_at={now.isoformat(timespec='seconds')}Z")
    print("=" * 78)

    print(f"\n[1] mv_jobs 총 {len(jobs)}건 — status 분포 (MinIO mv/<job_id>/ 용량 병기)")
    for st in sorted(status_count, key=lambda s: -status_count[s]):
        print(f"    {st:<18} {status_count[st]:>3}건  {fmt_size(status_bytes[st]):>10}")

    print(f"\n[2] 정리 후보 {len(candidates)}건 — 기준: status∈(failed,paused) 또는 "
          f"{STALE_DAYS}일+ stale & 최종 산출물 부재 (completed/final 보유 제외)")
    print(f"    {'job_id':<26}{'status':<16}{'updated_at':<18}{'size':>10}{'objects':>9}")
    cand_bytes = 0
    cand_objs = 0
    for j in sorted(candidates, key=lambda x: (x.get('status') or '', str(x['_id']))):
        sid = str(j["_id"])
        b, c = seg_stats.get(sid, [0, 0])
        cand_bytes += b
        cand_objs += c
        print(f"    {sid:<26}{(j.get('status') or '-'):<16}"
              f"{_fmt_dt(j.get('updated_at')):<18}{fmt_size(b):>10}{c:>9}")
    print(f"    {'-' * 76}")
    print(f"    후보 합계: {len(candidates)}건 / {fmt_size(cand_bytes)} / {cand_objs} objects")

    print(f"\n[3] MinIO mv/ 전체: {fmt_size(total_bytes)} / {total_objs} objects")
    if nonjob_segs:
        print("    비-job 경로 (보존):")
        for s in sorted(nonjob_segs):
            b, c = seg_stats[s]
            print(f"      mv/{s}/  {fmt_size(b)} / {c} objects")
    print(f"    고아 prefix (job doc 없음): {len(orphan_segs)}건"
          + ("" if not orphan_segs else " — " + ", ".join(sorted(orphan_segs))))

    print(f"\n[4] sourceless job (audio_generation_id·audio_track_id 양쪽 부재): "
          f"{len(sourceless)}건"
          + ("" if not sourceless else " — " + ", ".join(str(j['_id']) for j in sourceless)))

    print("\n주의: 본 스크립트는 목록화 전용 — 어떤 삭제/변경도 수행하지 않음.")
    mongo_client.close()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(run()))
