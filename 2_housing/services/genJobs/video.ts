import type { GenKindText } from './index';

// ── v3.228 [GenJob:video] 영상 디렉터 어댑터 — **2조 소유** ────────────────────────────
// W0 인터페이스 커밋 시점 스텁: 문구·상한 상수만 둔다. 어댑터 객체(GenKindAdapter)를 만들어
// registerKind()로 등록하는 순간부터 추적기가 이 kind를 폴링한다(미등록 = 동작 변화 0).
// 계약: services/genJobs/index.ts GenKindAdapter · PLAN v3.228 D4.

export const VIDEO_CAP_MS = 25 * 60 * 1000; // 서버 상한(ffmpeg 600s + heavy 대기 + 전송)
export const VIDEO_SLOW_MS = 6 * 60 * 1000;

export const VIDEO_TEXT: GenKindText = {
  busyTitle: '이미 영상을 만드는 중이에요',
  busyBody: '완성된 뒤에 새로 만들 수 있어요.',
  doneTitle: '영상이 완성됐어요',
  doneBody: '미리 보고 저장하거나 공유해 보세요.',
  failTitle: '영상을 끝내지 못했어요',
};
