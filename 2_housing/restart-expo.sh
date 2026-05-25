#!/usr/bin/env bash
# Expo 개발 서버 재시작 스크립트
# 사용법:
#   ./restart-expo.sh              # 기본 (모바일 dev client, Tailscale IP 자동 감지)
#   ./restart-expo.sh --clean      # Metro 캐시 비우고 시작
#   ./restart-expo.sh --lan        # LAN IP 사용 (Tailscale 대신)
#   ./restart-expo.sh --web        # PC 브라우저 (외부 디바이스도 같은 호스트로 접근 가능)
#   ./restart-expo.sh --web --lan
#   HOST=10.0.0.1 ./restart-expo.sh  # 호스트 직접 지정

set -e

cd "$(dirname "$0")"

CLEAN=""
USE_LAN=0
USE_WEB=0
for arg in "$@"; do
  case "$arg" in
    --clean) CLEAN="--clear" ;;
    --lan)   USE_LAN=1 ;;
    --web)   USE_WEB=1 ;;
    *) echo "알 수 없는 옵션: $arg"; exit 1 ;;
  esac
done

# 1) 기존 프로세스 종료
echo "[1/3] 기존 expo / metro 프로세스 종료 중..."
pkill -f "expo start" 2>/dev/null || true
pkill -f "metro" 2>/dev/null || true
pkill -f "caffeinate -i env REACT_NATIVE_PACKAGER_HOSTNAME" 2>/dev/null || true
# 포트 점유 정리 (8081, 19000~19002)
for port in 8081 19000 19001 19002; do
  lsof -ti tcp:$port 2>/dev/null | xargs kill -9 2>/dev/null || true
done
sleep 1
echo "      완료"

# 2) 호스트 결정 (web/mobile 공통 — Tailscale로 외부 접근 가능)
if [ -n "$HOST" ]; then
  PACKAGER_HOST="$HOST"
elif [ "$USE_LAN" = "1" ]; then
  PACKAGER_HOST="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "")"
  [ -z "$PACKAGER_HOST" ] && { echo "LAN IP 감지 실패"; exit 1; }
else
  # Tailscale 우선 (외부 디바이스 접근 가능)
  PACKAGER_HOST="$(tailscale ip 2>/dev/null | head -1 || echo "")"
  if [ -z "$PACKAGER_HOST" ]; then
    PACKAGER_HOST="$(ipconfig getifaddr en0 2>/dev/null || echo "")"
  fi
  [ -z "$PACKAGER_HOST" ] && { echo "호스트 IP 감지 실패. HOST=... 로 지정해주세요."; exit 1; }
fi

echo "[2/3] 패키저 호스트: $PACKAGER_HOST"

# 3) Expo 시작
if [ "$USE_WEB" = "1" ]; then
  echo "[3/3] expo start --web 실행..."
  echo "      로컬 접속:  http://localhost:8081"
  echo "      외부 접속:  http://$PACKAGER_HOST:8081"
  echo "      (종료: Ctrl+C)"
  echo ""
  # Metro가 모든 인터페이스(0.0.0.0)에서 listen하도록 EXPO_PACKAGER_HOSTNAME 함께 지정
  exec caffeinate -i env \
    REACT_NATIVE_PACKAGER_HOSTNAME="$PACKAGER_HOST" \
    EXPO_PACKAGER_HOSTNAME="$PACKAGER_HOST" \
    npx expo start --web --host lan $CLEAN
else
  echo "[3/3] expo start 실행..."
  echo "      (종료: Ctrl+C)"
  echo ""
  exec caffeinate -i env REACT_NATIVE_PACKAGER_HOSTNAME="$PACKAGER_HOST" npx expo start $CLEAN
fi
