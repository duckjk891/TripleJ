// v3.440 [Carol] 트리 모양·전구 좌표·남은 시간(순수 함수)

export interface TreeLight { x: number; y: number; size: number; color: string; group: number; big: boolean }

export const TREE_W = 240;
export const TREE_H = 244;
export const LIGHT_GROUPS = 6;
const COLORS = ['#ffd76a', '#ff8fb8', '#ffffff', '#7ee8ff', '#ffb86b', '#d6a8ff'];

/** 나무 세 단 — 아래 단부터 그려 위 단이 덮는다 */
export const TREE_TIERS = [
  'M120 108 C98 156 66 186 26 208 Q120 236 214 208 C174 186 142 156 120 108 Z',
  'M120 64 C104 104 80 128 50 146 Q120 168 190 146 C160 128 136 104 120 64 Z',
  'M120 26 C108 60 92 78 72 92 Q120 108 168 92 C148 78 132 60 120 26 Z',
];

// 전구 줄 [왼쪽 끝 x, y, 가운데 처짐 y, 전구 수] — 좌우 대칭 곡선
const GARLANDS: [number, number, number, number][] = [
  [106, 62, 70, 3], [84, 86, 100, 7], [93, 118, 130, 6], [62, 139, 160, 10], [78, 176, 191, 8], [38, 202, 226, 13],
];

/** 전구 줄 곡선(장식 줄) */
export function garlandPaths(): string[] {
  return GARLANDS.map(([x, y, c]) => `M${x} ${y} Q${TREE_W / 2} ${c} ${TREE_W - x} ${y}`);
}

export function treeLights(): TreeLight[] {
  const out: TreeLight[] = [];
  GARLANDS.forEach(([x, y, c, count], row) => {
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      const k = out.length;
      const big = (i + row) % 2 === 0;
      out.push({
        x: (1 - t) * (1 - t) * x + 2 * (1 - t) * t * (TREE_W / 2) + t * t * (TREE_W - x),
        y: (1 - t) * (1 - t) * y + 2 * (1 - t) * t * c + t * t * y,
        size: big ? 9 : 6,
        color: COLORS[(k * 5 + row) % COLORS.length],
        group: (k * 7 + row) % LIGHT_GROUPS,
        big,
      });
    }
  });
  return out;
}

export interface Remain { days: number; hours: number; minutes: number; seconds: number; over: boolean }

/** 끝나는 시각까지 남은 시간 */
export function remainUntil(iso: string, now: number): Remain {
  const end = new Date(iso).getTime();
  const s = Number.isFinite(end) ? Math.max(0, Math.floor((end - now) / 1000)) : 0;
  return {
    days: Math.floor(s / 86400), hours: Math.floor((s % 86400) / 3600), minutes: Math.floor((s % 3600) / 60), seconds: s % 60, over: s <= 0,
  };
}

export const two = (n: number) => String(n).padStart(2, '0');
