import { useMusicStore } from '../stores/musicStore';
import { useLyricsStore } from '../stores/lyricsStore';
import { generationStreamUrl, isGenerationInProgress } from '../services/musicService';
import { GenerationItem } from '../types';

// ── v3.228 W1: 생성 이력 → 작곡 흐름 store 하이드레이션(GenerationHistoryScreen.hydrateStores 추출 — 동작 불변) ──
// LyricsBookScreen.handleCompose 관행: MusicLoading/MusicResult가 musicStore·lyricsStore에서
// 제목/가사/메타를 직접 읽는다. 생성 이력·작업실 도착 알림(genJobs/music)이 공용으로 쓴다.
export function hydrateMusicStoresFromGeneration(gen: GenerationItem): void {
  const music = useMusicStore.getState();
  const lyrics = useLyricsStore.getState();
  music.setSelectedModel('suno'); // 서버 생성 이력은 suno 경로만 존재 (generate.py:171)
  music.setGenerationId(gen.id);
  music.setSavedTrackId(gen.result_track_id || null);
  music.setLyrics(gen.lyrics || '');
  music.setGenre(gen.genre || '');
  music.setMood(gen.mood || '');
  lyrics.setGeneratedTitle(gen.title || '');
  lyrics.setGeneratedLyrics(gen.lyrics || '');
  // v3.102(B-4): 이력 재개는 가사 출처를 알 수 없음 — 이전 흐름의 lyrics_source 스냅샷이
  // 발매(upload-from-generation lyrics_id)에 잘못 실리지 않도록 정리 (생성 시점 출처는 서버가 이미 보유)
  music.setLyricsSource(null);
  if (gen.status === 'completed') {
    music.setStatus('completed');
    music.setError(null);
    music.setResultUrl(generationStreamUrl(gen.id, 0));
  } else if (gen.status === 'failed') {
    music.setStatus('failed');
    music.setError(gen.error_message || '음악 생성에 실패했습니다.');
    music.setResultUrl(null);
  } else {
    music.setStatus('processing');
    music.setError(null);
    music.setResultUrl(null);
  }
  music.setIsLoading(isGenerationInProgress(gen));
}
