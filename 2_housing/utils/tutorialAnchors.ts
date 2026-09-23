// [Tutorial] v3.207 ① — 코치마크 anchor registry.
// 화면들이 대상 요소의 창(window) 좌표를 등록하면 TutorialOverlay가 스포트라이트+화살표로 지시한다.
// - 공용 컴포넌트(TrackRow 등) 시그니처 오염 최소화를 위해 화면→오버레이 좌표 채널을 전역 registry로 분리.
// - 등록/해제는 각 화면의 onLayout·unmount 시점. 오버레이는 구독으로 늦은 등록(리스트 로딩 후)도 반영.
// - anchor 미등록/측정 실패 시 오버레이가 기존 텍스트 카드로 graceful fallback한다.

export type TutorialAnchorKey =
  | 'chart-row-more' // 차트 첫 행 더보기(⋮)
  | 'chart-tabs' // v3.213: 차트 탭 스트립(신곡~내 재생목록 chipBar 전체 영역)
  | 'search-input' // 검색 입력바
  | 'search-row-more' // 검색 결과 첫 행 더보기(⋮) — v3.213 스텝 철회로 미사용(키 존치 무해)
  | 'player-add' // 플레이어 담기 버튼 — v3.215 ⑥ 스텝 교체로 미사용(키 존치 무해 — search-row-more 관행)
  | 'player-detail-toggle' // v3.215 ⑥: 플레이어 하단 [가사·제작 노트·스타일링·댓글] 토글
  | 'feed-compose' // 피드 글쓰기 Fab
  // v3.213: 작업실 6스텝 — 디렉터 5종(맵 좌표 140×140 박스) + 생성 이력 고정 버튼
  | 'map-artist'
  | 'map-lyricist'
  | 'map-composer'
  | 'map-image'
  | 'map-video'
  | 'map-history'
  // v3.213: 상단바 6스텝 — HomeHeaderActions 아이콘(차트 탭 헤더 인스턴스만 등록)
  | 'topbar-star'
  | 'topbar-attendance'
  | 'topbar-invite'
  | 'topbar-noti'
  | 'topbar-dm'
  | 'topbar-mypage';

export interface AnchorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const anchors = new Map<TutorialAnchorKey, AnchorRect>();
const listeners = new Map<TutorialAnchorKey, Set<() => void>>();

function notify(key: TutorialAnchorKey) {
  listeners.get(key)?.forEach((cb) => {
    try {
      cb();
    } catch (err: any) {
      console.error('[Tutorial] anchor listener 실패', { key, message: err?.message });
    }
  });
}

export function registerAnchor(key: TutorialAnchorKey, rect: AnchorRect): void {
  if (!(rect.width > 0) || !(rect.height > 0)) return; // 측정 실패(0-rect)는 무시 → fallback 유지
  anchors.set(key, rect);
  if (__DEV__) console.info('[Tutorial] anchor 등록', { key, rect });
  notify(key);
}

export function unregisterAnchor(key: TutorialAnchorKey): void {
  if (!anchors.delete(key)) return;
  if (__DEV__) console.info('[Tutorial] anchor 해제', { key });
  notify(key);
}

export function getAnchor(key: TutorialAnchorKey): AnchorRect | null {
  return anchors.get(key) ?? null;
}

/** 오버레이가 현재 스텝의 anchor 변동(늦은 등록·해제)을 구독한다. 반환값 = 구독 해제 함수 */
export function subscribeAnchor(key: TutorialAnchorKey, cb: () => void): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(cb);
  return () => {
    set?.delete(cb);
  };
}

/** measureInWindow 가능한 네이티브 ref를 받아 창 좌표를 측정·등록하는 헬퍼 (onLayout에서 호출) */
export function measureAndRegister(
  key: TutorialAnchorKey,
  node: { measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void } | null
): void {
  try {
    node?.measureInWindow?.((x, y, width, height) => {
      registerAnchor(key, { x, y, width, height });
    });
  } catch (err: any) {
    console.error('[Tutorial] anchor 측정 실패', { key, message: err?.message });
  }
}
