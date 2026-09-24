import { useState, useRef, useEffect, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
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
} from 'react-native';
import { AppText } from '../components/ui';
// v3.204(④): 재선택 모달을 공용 AnswerEditModal로 추출 — 마크업·스타일 그대로(회귀 0)
import AnswerEditModal from '../components/AnswerEditModal';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLyricsStore } from '../stores/lyricsStore';
import { useMusicStore } from '../stores/musicStore';
// v3.229 [DirectorResume]: 보존 draft 판정 공용(작업실 맵 바로 가기와 같은 규칙)
import { isLyricsDraftResumable } from '../utils/directorResume';
import { colors } from '../theme/colors';
import {
  buildLyricsRequest,
  GENRE_OPTIONS,
  MOOD_OPTIONS,
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

// step: 0=장르, 1=분위기, 2=듀엣, 3=내용, 4=키워드, 5=시점, 6=언어, 7=구조, 8=랩, 9=길이, 10=추가요청
// v3.129(대표): 사운드(스타일) 질문 제거 — 장르에 사운드 정체성(록=밴드, 포크=어쿠스틱,
// EDM=전자음, 클래식=오케스트라)이 이미 포함돼 중복. 작곡용 악기·질감 태그는
// musicService가 장르에서 자동 파생(GENRE_DEFAULT_STYLE).
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
    question: '혼자 부르는 곡인가요, 둘이 부르는 곡인가요?',
    choices: DUET_OPTIONS,
  },
  {
    // v3.118.1(대표): 추상적 질문 → 구체 질문 + 자유 입력 예시(주제)
    question: '어떤 주제로 곡을 작곡하고 싶으세요?',
    choices: CONTENT_OPTIONS,
    freeText: true,
    freeTextPlaceholder: '예: 급식 시간이 제일 좋아, 30대의 다이어트 고민, 손주 응원가',
  },
  {
    // v3.165a(대표): 입력창 예시가 선택 칩과 중복 — 칩에 없는 예시 하나로 정리
    question: '꼭 들어갔으면 하는 키워드나 문구가 있으신가요?',
    choices: KEYWORD_OPTIONS,
    freeText: true,
    freeTextPlaceholder: "예: 키워드 '여름밤' / 문구 '우리 다시 시작해'",
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

// v3.219 [LyricsDraft]: 곡 길이 라벨 역산(duration → '2분' 등) — draft 복원 시 durationLabel 재구성
const DURATION_LABEL_BY_SEC: Record<number, string> = {
  30: '30초', 60: '1분', 120: '2분', 180: '3분', 240: '4분', 300: '5분',
};

export default function LyricsInputScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const store = useLyricsStore();
  // v3.219 [LyricsDraft]: 마운트 시점 store 스냅샷 — draft가 있으면 진행도·대화를 hydrate(이어서).
  // draft는 아래 미러링 effect가 스텝마다 기록하고, 발매(lyricsStore.reset())·'처음부터 다시'에만 지운다.
  const initialStore = useRef(useLyricsStore.getState()).current;
  const hasResumableDraft = isLyricsDraftResumable(initialStore);
  // v3.229 [LyricsDraft]: draft와 함께 저장한 창작 모드 — 복귀 시 인사 대사(모드 선택)를 건너뛰므로 여기서 되살린다.
  // 구 draft(null)는 현재 모드 유지.
  const restoredCreationMode = hasResumableDraft ? initialStore.draftCreationMode : null;
  const [resumeCreationMode] = useState<'standard' | 'copyright'>(
    () => restoredCreationMode ?? useMusicStore.getState().creationMode
  );
  const [step, setStep] = useState(hasResumableDraft ? initialStore.draftStep : 0);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>(
    hasResumableDraft
      ? (initialStore.draftChat as ChatMessage[])
      : [{ type: 'director', text: '어떤 장르의 곡을 만들까요?' }]
  );
  const [customInput, setCustomInput] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  const [durationLabel, setDurationLabel] = useState(
    hasResumableDraft ? DURATION_LABEL_BY_SEC[initialStore.duration] ?? '' : ''
  );
  // v3.219 [LyricsDraft]: 복원 안내 버블(인라인 '처음부터 다시' 액션) 노출 여부
  const [showResumeNotice, setShowResumeNotice] = useState(hasResumableDraft);

  useEffect(() => {
    if (__DEV__ && hasResumableDraft) {
      console.info('[LyricsDraft] draft 복원 — 이어서 진행', {
        step: initialStore.draftStep, chatLen: initialStore.draftChat.length,
      });
    }
    if (restoredCreationMode && useMusicStore.getState().creationMode !== restoredCreationMode) {
      console.info('[LyricsDraft] creationMode 복원', {
        from: useMusicStore.getState().creationMode, to: restoredCreationMode,
      });
      useMusicStore.getState().setCreationMode(restoredCreationMode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // v3.129: 사운드 질문 제거 — 이전 세션의 style 잔존값이 작곡에 섞이지 않게 진입 시 초기화
  // v3.219 [LyricsDraft]: draft 복원 진입에서는 스킵(진행 중 대화의 store 상태 훼손 금지)
  useEffect(() => {
    if (!hasResumableDraft) store.setStyle('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // v3.219 [LyricsDraft]: 진행 대화를 store에 미러링 — 재진입 복원 원천(커버 v3.202 H-⑤ 패턴).
  // lyricsStore는 AsyncStorage persist라 텍스트 답변이 핫리로드·앱 재시작에도 생존(2026-09-07 정책).
  useEffect(() => {
    const s = useLyricsStore.getState();
    s.setDraftStep(step);
    s.setDraftChat(chatHistory);
    // v3.229: 창작 모드도 draft와 함께 기록(복원 효과가 먼저 실행된 뒤라 복원값이 그대로 실린다)
    s.setDraftCreationMode(useMusicStore.getState().creationMode);
  }, [step, chatHistory]);

  // v3.219 [LyricsDraft]: '처음부터 다시' — store(답변·결과·draft) 초기화 후 1번 질문부터
  const handleRestartFromScratch = () => {
    if (__DEV__) console.info('[LyricsDraft] 처음부터 다시 — store·draft 초기화');
    store.reset();
    useLyricsStore.getState().setStyle(''); // 진입 초기화와 동치(잔존 style 차단)
    setStep(0);
    setChatHistory([{ type: 'director', text: STEPS[0].question }]);
    setDurationLabel('');
    setCustomInput('');
    setReselectStep(null);
    setShowResumeNotice(false);
  };
  const [reselectStep, setReselectStep] = useState<number | null>(null);
  // v3.204(④): 재선택 모달 렌더는 공용 AnswerEditModal로 이관 — 키보드 리프트·동적 maxHeight·
  // 자유 입력(trim·빈값 disabled)은 모달 내부가 담당. 반영 로직(handleReselectChoice)은 유지.

  // v3.199(B): "디렉터와 이야기하는 중"의 연장 — Studio 탭 헤더에 back 주입(DialogueScreen 동일 패턴).
  // goBack만 수행(확인 팝업은 과설계 — chatHistory는 로컬 state라 이탈 시 초기화됨을 아는 동작).
  // v3.201(C): blur cleanup(headerLeft: undefined) 제거 — 화면 전환 시 이전 화면 cleanup이 다음 화면
  // focus 주입 뒤에 실행될 수 있어(focus/blur 순서 비보장) 진입 직후 화살표가 소실되는 경합의 주 원인.
  // "포커스 화면만 헤더에 쓴다" 불변식: 3화면 focus(set) + MapScreen focus(clear)만 쓰기 지점.
  useFocusEffect(
    useCallback(() => {
      const parent = navigation.getParent();
      parent?.setOptions({
        headerLeft: () => (
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={{ marginLeft: 12 }}
            accessibilityLabel="뒤로"
          >
            <Feather name="arrow-left" size={22} color={colors.text.primary} />
          </TouchableOpacity>
        ),
      });
    }, [navigation])
  );

  useEffect(() => {
    setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 100);
  }, [chatHistory]);

  const processAnswer = (answer: string, currentStep: number) => {
    // v3.219 [LyricsDraft]: 이어서 답변 시작 — 복원 안내 버블 접기
    if (showResumeNotice) setShowResumeNotice(false);
    // 0=장르, 1=분위기, 2=듀엣, 3=내용, 4=키워드, 5=시점, 6=언어, 7=구조, 8=랩, 9=길이, 10=추가요청
    switch (currentStep) {
      case 0: store.setGenre(answer); break;
      case 1: store.setMood(answer); break;
      case 2: store.setIsDuet(answer === '듀엣'); break;
      case 3: store.setContent(answer); break;
      case 4: store.setKeywords(answer); break;
      case 5: store.setPerspective(answer); break;
      case 6: store.setLanguage(answer); break;
      case 7: store.setStructure(answer); break;
      case 8: store.setHasRap(answer === '포함'); break;
      case 9: {
        setDurationLabel(answer);
        const durationMap: Record<string, number> = { '30초': 30, '1분': 60, '2분': 120, '3분': 180, '4분': 240, '5분': 300 };
        store.setDuration(durationMap[answer] || 120);
        break;
      }
      case 10: store.setReference(answer); break;
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
    // v3.219 [LyricsDraft]: 재선택도 "이어서" 진행 — 복원 안내 버블 접기
    if (showResumeNotice) setShowResumeNotice(false);
    // store 업데이트 — v3.110: processAnswer 와 동일한 스텝 매핑으로 통일 (기존 off-by-one 수정)
    switch (reselectStep) {
      case 0: store.setGenre(choice); break;
      case 1: store.setMood(choice); break;
      case 2: store.setIsDuet(choice === '듀엣'); break;
      case 3: store.setContent(choice); break;
      case 4: store.setKeywords(choice); break;
      case 5: store.setPerspective(choice); break;
      case 6: store.setLanguage(choice); break;
      case 7: store.setStructure(choice); break;
      case 8: store.setHasRap(choice === '포함'); break;
      case 9: {
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

  // v3.201(B): 취소·백드롭·백버튼 공통 닫기 — 미반영 (자유 입력 리셋은 모달 내부 담당)
  const closeReselect = () => {
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
              {/* v3.199(D): 재선택 가능 답변(선택지 스텝)에만 편집 어포던스 — VideoDirector :411 스펙 동일.
                  자유입력 답변은 재선택 모달 비대상(no-op)이라 미표시(거짓 어포던스 금지) */}
              {msg.type === 'user' && msg.step != null && STEPS[msg.step]?.choices?.length ? (
                <Feather name="edit-2" size={11} color="rgba(255,255,255,0.7)" style={{ marginLeft: 6 }} />
              ) : null}
            </TouchableOpacity>
          </View>
        ))}
        {/* v3.219 [LyricsDraft]: 복원 안내 버블 — 디렉터 대화 톤 + 인라인 '처음부터 다시' 액션 */}
        {showResumeNotice && (
          <View style={[styles.messageBubbleRow, styles.directorRow]}>
            <View style={styles.smallPortraitContainer}>
              <Image source={LYRICIST_PORTRAIT} style={styles.smallPortraitImage} />
            </View>
            <View style={[styles.messageBubble, styles.directorBubble]}>
              <AppText style={[styles.messageText, styles.directorText]}>
                {resumeCreationMode === 'copyright'
                  ? '진행하던 작사를 이어서 할게요! 새로 시작하고 싶으면 아래 버튼을 눌러주세요.\n저작권 등록 모드로 이어서 해요.'
                  : '진행하던 작사를 이어서 할게요! 새로 시작하고 싶으면 아래 버튼을 눌러주세요.'}
              </AppText>
              <TouchableOpacity style={styles.restartInlineBtn} onPress={handleRestartFromScratch}>
                <AppText style={styles.restartInlineBtnText}>처음부터 다시</AppText>
              </TouchableOpacity>
            </View>
          </View>
        )}
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

          {/* Custom text input - 듀엣(2)·랩(8)·길이(9)에서는 숨김 (v3.129 인덱스 시프트 반영) */}
          {step !== 2 && step !== 8 && step !== 9 && (
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
      {/* 재선택 모달 — v3.204(④): 공용 AnswerEditModal (v3.201(B)/v3.202(B) 마크업·스타일 그대로 추출).
          자유 입력 노출 조건은 메인 플로우와 동치 — 듀엣 2·랩 8·길이 9는 enum 매핑 스텝이라
          자유 텍스트가 boolean/duration 오매핑을 유발 → 비노출 원칙 유지. */}
      <AnswerEditModal
        visible={reselectStep != null}
        choices={(reselectStep != null && STEPS[reselectStep]?.choices) || []}
        freeText={reselectStep != null && reselectStep !== 2 && reselectStep !== 8 && reselectStep !== 9}
        onPick={handleReselectChoice}
        onCancel={closeReselect}
      />
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
    // v3.199(D): 텍스트+편집 아이콘 row 배치 (VideoDirector bubbleUser 관행)
    flexDirection: 'row',
    alignItems: 'center',
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
    flexShrink: 1, // v3.199(D): row 배치에서 긴 자유입력 답변이 버블 밖으로 밀리지 않게(Yoga 기본 0)
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
  // v3.219 [LyricsDraft]: 복원 안내 버블 인라인 '처음부터 다시' 액션
  restartInlineBtn: {
    marginTop: 8,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.accent.primary,
    borderRadius: 12,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  restartInlineBtnText: {
    color: colors.accent.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  // v3.204(④): reselect* 스타일은 components/AnswerEditModal.tsx로 이관(그대로 추출)
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
