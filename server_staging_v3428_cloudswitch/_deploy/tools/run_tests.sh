#!/bin/bash
# 클라우드 전환 시험 4종 실행 (네트워크 없음). 사용: bash ~/cloudswitch/tools/run_tests.sh [full]
cd ~/TripleJ/server_staging_v3428_cloudswitch || exit 1
PY=~/cloudswitch/venv/bin/python
rc=0
for t in behave_test fallback_test gemini_route_test routecheck; do
  echo "=== $t"
  if [ "$1" = "full" ]; then
    $PY $t.py 2>/dev/null || rc=1
  else
    $PY $t.py 2>/dev/null | grep -vE "^PASS" || true
  fi
done
exit $rc
