
---

## v151 (기록 보강)
**수정일자**: 2026-07-30 / **요청**: 동영상 탭(MV 영상·가사싱크 화면)에도 노래 탭과 동일한 "AI 생성" 뱃지 노출. **결과**: `PlayerPage.jsx` 동영상 탭의 MV·가사싱크 두 분기에 `<span className="player-page__ai-badge">AI 생성</span>` 추가(로딩/안내 화면 제외). 프론트 단독, eslint 신규에러 0.

---

## v152
**수정일자**: 2026-07-30
**요청 작업**: SNS 공유·다운로드 결과물(ffmpeg burn-in 영상)의 가사를 **한 줄씩 교체 → 브라우저판(v150)처럼 현재 줄 중앙·강조 + 스택이 부드럽게 위로 글라이드**하는 형태로 (루트 A = ASS 자막 애니메이션, 신규 의존성 0).

### Plan verification findings (0단계 코드 분석 결과)
- `backend_9005/app/services/share_video.py`:
  - `_build_ass(segments, fmt)` (:182~213): **세그먼트당 Dialogue 1개**, 스타일 `Default`, 정렬/`MarginV`/`fontsize`는 `FORMATS`(:52~68)에서. 텍스트 `\N` 개행. → 한 줄 교체의 근원.
  - `_ass_time` (:173) h:mm:ss.cs 포맷터.
  - `FORMATS`: sns(1080x1920, align2 하단, mv380, fs64) / wide(1920x1080, align2 하단, mv80, fs56) / kakao(1080x2340, align8 상단, mv600, fs60, 15s 클립).
  - `generate_share_video` (:285~): vf에 `,ass='..':fontsdir='..'`(:366) 후 워터마크(:369). 자막 시 `-r 10`, 아니면 `-r 2`(:376). `-t`로 길이 정확 컷.
  - `share_object_name` (:83): 캐시 키 `share/v3/{track_id}{suffix}.mp4`. `share_video_exists`(:216)도 동일 키 사용.
  - 워터마크(`_WATERMARK` :76)는 ass 뒤 별도 drawtext — **자막 방식 바뀌어도 불변**, 단 스크롤 자막이 워터마크 영역 침범 안 하도록 배치 주의.
  - 세그먼트 소스: `_fetch_lyric_segments`(:122, generation→recognized 폴백) — v149와 동일. **동일 세그먼트로 브라우저판과 타이밍 일치.**
- 라우트: `tracks.py` `create_share_video`/`share-video/file`(프론트 `createShareVideo`/`shareVideoFileUrl`). **API 계약 변경 없음** — 내부 렌더만 교체.
- ASS/libass 제약: `\move`는 **단일 선형 이동**만. `\t`는 `\pos`/`\move` 애니 불가(스케일·색·알파만). → 다단 스크롤은 "활성 구간별 창 방출 + 구간당 1회 `\move`"로 구성.
- 미러 규칙: 9005→9004 바이트 동일.

### 설계 (루트 A = ASS 스크롤 자막)
**핵심 알고리즘** (신규 `_build_ass_scroll(segments, fmt)` — 기존 `_build_ass`는 폴백/참조용 유지):
1. **좌표계**: `\an5`(중앙 앵커) 사용. 포맷별 **중심 Y=Cy**(현재 줄이 놓일 위치)와 **행 높이 RH**(≈ fontsize×1.6) 정의. 가시 창 `WINDOW=2`(현재 ±2 = 최대 5줄).
   - 권장 기본값(튜닝 가능): sns Cy≈1380·RH≈110, wide Cy≈760·RH≈95, kakao Cy≈820·RH≈105. **워터마크(_WATERMARK y)·자막권 침범 금지** 확인.
2. **활성 타임라인**: 활성 인덱스 a의 구간 `[T_a, T_{a+1})`, `T_a=segments[a].start`, 마지막은 `segments[last].end`(클립이면 클립끝).
3. **구간별 창 방출**: 각 구간 a에 대해 오프셋 `k∈[-WINDOW,+WINDOW]`, 줄 `j=a+k`(범위 밖 skip):
   - 목표 Y `Ycur=Cy + k*RH`. 직전 구간에서 같은 줄 j의 Y `Yprev=Cy+(k+1)*RH`.
   - Dialogue Start=`T_a`, End=`T_{a+1}`, 태그 `{\an5\move(X,Yprev,X,Ycur,0,Dms)}` (D=min(0.45s, 구간/2)) → 앞 D 동안 글라이드 후 정지. X=화면 중앙(width/2).
   - **강조/흐림**: k=0(현재) = 흰색·크게(`\fscx110\fscy110`)·불투명(`\alpha&H00&`), 진입 시 `\t(0,Dms,\fscx110\fscy110\alpha&H00&)`로 부드럽게 확대·선명. |k|=1 = `\alpha&H55&` 정도, |k|=2 = `\alpha&H90&` 더 흐림 + 약간 축소(`\fscx92\fscy92`).
   - a=0(직전 없음): 페이드 인만. 마지막 이후: 마지막 줄 중앙 유지.
4. **fps 상향**: 자막 있을 때 `-r 10 → -r 20`(글라이드 매끄러움 확보, 인코딩 시간↑는 300s 타임아웃 내). 무자막은 `-r 2` 유지.
5. **캐시 무효화**: `share_object_name` 버전 `v3 → v4` 승격(`share/v4/{id}{suffix}.mp4`). 옛 한 줄 버전 캐시 미노출. (docstring 캐시 이력도 갱신)
6. **폴백/안전**: 세그먼트 0개면 기존처럼 무자막(워터마크만). 애니 태그 조립 중 예외 시 `logger.exception` 후 `_build_ass`(한 줄) 폴백 — 영상 생성 자체는 실패시키지 않음.
7. **텍스트 이스케이프**: 기존 `{`/`}`→`(`/`)`, 개행 `\N` 처리 유지. 긴 줄 줄바꿈은 `\an5` 중앙 기준 확장(±방향) — WINDOW·RH 여유로 완화(한계로 문서화).

### 변경 매트릭스
| 파일 | 변경 | 추적자/로그 |
|---|---|---|
| `backend_9005/app/services/share_video.py` | `_build_ass_scroll` 신규(위 알고리즘), `generate_share_video`에서 자막 시 이를 사용(예외 시 `_build_ass` 폴백), 자막 `-r 20`, `share_object_name` v3→v4, docstring 갱신 | `[share-video] ass-scroll track=<id> format=<f> segments=<n> events=<m> fps=20` info, 폴백 시 `logger.exception("[share-video] ass-scroll failed ... track=<id>")` |
| `backend_9004/app/services/share_video.py` | 위 미러(바이트 동일) | 동일 |

- 프론트/DB/그 외 라우트 변경 **없음**(내부 렌더만). API 클라이언트 무변경.

### 테스트 항목 (tester)
1. **실제 mp4 생성(3포맷)**: 타임스탬프 보유 트랙(예 `6a4e145ccb67cd77e33886f7`)으로 sns/wide/kakao 생성 성공(rc=0, size>0). 캐시 경로가 `share/v4/...`인지.
2. **시각 검증**: ffmpeg로 특정 시각 프레임 추출(예 여러 시점 png)해 **여러 줄이 세로로 보이고, 현재 줄이 중앙·강조, 위/아래 흐림**인지, 시점 진행 시 위치가 위로 이동하는지 육안 확인. 한 줄만 뜨면 FAIL.
3. **워터마크 공존**: "MAIDOL · AI 생성" 워터마크가 스크롤 자막에 안 가려지고 그대로.
4. **폴백**: 세그먼트 0개 트랙 → 무자막+워터마크 정상. (가능하면) 애니 조립 예외 시 한 줄 폴백 동작.
5. **캐시 무효화**: 기존 v3 객체와 별개 v4 신규 생성 확인. 재요청 시 캐시 재사용(cached=true).
6. **회귀**: `create_share_video`/`shareVideoFileUrl` API 계약·응답 불변, 무자막 경로 불변, kakao 15s 클립·offset 보정 불변.
7. **성능**: 자막 -r 20에서 3~4분 곡 인코딩이 300s 내. 이벤트 수(N×5) 과다 트랙에서도 완료.
8. **9005/9004 diff 무차이**, `[share-video] ass-scroll` 로그 출력.
