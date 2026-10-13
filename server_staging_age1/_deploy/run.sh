#!/bin/bash
# age1 운영 반영 — 대표 승인(2026-10-12 「오늘 심야 배포」). EC2 에서 KST 03:00 에 실행.
# 가드: md5(다른 세션 선변경 시 중단) · 진행 작업 4종 0건(06:00 KST 까지 5분 간격 재확인, 아니면 중단)
# 실패 시 자동 롤백(파일·.env·이전 이미지). 로그: /home/ubuntu/maidol/deploy_age1/run.log
set -u
B=/home/ubuntu/maidol/deploy_age1; R=/home/ubuntu/maidol/backend_9004; A=$R/app
TS=$(date -u +%Y%m%dT%H%M%SZ)
log(){ echo "[$(date -u +%FT%TZ)] $*"; }
FILES="main.py routes/charts.py routes/tracks.py routes/artists.py routes/albums.py routes/feeds.py routes/likes.py routes/playlists.py routes/club_albums.py"
log "start"
cd $A || exit 1
if ! md5sum -c $B/MD5SUMS.server --quiet; then log "ABORT md5 drift — 다른 세션이 서버 파일을 바꿈"; exit 2; fi
while :; do
  J=$(sudo docker exec -i maidol-app sh -c "cd /srv/app && python -" < $B/jobcheck.py 2>&1 | tail -1)
  log "jobs: $J"
  case "$J" in total=0*) break;; esac
  if [ "$(TZ=Asia/Seoul date +%H)" -ge 6 ]; then log "ABORT jobs not idle by 06:00 KST"; exit 3; fi
  sleep 300
done
# 백업
mkdir -p /home/ubuntu/maidol/backups/pre_age1_$TS
for f in $FILES; do cp $A/$f /home/ubuntu/maidol/backups/pre_age1_$TS/$(echo $f | tr / _); cp $A/$f $A/$f.bak_pre_age1; done
cp $R/.env /home/ubuntu/maidol/backups/pre_age1_$TS/env.bak
rm -rf /home/ubuntu/maidol/backups/pre_age1_$TS/admin_static && cp -r $A/admin_static /home/ubuntu/maidol/backups/pre_age1_$TS/admin_static
# 반영
for f in $FILES routes/admin_age_rating.py services/age_rating.py; do cp $B/app/$f $A/$f; done
rm -rf $A/admin_static && cp -r $B/admin_dist $A/admin_static
grep -q '^AGE_RATING_CLASSIFY_FROM=' $R/.env || echo 'AGE_RATING_CLASSIFY_FROM=2026-10-20T03:00:00+09:00' >> $R/.env
grep -q '^AGE_RATING_FILTER_FROM=' $R/.env || echo 'AGE_RATING_FILTER_FROM=2026-10-20T12:00:00+09:00' >> $R/.env
log "files+env applied, backup pre_age1_$TS"
rollback(){
  log "ROLLBACK: $1"
  for f in $FILES; do cp /home/ubuntu/maidol/backups/pre_age1_$TS/$(echo $f | tr / _) $A/$f; done
  rm -f $A/routes/admin_age_rating.py $A/services/age_rating.py
  rm -rf $A/admin_static && cp -r /home/ubuntu/maidol/backups/pre_age1_$TS/admin_static $A/admin_static
  cp /home/ubuntu/maidol/backups/pre_age1_$TS/env.bak $R/.env
  sudo docker stop -t 60 maidol-app; sudo docker rm maidol-app
  sudo docker run -d --name maidol-app --network host --restart unless-stopped --env-file $R/.env -e S3_REGION=ap-northeast-2 -v /home/ubuntu/maidol/logs:/srv/app/logs maidol-app:pre_age1
  log "rolled back to maidol-app:pre_age1"; exit 4
}
sudo docker logs maidol-app > /home/ubuntu/maidol/maidol-app_pre_age1_$TS.log 2>&1
sudo docker tag maidol-app:latest maidol-app:pre_age1
cd $R
if ! sudo nice -n 19 docker build -q -t maidol-app:latest . ; then
  log "build failed — restoring files (컨테이너는 그대로 운영 중)"
  for f in $FILES; do cp /home/ubuntu/maidol/backups/pre_age1_$TS/$(echo $f | tr / _) $A/$f; done
  rm -f $A/routes/admin_age_rating.py $A/services/age_rating.py
  rm -rf $A/admin_static && cp -r /home/ubuntu/maidol/backups/pre_age1_$TS/admin_static $A/admin_static
  cp /home/ubuntu/maidol/backups/pre_age1_$TS/env.bak $R/.env; exit 5
fi
# 재기동 직전 한 번 더 진행 작업 확인
J=$(sudo docker exec -i maidol-app sh -c "cd /srv/app && python -" < $B/jobcheck.py 2>&1 | tail -1); log "jobs(pre-stop): $J"
case "$J" in total=0*) ;; *) log "jobs appeared during build — waiting 5m"; sleep 300;; esac
sudo docker stop -t 60 maidol-app && sudo docker rm maidol-app
sudo docker run -d --name maidol-app --network host --restart unless-stopped --env-file $R/.env -e S3_REGION=ap-northeast-2 -v /home/ubuntu/maidol/logs:/srv/app/logs maidol-app:latest
UP=0; for i in $(seq 1 40); do sleep 3; if curl -fsS -m 2 http://127.0.0.1:9006/api/health >/dev/null 2>&1; then UP=1; log "UP after $((i*3))s"; break; fi; done
[ $UP = 1 ] || rollback "health not up in 120s"
# 확인
chk(){ code=$(curl -s -o /dev/null -m 15 -w '%{http_code}' "$2"); log "check $1 -> $code (want $3)"; [ "$code" = "$3" ] || FAILC="$FAILC $1"; }
FAILC=""
chk top100 http://127.0.0.1:9006/api/charts/top100 200
chk daily http://127.0.0.1:9006/api/charts/daily 200
chk latest "http://127.0.0.1:9006/api/tracks/?sort=created_at&limit=5" 200
chk search "http://127.0.0.1:9006/api/tracks/search?q=%EC%82%AC%EB%9E%91" 200
chk albums http://127.0.0.1:9006/api/albums/latest 200
chk google_login http://127.0.0.1:9006/api/auth/oauth/google/login 302
chk admin_page http://127.0.0.1:9006/admin/ 200
chk age_admin_noauth http://127.0.0.1:9006/api/admin/age-ratings/summary 401
TID=$(curl -s -m 10 "http://127.0.0.1:9006/api/charts/top100?limit=1" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d[0]["id"] if d else "")' 2>/dev/null)
[ -n "$TID" ] && chk track_detail http://127.0.0.1:9006/api/tracks/$TID 200 && chk related "http://127.0.0.1:9006/api/tracks/$TID/related?limit=3" 200
[ -z "$FAILC" ] || rollback "checks failed:$FAILC"
sudo docker exec maidol-app sh -c "cd /srv/app && python -c 'from app.main import app; print(len(app.routes))'" 2>/dev/null | tail -1 | sed 's/^/routes=/'
sleep 30; sudo docker logs --since 2m maidol-app 2>&1 | grep -E "\[age\]|Traceback" | tail -5
log "DONE"
