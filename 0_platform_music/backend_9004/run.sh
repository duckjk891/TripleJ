#!/bin/bash
set -e
cd "$(dirname "$0")"
mkdir -p logs
# 2026-08-20: --reload 제거. 이 저장소는 /mnt/d(윈도우 drvfs) 위에 있고 uvicorn --reload 는
# cwd 를 재귀 감시하므로 venv(5.5GB·10만+ 파일)까지 watch 대상이 되어 기동이 사실상 불가능하다.
# 코드 변경 시에는 이 스크립트로 재기동한다(9005 도 동일하게 reload 없이 운영해 왔음).
exec ./venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 9004 2>&1 \
  | awk '{print strftime("[%Y-%m-%d %H:%M:%S]"), $0; fflush()}' \
  | tee logs/server.log
