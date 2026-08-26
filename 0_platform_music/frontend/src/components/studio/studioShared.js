// v209 2단계 — StudioTab2 공용 순수부 추출 (작사실 LyricsStudioTab / 작곡실 ComposeStudioTab 공용).
// 상수·순수 헬퍼만 — React 비의존. getTranslatedValues 만 api.translateTags 호출(실패 시 원본 유지).
// 주의: 같은 디렉토리의 studioConfig.js 는 구 「작업실」(StudioTab) 게임 맵 설정 — 이 파일과 무관.
import * as api from '../../api';

export const LYRICS_MODELS = [
  { id: 'gpt-4o-mini', name: 'GPT-4o-mini', color: '#00d4aa', inPrice: '$0.15/M', outPrice: '$0.60/M', perCall: '$0.003', perCallKRW: '≈4원' },
  { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', color: '#a855f7', inPrice: '$5.00/M', outPrice: '$25.00/M', perCall: '$0.10', perCallKRW: '≈140원' },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', color: '#3b82f6', inPrice: '$3.00/M', outPrice: '$15.00/M', perCall: '$0.06', perCallKRW: '≈84원' },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', color: '#f59e0b', inPrice: '$1.00/M', outPrice: '$5.00/M', perCall: '$0.02', perCallKRW: '≈28원' },
  { id: 'gpt-5.4-mini', name: 'GPT-5.4 mini', color: '#10b981', inPrice: '$0.75/M', outPrice: '$4.50/M', perCall: '$0.015', perCallKRW: '≈21원' },
  { id: 'claude-opus-4-7', name: 'Claude Opus 4.7', color: '#e11d48', inPrice: '$5.00/M', outPrice: '$25.00/M', perCall: '$0.10', perCallKRW: '≈140원' },
];

// 장르: 음악의 카테고리 (어떤 종류의 음악인지)
export const GENRE_PRESETS = [
  { label: '팝', value: 'Pop' },
  { label: '케이팝', value: 'K-Pop' },
  { label: '시티팝', value: 'City-Pop' },
  { label: '힙합', value: 'Hip-hop' },
  { label: '알앤비', value: 'R&B' },
  { label: '록', value: 'Rock' },
  { label: '일렉트로닉', value: 'Electronic' },
  { label: '이디엠', value: 'EDM' },
  { label: '하우스', value: 'House' },
  { label: '테크노', value: 'Techno' },
  { label: '트랜스', value: 'Trance' },
  { label: '덥스텝', value: 'Dubstep' },
  { label: '드럼앤베이스', value: 'Drum and Bass' },
  { label: '트랩', value: 'Trap' },
  { label: '로파이', value: 'Lo-fi' },
  { label: '재즈', value: 'Jazz' },
  { label: '블루스', value: 'Blues' },
  { label: '클래식', value: 'Classical' },
  { label: '오페라', value: 'Opera' },
  { label: '앰비언트', value: 'Ambient' },
  { label: '시네마틱', value: 'Cinematic' },
  { label: '포크', value: 'Folk' },
  { label: '컨트리', value: 'Country' },
  { label: '레게', value: 'Reggae' },
  { label: '레게톤', value: 'Reggaeton' },
  { label: '메탈', value: 'Metal' },
  { label: '펑크', value: 'Punk' },
  { label: '그런지', value: 'Grunge' },
  { label: '소울', value: 'Soul' },
  { label: '펑크(Funk)', value: 'Funk' },
  { label: '가스펠', value: 'Gospel' },
  { label: '아프로비트', value: 'Afrobeat' },
  { label: '보사노바', value: 'Bossa Nova' },
  { label: '살사', value: 'Salsa' },
  { label: '신스웨이브', value: 'Synthwave' },
  { label: '발라드', value: 'Ballad' },
  { label: '댄스', value: 'Dance' },
  { label: '인디', value: 'Indie' },
  { label: '트로트', value: 'Trot' },
];

// 분위기: 음악이 주는 감정/느낌 (어떤 기분의 음악인지)
export const MOOD_PRESETS = [
  { label: '에너지틱', value: 'Energetic' },
  { label: '칠', value: 'Chill' },
  { label: '다크', value: 'Dark' },
  { label: '행복', value: 'Happy' },
  { label: '슬픔', value: 'Sad' },
  { label: '서사적', value: 'Epic' },
  { label: '로맨틱', value: 'Romantic' },
  { label: '몽환적', value: 'Dreamy' },
  { label: '공격적', value: 'Aggressive' },
  { label: '평화로운', value: 'Peaceful' },
  { label: '향수', value: 'Nostalgic' },
  { label: '펑키', value: 'Funky' },
  { label: '우울', value: 'Melancholic' },
  { label: '유포릭', value: 'Euphoric' },
  { label: '으스스한', value: 'Haunting' },
  { label: '기쁨', value: 'Joyful' },
  { label: '강렬', value: 'Intense' },
  { label: '희망적', value: 'Uplifting' },
  { label: '미스터리', value: 'Mysterious' },
  { label: '친밀한', value: 'Intimate' },
  { label: '승리감', value: 'Triumphant' },
  { label: '장난스러운', value: 'Playful' },
];

// 스타일: 음악의 질감/프로덕션 (어떤 느낌으로 만들지)
export const STYLE_PRESETS = [
  { label: '로파이', value: 'Lo-fi' },
  { label: '세련된', value: 'Polished' },
  { label: '거친', value: 'Gritty' },
  { label: '날것', value: 'Raw' },
  { label: '따뜻한', value: 'Warm' },
  { label: '선명한', value: 'Crisp' },
  { label: '빈티지', value: 'Vintage' },
  { label: '모던', value: 'Modern' },
  { label: '몽환적', value: 'Atmospheric' },
  { label: '미니멀', value: 'Minimal' },
  { label: '풍성한', value: 'Lush' },
  { label: '어쿠스틱', value: 'Acoustic' },
  { label: '시네마틱', value: 'Cinematic' },
  { label: '오케스트라', value: 'Orchestral' },
  { label: '펀치감', value: 'Punchy' },
  { label: '밝은', value: 'Bright' },
  { label: '절제된', value: 'Sparse' },
];

// value(영어)로부터 한글 label을 찾는 헬퍼 (직접 입력 값은 그대로 반환)
const _genreLabelMap = Object.fromEntries(GENRE_PRESETS.map((p) => [p.value, p.label]));
const _moodLabelMap = Object.fromEntries(MOOD_PRESETS.map((p) => [p.value, p.label]));
const _styleLabelMap = Object.fromEntries(STYLE_PRESETS.map((p) => [p.value, p.label]));
export const getGenreLabel = (v) => _genreLabelMap[v] || v;
export const getMoodLabel = (v) => _moodLabelMap[v] || v;
export const getStyleLabel = (v) => _styleLabelMap[v] || v;

// v158 — 별 경제 v1.2 소비 가격 기본값 (GET /points/costs 로드 실패 시 폴백)
export const DEFAULT_POINT_COSTS = { lyrics: 5, compose: 15, cover: 5, character: 10, fatigue_skip: 5 };
// v158 — 디렉터 피로 사다리 기본값(시간) — status.ladder 부재 시 폴백 (1곡째 2h/2곡째 4h/3곡째 8h/4곡째+ 12h)
export const DEFAULT_FATIGUE_LADDER_HOURS = [2, 4, 8, 12];

// v158 — 쿨다운 남은 시간 포맷: 1시간 미만 mm:ss, 이상 h:mm:ss
export const formatCooldown = (sec) => {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${String(m).padStart(2, '0')}:${ss}`;
};

// v158 — status.ladder 를 시간(hours) 배열로 정규화.
// BE 확정 스펙: {"1":2,"2":4,"3":8,"4+":12} (키 = n곡째, "+" 접미 허용). 숫자 배열도 수용.
export const normalizeLadderHours = (ladder) => {
  if (Array.isArray(ladder) && ladder.length > 0) {
    const hours = ladder.filter((v) => typeof v === 'number' && v > 0);
    if (hours.length > 0) return hours;
  }
  if (ladder && typeof ladder === 'object') {
    const entries = Object.entries(ladder)
      .map(([k, v]) => [parseInt(String(k).replace('+', ''), 10), Number(v)])
      .filter(([n, h]) => Number.isFinite(n) && Number.isFinite(h) && h > 0)
      .sort((a, b) => a[0] - b[0]);
    if (entries.length > 0) return entries.map(([, h]) => h);
  }
  return DEFAULT_FATIGUE_LADDER_HOURS;
};

// 직접 입력된 태그를 프리셋 value로 매칭 (label 또는 value 대소문자 무시)
export const resolveCustomTag = (input, presets) => {
  const lower = input.toLowerCase();
  const byLabel = presets.find((p) => p.label.toLowerCase() === lower);
  if (byLabel) return byLabel.value;
  const byValue = presets.find((p) => p.value.toLowerCase() === lower);
  if (byValue) return byValue.value;
  return null; // 매칭 안 됨 → 번역 필요
};

// 선택된 값 중 프리셋에 없는 커스텀 태그를 번역하여 최종 문자열 반환
export const getTranslatedValues = async (selected, presets) => {
  if (selected.length === 0) return null;
  const presetValues = new Set(presets.map((p) => p.value));
  const preset = selected.filter((v) => presetValues.has(v));
  const custom = selected.filter((v) => !presetValues.has(v));

  if (custom.length === 0) return selected.join(', ') || null;

  try {
    const { data } = await api.translateTags(custom);
    return [...preset, ...(data.translated || custom)].join(', ') || null;
  } catch {
    return selected.join(', ') || null; // 번역 실패 시 원본 유지
  }
};

export const VOCAL_PRESETS = [
  { value: '', label: '자동 선택' },
  { value: 'male_warm', label: '남성 - 따뜻한' },
  { value: 'male_powerful', label: '남성 - 파워풀' },
  { value: 'male_soft', label: '남성 - 부드러운' },
  { value: 'female_sweet', label: '여성 - 감미로운' },
  { value: 'female_powerful', label: '여성 - 파워풀' },
  { value: 'female_husky', label: '여성 - 허스키' },
];

export const MODEL_OPTIONS = [
  { id: 'suno', name: 'Suno', desc: 'AI 음악 생성 서비스 (고품질 보컬 + 반주)' },
  { id: 'wondera', name: 'Wondera', desc: 'AI 음악 코파일럿 (다양한 참조 옵션)' },
];

export const STRUCTURE_TAGS = ['[Verse]', '[Chorus]', '[Bridge]', '[Outro]', '[Intro]', '[Pre-Chorus]', '[Instrumental]'];

export const DEFAULT_LYRICS = `[Verse]
새벽 공기를 마시며 걸어가는 이 길
어제의 나를 두고 오늘을 시작해
흐릿한 가로등 아래 긴 그림자 하나
조용히 나를 따라와

[Chorus]
괜찮아 천천히 가도 돼
멈춰도 돼 쉬어가도 돼
이 길의 끝에 뭐가 있든
지금 이 한 걸음이면 돼

[Verse]
창문 너머로 보이는 하늘은 여전히
어제와 같은 색인데
내 마음만 달라져 있어
작은 용기 하나 품고서

[Chorus]
괜찮아 천천히 가도 돼
멈춰도 돼 쉬어가도 돼
이 길의 끝에 뭐가 있든
지금 이 한 걸음이면 돼

[Outro]
한 걸음 또 한 걸음
나는 걸어가고 있어`;

export const WONDERA_MODELS = [
  { value: 'auto', label: 'Auto (자동 선택)' },
  { value: 'wondera-2.1', label: 'Wondera 2.1' },
  { value: 'wondera-2.2', label: 'Wondera 2.2' },
  { value: 'wondera-o1', label: 'Wondera O1' },
  { value: 'wondera-o2', label: 'Wondera O2' },
];

// v209 — 작사 draft 판별 (서버 확정 시그니처 — generate.py PATCH 가드와 동일: pending && point_ref 없음 && result_audio_url 없음).
// 구 StudioTab2 isDraft(progress 기반)보다 정확 — 선차감 직후 pending 상태의 실제 작곡(point_ref 有)을 draft 로 오분류하지 않는다.
export const isLyricsDraft = (gen) =>
  gen?.status === 'pending' && !gen?.point_ref && !gen?.result_audio_url;

// ─── Build Prompt Preview (StudioTab2 :965-1072 — 순수 함수, params 와 위 상수만 참조) ───
export const buildPromptPreview = (model, params) => {
  const lines = [];

  if (model === 'suno') {
    // First sentence: genre + mood + vocal
    const genreStr = params.genre || '';
    const moodStr = params.mood || '';
    const vocalLabel = (() => {
      if (params.isInstrumental) return null;
      const preset = VOCAL_PRESETS.find((v) => v.value === params.vocal);
      return preset && preset.value ? preset.label : null;
    })();

    let firstSentence = '';
    const parts = [];
    if (genreStr) parts.push(`${genreStr} 장르의`);
    if (moodStr) parts.push(`${moodStr}한 분위기로,`);

    if (params.isInstrumental) {
      if (parts.length > 0) {
        firstSentence = `${parts.join(' ')} 연주곡(Instrumental)을 생성합니다.`;
      } else {
        firstSentence = '연주곡(Instrumental)을 생성합니다.';
      }
    } else if (vocalLabel) {
      if (parts.length > 0) {
        firstSentence = `${parts.join(' ')} ${vocalLabel} 보컬이 부르는 곡을 생성합니다.`;
      } else {
        firstSentence = `${vocalLabel} 보컬이 부르는 곡을 생성합니다.`;
      }
    } else {
      if (parts.length > 0) {
        firstSentence = `${parts.join(' ')} 곡을 생성합니다.`;
      } else {
        firstSentence = '곡을 생성합니다.';
      }
    }
    lines.push(firstSentence);

    if (params.isDuet) {
      const mainGenderLabel = params.duetMainGender === 'm' ? '남성' : '여성';
      const subGenderLabel = params.duetMainGender === 'm' ? '여성' : '남성';
      let duetLine = '남녀 혼성 듀엣 곡으로 생성합니다.';
      if (params.duetMainStyle || params.duetSubStyle) {
        const mainPart = params.duetMainStyle ? `주 보컬(${mainGenderLabel}): ${params.duetMainStyle}` : '';
        const subPart = params.duetSubStyle ? `상대 보컬(${subGenderLabel}): ${params.duetSubStyle}` : '';
        const styleParts = [mainPart, subPart].filter(Boolean).join(' / ');
        duetLine = `남녀 혼성 듀엣 곡으로 생성합니다. ${styleParts}`;
      }
      lines.push(duetLine);
    }

    // BPM + Key line
    const bpmValue = model === 'suno' ? (params.bpmOn ? params.bpmVal : null) : params.bpm;
    const keyValue = model === 'suno' ? (params.keyOn ? params.keyVal : null) : params.musicalKey;
    if (bpmValue && keyValue) {
      lines.push(`템포는 ${bpmValue} BPM, 키는 ${keyValue}입니다.`);
    } else if (bpmValue) {
      lines.push(`템포는 ${bpmValue} BPM입니다.`);
    } else if (keyValue) {
      lines.push(`키는 ${keyValue}입니다.`);
    }

    // Model-specific info
    if (model === 'suno') {
      if (params.negativeTagsOn && params.negativeTagsVal) lines.push(`제외할 스타일로 ${params.negativeTagsVal}이(가) 지정되어 있습니다.`);
      if (params.styleWeightOn && params.styleWeightVal) lines.push(`스타일 가중치는 ${params.styleWeightVal}로 설정되어 있습니다.`);
      if (params.weirdnessOn && params.weirdnessVal) lines.push(`창의성(Weirdness)은 ${params.weirdnessVal}로 설정되어 있습니다.`);
      if (params.audioWeightOn && params.audioWeightVal) lines.push(`오디오 가중치는 ${params.audioWeightVal}로 설정되어 있습니다.`);
      if (params.personaModelOn && params.personaModelVal) lines.push(`페르소나 모델은 ${params.personaModelVal === 'voice_persona' ? 'Voice Persona' : 'Style Persona'}로 설정되어 있습니다.`);
    }

    if (params.style) {
      lines.push(`추가 스타일 설명으로 "${params.style}"이(가) 포함되어 있습니다.`);
    }
    if (params.referenceText) {
      lines.push(`참고할 스타일로 "${params.referenceText}"이(가) 지정되어 있습니다.`);
    }
    if (params.referenceData) {
      lines.push(`업로드한 참고 음악(${params.referenceData.filename}, ${Math.round(params.referenceData.duration_sec)}초)의 스타일을 참고하여 생성합니다.`);
    }
  } else if (model === 'wondera') {
    const modelLabel = WONDERA_MODELS.find((m) => m.value === params.wonderaModel)?.label || params.wonderaModel;
    lines.push(`Wondera ${modelLabel} 모델로 ${params.wonderaNumber || 2}곡을 생성합니다.`);
    if (params.wonderaPrompt && !params.wonderaReferenceData && !params.wonderaMelodyData) {
      lines.push(`추가 스타일 설명으로 "${params.wonderaPrompt}"이(가) 포함되어 있습니다.`);
    }
    if (params.wonderaReferenceData) {
      lines.push(`업로드한 참고 음악(${params.wonderaReferenceData.name || params.wonderaReferenceData.filename || '파일'})의 스타일을 참고하여 생성합니다.`);
    }
    if (params.wonderaVocalData) {
      lines.push(`업로드한 참고 보컬(${params.wonderaVocalData.name || params.wonderaVocalData.filename || '파일'})이 적용됩니다.`);
    }
    if (params.wonderaMelodyData) {
      lines.push(`업로드한 참고 멜로디(${params.wonderaMelodyData.name || params.wonderaMelodyData.filename || '파일'})가 적용됩니다.`);
    }
    if (params.wonderaEnableStream) {
      lines.push('실시간 스트리밍이 활성화되어 있습니다.');
    }
  } else {
    lines.push(`${model} 모델로 곡을 생성합니다.`);
    if (params.style) {
      lines.push(`추가 스타일 설명으로 "${params.style}"이(가) 포함되어 있습니다.`);
    }
  }

  return lines.join('\n');
};

export const formatDuration = (sec) => {
  if (!sec) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

export const formatDate = (dateStr) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
};
