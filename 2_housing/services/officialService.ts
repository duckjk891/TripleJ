// [officialService] official 계정(GET /dm/official) 해석 — 프로세스 캐시 공유.
// FeedCard '공지' 배지(작성자=official 판별)와 설정 '공지사항' 진입이 함께 사용한다.
// /dm/official은 인증 필수 — 비로그인·네트워크 실패 시 null 반환(배지 미표시로 안전 강등).
// 성공은 영구 캐시, 실패는 캐시하지 않되 60초 스로틀로 카드 마운트마다의 재시도 폭주를 막는다.
import api from './api';

export interface OfficialContact {
  official_id: string;
  nickname?: string | null;
}

let cached: OfficialContact | null = null;
let inflight: Promise<OfficialContact | null> | null = null;
let lastFailAt = 0;
const FAIL_THROTTLE_MS = 60_000;

export function getCachedOfficial(): OfficialContact | null {
  return cached;
}

export async function fetchOfficial(): Promise<OfficialContact | null> {
  if (cached) return cached;
  if (inflight) return inflight;
  if (Date.now() - lastFailAt < FAIL_THROTTLE_MS) return null;
  inflight = api
    .get('/dm/official')
    .then(({ data }) => {
      const id = data?.official_id ? String(data.official_id) : null;
      if (!id) throw new Error('official_id missing');
      cached = { official_id: id, nickname: data?.nickname ?? null };
      return cached;
    })
    .catch((err: any) => {
      lastFailAt = Date.now();
      if (__DEV__) console.info('[officialService] official 조회 실패(강등)', { status: err?.response?.status });
      return null;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
