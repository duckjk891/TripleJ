#!/bin/bash
set -e
cd "$(dirname "$0")"
mkdir -p logs
exec ./venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 9005 --reload 2>&1 \
  | awk '{print strftime("[%Y-%m-%d %H:%M:%S]"), $0; fflush()}' \
  | tee logs/server.log
