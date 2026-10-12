#!/bin/sh
# EC2 /tmp/reltest 에서 실행 — 네트워크 차단 임시 컨테이너(운영 DB·Redis 무접촉). 인자: [catalog.json] [반복수]
CAT=${1:-}
REPS=${2:-20}
ENVS="-e PYTHONPATH=/srv/app -e JWT_SECRET=test-jwt-secret-v3356-xxxxxxxxxxxxxxxx -e OPENAI_API_KEY= -e ANTHROPIC_API_KEY=test-key \
 -e MONGO_URL=mongodb://127.0.0.1:1/t -e MONGO_DB=t -e REDIS_URL=redis://127.0.0.1:1/0 -e ELASTICSEARCH_URL=http://127.0.0.1:1 -e ES_URL=http://127.0.0.1:1"
MNT="-v /tmp/reltest/stage:/stage:ro"
ARG="-"
if [ -n "$CAT" ]; then MNT="$MNT -v $CAT:/cat.json:ro"; ARG="/cat.json"; fi
sudo docker run --rm --network none --user root $ENVS -e SIM_ONLY=${SIM_ONLY:-} $MNT maidol-app:latest sh -c \
 "cp -r /stage/app/. /srv/app/app/ && cp /stage/_orig/app/routes/tracks.py /srv/app/app/routes/tracks_orig.py && cd /srv/app && python -B /stage/_sim/sim_related.py $ARG $REPS"
