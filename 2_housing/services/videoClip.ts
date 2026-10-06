// v3.281 [52][59] [VideoDirector] 15초 클립(카톡 프로필 배경) 구간 선택 보조.
// 서버(routes/tracks.py v3.281):
//   GET /api/tracks/{id}/share-video/clip-info (무인증·공개 곡만)
//     → { track_id, duration(초|null), clip_seconds(15), lyric_start(초), chorus_start(초|null) }
//   POST /api/tracks/{id}/share-video?format=kakao&clip_start=<초> — 미지정이면 기존(가사 시작부터) 그대로.
// 구 서버(엔드포인트 없음·404)·네트워크 실패면 null → 화면은 "가사 시작부터(기본)"만 노출(clip_start 미전송).
import api from './api';

export const CLIP_SECONDS = 15;

export interface VideoClipInfo {
  duration: number | null;
  clipSeconds: number;
  lyricStart: number;
  chorusStart: number | null;
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
    };
    if (__DEV__) console.info('[VideoDirector] clip-info', { trackId, ...info });
    return info;
  } catch (err: any) {
    console.warn('[VideoDirector] clip-info 조회 실패(구간 선택 생략)', { trackId, status: err?.response?.status ?? null });
    return null;
  }
}

/** 슬라이더 상한(곡 길이−15초, 0 미만이면 0) — 서버 clamp_clip_start 와 같은 규칙 */
export const maxClipStart = (durationSec: number | null | undefined, clipSec = CLIP_SECONDS): number =>
  durationSec && durationSec > 0 ? Math.max(0, Math.floor(durationSec - clipSec)) : 0;

/** 0.1초 양자화 + [0, max] 클램프 — 서버 정규화와 같은 값을 보내 파일 조회 키를 맞춘다 */
export const clampClipStart = (v: number, max: number): number =>
  Math.round(Math.min(Math.max(0, v), max) * 10) / 10;

/** 초 → m:ss */
export const fmtSec = (sec: number | null | undefined): string => {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return '--:--';
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
