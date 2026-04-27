# 백엔드 로그 조회 API 사용법 (앱팀 전달용)

작성일: 2026-04-22
베이스 URL: `http://100.127.225.55:9003` (Tailscale)
인증: `X-Log-Token: <TOKEN>` 헤더 필수

> ⚠️ **토큰 관리 주의**
> - 토큰은 백엔드 `backend_9003/.env` 의 `LOG_ACCESS_TOKEN=...` 에 저장됨 (gitignore)
> - **git/공개 채널에 절대 업로드 금지**
> - 앱팀 공유는 **카톡/슬랙 DM 등 안전한 채널로만**

---

## 엔드포인트 상태

2026-04-22 16:XX ping 결과:

| 경로 | HTTP | 판정 |
|------|------|------|
| `/api/health` | 200 | 백엔드 정상 |
| `/api/_logs/tail` | 401 | **엔드포인트 존재**, 토큰 필요 |
| `/api/_logs/download` | 401 | **엔드포인트 존재**, 토큰 필요 |
| `/api/_logs/info` | 401 | **엔드포인트 존재**, 토큰 필요 |

401 = 인증 실패 (엔드포인트는 있음). 토큰만 받으면 바로 사용 가능.

---

## 사용 예시

### 1) 마지막 N줄 보기 (기본 200줄 추정)
```bash
curl -H "X-Log-Token: $LOG_TOKEN" \
  "http://100.127.225.55:9003/api/_logs/tail?lines=200"
```

### 2) 전체 로그 파일 다운로드
```bash
curl -OJ -H "X-Log-Token: $LOG_TOKEN" \
  http://100.127.225.55:9003/api/_logs/download
```
- `-O`: 서버가 지정한 파일명으로 저장
- `-J`: Content-Disposition 헤더 존중

### 3) 메타 정보 (크기/수정시각/줄수)
```bash
curl -H "X-Log-Token: $LOG_TOKEN" \
  http://100.127.225.55:9003/api/_logs/info
```

---

## 권장 로컬 세팅

`.zshrc` 또는 `.bashrc`에 (환경변수 방식, 커밋 금지):
```bash
export LOG_TOKEN="동료에게-받은-토큰-값"
alias panlog='curl -s -H "X-Log-Token: $LOG_TOKEN" "http://100.127.225.55:9003/api/_logs/tail?lines=200"'
alias panlogdl='curl -OJ -H "X-Log-Token: $LOG_TOKEN" http://100.127.225.55:9003/api/_logs/download'
alias panloginfo='curl -s -H "X-Log-Token: $LOG_TOKEN" http://100.127.225.55:9003/api/_logs/info | jq'
```

사용:
```bash
panlog        # 마지막 200줄
panloginfo    # 메타
panlogdl      # 파일 다운로드
```

---

## 디버깅 팁

- **401 응답**: `X-Log-Token` 헤더 확인. 토큰 만료/오타/공백 주의
- **403 응답**: 토큰은 맞지만 IP/권한 제약 가능성 — 동료에게 문의
- **404 응답**: 엔드포인트 경로 오타 또는 서버 재시작 필요
- **Timeout**: Tailscale 연결 상태 `tailscale status`로 점검
- **연결 실패**: `curl http://100.127.225.55:9003/api/health` 로 백엔드 자체 생존 확인

---

## 앱 내 통합 (향후)

관리자 화면에 로그 뷰어를 넣고 싶다면:
1. AsyncStorage에 토큰 저장 (관리자만 접근 가능한 Settings 서브화면)
2. `services/api.ts`에 `X-Log-Token` 헤더 자동 주입 래퍼 추가
3. `AdminLogScreen.tsx` 신설 — `/api/_logs/tail` fetch → ScrollView

**주의**: 일반 사용자 번들에 토큰이 포함되면 안 됨. 관리자 빌드 또는 런타임 입력 방식 권장.
