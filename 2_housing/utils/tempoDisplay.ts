// v3.246 T4: 템포 표시 폴백 — v3.244에서 박자분석(beat analysis)을 중지해 신곡은 tempo=null.
// CEO 지시: 분석 템포가 없으면 작곡 시 설정한 BPM을 대신 보여준다(표시는 동일하게 정수 반올림).
// 순수 유틸 — Node 하니스로 단위 검증.

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * 템포 행 표시값 결정: 분석 tempo(예: 133.33) 우선, 없으면 작곡 설정 bpm(예: "130") 폴백.
 * 둘 다 없거나 숫자가 아니면 null(행 숨김 — 기존 동작 유지). 반환은 정수 반올림.
 */
export function resolveTempoDisplay(tempo: unknown, bpm: unknown): number | null {
  const t = toFiniteNumber(tempo);
  if (t !== null && t > 0) return Math.round(t);
  const b = toFiniteNumber(bpm);
  if (b !== null && b > 0) return Math.round(b);
  return null;
}
