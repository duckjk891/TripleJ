// v3.230 A7-2 [RewardNotice] 가입 선물·추천 보상 안내 — 소셜 가입 콜백은 가입 여부·추천 적용 결과를
// 앱에 넘기지 않으므로(oauth.py 리다이렉트 #token 만), 로그인 직후·앱 복귀 시 GET /points/history 에서
// 아직 안내하지 않은 보상 이벤트를 찾아 앱 내 팝업(showAlert)으로 1회 알린다.
//
// 규칙(PLAN v3.230 A7-2 · 대표 결정 D8):
//  · 안내 창 72시간 — 그보다 오래된 이벤트는 안내하지 않는다(기존 회원 과거 보너스 미표시).
//  · 가입 선물(signup_bonus·beta_signup_bonus·referral_joiner)은 "가입 이벤트"(signup_bonus 또는
//    referral_joiner)가 창 안에 있을 때만 — 2026-09-24 기존 회원 베타 ⭐50 소급분만 있는 계정은 제외.
//  · 추천인: referral_inviter(친구 가입) — 건수·합계로 1회.
//  · 인증 보너스: verify_bonus·guardian_consent_reward(앱 안에서 지급 순간 안내가 없는 경로).
//  · profile_bonus 는 제외 — 지급 순간 설정 화면이 이미 "⭐10 지급 완료!" 팝업을 띄운다(중복 방지).
//  · 확인 여부 = AsyncStorage `maidol-reward-seen-v1:{uid}` 의 이벤트 키(action|created_at) 목록.
//  · 보관 추천코드(pendingReferral)나 이메일 가입 추천 시도가 있었는데 referral_joiner 가 없으면
//    "추천코드가 확인되지 않아 추천 보상은 적용되지 않았어요" 한 줄 추가.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PointEvent } from '../services/pointsHistoryService';
import { parseServerTime } from './serverTime';

export const REWARD_WINDOW_MS = 72 * 60 * 60 * 1000;
export const REWARD_SEEN_KEY_PREFIX = 'maidol-reward-seen-v1:';
const SEEN_KEEP_MS = 14 * 24 * 60 * 60 * 1000;

const SIGNUP_GROUP = ['signup_bonus', 'beta_signup_bonus', 'referral_joiner'] as const;
const SIGNUP_ANCHORS = ['signup_bonus', 'referral_joiner'];
const VERIFY_GROUP = ['verify_bonus', 'guardian_consent_reward'];

const SIGNUP_LINE_LABEL: Record<string, string> = {
  signup_bonus: '가입 보너스',
  beta_signup_bonus: '베타 가입 추가',
  referral_joiner: '추천코드 가입',
};

export interface RewardDialog {
  kind: 'signup' | 'inviter' | 'verify';
  title: string;
  message: string;
}

export interface RewardNoticePlan {
  dialogs: RewardDialog[];
  /** 이번에 안내해서 '확인됨'으로 기록할 이벤트 키 */
  markSeen: string[];
  /** 창 안의 새 가입 이벤트가 있었는지(= 보관 추천코드 소진 시점) */
  signupDetected: boolean;
  /** 가입 시 추천 보상 적용 여부(가입 감지 시에만 의미) */
  referralApplied: boolean | null;
}

export const eventKey = (e: Pick<PointEvent, 'action' | 'created_at'>) => `${e.action}|${e.created_at ?? ''}`;

// created_at 은 타임존 없는 UTC(naive) — parseServerTime 이 Z 로 해석(로컬 파싱 시 KST 9시간 오차)
const eventTime = (e: PointEvent): number => parseServerTime(e.created_at)?.getTime() ?? NaN;

const sumAmount = (list: PointEvent[]) => list.reduce((s, e) => s + (Number(e.amount) || 0), 0);

/**
 * 순수 판정 — 내역·확인 기록·추천 시도 여부로 띄울 팝업 목록을 만든다.
 * @param referralAttempted 이 기기에서 가입 전에 추천코드를 쓰려 했는지(보관 코드·이메일 가입 입력)
 */
export function buildRewardNotice(
  events: PointEvent[],
  opts: { now: number; seen: Set<string> | string[]; referralAttempted?: boolean },
): RewardNoticePlan {
  const seen = opts.seen instanceof Set ? opts.seen : new Set(opts.seen);
  const inWindow = (e: PointEvent) => {
    const t = eventTime(e);
    return Number.isFinite(t) && opts.now - t <= REWARD_WINDOW_MS && t - opts.now <= 5 * 60 * 1000;
  };
  const fresh = events.filter((e) => inWindow(e) && !seen.has(eventKey(e)));
  const dialogs: RewardDialog[] = [];
  const markSeen: string[] = [];

  // ── 가입 선물 ──
  const signupAnchor = fresh.some((e) => SIGNUP_ANCHORS.includes(e.action));
  let referralApplied: boolean | null = null;
  if (signupAnchor) {
    const lines: string[] = [];
    let total = 0;
    for (const action of SIGNUP_GROUP) {
      const hits = fresh.filter((e) => e.action === action);
      if (hits.length === 0) continue;
      const amt = sumAmount(hits);
      total += amt;
      lines.push(`· ${SIGNUP_LINE_LABEL[action]} ⭐${amt}`);
      hits.forEach((e) => markSeen.push(eventKey(e)));
    }
    // 추천 적용 여부는 창 밖 포함 전체 내역 기준(가입은 1회뿐)
    referralApplied = events.some((e) => e.action === 'referral_joiner');
    let message = `${lines.join('\n')}\n\n모두 ⭐${total}을 받았어요.`;
    if (opts.referralAttempted && !referralApplied) {
      message += '\n추천코드가 확인되지 않아 추천 보상은 적용되지 않았어요.';
    }
    dialogs.push({ kind: 'signup', title: '가입 선물이 도착했어요', message });
  }

  // ── 추천인: 친구가 내 추천코드로 가입 ──
  const inv = fresh.filter((e) => e.action === 'referral_inviter');
  if (inv.length > 0) {
    const amt = sumAmount(inv);
    dialogs.push({
      kind: 'inviter',
      title: '친구가 내 추천코드로 가입했어요',
      message: inv.length === 1
        ? `친구 초대 보상 ⭐${amt}을 받았어요.`
        : `친구 ${inv.length}명이 가입해서 친구 초대 보상 ⭐${amt}을 받았어요.`,
    });
    inv.forEach((e) => markSeen.push(eventKey(e)));
  }

  // ── 인증 보너스 ──
  const ver = fresh.filter((e) => VERIFY_GROUP.includes(e.action));
  if (ver.length > 0) {
    const amt = sumAmount(ver);
    dialogs.push({ kind: 'verify', title: '인증 보너스가 도착했어요', message: `인증 보너스 ⭐${amt}을 받았어요.` });
    ver.forEach((e) => markSeen.push(eventKey(e)));
  }

  return { dialogs, markSeen, signupDetected: signupAnchor, referralApplied };
}

// ── 확인 기록(계정별) ──────────────────────────────────────────────────────

interface SeenRecord {
  v: 1;
  firstRunAt: number;
  keys: string[];
}

/** 저장 문자열 → 확인 기록(순수). 손상·없음이면 새 기록(firstRunAt=now) */
export function parseSeenRecord(raw: string | null | undefined, now: number): { rec: SeenRecord; isFirstRun: boolean } {
  if (raw) {
    try {
      const o = JSON.parse(raw);
      if (o && Array.isArray(o.keys)) {
        return {
          rec: { v: 1, firstRunAt: typeof o.firstRunAt === 'number' ? o.firstRunAt : now, keys: o.keys.filter((k: any) => typeof k === 'string') },
          isFirstRun: false,
        };
      }
    } catch { /* 손상 — 새로 시작 */ }
  }
  return { rec: { v: 1, firstRunAt: now, keys: [] }, isFirstRun: true };
}

/** 기록 병합 + 오래된 키 정리(14일, 순수) */
export function mergeSeenRecord(rec: SeenRecord, add: string[], now: number): SeenRecord {
  const all = Array.from(new Set([...rec.keys, ...add]));
  const keep = all.filter((k) => {
    const t = parseServerTime(k.slice(k.indexOf('|') + 1))?.getTime() ?? NaN;
    return !Number.isFinite(t) || now - t <= SEEN_KEEP_MS;
  });
  return { ...rec, keys: keep };
}

export async function loadSeenRecord(userId: string, now: number) {
  try {
    const raw = await AsyncStorage.getItem(REWARD_SEEN_KEY_PREFIX + userId);
    return parseSeenRecord(raw, now);
  } catch (err: any) {
    console.error('[RewardNotice] 확인 기록 조회 실패', { message: err?.message });
    return parseSeenRecord(null, now);
  }
}

export async function saveSeenRecord(userId: string, rec: SeenRecord): Promise<void> {
  try {
    await AsyncStorage.setItem(REWARD_SEEN_KEY_PREFIX + userId, JSON.stringify(rec));
  } catch (err: any) {
    console.error('[RewardNotice] 확인 기록 저장 실패', { message: err?.message });
  }
}
