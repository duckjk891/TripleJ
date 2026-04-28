import api from './api';
import { MusicParams } from '../types';

// 한국어 장르 → Suno 영문 태그 (매핑 가능한 값)
const GENRE_EN: Record<string, string> = {
  '댄스': 'Dance Pop', '발라드': 'K-Ballad', '힙합': 'K-Hip-hop',
  'R&B': 'K-R&B', '트로트': 'Trot', '인디': 'Indie', '록': 'Rock',
  '포크': 'Folk', '인디팝': 'Indie Pop', '시티팝': 'City Pop',
  '재즈': 'Jazz', 'EDM': 'EDM', '클래식': 'Classical',
  '가요': 'K-Pop', 'BGM': 'Ambient BGM', '팝': 'Pop', '일렉트로닉': 'Electronic',
};

// 한국어 분위기 → Suno 영문 태그
const MOOD_EN: Record<string, string> = {
  '밝고 경쾌한': 'Bright, Upbeat', '슬프고 우울한': 'Sad, Melancholic',
  '몽환적·신비로운': 'Dreamy, Ethereal', '에너지틱·강렬한': 'Energetic, Intense',
  '로맨틱·달콤한': 'Romantic, Sweet', '그리운·따뜻한': 'Nostalgic, Warm',
  '잔잔하고 편안한': 'Calm, Relaxing', '흥겹고 신나는': 'Exciting, Groovy',
};

// 한국어 스타일 → Suno 영문 태그
const STYLE_EN: Record<string, string> = {
  '어쿠스틱': 'Acoustic', '피아노 발라드': 'Piano Ballad', '일렉트로닉': 'Electronic',
  '밴드 사운드': 'Band Sound', '오케스트라': 'Orchestral', '로파이': 'Lo-fi',
  '레트로': 'Retro', '트로피컬': 'Tropical',
};

// 매핑 테이블에 없는 값은 한국어 그대로 전달 (백엔드 music_generator가 번역)
function toEnglish(value: string, map: Record<string, string>): string {
  if (!value) return '';
  return map[value] || value; // 매핑 있으면 영어, 없으면 원본 유지
}

// 프론트엔드 한국어 보컬(성별+스타일) → 백엔드 SUNO_VOCAL_MAP 키 매핑
const VOCAL_KEY_MAP: Record<string, Record<string, string>> = {
  '남성': {
    '소프트': 'male_soft',
    '파워풀': 'male_powerful',
    '위스퍼': 'male_warm',
    '그루비': 'male_husky',
    '클리어': 'male_soft',
    '허스키': 'male_husky',
    '': 'male_warm',
  },
  '여성': {
    '소프트': 'female_warm',
    '파워풀': 'female_powerful',
    '위스퍼': 'female_warm',
    '그루비': 'female_husky',
    '클리어': 'female_sweet',
    '허스키': 'female_husky',
    '': 'female_warm',
  },
  '혼성 (듀엣)': {
    '소프트': 'female_warm',
    '파워풀': 'male_powerful',
    '위스퍼': 'female_warm',
    '그루비': 'male_husky',
    '클리어': 'female_sweet',
    '허스키': 'male_husky',
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

  // 한국어 → 영문 매핑 (매핑 가능한 값)
  const genreEn = toEnglish(params.genre || '', GENRE_EN);
  const moodEn = toEnglish(params.mood || '', MOOD_EN);
  const styleEn = toEnglish(params.style || '', STYLE_EN);

  // 보컬 처리
  const isDuet = params.isDuet || false;
  const mainVocalKey = mapVocalKey(params.vocal || '', params.vocalStyle || '');

  // style 합성
  const styleParts = [styleEn, params.referenceStyle];
  if (isDuet && params.subVocal) {
    // 서브 보컬 키 조회 → 영문 스타일 태그로 변환
    const subVocalKey = mapVocalKey(params.subVocal, params.subVocalStyle || '');
    const subVocalMap: Record<string, string> = {
      'male_warm': 'soft male duet vocal, warm',
      'male_powerful': 'powerful male duet vocal, belted',
      'male_husky': 'raspy male duet vocal, husky',
      'male_soft': 'gentle male duet vocal, soft',
      'female_warm': 'soft female duet vocal, breathy',
      'female_powerful': 'powerful female duet vocal, belted',
      'female_husky': 'raspy female duet vocal, husky',
      'female_sweet': 'sweet female duet vocal, melodic',
    };
    const subTag = subVocalMap[subVocalKey] || `${params.subVocal} duet vocal`;
    styleParts.push(`${subTag}, duet harmonized`);
  }
  const combinedStyle = styleParts.filter(Boolean).join(', ');

  // 작사에서 생성된 제목 우선
  const title = params.title
    || (params.genre && params.mood ? `${params.genre} - ${params.mood}` : params.genre || params.mood || undefined);

  const body = {
    prompt,
    title,
    lyrics: params.lyrics || '',
    genre: genreEn,
    mood: moodEn,
    vocal: mainVocalKey || (params.vocal === '' ? 'instrumental' : ''),
    style: combinedStyle || undefined,
    reference_style: params.referenceStyle || undefined,
    bpm: params.bpm ? parseInt(params.bpm) : undefined,
    key: params.musicalKey || undefined,
    negative_tags: params.negativeTags || undefined,
    persona_model: params.personaModel || undefined,
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
