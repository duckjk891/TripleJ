/**
 * [beatsService] v3.97(A-9) — 트랙 비트 추출 상태/재시도 API.
 * 계약(backend_9004 tracks.py):
 *   GET  /tracks/{id}/beats        (tracks.py:848 get_track_beats — 인증 필요, 공개곡은 누구나)
 *     응답: { status: 'pending'|'running'|'completed'|'failed', tempo: number|null,
 *            beats: number[](초), downbeats: number[](초),
 *            started_at: string|null, completed_at: string|null, error: string|null }
 *   POST /tracks/{id}/beats/retry  (tracks.py:869 retry_track_beats — 소유자 전용, 403)
 *     응답: { message, status: 'pending' }
 * MAIDOL 프론트 대응: api/index.js:859 getTrackBeats / :863 retryTrackBeats
 */
import api from './api';

export type BeatStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface TrackBeats {
  status: BeatStatus;
  tempo: number | null;
  beats: number[];      // 비트 타임스탬프(초)
  downbeats: number[];  // 다운비트(마디 첫 박) 타임스탬프(초)
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
}

export const getTrackBeats = async (trackId: string): Promise<TrackBeats> => {
  const res = await api.get(`/tracks/${trackId}/beats`);
  const d = res.data || {};
  return {
    status: (d.status as BeatStatus) || 'pending',
    tempo: typeof d.tempo === 'number' ? d.tempo : null,
    beats: Array.isArray(d.beats) ? d.beats : [],
    downbeats: Array.isArray(d.downbeats) ? d.downbeats : [],
    started_at: d.started_at ?? null,
    completed_at: d.completed_at ?? null,
    error: d.error ?? null,
  };
};

export const retryTrackBeats = async (
  trackId: string
): Promise<{ message?: string; status?: string }> => {
  console.log('[beatsService] 비트 재추출 요청:', trackId);
  const res = await api.post(`/tracks/${trackId}/beats/retry`);
  return res.data;
};
