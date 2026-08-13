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
} from 'react-native';
import { AppText } from '../components/ui';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLyricsStore } from '../stores/lyricsStore';
import { colors } from '../theme/colors';

const COMPOSER_PORTRAIT = require('../assets/portraits/composer_director.png');

interface ChatMessage {
  type: 'director' | 'user';
  text: string;
}

interface StepConfig {
  question: string;
  choices?: string[];
  freeText?: boolean;
  freeTextPlaceholder?: string;
}

const STEPS: StepConfig[] = [
  {
    question: '어떤 장르의 음악을 만들까요?',
    choices: ['K-Pop', 'Hip-hop', 'R&B', '발라드', 'EDM', '록', '재즈', '클래식', '인디', '시티팝'],
  },
  {
    question: '', // dynamic
    choices: ['Energetic', 'Chill', 'Romantic', 'Dreamy', 'Dark', '밝은', '감성적', '몽환적'],
  },
  {
    question: '보컬은 어떤 느낌이 좋을까요?',
    choices: ['남성 - 파워풀', '남성 - 따뜻한', '여성 - 맑은', '여성 - 허스키', 'Instrumental (연주곡)'],
  },
  {
    question: '원하는 음악 스타일이 있다면 설명해주세요!',
    freeText: true,
    freeTextPlaceholder: '예: 부드러운 피아노 멜로디와 어쿠스틱 기타',
  },
  {
    question: '참고하고 싶은 스타일이 있나요?',
    freeText: true,
    freeTextPlaceholder: '예: 2000년대 초반 R&B 발라드',
  },
];

type Props = NativeStackScreenProps<any, 'ComposerInput'>;

export default function ComposerInputScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const store = useLyricsStore();
  const [step, setStep] = useState(0);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([
    { type: 'director', text: '어떤 장르의 음악을 만들까요?' },
  ]);
  const [customInput, setCustomInput] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  // Local state for composer parameters
  const [genre, setGenre] = useState('');
  const [mood, setMood] = useState('');
  const [vocal, setVocal] = useState('');
  const [styleDesc, setStyleDesc] = useState('');
  const [referenceStyle, setReferenceStyle] = useState('');

  useEffect(() => {
    setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 100);
  }, [chatHistory]);

  const processAnswer = (answer: string, currentStep: number) => {
    switch (currentStep) {
      case 0:
        setGenre(answer);
        store.setGenre(answer);
        break;
      case 1:
        setMood(answer);
        store.setMood(answer);
        break;
      case 2:
        setVocal(answer);
        break;
      case 3:
        setStyleDesc(answer);
        break;
      case 4:
        setReferenceStyle(answer);
        break;
    }

    const nextStep = currentStep + 1;

    if (nextStep >= STEPS.length) {
      setStep(nextStep);

      const newHistory: ChatMessage[] = [
        ...chatHistory,
        { type: 'user', text: answer },
        { type: 'director', text: '좋아요! 모든 준비가 끝났어요. 작곡을 시작해볼게요!' },
      ];
      setChatHistory(newHistory);

      setTimeout(() => {
        const genreVal = currentStep === 0 ? answer : genre;
        const moodVal = currentStep === 1 ? answer : mood;
        const vocalVal = currentStep === 2 ? answer : vocal;
        const styleDescVal = currentStep === 3 ? answer : styleDesc;
        const referenceVal = currentStep === 4 ? answer : referenceStyle;

        const prompt = `장르: ${genreVal}\n분위기: ${moodVal}\n보컬: ${vocalVal}\n스타일: ${styleDescVal}\n참고 스타일: ${referenceVal}`;
        store.setGeneratedPrompt(prompt);
        navigation.navigate('ComposerSelect');
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
      { type: 'user', text: answer },
      { type: 'director', text: nextQuestion },
    ];
    setChatHistory(newHistory);
    setStep(nextStep);
    setCustomInput('');
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

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      {/* Chat history */}
      <ScrollView
        ref={scrollRef}
        style={styles.chatArea}
        contentContainerStyle={[styles.chatContent, { paddingTop: insets.top + 16 }]}
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
                <Image source={COMPOSER_PORTRAIT} style={styles.smallPortraitImage} />
              </View>
            )}
            <View
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
            </View>
          </View>
        ))}
      </ScrollView>

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

          {/* Custom text input */}
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
                !customInput.trim() && styles.sendButtonDisabled,
              ]}
              onPress={handleCustomSubmit}
              disabled={!customInput.trim()}
            >
              <AppText style={styles.sendButtonText}>{'확인'}</AppText>
            </TouchableOpacity>
          </View>
        </View>
      )}
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
    height: 72,
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
});
