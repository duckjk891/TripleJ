// v3.230 [ServerTime] 서버 시각 문자열 → Date 공용 파서(스타 내역·가입 선물 안내·확인 기록 공용).
// points_service.get_history 는 타임존 없는 UTC(naive isoformat)를 내려주고, 소수 6자리(마이크로초,
// 예 "2026-09-24T16:41:07.030000")가 붙을 수 있다. Hermes 등 일부 엔진은 소수 3자리 초과·타임존 없는
// ISO 를 못 읽거나 로컬로 해석하므로: ① 공백 구분자 → 'T' ② 소수부를 3자리로 자름(부족하면 0 채움)
// ③ 타임존 표기가 없으면 'Z'(UTC) 부착 후 파싱한다. 실패는 null.
const ISO_RE = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)(?:\.(\d+))?(Z|z|[+-]\d{2}:?\d{2})?$/;

/** 파싱 가능한 정규 ISO 문자열(소수 3자리·타임존 포함)로 변환. 형식 불일치는 null */
export function normalizeServerIso(iso: string | null | undefined): string | null {
  if (!iso || typeof iso !== 'string') return null;
  const m = ISO_RE.exec(iso.trim());
  if (!m) return null;
  const [, date, time, frac, tz] = m;
  const hms = time.length === 5 ? `${time}:00` : time;
  const ms = frac ? `.${(frac + '000').slice(0, 3)}` : '';
  let zone = tz ? (tz === 'z' ? 'Z' : tz) : 'Z';
  if (/^[+-]\d{4}$/.test(zone)) zone = `${zone.slice(0, 3)}:${zone.slice(3)}`;
  return `${date}T${hms}${ms}${zone}`;
}

export function parseServerTime(iso: string | null | undefined): Date | null {
  const n = normalizeServerIso(iso);
  if (!n) return null;
  const d = new Date(n);
  return Number.isNaN(d.getTime()) ? null : d;
}
