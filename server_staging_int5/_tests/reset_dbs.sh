#!/bin/sh
# 임시 DB 초기화(운영 스키마만) — EC2 /tmp/mtest 에서 실행
sudo docker rm -f mtest-pg mtest-mongo mtest-redis >/dev/null 2>&1
sudo docker run -d --rm --name mtest-pg -p 127.0.0.1:55432:5432 --tmpfs /var/lib/postgresql/data -e POSTGRES_USER=t -e POSTGRES_PASSWORD=t -e POSTGRES_DB=t pgvector/pgvector:pg16 >/dev/null
sudo docker run -d --rm --name mtest-mongo -p 127.0.0.1:57017:27017 --tmpfs /data/db mongo:7 >/dev/null
sudo docker run -d --rm --name mtest-redis -p 127.0.0.1:56379:6379 redis:7-alpine >/dev/null
sleep 8
sudo docker exec -i mtest-pg psql -q -U t -d t < /tmp/mtest/schema.sql >/dev/null 2>&1
