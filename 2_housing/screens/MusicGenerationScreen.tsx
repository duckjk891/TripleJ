import { useState, useRef, useEffect, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  StyleSheet,
  View,
  Text,
  Image,
  TouchableOpacity,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { showAlert } from '../utils/appAlert';
import { AppText } from '../components/ui';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Slider from '@react-native-community/slider';
import { Switch } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMusicStore } from '../stores/musicStore';
import { patchLyricsAsset, isLyricsAssetId } from '../services/lyricsService';
import { useVoiceStore, artistVoiceLabel } from '../stores/voiceStore';
import { useLyricsStore } from '../stores/lyricsStore';
import { GENRE_OPTIONS, MOOD_OPTIONS } from '../utils/lyricsPrompt';
import { listArtists, artistSheetUrl, parseVoicePreset, artistHasVoice, type ServerArtist } from '../services/characterService';
import * as DocumentPicker from 'expo-document-picker';
import { Audio } from 'expo-av';
import { colors } from '../theme/colors';
import { getFatigueStatus, formatCooldown } from '../services/fatigueService';
import { showFatigueCooldownDialog } from '../utils/fatigueGate';
import { FatigueStatus } from '../types';

const COMPOSER_PORTRAIT = require('../assets/portraits/composer_director.png');

const GENRES = ['댄스', '발라드', '힙합', 'R&B', '트로트', '인디', '록', '포크', '인디팝', '시티팝', '재즈', 'EDM', '클래식', '가요', 'BGM', '팝', '일렉트로닉'];
const MOODS = ['밝고 경쾌한', '슬프고 우울한', '몽환적·신비로운', '에너지틱·강렬한', '로맨틱·달콤한', '그리운·따뜻한', '잔잔하고 편안한', '흥겹고 신나는'];
// v3.84: 간편 목소리(프리셋) 화면에서도 동일 세팅을 쓰도록 export (VoiceManageScreen)
export const VOCAL_STYLES = ['소프트', '파워풀', '위스퍼', '그루비', '클리어', '허스키'];
export const VOCAL_OPTIONS = ['남성', '여성'];

const KEY_OPTIONS = ['C major', 'D major', 'E major', 'F major', 'G major', 'A major', 'B major', 'C minor', 'D minor', 'E minor', 'F minor', 'G minor', 'A minor', 'B minor'];

const DIRECTOR_MESSAGES = [
  '곡 제목을 확인해볼게요! 수정이 필요하면 직접 편집해주세요.',
  '가사를 확인해볼게요! 수정이 필요하면 직접 편집할 수 있어요.',
  '', // dynamic: 장르/분위기/스타일 안내
  '보컬을 선택해주세요!',
  '보컬 스타일을 선택해주세요!',
  '참고하고 싶은 아티스트나 곡이 있다면 업로드 해주세요.',
  '제외하고 싶은 스타일이 있으시면 얘기해주세요.',
  '설정한 스타일에서 자유도는 얼마나 드릴까요?',
  '대중적인 음악으로 갈까요, 실험적인 음악으로 갈까요?',
  '참고 음원의 세기는 얼마만큼 반영할까요?',
  '템포(BPM)를 정해둘까요? 기본은 자동이에요.',
  '곡의 분위기 키(조성)를 골라주세요. 건너뛰면 자동이에요.',
  '마지막으로, 곡에 입힐 내 목소리를 골라주세요! 만들어둔 목소리가 없다면 새로 만들거나 건너뛸 수 있어요.',
];

interface ChatMessage {
  type: 'director' | 'user';
  text: string;
  /** v3.148 — 이 사용자 답변이 응답한 step. 있으면 말풍선 탭 → 그 단계부터 다시 선택(작사 디렉터와 동일 UX) */
  step?: number;
}

type Props = NativeStackScreenProps<any, 'MusicGeneration'>;

export default function MusicGenerationScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const musicStore = useMusicStore();
  const lyricsStore = useLyricsStore();

  // v3.84: 아티스트 목소리(프리셋 XOR 클론) — 프리셋이면 보컬 성별/스타일 기본 선택
  const artistVoice = useVoiceStore((s) => s.artistVoice);
  const artistPreset = artistVoice?.type === 'preset' ? artistVoice : null;

  const [step, setStep] = useState(0);
  // v3.135(대표): 가사 다음·보컬 전 아티스트 선택 단계(step 200) — 선택은 선택사항.
  // 목소리(persona) 연결 아티스트면 작곡에 자동 반영(보컬·내 목소리 단계 스킵).
  const [artists, setArtists] = useState<ServerArtist[] | null>(null);
  const [artistVoiceApplied, setArtistVoiceApplied] = useState(false);
  const [selectedArtistId, setSelectedArtistId] = useState<string | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([
    { type: 'director', text: DIRECTOR_MESSAGES[0] },
  ]);

  // Local state for each step
  const [editedTitle, setEditedTitle] = useState(lyricsStore.generatedTitle || '');
  const [editedLyrics, setEditedLyrics] = useState(lyricsStore.generatedLyrics || musicStore.lyrics || '');
  const [selectedGenre, setSelectedGenre] = useState(lyricsStore.genre || musicStore.genre || '');
  const [selectedMood, setSelectedMood] = useState(lyricsStore.mood || musicStore.mood || '');
  const [useVocal, setUseVocal] = useState(true);
  // v3.84: 프리셋 아티스트 목소리가 있으면 그 성별/스타일이 기본 선택(사용자 변경 가능)
  const [selectedVocalStyle, setSelectedVocalStyle] = useState(
    musicStore.vocalStyle || artistPreset?.style || ''
  );
  const [selectedVocalGender, setSelectedVocalGender] = useState(
    artistPreset ? (artistPreset.gender === 'male' ? '남성' : '여성') : ''
  );
  const [subVocalGender, setSubVocalGender] = useState('');
  const [subVocalStyle, setSubVocalStyle] = useState('');
  const [styleDesc, setStyleDesc] = useState('');
  const [refStyle, setRefStyle] = useState('');
  const [negativeTags, setNegativeTags] = useState('');
  const [customVocalInput, setCustomVocalInput] = useState('');
  // Suno 상세 파라미터 (Switch 제거 → 각 단계에서 "적용"/"건너뛰기"로 반영 여부 결정)
  const [negativeTagsOn, setNegativeTagsOn] = useState(false);
  const [styleWeight, setStyleWeight] = useState(0.5);
  const [styleWeightOn, setStyleWeightOn] = useState(false);
  const [weirdness, setWeirdness] = useState(0.3);
  const [weirdnessOn, setWeirdnessOn] = useState(false);
  const [audioWeight, setAudioWeight] = useState(0.5);
  const [audioWeightOn, setAudioWeightOn] = useState(false);
  // v3.78: 내 목소리 페르소나 — personaModel은 적용 방식('voice'=목소리까지, 'style'=스타일만)
  const [personaModel, setPersonaModel] = useState<'' | 'style' | 'voice'>('voice');
  const [personaModelOn, setPersonaModelOn] = useState(false);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);
  const personaDefaultAppliedRef = useRef(false);
  // v3.145: 장르/분위기 재선택 모드 — 302에서 '아니요' 시 300→301 모두 다시 질문
  const repickRef = useRef(false);
  // v3.146(대표): 장르/분위기 직접 입력 — 작사 디렉터와 동일한 자유 입력 UI (step 300/301 공용)
  const [customPickInput, setCustomPickInput] = useState('');
  const [bpmValue, setBpmValue] = useState(120);
  const [bpmOn, setBpmOn] = useState(false);
  const [musicalKey, setMusicalKey] = useState('');
  const [musicalKeyOn, setMusicalKeyOn] = useState(false);

  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 100);
  }, [chatHistory, step]);

  // v3.94: 디렉터 피로/쿨다운 — GET /fatigue/status (사다리: 그날 1곡 2h/2곡 4h/3곡 8h/4곡+ 12h, 자정 리셋)
  const [fatigue, setFatigue] = useState<FatigueStatus | null>(null);
  const [fatigueRemainSec, setFatigueRemainSec] = useState(0);

  const applyFatigueStatus = useCallback((data: FatigueStatus) => {
    setFatigue(data);
    setFatigueRemainSec(Math.max(0, Math.floor(data?.cooldown_remaining_sec ?? 0)));
  }, []);

  const refreshFatigue = useCallback(async () => {
    try {
      const data = await getFatigueStatus();
      applyFatigueStatus(data);
    } catch (err: any) {
      // 조회 실패는 게이트 오픈 — 서버 게이트(429)가 최종 방어 (fatigue_service.py:144 check_gate 동일 정책)
      console.warn('[MusicGeneration] [fatigue] 상태 조회 실패:', err?.response?.status, err?.message);
    }
  }, [applyFatigueStatus]);

  // 진입/복귀 시 상태 갱신 (곡 완성으로 쿨다운이 새로 시작됐을 수 있음)
  useFocusEffect(
    useCallback(() => {
      refreshFatigue();
    }, [refreshFatigue])
  );

  // 쿨다운 1초 카운트다운 — 0 도달 시 서버 상태 재확인(해제 반영, MAIDOL StudioTab2 관행)
  useEffect(() => {
    if (fatigueRemainSec <= 0) return undefined;
    const timeout = setTimeout(() => {
      setFatigueRemainSec((s) => Math.max(0, s - 1));
      if (fatigueRemainSec === 1) refreshFatigue();
    }, 1000);
    return () => clearTimeout(timeout);
  }, [fatigueRemainSec, refreshFatigue]);

  // v3.102: 구 Voice Persona 목록(personas) 제거 — v216 서버 삭제. 내 목소리 후보는 클론(ready)만.
  // v3.84: 클론형 아티스트 목소리일 때만 클론 목록에서 매칭
  const artistCloneVoiceId = artistVoice?.type === 'clone' ? artistVoice.personaId : null;

  // v3.83: 정식 클로닝 목소리 — ready(voice_id 확보)만 후보에 포함.
  // 선택 시 persona_id=voice_id(Suno voice_id), 적용 방식은 'voice' 고정
  // (musicService가 'voice_persona'로 변환 — v216 권장 경로).
  const voiceClones = useVoiceStore((s) => s.clones);
  const clonesLoading = useVoiceStore((s) => s.clonesLoading);
  const fetchClones = useVoiceStore((s) => s.fetchClones);
  const readyClones = voiceClones.filter((c) => c.status === 'ready' && !!c.voice_id);
  const artistClone = artistCloneVoiceId
    ? readyClones.find((c) => c.voice_id === artistCloneVoiceId)
    : undefined;
  const otherClones = artistClone
    ? readyClones.filter((c) => c.voice_id !== artistClone.voice_id)
    : readyClones;

  // 내 목소리 스텝 진입 시(+VoiceManage에서 돌아왔을 때) 목록 갱신
  useFocusEffect(
    useCallback(() => {
      if (step === 12 || step === 210) {
        fetchClones();
      }
    }, [step, fetchClones])
  );

  // v3.84: 아티스트 목소리가 "클론"이면 기본 선택 (최초 1회만 — 사용자가 해제하면 존중).
  // "프리셋"이면 이 스텝은 건너뛰기 기본 — 스타일 태그는 성별/스타일 스텝에서 이미 반영됨.
  useEffect(() => {
    if (step === 12 && !personaDefaultAppliedRef.current && artistClone) {
      personaDefaultAppliedRef.current = true;
      setSelectedPersonaId(artistClone.voice_id ?? null);
      setPersonaModel('voice'); // 클론은 목소리 적용 고정
    }
  }, [step, artistClone]);

  // v3.135: 아티스트 목소리가 이미 적용된 경우 내 목소리(step 12) 단계 자동 통과
  useEffect(() => {
    if (step === 12 && artistVoiceApplied) {
      console.info('[MusicGeneration] step12 스킵 — 아티스트 목소리 적용됨');
      setChatHistory((prev) => [
        ...prev,
        { type: 'user', text: '목소리 결정 완료' },
        { type: 'director', text: '목소리는 이미 정해져 있어서 이 단계는 건너뛸게요!' },
      ]);
      setStep(13);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, artistVoiceApplied]);

  const advanceStep = (userAnswer: string, nextStep: number) => {
    if (nextStep >= DIRECTOR_MESSAGES.length) {
      // All steps done - show generate button
      const newHistory: ChatMessage[] = [
        ...chatHistory,
        { type: 'user', text: userAnswer, step },
        { type: 'director', text: '모든 설정이 완료됐어요! 아래 버튼을 눌러 음악을 만들어볼까요?' },
      ];
      setChatHistory(newHistory);
      setStep(nextStep);
    } else {
      const newHistory: ChatMessage[] = [
        ...chatHistory,
        { type: 'user', text: userAnswer, step },
        { type: 'director', text: DIRECTOR_MESSAGES[nextStep] },
      ];
      setChatHistory(newHistory);
      setStep(nextStep);
    }
  };

  // ── v3.148(대표): 작곡 대화도 작사처럼 내 답변 탭 → 그 단계부터 다시 선택 ──
  const questionForStep = (s: number): string => {
    switch (s) {
      case 3:
        return lyricsStore.isDuet ? '듀엣 곡이네요! 메인 보컬 성별을 선택해주세요.' : DIRECTOR_MESSAGES[3];
      case 100: return '서브 보컬 성별을 선택해주세요!';
      case 101: return '서브 보컬 스타일을 선택해주세요!';
      case 200: return '함께할 아티스트를 선택해주세요! 목소리가 연결된 아티스트라면 그 목소리로 노래해요. (건너뛰어도 괜찮아요)';
      case 210: return '어떤 목소리로 노래할까요? 만들어둔 목소리를 골라주세요!';
      case 220: return '목소리는 어떻게 할까요? 간편 목소리(보컬 스타일 선택) 또는 내 목소리(클로닝한 목소리)로 만들 수 있어요!';
      case 300: return '이 곡은 어떤 장르로 만들까요?';
      case 301: return '분위기는 어떻게 할까요?';
      case 302: {
        const g = lyricsStore.genre || selectedGenre;
        const m = lyricsStore.mood || selectedMood;
        return `이 가사는 작사할 때 장르 '${g}' · 분위기 '${m}'(으)로 만들어졌어요. 이 느낌 그대로 작곡할까요? 다른 장르로 바꿔서 만들 수도 있어요!`;
      }
      default:
        return DIRECTOR_MESSAGES[s] || '';
    }
  };

  const performRewind = (idx: number, target: number) => {
    console.info('[MusicGeneration] 대화 되감기', { idx, target });
    // 되감는 지점 이후의 선택 파생 상태 리셋 — 앞으로 재진행하며 다시 채워진다.
    repickRef.current = false;
    const voiceRelated = target <= 3 || target === 200 || target === 210 || target === 220 || target >= 300;
    if (voiceRelated) {
      setArtistVoiceApplied(false);
      personaDefaultAppliedRef.current = false;
      setPersonaModelOn(false);
      setSelectedPersonaId(null);
    }
    if (target <= 1 || target === 200 || target >= 300) {
      setSelectedArtistId(null);
      musicStore.setArtistCharacterId(null); // v3.156: 아티스트 재선택 되감기 시 store도 초기화
    }
    if (target === 210) fetchClones();
    setChatHistory((prev) => [
      ...prev.slice(0, idx),
      { type: 'director', text: questionForStep(target) },
    ]);
    setStep(target);
  };

  const handleUserBubbleTap = (idx: number) => {
    const msg = chatHistory[idx];
    if (msg?.type !== 'user' || msg.step == null) return;
    showAlert('이 답변부터 다시 할까요?', `"${msg.text}"\n\n이후의 선택은 초기화되고, 이 질문부터 다시 진행해요.`, [
      { text: '취소', style: 'cancel' },
      { text: '다시 선택', onPress: () => performRewind(idx, msg.step!) },
    ]);
  };

  // Step 0: Title confirm → step 1(가사 확인)
  // 편집한 제목을 lyricsStore에 반영 (이걸 안 하면 MyMusic / LyricsResult에서 원본만 보임)
  const handleTitleConfirm = () => {
    lyricsStore.setGeneratedTitle(editedTitle.trim());
    advanceStep(`제목: ${editedTitle || '(없음)'}`, 1);
  };

  // Step 1: Lyrics confirm → step 2(장르/분위기/스타일 안내, 자동)
  // 편집한 가사를 lyricsStore와 musicStore 양쪽에 즉시 반영
  const handleLyricsConfirm = () => {
    if (!editedLyrics.trim()) {
      showAlert('알림', '가사를 입력해주세요.');
      return;
    }
    lyricsStore.setGeneratedLyrics(editedLyrics.trim());
    musicStore.setLyrics(editedLyrics.trim());
    const preview = editedLyrics.trim().split('\n').slice(0, 2).join(' ');
    const displayText = preview.length > 40 ? preview.substring(0, 40) + '...' : preview;

    const genreInfo = lyricsStore.genre || selectedGenre;
    const moodInfo = lyricsStore.mood || selectedMood;
    const styleInfo = lyricsStore.style || '';
    // v3.137(대표): '자동' 표기 폐지 — 값이 없으면 디렉터가 장르(step 300)/분위기(step 301)를
    // 직접 질문해 실값을 받는다. 둘 다 있으면 실값 안내 후 진행.
    if (!genreInfo) {
      console.warn('[MusicGeneration] 장르 없음 — 선택 질문으로 전환');
      setChatHistory((prev) => [
        ...prev,
        { type: 'user', text: `가사 확인: "${displayText}"`, step: 1 },
        { type: 'director', text: '이 가사에는 장르 정보가 없네요. 어떤 장르로 작곡할까요?' },
      ]);
      setStep(300);
      return;
    }
    if (!moodInfo) {
      console.warn('[MusicGeneration] 분위기 없음 — 선택 질문으로 전환');
      setChatHistory((prev) => [
        ...prev,
        { type: 'user', text: `가사 확인: "${displayText}"`, step: 1 },
        { type: 'director', text: `장르는 ${genreInfo}(으)로 갈게요. 분위기는 어떻게 할까요?` },
      ]);
      setStep(301);
      return;
    }
    // v3.145(대표): 장르/분위기가 있어도 자동 확정하지 않고 확인 질문 — 같은 가사를
    // 완전히 다른 장르의 곡으로 만들 수 있어야 함. 아니오 → 작곡 디렉터 선택이 우선.
    setChatHistory((prev) => [
      ...prev,
      { type: 'user', text: `가사 확인: "${displayText}"`, step: 1 },
      { type: 'director', text: `이 가사는 작사할 때 장르 '${genreInfo}' · 분위기 '${moodInfo}'(으)로 만들어졌어요. 이 느낌 그대로 작곡할까요? 다른 장르로 바꿔서 만들 수도 있어요!` },
    ]);
    setStep(302);
  };

  // v3.145: 장르/분위기 확정 공통 — 안내 후 아티스트 단계(구 자동 확정 후반부)
  const announceAndProceed = (genreInfo: string, moodInfo: string, styleInfo: string) => {
    const infoText = [genreInfo, moodInfo, styleInfo].filter(Boolean).join(', ');
    proceedToArtistStep(`확인! (${infoText})`, 302);
  };

  // v3.145: step 302 — 작사 장르/분위기 그대로 갈지 확인
  const handleGenreConfirmYes = () => {
    const genreInfo = lyricsStore.genre || selectedGenre;
    const moodInfo = lyricsStore.mood || selectedMood;
    console.info('[MusicGeneration] 작사 장르/분위기 유지', { genre: genreInfo, mood: moodInfo });
    setChatHistory((prev) => [...prev, { type: 'user', text: '네, 이대로 갈게요', step: 302 }]);
    announceAndProceed(genreInfo, moodInfo, lyricsStore.style || '');
  };

  const handleGenreConfirmNo = () => {
    console.info('[MusicGeneration] 장르/분위기 재선택 진입 (작곡 선택 우선)');
    repickRef.current = true;
    setChatHistory((prev) => [
      ...prev,
      { type: 'user', text: '아니요, 다르게 고를게요', step: 302 },
      { type: 'director', text: '좋아요! 이 곡은 어떤 장르로 만들까요?' },
    ]);
    setStep(300);
  };

  // v3.137: 장르/분위기 확정 후 아티스트 스텝(또는 보컬)으로 — handleLyricsConfirm 후반부와 동일 로직
  // v3.148: originStep — announce 말풍선이 응답한 step(되감기 태그)
  const proceedToArtistStep = async (announce: string, originStep?: number) => {
    let list: ServerArtist[] = [];
    try {
      console.info('[MusicGeneration] calling listArtists (아티스트 선택 단계)');
      list = (await listArtists()).characters;
    } catch (err: any) {
      console.error('[MusicGeneration] listArtists failed — 아티스트 단계 생략', { status: err?.response?.status });
    }
    if (list.length > 0) {
      setArtists(list);
      setChatHistory((prev) => [
        ...prev,
        { type: 'user', text: announce, step: originStep },
        { type: 'director', text: '함께할 아티스트를 선택해주세요! 목소리가 연결된 아티스트라면 그 목소리로 노래해요. (건너뛰어도 괜찮아요)' },
      ]);
      setStep(200);
      return;
    }
    const vocalQuestion = lyricsStore.isDuet
      ? '듀엣 곡이네요! 메인 보컬 성별을 선택해주세요.'
      : DIRECTOR_MESSAGES[3];
    setChatHistory((prev) => [
      ...prev,
      { type: 'user', text: announce, step: originStep },
      { type: 'director', text: vocalQuestion },
    ]);
    setStep(3);
  };

  // v3.137: step 300 — 장르 선택 (가사에 장르 정보 없거나 v3.145 재선택)
  const handleGenrePick = (genre: string) => {
    setSelectedGenre(genre);
    lyricsStore.setGenre(genre);
    const mood = lyricsStore.mood || selectedMood;
    // v3.145: 재선택 모드면 분위기도 무조건 다시 질문 (작곡 디렉터 선택이 우선)
    if (!mood || repickRef.current) {
      setChatHistory((prev) => [
        ...prev,
        { type: 'user', text: genre, step: 300 },
        { type: 'director', text: '분위기는 어떻게 할까요?' },
      ]);
      setStep(301);
      return;
    }
    proceedToArtistStep(`장르: ${genre}`, 300);
  };

  // v3.137: step 301 — 분위기 선택
  const handleMoodPick = (mood: string) => {
    repickRef.current = false;
    setSelectedMood(mood);
    lyricsStore.setMood(mood);
    proceedToArtistStep(`분위기: ${mood}`, 301);
  };

  // v3.146: 장르/분위기 직접 입력 제출 — 선택 버튼과 동일 경로 재사용 (30자 제한)
  const handleCustomPickSubmit = (kind: 'genre' | 'mood') => {
    const v = customPickInput.trim().slice(0, 30);
    if (!v) return;
    console.info('[MusicGeneration] 직접 입력', { kind, value: v });
    setCustomPickInput('');
    if (kind === 'genre') handleGenrePick(v);
    else handleMoodPick(v);
  };

  // v3.137: 아티스트 gender 자유 문자열 → 보컬 성별 매핑 (미확정이면 null)
  const mapArtistGender = (g?: string | null): '남성' | '여성' | null => {
    const v = (g || '').toLowerCase();
    if (!v) return null;
    if (v.includes('남') || v.includes('male') && !v.includes('female')) return '남성';
    if (v.includes('여') || v.includes('female')) return '여성';
    return null;
  };

  // v3.135: 아티스트 선택 (null = 건너뛰기)
  const handleArtistPick = (artist: ServerArtist | null) => {
    const vocalQuestion = lyricsStore.isDuet
      ? '듀엣 곡이네요! 메인 보컬 성별을 선택해주세요.'
      : DIRECTOR_MESSAGES[3];
    if (!artist) {
      console.info('[MusicGeneration] 아티스트 건너뛰기');
      musicStore.setArtistCharacterId(null); // v3.156: 미선택 곡은 기획사명 폴백
      setChatHistory((prev) => [
        ...prev,
        { type: 'user', text: '아티스트 없이 진행', step: 200 },
        { type: 'director', text: vocalQuestion },
      ]);
      setStep(3);
      return;
    }
    // v3.143(대표): 아티스트 목소리 필수 — 미연결 아티스트는 선택 차단 + 연결 안내.
    // (동일 아티스트 = 동일 목소리 보장. 성별·목소리 질문은 아티스트 선택 시 전부 생략)
    const hasClone = !!artist.persona_voice_id && artist.persona_status === 'ready';
    const preset = parseVoicePreset(artist.voice_preset);
    if (!hasClone && !preset) {
      console.warn('[MusicGeneration] 목소리 미연결 아티스트 선택 차단', { cid: artist.character_id, status: artist.persona_status });
      // v3.147: 만료(Suno측 사정)면 재학습 안내로 구분
      showAlert(
        artist.persona_status === 'expired' ? '목소리가 만료됐어요' : '목소리 연결이 필요해요',
        artist.persona_status === 'expired'
          ? `${artist.name || '이 아티스트'}에 연결된 목소리가 만료됐어요. 외부 AI 사정으로 목소리가 만료될 수 있어요 — 목소리를 다시 학습해서 연결해주세요. (학습에 쓴 ⭐는 환불돼요)`
          : `${artist.name || '이 아티스트'}에게 아직 연결된 목소리가 없어요.\n내 아티스트 화면에서 간편 목소리 또는 내 목소리를 연결하면 선택할 수 있어요.`
      );
      return;
    }
    setSelectedArtistId(artist.character_id);
    // v3.156: 선택 아티스트를 store로 승계 — 생성 body character_id → 발매 시 곡 아티스트명·착장 근거
    musicStore.setArtistCharacterId(artist.character_id || null);
    console.info('[MusicGeneration] 아티스트 선택', { cid: artist.character_id, hasClone, preset: preset ? `${preset.gender}·${preset.style}` : null });
    if (preset && !hasClone) {
      // v3.143: 간편 목소리 아티스트 — 성별·스타일 프리셋 자동 반영, 보컬/내 목소리 단계 전부 스킵
      setUseVocal(true);
      setSelectedVocalGender(preset.gender);
      setSelectedVocalStyle(preset.style);
      setArtistVoiceApplied(true);
      setChatHistory((prev) => [
        ...prev,
        { type: 'user', text: `아티스트: ${artist.name || '이름 없음'}`, step: 200 },
        { type: 'director', text: `${artist.name || '아티스트'}의 간편 목소리(${preset.gender} · ${preset.style})를 자동으로 반영할게요! 🎤 보컬 설정은 건너뛰고 다음으로 갈게요.` },
        { type: 'director', text: DIRECTOR_MESSAGES[5] },
      ]);
      setStep(5);
      return;
    }
    if (hasClone) {
      // 목소리 자동 반영 — 보컬 성별/스타일·내 목소리(step 12) 단계 스킵
      setSelectedPersonaId(artist.persona_voice_id);
      setPersonaModel('voice');
      setPersonaModelOn(true);
      personaDefaultAppliedRef.current = true;
      setArtistVoiceApplied(true);
      setChatHistory((prev) => [
        ...prev,
        { type: 'user', text: `아티스트: ${artist.name || '이름 없음'}`, step: 200 },
        { type: 'director', text: `${artist.name || '아티스트'}의 목소리를 자동으로 반영할게요! 🎤 보컬 설정은 건너뛰고 다음으로 갈게요.` },
        { type: 'director', text: DIRECTOR_MESSAGES[5] },
      ]);
      setStep(5);
    }
    // v3.143: 목소리 미연결 아티스트는 위에서 선택 차단 — 성별 추정 폴백(v3.137) 제거
  };

  // v3.139: 성별 선택지의 '내 목소리로 만들기' 진입 → 클론 선택(step 210)
  const handleMyVoiceEntry = () => {
    console.info('[MusicGeneration] 내 목소리 진입 (step 210)');
    fetchClones();
    setChatHistory((prev) => [
      ...prev,
      { type: 'user', text: '🎤 내 목소리', step: 220 },
      { type: 'director', text: '어떤 목소리로 노래할까요? 만들어둔 목소리를 골라주세요!' },
    ]);
    setStep(210);
  };

  const handleMyVoicePick = (clone: any) => {
    if (!clone?.voice_id) return;
    console.info('[MusicGeneration] 내 목소리 선택', { name: clone.voice_name });
    setSelectedPersonaId(clone.voice_id);
    setPersonaModel('voice');
    setPersonaModelOn(true);
    personaDefaultAppliedRef.current = true;
    setArtistVoiceApplied(true); // step 12 자동 통과 재사용
    setChatHistory((prev) => [
      ...prev,
      { type: 'user', text: `내 목소리: ${clone.voice_name || '선택한 목소리'}`, step: 210 },
      { type: 'director', text: `${clone.voice_name || '내 목소리'}(으)로 노래할게요! 🎤 보컬 설정은 건너뛰고 다음으로 갈게요.` },
      { type: 'director', text: DIRECTOR_MESSAGES[5] },
    ]);
    setStep(5);
  };

  // v3.143: 내 목소리 목록에서 돌아가면 목소리 방식 질문(step 220)으로 복귀
  const handleMyVoiceBack = () => {
    setChatHistory((prev) => [
      ...prev,
      { type: 'user', text: '돌아가기', step: 210 },
      { type: 'director', text: '목소리는 어떻게 할까요? 간편 목소리(보컬 스타일 선택) 또는 내 목소리(클로닝한 목소리)로 만들 수 있어요!' },
    ]);
    setStep(220);
  };

  // Step 3: Vocal select (메인 보컬) — v3.143: 성별 다음은 목소리 방식 질문(step 220)
  const handleVocalSelect = (vocal: string) => {
    setUseVocal(true);
    setSelectedVocalGender(vocal);
    setChatHistory((prev) => [
      ...prev,
      { type: 'user', text: lyricsStore.isDuet ? `메인 보컬: ${vocal}` : vocal, step: 3 },
      { type: 'director', text: '목소리는 어떻게 할까요? 간편 목소리(보컬 스타일 선택) 또는 내 목소리(클로닝한 목소리)로 만들 수 있어요!' },
    ]);
    setStep(220);
  };

  // v3.143: step 220 — 목소리 방식 선택 (아티스트 없이 작곡할 때 필수)
  const handleVoiceModeQuick = () => {
    console.info('[MusicGeneration] 목소리 방식: 간편 목소리');
    setArtistVoiceApplied(true); // 목소리 결정 완료 — step 12 자동 통과
    setChatHistory((prev) => [
      ...prev,
      { type: 'user', text: '간편 목소리', step: 220 },
      { type: 'director', text: DIRECTOR_MESSAGES[4] },
    ]);
    setStep(4);
  };

  // Step 4: Vocal style select (메인 보컬 스타일)
  const handleVocalStyleSelect = (style: string) => {
    setSelectedVocalStyle(style);
    if (lyricsStore.isDuet) {
      // 듀엣: 메인 스타일 선택 후 서브 보컬 질문
      const newHistory: ChatMessage[] = [
        ...chatHistory,
        { type: 'user', text: `메인 보컬 스타일: ${style}`, step: 4 },
        { type: 'director', text: '서브 보컬 성별을 선택해주세요!' },
      ];
      setChatHistory(newHistory);
      setStep(100); // 서브 보컬 성별 선택 임시 step
    } else {
      advanceStep(style, 5);
    }
  };

  // 듀엣 서브 보컬 성별 선택
  const handleSubVocalSelect = (vocal: string) => {
    setSubVocalGender(vocal);
    const newHistory: ChatMessage[] = [
      ...chatHistory,
      { type: 'user', text: `서브 보컬: ${vocal}`, step: 100 },
      { type: 'director', text: '서브 보컬 스타일을 선택해주세요!' },
    ];
    setChatHistory(newHistory);
    setStep(101); // 서브 보컬 스타일 선택 임시 step
  };

  // 듀엣 서브 보컬 스타일 선택
  const handleSubVocalStyleSelect = (style: string) => {
    setSubVocalStyle(style);
    advanceStep(`서브 스타일: ${style}`, 5);
  };

  // Step 5: Reference artist/song
  const handleRefStyleConfirm = () => {
    advanceStep(refStyle.trim() ? refStyle.trim() : '건너뛰기', 6);
  };

  // Step 6~11: 세밀 설정 각 단계별 핸들러 (Switch 대신 "적용"/"건너뛰기" 2-버튼)
  const handleNegativeConfirm = (apply: boolean) => {
    setNegativeTagsOn(apply && !!negativeTags.trim());
    advanceStep(apply && negativeTags.trim() ? `제외: ${negativeTags.trim()}` : '건너뛰기', 7);
  };
  const handleStyleWeightConfirm = (apply: boolean) => {
    setStyleWeightOn(apply);
    advanceStep(apply ? `자유도 ${styleWeight.toFixed(1)}` : '자동으로 맡길게요', 8);
  };
  const handleWeirdnessConfirm = (apply: boolean) => {
    setWeirdnessOn(apply);
    advanceStep(
      apply
        ? weirdness < 0.4
          ? '대중적으로 갈게요'
          : weirdness > 0.6
            ? '실험적으로 갈게요'
            : '반반 섞을게요'
        : '자동으로 맡길게요',
      9
    );
  };
  const handleAudioWeightConfirm = (apply: boolean) => {
    setAudioWeightOn(apply);
    advanceStep(apply ? `참고음 세기 ${audioWeight.toFixed(1)}` : '자동으로 맡길게요', 10);
  };
  const handleBpmConfirm = (apply: boolean) => {
    setBpmOn(apply);
    advanceStep(apply ? `BPM ${Math.round(bpmValue)}` : '자동 템포', 11);
  };
  // v3.78: 내 목소리 확정 — v3.102: 후보는 클론(ready)만, 적용 방식은 'voice' 고정
  const handlePersonaConfirm = (apply: boolean) => {
    const usePersona = apply && !!selectedPersonaId;
    setPersonaModelOn(usePersona);
    if (usePersona) {
      const c = readyClones.find((x) => x.voice_id === selectedPersonaId);
      const name = c?.voice_name;
      setPersonaModel('voice'); // 클론은 voice_persona 고정
      console.log('[MusicGeneration] 내 목소리 적용:', selectedPersonaId, name, 'voice(클론)');
      advanceStep(`내 목소리: ${name || '선택한 목소리'} (목소리까지)`, 13);
    } else {
      advanceStep('건너뛰기', 13);
    }
  };

  const handleKeyConfirm = (apply: boolean) => {
    setMusicalKeyOn(apply && !!musicalKey);
    advanceStep(apply && musicalKey ? `키: ${musicalKey}` : '자동 키', 12);
  };
  // 참고: handlePersonaConfirm은 위에 정의됨 (case 12에서 호출)

  // v3.91: 선택 단계에서 참고 음악 길이 판독 — 백엔드 upload-reference 제한(480초=8분)을 선반영.
  // 판독 실패(null)면 통과시키고 서버 검증(400)에 위임한다.
  const probeAudioDurationSec = async (uri: string): Promise<number | null> => {
    try {
      const { sound, status } = await Audio.Sound.createAsync({ uri }, { shouldPlay: false });
      const durationMillis = status.isLoaded ? status.durationMillis : undefined;
      try { await sound.unloadAsync(); } catch {}
      return typeof durationMillis === 'number' && isFinite(durationMillis)
        ? durationMillis / 1000
        : null;
    } catch {
      return null;
    }
  };

  // Step 6: Reference - file upload
  const handlePickReference = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*' });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const file = result.assets[0];
        // v3.91: 8분(480초) 초과는 선택 단계에서 거부 (backend generate.py MAX_REFERENCE_DURATION=480)
        const durationSec = await probeAudioDurationSec(file.uri);
        if (durationSec != null && durationSec > 480) {
          console.log('[MusicGeneration] 참고 음악 길이 초과 거부:', Math.round(durationSec), '초');
          showAlert('참고 음악', '참고 음악은 최대 8분(480초)까지 사용할 수 있어요. 더 짧은 파일을 선택해주세요.');
          return;
        }
        musicStore.setReferenceFile(file.uri, file.name);
        advanceStep(`파일 업로드: ${file.name}`, 6);
      }
    } catch {
      showAlert('오류', '파일 선택에 실패했습니다.');
    }
  };

  // Step 6: Reference - recording
  const handleStartRecording = async () => {
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        showAlert('권한 필요', '녹음을 위해 마이크 권한이 필요합니다.');
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recordingRef.current = recording;
      setIsRecording(true);
      setRecordingDuration(0);
      timerRef.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);
    } catch {
      showAlert('오류', '녹음을 시작할 수 없습니다.');
    }
  };

  const handleStopRecording = async () => {
    if (!recordingRef.current) return;
    try {
      if (timerRef.current) clearInterval(timerRef.current);
      setIsRecording(false);
      await recordingRef.current.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;
      if (uri) {
        // v3.91: 녹음도 백엔드 참고 음악 제한(480초=8분)을 선택 단계에서 선반영
        if (recordingDuration > 480) {
          showAlert('참고 음악', '참고 음악은 최대 8분(480초)까지 사용할 수 있어요. 더 짧게 녹음해주세요.');
          return;
        }
        const fileName = `녹음_${new Date().toLocaleTimeString()}.m4a`;
        musicStore.setReferenceFile(uri, fileName);
        advanceStep(`녹음 완료: ${fileName}`, 9);
      }
    } catch {
      showAlert('오류', '녹음 저장에 실패했습니다.');
    }
  };

  const handleSkipReference = () => {
    advanceStep('건너뛰기', 9);
  };

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // Final generate — 실제 시작 처리 (v3.94: 피로 게이트 통과 후에만 호출)
  const proceedGenerate = () => {
    musicStore.setLyrics(editedLyrics.trim());
    musicStore.setGenre(lyricsStore.genre || selectedGenre);
    musicStore.setMood(lyricsStore.mood || selectedMood);
    musicStore.setTempo(lyricsStore.tempo || musicStore.tempo || '보통');
    musicStore.setVocal(selectedVocalGender || '');
    musicStore.setVocalStyle(selectedVocalStyle);
    musicStore.setStyle(lyricsStore.style || '');
    musicStore.setReferenceStyle(refStyle.trim());
    musicStore.setBpm(bpmOn ? String(bpmValue) : '');
    musicStore.setMusicalKey(musicalKeyOn ? musicalKey : '');
    musicStore.setNegativeTags(negativeTagsOn ? negativeTags.trim() : '');
    // v3.91: 참고음 세기(audio_weight) — "적용"을 골랐을 때만 body에 실림(자동=null)
    musicStore.setAudioWeight(audioWeightOn ? audioWeight : null);
    musicStore.setPersonaModel(personaModelOn && personaModel ? personaModel : '');
    musicStore.setPersonaId(personaModelOn && selectedPersonaId ? selectedPersonaId : null);
    musicStore.setSubVocal(subVocalGender);
    musicStore.setSubVocalStyle(subVocalStyle);
    setChatHistory((prev) => [
      ...prev,
      { type: 'director', text: '작곡을 시작할게요! 곧 결과를 보여드릴게요.' },
    ]);
    // v3.134(대표): 작곡 중 수정한 제목/가사를 가사 DB(자산)에 동기화 — 출처가 내 자산일 때만.
    // best-effort(실패해도 작곡 진행 무영향), track_/로컬 출처는 대상 아님.
    const src = musicStore.lyricsSource;
    if (src?.lyrics_id && src.is_mine !== false && isLyricsAssetId(src.lyrics_id)) {
      const syncTitle = (editedTitle || lyricsStore.generatedTitle || '').trim();
      const syncLyrics = editedLyrics.trim();
      console.info('[MusicGeneration] 가사 자산 동기화 PATCH', { lyricsId: src.lyrics_id, titleLen: syncTitle.length, lyricsLen: syncLyrics.length });
      patchLyricsAsset(src.lyrics_id, {
        ...(syncTitle ? { title: syncTitle } : {}),
        ...(syncLyrics ? { content: syncLyrics } : {}),
      }).catch((err: any) => {
        console.error('[MusicGeneration] 가사 자산 동기화 실패(작곡은 계속)', { status: err?.response?.status });
      });
    }
    // v3.107: 대기열 타이머 폐지 — 요청 즉시 MusicLoading으로 직행(폴링·진행 표시는 그쪽이 보유).
    // 재요청 제한은 피로도(서버 429 게이트 + 위 fatigueRemainSec 게이트)가 담당한다.
    console.log('[MusicGeneration] 작곡 생성 시작 — MusicLoading 직행');
    navigation.navigate('MusicLoading' as any);
  };

  // v3.94: 생성 버튼 — 디렉터 쿨다운 중이면 앱 내 다이얼로그(남은 시간 + ⭐스킵/광고권/취소)로 게이트.
  // 서버도 POST /generate/(start_music_gen=true)에서 429로 게이트하므로(과금 전 — generate.py:444)
  // 레이스는 MusicLoadingScreen의 429 분기가 처리한다.
  const handleGenerate = () => {
    if (fatigueRemainSec > 0) {
      console.log('[MusicGeneration] [fatigue] 게이트 — 남은', fatigueRemainSec, '초');
      showFatigueCooldownDialog({
        status: fatigue,
        remainingSec: fatigueRemainSec,
        onStatusUpdate: applyFatigueStatus,
        onCleared: proceedGenerate,
      });
      return;
    }
    proceedGenerate();
  };

  const isComplete = step >= DIRECTOR_MESSAGES.length && step < 100;

  // Render the current step's input area
  const renderInputArea = () => {
    if (isComplete) {
      return (
        <View style={styles.inputArea}>
          <TouchableOpacity style={styles.generateButton} onPress={handleGenerate}>
            <AppText style={styles.generateButtonText}>음악 생성 시작</AppText>
          </TouchableOpacity>
        </View>
      );
    }

    switch (step) {
      case 0:
        // Title editing
        return (
          <View style={styles.inputArea}>
            <TextInput
              style={styles.advancedInput}
              value={editedTitle}
              onChangeText={setEditedTitle}
              placeholder="곡 제목을 입력하세요"
              placeholderTextColor={colors.text.muted}
            />
            <TouchableOpacity style={styles.confirmButton} onPress={handleTitleConfirm}>
              <AppText style={styles.confirmButtonText}>제목 확인</AppText>
            </TouchableOpacity>
          </View>
        );

      case 1:
        // Lyrics editing
        return (
          <View style={styles.inputArea}>
            <TextInput
              style={styles.lyricsInput}
              value={editedLyrics}
              onChangeText={setEditedLyrics}
              multiline
              textAlignVertical="top"
              placeholder="가사를 입력하세요"
              placeholderTextColor={colors.text.muted}
            />
            <TouchableOpacity
              style={[styles.confirmButton, !editedLyrics.trim() && styles.confirmButtonDisabled]}
              onPress={handleLyricsConfirm}
              disabled={!editedLyrics.trim()}
            >
              <AppText style={styles.confirmButtonText}>가사 확인 완료</AppText>
            </TouchableOpacity>
          </View>
        );

      case 2:
        // 장르/분위기/스타일 안내 (자동 넘김)
        return null;

      case 3:
        // Vocal selection
        return (
          <View style={styles.inputArea}>
            <ScrollView
              style={styles.choicesScroll}
              contentContainerStyle={styles.choicesContainer}
              showsVerticalScrollIndicator={false}
            >
              {VOCAL_OPTIONS.map((vocal, idx) => (
                <TouchableOpacity
                  key={vocal}
                  style={[styles.choiceButton, selectedVocalGender === vocal && styles.choiceButtonSelected]}
                  onPress={() => handleVocalSelect(vocal)}
                >
                  <AppText style={styles.choiceNumber}>{idx + 1}</AppText>
                  <AppText style={[styles.choiceText, selectedVocalGender === vocal && styles.choiceTextSelected]}>
                    {vocal}
                  </AppText>
                </TouchableOpacity>
              ))}
              {/* v3.143(대표): 성별과 목소리는 분리 질문 — 내 목소리 진입은 step 220으로 이동 */}
            </ScrollView>
          </View>
        );

      case 220:
        // v3.143: 목소리 방식 선택 — 간편 목소리(스타일) / 내 목소리(클론)
        return (
          <View style={styles.inputArea}>
            <ScrollView style={styles.choicesScroll} contentContainerStyle={styles.choicesContainer} showsVerticalScrollIndicator={false}>
              <TouchableOpacity style={styles.choiceButton} onPress={handleVoiceModeQuick}>
                <AppText style={styles.choiceNumber}>1</AppText>
                <AppText style={styles.choiceText}>간편 목소리 (보컬 스타일 선택)</AppText>
              </TouchableOpacity>
              <TouchableOpacity style={styles.choiceButton} onPress={handleMyVoiceEntry}>
                <AppText style={styles.choiceNumber}>2</AppText>
                <AppText style={styles.choiceText}>🎤 내 목소리 (클로닝한 목소리)</AppText>
              </TouchableOpacity>
            </ScrollView>
          </View>
        );

      case 210:
        // v3.139: 내 목소리(클론) 선택 — ready 클론 목록 / 없으면 만들기 안내
        return (
          <View style={styles.inputArea}>
            <ScrollView style={styles.choicesScroll} contentContainerStyle={styles.choicesContainer} showsVerticalScrollIndicator={false}>
              {clonesLoading && readyClones.length === 0 ? (
                <ActivityIndicator size="small" color={colors.accent.primary} style={{ marginVertical: 16 }} />
              ) : (
                <>
                  {readyClones.map((c, idx) => (
                    <TouchableOpacity
                      key={c.clone_id || c.voice_id || String(idx)}
                      style={styles.choiceButton}
                      onPress={() => handleMyVoicePick(c)}
                    >
                      <AppText style={styles.choiceNumber}>{idx + 1}</AppText>
                      <AppText style={styles.choiceText}>{c.voice_name || '내 목소리'}</AppText>
                    </TouchableOpacity>
                  ))}
                  {/* v3.139.1: 생성 중인 클론도 표시 — 위저드 직후 복귀 시 빈 목록 혼란 방지 */}
                  {voiceClones.filter((c) => c.status === 'generating' || c.status === 'pending').map((c, idx) => (
                    <View key={`gen_${c.clone_id || idx}`} style={[styles.choiceButton, { opacity: 0.55 }]}>
                      <AppText style={styles.choiceNumber}>⏳</AppText>
                      <AppText style={styles.choiceText}>{(c.voice_name || '내 목소리') + ' — 생성 중이에요 (완성되면 선택 가능)'}</AppText>
                    </View>
                  ))}
                  {readyClones.length === 0 && (
                    <TouchableOpacity
                      style={styles.choiceButton}
                      onPress={() => {
                        console.info('[MusicGeneration] 클론 없음 — VoiceCloneWizard 이동');
                        navigation.navigate('VoiceCloneWizard' as any);
                      }}
                    >
                      <AppText style={styles.choiceNumber}>1</AppText>
                      <AppText style={styles.choiceText}>🎙️ 목소리 만들러 가기 (⭐5)</AppText>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={styles.choiceButton} onPress={handleMyVoiceBack}>
                    <AppText style={styles.choiceNumber}>{(readyClones.length || 1) + 1}</AppText>
                    <AppText style={styles.choiceText}>돌아가기 (목소리 다시 선택)</AppText>
                  </TouchableOpacity>
                </>
              )}
            </ScrollView>
          </View>
        );

      case 4:
        // Vocal style selection + free input
        return (
          <View style={styles.inputArea}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.vocalStyleScroll}
              contentContainerStyle={styles.vocalStyleContainer}
            >
              {VOCAL_STYLES.map((style) => (
                <TouchableOpacity
                  key={style}
                  style={[styles.vocalChip, selectedVocalStyle === style && styles.vocalChipSelected]}
                  onPress={() => handleVocalStyleSelect(style)}
                >
                  <AppText style={[styles.vocalChipText, selectedVocalStyle === style && styles.vocalChipTextSelected]}>
                    {style}
                  </AppText>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        );

      case 200:
        // v3.135: 아티스트 선택 (가사 다음·보컬 전) — 선택 없이 진행 가능
        return (
          <View style={styles.inputArea}>
            <ScrollView style={styles.choicesScroll} contentContainerStyle={styles.choicesContainer} showsVerticalScrollIndicator={false}>
              {(artists || []).map((a, idx) => {
                // v3.143: 클론(ready) 또는 간편 프리셋 연결 여부 — 미연결은 탭 시 차단(필수 안내)
                const hasVoice = artistHasVoice(a);
                const preset = parseVoicePreset(a.voice_preset);
                return (
                  <TouchableOpacity
                    key={a.character_id || String(idx)}
                    style={[styles.choiceButton, selectedArtistId === a.character_id && styles.choiceButtonSelected]}
                    onPress={() => handleArtistPick(a)}
                  >
                    {/* v3.137: 아티스트 시트 썸네일 — 텍스트만으로는 식별 어려움(대표) */}
                    {(a.sheet_object_name || a.sheet_url) ? (
                      <Image
                        source={{ uri: a.sheet_object_name ? artistSheetUrl(a.sheet_object_name) : (a.sheet_url as string) }}
                        style={artistCardStyles.thumb}
                      />
                    ) : (
                      <AppText style={styles.choiceNumber}>{idx + 1}</AppText>
                    )}
                    <View style={{ flex: 1 }}>
                      <AppText style={styles.choiceText}>{a.name || '이름 없는 아티스트'}</AppText>
                      <AppText style={artistCardStyles.voiceTag}>
                        {hasVoice
                          ? preset
                            ? `🎤 간편 목소리 · ${preset.gender} ${preset.style}`
                            : '🎤 내 목소리 연결됨'
                          : a.persona_status === 'expired'
                            ? '목소리 만료 — 다시 학습이 필요해요'
                            : '목소리 미연결 — 연결해야 선택할 수 있어요'}
                      </AppText>
                    </View>
                  </TouchableOpacity>
                );
              })}
              <TouchableOpacity style={styles.choiceButton} onPress={() => handleArtistPick(null)}>
                <AppText style={styles.choiceNumber}>{(artists || []).length + 1}</AppText>
                <AppText style={styles.choiceText}>아티스트 없이 진행 (건너뛰기)</AppText>
              </TouchableOpacity>
            </ScrollView>
          </View>
        );

      case 302:
        // v3.145: 작사 장르/분위기 유지 여부 확인 — 아니오면 작곡 선택 우선
        return (
          <View style={styles.inputArea}>
            <ScrollView style={styles.choicesScroll} contentContainerStyle={styles.choicesContainer} showsVerticalScrollIndicator={false}>
              <TouchableOpacity style={styles.choiceButton} onPress={handleGenreConfirmYes}>
                <AppText style={styles.choiceNumber}>1</AppText>
                <AppText style={styles.choiceText}>네, 이대로 갈게요</AppText>
              </TouchableOpacity>
              <TouchableOpacity style={styles.choiceButton} onPress={handleGenreConfirmNo}>
                <AppText style={styles.choiceNumber}>2</AppText>
                <AppText style={styles.choiceText}>아니요, 다른 장르·분위기로 만들래요</AppText>
              </TouchableOpacity>
            </ScrollView>
          </View>
        );

      case 300:
        // v3.137: 장르 선택 (가사에 장르 정보 없음)
        return (
          <View style={styles.inputArea}>
            <ScrollView style={styles.choicesScroll} contentContainerStyle={styles.choicesContainer} showsVerticalScrollIndicator={false}>
              {GENRE_OPTIONS.map((g, idx) => (
                <TouchableOpacity key={g} style={styles.choiceButton} onPress={() => handleGenrePick(g)}>
                  <AppText style={styles.choiceNumber}>{idx + 1}</AppText>
                  <AppText style={styles.choiceText}>{g}</AppText>
                </TouchableOpacity>
              ))}
            </ScrollView>
            {/* v3.146: 직접 입력 — 작사 디렉터와 동일 UX */}
            <View style={styles.customPickRow}>
              <TextInput
                style={styles.customPickInput}
                placeholder="직접 입력... (예: 신스팝)"
                placeholderTextColor={colors.text.muted}
                value={customPickInput}
                onChangeText={setCustomPickInput}
                returnKeyType="send"
                onSubmitEditing={() => handleCustomPickSubmit('genre')}
              />
              <TouchableOpacity
                style={[styles.customPickSend, !customPickInput.trim() && styles.customPickSendDisabled]}
                onPress={() => handleCustomPickSubmit('genre')}
                disabled={!customPickInput.trim()}
              >
                <AppText style={styles.customPickSendText}>확인</AppText>
              </TouchableOpacity>
            </View>
          </View>
        );

      case 301:
        // v3.137: 분위기 선택 (가사에 분위기 정보 없음)
        return (
          <View style={styles.inputArea}>
            <ScrollView style={styles.choicesScroll} contentContainerStyle={styles.choicesContainer} showsVerticalScrollIndicator={false}>
              {MOOD_OPTIONS.map((m, idx) => (
                <TouchableOpacity key={m} style={styles.choiceButton} onPress={() => handleMoodPick(m)}>
                  <AppText style={styles.choiceNumber}>{idx + 1}</AppText>
                  <AppText style={styles.choiceText}>{m}</AppText>
                </TouchableOpacity>
              ))}
            </ScrollView>
            {/* v3.146: 직접 입력 — 작사 디렉터와 동일 UX */}
            <View style={styles.customPickRow}>
              <TextInput
                style={styles.customPickInput}
                placeholder="직접 입력... (예: 쓸쓸한 새벽 감성)"
                placeholderTextColor={colors.text.muted}
                value={customPickInput}
                onChangeText={setCustomPickInput}
                returnKeyType="send"
                onSubmitEditing={() => handleCustomPickSubmit('mood')}
              />
              <TouchableOpacity
                style={[styles.customPickSend, !customPickInput.trim() && styles.customPickSendDisabled]}
                onPress={() => handleCustomPickSubmit('mood')}
                disabled={!customPickInput.trim()}
              >
                <AppText style={styles.customPickSendText}>확인</AppText>
              </TouchableOpacity>
            </View>
          </View>
        );

      case 100:
        // 듀엣: 서브 보컬 성별 선택
        return (
          <View style={styles.inputArea}>
            <ScrollView style={styles.choicesScroll} contentContainerStyle={styles.choicesContainer} showsVerticalScrollIndicator={false}>
              {['남성', '여성'].map((vocal, idx) => (
                <TouchableOpacity
                  key={vocal}
                  style={[styles.choiceButton, subVocalGender === vocal && styles.choiceButtonSelected]}
                  onPress={() => handleSubVocalSelect(vocal)}
                >
                  <AppText style={styles.choiceNumber}>{idx + 1}</AppText>
                  <AppText style={[styles.choiceText, subVocalGender === vocal && styles.choiceTextSelected]}>{vocal}</AppText>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        );

      case 101:
        // 듀엣: 서브 보컬 스타일 선택
        return (
          <View style={styles.inputArea}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.vocalStyleScroll} contentContainerStyle={styles.vocalStyleContainer}>
              {VOCAL_STYLES.map((style) => (
                <TouchableOpacity
                  key={style}
                  style={[styles.vocalChip, subVocalStyle === style && styles.vocalChipSelected]}
                  onPress={() => handleSubVocalStyleSelect(style)}
                >
                  <AppText style={[styles.vocalChipText, subVocalStyle === style && styles.vocalChipTextSelected]}>{style}</AppText>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        );

      case 5:
        // Reference - file upload
        return (
          <View style={styles.inputArea}>
            <TouchableOpacity
              style={styles.uploadButton}
              onPress={handlePickReference}
            >
              <AppText style={styles.uploadButtonText}>파일 업로드</AppText>
            </TouchableOpacity>
            {musicStore.referenceFileName && (
              <View style={styles.fileInfo}>
                <AppText style={styles.fileInfoText}>선택됨: {musicStore.referenceFileName}</AppText>
                <TouchableOpacity onPress={() => musicStore.setReferenceFile(null, null)}>
                  <AppText style={styles.removeFileText}>제거</AppText>
                </TouchableOpacity>
              </View>
            )}
            <TouchableOpacity style={styles.skipButton} onPress={() => advanceStep(musicStore.referenceFileName || '건너뛰기', 6)}>
              <AppText style={styles.skipButtonText}>{musicStore.referenceFileName ? '확인' : '건너뛰기'}</AppText>
            </TouchableOpacity>
          </View>
        );

      case 6:
        // 제외 스타일
        return (
          <View style={styles.inputArea}>
            <TextInput
              style={styles.advancedInput}
              value={negativeTags}
              onChangeText={setNegativeTags}
              placeholder="예: 헤비메탈, 디스토션 (없으면 건너뛰기)"
              placeholderTextColor={colors.text.muted}
            />
            <View style={styles.twoBtnRow}>
              <TouchableOpacity style={styles.skipBtn} onPress={() => handleNegativeConfirm(false)}>
                <AppText style={styles.skipBtnText}>건너뛰기</AppText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.applyBtn, !negativeTags.trim() && { opacity: 0.4 }]}
                onPress={() => handleNegativeConfirm(true)}
                disabled={!negativeTags.trim()}
              >
                <AppText style={styles.applyBtnText}>적용</AppText>
              </TouchableOpacity>
            </View>
          </View>
        );

      case 7:
        // 자유도 (스타일 강도): 0 자유 ~ 1 엄격
        return (
          <View style={styles.inputArea}>
            <View style={styles.sliderRow}>
              <AppText style={styles.sliderEndLabel}>자유롭게</AppText>
              <Slider
                style={{ flex: 1 }}
                minimumValue={0}
                maximumValue={1}
                step={0.1}
                value={styleWeight}
                onValueChange={setStyleWeight}
                minimumTrackTintColor={colors.accent.primary}
                maximumTrackTintColor={colors.border.subtle}
                thumbTintColor={colors.accent.primary}
              />
              <AppText style={styles.sliderEndLabel}>엄격하게</AppText>
            </View>
            <AppText style={styles.sliderValueCenter}>{styleWeight.toFixed(1)}</AppText>
            <View style={styles.twoBtnRow}>
              <TouchableOpacity style={styles.skipBtn} onPress={() => handleStyleWeightConfirm(false)}>
                <AppText style={styles.skipBtnText}>건너뛰기</AppText>
              </TouchableOpacity>
              <TouchableOpacity style={styles.applyBtn} onPress={() => handleStyleWeightConfirm(true)}>
                <AppText style={styles.applyBtnText}>이대로 갈게요</AppText>
              </TouchableOpacity>
            </View>
          </View>
        );

      case 8:
        // 대중성 ↔ 실험성 (weirdness)
        return (
          <View style={styles.inputArea}>
            <View style={styles.sliderRow}>
              <AppText style={styles.sliderEndLabel}>대중적</AppText>
              <Slider
                style={{ flex: 1 }}
                minimumValue={0}
                maximumValue={1}
                step={0.1}
                value={weirdness}
                onValueChange={setWeirdness}
                minimumTrackTintColor={colors.accent.primary}
                maximumTrackTintColor={colors.border.subtle}
                thumbTintColor={colors.accent.primary}
              />
              <AppText style={styles.sliderEndLabel}>실험적</AppText>
            </View>
            <AppText style={styles.sliderValueCenter}>{weirdness.toFixed(1)}</AppText>
            <View style={styles.twoBtnRow}>
              <TouchableOpacity style={styles.skipBtn} onPress={() => handleWeirdnessConfirm(false)}>
                <AppText style={styles.skipBtnText}>건너뛰기</AppText>
              </TouchableOpacity>
              <TouchableOpacity style={styles.applyBtn} onPress={() => handleWeirdnessConfirm(true)}>
                <AppText style={styles.applyBtnText}>이대로 갈게요</AppText>
              </TouchableOpacity>
            </View>
          </View>
        );

      case 9:
        // 참고 오디오 세기
        return (
          <View style={styles.inputArea}>
            <View style={styles.sliderRow}>
              <AppText style={styles.sliderEndLabel}>약하게</AppText>
              <Slider
                style={{ flex: 1 }}
                minimumValue={0}
                maximumValue={1}
                step={0.1}
                value={audioWeight}
                onValueChange={setAudioWeight}
                minimumTrackTintColor={colors.accent.primary}
                maximumTrackTintColor={colors.border.subtle}
                thumbTintColor={colors.accent.primary}
              />
              <AppText style={styles.sliderEndLabel}>강하게</AppText>
            </View>
            <AppText style={styles.sliderValueCenter}>{audioWeight.toFixed(1)}</AppText>
            <View style={styles.twoBtnRow}>
              <TouchableOpacity style={styles.skipBtn} onPress={() => handleAudioWeightConfirm(false)}>
                <AppText style={styles.skipBtnText}>건너뛰기</AppText>
              </TouchableOpacity>
              <TouchableOpacity style={styles.applyBtn} onPress={() => handleAudioWeightConfirm(true)}>
                <AppText style={styles.applyBtnText}>이대로 갈게요</AppText>
              </TouchableOpacity>
            </View>
          </View>
        );

      case 10:
        // BPM
        return (
          <View style={styles.inputArea}>
            <View style={styles.sliderRow}>
              <AppText style={styles.sliderEndLabel}>60</AppText>
              <Slider
                style={{ flex: 1 }}
                minimumValue={60}
                maximumValue={200}
                step={5}
                value={bpmValue}
                onValueChange={setBpmValue}
                minimumTrackTintColor={colors.accent.primary}
                maximumTrackTintColor={colors.border.subtle}
                thumbTintColor={colors.accent.primary}
              />
              <AppText style={styles.sliderEndLabel}>200</AppText>
            </View>
            <AppText style={styles.sliderValueCenter}>{Math.round(bpmValue)} BPM</AppText>
            <View style={styles.twoBtnRow}>
              <TouchableOpacity style={styles.skipBtn} onPress={() => handleBpmConfirm(false)}>
                <AppText style={styles.skipBtnText}>자동 템포</AppText>
              </TouchableOpacity>
              <TouchableOpacity style={styles.applyBtn} onPress={() => handleBpmConfirm(true)}>
                <AppText style={styles.applyBtnText}>이 BPM으로</AppText>
              </TouchableOpacity>
            </View>
          </View>
        );

      case 11:
        // Key (조성)
        return (
          <View style={styles.inputArea}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
              {KEY_OPTIONS.map((k) => (
                <TouchableOpacity
                  key={k}
                  style={[styles.keyChip, musicalKey === k && styles.keyChipSelected]}
                  onPress={() => setMusicalKey(musicalKey === k ? '' : k)}
                >
                  <AppText style={[styles.keyChipText, musicalKey === k && styles.keyChipTextSelected]}>{k}</AppText>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={styles.twoBtnRow}>
              <TouchableOpacity style={styles.skipBtn} onPress={() => handleKeyConfirm(false)}>
                <AppText style={styles.skipBtnText}>자동 키</AppText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.applyBtn, !musicalKey && { opacity: 0.4 }]}
                onPress={() => handleKeyConfirm(true)}
                disabled={!musicalKey}
              >
                <AppText style={styles.applyBtnText}>적용</AppText>
              </TouchableOpacity>
            </View>
          </View>
        );

      case 12:
        // v3.78: 내 목소리 선택 — v3.102: 클론(ready) + 프리셋만 (구 persona 칩 제거, 'voice' 고정)
        // v3.84: 프리셋형이면 이 스텝은 건너뛰기 기본 — 안내만 표시
        return (
          <View style={styles.inputArea}>
            {artistPreset && (
              <AppText style={styles.presetNotice}>
                아티스트 목소리(간편: {artistVoiceLabel(artistPreset)})가 설정되어 있어요.
                건너뛰면 그 스타일로 불러요.
              </AppText>
            )}
            {clonesLoading && readyClones.length === 0 ? (
              <ActivityIndicator size="small" color={colors.accent.primary} style={{ marginBottom: 10 }} />
            ) : (
              <ScrollView style={{ maxHeight: 180 }} showsVerticalScrollIndicator={false}>
                {artistClone && (
                  <TouchableOpacity
                    style={[
                      styles.personaChip,
                      selectedPersonaId === artistClone.voice_id && styles.personaChipSelected,
                    ]}
                    onPress={() => {
                      const next = selectedPersonaId === artistClone.voice_id ? null : artistClone.voice_id;
                      setSelectedPersonaId(next);
                      if (next) setPersonaModel('voice');
                    }}
                  >
                    <AppText
                      style={[
                        styles.personaChipText,
                        selectedPersonaId === artistClone.voice_id && styles.personaChipTextSelected,
                      ]}
                    >
                      내 아티스트 목소리 · {artistClone.voice_name}
                    </AppText>
                  </TouchableOpacity>
                )}
                {/* v3.83: 정식 클로닝(ready) 목소리 후보 — 선택 시 voice 적용 고정 */}
                {otherClones.map((c) => (
                  <TouchableOpacity
                    key={c.voice_id ?? c.clone_id}
                    style={[styles.personaChip, selectedPersonaId === c.voice_id && styles.personaChipSelected]}
                    onPress={() => {
                      const next = selectedPersonaId === c.voice_id ? null : c.voice_id;
                      setSelectedPersonaId(next);
                      if (next) setPersonaModel('voice');
                    }}
                  >
                    <AppText
                      style={[
                        styles.personaChipText,
                        selectedPersonaId === c.voice_id && styles.personaChipTextSelected,
                      ]}
                    >
                      {c.voice_name}
                    </AppText>
                  </TouchableOpacity>
                ))}
                {readyClones.length === 0 && (
                  <AppText style={styles.personaEmptyText}>
                    아직 사용할 수 있는 내 목소리가 없어요. 새로 만들거나 건너뛸 수 있어요.
                  </AppText>
                )}
                <TouchableOpacity
                  style={styles.personaManageBtn}
                  onPress={() => navigation.navigate('VoiceManage' as any, { mode: 'voices' })}
                >
                  <AppText style={styles.personaManageBtnText}>내 목소리 만들기/관리</AppText>
                </TouchableOpacity>
              </ScrollView>
            )}

            {/* v3.102: 적용 방식 토글 제거 — 후보가 클론뿐이라 목소리(voice_persona) 고정 */}

            <View style={styles.twoBtnRow}>
              <TouchableOpacity style={styles.skipBtn} onPress={() => handlePersonaConfirm(false)}>
                <AppText style={styles.skipBtnText}>건너뛰기</AppText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.applyBtn, !selectedPersonaId && { opacity: 0.4 }]}
                onPress={() => handlePersonaConfirm(true)}
                disabled={!selectedPersonaId}
              >
                <AppText style={styles.applyBtnText}>적용</AppText>
              </TouchableOpacity>
            </View>
          </View>
        );

      default:
        return null;
    }
  };

  // 진행도 (step 100/101은 sub-vocal 임시 step → 표시상 마지막으로 처리)
  const totalSteps = DIRECTOR_MESSAGES.length;
  const displayedStep = step >= 100 ? totalSteps : Math.min(step + 1, totalSteps);
  const progressPct = (displayedStep / totalSteps) * 100;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 140 : 80}
    >
      {/* 진행도 바 */}
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 6, backgroundColor: colors.bg.deepest }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
          <AppText style={{ fontSize: 11, color: colors.text.secondary, fontWeight: '600' }}>작곡 진행</AppText>
          <AppText style={{ fontSize: 11, color: colors.accent.primary, fontWeight: '700' }}>
            {displayedStep} / {totalSteps}
          </AppText>
        </View>
        <View style={{ height: 4, backgroundColor: colors.border.subtle, borderRadius: 2, overflow: 'hidden' }}>
          <View style={{ width: `${progressPct}%`, height: 4, backgroundColor: colors.accent.primary }} />
        </View>
      </View>

      {/* v3.94: 디렉터 휴식(쿨다운) 배지 — 남은 시간 카운트다운, 탭하면 단축 다이얼로그 */}
      {fatigueRemainSec > 0 && (
        <TouchableOpacity
          style={styles.fatigueBadge}
          activeOpacity={0.8}
          onPress={() =>
            showFatigueCooldownDialog({
              status: fatigue,
              remainingSec: fatigueRemainSec,
              onStatusUpdate: applyFatigueStatus,
              onCleared: refreshFatigue, // 배지 경유는 해제만 반영 (자동 생성 시작 없음)
            })
          }
        >
          <AppText style={styles.fatigueBadgeText}>
            디렉터 휴식 중 · 남은 시간 {formatCooldown(fatigueRemainSec)}
            {fatigue ? ` · 오늘 완성 ${fatigue.today_completed}곡` : ''}
          </AppText>
          <AppText style={styles.fatigueBadgeAction}>단축</AppText>
        </TouchableOpacity>
      )}

      {/* Chat history */}
      <ScrollView
        ref={scrollRef}
        style={styles.chatArea}
        contentContainerStyle={[styles.chatContent, { paddingTop: 8 }]}
        showsVerticalScrollIndicator={false}
      >
        {chatHistory.map((msg, idx) => (
          <View
            key={idx}
            style={[
              styles.messageBubbleRow,
              msg.type === 'user' ? styles.userRow : styles.directorRow,
            ]}
          >
            {msg.type === 'director' && (
              <View style={styles.directorPortraitContainer}>
                <Image source={COMPOSER_PORTRAIT} style={styles.directorPortraitImage} />
              </View>
            )}
            {/* v3.148: step 태그가 있는 내 답변은 탭 → 그 단계부터 다시 선택 (작사 디렉터 UX) */}
            <TouchableOpacity
              style={[
                styles.messageBubble,
                msg.type === 'user' ? styles.userBubble : styles.directorBubble,
              ]}
              activeOpacity={msg.type === 'user' && msg.step != null ? 0.6 : 1}
              disabled={!(msg.type === 'user' && msg.step != null)}
              onPress={() => handleUserBubbleTap(idx)}
            >
              <AppText
                style={[
                  styles.messageText,
                  msg.type === 'user' ? styles.userText : styles.directorText,
                ]}
              >
                {msg.text}
              </AppText>
              {msg.type === 'user' && msg.step != null && (
                <AppText style={styles.editHint}>탭해서 수정</AppText>
              )}
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>

      {/* Current step input */}
      {renderInputArea()}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  // v3.148: 내 답변 말풍선 수정 힌트
  editHint: { fontSize: 10, color: 'rgba(255,255,255,0.55)', marginTop: 4, textAlign: 'right' },
  container: {
    flex: 1,
    backgroundColor: colors.bg.deepest,
  },
  // v3.94: 디렉터 휴식(쿨다운) 배지
  fatigueBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginTop: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.accent.primary,
    backgroundColor: colors.bg.surface1,
  },
  fatigueBadgeText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: colors.text.secondary,
  },
  fatigueBadgeAction: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.accent.primary,
    marginLeft: 8,
  },
  chatArea: {
    flex: 1,
  },
  chatContent: {
    padding: 16,
    paddingTop: 16,
    paddingBottom: 16,
  },
  messageBubbleRow: {
    flexDirection: 'row',
    marginBottom: 12,
    alignItems: 'flex-end',
  },
  directorRow: {
    justifyContent: 'flex-start',
    paddingRight: 50,
  },
  userRow: {
    justifyContent: 'flex-end',
    paddingLeft: 50,
  },
  directorPortraitContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: colors.accent.primary,
    marginRight: 8,
  },
  directorPortraitImage: {
    width: 36,
    height: 108,
    resizeMode: 'cover',
    position: 'absolute',
    top: 0,
    left: 0,
  },
  messageBubble: {
    borderRadius: 16,
    padding: 12,
    maxWidth: '80%',
  },
  directorBubble: {
    backgroundColor: colors.text.primary,
    borderBottomLeftRadius: 4,
  },
  userBubble: {
    backgroundColor: colors.accent.primary,
    borderBottomRightRadius: 4,
    alignSelf: 'flex-end',
  },
  messageText: {
    fontSize: 15,
    lineHeight: 22,
  },
  directorText: {
    color: colors.bg.deepest,
  },
  userText: {
    color: colors.text.primary,
  },
  inputArea: {
    borderTopWidth: 1,
    borderTopColor: colors.bg.surface1,
    paddingBottom: 30,
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  // Lyrics input (step 0)
  lyricsInput: {
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: 12,
    padding: 14,
    color: colors.text.primary,
    fontSize: 14,
    minHeight: 120,
    maxHeight: 200,
    lineHeight: 22,
    marginBottom: 10,
  },
  confirmButton: {
    backgroundColor: colors.accent.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  confirmButtonDisabled: {
    backgroundColor: colors.border.subtle,
  },
  confirmButtonText: {
    color: colors.text.primary,
    fontSize: 15,
    fontWeight: 'bold',
  },
  // Choices (genre/mood)
  choicesScroll: {
    maxHeight: 220,
  },
  choicesContainer: {
    gap: 6,
    paddingBottom: 4,
  },
  choiceButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  choiceButtonSelected: {
    borderColor: colors.accent.primary,
    // TODO: 테마화 검토 (선택된 상태의 어두운 보라 배경)
    backgroundColor: '#2a1020',
  },
  choiceNumber: {
    color: colors.accent.primary,
    fontWeight: 'bold',
    fontSize: 14,
    marginRight: 10,
    width: 20,
  },
  choiceText: {
    color: colors.text.secondary,
    fontSize: 14,
  },
  choiceTextSelected: {
    color: colors.accent.primary,
    fontWeight: '600',
  },
  // Vocal (step 3)
  vocalSection: {
    marginBottom: 10,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  toggleLabel: {
    color: colors.text.primary,
    fontSize: 15,
    fontWeight: '600',
  },
  vocalStyleScroll: {
    marginTop: 10,
    flexGrow: 0,
  },
  vocalStyleContainer: {
    gap: 8,
  },
  vocalChip: {
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  vocalChipSelected: {
    backgroundColor: colors.accent.primary,
    borderColor: colors.accent.primary,
  },
  vocalChipText: {
    color: colors.text.secondary,
    fontSize: 14,
  },
  vocalChipTextSelected: {
    color: colors.text.primary,
    fontWeight: 'bold',
  },
  // v3.146: 장르/분위기 직접 입력 행 (LyricsInput inputRow/textInput/sendButton 미러)
  customPickRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingTop: 10,
    gap: 8,
  },
  customPickInput: {
    flex: 1,
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: colors.text.primary,
    fontSize: 14,
    maxHeight: 100,
  },
  customPickSend: {
    backgroundColor: colors.accent.primary,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  customPickSendDisabled: {
    backgroundColor: colors.border.subtle,
  },
  customPickSendText: {
    color: colors.text.primary,
    fontSize: 14,
    fontWeight: '700',
  },
  // Free text input (steps 5, 6)
  freeTextInput: {
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: 12,
    padding: 14,
    color: colors.text.primary,
    fontSize: 14,
    minHeight: 60,
    lineHeight: 22,
    marginBottom: 10,
  },
  // Advanced settings (step 7)
  advancedSection: { marginBottom: 12 },
  advancedLabel: { color: colors.text.secondary, fontSize: 13, marginBottom: 6, fontWeight: '600' },
  paramRow: {
    backgroundColor: colors.bg.deepest,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.bg.surface1,
    padding: 12,
    marginBottom: 8,
  },
  paramHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
  },
  paramTitle: { color: colors.text.primary, fontSize: 14, fontWeight: 'bold' as const },
  paramDesc: { color: colors.text.muted, fontSize: 11, marginTop: 2 },
  sliderRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    marginTop: 8,
  },
  sliderValue: { color: colors.accent.primary, fontSize: 14, fontWeight: 'bold' as const, minWidth: 30, textAlign: 'right' as const },
  sliderEndLabel: { color: colors.text.muted, fontSize: 11, paddingHorizontal: 4 },
  sliderValueCenter: { color: colors.accent.primary, fontSize: 16, fontWeight: 'bold' as const, textAlign: 'center' as const, marginTop: 6, marginBottom: 8 },
  twoBtnRow: { flexDirection: 'row' as const, gap: 10, marginTop: 8 },
  skipBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center' as const,
    backgroundColor: colors.bg.surface2,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  skipBtnText: { color: colors.text.secondary, fontSize: 14, fontWeight: '600' as const },
  applyBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center' as const,
    backgroundColor: colors.accent.primary,
  },
  applyBtnText: { color: colors.text.primary, fontSize: 14, fontWeight: '700' as const },
  advancedInput: {
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: 12,
    padding: 12,
    color: colors.text.primary,
    fontSize: 14,
  },
  keyScroll: { flexGrow: 0, marginBottom: 4 },
  keyChip: {
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 6,
  },
  keyChipSelected: { backgroundColor: colors.accent.primary, borderColor: colors.accent.primary },
  keyChipText: { color: colors.text.secondary, fontSize: 12 },
  keyChipTextSelected: { color: colors.text.primary, fontWeight: 'bold' },
  // v3.78: 내 목소리 페르소나 선택 (case 12)
  personaChip: {
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 6,
  },
  personaChipSelected: {
    borderColor: colors.accent.primary,
    // 선택된 상태의 어두운 보라 배경 (choiceButtonSelected 관행)
    backgroundColor: '#2a1020',
  },
  personaChipText: { color: colors.text.secondary, fontSize: 14 },
  personaChipTextSelected: { color: colors.accent.primary, fontWeight: '700' },
  personaEmptyText: {
    color: colors.text.muted,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  // v3.84: 프리셋 아티스트 목소리 안내 (case 12)
  presetNotice: {
    color: colors.accent.primary,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600' as const,
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  personaManageBtn: {
    backgroundColor: colors.bg.surface2,
    borderWidth: 1,
    borderColor: colors.accent.primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center' as const,
    marginBottom: 4,
  },
  personaManageBtnText: { color: colors.accent.primary, fontSize: 13, fontWeight: '700' as const },
  // Reference (step 8)
  refButtonRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  uploadButton: {
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: 12,
    borderStyle: 'dashed',
    paddingVertical: 20,
    alignItems: 'center',
  },
  uploadButtonText: {
    color: colors.text.secondary,
    fontSize: 14,
  },
  recordingActive: {
    borderColor: colors.accent.primary,
    // TODO: 테마화 검토 (녹음 중 표시 배경)
    backgroundColor: '#1a0a10',
  },
  recordingContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  recordingText: {
    color: colors.accent.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  fileInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
    paddingHorizontal: 4,
  },
  fileInfoText: {
    color: colors.text.secondary,
    fontSize: 12,
    flex: 1,
  },
  removeFileText: {
    color: colors.accent.primary,
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 8,
  },
  noteText: {
    color: colors.text.muted,
    fontSize: 11,
    marginTop: 6,
    fontStyle: 'italic',
  },
  skipButton: {
    marginTop: 10,
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.text.muted,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  skipButtonText: {
    color: colors.text.secondary,
    fontSize: 14,
    fontWeight: '600',
  },
  // Generate button
  generateButton: {
    backgroundColor: colors.accent.primary,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  generateButtonText: {
    color: colors.text.primary,
    fontSize: 17,
    fontWeight: 'bold',
  },
});

// v3.137 — 아티스트 카드 전용 스타일
const artistCardStyles = StyleSheet.create({
  thumb: {
    width: 44, height: 60, borderRadius: 8, marginRight: 10,
    backgroundColor: colors.bg.surface2,
    resizeMode: 'cover',
  } as any,
  voiceTag: { fontSize: 11, color: colors.text.secondary, marginTop: 2 },
});
