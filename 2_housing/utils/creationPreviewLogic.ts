// v3.451 [CreationPreview] 작곡 화면 키·BPM 미리 듣기 — 순수 계산(시험 가능 부분).
// 소리 파일은 scripts/gen_preview_sounds.py 가 만든 assets/sounds/preview/* (BPM 60~200 5 간격·키 14개).

export const PREVIEW_BPM_MIN = 60;
export const PREVIEW_BPM_MAX = 200;
export const PREVIEW_BPM_STEP = 5;

/** 슬라이더 값 → 들려줄 BPM 파일 값(범위 고정 + 5 단위 반올림). 숫자가 아니면 null */
export function previewBpm(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  const c = Math.min(PREVIEW_BPM_MAX, Math.max(PREVIEW_BPM_MIN, n));
  return Math.round(c / PREVIEW_BPM_STEP) * PREVIEW_BPM_STEP;
}

/** 'C major' / 'A minor' → 'C_major' / 'A_minor'(파일 이름 부분). 형식이 다르면 null */
export function previewKeyId(key: unknown): string | null {
  if (typeof key !== 'string') return null;
  const m = key.trim().match(/^([A-G])\s+(major|minor)$/i);
  if (!m) return null;
  return `${m[1].toUpperCase()}_${m[2].toLowerCase()}`;
}

/** 칩에 붙이는 느낌 — 메이저=밝게, 마이너=어둡게 */
export function keyMood(key: unknown): '밝게' | '어둡게' | null {
  const id = previewKeyId(key);
  if (!id) return null;
  return id.endsWith('_minor') ? '어둡게' : '밝게';
}
