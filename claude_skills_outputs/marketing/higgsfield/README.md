# 반값 치킨 티저 — Higgsfield 자동 생성

`../banggap_video_prompts.html`의 클립 V01~V11을 Higgsfield API(Seedance reference-to-video)로 뽑는 로컬 제작 스크립트입니다. 서버·앱 기능이 아닙니다.

## 준비
1. https://console.higgsfield.ai 에서 API 키(ID·Secret)를 발급합니다.
2. `.env.example`을 `.env`로 복사해 두 값을 넣습니다. `.env`는 git에 올라가지 않으며, 키는 채팅에 적지 않습니다.
3. 완성 컷 이미지를 `images/cuts/C10.png`처럼 컷 번호 이름으로 넣고, 직원·사장 전신 시트는 `images/sheets/staff`, `images/sheets/owner`(png/jpg)로 넣습니다. 다른 위치면 `image_map.json`만 고칩니다.
4. 블렌더 프리비즈와 콘티 스케치는 넣지 않습니다. 곡 음원도 올리지 않습니다(소리 생성 끔, 편집에서 원곡으로 덮음).

## 실행 (WSL)
```bash
cd ~/TripleJ/claude_skills_outputs/marketing/higgsfield
python3 hf_clips.py list                 # 이미지 준비 상태
python3 hf_clips.py show V06             # 보낼 프롬프트·이미지 순서 확인 (호출 없음)
python3 hf_clips.py estimate all         # 견적 (과금 없음)
python3 hf_clips.py run V06 --yes        # 480p 초안 생성 → out/V06_480p_*.mp4
python3 hf_clips.py poll                 # 끊긴 작업 이어 받기 + 전체 상태표
```
`--res 1080p`로 최종본, `--model seedance-2.5`로 2.5를 씁니다(기본 2.0).

## API와 웹 화면의 차이
Higgsfield API의 reference-to-video에는 시작 프레임 전용 칸이 없습니다(`image_url`과 레퍼런스 배열을 같이 못 씀). 그래서 시작 프레임 이미지를 `@Image1`로 맨 앞에 넣고, 카드의 레퍼런스는 `@Image2`부터 번호를 하나씩 밀어 프롬프트도 자동으로 고칩니다. 첫 프레임이 이미지와 똑같이 고정되는지는 V06 시험본으로 확인합니다.

## 기록
- `out/<클립>_<화질>_<시각>.mp4` 와 같은 이름의 `.txt`(request_id, 이미지 순서, 프롬프트)
- `runs/jobs.json`: 모든 작업의 request_id·상태·견적·영상 URL (결과 URL은 7일 뒤 삭제)
- `out/`, `runs/`, `images/`, `.env`는 git에 올리지 않습니다.
