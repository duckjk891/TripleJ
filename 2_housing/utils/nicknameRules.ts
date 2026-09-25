// v3.230 A2 [NicknameChange] 닉네임 규칙·응답 해석 — 순수 함수 모듈(I/O 없음, Node 하네스 검증 대상).
// 규칙(대표 결정 D3, 서버 S1 routes/auth.py _normalize_nickname 과 동일 기준 — 최종 판정은 서버):
//   · NFC 정규화 → 연속 공백 1칸 → 앞뒤 공백 제거 후 2~15자(코드포인트 기준)
//   · 제어·서식(제로폭 등)·사용자 정의 영역 문자 금지
//   · 예약어 차단(공식 계정명 + 탈퇴 표기·운영 사칭 — 공백 제거·대소문자 무시 완전일치)
//   · 중복 금지(대소문자·공백 무시)는 서버만 판정(409 nickname_taken) — 앱은 표시만
//   · 변경 간격 제한 없음
// 닉네임 원문은 로그 금지 — 호출부는 길이만 기록한다.

export const NICKNAME_MIN_LEN = 2;
export const NICKNAME_MAX_LEN = 15;

// 서버 settings.official_account_nickname(maidol_official) + _NICK_EXTRA_RESERVED 와 동일 목록
const RESERVED = ['maidol_official', '탈퇴한사용자', 'MAIDOL', 'MAIDOL공식', '관리자', '운영자', 'admin'];
// 서버 _reserved_key 와 동일: NFKC → 공백류·'_'·'.'·'-' 제거 → 소문자(예: "maidol official"·"MAIDOL-공식" 차단)
const reservedKey = (v: string) => {
  let t = v || '';
  try { t = t.normalize('NFKC'); } catch { /* 미지원 런타임 — 원문 */ }
  return t.replace(/[\s_.\-]+/g, '').toLowerCase();
};
const RESERVED_KEYS = new Set(RESERVED.map(reservedKey));

// 사용 불가(서버 _NICK_BAD_CATEGORIES = Cs·Co): 사용자 정의 영역(BMP·보조 평면) — 정리 후에도 남으면 'chars'
const PRIVATE_USE_RE = /[\uE000-\uF8FF]|[\u{F0000}-\u{FFFFD}]|[\u{100000}-\u{10FFFD}]/u;
// 짝 없는 서로게이트(Cs) — u 플래그 없이 코드 유닛 단위 검사
const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/;

export type NicknameInvalidReason = 'empty' | 'length' | 'chars' | 'reserved' | 'same';

export const NICKNAME_MESSAGES: Record<NicknameInvalidReason, string> = {
  empty: '닉네임을 입력해주세요.',
  length: `닉네임은 ${NICKNAME_MIN_LEN}~${NICKNAME_MAX_LEN}자로 입력해주세요.`,
  chars: '닉네임에 사용할 수 없는 문자가 있어요.',
  reserved: '사용할 수 없는 닉네임이에요.',
  same: '지금 쓰는 닉네임과 같아요.',
};

/** 입력칸 안내(닉네임 변경 모달·가입 폼 공통) */
export const NICKNAME_GUIDE = `${NICKNAME_MIN_LEN}~${NICKNAME_MAX_LEN}자로 입력해주세요. 다른 사람이 쓰는 닉네임은 쓸 수 없어요.`;

export const NICKNAME_TAKEN_MESSAGE = '이미 쓰는 닉네임이에요. 다른 닉네임을 입력해주세요.';
export const NICKNAME_UNSUPPORTED_MESSAGE = '닉네임 변경은 아직 준비 중이에요. 서버 업데이트 후 다시 시도해주세요.';

// v3.230 서버 S1 _clean_nickname(new/routes/auth.py:139)과 같은 정리 — Hermes 호환 위해 \p{} 대신 명시 범위.
//  ① NFC ② 공백류 → 1칸(파이썬 str \s 기준: \x1c-\x1f·\x85 포함, BOM 제외) ③ 제어(Cc)·서식(Cf) 전부 +
//  한글 채움(U+115F·U+1160·U+3164·U+FFA0)·점자 공백(U+2800) 제거 ④ 다시 공백 1칸·trim.
const PY_WS = '\\t\\n\\v\\f\\r \\u001C-\\u001F\\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000';
const WS_RE = new RegExp(`[${PY_WS}]+`, 'g');
// Cc(탭 등 공백류는 ②에서 이미 1칸) + Cf(Unicode 15 전수) + 채움·점자 공백
const REMOVE_RE = /[\u0000-\u001F\u007F-\u009F\u00AD\u0600-\u0605\u061C\u06DD\u070F\u0890\u0891\u08E2\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB\u115F\u1160\u3164\uFFA0\u2800]|[\u{110BD}\u{110CD}\u{13430}-\u{1343F}\u{1BCA0}-\u{1BCA3}\u{1D173}-\u{1D17A}\u{E0001}\u{E0020}-\u{E007F}]/gu;

/** 입력 정리 — 서버 _clean_nickname 과 같은 결과(저장값·중복 비교 기준) */
export function normalizeNickname(raw: string | null | undefined): string {
  let v = typeof raw === 'string' ? raw : '';
  try { v = v.normalize('NFC'); } catch { /* normalize 미지원 런타임 — 원문 유지 */ }
  v = v.replace(WS_RE, ' ');
  v = v.replace(REMOVE_RE, '');
  return v.replace(WS_RE, ' ').trim();
}

/** 코드포인트 기준 글자 수(서버 len() 과 동일 — 이모지·서로게이트 쌍 1자) */
export function nicknameLength(v: string): number {
  return Array.from(v).length;
}

/** 대소문자·공백 무시 비교 키(같은 닉네임 판정용 — 서버 중복 판정과 동일 방향) */
export function nicknameCompareKey(v: string | null | undefined): string {
  return normalizeNickname(v).toLowerCase();
}

export type NicknameCheck =
  | { ok: true; value: string }
  | { ok: false; reason: NicknameInvalidReason; message: string };

/** 입력 검증 — 통과면 서버로 보낼 정규화 값 반환. current 와 같으면 'same'(요청 불필요) */
export function validateNickname(raw: string | null | undefined, current?: string | null): NicknameCheck {
  const v = normalizeNickname(raw);
  const fail = (reason: NicknameInvalidReason): NicknameCheck => ({ ok: false, reason, message: NICKNAME_MESSAGES[reason] });
  // 현재 본인 닉네임과 같으면(정리 후) 규칙 검사 없이 무요청 — 대소문자만 바꾸는 변경은 허용
  if (current != null && v && normalizeNickname(current) === v) return fail('same');
  // 서버 400 판정 순서와 동일: empty → chars → length → reserved
  if (!v) return fail('empty');
  if (PRIVATE_USE_RE.test(v) || LONE_SURROGATE_RE.test(v)) return fail('chars');
  const len = nicknameLength(v);
  if (len < NICKNAME_MIN_LEN || len > NICKNAME_MAX_LEN) return fail('length');
  if (RESERVED_KEYS.has(reservedKey(v))) return fail('reserved');
  return { ok: true, value: v };
}

export type NicknameResultCode = 'ok' | 'taken' | 'invalid' | 'unsupported' | 'auth' | 'network' | 'error';

export interface NicknameResult {
  code: NicknameResultCode;
  message: string;
  /** code==='ok' 일 때 서버 저장 닉네임 */
  nickname?: string;
  /** 서버 S1 응답 요약(tracks/feeds/comments 건수) — 없으면 undefined(구서버·미전파) */
  synced?: Record<string, number>;
}

/** PATCH /auth/me/profile {nickname} 성공(2xx) 응답 해석 — 구서버는 nickname 필드를 무시하므로
 *  응답의 nickname 이 요청값으로 바뀌지 않았으면 '아직 지원되지 않음'으로 본다. */
/** v3.230c 가입 닉네임 사전 검사(이메일·보호자 가입 공통) — 변경과 같은 규칙(정리 → empty/chars/length/reserved).
 *  통과 시 value(정리값)를 서버로 보낸다. 중복은 가입 시 서버만 판정. */
export function checkSignupNickname(raw: string | null | undefined): NicknameCheck {
  return validateNickname(raw);
}

/** 서버 오류 본문 → 사용자 문구. error 가 코드(nickname_invalid 등)면 message 우선, 아니면 error·detail 문장.
 *  '본인인증' 유도 문장은 노출하지 않는다(v3.230 A8). */
export function pickServerErrorMessage(data: any, fallback: string): string {
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : '');
  const err = str(data?.error);
  const isCode = !!err && /^[a-z0-9_]+$/.test(err);
  const text = (isCode ? str(data?.message) : '') || (!isCode ? err : '') || str(data?.message) || str(data?.detail);
  if (!text || /본인\s*인증/.test(text)) return fallback;
  return text;
}

export function interpretNicknameSuccess(requested: string, data: any): NicknameResult {
  const body = data?.user ?? data ?? {};
  const got = typeof body?.nickname === 'string' ? normalizeNickname(body.nickname) : '';
  const rawSynced = data?.nickname_synced ?? body?.nickname_synced;
  // nickname_synced 키가 있으면 신서버(S1) 확정 — 서버가 돌려준 저장값을 성공으로 채택(정리 결과가 요청값과 달라도)
  const s1Confirmed = rawSynced !== undefined;
  if (!got || (!s1Confirmed && got !== normalizeNickname(requested))) {
    return { code: 'unsupported', message: NICKNAME_UNSUPPORTED_MESSAGE };
  }
  let synced: Record<string, number> | undefined;
  if (rawSynced && typeof rawSynced === 'object') {
    synced = {};
    for (const [k, n] of Object.entries(rawSynced)) if (typeof n === 'number') synced[k] = n;
  }
  return { code: 'ok', message: '', nickname: got, synced };
}

/** PATCH 실패(에러) 해석 — status·응답 본문 기준. 서버 메시지는 짧은 문자열일 때만 그대로 노출 */
export function interpretNicknameError(status: number | undefined, data: any): NicknameResult {
  const serverMsg = typeof data?.message === 'string' && data.message.trim() && data.message.length <= 80
    ? data.message.trim()
    : null;
  if (status === 409 || data?.error === 'nickname_taken') {
    return { code: 'taken', message: NICKNAME_TAKEN_MESSAGE };
  }
  if (status === 400 && data?.error === 'nickname_invalid') {
    const reason = data?.reason as NicknameInvalidReason | undefined;
    const mapped = reason && reason in NICKNAME_MESSAGES ? NICKNAME_MESSAGES[reason] : null;
    return { code: 'invalid', message: serverMsg || mapped || NICKNAME_MESSAGES.empty };
  }
  // 구서버: nickname 을 무시해 "변경할 필드가 없습니다."(400 detail, error 키 없음)가 온다.
  // 422(스키마 선검증 — 앱 로컬 검증을 통과했다면 오지 않음)는 아래 일반 실패로 둔다(TESTPLAN NK-U2).
  if (status === 400) {
    return { code: 'unsupported', message: NICKNAME_UNSUPPORTED_MESSAGE };
  }
  if (status === 401) {
    return { code: 'auth', message: '로그인이 만료됐어요. 다시 로그인한 뒤 시도해주세요.' };
  }
  if (!status) {
    return { code: 'network', message: '네트워크 연결을 확인한 뒤 다시 시도해주세요.' };
  }
  return { code: 'error', message: '닉네임을 바꾸지 못했어요. 잠시 후 다시 시도해주세요.' };
}

/** 로컬 재생 큐·보관함의 곡 스냅샷에서 내 곡의 표시 닉네임을 새 값으로 치환(순수).
 *  대상: uploader_id 가 나인 곡의 uploader_nickname, 그리고 옛 닉네임이 그대로 들어간
 *  agency_name·artist_name(서버 직렬화 폴백 값). 바뀐 것이 없으면 같은 객체를 돌려준다. */
export function renameUploaderInTrack<T = any>(t: T, userId: string, oldNick: string, newNick: string): T {
  const tr: any = t;
  if (!tr || typeof tr !== 'object' || !userId) return t;
  if (String(tr.uploader_id ?? '') !== String(userId)) return t;
  const patch: Record<string, string> = {};
  if (typeof tr.uploader_nickname === 'string' && tr.uploader_nickname !== newNick) patch.uploader_nickname = newNick;
  if (oldNick && tr.agency_name === oldNick) patch.agency_name = newNick;
  if (oldNick && tr.artist_name === oldNick) patch.artist_name = newNick;
  return Object.keys(patch).length ? ({ ...tr, ...patch } as T) : t;
}
