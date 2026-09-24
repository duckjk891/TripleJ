import { useLyricsStore } from '../stores/lyricsStore';
import { useMusicStore } from '../stores/musicStore';

// ── v3.228 W3: 작사 결과 → store 반영(LyricsLoadingScreen 성공 경로 추출 — 동작 불변) ──────────
// LyricsLoading(직접 응답·원장 회수)과 작업실 도착 알림(genJobs/lyrics)이 같은 경로를 쓴다.
// 서버 자동 자산화(v3.131 save:true)로 받은 lyrics_id를 출처로 기억(v3.134 PATCH 동기화, v3.144 영속).

export interface LyricsResultLike {
  lyrics?: string | null;
  generated_lyrics?: string | null;
  text?: string | null;
  result?: string | null;
  title?: string | null;
  lyrics_id?: string | null;
}

/** 응답(또는 원장 result)의 가사 본문 — 기존 필드 폴백 순서 그대로 */
export function lyricsTextOf(result: LyricsResultLike | null | undefined): string {
  if (!result) return '';
  return result.lyrics || result.generated_lyrics || result.text || result.result || '';
}

export function applyLyricsResult(result: LyricsResultLike): void {
  const store = useLyricsStore.getState();
  const lyrics = lyricsTextOf(result);
  const title = result.title || '';
  store.setGeneratedTitle(title);
  store.setGeneratedLyrics(lyrics);
  // v3.102(B-4)→v3.134: 새로 작사한 가사 — 자동 자산화(v3.131 save:true)로 받은
  // lyrics_id 를 출처로 기억해, 작곡 중 제목/가사 수정 시 자산 동기화(PATCH)가 가능하게.
  // (자산 저장 실패 등으로 id가 없으면 기존대로 출처 없음)
  if (result.lyrics_id) {
    useMusicStore.getState().setLyricsSource({ lyrics_id: result.lyrics_id, title: title || undefined, is_mine: true });
  } else {
    useMusicStore.getState().setLyricsSource(null);
  }
  // v3.144: 출처 id를 작업본(lyricsStore, 영속)에도 기록 — 리로드로
  // musicStore(비영속)가 초기화돼도 DB 연결이 안 끊기게 (대표 실사고 2026-09-09)
  store.setSourceAssetId(result.lyrics_id || '');
}
