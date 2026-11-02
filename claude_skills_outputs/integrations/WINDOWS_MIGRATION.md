# 작업 PC 맥 → 윈도우 이전 순서표 (2026-11-03)

윈도우에서는 **WSL2(윈도우 안의 우분투)** 에서 일한다. 배포 스크립트가 전부 bash 라서다.
비밀 파일은 **USB 로 직접** 옮긴다(클라우드·메일·메신저·채팅 금지). 이 문서에는 비밀 값을 적지 않는다.

## 0. 맥에서 끝낸 준비 (11-03)
- 서버 코드(backend 브랜치) GitHub 미업로드 12커밋 push 완료. 그 밖의 브랜치는 이미 GitHub 에 있음.
- 웹 배포 스크립트 `homepage/maidol/deploy.sh` 맥·WSL 공용으로 수정(`APP_SRC` 환경변수, sed·md5 자동 선택). 미리보기 배포로 확인.
- 짐 묶음: `TripleJ/_windows_move/` (비밀 없음, 약 150MB)
  - `TripleJ_git에없는파일.tar.gz` — 서버 반영 준비 폴더(server_staging_*), scratchpad, 옛 서버 폴더 등 Git 에 없는 파일
  - `homepage.tar.gz` — maidol.ai.kr 소스·웹 배포 스크립트·app-ads.txt(지우면 AdMob 인증 깨짐)
  - `claude_config/` — 기억 메모(memory), team-dev 스킬, 매일 자동 실행 작업 3개, 설정
  - `worktree_patches/` — 보조 작업 폴더의 사소한 미커밋 수정(필요할 때만)
  - 빠진 것: `_assets_reference/`(구매한 게임 에셋 묶음, MAIDOL 무관 — 필요하면 따로 복사)

## 1. USB 로 옮길 비밀 파일 (맥 위치 → WSL 위치)
| 무엇 | 맥 위치 | WSL 위치 |
|---|---|---|
| EC2 접속 키 | `~/.ssh/maidol_ec2` | `~/.ssh/maidol_ec2` (`chmod 600`) |
| EC2 접속 설정 | `~/.ssh/config` 의 `Host maidol-ec2` 블록 | `~/.ssh/config` |
| AWS 계정 키(EC2 접속이 AWS SSM 경유) | `~/.aws/credentials`, `~/.aws/config` | `~/.aws/` 같은 이름 |
| 애플 키 3개 + 제출 설정 | `TripleJ/2_housing/credentials/` (AuthKey_*.p8, asc.env) | `~/TripleJ/2_housing/credentials/` |
| 안드로이드 Firebase 설정 | `TripleJ/2_housing/google-services.json` | 같은 자리 (없으면 OTA 판정이 틀어짐) |
| 옛 서버 설정 | `TripleJ/0_platform_music/backend/.env` | 같은 자리 |

## 2. 윈도우 준비
1. 관리자 PowerShell: `wsl --install` → 재부팅 → Ubuntu 사용자 만들기.
2. 윈도우에 Tailscale 설치·로그인(가정용 WSL 서버 접속용), Claude 앱 설치.
3. Ubuntu 안에서:
   ```bash
   sudo apt update && sudo apt install -y git python3 python3-pip unzip curl build-essential
   curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash   # 새 터미널 후
   nvm install 22 && nvm use 22                                                      # 맥과 같은 Node 22
   ```
4. AWS CLI v2 + Session Manager 플러그인(리눅스용) 설치 — EC2 접속이 `aws ssm start-session` 을 거친다. 설치법은 AWS 공식 문서 기준.
5. GitHub CLI(`gh`) 설치.

## 3. 로그인 (Ubuntu 안에서)
```bash
gh auth login
npx eas-cli login          # Expo — 앱 빌드·제출·OTA
npx wrangler login         # Cloudflare — 웹앱·홈페이지 배포
```
Claude 앱도 같은 계정으로 로그인.

## 4. 코드·짐 풀기
```bash
cd ~ && git clone https://github.com/duckjk891/TripleJ.git && cd TripleJ && git checkout frontend
git worktree add ../TripleJ-backend backend                               # 서버 코드
git worktree add .claude/worktrees/admin-web claude/distracted-jennings-dc69d7   # 관리자·광고주 사이트 소스
tar -xzf /경로/TripleJ_git에없는파일.tar.gz -C ~/TripleJ
tar -xzf /경로/homepage.tar.gz -C ~
cd ~/TripleJ/2_housing && npm ci
```
(USB 의 비밀 파일을 1번 표대로 넣는다.)

## 5. Claude 설정 옮기기
- `claude_config/team-dev.md` → `~/.claude/commands/team-dev.md`
- `claude_config/memory/` → 윈도우에서 TripleJ 폴더로 세션을 한 번 연 뒤 생긴 `~/.claude/projects/<새 폴더 이름>/memory/` 에 복사
  (새 폴더 이름은 경로 기반 — 예: `-home-사용자-TripleJ`). 메모 안의 `/Users/pearl/...` 경로는 새 경로로 읽으면 된다.
- 매일 자동 실행 3개(`claude_config/scheduled-tasks/*/SKILL.md`): 윈도우 Claude 에서 새로 만들고 경로만 바꾼다.
  **윈도우 쪽을 켜는 날 맥 쪽은 끈다** — 둘 다 켜져 있으면 DM 답장이 두 번 나갈 수 있다.

## 6. 확인 (전부 읽기 전용·미리보기)
```bash
ssh maidol-ec2 'docker ps --format "{{.Names}} {{.Status}}" | head -3'   # EC2 접속
gh auth status && npx eas-cli whoami && npx wrangler whoami                 # 로그인 3종
cd ~/homepage/maidol && APP_BRANCH=mvtest ./deploy.sh app                   # 웹 미리보기 배포(운영 아님)
cd ~/TripleJ/2_housing && npx eas-cli fingerprint:compare --build-id <안드로이드 빌드 id>   # OTA 판정(메모 android-133-ota-after-release 참고)
```

## 7. 맥 정리 (윈도우가 다 되면)
- 자동 실행 3개 끄기, 잠자기 방지(caffeinate) 끄기(`pkill caffeinate`).
- 맥은 한동안 지우지 말고 보관(혹시 빠진 파일 대비).
