#!/bin/bash
# v3.428 클라우드 전환 코드 "스위치 끈 채" 운영 사전 배포. **대표 승인 뒤에만 실행.**
# 동작: 새 경로 스위치가 전부 꺼진(기본값) 상태로 코드만 교체 → 지금과 같은 동작.
# 실행 위치: WSL. 사용: bash ~/TripleJ/server_staging_v3428_cloudswitch/_deploy/deploy_v3428_dark.sh
# 절차 설명·롤백: RUNBOOK_dark_deploy.md
set -euo pipefail
V=v3428
STG=~/TripleJ/server_staging_v3428_cloudswitch
cd "$STG"

echo "[0/9] 로컬 시험(옛 경로 기본값·비율 분배·예비 경로·429 알림·route 매핑)"
bash ~/cloudswitch/tools/run_tests.sh full > /tmp/${V}_tests.log 2>&1 || { echo "중단: 로컬 시험 실패 — /tmp/${V}_tests.log"; exit 1; }
grep -E "FAILS|SAME|DIFF" /tmp/${V}_tests.log
grep -qE "FAILS [1-9]|DIFF" /tmp/${V}_tests.log && { echo "중단: 시험 실패 항목 있음"; exit 1; }

echo "[1/9] 새 파일 올리기"
ssh maidol-ec2 "rm -rf /tmp/$V && mkdir -p /tmp/$V/chk"
scp -qr app files.txt maidol-ec2:/tmp/$V/
scp -q _deploy/inflight_check.py _deploy/routemap.py _deploy/switchcheck.py maidol-ec2:/tmp/$V/chk/

ssh maidol-ec2 "V=$V bash -s" <<'REMOTE'
set -euo pipefail
cd /home/ubuntu/maidol/backend_9004
LOGS=/home/ubuntu/maidol/logs
TS=$(date -u +%Y%m%dT%H%M%SZ)

echo "[2/9] 사전 확인: 스위치 변수가 .env 에 없어야 함(이름만 출력)"
SW=$(grep -E '^(CLAUDE_PROVIDER|GEMINI_PROVIDER|GEMINI_VERTEX_RATIO|OPENAI_PROVIDER|IMAGE_FALLBACK_GEMINI|AI_429_ALERT_EMAIL)=' .env | cut -d= -f1 || true)
[ -z "$SW" ] || { echo "중단: .env 에 이미 스위치 변수가 있어요: $SW (사전 배포는 전부 기본값이어야 함)"; exit 1; }
echo "  OK (스위치 변수 없음)"

echo "[3/9] 서버 파일이 예상(v3.427 md5)과 같은지 확인"
while read -r rel live new; do
  if [ "$live" = NEW ]; then
    [ ! -e "app/$rel" ] || { echo "중단: 새 파일 app/$rel 이 이미 있어요."; exit 1; }
  else
    md5sum "app/$rel" | grep -q "^$live" || { echo "중단: 서버 app/$rel 이 스냅샷과 달라요(그사이 배포?)."; exit 1; }
  fi
done < /tmp/$V/files.txt
echo "  OK ($(wc -l < /tmp/$V/files.txt)개)"

echo "[4/9] 지금 컨테이너 route 매핑 저장"
docker cp /tmp/$V/chk maidol-app:/chk
docker exec -w /srv/app -e PYTHONPATH=/srv/app maidol-app python /chk/routemap.py > /tmp/$V/routes_before.txt
echo "  $(wc -l < /tmp/$V/routes_before.txt) routes"

echo "[5/9] 백업 + 교체"
while read -r rel live new; do
  if [ "$live" = NEW ]; then
    cp "/tmp/$V/app/$rel" "app/$rel"
  else
    cp -p "app/$rel" "app/$rel.bak_pre_$V"
    cp "/tmp/$V/app/$rel" "app/$rel"
  fi
  md5sum "app/$rel" | grep -q "^$new" || { echo "중단: $rel 복사 확인 실패"; exit 1; }
done < /tmp/$V/files.txt

restore_files() {
  echo "  파일 되돌리는 중"
  while read -r rel live new; do
    if [ "$live" = NEW ]; then mv "app/$rel" "/tmp/$V/removed_$(basename "$rel")"; else cp -p "app/$rel.bak_pre_$V" "app/$rel"; fi
  done < /tmp/$V/files.txt
}

echo "[6/9] 되돌리기용 이미지 표시 + 후보 이미지 빌드(nice) + 후보에서 route 매핑·스위치 확인"
sudo docker tag maidol-app:latest maidol-app:pre-$V-live
sudo nice -n 19 docker build -q -t maidol-app:$V-candidate . || { restore_files; echo "중단: 빌드 실패"; exit 1; }
# lifespan 을 돌리지 않는 일회성 컨테이너(네트워크 없음) — DB·외부 호출 없음
if ! docker run --rm --network none --env-file .env -e S3_REGION=ap-northeast-2 -v /tmp/$V/chk:/chk:ro \
  -w /srv/app -e PYTHONPATH=/srv/app maidol-app:$V-candidate python /chk/routemap.py > /tmp/$V/routes_candidate.txt; then
  restore_files; echo "중단: 후보 이미지에서 app 을 불러오지 못했어요."; exit 1
fi
if ! diff -q /tmp/$V/routes_before.txt /tmp/$V/routes_candidate.txt > /dev/null; then
  diff /tmp/$V/routes_before.txt /tmp/$V/routes_candidate.txt | head -20
  restore_files; echo "중단: route→함수 매핑이 달라졌어요."; exit 1
fi
echo "  route 매핑 동일 ($(wc -l < /tmp/$V/routes_candidate.txt))"
SWITCH=$(docker run --rm --network none --env-file .env -e S3_REGION=ap-northeast-2 -v /tmp/$V/chk:/chk:ro \
  -w /srv/app -e PYTHONPATH=/srv/app maidol-app:$V-candidate python /chk/switchcheck.py 2>/dev/null | head -1 || true)
echo "  $SWITCH"
echo "$SWITCH" | grep -q "claude=anthropic gemini=aistudio gemini_vertex_ratio=0 .* openai=openai image_fallback_gemini=False" \
  || { restore_files; echo "중단: 스위치가 기본값(옛 경로)이 아니에요."; exit 1; }
sudo docker tag maidol-app:$V-candidate maidol-app:latest

echo "[7/9] 진행 중인 생성 작업 4종 0건 기다리기(최대 15분)"
docker cp /tmp/$V/chk/inflight_check.py maidol-app:/tmp/inflight.py
ok=0
for i in $(seq 1 30); do
  OUT=$(docker exec -w /srv/app -e PYTHONPATH=/srv/app maidol-app python /tmp/inflight.py)
  echo "  $OUT"
  if echo "$OUT" | grep -q "TOTAL 0$"; then ok=1; break; fi
  sleep 30
done
if [ "$ok" != 1 ]; then
  sudo docker tag maidol-app:pre-$V-live maidol-app:latest; restore_files
  echo "중단: 진행 중인 작업이 계속 있어요(파일·이미지 되돌림, 운영 컨테이너는 그대로)."; exit 1
fi

echo "[8/9] 로그 저장 후 재기동(옛 컨테이너는 멈춘 채 보관)"
docker logs maidol-app 2>&1 | sudo tee $LOGS/maidol-app_pre_${V}_$TS.log > /dev/null
docker stop -t 60 maidol-app
docker rename maidol-app maidol-app-old-$V
docker update --restart=no maidol-app-old-$V > /dev/null
docker run -d --name maidol-app --network host --restart unless-stopped --env-file .env \
  -e S3_REGION=ap-northeast-2 -v /home/ubuntu/maidol/logs:/srv/app/logs maidol-app:latest

echo "[9/9] 사후 확인"
for i in $(seq 1 40); do curl -fsS http://127.0.0.1:9006/api/health > /dev/null 2>&1 && break; sleep 2; done
echo "health: $(curl -fsS http://127.0.0.1:9006/api/health)"
docker cp /tmp/$V/chk maidol-app:/chk
docker exec -w /srv/app -e PYTHONPATH=/srv/app maidol-app python /chk/routemap.py > /tmp/$V/routes_after.txt
diff -q /tmp/$V/routes_before.txt /tmp/$V/routes_after.txt > /dev/null && echo "route 매핑: 배포 전과 동일 ($(wc -l < /tmp/$V/routes_after.txt))" || echo "!! route 매핑 다름 — RUNBOOK 롤백 검토"
echo "스위치: $(docker exec -w /srv/app -e PYTHONPATH=/srv/app maidol-app python /chk/switchcheck.py | head -1)"
for p in google kakao naver; do
  echo "oauth $p login(302 정상): $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:9006/api/auth/oauth/$p/login)"
done
MV=$(curl -s http://127.0.0.1:9006/api/mv/models)
echo "MV 모델 목록(seedance·kling 있고 veo 없어야 함): seedance=$(echo "$MV" | grep -ci seedance) kling=$(echo "$MV" | grep -ci kling) veo=$(echo "$MV" | grep -ci veo)"
echo "옛 MV 경로(401 또는 410 정상, 404·5xx 이상): $(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:9006/api/upload/generate-mv)"
echo "아티스트 생성 경로(401·403·422 정상, 404·5xx 이상): $(curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:9006/api/character/generate-sheet-async)"
echo "MV 생성 경로 예(401·403·422 정상): $(curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:9006/api/mv/create)"
sleep 5
echo "Traceback 수: $(docker logs maidol-app 2>&1 | grep -c Traceback || true)"
echo "새 경로 로그(없어야 정상): $(docker logs maidol-app 2>&1 | grep -cE 'claude=vertex|vertex HTTP|vertex timeout' || true)"
echo "완료 — 옛 컨테이너 maidol-app-old-$V(멈춤), 되돌리기 이미지 maidol-app:pre-$V-live"
REMOTE
