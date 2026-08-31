import { useState, useRef, useEffect } from 'react';
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
  Modal,
} from 'react-native';
import { AppText } from '../components/ui';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLyricsStore } from '../stores/lyricsStore';
import { colors } from '../theme/colors';
import {
  buildLyricsRequest,
  GENRE_OPTIONS,
  MOOD_OPTIONS,
  STYLE_OPTIONS,
  CONTENT_OPTIONS,
  KEYWORD_OPTIONS,
  PERSPECTIVE_OPTIONS,
  LANGUAGE_OPTIONS,
  STRUCTURE_OPTIONS,
  DUET_OPTIONS,
} from '../utils/lyricsPrompt';

const LYRICIST_PORTRAIT = require('../assets/portraits/lyricist_director.png');

interface ChatMessage {
  type: 'director' | 'user';
  text: string;
  step?: number; // user 메시지에만 사용 - 클릭 시 해당 step으로 되돌아감
}

interface StepConfig {
  question: string;
  choices?: string[];
  freeText?: boolean;
  freeTextPlaceholder?: string;
}

// step: 0=장르, 1=분위기, 2=스타일, 3=듀엣, 4=내용, 5=키워드, 6=시점, 7=언어, 8=구조, 9=랩, 10=길이, 11=추가요청
// v3.110 — 선택지는 utils/lyricsPrompt 와 공유 (요약 카드 수정 시에도 동일 목록 사용)
const STEPS: StepConfig[] = [
  {
    question: '어떤 장르의 곡을 만들까요?',
    choices: GENRE_OPTIONS,
  },
  {
    question: '', // dynamic
    choices: MOOD_OPTIONS,
  },
  {
    question: '어떤 스타일의 사운드가 좋을까요?',
    choices: STYLE_OPTIONS,
  },
  {
    question: '혼자 부르는 곡인가요, 둘이 부르는 곡인가요?',
    choices: DUET_OPTIONS,
  },
  {
    // v3.118.1(대표): 추상적 질문 → 구체 질문 + 자유 입력 예시(주제)
    question: '어떤 주제로 곡을 작곡하고 싶으세요?',
    choices: CONTENT_OPTIONS,
    freeText: true,
    freeTextPlaceholder: '예: 30대의 다이어트 고민, 퇴근길의 위로, 첫사랑 고백',
  },
  {
    // v3.118.1(대표): 키워드/문구를 명확히 구분해 질문 + 예시
    question: '꼭 들어갔으면 하는 키워드나 문구가 있으신가요?',
    choices: KEYWORD_OPTIONS,
    freeText: true,
    freeTextPlaceholder: "예: 키워드 '벚꽃', '밤하늘' / 문구 '야호!', '다시 만나자'",
  },
  {
    question: '가사 속 화자는 어떤 시점이 좋을까요?',
    choices: PERSPECTIVE_OPTIONS,
  },
  {
    question: '가사 언어는 어떻게 할까요?',
    choices: LANGUAGE_OPTIONS,
  },
  {
    question: '곡의 흐름(구조)은 어떻게 짜볼까요?',
    choices: STRUCTURE_OPTIONS,
  },
  {
    question: '랩 파트를 넣을까요?',
    choices: ['포함', '포함하지 않음'],
  },
  {
    question: '곡 길이는 어느 정도가 좋을까요?',
    choices: ['30초', '1분', '2분', '3분', '4분', '5분'],
  },
  {
    question: '마지막이에요! 더 부탁하고 싶은 게 있다면 알려주세요.',
    freeText: true,
    freeTextPlaceholder: '예: IU - 밤편지 느낌, BTS Spring Day처럼',
  },
];

type Props = NativeStackScreenProps<any, 'LyricsInput'>;

export default function LyricsInputScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const store = useLyricsStore();
  const [step, setStep] = useState(0);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([
    { type: 'director', text: '어떤 장르의 곡을 만들까요?' },
  ]);
  const [customInput, setCustomInput] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  const [durationLabel, setDurationLabel] = useState('');
  const [reselectStep, setReselectStep] = useState<number | null>(null);

  useEffect(() => {
    setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 100);
  }, [chatHistory]);

  const processAnswer = (answer: string, currentStep: number) => {
    // 0=장르, 1=분위기, 2=스타일, 3=듀엣, 4=내용, 5=키워드, 6=시점, 7=언어, 8=구조, 9=랩, 10=길이, 11=추가요청
    switch (currentStep) {
      case 0: store.setGenre(answer); break;
      case 1: store.setMood(answer); break;
      case 2: store.setStyle(answer); break;
      case 3: store.setIsDuet(answer === '듀엣'); break;
      case 4: store.setContent(answer); break;
      case 5: store.setKeywords(answer); break;
      case 6: store.setPerspective(answer); break;
      case 7: store.setLanguage(answer); break;
      case 8: store.setStructure(answer); break;
      case 9: store.setHasRap(answer === '포함'); break;
      case 10: {
        setDurationLabel(answer);
        const durationMap: Record<string, number> = { '30초': 30, '1분': 60, '2분': 120, '3분': 180, '4분': 240, '5분': 300 };
        store.setDuration(durationMap[answer] || 120);
        break;
      }
      case 11: store.setReference(answer); break;
    }

    const nextStep = currentStep + 1;

    if (nextStep >= STEPS.length) {
      setStep(nextStep);

      const newHistory: ChatMessage[] = [
        ...chatHistory,
        { type: 'user', text: answer, step: currentStep },
        { type: 'director', text: '좋아요! 모든 준비가 끝났어요. 가사를 만들어볼게요!' },
      ];
      setChatHistory(newHistory);

      setTimeout(() => {
        // v3.110 — 프롬프트 원문은 사용자에게 보여주지 않는다.
        // buildLyricsRequest 가 백엔드 계약대로 조립한 곡 설명을 세션 플래그 겸 기록으로 저장.
        const latest = useLyricsStore.getState();
        latest.setGeneratedPrompt(buildLyricsRequest(latest).prompt);
        navigation.navigate('LyricsPromptReview');
      }, 1500);
      return;
    }

    // Get next question
    let nextQuestion = STEPS[nextStep].question;
    if (nextStep === 1) {
      nextQuestion = `좋아요! ${answer}(으)로 갈게요. 분위기는 어떻게 할까요?`;
    }

    const newHistory: ChatMessage[] = [
      ...chatHistory,
      { type: 'user', text: answer, step: currentStep },
      { type: 'director', text: nextQuestion },
    ];
    setChatHistory(newHistory);
    setStep(nextStep);
    setCustomInput('');
  };

  const handleReselect = (targetStep: number) => {
    // 자유 입력 스텝(추가요청)은 선택지가 없어 재선택 모달 대상이 아님
    if (!STEPS[targetStep]?.choices?.length) return;
    setReselectStep(targetStep);
  };

  const handleReselectChoice = (choice: string) => {
    if (reselectStep == null) return;
    // store 업데이트 — v3.110: processAnswer 와 동일한 스텝 매핑으로 통일 (기존 off-by-one 수정)
    switch (reselectStep) {
      case 0: store.setGenre(choice); break;
      case 1: store.setMood(choice); break;
      case 2: store.setStyle(choice); break;
      case 3: store.setIsDuet(choice === '듀엣'); break;
      case 4: store.setContent(choice); break;
      case 5: store.setKeywords(choice); break;
      case 6: store.setPerspective(choice); break;
      case 7: store.setLanguage(choice); break;
      case 8: store.setStructure(choice); break;
      case 9: store.setHasRap(choice === '포함'); break;
      case 10: {
        const durationMap: Record<string, number> = { '30초': 30, '1분': 60, '2분': 120, '3분': 180, '4분': 240, '5분': 300 };
        store.setDuration(durationMap[choice] || 120);
        setDurationLabel(choice);
        break;
      }
    }
    // 대화 기록에서 해당 user 메시지 텍스트만 교체
    setChatHistory((prev) =>
      prev.map((msg) =>
        msg.type === 'user' && msg.step === reselectStep
          ? { ...msg, text: choice }
          : msg
      )
    );
    setReselectStep(null);
  };

  const handleChoicePress = (choice: string) => {
    processAnswer(choice, step);
  };

  const handleCustomSubmit = () => {
    const text = customInput.trim();
    if (!text) return;
    processAnswer(text, step);
  };

  const currentConfig = STEPS[step];
  const isComplete = step >= STEPS.length;

  // 진행도 (0-based step → 1-based displayed)
  const displayedStep = Math.min(step + 1, STEPS.length);
  const progressPct = (displayedStep / STEPS.length) * 100;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 140 : 80}
    >
      {/* 진행도 바 */}
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 6, backgroundColor: colors.bg.deepest }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
          <AppText style={{ fontSize: 11, color: colors.text.secondary, fontWeight: '600' }}>작사 진행</AppText>
          <AppText style={{ fontSize: 11, color: colors.accent.primary, fontWeight: '700' }}>
            {displayedStep} / {STEPS.length}
          </AppText>
        </View>
        <View style={{ height: 4, backgroundColor: colors.border.subtle, borderRadius: 2, overflow: 'hidden' }}>
          <View style={{ width: `${progressPct}%`, height: 4, backgroundColor: colors.accent.primary }} />
        </View>
      </View>

      {/* 가사 보관함 진입 (작사 시작 전에만 노출) */}
      {!chatHistory.some((m) => m.type === 'user') && (
        <View style={{ paddingHorizontal: 16, paddingTop: 8, backgroundColor: colors.bg.deepest }}>
          <TouchableOpacity
            style={styles.bookEntryButton}
            onPress={() => {
              if (__DEV__) console.log('[LyricsBook] 보관함 진입 (LyricsInput)');
              navigation.navigate('LyricsBook');
            }}
          >
            <AppText style={styles.bookEntryText}>가사 보관함</AppText>
            <AppText style={styles.bookEntrySub}>저장해둔 가사 보기 · 바로 작곡하기</AppText>
          </TouchableOpacity>
        </View>
      )}

      {/* 안내 */}
      {chatHistory.some((m) => m.type === 'user') && (
        <View style={{ paddingHorizontal: 16, paddingBottom: 4, backgroundColor: colors.bg.deepest }}>
          <AppText style={{ fontSize: 11, color: colors.text.muted, textAlign: 'center' }}>이전 답변을 탭하면 다시 선택할 수 있어요</AppText>
        </View>
      )}

      {/* Chat history */}
      <ScrollView
        ref={scrollRef}
        style={styles.chatArea}
        contentContainerStyle={[styles.chatContent, { paddingTop: chatHistory.some((m) => m.type === 'user') ? 8 : insets.top + 16 }]}
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
              <View style={styles.smallPortraitContainer}>
                <Image source={LYRICIST_PORTRAIT} style={styles.smallPortraitImage} />
              </View>
            )}
            <TouchableOpacity
              activeOpacity={msg.type === 'user' && msg.step != null ? 0.6 : 1}
              onPress={() => {
                if (msg.type === 'user' && msg.step != null) handleReselect(msg.step);
              }}
              style={[
                styles.messageBubble,
                msg.type === 'user' ? styles.userBubble : styles.directorBubble,
              ]}
            >
              <AppText
                style={[
                  styles.messageText,
                  msg.type === 'user' ? styles.userText : styles.directorText,
                ]}
              >
                {msg.text}
              </AppText>
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>

      {/* 이전에 완성한 프롬프트가 있으면 바로 이동 버튼 표시 */}
      {store.generatedPrompt ? (
        <View style={styles.inputArea}>
          <TouchableOpacity
            style={[styles.sendButton, { flex: 1, paddingVertical: 14 }]}
            onPress={() => navigation.navigate('LyricsPromptReview')}
          >
            <AppText style={styles.sendButtonText}>요청사항으로 돌아가기</AppText>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Current step choices */}
      {!isComplete && (
        <View style={styles.inputArea}>
          {currentConfig.choices && (
            <ScrollView
              horizontal={false}
              style={styles.choicesScroll}
              contentContainerStyle={styles.choicesContainer}
              showsVerticalScrollIndicator={false}
            >
              {currentConfig.choices.map((choice, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={styles.choiceButton}
                  onPress={() => handleChoicePress(choice)}
                >
                  <AppText style={styles.choiceNumber}>{idx + 1}</AppText>
                  <AppText style={styles.choiceText}>{choice}</AppText>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {/* Custom text input - 길이(8), 랩(9)에서는 숨김 */}
          {step !== 3 && step !== 9 && step !== 10 && (
            <View style={styles.inputRow}>
              <TextInput
                style={styles.textInput}
                placeholder={
                  currentConfig.freeText
                    ? currentConfig.freeTextPlaceholder
                    : '직접 입력...'
                }
                placeholderTextColor={colors.text.muted}
                value={customInput}
                onChangeText={setCustomInput}
                multiline={currentConfig.freeText}
                returnKeyType={currentConfig.freeText ? 'default' : 'send'}
                onSubmitEditing={
                  !currentConfig.freeText ? handleCustomSubmit : undefined
                }
              />
              <TouchableOpacity
                style={[
                  styles.sendButton,
                  (!customInput.trim() && step !== STEPS.length - 1) && styles.sendButtonDisabled,
                ]}
                onPress={() => {
                  if (step === STEPS.length - 1 && !customInput.trim()) {
                    processAnswer('없음', step);
                  } else {
                    handleCustomSubmit();
                  }
                }}
                disabled={!customInput.trim() && step !== STEPS.length - 1}
              >
                <AppText style={styles.sendButtonText}>{step === STEPS.length - 1 ? (customInput.trim() ? '확인' : '건너뛰기') : '확인'}</AppText>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}
      {/* 재선택 모달 */}
      <Modal visible={reselectStep != null} transparent animationType="fade" onRequestClose={() => setReselectStep(null)}>
        <TouchableOpacity style={styles.reselectOverlay} activeOpacity={1} onPress={() => setReselectStep(null)}>
          <View style={styles.reselectContainer}>
            <AppText style={styles.reselectTitle}>다시 선택하기</AppText>
            <ScrollView style={{ maxHeight: 300 }}>
              {reselectStep != null && STEPS[reselectStep]?.choices?.map((choice, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={styles.reselectOption}
                  onPress={() => handleReselectChoice(choice)}
                >
                  <AppText style={styles.reselectOptionText}>{choice}</AppText>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.reselectClose} onPress={() => setReselectStep(null)}>
              <AppText style={styles.reselectCloseText}>취소</AppText>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg.deepest,
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
  smallPortraitContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
    marginRight: 8,
    borderWidth: 1,
    borderColor: colors.accent.primary,
  },
  smallPortraitImage: {
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
  },
  choicesScroll: {
    maxHeight: 200,
  },
  choicesContainer: {
    paddingHorizontal: 12,
    paddingTop: 10,
    gap: 6,
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
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingTop: 10,
    gap: 8,
  },
  textInput: {
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
  sendButton: {
    backgroundColor: colors.accent.primary,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  sendButtonDisabled: {
    backgroundColor: colors.border.subtle,
  },
  sendButtonText: {
    color: colors.text.primary,
    fontWeight: 'bold',
    fontSize: 14,
  },
  reselectOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  reselectContainer: {
    backgroundColor: colors.bg.surface1,
    borderRadius: 16,
    padding: 20,
    width: '85%',
    maxHeight: '60%',
  },
  reselectTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.text.primary,
    marginBottom: 16,
    textAlign: 'center',
  },
  reselectOption: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: colors.bg.deepest,
    marginBottom: 6,
  },
  reselectOptionText: {
    color: colors.text.secondary,
    fontSize: 14,
  },
  reselectClose: {
    marginTop: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  reselectCloseText: {
    color: colors.text.secondary,
    fontSize: 14,
  },
  bookEntryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  bookEntryText: {
    color: colors.text.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  bookEntrySub: {
    color: colors.text.muted,
    fontSize: 11,
  },
});
