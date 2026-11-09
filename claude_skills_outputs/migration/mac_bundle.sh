#!/bin/bash
# MAIDOL 맥 → 윈도우 이전 묶음.
#   bash mac_bundle.sh            → ~/maidol_migration 에 일반 묶음 생성 (비밀 파일 없음)
#   bash mac_bundle.sh --dry      → 무엇이 들어갈지 개수·크기만 출력
#   bash mac_bundle.sh --usb /Volumes/이름  → 비밀 파일만 USB의 maidol_secrets 폴더로 복사
set -u
REPO="$HOME/TripleJ"
GRANT="$HOME/Desktop/gov_grant_monitor"
OUT="$HOME/maidol_migration"
SECRET_RE='(^|/)(credentials/|\.env($|\.)|.*\.p8$|.*\.pem$|.*\.jks$|.*\.keystore$|google-services\.json$|id_ed25519|maidol_ec2)'

if [ "${1:-}" = "--usb" ]; then
  USB="${2:-}"
  case "$USB" in /Volumes/?*) ;; *) echo "USB 경로를 /Volumes/이름 으로 주세요"; exit 1;; esac
  [ -d "$USB" ] || { echo "USB가 안 보여요: $USB"; exit 1; }
  D="$USB/maidol_secrets"; mkdir -p "$D/ssh" "$D/aws" "$D/repo" "$D/gov_grant_monitor" || exit 1
  cp -p "$REPO"/2_housing/credentials/* "$D/repo/" || exit 1
  cp -p "$REPO/2_housing/google-services.json" "$D/repo/" || exit 1
  for f in config maidol_ec2 maidol_ec2.pub id_ed25519 id_ed25519.pub; do cp -p "$HOME/.ssh/$f" "$D/ssh/" || exit 1; done
  cp -p "$HOME/.aws/config" "$HOME/.aws/credentials" "$D/aws/" || exit 1
  [ -f "$GRANT/.env" ] && cp -p "$GRANT/.env" "$D/gov_grant_monitor/.env"
  echo "USB 복사 완료: $(find "$D" -type f | wc -l | tr -d ' ')개 파일 (내용은 출력하지 않음)"
  exit 0
fi

cd "$REPO" || exit 1
LIST=$(mktemp)
# 1) GitHub에 없는 미추적 파일 + 수정된 파일 (node_modules·비밀 제외)
{ git ls-files --others --exclude-standard; git diff --name-only; } | grep -v '/node_modules/' | grep -Ev "$SECRET_RE" | sort -u > "$LIST"
# 2) GitHub에 없는 로컬 브랜치
BR=$(for b in $(git for-each-ref --format='%(refname:short)' refs/heads); do git ls-remote --exit-code --heads origin "$b" >/dev/null 2>&1 || echo "$b"; done)

if [ "${1:-}" = "--dry" ]; then
  echo "레포 추가 파일: $(wc -l < "$LIST" | tr -d ' ')개, 약 $(tr '\n' '\0' < "$LIST" | xargs -0 du -ck 2>/dev/null | tail -1 | cut -f1)KB"
  echo "로컬 전용 브랜치: $(echo "$BR" | grep -c .)개"
  echo "Claude 메모리 파일: $(ls "$HOME/.claude/projects/-Users-pearl-TripleJ/memory" | wc -l | tr -d ' ')개"
  rm -f "$LIST"; exit 0
fi

mkdir -p "$OUT" || exit 1
tar -czf "$OUT/repo_extra.tar.gz" -C "$REPO" -T "$LIST" || exit 1
[ -n "$BR" ] && { git bundle create "$OUT/local_branches.bundle" $BR || exit 1; echo "$BR" > "$OUT/local_branches.txt"; }
tar -czf "$OUT/claude_config.tar.gz" -C "$HOME/.claude" commands skills scheduled-tasks settings.json uploads projects/-Users-pearl-TripleJ/memory || exit 1
[ -d "$GRANT" ] && tar -czf "$OUT/gov_grant_monitor.tar.gz" -C "$HOME/Desktop" --exclude='.venv' --exclude='.env' --exclude='__pycache__' gov_grant_monitor
cp "$REPO/claude_skills_outputs/migration/WINDOWS_MIGRATION.md" "$OUT/" 2>/dev/null
( cd "$OUT" && shasum -a 256 *.tar.gz *.bundle 2>/dev/null > SHA256SUMS.txt )
rm -f "$LIST"
echo "완료: $OUT"; ls -lh "$OUT"
