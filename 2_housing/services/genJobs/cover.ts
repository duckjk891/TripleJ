import type { GenKindText } from './index';

// ── v3.228 [GenJob:cover] 이미지 디렉터 어댑터(cover·cover_refine) — **2조 소유** ──────────
// W0 인터페이스 커밋 시점 스텁: 문구·상한 상수만 둔다. 어댑터 객체(GenKindAdapter)를 만들어
// registerKind()로 등록하는 순간부터 추적기가 이 kind를 폴링한다(미등록 = 동작 변화 0).
// cover·cover_refine은 중복 차단 그룹 'image' 하나(GEN_KIND_GROUP).

export const COVER_CAP_MS = 15 * 60 * 1000;
export const COVER_SLOW_MS = 5 * 60 * 1000;

export const COVER_TEXT: GenKindText = {
  busyTitle: '이미 이미지를 만드는 중이에요',
  busyBody: '완성된 뒤에 새로 만들 수 있어요.',
  doneTitle: '커버 이미지가 완성됐어요',
  doneBody: '완성된 이미지를 확인해 주세요.',
  failTitle: '커버 이미지를 끝내지 못했어요',
};

export const COVER_REFINE_TEXT: GenKindText = {
  busyTitle: '이미 이미지를 만드는 중이에요',
  busyBody: '완성된 뒤에 새로 만들 수 있어요.',
  doneTitle: '이미지 다듬기가 끝났어요',
  doneBody: '다듬은 이미지를 확인해 주세요.',
  failTitle: '이미지 다듬기를 끝내지 못했어요',
};
