#!/bin/bash
# v3.428 사전 배포 롤백 — 멈춰 둔 옛 컨테이너(maidol-app-old-v3428, v3.427 코드)로 되돌리고 호스트 파일도 원복.
# 실행 위치: WSL. 사용: bash ~/TripleJ/server_staging_v3428_cloudswitch/_deploy/rollback_v3428.sh [now]
#   now 를 붙이면 진행 작업 0건 기다리기를 건너뜀(장애 중 긴급 롤백일 때만).
set -euo pipefail
V=v3428
ssh maidol-ec2 "V=$V NOW=${1:-} bash -s" <<'REMOTE'
set -euo pipefail
cd /home/ubuntu/maidol/backend_9004
docker inspect maidol-app-old-$V > /dev/null || { echo "중단: 옛 컨테이너 maidol-app-old-$V 가 없어요."; exit 1; }

if [ "$NOW" != now ]; then
  echo "[1/4] 진행 작업 4종 0건 기다리기(최대 10분)"
  docker cp /tmp/$V/chk/inflight_check.py maidol-app:/tmp/inflight.py
  ok=0
  for i in $(seq 1 20); do
    OUT=$(docker exec -w /srv/app -e PYTHONPATH=/srv/app maidol-app python /tmp/inflight.py); echo "  $OUT"
    echo "$OUT" | grep -q "TOTAL 0$" && { ok=1; break; }; sleep 30
  done
  [ "$ok" = 1 ] || { echo "중단: 진행 중 작업이 남아 있어요. 급하면 'now' 로 다시 실행."; exit 1; }
fi

echo "[2/4] 새 컨테이너 멈추고 옛 컨테이너 다시 시작"
TS=$(date -u +%Y%m%dT%H%M%SZ)
docker logs maidol-app 2>&1 | sudo tee /home/ubuntu/maidol/logs/maidol-app_rollback_${V}_$TS.log > /dev/null
docker stop -t 60 maidol-app
docker rename maidol-app maidol-app-bad-$V
docker update --restart=no maidol-app-bad-$V > /dev/null
docker rename maidol-app-old-$V maidol-app
docker update --restart=unless-stopped maidol-app > /dev/null
docker start maidol-app

echo "[3/4] 호스트 파일·이미지 원복(다음 빌드가 v3.427 이 되도록)"
while read -r rel live new; do
  if [ "$live" = NEW ]; then
    [ -e "app/$rel" ] && mv "app/$rel" "/tmp/$V/removed_$(basename "$rel")"
  else
    cp -p "app/$rel.bak_pre_$V" "app/$rel"
    md5sum "app/$rel" | grep -q "^$live" || echo "  주의: $rel 이 v3.427 md5 와 다름"
  fi
done < /tmp/$V/files.txt
sudo docker tag maidol-app:pre-$V-live maidol-app:latest

echo "[4/4] 확인"
for i in $(seq 1 40); do curl -fsS http://127.0.0.1:9006/api/health > /dev/null 2>&1 && break; sleep 2; done
echo "health: $(curl -fsS http://127.0.0.1:9006/api/health)"
for p in google kakao naver; do
  echo "oauth $p login(302 정상): $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:9006/api/auth/oauth/$p/login)"
done
docker exec -w /srv/app -e PYTHONPATH=/srv/app maidol-app test -e app/services/ai_providers.py && echo "!! ai_providers 가 남아 있음" || echo "v3.427 코드 확인(ai_providers 없음)"
echo "롤백 완료 — 실패한 컨테이너는 maidol-app-bad-$V (멈춤, 정리는 대표)"
REMOTE
