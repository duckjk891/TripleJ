#!/bin/sh
# 스테이징 코드를 임시 컨테이너에 덮어쓰고 테스트(임시 DB) — EC2 에서 실행
sudo docker run --rm --network host --user root -e PYTHONPATH=/srv/app \
 -e POSTGRES_HOST=127.0.0.1 -e POSTGRES_PORT=55432 -e POSTGRES_USER=t -e POSTGRES_PASSWORD=t -e POSTGRES_DB=t \
 -e MONGO_URL=mongodb://127.0.0.1:57017/t -e MONGO_DB=t -e REDIS_HOST=127.0.0.1 -e REDIS_PORT=56379 -e REDIS_PASSWORD= \
 -e IDENTITY_CI_SALT=test-salt-int5 -e JWT_SECRET=test-jwt-secret-int5-xxxxxxxxxxxxxxxx \
 -v /tmp/mtest/stage:/stage:ro -v /tmp/mtest:/stage_idx:ro maidol-app:latest \
 sh -c "cp /stage/app/services/account_merge.py /srv/app/app/services/ && cp /stage/app/routes/identity.py /srv/app/app/routes/ && cd /srv/app && python /stage/_tests/test_int5_merge.py"
