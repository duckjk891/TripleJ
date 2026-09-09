#!/bin/bash
# 9004 안전 재시작 — pkill 자기매칭 방지 + ffmpeg PATH 명시(.local/bin) + 헬스 대기
# v229.1: "로그인 셸" 주석만 있고 실제 PATH 주입이 없어 ffmpeg 유실 재발(2026-09-09 422 실사고) → export 명시
export PATH="$HOME/.local/bin:$HOME/bin:$PATH"
pkill -f "app[.]main:app.*port 9004" 2>/dev/null
sleep 2
cd "$(dirname "$0")"
setsid nohup ./venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 9004 >> /tmp/server_9004.log 2>&1 < /dev/null &
disown
for i in $(seq 1 30); do sleep 3; curl -sS -m 2 http://127.0.0.1:9004/api/health >/dev/null 2>&1 && { echo "UP after $((i*3))s"; exit 0; }; done
echo "START FAILED"; tail -10 /tmp/server_9004.log; exit 1
