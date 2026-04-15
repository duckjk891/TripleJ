import api from './api';
import { MusicParams } from '../types';

// 프론트엔드 한국어 보컬(성별+스타일) → 백엔드 SUNO_VOCAL_MAP 키 매핑
const VOCAL_KEY_MAP: Record<string, Record<string, string>> = {
  '남성 보컬': {
    '소프트': 'male_soft',
    '파워풀': 'male_powerful',
    '위스퍼': 'male_warm',
    '그루비': 'male_husky',
    '클리어': 'male_soft',
    '': 'male_warm',
  },
  '여성 보컬': {
    '소프트': 'female_warm',
    '파워풀': 'female_powerful',
    '위스퍼': 'female_warm',
    '그루비': 'female_husky',
    '클리어': 'female_sweet',
    '': 'female_warm',
  },
  '혼성 보컬': {
    '소프트': 'female_warm',
    '파워풀': 'male_powerful',
    '위스퍼': 'female_warm',
    '그루비': 'male_husky',
    '클리어': 'female_sweet',
    '': 'female_warm',
  },
};

function mapVocalKey(gender: string, style: string): string {
  if (!gender) return '';
  const genderMap = VOCAL_KEY_MAP[gender];
  if (!genderMap) return '';
  return genderMap[style] || genderMap[''] || '';
}

export const generateWithSuno = async (params: Partial<MusicParams>) => {
  const promptParts = [];
  if (params.genre) promptParts.push(`${params.genre} 장르의`);
  if (params.mood) promptParts.push(`${params.mood} 분위기로,`);
  if (params.vocal) promptParts.push(`${params.vocal} 보컬이 부르는`);
  promptParts.push('곡을 생성합니다.');
  if (params.bpm) promptParts.push(`템포는 ${params.bpm} BPM입니다.`);
  if (params.musicalKey) promptParts.push(`키는 ${params.musicalKey}입니다.`);
  if (params.negativeTags) promptParts.push(`제외할 스타일: ${params.negativeTags}`);
  if (params.style) promptParts.push(`스타일: ${params.style}`);
  if (params.referenceStyle) promptParts.push(`참고 스타일: ${params.referenceStyle}`);

  const prompt = promptParts.join(' ');

  // 한국어 보컬 성별+스타일 → 백엔드 키 변환
  const vocalKey = mapVocalKey(params.vocal || '', params.vocalStyle || '');

  // style + referenceStyle 합침 (genre, mood는 영문으로 별도 필드 전달 → 백엔드 suno_generator가 합침)
  const combinedStyle = [params.style, params.referenceStyle].filter(Boolean).join(', ');

  // 작사에서 생성된 제목 우선, 없으면 장르+분위기로 자동 생성
  const title = params.title
    || (params.genre && params.mood ? `${params.genre} - ${params.mood}` : params.genre || params.mood || undefined);

  const body = {
    prompt,
    title,
    lyrics: params.lyrics || '',
    genre: params.genre || '',
    mood: params.mood || '',
    vocal: vocalKey || (params.vocal === '' ? 'instrumental' : ''),
    style: combinedStyle || undefined,
    reference_style: params.referenceStyle || undefined,
    bpm: params.bpm ? parseInt(params.bpm) : undefined,
    key: params.musicalKey || undefined,
    negative_tags: params.negativeTags || undefined,
    model: 'suno',
    duration: 120,
    start_music_gen: true,
  };
  console.log('[Suno] API 호출:', JSON.stringify({ title: body.title, genre: body.genre, mood: body.mood, vocal: body.vocal, style: body.style }));
  const response = await api.post('/generate/', body);
  return response.data;
};

export const generateWithWondera = async (params: Partial<MusicParams>) => {
  // Wondera API는 prompt 필드에 스타일/장르/분위기를 설명
  const promptParts = [];
  if (params.genre) promptParts.push(params.genre);
  if (params.mood) promptParts.push(params.mood);
  if (params.style) promptParts.push(params.style);
  if (params.referenceStyle) promptParts.push(params.referenceStyle);
  if (params.tempo && params.tempo !== '보통') promptParts.push(`${params.tempo} 템포`);
  const prompt = promptParts.length > 0
    ? promptParts.join(', ') + ' 분위기의 음악'
    : undefined;

  const response = await api.post('/wondera/generate', {
    lyrics: params.lyrics || '',
    model: 'auto',
    prompt: prompt || undefined,
  });
  return response.data;
};

export const getGenerationStatus = async (genId: string) => {
  const response = await api.get(`/generate/${genId}`);
  return response.data;
};

export const getVoiceModels = async () => {
  const response = await api.get('/kits/voice-models');
  return response.data;
};
