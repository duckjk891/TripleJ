import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Image,
  ScrollView,
  ActivityIndicator,
  Alert,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import api, { BACKEND_BASE_URL } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { useCharacterTaskStore } from '../stores/characterTaskStore';
import { useGemsStore } from '../stores/gemsStore';
import { usePlayerStore } from '../stores/playerStore';
import { useOutfitStore } from '../stores/outfitStore';
import { colors } from '../theme/colors';

// 추가 아티스트 1회 생성 비용 (다이아)
const EXTRA_ARTIST_GEM_COST = 100;
const MINIPLAYER_HEIGHT = 70;

const ARTIST_PORTRAIT = require('../assets/portraits/artist_director.png');

interface MyCharacter {
  sheet_object_name: string;
}

interface ChatMessage {
  type: 'director' | 'user';
  text: string;
}

type Step = 'welcome' | 'questioning';

interface StyleAnswers {
  hair: string;
  face: string;
  skin: string;
  body: string;
  height: string;
  mood: string;
}

const EMPTY_ANSWERS: StyleAnswers = {
  hair: '', face: '', skin: '', body: '', height: '', mood: '',
};

interface QuestionDef {
  key: keyof StyleAnswers;
  short: string;
  question: string;
  chips: string[];
  placeholder: string;
}

const QUESTIONS: QuestionDef[] = [
  {
    key: 'hair', short: '머리',
    question: '먼저, 머리 스타일과 색은 어떤 느낌이 좋을까요?',
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
  if (answers.hair) parts.push(`머리는 ${answers.hair}`);
  if (answers.face) parts.push(`얼굴은 ${answers.face}`);
  if (answers.skin) parts.push(`피부는 ${answers.skin}`);
  if (answers.body) parts.push(`체형은 ${answers.body}`);
  if (answers.height) parts.push(`키는 ${answers.height}`);
  if (answers.mood) parts.push(`분위기는 ${answers.mood}`);
  return parts.join(', ');
}

export default function ArtistInputScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const titleLabel = user?.display_title || '대표';
  const taskStore = useCharacterTaskStore();

  const scrollRef = useRef<ScrollView>(null);
  const [step, setStep] = useState<Step>('welcome');
  const [chat, setChat] = useState<ChatMessage[]>([
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
          <Text style={{ fontSize: 26, color: colors.text.primary, fontWeight: '300' }}>‹</Text>
        </TouchableOpacity>
      ),
    });
    return () => {
      parent.setOptions({ headerLeft: undefined });
    };
  }, [navigation]);
  // 다이아로 추가 아티스트 생성 결제 완료 시 true → 잠금 해제하고 사진 올리기 가능
  const [extraUnlocked, setExtraUnlocked] = useState(false);
  const gemsBalance = useGemsStore((s) => s.balance);
  const hasMiniPlayer = !!usePlayerStore((s) => s.track);
  const bottomLift = hasMiniPlayer ? MINIPLAYER_HEIGHT : 0;

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
  }, [chat, step]);

  // 초기: 내 캐릭터 로드
  useEffect(() => {
    if (!user) {
      setInitialLoading(false);
      return;
    }
    (async () => {
      try {
        const res = await api.get('/character/me');
        if (res.data?.character) {
          setMyCharacter(res.data.character);
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

  const handlePurchaseExtraSlot = () => {
    if (gemsBalance < EXTRA_ARTIST_GEM_COST) {
      Alert.alert(
        '다이아 부족',
        `추가 아티스트를 만들려면 다이아 ${EXTRA_ARTIST_GEM_COST}개가 필요해요. (보유: ${gemsBalance}개)`
      );
      return;
    }
    Alert.alert(
      '추가 아티스트 만들기',
      `다이아 ${EXTRA_ARTIST_GEM_COST}개를 사용해서 새로운 아티스트를 만들까요?\n(현재 아티스트는 그대로 유지돼요)`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: `${EXTRA_ARTIST_GEM_COST} 다이아 사용`,
          onPress: () => {
            const ok = useGemsStore.getState().spend(
              EXTRA_ARTIST_GEM_COST,
              'extra_artist_slot'
            );
            if (!ok) {
              Alert.alert('오류', '다이아 차감에 실패했어요.');
              return;
            }
            setExtraUnlocked(true);
            pushDirector(
              `다이아 ${EXTRA_ARTIST_GEM_COST}개로 슬롯을 열었어요! 새 아티스트의 사진을 올려주세요.`
            );
          },
        },
      ]
    );
  };

  // ── Photo pick → 6단계 질문 시작 ─────────────────────────────
  const handlePickPhoto = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: 'image/*' });
      if (!res.canceled && res.assets && res.assets[0]) {
        const file = res.assets[0];
        setPhotoUri(file.uri);
        setPhotoName(file.name);
        pushUser(`사진 선택: ${file.name}`);
        pushDirector(QUESTIONS[0].question);
        setQIndex(0);
        setStyleAnswers(EMPTY_ANSWERS);
        setCurrentInput('');
        setStep('questioning');
      }
    } catch {
      Alert.alert('오류', '사진을 선택하지 못했어요.');
    }
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
    if (!photoUri) {
      Alert.alert('오류', '사진을 먼저 올려주세요.');
      return;
    }
    const userInput = buildFinalText(answers);
    // 캐릭터 컨셉 텍스트만 저장. 의상은 다음 화면에서 결정.
    const conceptText = userInput || '특별한 컨셉 없음 — 자연스러운 느낌으로';

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
          <Text style={styles.emptyIcon}>🎤</Text>
          <Text style={styles.emptyTitle}>로그인이 필요해요</Text>
          <Text style={styles.emptyDesc}>아티스트 디렉터와 함께 나만의 아티스트를 만들어보세요!</Text>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => navigation.getParent()?.navigate('Settings')}
          >
            <Text style={styles.primaryBtnText}>로그인하기</Text>
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

  // 기존 캐릭터 있으면 결과 화면으로 바로 이동 옵션 제공
  const existingPreviewUrl = myCharacter?.sheet_object_name
    ? `${BACKEND_BASE_URL}/api/character/preview/${myCharacter.sheet_object_name}`
    : null;

  const renderInputArea = () => {
    if (step === 'welcome') {
      // 이미 아티스트가 있고 추가 슬롯 결제 안 했으면 차단
      if (myCharacter && !extraUnlocked) {
        return (
          <View style={styles.inputArea}>
            <View style={styles.lockNotice}>
              <Text style={styles.lockNoticeIcon}>🔒</Text>
              <Text style={styles.lockNoticeTitle}>아티스트는 한 명까지 무료로 만들 수 있어요</Text>
              <Text style={styles.lockNoticeDesc}>
                추가 아티스트를 만들려면 다이아 {EXTRA_ARTIST_GEM_COST}개가 필요해요.
              </Text>
              <Text style={styles.lockNoticeBalance}>보유 다이아 💎 {gemsBalance}</Text>
            </View>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={handlePurchaseExtraSlot}
            >
              <Text style={styles.primaryBtnText}>
                💎 {EXTRA_ARTIST_GEM_COST} 사용하고 추가 아티스트 만들기
              </Text>
            </TouchableOpacity>
          </View>
        );
      }
      return (
        <View style={styles.inputArea}>
          <TouchableOpacity style={styles.primaryBtn} onPress={handlePickPhoto}>
            <Text style={styles.primaryBtnText}>📷 사진 올리기</Text>
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
            <Text style={styles.qProgressText}>
              {qIndex + 1} / {QUESTIONS.length} · {q.short}
            </Text>
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
                  <Text style={[styles.chipText, sel && styles.chipTextSelected]}>{chip}</Text>
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
              <Text style={styles.skipBtnText}>건너뛰기</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.applyBtn} onPress={() => handleAnswerNext(false)}>
              <Text style={styles.applyBtnText}>{isLast ? '만들기' : '다음'}</Text>
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
            <Text style={styles.myArtistLabel}>현재 아티스트</Text>
            {existingPreviewUrl ? (
              <Image source={{ uri: existingPreviewUrl }} style={styles.myArtistImg} />
            ) : null}
            <View style={{ flexDirection: 'row', gap: 8, alignSelf: 'stretch' }}>
              <TouchableOpacity
                style={[styles.applyBtn, { flex: 1 }]}
                onPress={() => navigation.replace('ArtistResult')}
              >
                <Text style={styles.applyBtnText}>✨ 아티스트 꾸미기</Text>
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
              <Text
                style={[
                  styles.bubbleText,
                  msg.type === 'user' ? { color: colors.text.primary } : { color: colors.bg.deepest },
                ]}
              >
                {msg.text}
              </Text>
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

  lockNotice: {
    backgroundColor: colors.bg.surface1, borderRadius: 12, padding: 14,
    marginBottom: 10, alignItems: 'center',
    borderWidth: 1, borderColor: colors.border.subtle,
  },
  lockNoticeIcon: { fontSize: 28, marginBottom: 6 },
  lockNoticeTitle: {
    fontSize: 14, fontWeight: '700', color: colors.text.primary,
    marginBottom: 4, textAlign: 'center',
  },
  lockNoticeDesc: {
    fontSize: 12, color: colors.text.secondary,
    textAlign: 'center', lineHeight: 18,
  },
  lockNoticeBalance: {
    fontSize: 12, fontWeight: '700', color: colors.accent.primary,
    marginTop: 8,
  },

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
