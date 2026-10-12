#!/bin/sh
# 스테이징 코드를 임시 컨테이너에 덮어쓰고 테스트(임시 DB) — EC2 /tmp/agetest 에서 실행
ENVS="-e PYTHONPATH=/srv/app -e POSTGRES_HOST=127.0.0.1 -e POSTGRES_PORT=55433 -e POSTGRES_USER=t -e POSTGRES_PASSWORD=t -e POSTGRES_DB=t \
 -e MONGO_URL=mongodb://127.0.0.1:57018/t -e MONGO_DB=t -e REDIS_HOST=127.0.0.1 -e REDIS_PORT=56380 -e REDIS_PASSWORD= -e REDIS_URL=redis://127.0.0.1:56380/0 \
 -e JWT_SECRET=test-jwt-secret-age1-xxxxxxxxxxxxxxxx -e KIDS_MODE_ENABLED=true -e OPENAI_API_KEY= -e ANTHROPIC_API_KEY=test-key \
 -e ELASTICSEARCH_URL=http://127.0.0.1:1 -e ES_URL=http://127.0.0.1:1"
sudo docker run --rm --network host --user root $ENVS -v /tmp/agetest/stage:/stage:ro maidol-app:latest \
 sh -c "cd /srv/app && python /stage/_tests/route_map.py > /tmp/before.txt && cp -r /stage/app/. /srv/app/app/ && python /stage/_tests/route_map.py > /tmp/after.txt && echo '== route diff (before→after)' && diff /tmp/before.txt /tmp/after.txt; python /stage/_tests/test_age1.py"
