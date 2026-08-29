# MAIDOL 웹 ↔ AIDOL 앱 전수 파리티 감사 (v1, 2026-08-29)

> 기준: 로컬 코드 전수 대조 (MAIDOL frontend 22페이지·39컴포넌트·API 래퍼 215개 실사용 매트릭스 / AIDOL 40스크린·43컴포넌트 엔드포인트 추출 / 백엔드 라우터 33개 교차).
> 기완료·기계획 항목(아티스트 생성·가상화·목소리·가사 보관함·커버 refine·위시리스트·캐릭터 refine·B-1·얼굴인증)은 제외.

## A. MAIDOL에 있는데 AIDOL에 없는 것

| # | 기능 | API | 난이도 | 비고 |
|---|---|---|---|---|
| 1 | MV 드래프트 에디터 전체(씬 생성→영상→합치기, 3계층 캐스케이드, user-edited 레이어, 립싱크·보컬분리·오디오병합) | /mv/* 30+개 | **대(에픽)** | AIDOL /mv 참조 0건 |
| 2 | 앨범 관리(생성·트랙 추가/정렬·커버 업로드·AI 커버) | /albums/* | 중 | 열람만 있음 |
| 3 | 디렉터 피로/쿨다운(2/4/8/12h 사다리, ⭐5·광고 스킵, 429 분기) | /fatigue/* | 중 | 별 경제 연동 |
| 4 | 생성 이력 목록·삭제·이어서 작업 + 2-variant 클립 A/B 비교 | GET·DELETE /generate/, stream?variant= | 중 | 현재 단건 폴링·1클립만 |
| 5 | 참고 음악 업로드(Suno, ≤8분) | POST /generate/upload-reference/ | **소** | **UI·store는 있는데 미배선 — 조용히 버려짐** |
| 6 | 커스텀 태그 한→영 번역 | POST /generate/translate-tags | 소 | 서버 준비됨 |
| 7 | Wondera 보컬/멜로디/참고파일 업로드 | /wondera/upload-* | 중 | generate만 존재 |
| 8 | Kits 음성 변환 + MR 피치 프리뷰/병합 | /voice-convert/*, /kits/voice-models | 중~대 | 모델 목록만 dead code |
| 9 | 비트 뷰/메트로놈(비트 시각화·재시도) | /generate·/tracks/{id}/beats | 중 | |
| 10 | 직접 음원 파일 업로드(+이미지) | POST /tracks/upload, /upload/image | 중 | 저작권 정책 판단 선행 |
| 11 | 관련곡 큐 자동 이어듣기 | GET /tracks/{id}/related | 소 | 수동 큐만 있음 |
| 12 | 검색 클릭 로깅(CTR) | POST /tracks/search/click | 소 | |
| 13 | 소명(Appeal) 플로우(블라인드 콘텐츠 목록+소명) | /reports/my-affected, /{id}/appeal | 소~중 | MyReports는 접수분만 |
| 14 | CS 오류신고 → 공식계정 DM | GET /dm/official | 소 | |
| 15 | **회원탈퇴**(확인 문구) | DELETE /auth/me | 소 | **스토어 심사 필수 요건** |
| 16 | 프로필 이미지 업로드/삭제 | /auth/me/profile-image | 소 | 표시만 있음 |
| 17 | 마케팅 동의 토글·동의 이력 | /auth/me/consents | 소 | |
| 18 | 인구통계 프로필 편집(생년월일/성별/지역)+SNS 채널 | PATCH /auth/me/profile | 소 | 현재 회사명/직함/bio만 |
| 19 | 만14세 미만 보호자 동의 | /auth/guardian-consent/* | 중 | 웹 착지 재사용안 |
| 20 | 홈 최신 앨범 섹션 | GET /albums/latest | 소 | #2와 묶음 |
| 21 | 피드 단건 딥링크 착지 | GET /feeds/{id} | 소~중 | 앱링크 설정 필요 |
| 22 | 장소(location) 선택(캐릭터 배경) | GET /character/locations | 소 | |
| 23 | 원격 프론트 로깅 | POST /_logs/frontend | 소 | 운영 관측성 |
| 24 | (보류 권장) 고객사 광고 대시보드(B2B) | /business/* | 대 | 앱 이식 비권장 |
| 25 | (보류) DM broadcast·팔로워 피커 | /dm/broadcast | - | admin 소관/설계상 대체됨 |

## B. 부분 구현 갭 (화면은 있으나 세부 결손)

1. **피드 작성기**: 다중 블록·BGM 트랙 지정·피드 수정(PUT)·공지 작성 없음 (텍스트 1블록+트랙 1개 고정)
2. **플레이어**: MV 소스가 트랙 필드 의존 — 전용 API(/tracks/{id}/music-video) 미사용, 동작 확인 필요
3. **차트**: '일간' 탭 없음
4. **음악 생성**: 실패 재시도·임시저장(draft)·프롬프트 미리보기 없음 (1-스텝 즉시 시작)
5. **설정**: 다수 항목 "준비 중" 자리표시자 — 계정 위생 계열(A-15~18)이 전부 이 화면 몫
6. **기획사 프로필**: 업로더 트랙을 닉네임 검색 매칭으로 우회 취득 — 서버 uploader 필터 부재(백엔드 개선 요청 후보)

## C. 역방향/참고

- AIDOL이 쓰는 `/notifications/*`·`/points/spend`가 로컬 backend 스냅샷엔 없음 → 서버 backend 브랜치가 앞선 것, 복구 후 openapi 재확인.
- 양쪽 다 미사용: 보컬 복원(Dolby)·AdMob 보상 이력 API·레거시 MV — 이식 불요.

## 권장 이식 순서

1. **저비용 배선 픽스 묶음(소×5)**: 참고음악 업로드(A-5) → 태그 번역(A-6) → 관련곡 이어듣기(A-11) → 검색 클릭 로깅(A-12) → 원격 로깅(A-23)
2. **계정 위생 묶음(심사 리스크)**: 회원탈퇴(A-15) → 프로필 이미지(A-16) → 마케팅 동의(A-17) → 인구통계 편집(A-18)
3. **작업실 완성**: 생성 이력+variant 비교(A-4) → 피로/쿨다운(A-3) → Wondera 보컬(A-7)
4. **신뢰·CS**: 소명(A-13) → CS 공식 DM(A-14) → 피드 딥링크(A-21)
5. **앨범 관리(A-2)+홈 최신앨범(A-20)**
6. **재미 요소**: 비트뷰(A-9), Kits 변환+MR 피치(A-8)
7. **정책 판단 후**: 직접 업로드(A-10), 보호자 동의(A-19)
8. **MV 에디터(A-1)** — 단독 에픽 별도 계획
