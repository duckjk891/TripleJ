#!/usr/bin/env bash
# v3.391 [OTA] 설치 앱 JS 업데이트(EAS Update) 배포 — 대표 승인 후에만 실행(운영 반영).
#
# 사용법(2_housing 폴더에서):
#   ./scripts/ota_update.sh preview "v3.391 다운로드 폴더 저장"        # 시험 APK(채널 preview)에만
#   ./scripts/ota_update.sh production "v3.391 다운로드 폴더 저장"     # 스토어 앱(채널 production)
#   DRY_RUN=1 ./scripts/ota_update.sh production "..."                # 확인만(배포 안 함)
#
# 하는 일:
#   1) tsc 검사(오류 있으면 중단)
#   2) eas.json 해당 프로필의 env(광고 단위 등 EXPO_PUBLIC_*)를 그대로 넣는다(빌드와 같은 값)
#   3) 플랫폼별 runtime(fingerprint)을 계산해, 그 runtime 으로 만든 빌드가 그 채널에 있는지 확인
#      → 없으면 "네이티브가 바뀐 수정 = OTA 불가, 새 스토어 빌드 필요"로 그 플랫폼은 건너뜀
#   4) eas update --channel <채널> --platform <플랫폼> 로 올린다
set -euo pipefail
cd "$(dirname "$0")/.."

CHANNEL="${1:-}"
MESSAGE="${2:-}"
if [[ "$CHANNEL" != "preview" && "$CHANNEL" != "production" ]]; then
  echo "사용법: $0 preview|production \"업데이트 설명\"" >&2
  exit 1
fi
if [[ -z "$MESSAGE" ]]; then
  echo "업데이트 설명(두 번째 인자)을 적어 주세요. 예: \"v3.391 다운로드 폴더 저장\"" >&2
  exit 1
fi
EAS="npx -y eas-cli@latest"

echo "▶ 1/4 타입 검사(tsc)"
npx tsc --noEmit -p .

echo "▶ 2/4 eas.json [$CHANNEL] env 적용"
while IFS='=' read -r k v; do
  [[ -z "$k" ]] && continue
  export "$k=$v"
  echo "   $k 설정"
done < <(node -e '
  const j = require("./eas.json");
  const env = (j.build?.[process.argv[1]]?.env) || {};
  for (const [k, v] of Object.entries(env)) console.log(`${k}=${v}`);
' "$CHANNEL")

echo "▶ 3/4 네이티브 호환 확인(runtime fingerprint)"
PLATFORMS=()
for P in android ios; do
  RV=$(npx expo-updates runtimeversion:resolve --platform "$P" 2>/dev/null | node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      const i = s.indexOf("{"); try { console.log(JSON.parse(s.slice(i)).runtimeVersion || ""); } catch { console.log(""); }
    });')
  if [[ -z "$RV" ]]; then
    echo "   [$P] runtime 계산 실패 — 건너뜀"
    continue
  fi
  COUNT=$($EAS build:list --platform "$P" --channel "$CHANNEL" --runtime-version "$RV" --status finished --limit 1 --json --non-interactive 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).length)}catch{console.log(0)}})')
  if [[ "$COUNT" -gt 0 ]]; then
    echo "   [$P] runtime ${RV:0:12}… 빌드 있음 → OTA 대상"
    PLATFORMS+=("$P")
  else
    echo "   [$P] runtime ${RV:0:12}… 로 만든 [$CHANNEL] 빌드 없음 → OTA 불가(네이티브가 바뀌었거나 아직 빌드 전). 새 빌드가 필요해요."
  fi
done

if [[ ${#PLATFORMS[@]} -eq 0 ]]; then
  echo "✖ 올릴 수 있는 플랫폼이 없어요. 새 빌드(eas build --profile $CHANNEL)가 필요합니다." >&2
  exit 2
fi

echo "▶ 4/4 OTA 배포: 채널 $CHANNEL · ${PLATFORMS[*]} · \"$MESSAGE\""
if [[ "${DRY_RUN:-}" == "1" ]]; then
  echo "   (DRY_RUN=1 — 여기서 멈춤)"
  exit 0
fi
for P in "${PLATFORMS[@]}"; do
  $EAS update --channel "$CHANNEL" --platform "$P" --message "$MESSAGE" --non-interactive
done
echo "✔ 완료 — 앱을 껐다 켜면(또는 앱으로 돌아와 [지금 적용]) 반영돼요. expo.dev > Updates 에서 확인."
