"""v3.364 DB 백업 S3 업로드 — 백업 전용 버킷 maidol-db-backups-prod(비공개·버전 관리·기본 암호화).
보관 기간은 버킷 수명 주기가 정한다(현재 35일, 지난 버전 +30일). EC2 역할은 올리기·읽기·목록만 가능(삭제 불가).
사용: docker exec -i -u 0 -e PYTHONPATH=/srv/app maidol-app python - <파일이름> < backup_s3.py   (파일은 /tmp/<파일이름>)"""
import sys
from datetime import datetime, timezone

from app.config import settings
from app.database.minio import get_minio, init_minio

BUCKET = "maidol-db-backups-prod"
PREFIX = "db/"

name = sys.argv[1]
init_minio(settings.minio_endpoint, settings.minio_user, settings.minio_password)
get_minio().fput_object(BUCKET, PREFIX + name, "/tmp/" + name, content_type="application/octet-stream")
print(f"{datetime.now(timezone.utc).isoformat()} uploaded s3://{BUCKET}/{PREFIX}{name}")
