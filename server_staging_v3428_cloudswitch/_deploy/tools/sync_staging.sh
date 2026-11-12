#!/bin/bash
# ~/cloudswitch/base 의 변경 파일 → 스테이징 폴더 app/ 복사 + cloudswitch.diff + files.txt(rel live_md5 new_md5) 재생성
set -e
BASE=~/cloudswitch/base
STG=~/TripleJ/server_staging_v3428_cloudswitch
cd "$BASE"
~/cloudswitch/venv/bin/python -m py_compile $(git diff --name-only HEAD; git ls-files --others --exclude-standard | grep '\.py$') && echo "py_compile OK"
git add -N app/services/ai_providers.py app/services/video_models.py 2>/dev/null || true
git diff HEAD -- app > "$STG/cloudswitch.diff"
: > "$STG/files.txt"
for f in $(git diff HEAD --name-only -- app); do
  rel=${f#app/}
  mkdir -p "$STG/app/$(dirname "$rel")"
  cp "$f" "$STG/app/$rel"
  if git cat-file -e "HEAD:$f" 2>/dev/null && [ -n "$(git show HEAD:$f)" ]; then
    live=$(git show "HEAD:$f" | md5sum | cut -d' ' -f1)
  else
    live=NEW
  fi
  new=$(md5sum "$f" | cut -d' ' -f1)
  echo "$rel $live $new" >> "$STG/files.txt"
done
wc -l "$STG/files.txt" "$STG/cloudswitch.diff"
