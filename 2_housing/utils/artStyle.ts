// v3.80: 가상화(그림) 캐릭터 화풍 샘플 공용 헬퍼
// GET /api/character/style-samples — 무인증·무비용. ArtistInput(화풍 선택)·ArtistResult(배지)·CoverGeneration(슬롯 라벨)에서 공유.
import api from '../services/api';

export interface StyleSample {
  key: string;        // 'webtoon' | 'anime' | 'manga90'
  label: string;      // '웹툰' | '애니' | '90년대 만화'
  art_style: string;  // 'Korean webtoon style' 등 — 서버 job.art_style로 돌아올 수도 있음
  preview_url: string; // BACKEND_BASE_URL 붙여서 사용 (PNG ~2.7MB)
}

let cachedSamples: StyleSample[] | null = null;

export async function fetchStyleSamples(force = false): Promise<StyleSample[]> {
  if (cachedSamples && !force) return cachedSamples;
  const res = await api.get('/character/style-samples');
  const samples: StyleSample[] = res.data?.samples || [];
  if (samples.length > 0) cachedSamples = samples;
  return samples;
}

/** art_style 값(키/영문 스타일명/'custom')을 표시용 한글 라벨로. 실패 시 키 그대로. */
export function resolveArtStyleLabel(
  artStyle: string | null | undefined,
  samples: StyleSample[] | null,
): string {
  if (!artStyle) return '';
  if (artStyle === 'custom') return '직접 업로드';
  const hit = samples?.find((s) => s.key === artStyle || s.art_style === artStyle);
  return hit?.label || artStyle;
}
