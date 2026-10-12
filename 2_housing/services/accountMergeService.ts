// v3.352 [AccountMerge] 1인 1계정 — 본인확인에서 같은 사람(DI)의 다른 계정이 발견되면 하나로 합친다(서버 routes/identity.py, 외부 연동 세션).
//   GET  /identity/merge/preview?rid=  → { accounts: MergeAccount[], blocked_reason }   (404 code merge_not_found)
//   POST /identity/merge/confirm {rid, keep_user_id} → {status:'merged', token, user} | {status:'running'} | 409 {blocked_reason} | 400 invalid_keep
//   POST /identity/merge/decline {rid} → {status:'declined'}  (409 merge_started)
//   GET  /identity/merge/status?rid=   → {status: merge_candidate|running|merged(+token,user)|declined|…}
import api from './api';

export type LoginMethod = 'google' | 'kakao' | 'naver' | 'apple' | 'email';
export type MergeBlockedReason = 'jobs_running' | 'two_crews' | 'account_restricted' | 'special_account' | null;

export interface MergeAccount {
  id: string;
  is_current: boolean;
  login_methods: LoginMethod[];
  nickname: string;
  email_masked: string | null;
  created_at: string | null;
  artists: number;
  tracks: number;
  feeds?: number;
  stars: number;
}

export interface MergePreview {
  accounts: MergeAccount[];
  blocked_reason: MergeBlockedReason;
}

export interface MergeResult {
  status: 'merged' | 'running' | 'merge_candidate' | 'declined' | string;
  token?: string;
  user?: any;
  blocked_reason?: MergeBlockedReason;
}

export async function getMergePreview(rid: string): Promise<MergePreview> {
  const res = await api.get('/identity/merge/preview', { params: { rid } });
  return res.data as MergePreview;
}

export async function confirmMerge(rid: string, keepUserId: string): Promise<MergeResult> {
  console.info('[accountMergeService] confirm', { rid: rid.slice(0, 8), keep: keepUserId.slice(0, 8) });
  const res = await api.post('/identity/merge/confirm', { rid, keep_user_id: keepUserId });
  return res.data as MergeResult;
}

export async function declineMerge(rid: string): Promise<MergeResult> {
  console.info('[accountMergeService] decline', { rid: rid.slice(0, 8) });
  const res = await api.post('/identity/merge/decline', { rid });
  return res.data as MergeResult;
}

export async function getMergeStatus(rid: string): Promise<MergeResult> {
  const res = await api.get('/identity/merge/status', { params: { rid } });
  return res.data as MergeResult;
}
