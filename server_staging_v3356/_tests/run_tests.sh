#!/bin/sh
# EC2 /tmp/reltest 에서 실행 — 네트워크 차단 임시 컨테이너(운영 DB·Redis 무접촉). 라우트 매핑 비교 + 단위 테스트.
ENVS="-e PYTHONPATH=/srv/app -e JWT_SECRET=test-jwt-secret-v3356-xxxxxxxxxxxxxxxx -e OPENAI_API_KEY= -e ANTHROPIC_API_KEY=test-key \
 -e MONGO_URL=mongodb://127.0.0.1:1/t -e MONGO_DB=t -e REDIS_URL=redis://127.0.0.1:1/0 -e ELASTICSEARCH_URL=http://127.0.0.1:1 -e ES_URL=http://127.0.0.1:1"
sudo docker run --rm --network none --user root $ENVS -v /tmp/reltest/stage:/stage:ro maidol-app:latest sh -c \
 "cd /srv/app && python -B -c 'import app.routes.tracks as T; print(sorted((r.path, sorted(r.methods), r.endpoint.__name__) for r in T.router.routes))' > /tmp/before.txt \
  && cp -r /stage/app/. /srv/app/app/ && cp /stage/_orig/app/routes/tracks.py /srv/app/app/routes/tracks_orig.py \
  && python -B -c 'import app.routes.tracks as T; print(sorted((r.path, sorted(r.methods), r.endpoint.__name__) for r in T.router.routes))' > /tmp/after.txt \
  && (cmp -s /tmp/before.txt /tmp/after.txt && echo 'route map 동일' || echo 'ROUTE MAP CHANGED') \
  && python -B /stage/_tests/test_v3356.py"
