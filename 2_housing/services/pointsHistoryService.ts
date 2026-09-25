import api from './api';

// v3.230 A7 [StarHistory]/[RewardNotice] ⭐ 적립·사용 내역 — 서버 GET /api/points/history(기존 API 재사용,
// points.py:90-110). 응답 { history: [{ action, track_id, day, amount, created_at }] } 최신순, limit 1~200.
// action 예: signup_bonus · beta_signup_bonus · referral_joiner · referral_inviter · verify_bonus · play ·
//   attendance · upload · spend:{character|compose|…} · refund:{…} · admin_adjust.

export interface PointEvent {
  action: string;
  amount: number;
  created_at: string | null;
  track_id?: string | null;
  day?: string | null;
}

export async function getPointsHistory(limit = 50): Promise<PointEvent[]> {
  const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
  if (__DEV__) console.info('[StarHistory] GET /points/history 요청', { limit: safeLimit });
  const res = await api.get('/points/history', { params: { limit: safeLimit } });
  const raw = Array.isArray(res.data?.history) ? res.data.history : [];
  const list: PointEvent[] = raw
    .filter((e: any) => e && typeof e.action === 'string')
    .map((e: any) => ({
      action: e.action,
      amount: typeof e.amount === 'number' ? e.amount : Number(e.amount) || 0,
      created_at: typeof e.created_at === 'string' ? e.created_at : null,
      track_id: e.track_id ?? null,
      day: e.day ?? null,
    }));
  if (__DEV__) console.info('[StarHistory] GET /points/history 응답', { n: list.length });
  return list;
}
