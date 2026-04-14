#!/bin/bash
# AIMU 백엔드 서버 시작 스크립트
# 사용법: ./start_backend.sh <폴더명> <포트번호>
# 예시:   ./start_backend.sh backend 9000
#         ./start_backend.sh backend_9001 9001
#         ./start_backend.sh backend_9002 9002

FOLDER=$1
PORT=$2
COWORK_PATH='\\duckjk89\0_Cowork'
LOG_FILE="backend${PORT}.txt"
BASE_DIR="/mnt/d/projects/TripleJ/0_platform_music"

if [ -z "$FOLDER" ] || [ -z "$PORT" ]; then
  echo "사용법: ./start_backend.sh <폴더명> <포트번호>"
  echo "예시:   ./start_backend.sh backend 9000"
  exit 1
fi

# 기존 포트 프로세스 종료
fuser -k ${PORT}/tcp 2>/dev/null
sleep 1

# 공유폴더 로그 초기화
cmd.exe /c "echo. > ${COWORK_PATH}\\${LOG_FILE}" 2>/dev/null

# 로컬 로그 파일 (tee용)
LOCAL_LOG="/tmp/backend_${PORT}.log"

echo "백엔드 시작: ${FOLDER} (포트 ${PORT})"
echo "로컬 로그: ${LOCAL_LOG}"
echo "공유 로그: ${COWORK_PATH}\\${LOG_FILE}"
echo "종료: Ctrl+C"
echo ""

# 서버 시작 (터미널 + 로컬파일 + 공유폴더 동시 로그)
cd "${BASE_DIR}/${FOLDER}" && source venv/bin/activate && \
  python -m uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --reload 2>&1 | \
  while IFS= read -r line; do
    echo "$line"
    echo "$line" >> "$LOCAL_LOG"
    cmd.exe /c "echo ${line} >> ${COWORK_PATH}\\${LOG_FILE}" 2>/dev/null
  done
