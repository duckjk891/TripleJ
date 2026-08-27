import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Image,
  ScrollView,
  ActivityIndicator,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { AppText } from '../components/ui';
import { showAlert } from '../utils/appAlert';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import api, { BACKEND_BASE_URL } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { useCharacterTaskStore } from '../stores/characterTaskStore';
import { usePlayerStore } from '../stores/playerStore';
import { useOutfitStore } from '../stores/outfitStore';
import { fetchStyleSamples, resolveArtStyleLabel, type StyleSample } from '../utils/artStyle';
import { colors } from '../theme/colors';

const MINIPLAYER_HEIGHT = 70;

const ARTIST_PORTRAIT = require('../assets/portraits/artist_director.png');

interface MyCharacter {
  sheet_object_name?: string;
  // v3.80: 가상화(그림) 슬롯 — 가상만 있어도 "캐릭터 있음"으로 취급
  virtual_sheet_object_name?: string;
}

interface ChatMessage {
  type: 'director' | 'user';
  text: string;
}

type Step = 'welcome' | 'questioning' | 'style';

interface StyleAnswers {
  gender: string;
  hair: string;
  face: string;
  skin: string;
  body: string;
  height: string;
  mood: string;
}

const EMPTY_ANSWERS: StyleAnswers = {
  gender: '', hair: '', face: '', skin: '', body: '', height: '', mood: '',
};

interface QuestionDef {
  key: keyof StyleAnswers;
  short: string;
  question: string;
  chips: string[];
  placeholder: string;
}

const QUESTIONS: QuestionDef[] = [
  // v3.82: 성별 질문 — 답변은 user_text에 포함(생성 품질)되고,
  // 생성 성공 시 artistProfileStore에 기록되어 상세 화면에 표시된다.
  {
    key: 'gender', short: '성별',
    question: '먼저, 우리 아티스트의 성별은 어떻게 할까요?',
    chips: ['남성', '여성'],
    placeholder: '예: 여성',
  },
  {
    key: 'hair', short: '머리',
    question: '머리 스타일과 색은 어떤 느낌이 좋을까요?',
    chips: ['긴 생머리', '단발', '컬리', '짧은컷', '검정', '갈색', '밝은톤'],
    placeholder: '예: 어두운 갈색 웨이브',
  },
  {
    key: 'face', short: '얼굴',
    question: '얼굴 인상은요? 눈·코·입 어떤 느낌이면 좋겠어요?',
    chips: ['큰 눈', '날카로운', '부드러운', '둥근 얼굴', '갸름한 얼굴'],
    placeholder: '예: 둥근 얼굴, 큰 눈, 오똑한 코',
  },
  {
    key: 'skin', short: '피부',
    question: '피부 톤은 어떻게 할까요?',
    chips: ['하얀', '자연스러운', '그을린'],
    placeholder: '예: 약간 그을린 건강한 톤',
  },
  {
    key: 'body', short: '체형',
    question: '체형은요?',
    chips: ['마른', '보통', '글래머', '근육질'],
    placeholder: '예: 슬림한 체형',
  },
  {
    key: 'height', short: '키',
    question: '키는 어느 정도가 어울릴까요?',
    chips: ['아담', '보통', '키 큰'],
    placeholder: '예: 170cm 정도',
  },
  {
    key: 'mood', short: '분위기',
    question: '마지막으로, 전체적인 분위기는?',
    chips: ['도시적', '청순', '강렬한 록', '청량', '몽환적'],
    placeholder: '예: 차가운 카리스마',
  },
];

function buildFinalText(answers: StyleAnswers): string {
  const parts: string[] = [];
  if (answers.gender) parts.push(`성별은 ${answers.gender}`);
  if (answers.hair) parts.push(`머리는 ${answers.hair}`);
  if (answers.face) parts.push(`얼굴은 ${answers.face}`);
  if (answers.skin) parts.push(`피부는 ${answers.skin}`);
  if (answers.body) parts.push(`체형은 ${answers.body}`);
  if (answers.height) parts.push(`키는 ${answers.height}`);
  if (answers.mood) parts.push(`분위기는 ${answers.mood}`);
  return parts.join(', ');
}

export default function ArtistInputScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const titleLabel = user?.display_title || '대표';
  const taskStore = useCharacterTaskStore();

  // v3.81: MyArtists에서 슬롯 추가로 진입하면 kind 강제 — 같은 kind로 만들면
  // 기존 아티스트를 덮어쓰는 서버 제약이 있어 위반 방지가 핵심(토글 숨김 + 초기값 고정).
  const forceKind: 'real' | 'virtual' | undefined = route?.params?.forceKind;

  const scrollRef = useRef<ScrollView>(null);
  const [step, setStep] = useState<Step>('welcome');
  // v3.82: forceKind 진입이어도 kind 언급 문구는 표시하지 않음(내부 로직만 유지)
  const [chat, setChat] = useState<ChatMessage[]>(() => [
    {
      type: 'director',
      text: `안녕하세요 ${titleLabel}님! 우리 아티스트의 얼굴 사진을 한 장 올려주세요.`,
    },
  ]);

  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoName, setPhotoName] = useState<string>('');

  // 6단계 질문
  const [qIndex, setQIndex] = useState(0);
  const [styleAnswers, setStyleAnswers] = useState<StyleAnswers>(EMPTY_ANSWERS);
  const [currentInput, setCurrentInput] = useState('');

  const [myCharacter, setMyCharacter] = useState<MyCharacter | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);

  // v3.80: 가상화(그림) 캐릭터 모드 + 화풍 선택 스텝 (v3.81: forceKind 진입 시 고정)
  const [isVirtualMode, setIsVirtualMode] = useState(forceKind === 'virtual');
  const [styleSamples, setStyleSamples] = useState<StyleSample[]>([]);
  const [styleLoading, setStyleLoading] = useState(false);
  const [styleLoadError, setStyleLoadError] = useState(false);
  const [selectedPresetKey, setSelectedPresetKey] = useState<string | null>(null);
  const [styleUpload, setStyleUpload] = useState<{ uri: string; name: string } | null>(null);
  const [styleImgLoaded, setStyleImgLoaded] = useState<Record<string, boolean>>({});
  // 질문 완료 후 화풍 스텝을 거치는 동안 보관되는 컨셉 텍스트
  const [pendingConceptText, setPendingConceptText] = useState('');

  // Tab 헤더 좌측에 ← 버튼 주입 (web/모바일 공통 — Map으로 복귀)
  useLayoutEffect(() => {
    const parent = navigation.getParent();
    if (!parent) return;
    parent.setOptions({
      headerLeft: () => (
        <TouchableOpacity
          onPress={() => navigation.navigate('Map')}
          style={{ paddingHorizontal: 12, paddingVertical: 6 }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <AppText style={{ fontSize: 26, color: colors.text.primary, fontWeight: '300' }}>‹</AppText>
        </TouchableOpacity>
      ),
    });
    return () => {
      parent.setOptions({ headerLeft: undefined });
    };
  }, [navigation]);
  const hasMiniPlayer = !!usePlayerStore((s) => s.track);
  const bottomLift = hasMiniPlayer ? MINIPLAYER_HEIGHT : 0;

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
  }, [chat, step]);

  // 초기: 내 캐릭터 로드
  useEffect(() => {
    if (__DEV__ && forceKind) console.info('[ArtistInput] forceKind 진입 — kind 고정', { forceKind });
    if (!user) {
      setInitialLoading(false);
      return;
    }
    (async () => {
      try {
        const res = await api.get('/character/me');
        const ch = res.data?.character;
        // v3.80: 실사(sheet_object_name) 또는 가상(virtual_sheet_object_name)이 있으면 "캐릭터 있음"
        if (ch && (ch.sheet_object_name || ch.virtual_sheet_object_name)) {
          setMyCharacter(ch);
        }
      } catch {}
      finally {
        setInitialLoading(false);
      }
    })();
  }, [user]);

  const pushDirector = (text: string) =>
    setChat((prev) => [...prev, { type: 'director' as const, text }]);
  const pushUser = (text: string) =>
    setChat((prev) => [...prev, { type: 'user' as const, text }]);

  // 질문 단계 공통 진입
  const startQuestioning = () => {
    pushDirector(QUESTIONS[0].question);
    setQIndex(0);
    setStyleAnswers(EMPTY_ANSWERS);
    setCurrentInput('');
    setStep('questioning');
  };

  // ── Photo pick → 사진 확약(MAIDOL v137) → 6단계 질문 시작 ─────
  const handlePickPhoto = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: 'image/*' });
      if (!res.canceled && res.assets && res.assets[0]) {
        const file = res.assets[0];
        // v3.76: 사진 확약 — 본인/동의 확인 + 보관·비학습 고지. 미확인 시 진행 불가.
        showAlert(
          '사진 확인',
          '이 사진은 본인이거나, 사진 속 인물의 동의를 받았음을 확인해주세요.\n\n사진은 캐릭터 생성에만 사용되며 AI 학습에 쓰이지 않아요.',
          [
            { text: '취소', style: 'cancel' },
            {
              text: '확인했어요',
              onPress: () => {
                if (__DEV__) console.info('[ArtistInput] 사진 확약 완료', { name: file.name, isVirtualMode });
                setPhotoUri(file.uri);
                setPhotoName(file.name);
                // v3.80: 실사 진입 시 characterKind:'real' 명시 (가상 모드 잔존 방지)
                taskStore.setInput({ portraitConfirmed: true, characterKind: isVirtualMode ? 'virtual' : 'real' });
                pushUser(`사진 선택: ${file.name}`);
                startQuestioning();
              },
            },
          ]
        );
      }
    } catch {
      showAlert('오류', '사진을 선택하지 못했어요.');
    }
  };

  // ── v3.76(MAIDOL v161): 사진 없이 텍스트만으로 생성 ─────
  const handleTextOnly = () => {
    if (__DEV__) console.info('[ArtistInput] 텍스트-only 경로 시작', { isVirtualMode });
    setPhotoUri(null);
    setPhotoName('');
    // v3.80: 실사 진입 시 characterKind:'real' 명시 (가상 모드 잔존 방지)
    taskStore.setInput({ portraitConfirmed: false, characterKind: isVirtualMode ? 'virtual' : 'real' });
    pushUser('사진 없이 만들게요');
    pushDirector('좋아요! 설명만 듣고 상상해서 만들어드릴게요. 대신 조금 더 자세히 알려주세요!');
    setTimeout(() => startQuestioning(), 400);
  };

  // ── v3.80: 가상화(그림) 캐릭터 모드 토글 ─────
  const handleToggleVirtual = () => {
    const next = !isVirtualMode;
    if (__DEV__) console.info('[ArtistInput] 가상화 모드 토글', { next });
    setIsVirtualMode(next);
    taskStore.setInput({
      characterKind: next ? 'virtual' : 'real',
      stylePreset: null,
      styleImageUri: null,
      styleImageName: null,
    });
    if (next) {
      pushUser('그림 스타일로 만들게요');
      pushDirector('좋아요! 그림 스타일로 만들어드릴게요. 사진을 올리면 그 인상을 참고하고, 사진 없이 설명만으로도 만들 수 있어요. 마지막에 화풍(그림체)을 고르게 돼요.');
    } else {
      pushUser('그림 스타일 없이 만들게요');
      pushDirector('알겠어요! 사진을 올리거나 사진 없이 시작해주세요.');
    }
  };

  // ── v3.80: 화풍 샘플 로드 (무인증·무비용 GET) ─────
  const loadStyleSamples = async () => {
    setStyleLoading(true);
    setStyleLoadError(false);
    try {
      const samples = await fetchStyleSamples();
      setStyleSamples(samples);
      if (samples.length === 0) setStyleLoadError(true);
    } catch (err: any) {
      console.error('[ArtistInput] style-samples 로드 실패', { status: err?.response?.status, message: err?.message });
      setStyleLoadError(true);
    } finally {
      setStyleLoading(false);
    }
  };

  // v3.80: 화풍 직접 업로드 — 샘플 선택과 상호 배타
  const handlePickStyleImage = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: 'image/*' });
      if (!res.canceled && res.assets && res.assets[0]) {
        const file = res.assets[0];
        if (__DEV__) console.info('[ArtistInput] 화풍 이미지 업로드 선택', { name: file.name });
        setStyleUpload({ uri: file.uri, name: file.name });
        setSelectedPresetKey(null);
      }
    } catch {
      showAlert('오류', '이미지를 선택하지 못했어요.');
    }
  };

  // v3.80: 화풍 확정 → 코디 선택 화면으로 (기존 실사 흐름과 동일 진입점)
  const handleStyleConfirm = () => {
    if (!selectedPresetKey && !styleUpload) {
      showAlert('알림', '화풍을 하나 골라주세요. 샘플 중에 고르거나 이미지를 직접 올릴 수 있어요.');
      return;
    }
    if (__DEV__) console.info('[ArtistInput] 화풍 확정', { preset: selectedPresetKey, upload: styleUpload?.name });
    pushUser(
      styleUpload
        ? `화풍 이미지: ${styleUpload.name}`
        : `화풍: ${resolveArtStyleLabel(selectedPresetKey, styleSamples)}`
    );
    pushDirector('좋아요! 이제 어떤 옷을 입혀줄지 골라볼까요?');

    // 새 시트 → 이전 캐릭터의 outfit 정보는 폐기
    useOutfitStore.getState().clear();
    taskStore.setInput({
      photoUri,
      photoName,
      userText: pendingConceptText,
      stylePreset: styleUpload ? null : selectedPresetKey,
      styleImageUri: styleUpload?.uri ?? null,
      styleImageName: styleUpload?.name ?? null,
    });

    setTimeout(() => {
      navigation.replace('ArtistCody', { mode: 'sheet' });
    }, 1000);
  };

  const handleChipTap = (chip: string) => {
    setCurrentInput((prev) => {
      const tokens = prev.split(',').map((t) => t.trim()).filter(Boolean);
      if (tokens.includes(chip)) {
        return tokens.filter((t) => t !== chip).join(', ');
      }
      return tokens.length === 0 ? chip : `${prev}, ${chip}`;
    });
  };

  const handleAnswerNext = (skip: boolean) => {
    const q = QUESTIONS[qIndex];
    const answer = skip ? '' : currentInput.trim();
    const newAnswers: StyleAnswers = { ...styleAnswers, [q.key]: answer };
    setStyleAnswers(newAnswers);

    if (answer) pushUser(answer);
    else pushUser(`(${q.short} 생략)`);

    if (qIndex + 1 < QUESTIONS.length) {
      const next = QUESTIONS[qIndex + 1];
      setTimeout(() => pushDirector(next.question), 150);
      setQIndex(qIndex + 1);
      setCurrentInput('');
    } else {
      // 마지막 질문 → 만들기 단계로 진입
      handleStartGeneration(newAnswers);
    }
  };

  // ── 컨셉 입력 완료 → 옷 선택 화면으로 ─────
  // (기본 착장 프롬프트 제거. 옷은 ArtistCody에서 선택, 미선택 시 디폴트 fallback)
  const handleStartGeneration = (answers: StyleAnswers) => {
    const userInput = buildFinalText(answers);
    // v3.76: 텍스트-only 경로(사진 없음)에서는 설명이 최소 하나는 필요
    if (!photoUri && !userInput.trim()) {
      showAlert('알림', '사진이 없으면 설명이 필요해요. 질문에 하나 이상 답해주세요.');
      startQuestioning();
      return;
    }
    // 캐릭터 컨셉 텍스트만 저장. 의상은 다음 화면에서 결정.
    const conceptText = userInput || '특별한 컨셉 없음 — 자연스러운 느낌으로';

    // v3.82: 성별 답변 보관 — 생성 성공 시(ArtistLoading) 슬롯별 프로필에 기록
    taskStore.setInput({ pendingGender: answers.gender.trim() || null });

    // v3.80: 가상화 모드는 화풍 선택 스텝을 거친 뒤 ArtistCody로 (handleStyleConfirm에서 진행)
    if (isVirtualMode) {
      setPendingConceptText(conceptText);
      pushDirector('어떤 그림체(화풍)로 그릴까요? 샘플 중에 고르거나 원하는 화풍 이미지를 직접 올려주세요.');
      setStep('style');
      loadStyleSamples();
      return;
    }

    pushDirector('좋아요! 이제 어떤 옷을 입혀줄지 골라볼까요?');

    // 새 시트 → 이전 캐릭터의 outfit 정보는 폐기
    useOutfitStore.getState().clear();
    // photoUri + 컨셉만 저장. API 호출은 옷 선택 후 ArtistLoading에서.
    taskStore.setInput({ photoUri, photoName, userText: conceptText });

    setTimeout(() => {
      // 옷 선택 화면으로. mode='sheet' 전달 → ArtistCody가 초기 생성 분기로 동작.
      navigation.replace('ArtistCody', { mode: 'sheet' });
    }, 1000);
  };

  if (!user) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyBox}>
          <AppText style={styles.emptyTitle}>로그인이 필요해요</AppText>
          <AppText style={styles.emptyDesc}>아티스트 디렉터와 함께 나만의 아티스트를 만들어보세요!</AppText>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => navigation.getParent()?.navigate('Settings')}
          >
            <AppText style={styles.primaryBtnText}>로그인하기</AppText>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (initialLoading) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyBox}>
          <ActivityIndicator size="large" color={colors.accent.primary} />
        </View>
      </View>
    );
  }

  // 기존 캐릭터 있으면 결과 화면으로 바로 이동 옵션 제공 (v3.80: 실사 없으면 가상 슬롯 미리보기)
  const existingSheetObjectName = myCharacter?.sheet_object_name || myCharacter?.virtual_sheet_object_name;
  const existingPreviewUrl = existingSheetObjectName
    ? `${BACKEND_BASE_URL}/api/character/preview/${existingSheetObjectName}`
    : null;

  const renderInputArea = () => {
    if (step === 'welcome') {
      // v3.81: "이미 아티스트가 있어요" 교체 게이트 제거 — 진입 관리는 MyArtists가 담당.
      // 이 화면은 항상 생성 UI (Map 미보유 경로·MyArtists 경유 진입 모두 welcome부터).
      return (
        <View style={styles.inputArea}>
          <TouchableOpacity style={styles.primaryBtn} onPress={handlePickPhoto}>
            <AppText style={styles.primaryBtnText}>사진 올리기</AppText>
          </TouchableOpacity>
          {/* v3.76(MAIDOL v161): 텍스트-only 경로 — 사진 없이 설명만으로 가상 인물 생성 */}
          <TouchableOpacity style={styles.textOnlyBtn} onPress={handleTextOnly}>
            <AppText style={styles.textOnlyBtnText}>사진 없이 만들기</AppText>
          </TouchableOpacity>
          {/* v3.80: 그림 스타일 토글 — v3.81: forceKind 진입 시 숨김(kind 강제 위반 방지)
              v3.82: 라벨은 실사/가상 대비가 아닌 "그림 스타일" 중립 표현 */}
          {!forceKind && (
            <TouchableOpacity
              style={[styles.virtualBtn, isVirtualMode && styles.virtualBtnActive]}
              onPress={handleToggleVirtual}
            >
              <AppText style={[styles.virtualBtnText, isVirtualMode && styles.virtualBtnTextActive]}>
                {isVirtualMode ? '그림 스타일 선택됨 — 취소하려면 탭' : '그림 스타일로 만들기'}
              </AppText>
            </TouchableOpacity>
          )}
          <AppText style={styles.textOnlyHint}>
            {isVirtualMode
              ? '그림 스타일: 위 버튼으로 사진을 올리거나, 사진 없이 시작하세요.'
              : '사진 없이 설명만으로 아티스트를 만들 수도 있어요.'}
          </AppText>
        </View>
      );
    }
    // v3.80: 가상화 모드 — 화풍 선택 스텝
    if (step === 'style') {
      return (
        <View style={styles.inputArea}>
          <View style={styles.qProgress}>
            <AppText style={styles.qProgressText}>화풍 선택 · 그림체를 골라주세요</AppText>
          </View>
          {styleLoading ? (
            <View style={{ paddingVertical: 24, alignItems: 'center' }}>
              <ActivityIndicator size="large" color={colors.accent.primary} />
              <AppText style={styles.styleLoadingText}>화풍 샘플을 불러오는 중...</AppText>
            </View>
          ) : styleLoadError ? (
            <View style={{ paddingVertical: 12, alignItems: 'center' }}>
              <AppText style={styles.styleErrorText}>화풍 샘플을 불러오지 못했어요.</AppText>
              <TouchableOpacity style={styles.retryBtn} onPress={loadStyleSamples}>
                <AppText style={styles.retryBtnText}>다시 시도</AppText>
              </TouchableOpacity>
            </View>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
              {styleSamples.map((s) => {
                const sel = selectedPresetKey === s.key;
                const loaded = !!styleImgLoaded[s.key];
                return (
                  <TouchableOpacity
                    key={s.key}
                    style={[styles.styleCard, sel && styles.styleCardSelected]}
                    onPress={() => {
                      // 샘플 선택 ↔ 직접 업로드 상호 배타
                      setSelectedPresetKey(s.key);
                      setStyleUpload(null);
                    }}
                    activeOpacity={0.8}
                  >
                    <View style={styles.styleCardImgWrap}>
                      <Image
                        source={{ uri: `${BACKEND_BASE_URL}${s.preview_url}` }}
                        style={styles.styleCardImg}
                        onLoadEnd={() => setStyleImgLoaded((prev) => ({ ...prev, [s.key]: true }))}
                      />
                      {!loaded && (
                        <View style={styles.styleCardImgLoading}>
                          <ActivityIndicator size="small" color={colors.accent.primary} />
                        </View>
                      )}
                    </View>
                    <AppText style={[styles.styleCardLabel, sel && styles.styleCardLabelSelected]}>
                      {s.label}
                    </AppText>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
          <TouchableOpacity
            style={[styles.styleUploadBtn, styleUpload && styles.styleUploadBtnActive]}
            onPress={handlePickStyleImage}
          >
            <AppText style={[styles.styleUploadBtnText, styleUpload && styles.styleUploadBtnTextActive]}>
              {styleUpload ? `업로드됨: ${styleUpload.name}` : '화풍 이미지 직접 업로드'}
            </AppText>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.applyBtn, { flex: 0 }, !selectedPresetKey && !styleUpload && { opacity: 0.5 }]}
            onPress={handleStyleConfirm}
          >
            <AppText style={styles.applyBtnText}>이 화풍으로 만들기</AppText>
          </TouchableOpacity>
        </View>
      );
    }
    if (step === 'questioning') {
      const q = QUESTIONS[qIndex];
      const isLast = qIndex === QUESTIONS.length - 1;
      const tokens = currentInput.split(',').map((t) => t.trim()).filter(Boolean);
      return (
        <View style={styles.inputArea}>
          <View style={styles.qProgress}>
            <AppText style={styles.qProgressText}>
              {qIndex + 1} / {QUESTIONS.length} · {q.short}
            </AppText>
          </View>
          <View style={styles.chipsRow}>
            {q.chips.map((chip) => {
              const sel = tokens.includes(chip);
              return (
                <TouchableOpacity
                  key={chip}
                  style={[styles.chip, sel && styles.chipSelected]}
                  onPress={() => handleChipTap(chip)}
                >
                  <AppText style={[styles.chipText, sel && styles.chipTextSelected]}>{chip}</AppText>
                </TouchableOpacity>
              );
            })}
          </View>
          <TextInput
            style={styles.textInput}
            value={currentInput}
            onChangeText={setCurrentInput}
            placeholder={q.placeholder}
            placeholderTextColor={colors.text.muted}
            multiline
          />
          <View style={styles.twoBtnRow}>
            <TouchableOpacity style={styles.skipBtn} onPress={() => handleAnswerNext(true)}>
              <AppText style={styles.skipBtnText}>건너뛰기</AppText>
            </TouchableOpacity>
            <TouchableOpacity style={styles.applyBtn} onPress={() => handleAnswerNext(false)}>
              <AppText style={styles.applyBtnText}>{isLast ? '만들기' : '다음'}</AppText>
            </TouchableOpacity>
          </View>
        </View>
      );
    }
    return null;
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 140 : 80}
    >
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16 }}
      >
        {/* 기존 캐릭터 카드 */}
        {myCharacter && step === 'welcome' && (
          <View style={styles.myArtistCard}>
            <AppText style={styles.myArtistLabel}>현재 아티스트</AppText>
            {existingPreviewUrl ? (
              <Image source={{ uri: existingPreviewUrl }} style={styles.myArtistImg} />
            ) : null}
            <View style={{ flexDirection: 'row', gap: 8, alignSelf: 'stretch' }}>
              <TouchableOpacity
                style={[styles.applyBtn, { flex: 1 }]}
                onPress={() => navigation.replace('ArtistResult')}
              >
                <AppText style={styles.applyBtnText}>아티스트 꾸미기</AppText>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {chat.map((msg, idx) => (
          <View
            key={idx}
            style={[styles.msgRow, msg.type === 'user' ? styles.userRow : styles.dirRow]}
          >
            {msg.type === 'director' && (
              <View style={styles.dirPortrait}>
                <Image source={ARTIST_PORTRAIT} style={styles.dirPortraitImg} />
              </View>
            )}
            <View
              style={[styles.bubble, msg.type === 'user' ? styles.userBubble : styles.dirBubble]}
            >
              <AppText
                style={[
                  styles.bubbleText,
                  msg.type === 'user' ? { color: colors.text.primary } : { color: colors.bg.deepest },
                ]}
              >
                {msg.text}
              </AppText>
            </View>
          </View>
        ))}
      </ScrollView>

      <View style={{ marginBottom: bottomLift }}>
        {renderInputArea()}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.deepest },
  emptyBox: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  emptyIcon: { fontSize: 64, marginBottom: 16 },
  emptyTitle: { fontSize: 20, color: colors.text.primary, fontWeight: '700', marginBottom: 8 },
  emptyDesc: {
    fontSize: 14, color: colors.text.secondary, textAlign: 'center',
    lineHeight: 22, marginBottom: 20,
  },
  myArtistCard: {
    backgroundColor: colors.bg.surface1, borderRadius: 16, padding: 14,
    marginBottom: 16, alignItems: 'center', borderWidth: 1, borderColor: colors.border.subtle,
  },
  myArtistLabel: { fontSize: 12, color: colors.accent.primary, fontWeight: '700', marginBottom: 10 },
  myArtistImg: { width: 160, height: 160, borderRadius: 12, marginBottom: 12 },

  msgRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 12 },
  dirRow: { justifyContent: 'flex-start', paddingRight: 40 },
  userRow: { justifyContent: 'flex-end', paddingLeft: 40 },
  dirPortrait: {
    width: 44, height: 44, borderRadius: 22, overflow: 'hidden',
    borderWidth: 1.5, borderColor: colors.accent.primary,
    marginRight: 8, backgroundColor: colors.bg.surface2,
  },
  // 95x405 전신 → 얼굴 + 목+어깨 살짝: 1.1x zoom + top 약간 음수
  dirPortraitImg: {
    width: 44 * 1.1,
    height: (44 * 1.1) * 405 / 95,
    position: 'absolute',
    top: -44 / 15,
    left: -(44 * 1.1 - 44) / 2,
  },
  bubble: { borderRadius: 16, padding: 12, maxWidth: '80%' },
  dirBubble: { backgroundColor: colors.text.primary, borderBottomLeftRadius: 4 },
  userBubble: {
    backgroundColor: colors.accent.primary, borderBottomRightRadius: 4, alignSelf: 'flex-end',
  },
  bubbleText: { fontSize: 14, lineHeight: 20 },

  inputArea: {
    borderTopWidth: 1, borderTopColor: colors.bg.surface1,
    padding: 14, paddingBottom: 24, backgroundColor: colors.bg.deepest,
  },
  primaryBtn: {
    backgroundColor: colors.accent.primary, borderRadius: 14,
    paddingVertical: 14, alignItems: 'center', marginBottom: 8,
  },
  primaryBtnText: { color: colors.text.primary, fontWeight: '700', fontSize: 15 },
  // v3.76: 텍스트-only 경로 버튼(보조 스타일) + 힌트
  textOnlyBtn: {
    borderWidth: 1, borderColor: colors.border.subtle, borderRadius: 14,
    paddingVertical: 12, alignItems: 'center', marginBottom: 6,
  },
  textOnlyBtnText: { color: colors.text.secondary, fontWeight: '600', fontSize: 14 },
  textOnlyHint: { color: colors.text.muted, fontSize: 11, textAlign: 'center' },

  // v3.80: 가상화(그림) 모드 버튼 + 화풍 선택 스텝
  virtualBtn: {
    borderWidth: 1, borderColor: colors.accent.primary, borderRadius: 14,
    paddingVertical: 12, alignItems: 'center', marginBottom: 6,
  },
  virtualBtnActive: { backgroundColor: colors.accent.primary },
  virtualBtnText: { color: colors.accent.primary, fontWeight: '700', fontSize: 14 },
  virtualBtnTextActive: { color: colors.text.primary },
  styleLoadingText: { color: colors.text.secondary, fontSize: 12, marginTop: 10 },
  styleErrorText: { color: colors.text.secondary, fontSize: 13, marginBottom: 10, textAlign: 'center' },
  retryBtn: {
    paddingVertical: 10, paddingHorizontal: 24, borderRadius: 10,
    backgroundColor: colors.bg.surface2, borderWidth: 1, borderColor: colors.accent.primary,
  },
  retryBtnText: { color: colors.accent.primary, fontSize: 13, fontWeight: '700' },
  styleCard: {
    width: 110, marginRight: 10, borderRadius: 12, padding: 6,
    backgroundColor: colors.bg.surface1, borderWidth: 1.5, borderColor: colors.border.subtle,
    alignItems: 'center',
  },
  styleCardSelected: { borderColor: colors.accent.primary, backgroundColor: colors.bg.surface2 },
  styleCardImgWrap: {
    width: 96, height: 120, borderRadius: 8, overflow: 'hidden',
    backgroundColor: colors.bg.surface2, marginBottom: 6,
  },
  styleCardImg: { width: 96, height: 120, resizeMode: 'cover' },
  styleCardImgLoading: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center', alignItems: 'center',
  },
  styleCardLabel: { color: colors.text.secondary, fontSize: 12, fontWeight: '600' },
  styleCardLabelSelected: { color: colors.accent.primary, fontWeight: '700' },
  styleUploadBtn: {
    borderWidth: 1, borderColor: colors.border.subtle, borderRadius: 12,
    paddingVertical: 11, alignItems: 'center', marginBottom: 8,
    backgroundColor: colors.bg.surface1,
  },
  styleUploadBtnActive: { borderColor: colors.accent.primary },
  styleUploadBtnText: { color: colors.text.secondary, fontSize: 13, fontWeight: '600' },
  styleUploadBtnTextActive: { color: colors.accent.primary, fontWeight: '700' },

  qProgress: { marginBottom: 8 },
  qProgressText: { color: colors.accent.primary, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16,
    backgroundColor: colors.bg.surface1, borderWidth: 1, borderColor: colors.border.subtle,
  },
  chipSelected: { backgroundColor: colors.accent.primary, borderColor: colors.accent.primary },
  chipText: { color: colors.text.secondary, fontSize: 12, fontWeight: '600' },
  chipTextSelected: { color: colors.text.primary },

  textInput: {
    backgroundColor: colors.bg.surface1, borderWidth: 1, borderColor: colors.border.subtle,
    borderRadius: 12, padding: 12, color: colors.text.primary,
    fontSize: 14, minHeight: 56, maxHeight: 120, marginBottom: 8,
  },
  twoBtnRow: { flexDirection: 'row', gap: 10 },
  skipBtn: {
    flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center',
    backgroundColor: colors.bg.surface2, borderWidth: 1, borderColor: colors.border.subtle,
  },
  skipBtnText: { color: colors.text.secondary, fontSize: 13, fontWeight: '600' },
  applyBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center',
    backgroundColor: colors.accent.primary,
  },
  applyBtnText: {
    color: colors.text.primary, fontSize: 13, fontWeight: '700',
    lineHeight: 18,
  },
});
