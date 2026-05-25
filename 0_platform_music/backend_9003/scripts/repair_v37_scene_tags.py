"""v37 one-shot repair: rewrite raw character names in scene prompts → @characterN tokens.

Usage:
    cd backend_9003
    ./venv/bin/python scripts/repair_v37_scene_tags.py --job-id <ObjectId> [--apply]

Defaults to --dry-run (prints metrics, makes no DB write).
"""

import argparse
import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient

from app.config import settings
from app.services.mv_generator import sanitize_scene_character_tags


async def _run(job_id: str, apply: bool) -> int:
    try:
        oid = ObjectId(job_id)
    except Exception as e:
        print(f"ERROR: invalid --job-id ({e})", file=sys.stderr)
        return 2

    client = AsyncIOMotorClient(settings.computed_mongo_url)
    db = client[settings.mongo_db]
    try:
        job = await db.mv_jobs.find_one({"_id": oid})
        if not job:
            print(f"ERROR: job {job_id} not found", file=sys.stderr)
            return 3

        scenes = job.get("scenes") or []
        scenario_meta = job.get("scenario_meta") or {}
        characters_meta = scenario_meta.get("characters") or {}

        if not scenes:
            print(f"job {job_id}: no scenes to repair")
            return 0
        if not characters_meta:
            print(f"job {job_id}: no characters in scenario_meta — sanitizer will be a no-op")

        metrics = sanitize_scene_character_tags(scenes, characters_meta)
        print("Sanitizer metrics:")
        print(json.dumps(metrics, ensure_ascii=False, indent=2))

        if not apply:
            print("--dry-run (default): no changes written. Re-run with --apply to persist.")
            return 0

        if metrics["scenes_modified"] == 0:
            print("Nothing to write (no scenes modified).")
            return 0

        result = await db.mv_jobs.update_one(
            {"_id": oid},
            {"$set": {"scenes": scenes}},
        )
        print(f"--apply: matched={result.matched_count} modified={result.modified_count}")
        return 0
    finally:
        client.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--job-id", required=True, help="mv_jobs ObjectId")
    grp = parser.add_mutually_exclusive_group()
    grp.add_argument("--dry-run", action="store_true", default=True, help="default; preview metrics only")
    grp.add_argument("--apply", action="store_true", default=False, help="persist sanitized scenes to MongoDB")
    args = parser.parse_args()

    apply = bool(args.apply)
    return asyncio.run(_run(args.job_id, apply=apply))


if __name__ == "__main__":
    sys.exit(main())
