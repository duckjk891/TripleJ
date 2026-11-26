// v3.446 [DiaryInline] 낙서 글·사진 순서 조각(대표 11-18·11-25 "네이버 블로그처럼 사진을 중간중간").
// 쓰는 화면은 [글, (사진, 글)*] 모양을 늘 지킨다 — 사진 앞뒤에 항상 글 칸이 있어 어디든 이어 쓸 수 있다.
// 저장은 기존 서버 계약(blocks 순서 보존) 그대로: {type:'text'} · {type:'image'}. 예전 낙서(글 → 사진)도 같은 함수로 읽는다.

export interface TextSeg { key: string; type: 'text'; text: string }
export interface ImageSeg { key: string; type: 'image'; imgKey: string }
export type Seg = TextSeg | ImageSeg;
export interface SegCursor { key: string; start: number }

let seq = 0;
const nextKey = (p: string) => `${p}${Date.now().toString(36)}_${++seq}`;
export const textSeg = (text = ''): TextSeg => ({ key: nextKey('t'), type: 'text', text });
export const imageSeg = (imgKey: string): ImageSeg => ({ key: nextKey('i'), type: 'image', imgKey });

const isItemMarker = (text: unknown) => typeof text === 'string' && text.startsWith('[item]');

/** 붙어 있는 글 칸은 하나로(뜻이 바뀌지 않게 sep 로 이음), 사진 앞뒤에 빈 글 칸을 채운다 */
export function normalizeSegs(segs: Seg[], sep = '\n'): Seg[] {
  const out: Seg[] = [];
  for (const s of segs) {
    const last = out[out.length - 1];
    if (s.type === 'text') {
      if (last?.type === 'text') {
        const joined = last.text && s.text ? `${last.text}${sep}${s.text}` : last.text || s.text;
        // 글이 있는 쪽의 key 를 이어 쓴다(입력칸이 다시 만들어져 커서가 사라지지 않게)
        out[out.length - 1] = { ...(last.text || !s.text ? last : s), text: joined };
      } else out.push(s);
    } else {
      if (last?.type !== 'text') out.push(textSeg());
      out.push(s);
    }
  }
  if (out[out.length - 1]?.type !== 'text') out.push(textSeg());
  return out;
}

/** 사진을 커서 자리에 넣는다. 커서를 모르면 맨 끝. 반환 cursor = 넣은 사진 바로 뒤 글 칸의 처음 */
export function insertImages(segs: Seg[], at: SegCursor | null, imgKeys: string[]): { segs: Seg[]; cursor: SegCursor | null } {
  if (!imgKeys.length) return { segs, cursor: at };
  let idx = at ? segs.findIndex((s) => s.key === at.key && s.type === 'text') : -1;
  let start = at?.start ?? 0;
  if (idx < 0) {
    idx = segs.length - 1;
    start = segs[idx]?.type === 'text' ? (segs[idx] as TextSeg).text.length : 0;
  }
  const cur = segs[idx] as TextSeg;
  const pos = Math.max(0, Math.min(start, cur.text.length));
  // 사진이 줄을 대신하므로 자른 자리의 줄바꿈 하나씩은 뺀다
  const before = cur.text.slice(0, pos).replace(/\n$/, '');
  const after = cur.text.slice(pos).replace(/^\n/, '');
  const mid: Seg[] = [{ ...cur, text: before }];
  imgKeys.forEach((k, i) => {
    mid.push(imageSeg(k));
    mid.push(textSeg(i === imgKeys.length - 1 ? after : ''));
  });
  const tail = mid[mid.length - 1];
  return { segs: normalizeSegs([...segs.slice(0, idx), ...mid, ...segs.slice(idx + 1)]), cursor: { key: tail.key, start: 0 } };
}

export function removeImage(segs: Seg[], imgKey: string): Seg[] {
  return normalizeSegs(segs.filter((s) => !(s.type === 'image' && s.imgKey === imgKey)));
}

export function replaceImageKey(segs: Seg[], oldKey: string, newKey: string): Seg[] {
  return segs.map((s) => (s.type === 'image' && s.imgKey === oldKey ? { ...s, imgKey: newKey } : s));
}

/** 사진을 위·아래로 한 칸(글은 한 줄, 글이 없으면 옆 사진과 자리 바꿈) */
export function moveImage(segs: Seg[], imgKey: string, dir: 'up' | 'down'): Seg[] {
  const list = segs.filter((s) => s.type === 'image' || s.text.length > 0);
  const i = list.findIndex((s) => s.type === 'image' && s.imgKey === imgKey);
  const j = dir === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= list.length) return segs;
  const me = list[i];
  const other = list[j];
  let pair: Seg[];
  if (other.type === 'image') pair = dir === 'up' ? [me, other] : [other, me];
  else if (dir === 'up') {
    const cut = other.text.lastIndexOf('\n');
    pair = cut < 0 ? [me, other] : [{ ...other, text: other.text.slice(0, cut) }, me, textSeg(other.text.slice(cut + 1))];
  } else {
    const cut = other.text.indexOf('\n');
    pair = cut < 0 ? [other, me] : [textSeg(other.text.slice(0, cut)), me, { ...other, text: other.text.slice(cut + 1) }];
  }
  const lo = Math.min(i, j);
  return normalizeSegs([...list.slice(0, lo), ...pair, ...list.slice(lo + 2)]);
}

export function canMoveImage(segs: Seg[], imgKey: string, dir: 'up' | 'down'): boolean {
  const list = segs.filter((s) => s.type === 'image' || s.text.length > 0);
  const i = list.findIndex((s) => s.type === 'image' && s.imgKey === imgKey);
  return i >= 0 && (dir === 'up' ? i > 0 : i < list.length - 1);
}

/** 글만 이어 붙인 본문(글자 수·보상·노래 재료용) */
export const segsText = (segs: Seg[]): string =>
  segs.filter((s): s is TextSeg => s.type === 'text' && s.text.trim().length > 0).map((s) => s.text).join('\n');

/** 글에 놓인 순서대로 사진 key */
export const segsImageKeys = (segs: Seg[]): string[] =>
  segs.filter((s): s is ImageSeg => s.type === 'image').map((s) => s.imgKey);

/** 저장 블록 — objectNameOf 가 null 을 주는 사진(올라가지 않은 사진)은 뺀다 */
export function segsToBlocks(segs: Seg[], objectNameOf: (imgKey: string) => string | null | undefined): any[] {
  const kept = segs.filter((s) => s.type === 'text' || !!objectNameOf(s.imgKey));
  const out: any[] = [];
  for (const s of normalizeSegs(kept)) {
    if (s.type === 'text') {
      if (s.text.trim()) out.push({ type: 'text', text: s.text.trim() });
    } else out.push({ type: 'image', object_name: objectNameOf(s.imgKey) });
  }
  return out;
}

/** 저장된 블록 → 쓰는 화면 조각(수정). imgKeyOf 는 사진 블록마다 쓸 key */
export function blocksToSegs(blocks: any[], imgKeyOf: (block: any, index: number) => string): Seg[] {
  const segs: Seg[] = [];
  let n = 0;
  for (const b of blocks || []) {
    if (b?.type === 'text' && typeof b.text === 'string' && !isItemMarker(b.text)) segs.push(textSeg(b.text));
    else if (b?.type === 'image' && b.object_name) segs.push(imageSeg(imgKeyOf(b, n++)));
  }
  return normalizeSegs(segs, '\n\n');
}

export type BodyPart = { kind: 'text'; text: string } | { kind: 'image'; block: any };

/** 보여 주기용 — 글·사진을 저장 순서대로(곡·착장 아이템 제외), 사이에 사진이 없는 글은 하나로 */
export function bodyParts(blocks: any[]): BodyPart[] {
  const out: BodyPart[] = [];
  for (const b of blocks || []) {
    if (b?.type === 'text' && b.text && !isItemMarker(b.text)) {
      const last = out[out.length - 1];
      if (last?.kind === 'text') last.text = `${last.text}\n${b.text}`;
      else out.push({ kind: 'text', text: String(b.text) });
    } else if (b?.type === 'image' && (b.image_url || b.object_name)) out.push({ kind: 'image', block: b });
  }
  return out;
}

/**
 * v3.449 [DiaryPhotoTop] 낙서장 목록 카드 — 인스타처럼 사진 전부 위, 글은 아래(오리쟁이 11-09 제안·대표 11-26).
 * 사진은 쓴 순서대로 모으고, 사진 사이에 나뉘어 있던 글은 빈 줄로 이어 한 덩어리로. 상세 화면은 bodyParts(쓴 순서) 그대로.
 */
export function cardParts(blocks: any[]): { images: any[]; text: string } {
  const parts = bodyParts(blocks);
  const images = parts.filter((p): p is { kind: 'image'; block: any } => p.kind === 'image').map((p) => p.block);
  const text = parts
    .filter((p): p is { kind: 'text'; text: string } => p.kind === 'text')
    .map((p) => p.text.trim())
    .filter(Boolean)
    .join('\n\n');
  return { images, text };
}
