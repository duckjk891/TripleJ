#!/bin/bash
# v3.428 새 경로 시험 컨테이너 — 운영과 같은 이미지 + 새 경로 환경변수만 덮어써서 별도 포트(9106)로 띄우고
# 주요 AI 기능을 한 번씩 호출한다. **키(Vertex 익스프레스·서비스 계정·Azure)가 생긴 뒤 실행.**
# 전제: 사전 배포(deploy_v3428_dark.sh) 완료 → 운영 이미지에 새 코드가 들어 있음.
# 실행 위치: WSL. 사용: bash ~/TripleJ/server_staging_v3428_cloudswitch/_deploy/testcontainer_v3428.sh [noimage]
#   noimage = 이미지 생성(비용 큰 항목) 생략
# 절차 설명: RUNBOOK_testcontainer.md
set -euo pipefail
V=v3428
STG=~/TripleJ/server_staging_v3428_cloudswitch
SKIP=$([ "${1:-}" = noimage ] && echo 1 || echo 0)
ssh maidol-ec2 "mkdir -p /tmp/$V/chk"
scp -q "$STG/_deploy/smoke_newpaths.py" "$STG/_deploy/routemap.py" "$STG/_deploy/switchcheck.py" maidol-ec2:/tmp/$V/chk/

ssh maidol-ec2 "V=$V SKIP=$SKIP bash -s" <<'REMOTE'
set -euo pipefail
cd /home/ubuntu/maidol/backend_9004
CS=/home/ubuntu/maidol/cloudswitch
NEWENV=$CS/newpaths.env
SA=$CS/gcp-sa.json
PORT=9106
NAME=maidol-cloudtest

echo "[1/6] 준비물 확인(값은 출력 안 함)"
[ -f "$NEWENV" ] || { echo "중단: $NEWENV 없음 (newpaths.env.example 참고)"; exit 1; }
[ -f "$SA" ] || { echo "중단: $SA (GCP 서비스 계정 JSON) 없음"; exit 1; }
for k in VERTEX_API_KEY AZURE_OPENAI_ENDPOINT AZURE_OPENAI_API_KEY; do
  grep -qE "^$k=.+" "$NEWENV" || { echo "중단: newpaths.env 에 $k 값이 비어 있어요"; exit 1; }
done
echo "  OK"

echo "[2/6] 운영과 같은 이미지인지 확인"
IMG=$(docker inspect -f '{{.Image}}' maidol-app)
docker run --rm --network none --entrypoint test "$IMG" -e /srv/app/app/services/ai_providers.py \
  || { echo "중단: 운영 이미지에 새 코드가 없어요 — 사전 배포 먼저"; exit 1; }
echo "  image=${IMG:7:12} (maidol-app 실행 중인 이미지 그대로)"

RUN=(docker run --rm --network host --env-file .env --env-file "$NEWENV"
     -e S3_REGION=ap-northeast-2 -e GOOGLE_APPLICATION_CREDENTIALS=/secrets/gcp-sa.json
     -e CS_WORKER_MODE=off -e SMOKE_SKIP_IMAGES=$SKIP
     -v "$SA":/secrets/gcp-sa.json:ro -v /tmp/$V/chk:/chk:ro
     -w /srv/app -e PYTHONPATH=/srv/app)

echo "[3/6] 시험 컨테이너 스위치 상태"
"${RUN[@]}" "$IMG" python /chk/switchcheck.py

echo "[4/6] 별도 포트 $PORT 로 띄우기 — lifespan off(작업 재개·환불·CS 워커·스위퍼 안 돌림, 운영 DB 안 건드림)"
docker rm -f $NAME > /dev/null 2>&1 || true
docker run -d --name $NAME --network host --env-file .env --env-file "$NEWENV" \
  -e S3_REGION=ap-northeast-2 -e GOOGLE_APPLICATION_CREDENTIALS=/secrets/gcp-sa.json -e CS_WORKER_MODE=off \
  -v "$SA":/secrets/gcp-sa.json:ro -w /srv/app -e PYTHONPATH=/srv/app "$IMG" \
  python -m uvicorn app.main:app --host 127.0.0.1 --port $PORT --lifespan off > /dev/null
for i in $(seq 1 30); do curl -fsS http://127.0.0.1:$PORT/api/health > /dev/null 2>&1 && break; sleep 2; done
echo "  health($PORT): $(curl -fsS http://127.0.0.1:$PORT/api/health || echo FAIL)"
echo "  MV 모델 목록: seedance=$(curl -s http://127.0.0.1:$PORT/api/mv/models | grep -ci seedance) veo=$(curl -s http://127.0.0.1:$PORT/api/mv/models | grep -ci veo)"
echo "  아티스트 생성 경로(401·403·422 정상): $(curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:$PORT/api/character/generate-sheet-async)"

echo "[5/6] 주요 기능 한 번씩 호출(Claude 4모델·캐시·번역 / Gemini 텍스트 2·이미지 / Azure 채팅 3·임베딩·키워드·이미지 생성·편집)"
set +e
"${RUN[@]}" "$IMG" python /chk/smoke_newpaths.py | tee /tmp/$V/smoke_$(date -u +%Y%m%dT%H%M%SZ).log
SMOKE_RC=${PIPESTATUS[0]}
set -e

echo "[6/6] 정리 + 운영 영향 확인"
docker logs $NAME 2>&1 | tail -5
docker stop $NAME > /dev/null && docker rm $NAME > /dev/null
echo "  운영 health(9006): $(curl -fsS http://127.0.0.1:9006/api/health)"
echo "  운영 스위치: $(docker exec -w /srv/app -e PYTHONPATH=/srv/app maidol-app python -c 'from app.services import ai_providers as a; print(a.claude_provider(), a.gemini_vertex_ratio(), a.openai_provider())')"
[ "$SMOKE_RC" = 0 ] && echo "결과: 전부 PASS" || echo "결과: FAIL 있음 — 위 FAIL 줄 확인"
exit $SMOKE_RC
REMOTE
