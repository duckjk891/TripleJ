import api from './api';

// v3.110 — 백엔드 LyricsRequest(routes/generate.py) 계약과 1:1 매핑.
// prompt = 곡 설명(주제·시점·구조 태그·키워드·추가요청), 나머지는 구조화 필드.
export const generateLyrics = async (params: {
  prompt: string;
  genre?: string;
  mood?: string;
  language?: string; // 'ko' | 'en'
  style?: string;
  duration_minutes?: number;
  duet?: boolean;
  duet_main_vocal_style?: string;
  duet_sub_vocal_style?: string;
  // v3.127 (B-12) — 서버 v229 구조화 필드
  structure?: string;
  english_ratio?: number;
  has_rap?: boolean;
}) => {
  const response = await api.post('/generate/lyrics/', params);
  return response.data;
};

// ── v3.127 (B-2) 가사 자산(서버 보관함) — backend /api/lyrics CRUD ──────────
export interface LyricsAsset {
  lyrics_id: string;
  title: string;
  content: string;
  genre?: string | null;
  mood?: string | null;
  source: 'ai' | 'manual';
  created_at: string;
}

export const saveLyricsAsset = async (params: {
  title: string;
  content: string;
  genre?: string;
  mood?: string;
  source?: 'ai' | 'manual';
}): Promise<{ lyrics_id: string }> => {
  const response = await api.post('/lyrics', params);
  return response.data;
};

export const listLyricsAssets = async (): Promise<LyricsAsset[]> => {
  const response = await api.get('/lyrics');
  return response.data?.items ?? [];
};

export const deleteLyricsAsset = async (lyricsId: string): Promise<void> => {
  await api.delete(`/lyrics/${lyricsId}`);
};
