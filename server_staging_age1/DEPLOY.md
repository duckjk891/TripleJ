# age1 — 곡·앨범 연령 등급(전체·12·15·19) + 보는 사람 나이별 노출 제한 (2026-10-12)

대표 확정(2026-10-12):
- 등급 all·12·15·19. 노출 상한: 어린이(만 13세 미만)는 all만, 그 밖의 사람(청소년·성인·비로그인·생년월일 없음)은 15까지. 미분류·분류 실패는 15로 본다.
- 19는 공개 차단이다. 만든 사람만 "연령 제한으로 비공개"로 본다. "본인확인 성인에게 19 공개" 스위치는 만들어 두되 꺼 둔다.
- 분류 입력은 곡 제목·가사·커버 이미지뿐이다(아티스트 이미지·이야기·오디오는 보내지 않음). 모델은 Claude Haiku(`claude-haiku-5-5`)다.
- 분류 시작일은 처리방침 추가 개정의 시행일이다. 공고 문안은 `claude_skills_outputs/age_rating/PRIVACY_AGE_RATING_NOTICE_DRAFT.md`이며 대표 게시 승인 대기 중이다.

## 동작 원리
- **19 차단**은 신고 블라인드와 같은 방식이다. `is_public=False`와 `age_blocked=True`를 세우고, 원래 공개 여부는 `age_prev_public`에 남긴다.
  - 그래서 기존의 "공개 곡만" 경로에서는 모두 자동으로 빠진다. 성인 쿼리는 손대지 않았다.
  - 등급이 내려가면 원래 상태로 되돌린다. 신고 블라인드인 곡은 그대로 둔다.
  - 소유자가 공개로 바꾸려 하면 403 `age_restricted`를 돌려준다.
- **어린이 필터**는 공개 곡 쿼리에 `{"age_rating": "all"}`을 덧붙인다. 어린이에게만 붙는다.
  - 대상: 차트(TOP100·HOT100·일·주·월·장르·느낌), 최신, 검색(하이브리드·정규식), 추천·다음 곡, 채널 곡·아티스트·앨범, 앨범 목록·상세, 크루 앨범, 피드에 붙은 곡(기존 '삭제된 곡' 자리표시로 대체), 좋아요, 플레이리스트.
  - 차트는 자르기(limit) 전에 거르고 별도 캐시 키(`cache:chart:ageall:*`)를 쓴다.
- **직접 접근**(상세·스트림·스트림 프록시·다운로드·가사·뮤비·박자·공유·공유영상 4종)에서 등급을 넘으면 403을 돌려준다: `{"error":"연령 제한 곡이에요.","code":"age_restricted","age_rating":"15"}`.
  - 만든 사람과 admin은 통과한다.
  - 19 차단 곡은 크루 멤버의 "미발매 곡 열람"에서도 막힌다.
- **분류**는 스위퍼(`sweep_loop`, 5분 주기) 하나가 한다.
  - 발매·수정 훅은 `kick()`으로 깨우기만 한다.
  - "미분류이거나, 분류 근거(제목·커버)가 바뀐 공개 곡(또는 19 차단 곡)"을 찾아 분류하므로, 훅이 없는 경로도 빠지지 않는다.
  - 관리자가 매긴 등급은 근거가 바뀌기 전까지 유지된다.
  - 실패하면 5분·10분·20분 간격으로 재시도하고, 3회 이후에는 하루 1회 재시도한다. 거절(refusal)도 실패로 기록하며 그동안은 15로 본다.
  - 같은 루프가 19 차단 불일치(관리자 공개 토글 등)도 바로잡는다. Redis 락이 있어 워커가 여럿이어도 한 곳에서만 돈다.
- **관리자 API**는 `/api/admin/age-ratings/*`이다: summary · items · 상세(가사) · PUT 수동 등급(관리 기록 `set_age_rating`) · reclassify · sweep.
  - 관리자 웹의 '연령 등급' 화면은 distracted-jennings 워크트리 `admin_web/src/pages/AgeRatings.jsx`에 있다.

## 스위치 (.env — config.py 무변경, os.environ 에서 읽음)
| 키 | 의미 | 처음 배포 |
|---|---|---|
| `AGE_RATING_CLASSIFY_FROM` | 분류 시작 시각(ISO8601). 비면 외부 전송 0 | **넣지 않음**(시행일 확정 후) |
| `AGE_RATING_FILTER_FROM` | 노출 제한 시작 시각. 백필 끝난 뒤로 | **넣지 않음** |
| `AGE_RATING_FILTER_ENABLED` | 명시하면 FROM 보다 우선. `false` = 킬 스위치(19 차단도 5분 안에 해제) | 넣지 않음 |
| `AGE_RATING_ADULT19_VISIBLE` | 본인확인 + 연 나이 19세 이상에게 19 공개 — 앱 등급 18+ 변경과 함께만 | 넣지 않음 |
| `AGE_RATING_MODEL` | 기본 `claude-haiku-5-5` | 넣지 않음 |

스위치를 아무것도 넣지 않으면 **종전과 동작이 같다**(테스트 A·F). 이때 스위퍼는 5분마다 빈 조회를 1~2번 할 뿐이다.

### 권장 일정 (공고 승인 후)
1. 시행일이 정해지면 .env에 두 줄을 넣는다. 예: 10-13 공고 → 10-20 시행.
   ```
   AGE_RATING_CLASSIFY_FROM=2026-10-20T03:00:00+09:00
   AGE_RATING_FILTER_FROM=2026-10-20T12:00:00+09:00
   ```
   - 분류는 심야 03시에 시작하고, 약 200곡 × 2초로 10분 안에 끝난다.
   - 그 뒤 오전에 분포·19 목록을 검토하고, 정오부터 노출 제한이 켜진다.
   - 둘 다 시각 스위치라서 **배포·재기동은 한 번**이면 된다.
2. 10-20 오전: 관리자 웹 '연령 등급'에서 분포를 보고, 19·15 목록과 미분류·실패를 검토하고, 오분류는 수동으로 수정한다.
3. 문제가 있으면 `.env AGE_RATING_FILTER_ENABLED=false`를 넣고 재기동한다(킬 스위치).

## 바뀐 파일 (운영 원본 md5 = MD5SUMS.orig, 2026-10-12 확인 시 서버와 일치)
- 신규: `app/services/age_rating.py`, `app/routes/admin_age_rating.py`
- 수정:
  - `app/main.py`: 라우터 1줄 + 스위퍼 기동/종료
  - `app/routes/tracks.py`: 목록·검색·추천·상세·스트림·다운로드·가사·뮤비·박자·공유·공유영상 가드, 소유자 재공개 차단, 발매·수정 kick
  - `app/routes/charts.py`
  - `app/routes/artists.py`
  - `app/routes/albums.py`: 목록·상세 + 소유자 재공개 차단 + kick + 직렬화에 `age_rating`·`age_blocked`
  - `app/routes/feeds.py`
  - `app/routes/likes.py`
  - `app/routes/playlists.py`: 크루 미발매 열람에서 19 제외
  - `app/routes/club_albums.py`
- 화이트리스트 직렬화(좋아요·플레이리스트·피드)에 `age_rating` 키를 추가했다. 전체 문서 직렬화(트랙·차트·앨범·채널)에는 `age_rating`·`age_blocked`·`age_rating_reasons`가 그대로 실린다.

## 테스트 (EC2 임시 컨테이너 + 임시 DB, 운영 데이터 무접촉)
- `_tests/reset_dbs.sh` → `_tests/run_tests.sh`(/tmp/agetest): 라우트 매핑 전후 비교 + `test_age1.py` **78/78 PASS**.
  - **라우트 매핑**: 기존 라우트→핸들러 매핑은 전부 그대로이고, 신규 `/api/admin/age-ratings/*` 6개만 추가된다.
  - **A. 필터 OFF**: 종전과 같다.
  - **B. 필터 ON**:
    - 성인의 TOP100·일간·장르·검색·최신·채널·앨범목록·앨범상세·추천 = 필터 OFF 때 성인 응답에서 19 곡만 뺀 것. 피드는 19 곡만 자리표시로 바뀐다.
    - 청소년·생년월일 없음·비로그인 = 성인과 같다.
    - 어린이 = 전체 등급만 보인다(차트·검색·최신·채널·추천·앨범·피드·좋아요). 본인 곡은 보인다.
  - **C. 직접 접근**: 어린이가 15·미분류 곡에, 성인·비로그인이 19 곡에 들어가면 403 `age_restricted`. 상세 캐시 히트 경로, 스트림, `?token=` 스트림 프록시, 다운로드, 가사, 뮤비, 공유 clip-info, 공유영상 파일도 마찬가지다. 만든 사람은 200과 `age_blocked`를 받는다.
  - **D. 공개 전환·관리자 수정**:
    - 소유자가 19 곡을 다시 공개하려 하면 403.
    - 관리자가 19를 15로 내리면 공개가 복원되고, 관리 기록이 남고, 차트 캐시가 비워진다.
    - 관리자가 공개 토글로 우회해도 enforce가 다시 차단한다.
    - 원래 비공개였던 19 곡은 해제돼도 비공개로 남는다.
  - **E. 스위퍼(가짜 분류기)**:
    - 시작일 전, 또는 미래 시각으로 잡혀 있으면 외부 호출이 0건이다.
    - 미분류 곡을 분류하고, 실패·거절은 기록한 뒤 재시도를 미룬다.
    - 제목이 바뀌면 재분류하고, 관리자 등급은 유지한다.
    - 새로 19가 나오면 자동 차단하고, 소유자가 제목을 고치면 해제된다.
  - **F0/F**: 시각 스위치와 킬 스위치를 확인한다(19 해제, 어린이 200).
- `_tests/test_age1_live.py`: 실제 Haiku에 **합성 가사만** 보낸다(이용자 데이터 없음). 9/9 정확, 2회 연속.
  - 전체 2, 12 2, 15 2, 19 3곡이다. 강한 욕설 1회는 15, 3회 이상 반복이면 19가 된다.
  - 곡당 약 2초, 커버 포함 입력이다.

## 배포 절차 (대표 승인 후 — 메모리 ec2-deploy-run-command)
```sh
H=maidol-ec2; R=/home/ubuntu/maidol/backend_9004; S=server_staging_age1
# 1) md5 가드 — 서버 9개 파일이 MD5SUMS.orig 와 같아야 한다(다르면 중단 → 서버본 받아 병합)
ssh $H "cd $R/app && md5sum main.py routes/{charts,tracks,artists,albums,feeds,likes,playlists,club_albums}.py"
# 2) 백업 + 복사
ssh $H "cd $R/app && for f in main.py routes/{charts,tracks,artists,albums,feeds,likes,playlists,club_albums}.py; do cp \$f \$f.bak_pre_age1; done"
scp $S/app/main.py $H:$R/app/main.py
scp $S/app/routes/{charts,tracks,artists,albums,feeds,likes,playlists,club_albums,admin_age_rating}.py $H:$R/app/routes/
scp $S/app/services/age_rating.py $H:$R/app/services/
# 3) (관리자 웹) admin_web dist → $R/app/admin_static/ (deploy_admin.sh 의 2단계만, 또는 같은 빌드에 포함)
# 4) 진행 작업 4종 0건 확인(gen_jobs·generations 30분·character_jobs·inst_jobs) → 로그 보관 → nice 빌드 → 정식 run
ssh $H "sudo docker logs maidol-app > /home/ubuntu/maidol/maidol-app_pre_age1_\$(date -u +%Y%m%dT%H%M%SZ).log 2>&1"
ssh $H "cd $R && sudo nice -n 19 docker build -q -t maidol-app:latest . && sudo docker stop -t 60 maidol-app && sudo docker rm maidol-app && sudo docker run -d --name maidol-app --network host --restart unless-stopped --env-file .env -e S3_REGION=ap-northeast-2 -v /home/ubuntu/maidol/logs:/srv/app/logs maidol-app:latest"
# 5) 확인: 헬스, 공개 경로 curl(차트·상세·검색·앨범·OAuth 시작 302), 라우트 매핑, 로그 [age] sweep 에러 없음
curl -fsS http://127.0.0.1:9006/api/health
```

## 진행 기록
- 2026-10-13 20:10 KST — 운영 tracks.py 가 v3.356(관련곡 다양화, 04:17 UTC 배포)으로 바뀌어 3-way 병합. 신규 탐색(explore) 단계에도 연령 조건을 넣었고, 관련곡의 보는 사람은 이제 로그인 세션(current_user)을 우선 쓴다. `_orig`·MD5SUMS 를 새 서버본으로 바꿨다. 병합본 테스트 78/78, 라우트 diff 는 신규 6개뿐.
- 2026-10-13 20:20 KST — 처리방침 추가 개정 게시(공고 10-13·시행 10-20). /privacy(제1조·제6조 Anthropic 행·제10조 ⑩·제12조 ③·추가 개정 안내), /privacy/2026-10-19 보관본, /news 공지. wrangler 배포 8b477b3e, 라이브 확인. 백업 homepage/privacy_index_pre_age_20261013.html.bak·news_index_pre_age_20261013.html.bak.
- 2026-10-13 20:12 KST — 대표 승인(「오늘 심야 배포」)에 따라 EC2 에서 **10-14 03:00 KST 자동 배포 예약**(`/home/ubuntu/maidol/deploy_age1/run.sh`, 로그 run.log). Mac 이 잠들어도 실행된다.
  - 단계: md5 가드 → 진행 작업 4종 0건(06시까지 5분 간격 재확인) → 백업(backups/pre_age1_<UTC>) → 파일·관리자 웹·.env 두 줄 → nice 빌드 → 정식 run → 헬스·공개 경로 점검 → 실패하면 자동 롤백(maidol-app:pre_age1).
  - 예약 취소: `ssh maidol-ec2 'pkill -f "deploy_age1/run.sh"'`
