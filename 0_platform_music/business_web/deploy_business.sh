#!/bin/bash
# MAIDOL 광고주 사이트 배포 — business.maidol.ai.kr (EC2 nginx 정적 서빙, 서버 재시작 없음)
#
# 하는 일: npm run build → dist 를 EC2 /var/www/maidol-business 로 교체(직전 판은 .prev 로 보관 → 되돌리기 가능)
# 되돌리기: ./deploy_business.sh rollback
# 처음 한 번: nginx 설정(server_staging_v3379biz/nginx/maidol-business)과 인증서가 먼저 있어야 함.
set -euo pipefail
cd "$(dirname "$0")"
HOST=maidol-ec2
DEST=/var/www/maidol-business

if [ "${1:-}" = "rollback" ]; then
  ssh $HOST "test -d $DEST.prev && sudo rm -rf $DEST.bad && sudo mv $DEST $DEST.bad && sudo mv $DEST.prev $DEST && echo 'rolled back'"
  exit 0
fi

echo "== 1/3 빌드"
npm run build >/dev/null
test -f dist/index.html

echo "== 2/3 업로드"
ssh $HOST "rm -rf /tmp/maidol-business-new"
scp -q -r dist $HOST:/tmp/maidol-business-new

echo "== 3/3 교체 (직전 판 → $DEST.prev)"
ssh $HOST "sudo rm -rf $DEST.prev; if [ -d $DEST ]; then sudo mv $DEST $DEST.prev; fi; sudo mv /tmp/maidol-business-new $DEST && sudo chown -R root:root $DEST && sudo chmod -R a+rX $DEST"
ssh $HOST "curl -s -o /dev/null -w 'local check: %{http_code}\n' -H 'Host: business.maidol.ai.kr' http://127.0.0.1/" || true
echo "완료 — https://business.maidol.ai.kr"
