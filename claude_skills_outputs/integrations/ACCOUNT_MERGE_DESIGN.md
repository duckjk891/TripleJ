# 1인 1계정 — 같은 사람 계정 통합 설계 (2026-10-12)

> 대표 결정(2026-10-12):
> ① 남길 계정은 **사용자가 선택** ② 별은 **보너스 포함 전부 이관**("불편 드린 것이니까")
> ③ 끝까지 본인인증을 안 하는 사람은 **그대로 둔다** — 본인인증을 **시도해서 같은 사람 계정이 발견될 때만** 통합
> ④ 기존 회원 본인인증 유도: "본인인증하면 ⭐" 팝업(기존 verify_bonus ⭐30 재사용) + 사과 팝업 + 공지
> ⑤ 심사 메모: 영문 안내만(IOS_APPSTORE_LISTING.md 8-2 반영 완료)

## 1. 계기(언제 통합이 일어나나)

본인확인 결과 DI 해시가 **이미 다른 활성 계정에 있을 때** — 지금은 `duplicate`("그 계정으로 로그인해 주세요")로 막는다.
이를 **통합 제안**으로 바꾼다.

| 상황 | 지금 | 바뀐 뒤 |
|---|---|---|
| 기존 회원 B가 ⭐ 팝업·설정에서 본인인증 → A에 같은 DI | duplicate 오류 | 통합 화면(A·B 중 남길 계정 선택) |
| 새 소셜 가입 B가 가입 마무리 본인인증 → A에 같은 DI | duplicate 오류 | 같은 통합 화면. B에 자산이 없으면 "A로 로그인" 기본값 |
| 본인인증 안 함 | 그대로 | 그대로(강제 없음) |

본인확인 결과(DI 일치)가 곧 "같은 사람" 증명이므로 A에 다시 로그인하라고 요구하지 않는다.

## 2. 통합 화면(앱)

- 사과 문구: "초기에는 1인 1계정 정책이 없어 혼선을 드려 죄송합니다. 같은 분 명의의 계정이 있어 하나로 합쳐 드려요."
- 두 계정 카드: 로그인 방식(구글·카카오·네이버·애플·이메일) · 닉네임 · 가입일 · 아티스트 수 · 곡 수 · 별 잔액 (이메일은 마스킹)
- [이 계정을 남길게요] ×2, [내 계정이 아니에요]
- **[내 계정이 아니에요]**: 가족 휴대폰으로 인증한 경우 등. 통합하지 않고 이번 본인확인은 반영하지 않음 → "본인 명의 휴대폰으로 다시 인증하거나 고객센터로 문의해 주세요"
- 확인 단계: "남기지 않는 계정의 아티스트·곡·피드·별은 모두 옮겨지고, 그 계정의 로그인은 남기는 계정으로 연결됩니다. 되돌릴 수 없어요." [합치기]

## 3. 서버 — 옮기는 것(남기지 않는 계정 S → 남기는 계정 T)

주인 바꾸기(user_id류 필드를 S→T):
- Mongo: characters(아티스트), tracks(uploader_id·uploader_nickname), albums, feeds, track_comments, generations, gen_jobs(완료분), lyrics_assets, cover_sessions, voice_clones, voice_samples, vocal_repairs, inst_jobs, mv_jobs, character_locations, notifications, business_profiles, dm_messages(sender_id), cs_cases, issue_reports
- Postgres: playlists, likes·feed_likes·ad_wishlist(겹치면 S 쪽 삭제), follows(겹침·자기 자신 팔로우 제거), user_consents(이력 보존용 복사), reports(reporter_id)
- 별: point_balances T += S 잔액, S = 0. 이력은 S에 그대로 두고 T에 `account_merge` 이벤트 1건(track_id=S id). point_events 유일 인덱스(user·action·track·day) 충돌 회피
- 슬롯: user_slots extra_slots 합산. 아티스트 수가 슬롯 한도를 넘으면 **그대로 허용**(통합분은 예외)

겹침 처리:
- 크루(clubs.owner_id 유일): 둘 다 크루장이면 T의 크루 유지, S의 크루는 **크루장만 T로 못 옮김** → S 크루는 부크루장/가장 오래된 멤버에게 위임, 없으면 T에게(유일 인덱스 때문에 불가 시 보관 상태). club_members 겹치면 S 행 삭제
- DM(pair_key 유일): S와 T가 같은 상대와 대화 중이면 메시지를 T 대화로 합침. S↔T 사이 대화는 삭제 아님·숨김
- dm_blocks, follows 등 S↔T 상호 관계는 제거
- 출석·주간미션·튜토리얼·피로도(유일 user_id): T 기록 유지, S 기록 버림(별은 잔액으로 이미 이관)

옮기지 않는 것(통계·로그): play_logs, download_logs, analytics_events, ad_*, search_*, frontend_errors — 재생수 규칙(1계정·1곡·하루 1회)은 과거 기록 그대로 둔다.

## 4. 남기지 않는 계정(S)의 처리

- users: `account_status='merged'`, `merged_into=T`, `merged_at`. 개인정보(이메일·닉네임·프로필)는 회원탈퇴와 같은 방식으로 파기(이메일은 유일 인덱스 때문에 `merged+<id>@invalid` 치환)
- **로그인 연결**: S의 소셜(provider, provider_user_id)로 로그인하면 T로 로그인(oauth.py ①단계에서 merged → merged_into 따라감). 이메일 계정 S는 이메일로 로그인 시 "T 계정으로 합쳐졌어요" 안내 후 T로
- Sign in with Apple 리프레시 토큰은 T로 옮김(탈퇴 시 revoke 대상 유지)
- 세션: S의 세션 전부 만료 → 앱이 재로그인 → T

## 5. 안전장치

- **진행 중 작업 0건일 때만**: S·T에 gen_jobs/generations/character_jobs/inst_jobs 진행 중이면 "만들고 있는 곡이 끝난 뒤 합칠 수 있어요"
- **재개 가능한 작업 일지**: `account_merges` 컬렉션에 단계별 상태 기록 → 서버 재기동 시 이어서 완료(memory generation-restart-resume-policy)
- 어린이 계정: DI 생년월일이 정본. 보호자 동의는 T 기준으로 다시 판정(T가 만 14세 미만이고 동의 없으면 보호자 대기)
- 감사 로그: admin_logs에 통합 1건(S·T·옮긴 개수)

## 6. 개인정보처리방침

- 제2조 또는 제3조에 "1인 1계정 운영을 위한 동일인 계정 통합 시 기존 계정의 콘텐츠·포인트 이관 및 해당 계정 개인정보 파기" 문구 추가 → 다음 개정(7일 전 고지) 필요

## 7. 역할 분담(제안)

| 담당 | 내용 |
|---|---|
| 외부연동 세션(이 문서) | identity.py duplicate→merge_candidate, 서버 통합 서비스(`services/account_merge.py`)·API(`/api/identity/merge/preview`, `/merge/confirm`, `/merge/decline`), 운영 DB 사본 테스트 |
| 메인 세션 | oauth.py·auth.py 로그인 연결(merged→merged_into), 앱 통합 화면·⭐ 본인인증 유도 팝업·사과 팝업, 공지 등록 |
| 대표 | 공지 문구 승인, 처리방침 개정 게시 승인 |

## 8. 남은 확인(대표)

- **이메일 가입은 휴대폰 본인확인이 없다**(생년월일 자기 신고). 이메일로는 지금도 같은 사람이 계정을 더 만들 수 있어 1인 1계정이 완전하지 않음 → 이메일 가입에도 본인확인을 넣을지(1건당 다날 요금 발생)
