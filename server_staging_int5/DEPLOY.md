# int5 — 1인 1계정 계정 통합 (2026-10-12)

변경: `app/services/account_merge.py`(신규), `app/routes/identity.py`(merge_candidate·/merge/* 4종).
스위치: `.env ACCOUNT_MERGE_ENABLED` — 없거나 false면 종전과 같음(DI 중복 = duplicate). 배포만으로는 동작 변화 없음(스키마 컬럼 추가만).
테스트: `_tests/test_int5_merge.py` 48/48 — 임시 DB(운영 스키마·인덱스 복제, 데이터 없음, `_tests/reset_dbs.sh`·`run_tests.sh`). int4 보호자 테스트 회귀 통과.
배포: md5 가드(MD5SUMS.orig) → 백업 pre_int5_* → 두 파일 복사 → 정식 재기동 절차(진행 작업 4종 0건 확인).
켜기: 처리방침 제1조·제8조 ④ 시행일 이후 + 앱 통합 화면 배포 후, 대표 승인.
