// v3.333 [IdentityVerify] 본인확인 창 열기 → 결과 확인(공급자 무관).
//  · 네이티브: 인앱 인증 세션(openAuthSessionAsync) — 서버가 끝나면 aidol://identity-done 으로 돌려보낸다.
//  · 웹: 새 창으로 열고 결과를 3초마다 확인(최대 5분).
import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { getIdentityResult, startIdentityVerification, type IdentityResult } from '../services/identityService';

const RETURN_URL = 'aidol://identity-done';
const POLL_MS = 3000;
const POLL_MAX_MS = 5 * 60 * 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pollResult(rid: string, deadline: number): Promise<IdentityResult> {
  let last: IdentityResult = { status: 'pending', under_14: null, error: null };
  while (Date.now() < deadline) {
    try {
      last = await getIdentityResult(rid);
      if (last.status !== 'pending') return last;
    } catch (err: any) {
      console.warn('[IdentityFlow] 결과 조회 실패(재시도)', { status: err?.response?.status });
    }
    await sleep(POLL_MS);
  }
  return last;
}

/** 본인확인 실행 — 끝난 결과(또는 사용자가 닫아 pending)를 돌려준다. 시작 실패는 throw(서버 안내 문구). */
export async function runIdentityVerification(purpose: 'signup' | 'verify'): Promise<IdentityResult> {
  const isWeb = Platform.OS === 'web';
  const { request_id: rid, url } = await startIdentityVerification(purpose, isWeb ? undefined : RETURN_URL);
  console.info('[IdentityFlow] 인증 창 열기', { rid: rid.slice(0, 8), platform: Platform.OS });
  if (isWeb) {
    window.open(url, '_blank');
    return pollResult(rid, Date.now() + POLL_MAX_MS);
  }
  const r = await WebBrowser.openAuthSessionAsync(url, RETURN_URL);
  console.info('[IdentityFlow] 인증 창 닫힘', { type: r.type });
  // 돌아왔든 닫았든 서버 결과가 정본 — 짧게 확인(닫은 경우 pending 이면 그대로 반환)
  return pollResult(rid, Date.now() + (r.type === 'success' ? 15000 : 4000));
}
