// v3.449 [DiaryAutoBGM] 낙서장 자동 미리듣기 — 순수 규칙(하니스 시험 대상). 재생은 services/diaryPreview.ts.
// 대표 11-26 확정: 후렴 = 서버 clip-info chorus_start, 없으면(비공개 곡 등) 곡 길이의 30% 지점.

/** 후렴부터 이 길이만 반복(인스타처럼 짧게 맴돈다) */
export const PREVIEW_WINDOW_SEC = 30;
/** 곡 길이를 모를 때 쓰는 비율 지점 */
export const FALLBACK_RATIO = 0.3;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/**
 * 미리듣기 시작 초.
 * chorus_start 가 곡 안(끝에서 5초 전까지)이면 그것, 아니면 곡 길이 × 30%, 길이도 모르면 null(불러온 뒤 길이로 다시 계산).
 */
export function previewStartSec(chorusStart: number | null | undefined, durationSec: number | null | undefined): number | null {
  const dur = finite(durationSec) && durationSec > 0 ? durationSec : null;
  if (finite(chorusStart) && (dur === null || chorusStart < dur - 5)) return Math.round(chorusStart * 10) / 10;
  if (dur !== null) return Math.round(dur * FALLBACK_RATIO * 10) / 10;
  return null;
}

/** 반복 구간 끝(곡 끝을 넘지 않게) */
export function previewEndSec(start: number, durationSec: number | null | undefined): number {
  const end = start + PREVIEW_WINDOW_SEC;
  return finite(durationSec) && durationSec > 0 ? Math.min(end, durationSec - 0.3) : end;
}

/** 지금 위치가 반복 구간을 넘었으면 처음(후렴 시작)으로 되돌려야 한다 */
export function shouldLoopBack(positionSec: number, start: number, durationSec: number | null | undefined): boolean {
  return positionSec >= previewEndSec(start, durationSec);
}

/**
 * 화면에 잡힌 낙서 고르기 — 보이는 카드 중 가장 위(index 가 작은) 것.
 * 보이는 카드: 카드의 60% 이상이 보이거나(짧은 카드) 화면의 50% 이상을 덮는(긴 카드) 것.
 */
export function pickFocused<T extends { index: number | null }>(lists: T[][]): T | null {
  let best: T | null = null;
  for (const list of lists) {
    for (const it of list) {
      if (it.index == null) continue;
      if (!best || (best.index as number) > it.index) best = it;
    }
  }
  return best;
}

export type PreviewPref = 'on' | 'off' | null;

/**
 * 낙서장에 들어올 때 음소거로 시작할지(대표 11-26: 듣던 곡이 있으면 음소거로 시작, 사용자가 끈 선택은 기억).
 *  · 직접 끈 적 있음(off) → 음소거  · 그 밖에 차트 플레이어로 듣는 중 → 이번엔 음소거  · 아니면 소리 켬
 */
export function initialMuted(pref: PreviewPref, mainPlaying: boolean): boolean {
  if (pref === 'off') return true;
  return mainPlaying;
}

/** 낙서에 붙은 곡(상세 화면 v3.414 와 같은 규칙: 본문 곡 첫 번째 → 없으면 BGM 곡) */
export function diarySongOf(post: any): any | null {
  if (!post || (post.kind || 'feed') !== 'feed' || !post.diary_date) return null;
  const t = (post.blocks || []).find((b: any) => b?.type === 'track' && b.track?.id)?.track;
  if (t) return t;
  const bgm = post.bgm_track;
  return bgm?.id && !bgm.deleted ? bgm : null;
}
