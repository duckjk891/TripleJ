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
}) => {
  const response = await api.post('/generate/lyrics/', params);
  return response.data;
};
