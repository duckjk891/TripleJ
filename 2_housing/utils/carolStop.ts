// v3.438 [Carol] 스타룰렛 릴 — 순수 함수. 위에서 아래로 굴러가고, 결과(서버가 정함)가 가운데 칸에서 멈춘다.

/** 릴 한 줄 높이(px) · 굴러가는 속도(px/초) · '스톱!' 뒤 최소 더 굴러가는 줄 수 */
export const ROW_H = 64;
export const SPEED = 1500;
const MIN_ROWS = 10;

/** 릴에 적히는 순서 — 작은 값과 큰 값이 번갈아 지나가게 */
export function reelOrder(amounts: number[]): number[] {
  const a = [...amounts].sort((x, y) => x - y);
  const out: number[] = [];
  while (a.length) {
    out.push(a.shift()!);
    if (a.length) out.push(a.pop()!);
  }
  return out;
}

/** 아래로 d px 굴렀을 때 가운데 칸의 번호(d=0 이면 0번) */
export function centerIndex(n: number, d: number): number {
  return (((-Math.round(d / ROW_H)) % n) + n) % n;
}

/** 지금 위치 cur 에서 idx 가 가운데 오는 멈출 위치 — 줄이 어긋나지 않고 최소 MIN_ROWS 줄은 더 간다 */
export function stopAt(n: number, cur: number, idx: number): number {
  const cycle = n * ROW_H;
  const base = ((n - idx) % n) * ROW_H;
  const min = cur + MIN_ROWS * ROW_H;
  return base + Math.max(0, Math.ceil((min - base) / cycle)) * cycle;
}

/** 멈추는 시간(ms) — 굴러가던 속도 그대로 이어서 느려지도록(감속 곡선 out-quad 의 처음 속도 = 2·거리/시간) */
export function stopMs(distance: number): number {
  return Math.round((2 * distance * 1000) / SPEED);
}

export function untilLabel(iso: string): string {
  const k = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  return `${k.getUTCMonth() + 1}월 ${k.getUTCDate()}일`;
}
