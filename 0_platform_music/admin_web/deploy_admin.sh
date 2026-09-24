#!/bin/bash
# MAIDOL 관리자 웹 배포 — admin SPA + admin_items API 를 AWS EC2(maidol-app, 9006)에 반영.
#
# 하는 일:
#   1) admin_items.py 업로드 (신규 라우트)
#   2) admin_web/dist → 서버 app/admin_static/ 업로드 (SPA 정적 파일)
#   3) 서버 main.py 에 admin_items 라우터 등록 + /admin StaticFiles 마운트 (백업 후 멱등 패치)
#   4) docker build + 컨테이너 교체 (--network host, 기존 run 옵션 재사용)
#   5) 헬스 체크
#
# 실행: ./deploy_admin.sh   (admin_web/ 디렉토리에서, dist 빌드가 있어야 함)
set -euo pipefail
cd "$(dirname "$0")"

HOST=maidol-ec2
REMOTE=/home/ubuntu/maidol/backend_9004

[ -d dist ] || { echo "dist/ 없음 — 먼저 npm run build"; exit 1; }

echo '== 1/5 admin_items.py · admin_stats.py 업로드'
scp ../backend/app/routes/admin_items.py ../backend/app/routes/admin_stats.py $HOST:$REMOTE/app/routes/

echo "== 2/5 SPA 정적 파일 업로드"
ssh $HOST "rm -rf /tmp/admin_static_new"
scp -r dist $HOST:/tmp/admin_static_new
ssh $HOST "rm -rf $REMOTE/app/admin_static && mv /tmp/admin_static_new $REMOTE/app/admin_static"

echo "== 3/5 main.py 패치 (멱등)"
ssh $HOST "cd $REMOTE && cp app/main.py /tmp/main.py.bak.\$(date +%s) && python3 - <<'EOF'
import re
p = 'app/main.py'
src = open(p).read()
changed = False
if 'admin_items' not in src:
    src = src.replace('from .routes import admin, admin_ads,', 'from .routes import admin, admin_ads, admin_items,', 1)
    src = src.replace('app.include_router(admin_ads.router)', 'app.include_router(admin_ads.router)\napp.include_router(admin_items.router)', 1)
    changed = True
if 'admin_stats' not in src:
    src = src.replace('from .routes import admin, admin_ads, admin_items,', 'from .routes import admin, admin_ads, admin_items, admin_stats,', 1)
    src = src.replace('app.include_router(admin_items.router)', 'app.include_router(admin_items.router)\napp.include_router(admin_stats.router)', 1)
    changed = True
if 'admin_static' not in src:
    src += '''

# --- Admin Web --------------------------------------------------------------
# 정적 관리자 SPA — https://api.maidol.ai.kr/admin (HashRouter, 소스는 admin_web/)
from fastapi.staticfiles import StaticFiles as _AdminStaticFiles

_admin_static_dir = os.path.join(os.path.dirname(__file__), 'admin_static')
if os.path.isdir(_admin_static_dir):
    app.mount('/admin', _AdminStaticFiles(directory=_admin_static_dir, html=True), name='admin_web')
'''
    changed = True
open(p, 'w').write(src)
print('patched' if changed else 'already patched')
EOF"

echo "== 4/5 docker build + 컨테이너 교체"
ssh $HOST "cd $REMOTE && docker build -t maidol-app:latest . && docker stop maidol-app && docker rm maidol-app && docker run -d --name maidol-app --network host --restart unless-stopped --env-file $REMOTE/.env maidol-app:latest"

echo "== 5/5 헬스 체크"
for i in $(seq 1 30); do
  sleep 3
  if ssh $HOST "curl -sf -m 2 http://127.0.0.1:9006/api/health" >/dev/null 2>&1; then
    echo "UP after $((i*3))s"
    ssh $HOST "curl -s -o /dev/null -w 'admin page: %{http_code}\n' http://127.0.0.1:9006/admin/"
    exit 0
  fi
done
echo "START FAILED — docker logs maidol-app 확인"
exit 1
