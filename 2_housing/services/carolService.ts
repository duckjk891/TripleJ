import api from './api';

// v3.438 [Carol] 크리스마스 캐롤 크루 이벤트(대표 11-24) — 서버 /api/carol/*.
// 기간·확률·자격·금액은 전부 서버 값(앱 하드코딩 금지). 이벤트가 꺼져 있거나 옛 서버(404)면 아무것도 보이지 않는다.

export interface CarolSubmission {
  id: string;
  track_id: string;
  title: string | null;
  status: 'pending' | 'approved' | 'rejected';
  reason: string | null;
  /** ready=돌릴 수 있음 · spun=돌림 · fixed=어린이 고정 지급 */
  spin: 'ready' | 'spun' | 'fixed' | null;
  amount: number | null;
}

export interface CarolStatus {
  active: boolean;
  submit_open: boolean;
  title: string;
  submit_until: string;
  spin_until: string;
  wheel: { amount: number; percent: number }[];
  daily_limit: number;
  min_seconds: number;
  child_reward: number;
  club: { id: string; name: string; member_count: number } | null;
  submissions: CarolSubmission[];
  eligible: any[];
  ready: number;
  child?: boolean;
  identity_ok?: boolean;
}

export async function getCarolStatus(): Promise<CarolStatus> {
  const { data } = await api.get('/carol/status');
  return data;
}

export async function submitCarol(trackId: string): Promise<void> {
  console.info('[Carol] 신청', { track: trackId.slice(0, 8) });
  await api.post('/carol/submissions', { track_id: trackId });
}

export async function cancelCarol(id: string): Promise<void> {
  console.info('[Carol] 신청 취소', { id: id.slice(0, 8) });
  await api.delete(`/carol/submissions/${id}`);
}

export async function spinCarol(id: string): Promise<{ amount: number; balance: number }> {
  console.info('[Carol] 스타 스톱', { id: id.slice(0, 8) });
  const { data } = await api.post(`/carol/submissions/${id}/spin`);
  return data;
}

export const carolErrorCode = (err: any): string => String(err?.response?.data?.code ?? '');
export const carolErrorMessage = (err: any): string =>
  typeof err?.response?.data?.error === 'string' ? err.response.data.error : '잠시 후 다시 시도해 주세요.';
