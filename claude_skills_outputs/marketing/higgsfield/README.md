# 반값 치킨 티저 — Higgsfield 자동 생성

`../banggap_video_prompts.html`의 클립 V01~V11을 Higgsfield API로 뽑는 로컬 제작 스크립트입니다. 서버·앱 기능이 아닙니다. 기본 모델은 **Kling 4.0 reference-to-video**(`kling-video/v4.0/reference-to-video`)이고, `--model seedance-2.0|seedance-2.5`도 됩니다.

## 준비
1. API는 웹(higgsfield.ai) 크레딧과 별도입니다. https://open.higgsfield.ai 에 로그인해 잔액을 충전하고 **API keys**에서 키(ID·Secret)를 발급합니다.
2. `.env.example`을 `.env`로 복사해 두 값을 넣습니다. `.env`는 git에 올라가지 않으며, 키는 채팅에 적지 않습니다.
3. 완성 컷 이미지를 `images/cuts/C10.png`처럼 컷 번호 이름으로 넣습니다. 직원·사장 시트는 `image_map.json`에서 지정합니다.
4. 블렌더 프리비즈와 콘티 스케치는 넣지 않습니다. 곡 음원도 올리지 않습니다(소리는 편집에서 원곡으로 덮음).

## 실행 (WSL)
```bash
cd ~/TripleJ/claude_skills_outputs/marketing/higgsfield
python3 hf_clips.py list                 # 이미지 준비 상태
python3 hf_clips.py show V06             # 보낼 프롬프트·이미지 순서 확인 (호출 없음)
python3 hf_clips.py estimate all         # 견적 (과금 없음)
python3 hf_clips.py run V06 --yes        # 720p 초안 생성 → out/V06_720p_*.mp4
python3 hf_clips.py poll                 # 끊긴 작업 이어 받기 + 전체 상태표
```
Kling 4.0은 720p·1080p만 있어서 초안은 720p, 최종은 `--res 1080p`입니다.

## API와 웹 화면의 차이
reference-to-video에는 시작 프레임 전용 칸이 없습니다. 그래서 시작 프레임 이미지를 `@image_1`로 맨 앞에 넣고, 카드의 레퍼런스는 `@image_2`부터 번호를 하나씩 밀어 프롬프트도 자동으로 고칩니다(Seedance는 `@Image1` 표기). 첫 프레임이 이미지와 똑같이 고정되는지는 V06 시험본으로 확인합니다. Kling 4.0 image-to-video는 첫 프레임·중간 키프레임만 받고 인물 시트는 못 받습니다.

## 기록
- `out/<클립>_<화질>_<시각>.mp4` 와 같은 이름의 `.txt`(request_id, 이미지 순서, 프롬프트)
- `runs/jobs.json`: 모든 작업의 request_id·상태·견적·영상 URL (결과 URL은 7일 뒤 삭제)
- `out/`, `runs/`, `images/`, `.env`는 git에 올리지 않습니다.
