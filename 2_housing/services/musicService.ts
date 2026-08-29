import { Platform } from 'react-native';
import api, { BACKEND_BASE_URL } from './api';
import { useAuthStore } from '../stores/authStore';
import {
  GenerationItem,
  GenerationListResult,
  MusicParams,
  ReferenceUploadResult,
} from '../types';

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

// 파일 확장자 기반 mime 추정 — 백엔드 upload-reference는 확장자만 강제(.mp3/.wav/.m4a/.ogg/.flac)
function guessAudioMime(fileName: string): string {
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  const map: Record<string, string> = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    ogg: 'audio/ogg',
    flac: 'audio/flac',
  };
  return map[ext] || 'audio/mpeg';
}

/**
 * v3.91: 참고 음악 업로드 — POST /generate/upload-reference/ (multipart 필드명 'file').
 * 계약(backend_9004 generate.py:242 upload_reference_audio):
 *   허용 확장자 .mp3/.wav/.m4a/.ogg/.flac, 최대 50MB, 최대 480초(8분) — 위반 시 400 { error }
 *   응답: { upload_url(presigned 24h), object_name, filename, duration_sec }
 * 생성 body에는 upload_url을 reference_audio_url로 전달한다(MAIDOL StudioTab2 관행).
 * web/native FormData 분기는 voiceService.appendAudioFile 패턴 재사용.
 */
export const uploadReferenceAudio = async (
  fileUri: string,
  fileName: string
): Promise<ReferenceUploadResult> => {
  const formData = new FormData();
  if (Platform.OS === 'web') {
    // web: 표준 FormData는 Blob/File만 허용
    const res = await fetch(fileUri);
    const blob = await res.blob();
    formData.append('file', blob, fileName);
  } else {
    // native: RN 확장 문법
    formData.append('file', {
      uri: fileUri,
      name: fileName,
      type: guessAudioMime(fileName),
    } as any);
  }
  console.log('[Suno] 참고 음악 업로드 시작:', fileName);
  const response = await api.post('/generate/upload-reference/', formData, {
    headers: Platform.OS === 'web' ? undefined : { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  });
  console.log('[Suno] 참고 음악 업로드 완료:', JSON.stringify({
    object_name: response.data?.object_name,
    duration_sec: response.data?.duration_sec,
  }));
  return response.data;
};

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
  const en: Record<'genre' | 'mood' | 'style', string> = {
    genre: toEnglish(params.genre || '', GENRE_EN),
    mood: toEnglish(params.mood || '', MOOD_EN),
    style: toEnglish(params.style || '', STYLE_EN),
  };

  // v3.91: 매핑 테이블에 없는 한글 잔존 태그만 모아 생성 직전 1회 번역.
  // 계약(backend_9004 generate.py:312 translate_tags): POST /generate/translate-tags
  //   요청 { tags: string[] } → 응답 { translated: string[] } (태그 1개가 여러 파트로 확장될 수 있음)
  // 번역 실패가 생성을 막으면 안 됨 — 실패/불일치 시 기존 폴백(한국어 원문 그대로) 유지.
  const unmappedKeys: Array<'genre' | 'mood' | 'style'> = [];
  const unmappedValues: string[] = [];
  if (params.genre && !GENRE_EN[params.genre]) { unmappedKeys.push('genre'); unmappedValues.push(params.genre); }
  if (params.mood && !MOOD_EN[params.mood]) { unmappedKeys.push('mood'); unmappedValues.push(params.mood); }
  if (params.style && !STYLE_EN[params.style]) { unmappedKeys.push('style'); unmappedValues.push(params.style); }
  if (unmappedValues.length > 0) {
    try {
      console.log('[Suno] translate-tags 요청:', JSON.stringify(unmappedValues));
      const res = await api.post('/generate/translate-tags', { tags: unmappedValues }, { timeout: 30000 });
      const translated: string[] = Array.isArray(res.data?.translated) ? res.data.translated : [];
      if (unmappedKeys.length === 1) {
        // 태그 1개 → 확장된 파트 전부를 해당 필드에 반영 (예: "몽환적이고 신나는" → "Dreamy, Exciting")
        const joined = translated.filter(Boolean).join(', ');
        if (joined) en[unmappedKeys[0]] = joined;
      } else if (translated.length === unmappedKeys.length) {
        unmappedKeys.forEach((k, i) => { if (translated[i]) en[k] = translated[i]; });
      } else {
        console.warn('[Suno] translate-tags 결과 개수 불일치 — 원문 유지', JSON.stringify({ in: unmappedKeys.length, out: translated.length }));
      }
      console.log('[Suno] translate-tags 적용:', JSON.stringify(en));
    } catch (err: any) {
      console.warn('[Suno] translate-tags 실패 — 원문 유지:', err?.response?.status, err?.message);
    }
  }

  const genreEn = en.genre;
  const moodEn = en.mood;
  const styleEn = en.style;

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
    // 내 목소리 페르소나 — persona_id 있을 때만 서버 기대값('style_persona'|'voice_persona')으로 변환 전송
    persona_id: params.personaId || undefined,
    persona_model: params.personaId
      ? (params.personaModel === 'style' ? 'style_persona' : 'voice_persona')
      : undefined,
    model: 'suno',
    duration: 120,
    start_music_gen: true,
    // v3.91: 참고 음악(업로드 선행) — 백엔드 GenerateRequest 실필드
    //   reference_audio_url / reference_audio_name / reference_audio_duration / audio_weight (generate.py:74~78)
    audio_weight: params.audioWeight ?? undefined,
    reference_audio_url: params.referenceData?.upload_url || undefined,
    reference_audio_name: params.referenceData?.filename || undefined,
    reference_audio_duration: params.referenceData?.duration_sec || undefined,
  };
  console.log('[Suno] API 호출:', JSON.stringify({
    title: body.title, genre: body.genre, mood: body.mood, vocal: body.vocal, style: body.style,
    audio_weight: body.audio_weight, reference_audio_name: body.reference_audio_name,
  }));
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

/**
 * v3.93: 생성 이력 목록 — GET /generate/ (backend_9004 generate.py:649 list_generations)
 * 쿼리: page(1~)/limit/status(옵션: pending|processing|completed|failed), created_at 내림차순 고정.
 * 응답: { generations: [...], pagination: { page, limit, total, totalPages } }
 */
export const listGenerations = async (
  page = 1,
  limit = 20,
  status?: string
): Promise<GenerationListResult> => {
  console.log('[musicService] 생성 이력 조회:', JSON.stringify({ page, limit, status }));
  const response = await api.get('/generate/', {
    params: { page, limit, ...(status ? { status } : {}) },
  });
  console.log('[musicService] 생성 이력 응답:', JSON.stringify({
    count: response.data?.generations?.length,
    total: response.data?.pagination?.total,
  }));
  return response.data;
};

/**
 * v3.93: 생성 기록 삭제 — DELETE /generate/{id} (generate.py:801 delete_generation)
 * 상태 제한 없음(진행중/완료/실패 모두 허용, 소유자 검사만). 응답: { message }
 */
export const deleteGeneration = async (genId: string) => {
  console.log('[musicService] 생성 기록 삭제:', genId);
  const response = await api.delete(`/generate/${genId}`);
  console.log('[musicService] 생성 기록 삭제 완료:', genId);
  return response.data;
};

/**
 * v3.93: 생성물 클립 스트림 URL — GET /generate/{id}/stream/?variant=N (generate.py:893)
 * variant 0 = 첫 클립(BC: result_audio_url 폴백), 1+ = variants[N].audio_url.
 * expo-av/<audio>는 헤더를 못 붙이므로 ?token= 쿼리 인증(voiceService.personaVocalStreamUrl 관행).
 */
export const generationStreamUrl = (genId: string, variant = 0): string => {
  const token = useAuthStore.getState().token;
  const base = `${BACKEND_BASE_URL}/api/generate/${genId}/stream/`;
  const parts: string[] = [];
  if (variant > 0) parts.push(`variant=${variant}`);
  if (token) parts.push(`token=${encodeURIComponent(token)}`);
  return parts.length > 0 ? `${base}?${parts.join('&')}` : base;
};

/** v3.93: 이력 항목 상태 라벨/유형 판별 헬퍼 (화면 공용) */
export const isGenerationInProgress = (g: Pick<GenerationItem, 'status'>): boolean =>
  g.status === 'pending' || g.status === 'processing';

export const getVoiceModels = async () => {
  const response = await api.get('/kits/voice-models');
  return response.data;
};
