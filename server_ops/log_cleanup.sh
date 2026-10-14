#!/bin/bash
# v3.363 [Governance] 서버 로그 정리(내부관리계획 제11조 — 서비스 로그 90일) — 매일 04:50 KST(cron, root).
#   1) 배포 때 저장한 서비스 로그·작업 로그 90일 지나면 삭제
#   2) 컨테이너 로그(json)가 200MB 넘으면 비움(MongoDB 등 장기 실행 컨테이너 — 종전 무제한 누적)
#   앱 로그 파일(frontend.log·gen_jobs.log·db_backup.log)은 /etc/logrotate.d/maidol 이 주 단위로 압축·90일 보관.
set -u
LOG=/home/ubuntu/maidol/logs/log_cleanup.log
n1=$(find /home/ubuntu/maidol -maxdepth 1 -type f -name 'maidol-app_pre_*.log' -mtime +90 -print -delete | wc -l)
n2=$(find /home/ubuntu/maidol/logs -maxdepth 1 -type f \( -name 'maidol-app_pre_*.log' -o -name 'crew_weekly_*.log' -o -name '*.gz' \) -mtime +90 -print -delete | wc -l)
t=0
for f in /var/lib/docker/containers/*/*-json.log; do
  [ -f "$f" ] || continue
  if [ "$(stat -c%s "$f")" -gt 209715200 ]; then truncate -s 0 "$f"; t=$((t+1)); fi
done
echo "$(date -u +%FT%TZ) removed_root=$n1 removed_logs=$n2 truncated_container_logs=$t" >> "$LOG"
