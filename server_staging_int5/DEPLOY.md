# int5 — 1인 1계정 계정 통합 (2026-10-12)

변경: `app/services/account_merge.py`(신규), `app/routes/identity.py`(merge_candidate·/merge/* 4종).
스위치: `.env ACCOUNT_MERGE_ENABLED` — 없거나 false면 종전과 같음(DI 중복 = duplicate). 배포만으로는 동작 변화 없음(스키마 컬럼 추가만).
테스트: `_tests/test_int5_merge.py` 48/48 — 임시 DB(운영 스키마·인덱스 복제, 데이터 없음, `_tests/reset_dbs.sh`·`run_tests.sh`). int4 보호자 테스트 회귀 통과.
배포: md5 가드(MD5SUMS.orig) → 백업 pre_int5_* → 두 파일 복사 → 정식 재기동 절차(진행 작업 4종 0건 확인).
켜기: 처리방침 제1조·제8조 ④ 시행일 이후 + 앱 통합 화면 배포 후, 대표 승인.

## 운영 반영 (2026-10-12 10:19 UTC)
- 백업 /home/ubuntu/maidol/backups/pre_int5_20261012T101748Z, identity.py.bak_pre_int5
- 운영 md5: identity.py b0fba55a997cf80c69bd38930b1c238d, account_merge.py 83c952ef62c67205e7581fc98c4267e7
- .env 추가: IDENTITY_REQUIRED_SINCE=2026-10-12T10:18:05+00:00, ACCOUNT_MERGE_ENABLED_FROM=2026-10-19T00:00:00+09:00
- 테스트: test_int5_merge 48/48, test_int5_onboarding ALL PASS, int4 보호자 회귀 ALL PASS

## int5b 운영 반영 (2026-10-12 14:57 UTC, 대표 「배포」)
- 본인확인 성인 → age14 자동 기록(version=identity), 통합 대상 T 포함
- 백업 /home/ubuntu/maidol/backups/pre_int5b_20261012T145613Z, *.bak_pre_int5b
- 운영 md5: identity.py 9d8b36e8ee3540aa77e348e5e2e49438, account_merge.py ce2d080dc77dd759074bca3e7f5f9709
- 확인: health OK, oauth 3종 302, Traceback 0, account_merge_enabled=false(10-19 자동)
