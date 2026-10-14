"""v3.363 DB 백업 S3 업로드(앱 컨테이너 안에서 실행 — EC2 역할 권한) + 30일 지난 백업 정리.
사용: docker exec -i maidol-app python - <파일이름> < backup_s3.py   (파일은 /tmp/<파일이름> 에 있어야 함)"""
import sys
from datetime import datetime, timedelta, timezone

from app.config import settings
from app.database.minio import get_minio, init_minio

PREFIX = "_backups/db/"
KEEP_DAYS = 30

name = sys.argv[1]
init_minio(settings.minio_endpoint, settings.minio_user, settings.minio_password)
m = get_minio()
bucket = settings.minio_bucket_music
m.fput_object(bucket, PREFIX + name, "/tmp/" + name, content_type="application/octet-stream")
print(f"{datetime.now(timezone.utc).isoformat()} uploaded {PREFIX}{name}")
try:
    cutoff = datetime.now(timezone.utc) - timedelta(days=KEEP_DAYS)
    removed = 0
    for o in m.list_objects(bucket, prefix=PREFIX, recursive=True):
        if o.last_modified and o.last_modified < cutoff:
            m.remove_object(bucket, o.object_name)
            removed += 1
    print(f"pruned {removed} old backups")
except Exception as e:  # noqa: BLE001 — 목록 권한이 없으면 정리만 건너뜀
    print(f"prune skipped: {type(e).__name__}")
