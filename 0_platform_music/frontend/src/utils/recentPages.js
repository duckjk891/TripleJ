// v188 — 오류신고 "직전 동선" 수집.
// 사용자가 신고를 넣기 직전에 어떤 화면들을 거쳤는지 관리자가 보게 하려는 목적.
// 신고 모달의 page_url(제출 순간 1개)만으로는 "어디서 문제가 시작됐는지"를 알 수 없다.
//
// 보관 정책 (PLAN v188 §1-2 확정):
//  - sessionStorage 링버퍼 **최대 5개, 최신순**(index 0 = 가장 최근 방문).
//    탭 단위 스코프라 탭을 닫으면 소멸한다. 오류 후 새로고침해도 동선이 남는 것이 이 기능의 핵심 가치라
//    메모리 변수가 아닌 sessionStorage 를 쓴다.
//  - path 는 **maskSensitiveUrl(v185) 통과 후** 저장 — 토큰·API 키 등 민감 쿼리는 쌍째로 제거된다.
//    원문 쿼리를 그대로 보관하는 경로는 만들지 않는다.
//  - 길이 200자 절단.
//  - sessionStorage 비활성(사파리 프라이빗 등)·용량 초과·JSON 파손은 전부 try/catch 로 흡수한다.
//    수집 실패는 "직전 동선 없이 접수"로 기능 저하만 남기고, 절대 화면을 깨뜨리지 않는다.
//
// 로그 prefix `[RecentPages]` — 경로 원문은 콘솔에 출력하지 않는다(개수만).

import { maskSensitiveUrl } from './remoteLogger';

const STORAGE_KEY = 'maidol_recent_pages';
const MAX_ENTRIES = 5;
const MAX_PATH_LEN = 200;

// 저장분 읽기 — 손상·타입 불일치 항목은 조용히 버린다(방어적 파싱).
function readEntries() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e) => e && typeof e.path === 'string' && e.path && typeof e.at === 'string' && e.at
    );
  } catch {
    return []; // 비활성 스토리지·JSON 파손 — 빈 이력으로 취급
  }
}

/**
 * 방문 경로 1건 기록 (라우트 이동 시 호출).
 * @param {string} path pathname + search (호스트 없는 상대 경로)
 */
export function recordPage(path) {
  try {
    const masked = maskSensitiveUrl(typeof path === 'string' ? path : '');
    if (!masked) return;
    const clipped = masked.slice(0, MAX_PATH_LEN);
    const at = new Date().toISOString();
    const list = readEntries();
    if (list[0] && list[0].path === clipped) {
      // 연속 중복(같은 경로 재진입·리렌더)은 새 항목을 쌓지 않고 시각만 갱신 —
      // 버퍼 5칸이 같은 경로로 채워져 실제 동선이 밀려나는 것을 막는다.
      list[0] = { path: clipped, at };
    } else {
      list.unshift({ path: clipped, at });
    }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_ENTRIES)));
  } catch {
    /* noop — 수집 실패는 무시(기능 저하만, throw 절대 금지) */
  }
}

/**
 * 신고 접수 body 에 동봉할 직전 동선.
 * @returns {Array<{path: string, at: string}>} 최신순 최대 5개. 실패·부재 시 빈 배열(절대 throw 하지 않음).
 */
export function getRecentPages() {
  return readEntries()
    .slice(0, MAX_ENTRIES)
    .map((e) => ({ path: e.path.slice(0, MAX_PATH_LEN), at: e.at }));
}
