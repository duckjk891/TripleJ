// v3.230 A7-3 [StarHistory] ⭐ 내역 표시 규칙 — 순수 함수(서버 point_events.action → 한글 라벨).
// 서버 액션 전수(2026-09-25 staging orig grep): credit = signup_bonus·beta_signup_bonus·referral_joiner·
// referral_inviter·verify_bonus·guardian_consent_reward·profile_bonus·attendance·play·upload·admin_adjust,
// spend:/refund: 접두 = character·compose·lyrics·cover·cover_refine·share_video·instrumental·voice_clone·
// fatigue_skip·hire_director·extra_slot·admin_adjust. 모르는 액션은 금액 부호로 '기타 적립/사용'.

// v3.230: 서버 시각 파서는 utils/serverTime 공용(naive UTC·소수 6자리 대응) — 기존 import 경로 호환 재수출
import { parseServerTime } from './serverTime';
export { parseServerTime };

const CREDIT_LABELS: Record<string, string> = {
  signup_bonus: '가입 보너스',
  beta_signup_bonus: '베타 가입 추가',
  referral_joiner: '추천 가입',
  referral_inviter: '친구 초대',
  verify_bonus: '인증 보너스', // v3.230 A8: '본인인증' 표기 제거
  guardian_consent_reward: '보호자 동의 보너스',
  profile_bonus: '프로필 완성 보너스',
  attendance: '출석 적립',
  play: '재생 적립',
  upload: '곡 발매 적립',
  admin_adjust: '운영 조정',
};

// 사용·환불 대상(명사) — 표시 = '{명사} 사용' / '{명사} 환불'
const USE_NOUNS: Record<string, string> = {
  character: '아티스트',
  compose: '작곡',
  lyrics: '작사',
  cover: '커버',
  cover_refine: '커버 미세조정',
  share_video: '영상',
  instrumental: 'Inst',
  voice_clone: '보이스',
  fatigue_skip: '휴식 단축',
  hire_director: '디렉터 영입',
  extra_slot: '슬롯 확장',
};

export type StarHistoryKind = 'earn' | 'use' | 'refund';

export interface StarHistoryLabel {
  label: string;
  kind: StarHistoryKind;
}

export function labelForPointAction(action: string, amount: number): StarHistoryLabel {
  const a = String(action || '');
  if (a.startsWith('spend:')) {
    const k = a.slice(6);
    if (k === 'admin_adjust') return { label: '운영 조정', kind: 'use' };
    return { label: USE_NOUNS[k] ? `${USE_NOUNS[k]} 사용` : '기타 사용', kind: 'use' };
  }
  if (a.startsWith('refund:')) {
    const k = a.slice(7);
    return { label: USE_NOUNS[k] ? `${USE_NOUNS[k]} 환불` : '기타 환불', kind: 'refund' };
  }
  // 모르는 액션은 원문 키를 노출하지 않고 '기타'
  if (CREDIT_LABELS[a]) return { label: CREDIT_LABELS[a], kind: amount < 0 ? 'use' : 'earn' };
  return { label: amount < 0 ? '기타 사용' : '기타 적립', kind: amount < 0 ? 'use' : 'earn' };
}

/** 금액 표기 — 부호 포함(+50 / −15). 0 은 '0' */
export function formatStarAmount(amount: number): string {
  const n = Math.round(Number(amount) || 0);
  if (n > 0) return `+${n}`;
  if (n < 0) return `−${Math.abs(n)}`;
  return '0';
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** KST 'M월 D일 HH:MM' (올해가 아니면 'YYYY년 M월 D일 HH:MM') — 기기 시간대와 무관하게 KST 고정 */
export function formatStarTime(iso: string | null | undefined, now: Date = new Date()): string {
  const d = parseServerTime(iso);
  if (!d) return '';
  const k = new Date(d.getTime() + KST_OFFSET_MS);
  const kNow = new Date(now.getTime() + KST_OFFSET_MS);
  const hh = String(k.getUTCHours()).padStart(2, '0');
  const mm = String(k.getUTCMinutes()).padStart(2, '0');
  const md = `${k.getUTCMonth() + 1}월 ${k.getUTCDate()}일 ${hh}:${mm}`;
  return k.getUTCFullYear() === kNow.getUTCFullYear() ? md : `${k.getUTCFullYear()}년 ${md}`;
}
