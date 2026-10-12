#!/bin/sh
# age1 임시 DB(운영 스키마만, 데이터 없음) — EC2 /tmp/agetest 에서 실행. int5 의 mtest-* 와 이름·포트를 분리.
sudo docker rm -f agetest-pg agetest-mongo agetest-redis >/dev/null 2>&1
sudo docker run -d --rm --name agetest-pg -p 127.0.0.1:55433:5432 --tmpfs /var/lib/postgresql/data -e POSTGRES_USER=t -e POSTGRES_PASSWORD=t -e POSTGRES_DB=t pgvector/pgvector:pg16 >/dev/null
sudo docker run -d --rm --name agetest-mongo -p 127.0.0.1:57018:27017 --tmpfs /data/db mongo:7 >/dev/null
sudo docker run -d --rm --name agetest-redis -p 127.0.0.1:56380:6379 redis:7-alpine >/dev/null
sleep 8
sudo docker exec -i agetest-pg psql -q -U t -d t < /tmp/mtest/schema.sql >/dev/null 2>&1
echo dbs-ready
