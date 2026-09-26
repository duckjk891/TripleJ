// [ShareCompose] v3.237 곡 공유 문구 — 순수 함수(화면·서비스·Node 하네스 공용, RN 의존 없음).
//  · 안 순서 orderTemplates / 치환 renderTemplate / 글자 수 countChars / 최종 조립 assembleShareMessage /
//    공유 ID newShareId / 수정 판정 isEdited / 받는 사람 교체 replaceRecipient / 로컬 폴백 buildLocalShareData.
//  · 메시지 구조(요청서 §3): 편집 영역(①상황·공감 ②「{곡명}」 - {아티스트} ③소개) + 고정 영역(④혜택 ⑤링크).
//    최종 = 본문 + (빈 줄 없이) ④ + ⑤. 본문이 비면 머리줄(②) 한 줄.
import {
  SHARE_BENEFIT_FALLBACK,
  SHARE_MESSAGES_DEFAULT,
  ShareLimits,
  ShareMessageConfig,
  ShareTemplateConfig,
  ShareTemplateKind,
} from '../constants/shareMessages';

export type ShareAudience = 'own' | 'other';
export type ShareThemeSource = 'override' | 'auto' | 'default';

/** 화면이 쓰는 안(audience 해석 완료 — body 는 내 곡/남의 곡에 맞는 원문, 치환 전) */
export interface ShareTemplate {
  id: string;
  theme: string;
  kind: ShareTemplateKind;
  emoji?: string;
  label: string;
  order: number;
  enabled: boolean;
  body: string;
}

/** GET /api/share/track/{id} 응답(정규화 후) — 폴백도 같은 모양 */
export interface ShareData {
  track: { id: string; title: string; artist_name: string };
  audience: ShareAudience;
  theme: { key: string; name: string; source: ShareThemeSource };
  templates: ShareTemplate[];
  benefit: { text: string } | null;
  link: string;
  limits: ShareLimits;
  recipient_default: string;
  config_version: number;
}

export const DEFAULT_THEME = 'default';
const TITLE_FALLBACK = '제목 없는 곡';
const SHARE_ID_RE = /^[0-9a-z]{8}$/;

/** 한 줄 정리 — 줄바꿈·연속 공백을 공백 1칸으로(문구 줄 구조 보호) */
export function oneLine(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
}

/**
 * 글자 수(D11) — 코드포인트 수 − ZWJ(U+200D)·변이 선택자(U+FE0E/FE0F).
 * 조합 이모지 과대 계산 완화(Hermes 는 Intl.Segmenter 미지원). 예: U+1F431=1, U+1F62E ZWJ U+1F4A8=2, "가a"=2.
 */
export function countChars(s: string): number {
  if (!s) return 0;
  let n = 0;
  for (const ch of s) {
    if (ch === '‍' || ch === '︎' || ch === '️') continue;
    n++;
  }
  return n;
}

/** 코드포인트 기준 자르기(서로게이트 쌍 보존). ZWJ·변이 선택자는 길이에 넣지 않는다. */
function sliceChars(s: string, max: number): string {
  let n = 0;
  let out = '';
  for (const ch of s) {
    const zero = ch === '‍' || ch === '︎' || ch === '️';
    if (!zero) {
      if (n >= max) break;
      n++;
    }
    out += ch;
  }
  // 끝에 매달린 ZWJ(다음 조각이 잘린 조합 이모지) 제거
  return out.replace(/‍+$/, '');
}

/** 공유 문구용 곡명 — 한 줄 + head_title(40)자 초과 시 말줄임(원 제목 불변, D11) */
export function shareTitle(title: unknown, maxLen = 40): string {
  const t = oneLine(title) || TITLE_FALLBACK;
  return countChars(t) > maxLen ? `${sliceChars(t, maxLen)}…` : t;
}

/** 공유 문구용 아티스트 — 한 줄 + 20자 초과 시 말줄임(오케스트레이터 판정 5) */
export const SHARE_ARTIST_MAX = 20;
export function shareArtist(artist: unknown, maxLen = SHARE_ARTIST_MAX): string {
  const a = oneLine(artist);
  return countChars(a) > maxLen ? `${sliceChars(a, maxLen)}…` : a;
}

/** 머리줄(②) — 아티스트 없으면 「곡명」 만 */
export function headLine(title: unknown, artist: unknown, maxTitle = 40): string {
  const t = shareTitle(title, maxTitle);
  const a = shareArtist(artist);
  return a ? `「${t}」 - ${a}` : `「${t}」`;
}

/** 받는 사람 — trim·줄바꿈 제거·최대 20자, 비면 기본값('소중한 당신') */
export function normalizeRecipient(raw: unknown, fallback = '소중한 당신', max = 20): string {
  const v = oneLine(raw);
  if (!v) return fallback;
  return sliceChars(v, max).trim() || fallback;
}

export interface RenderVars {
  title: string;
  artist?: string;
  themeName?: string;
  recipient?: string;
  link?: string;
  maxTitle?: number;
}

const VAR_RE = /\{(곡명|아티스트|링크|theme|받는 사람)\}/g;

/**
 * 템플릿 치환(순수). {곡명}(40자 말줄임)·{아티스트}(20자 말줄임, 없으면 머리줄 → 「{곡명}」)·{theme}·{받는 사람}·{링크}.
 * 모르는 {…} 는 원문 유지.
 */
export function renderTemplate(body: string, vars: RenderVars): string {
  const title = shareTitle(vars.title, vars.maxTitle ?? 40);
  const artist = shareArtist(vars.artist);
  let src = String(body || '');
  if (!artist) {
    // 머리줄의 ' - {아티스트}' 를 통째로 제거(「곡명」 만 남김) — 그 외 위치의 {아티스트} 는 빈 값
    src = src.replace(/」\s*-\s*\{아티스트\}/g, '」');
  }
  const map: Record<string, string> = {
    곡명: title,
    아티스트: artist,
    링크: vars.link || '',
    theme: vars.themeName || '',
    '받는 사람': vars.recipient || '',
  };
  return src.replace(VAR_RE, (_m, k: string) => map[k]);
}

/** 수정 판정 — 현재 본문이 선택 안의 렌더값과 다르면 수정됨 */
export function isEdited(body: string, rendered: string): boolean {
  return body !== rendered;
}

/** 받는 사람 치환 최소 길이 — 이전 이름이 이보다 짧으면 치환 중단(짧은 이름이 본문 다른 단어까지 바꾸는 오치환 방지) */
export const RECIPIENT_REPLACE_MIN = 2;

/**
 * 수정된 본문의 받는 사람 교체(D6·오케스트레이터 판정) — 이전 이름 문자열 전체 일치를 새 이름으로 일괄 치환.
 * 이전 이름이 2자 미만·본문에 없음·같은 이름이면 본문 그대로. split/join 이라 `$&` 등 특수 패턴도 문자 그대로.
 */
export function replaceRecipient(body: string, prevName: string, nextName: string): string {
  if (!prevName || countChars(prevName) < RECIPIENT_REPLACE_MIN || prevName === nextName || !body.includes(prevName)) return body;
  return body.split(prevName).join(nextName);
}

/**
 * 안 순서(요청서 §4) — enabled 만.
 *  테마 ≠ default(테마 안 있음): [테마 안들(order)] → 바치는 노래 → default 첫 안
 *  테마 = default(또는 테마 안 없음): [default 안들(order)] → 바치는 노래
 */
export function orderTemplates<T extends { id: string; theme: string; kind: string; order: number; enabled?: boolean }>(
  templates: T[],
  themeKey: string,
): T[] {
  const live = (templates || []).filter((t) => t && t.enabled !== false);
  const byOrder = (a: T, b: T) => (a.order ?? 0) - (b.order ?? 0);
  const dedication = live.filter((t) => t.kind === 'dedication').sort(byOrder);
  const normal = live.filter((t) => t.kind !== 'dedication');
  const defaults = normal.filter((t) => t.theme === DEFAULT_THEME).sort(byOrder);
  const themed = themeKey && themeKey !== DEFAULT_THEME ? normal.filter((t) => t.theme === themeKey).sort(byOrder) : [];
  if (themed.length) return [...themed, ...dedication, ...defaults.slice(0, 1)];
  return [...defaults, ...dedication];
}

/** 칩 표기 — emoji + label(D4 변경: 서버 설정 emoji/label 사용). label 이 이미 emoji 로 시작하면 중복 없이 label 만 */
export function chipLabel(t: { emoji?: string; label: string }): string {
  const label = String(t.label || '').trim();
  const emoji = String(t.emoji || '').trim();
  if (!emoji || label.startsWith(emoji)) return label;
  return `${emoji} ${label}`;
}

/** 공유 ID — 8자 base36(D10). rand 주입은 테스트용 */
export function newShareId(rand: () => number = Math.random): string {
  const A = '0123456789abcdefghijklmnopqrstuvwxyz';
  let s = '';
  for (let i = 0; i < 8; i++) s += A[Math.min(35, Math.floor(rand() * 36))];
  return s;
}

export function isShareId(v: unknown): v is string {
  return typeof v === 'string' && SHARE_ID_RE.test(v);
}

/** 링크 + ?s=공유ID(D10) — 형식이 틀린 ID 는 붙이지 않는다 */
export function shareLinkWithId(link: string, shareId?: string | null): string {
  if (!isShareId(shareId)) return link;
  return `${link}${link.includes('?') ? '&' : '?'}s=${shareId}`;
}

export interface AssembleInput {
  body: string;
  head: string;
  benefit?: string | null;
  link: string;
  shareId?: string | null;
}

export interface AssembledShare {
  /** 본문 + 혜택(링크 제외) — iOS·웹 message */
  text: string;
  /** 링크(?s= 포함) — iOS·웹 url */
  url: string;
  /** text + '\n' + url — 안드로이드 message·클립보드 */
  full: string;
  /** 최종 본문(빈 본문이면 머리줄) */
  bodyFinal: string;
}

/**
 * 최종 조립(요청서 §4) — 본문 앞뒤 빈 줄·공백 제거(비면 머리줄 1줄) → [본문, 혜택?] 줄바꿈 1개로(빈 줄 없음) → 링크.
 */
export function assembleShareMessage(input: AssembleInput): AssembledShare {
  const bodyFinal = String(input.body || '').replace(/^\s+|\s+$/g, '') || input.head;
  const benefit = oneLine(input.benefit);
  const text = benefit ? `${bodyFinal}\n${benefit}` : bodyFinal;
  const url = shareLinkWithId(input.link, input.shareId);
  return { text, url, full: `${text}\n${url}`, bodyFinal };
}

/** 선택 안 렌더(화면 공용) — 곡명·아티스트·테마 표시명·받는 사람·링크를 data 에서 채운다 */
export function renderShareBody(tpl: { body: string }, data: ShareData, recipient: string): string {
  return renderTemplate(tpl.body, {
    title: data.track.title,
    artist: data.track.artist_name,
    themeName: data.theme.name,
    recipient,
    link: data.link,
    maxTitle: data.limits.head_title,
  });
}

/** 베타 혜택 기간(앱 폴백) — untilKst(YYYY-MM-DD) 당일 KST 자정 전까지 true */
export function isBenefitActive(now: number, untilKst: string = SHARE_BENEFIT_FALLBACK.untilKst): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(untilKst);
  if (!m) return false;
  // 다음날 00:00 KST = 당일 15:00 UTC
  const end = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 15, 0, 0);
  return now < end;
}

/** 설정 안 → 화면 안(audience 해석). 남의 곡은 body_other, 없으면 그 안 제외(D5) */
export function resolveAudienceTemplates(templates: ShareTemplateConfig[], audience: ShareAudience): ShareTemplate[] {
  const res: ShareTemplate[] = [];
  for (const t of templates || []) {
    const body = audience === 'other' ? t.body_other : t.body;
    if (typeof body !== 'string' || !body.trim()) continue;
    res.push({ id: t.id, theme: t.theme, kind: t.kind, emoji: t.emoji, label: t.label, order: t.order, enabled: t.enabled !== false, body });
  }
  return res;
}

/** 앱 곡 객체 → 공유 문구용 아티스트(외부 발송). 서버 곡 직렬화의 artist_name 은 아티스트 미지정 곡이면
 *  업로더 닉네임으로 채워지므로(tracks.py _serialize_track `artist_name or uploader_nickname`) 그대로 쓰면 닉네임이 새어 나간다.
 *  → 실제 아티스트 캐릭터 정보가 있을 때만: user_character_snapshot.name 우선, 없으면 character_id 가 있을 때의 artist_name.
 *  그 외 = '' (머리줄 「{곡명}」 만). v3.237 tester 버그 1. */
export interface ShareArtistSource {
  artist_name?: unknown;
  character_id?: unknown;
  user_character_snapshot?: unknown;
}
export function verifiedArtistName(track: ShareArtistSource | null | undefined): string {
  const snap = track?.user_character_snapshot;
  const snapName = snap && typeof snap === 'object' ? oneLine((snap as { name?: unknown }).name) : '';
  if (snapName) return snapName;
  const cid = typeof track?.character_id === 'string' ? track.character_id.trim() : '';
  return cid ? oneLine(track?.artist_name) : '';
}

/**
 * 로컬 폴백 데이터(서버 실패·구서버) — theme default, audience = 앱 판단, 혜택 = 내장 종료일 비교.
 * 아티스트 = verifiedArtistName(닉네임 폴백값 미사용).
 */
export function buildLocalShareData(
  track: { id: string | number; title?: string } & ShareArtistSource,
  isOwn: boolean,
  link: string,
  now: number = Date.now(),
  config: ShareMessageConfig = SHARE_MESSAGES_DEFAULT,
): ShareData {
  const audience: ShareAudience = isOwn ? 'own' : 'other';
  const benefitOn = isBenefitActive(now);
  return {
    track: { id: String(track.id), title: oneLine(track.title), artist_name: verifiedArtistName(track) },
    audience,
    theme: { key: DEFAULT_THEME, name: '', source: 'default' },
    templates: resolveAudienceTemplates(config.templates, audience),
    benefit: benefitOn ? { text: config.benefit.text.replace(/\{amount\}/g, String(SHARE_BENEFIT_FALLBACK.amount)) } : null,
    link,
    limits: { ...config.limits },
    recipient_default: config.recipient_default,
    config_version: 0,
  };
}
