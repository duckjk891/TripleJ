# MAIDOL 맥 → 윈도우 이전 체크리스트

새 윈도우 PC로 MAIDOL 작업을 옮기는 순서입니다. 운영 서버(AWS)와 개발 서버(WSL PC)는 그대로 두고, **작업 PC만** 바뀝니다.
작업은 윈도우 안의 **WSL2(우분투)** 에서 합니다. 배포 스크립트(rsync, bash)가 맥과 똑같이 돌아가기 때문입니다.

## 0. 맥에서 묶기

```bash
bash ~/TripleJ/claude_skills_outputs/migration/mac_bundle.sh --dry
bash ~/TripleJ/claude_skills_outputs/migration/mac_bundle.sh
bash ~/TripleJ/claude_skills_outputs/migration/mac_bundle.sh --usb /Volumes/USB이름
```

| 결과물 | 내용 | 옮기는 방법 |
|---|---|---|
| `~/maidol_migration/repo_extra.tar.gz` | GitHub에 없는 파일 (scratchpad, 에셋, 서버 스테이징, 수정된 .blend) | USB 또는 클라우드 드라이브 |
| `~/maidol_migration/local_branches.bundle` | GitHub에 없는 로컬 브랜치 13개 | 위와 같음 |
| `~/maidol_migration/claude_config.tar.gz` | Claude 메모리, team-dev, 스킬, 예약 작업 3개, 올린 자료 | 위와 같음 |
| `~/maidol_migration/gov_grant_monitor.tar.gz` | 지원사업 모니터 (.env·.venv 제외) | 위와 같음 |
| USB `maidol_secrets/` | 앱스토어 키(asc.env·.p8 3개), google-services.json, SSH 키, AWS 인증, 모니터 .env | **USB로만** |

## 1. 윈도우 준비

1. 관리자 PowerShell에서 `wsl --install -d Ubuntu` 후 재부팅, 우분투 사용자 만들기
2. 윈도우에 설치: Claude 데스크톱 앱, Blender 4.5 LTS
3. 우분투 안에 설치: git, rsync, unzip, python3, python3-venv, Node 22(nvm), gh, AWS CLI v2
4. 필요할 때 설치: `npm i -g eas-cli`, wrangler(`npx wrangler`), ffmpeg(`sudo apt install ffmpeg`)

## 2. 코드 받기 (우분투 안)

```bash
gh auth login
cd ~ && gh repo clone duckjk891/TripleJ TripleJ
cd ~/TripleJ && git checkout frontend
git worktree add ../TripleJ-backend backend
```

`TripleJ-maidol`, `-r8`, `-storebuild`, `-webdeploy` 는 필요해질 때 같은 방식으로 `git worktree add` 합니다.

## 3. 묶음 풀기

```bash
cd ~/maidol_migration && sha256sum -c SHA256SUMS.txt
tar -xzf repo_extra.tar.gz -C ~/TripleJ
git -C ~/TripleJ fetch ~/maidol_migration/local_branches.bundle 'refs/heads/*:refs/heads/*'
mkdir -p ~/Desktop && tar -xzf gov_grant_monitor.tar.gz -C ~/Desktop
```

## 4. 비밀 파일 (USB에서)

```bash
S=/mnt/<USB 드라이브 문자>/maidol_secrets
cp $S/repo/*.p8 $S/repo/asc.env ~/TripleJ/2_housing/credentials/
cp $S/repo/google-services.json ~/TripleJ/2_housing/
mkdir -p ~/.ssh ~/.aws && cp $S/ssh/* ~/.ssh/ && cp $S/aws/* ~/.aws/
chmod 700 ~/.ssh && chmod 600 ~/.ssh/maidol_ec2 ~/.ssh/id_ed25519 ~/.aws/credentials
cp $S/gov_grant_monitor/.env ~/Desktop/gov_grant_monitor/
```

다 옮긴 뒤 **USB의 `maidol_secrets` 폴더는 지웁니다.** 맥의 원본은 이전이 끝날 때까지 둡니다.

## 5. Claude 설정

1. `claude_config.tar.gz` 를 새 PC의 `.claude` 폴더에 풉니다.
2. Claude로 `~/TripleJ` 를 한 번 엽니다. `.claude/projects/` 아래에 새 경로 이름의 폴더가 생깁니다.
3. 압축에서 나온 `projects/-Users-pearl-TripleJ/memory/` 안의 파일을 그 새 폴더의 `memory/` 로 옮깁니다. 메모리는 폴더 경로에 묶여 있어서, 이걸 해야 이어집니다.
4. 데스크톱 앱이 WSL 폴더를 여는 방식에 따라 `.claude` 위치가 윈도우 쪽일 수도 있습니다. 첫 실행 때 같이 확인합니다.

## 6. 예약 작업 3개 다시 만들기

| 작업 | 원래 설정 |
|---|---|
| `gov_grant_monitor` | `scheduled-tasks/gov_grant_monitor/SKILL.md`, 모니터 폴더에서 실행 (.venv는 새로 만들고 `pip install requests`) |
| `maidol-daily-cs` | `scheduled-tasks/maidol-daily-cs/SKILL.md` |
| `maidol-playback-repeat-cutoff-check` | `scheduled-tasks/maidol-playback-repeat-cutoff-check/SKILL.md` |

윈도우에서 한 번씩 돌아가는 걸 확인한 **뒤에** 맥의 같은 작업을 끕니다. 둘 다 켜져 있으면 CS 확인과 메일이 두 번 나갑니다.

## 7. 확인

| 확인 | 명령 |
|---|---|
| GitHub | `gh auth status` |
| AWS | `aws sts get-caller-identity` |
| 운영 서버 접속 | `ssh` 로 EC2 접속 (맥의 `~/.ssh/config` 별칭 그대로) |
| 개발 서버 접속 | `ssh -p 2222 duckjk89@100.127.225.55` |
| 앱 빌드 준비 | `cd ~/TripleJ/2_housing && npm ci`, `eas whoami` |
| 프리비즈 | 윈도우 Blender로 `previz/banggap_chicken_previz.blend` 열기 |

## 8. 맥 정리

윈도우에서 일주일 정도 문제없이 쓰면, 맥의 예약 작업을 끄고 맥은 백업으로만 둡니다.
