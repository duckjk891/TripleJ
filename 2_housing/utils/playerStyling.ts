// [PlayerStyling] v3.238 A3 — Player 스타일링(착장) 탭 표시 분기 순수 함수(RN 의존 없음 — Node 하네스 공용).
//  · 서버 v3.238 GET /tracks/{id}: 커버 이미지에 곡 아티스트가 없으면 cover_character.used_items=[] 와 함께
//    additive `styling_visible: false`·`styling_reason` 을 내린다(스냅샷 데이터는 보존, 노출만 판정).
//  · 키 없는 구서버 응답 = 현행 동작(아이템 있으면 표시, 없으면 "착장 정보 없음").

/** 서버가 미노출 사유로 내리되 "커버에 아티스트 없음" 안내가 맞지 않는 사유 — 기존 빈 상태 문구로 */
const GENERIC_EMPTY_REASONS = new Set(['no_snapshot', 'error']);

export type StylingView =
  | { kind: 'items' }
  | { kind: 'loading' }
  | { kind: 'hidden'; own: boolean; reason: string }
  | { kind: 'empty' };

export interface StylingViewInput {
  /** GET /tracks/{id} 응답 수신 여부(fullTrack !== null) */
  loaded: boolean;
  /** 응답 styling_visible — 구서버는 undefined */
  stylingVisible?: boolean | null;
  stylingReason?: string | null;
  /** cover_character.used_items 개수 */
  itemCount: number;
  /** 본인 곡 여부(방법 안내 줄 노출) */
  isMyTrack: boolean;
}

export function resolveStylingView(input: StylingViewInput): StylingView {
  const reason = typeof input.stylingReason === 'string' ? input.stylingReason : '';
  if (input.stylingVisible === false) {
    // 서버가 미노출로 판정 — 아이템이 섞여 와도 목록은 그리지 않는다(방어)
    if (GENERIC_EMPTY_REASONS.has(reason)) return { kind: 'empty' };
    return { kind: 'hidden', own: !!input.isMyTrack, reason: reason || 'unknown' };
  }
  if (input.itemCount > 0) return { kind: 'items' };
  if (!input.loaded) return { kind: 'loading' };
  return { kind: 'empty' };
}

export const STYLING_TEXT = {
  helper: '커버 이미지 속 아티스트가 입은 의상이에요. 옆으로 넘겨보세요.',
  hidden: '커버에 아티스트가 함께 나온 곡만 착장을 보여드려요.',
  hiddenOwn: '커버를 아티스트와 함께 만들면 여기에 착장이 표시돼요.',
  empty: '이 곡은 착장 정보가 없습니다',
  loading: '불러오는 중...',
} as const;
