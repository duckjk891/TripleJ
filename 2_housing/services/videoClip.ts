// v3.281 [52][59] → v3.282 [VideoDirector] 영상 구간 자르기(트리머) 보조.
// 서버(routes/tracks.py v3.282):
//   GET /api/tracks/{id}/share-video/clip-info (무인증·공개 곡만)
//     → { track_id, duration(초|null), clip_seconds(15), lyric_start(초), chorus_start(초|null),
//         min_seconds(5), kakao_max_seconds(15) }
//   GET /api/tracks/{id}/share-video/quote?…스타일…&clip_start&clip_end (로그인) — 과금 미리보기
//     → { cached, recut_free, charge, cost, clip_start, clip_end }  (차감·원장·피로 없음)
//   POST /api/tracks/{id}/share-video?…&clip_start=<초>&clip_end=<초> — 미지정이면 기존(전체/카톡 자동 15초).
//     응답 charged(bool)·recut_free(bool) — 같은 곡·형식·스타일 영상의 구간만 바꾼 편집은 무과금(서버 판정).
// 구 서버·네트워크 실패면 null → 화면은 기본 구간만 노출(clip 미전송) / ⭐ 확인은 기존 팝업.
import api from './api';

export const CLIP_SECONDS = 15; // 카톡 프로필 형식 최대·자동 클립 길이(서버 KAKAO_CLIP_SECONDS)
export const MIN_CLIP_SECONDS = 5; // 서버 CLIP_MIN_SECONDS

export type VideoFormatKey = 'sns' | 'wide' | 'kakao';
export interface ClipRange { start: number; end: number }

export interface VideoClipInfo {
  duration: number | null;
  clipSeconds: number;
  lyricStart: number;
  chorusStart: number | null;
  minSeconds: number;
  kakaoMaxSeconds: number;
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;

export async function fetchVideoClipInfo(trackId: string): Promise<VideoClipInfo | null> {
  try {
    const res = await api.get(`/tracks/${encodeURIComponent(trackId)}/share-video/clip-info`, { timeout: 15000 });
    const d = res.data || {};
    const info: VideoClipInfo = {
      duration: num(d.duration),
      clipSeconds: num(d.clip_seconds) || CLIP_SECONDS,
      lyricStart: num(d.lyric_start) ?? 0,
      chorusStart: num(d.chorus_start),
      minSeconds: num(d.min_seconds) || MIN_CLIP_SECONDS,
      kakaoMaxSeconds: num(d.kakao_max_seconds) || CLIP_SECONDS,
    };
    if (__DEV__) console.info('[VideoDirector] clip-info', { trackId, ...info });
    return info;
  } catch (err: any) {
    console.warn('[VideoDirector] clip-info 조회 실패(구간 자르기 생략)', { trackId, status: err?.response?.status ?? null });
    return null;
  }
}

export interface ShareVideoQuote { cached: boolean; recutFree: boolean; charge: boolean; cost: number | null }

/** 생성 전 과금 미리보기 — 실패(구 서버 404 등)는 null(호출부는 기존 ⭐ 확인으로) */
export async function fetchShareVideoQuote(
  trackId: string, params: Record<string, string | number>,
): Promise<ShareVideoQuote | null> {
  try {
    const res = await api.get(`/tracks/${encodeURIComponent(trackId)}/share-video/quote`, { params, timeout: 10000 });
    const d = res.data || {};
    const q: ShareVideoQuote = {
      cached: d.cached === true, recutFree: d.recut_free === true,
      charge: d.charge !== false, cost: num(d.cost),
    };
    if (__DEV__) console.info('[VideoDirector] quote', { trackId, ...q });
    return q;
  } catch (err: any) {
    console.warn('[VideoDirector] quote 조회 실패(기존 ⭐ 확인으로)', { trackId, status: err?.response?.status ?? null });
    return null;
  }
}

const q1 = (v: number): number => Math.round(v * 10) / 10;

/**
 * 구간 정규화 — 서버 normalize_clip 과 같은 규칙(0.1초·0≤start, end≤곡 길이, 최소 5초, 카톡 최대 15초).
 * 반환 pulled=true 면 카톡 15초 제한으로 끝점을 당겼다는 뜻(안내 문구용).
 */
export function normalizeRange(
  fmt: VideoFormatKey, start: number, end: number, duration: number | null,
): ClipRange & { pulled: boolean } {
  let s = q1(Math.max(0, start));
  let e = q1(end);
  const d = duration && duration > 0 ? duration : null;
  if (d != null) {
    e = Math.min(e, q1(d));
    s = Math.min(s, q1(Math.max(0, d - MIN_CLIP_SECONDS)));
  }
  if (e - s < MIN_CLIP_SECONDS) {
    e = q1(s + MIN_CLIP_SECONDS);
    if (d != null && e > q1(d)) { e = q1(d); s = q1(Math.max(0, e - MIN_CLIP_SECONDS)); }
  }
  let pulled = false;
  if (fmt === 'kakao' && e - s > CLIP_SECONDS) { e = q1(s + CLIP_SECONDS); pulled = true; }
  return { start: s, end: e, pulled };
}

/** 형식별 기본 구간 — sns/wide: 곡 전체, 카톡: 가사 시작부터 15초(서버 자동 클립과 같은 구간) */
export function defaultRange(fmt: VideoFormatKey, info: VideoClipInfo | null, duration: number | null): ClipRange | null {
  if (!duration || duration <= 0) return null;
  if (fmt !== 'kakao') return { start: 0, end: q1(duration) };
  const s = info?.lyricStart ?? 0;
  return { start: s, end: q1(Math.min(duration, s + CLIP_SECONDS)) };
}

/** 기본 구간과 같으면 true → 구간 미전송(기존 요청·캐시 키 그대로) */
export function isDefaultRange(fmt: VideoFormatKey, r: ClipRange, info: VideoClipInfo | null, duration: number | null): boolean {
  const def = defaultRange(fmt, info, duration);
  if (!def) return false;
  if (fmt !== 'kakao') return r.start <= 0.05 && r.end >= def.end - 0.05;
  return Math.abs(r.start - def.start) < 0.05 && Math.abs(r.end - def.end) < 0.05;
}

/** 서버 결과/원장 결과의 구간 — ClipRange=지정, null=미지정(기본), undefined=모름(구 서버 기록 등) */
export function clipOfResult(r: any): ClipRange | null | undefined {
  if (!r || typeof r !== 'object') return undefined;
  const s = r.clip_start;
  const e = r.clip_end;
  if (typeof s === 'number' && typeof e === 'number') return { start: s, end: e };
  if (typeof s === 'number') return { start: s, end: s + CLIP_SECONDS }; // v3.281(카톡 start 단독)
  if ('clip_start' in r) return null;
  return undefined;
}

/** 지난 영상 object name → 구간(`_t{s}` v3.281 카톡 15초 · `_t{s}-{e}` v3.282) */
export function clipOfObjectName(objectName: string): ClipRange | null {
  const m = /_t(\d+)(?:-(\d+))?\.mp4$/.exec(objectName);
  if (!m) return null;
  const s = Number(m[1]) / 10;
  return { start: s, end: m[2] ? Number(m[2]) / 10 : s + CLIP_SECONDS };
}

/** 초 → m:ss */
export const fmtSec = (sec: number | null | undefined): string => {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return '--:--';
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** 구간 길이 표기 — 60초 미만 "15초", 이상 "2:19" */
export const fmtLen = (sec: number): string => (sec < 60 ? `${Math.round(sec)}초` : fmtSec(sec));

/** "0:51 ~ 1:06 · 15초" */
export const rangeLabel = (r: ClipRange): string => `${fmtSec(r.start)} ~ ${fmtSec(r.end)} · ${fmtLen(r.end - r.start)}`;
