/**
 * [issueReport] v3.285: 문의하기(오류 신고) 순수 로직 — 사유 코드·본문 검증·POST /api/issues 페이로드.
 *
 * 서버(issues.py) 계약: reason ∈ ISSUE_REASONS 5종, text 1~2000자, page_url ≤500,
 * app_version ≤40, recent_pages [{path, at}] ≤5. 라벨→코드 매핑은 프론트 소관(이 파일).
 * UI/네트워크 의존 없음 — Node 하네스로 테스트(components/settings/IssueReportModal 이 사용).
 */
import type { RecentPage } from './routeHistory';

export type IssueReasonCode = 'playback' | 'payment' | 'account' | 'auth' | 'other';

export const ISSUE_REASONS: ReadonlyArray<{ code: IssueReasonCode; label: string }> = [
  { code: 'playback', label: '재생 오류' },
  { code: 'payment', label: '결제·별 오류' },
  { code: 'account', label: '계정 문제' },
  { code: 'auth', label: '로그인·계정 인증 문제' },
  { code: 'other', label: '기타' },
];

export const ISSUE_TEXT_MAX = 2000; // 서버 MAX_ISSUE_TEXT_LEN
const PAGE_URL_MAX = 500; // 서버 MAX_PAGE_URL_LEN
const APP_VERSION_MAX = 40; // 서버 MAX_APP_VERSION_LEN

export type IssuePayload = {
  reason: IssueReasonCode;
  text: string;
  page_url?: string;
  app_version?: string;
  recent_pages?: RecentPage[];
};

/** 본문 정규화 — 앞뒤 공백 제거 후 상한 절단. 빈 문자열이면 접수 불가(호출부가 버튼 비활성) */
export function normalizeIssueText(raw: string): string {
  return (raw || '').trim().slice(0, ISSUE_TEXT_MAX);
}

/**
 * 페이로드 조립 — 환경값(버전·화면·동선)은 호출부가 주입(expo-constants/Platform 의존 분리).
 * 비어 있는 선택 필드는 키 자체를 생략한다(구서버 호환·서버 None 처리와 동일).
 */
export function buildIssuePayload(input: {
  reason: IssueReasonCode;
  text: string;
  appVersion?: string | null;
  platform?: string | null;
  pageUrl?: string | null;
  recentPages?: RecentPage[] | null;
}): IssuePayload {
  const payload: IssuePayload = { reason: input.reason, text: normalizeIssueText(input.text) };
  const version = (input.appVersion || '').trim();
  if (version) {
    // "1.3.1 (web)" — 관리자가 플랫폼을 한눈에(UA 는 서버가 별도 캡처)
    const tagged = input.platform ? `${version} (${input.platform})` : version;
    payload.app_version = tagged.slice(0, APP_VERSION_MAX);
  }
  const page = (input.pageUrl || '').trim();
  if (page) payload.page_url = page.slice(0, PAGE_URL_MAX);
  if (input.recentPages && input.recentPages.length > 0) {
    payload.recent_pages = input.recentPages.slice(0, 5).map((p) => ({ path: p.path, at: p.at }));
  }
  return payload;
}

/** 접수 실패 안내 문구 — 상태코드별(서버 400 메시지는 그대로 노출) */
export function issueErrorMessage(status: number | undefined, serverMessage?: string | null): string {
  if (status === 401) return '로그인이 만료되었어요. 다시 로그인한 뒤 접수해주세요.';
  if (status === 400) return serverMessage || '입력 내용을 확인해주세요.';
  if (status === 404) return '아직 준비 중인 기능이에요. 잠시 후 다시 시도해주세요.';
  return '접수에 실패했습니다. 네트워크 상태를 확인하고 잠시 후 다시 시도해주세요.';
}
