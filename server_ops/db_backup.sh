#!/bin/bash
# v3.363 [Governance] DB 정기 백업(내부관리계획 제12조) — 매일 04:30 KST(cron, ubuntu 계정).
#   Postgres(aimu, pg_dump -Fc) + MongoDB(aimu, mongodump archive gzip)
#   → 로컬 /home/ubuntu/maidol/backups/db (7일, 권한 700/600)
#   → S3 비공개 오디오 버킷 _backups/db/ (30일, 서버 밖 사본 — AWS 저장 시 암호화). 업로드는 앱 컨테이너(EC2 역할 권한)로.
#   비밀번호는 각 DB 컨테이너 안의 환경값을 그 안에서만 읽는다(이 스크립트·로그에 남기지 않음).
set -uo pipefail
TS=$(date -u +%Y%m%dT%H%M%SZ)
DIR=/home/ubuntu/maidol/backups/db
LOG=/home/ubuntu/maidol/logs/db_backup.log
mkdir -p "$DIR"; chmod 700 "$DIR"
log() { echo "$(date -u +%FT%TZ) $*" >> "$LOG"; }
status=ok

PG="$DIR/pg_aimu_$TS.dump"
if nice -n 19 docker exec aimu-postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$PG.part" 2>>"$LOG" && [ -s "$PG.part" ]; then
  mv "$PG.part" "$PG"; chmod 600 "$PG"; log "pg ok bytes=$(stat -c%s "$PG")"
else
  rm -f "$PG.part"; log "pg FAILED"; status=fail
fi

MG="$DIR/mongo_aimu_$TS.archive.gz"
if nice -n 19 docker exec aimu-mongodb sh -c 'mongodump --quiet --uri="mongodb://$MONGO_INITDB_ROOT_USERNAME:$MONGO_INITDB_ROOT_PASSWORD@localhost:27017/?authSource=admin" --db=aimu --archive --gzip' > "$MG.part" 2>>"$LOG" && [ -s "$MG.part" ]; then
  mv "$MG.part" "$MG"; chmod 600 "$MG"; log "mongo ok bytes=$(stat -c%s "$MG")"
else
  rm -f "$MG.part"; log "mongo FAILED"; status=fail
fi

# 서버 밖 사본(S3) — 실패해도 로컬 백업은 유지
for f in "$PG" "$MG"; do
  [ -f "$f" ] || continue
  b=$(basename "$f")
  # 컨테이너 안 앱 사용자는 호스트 600 파일을 못 읽으므로 업로드는 컨테이너 root 로(같은 EC2 역할 권한)
  if docker cp "$f" "maidol-app:/tmp/$b" \
     && docker exec -i -u 0 -e PYTHONPATH=/srv/app maidol-app python - "$b" < /home/ubuntu/maidol/scripts/backup_s3.py >> "$LOG" 2>&1; then
    log "s3 ok $b"
  else
    log "s3 FAILED $b"; status=fail
  fi
  docker exec -u 0 maidol-app rm -f "/tmp/$b" >/dev/null 2>&1 || true
done

# 로컬 7일 보관
find "$DIR" -maxdepth 1 -type f \( -name 'pg_aimu_*.dump' -o -name 'mongo_aimu_*.archive.gz' \) -mtime +7 -delete
log "done status=$status"
