import { useState, useRef, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Image,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Slider from '@react-native-community/slider';
import { Switch } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMusicStore } from '../stores/musicStore';
import { useLyricsStore } from '../stores/lyricsStore';
import { useTimerStore } from '../stores/timerStore';
import * as DocumentPicker from 'expo-document-picker';
import { Audio } from 'expo-av';

const COMPOSER_PORTRAIT = require('../assets/portraits/composer_director.png');

const GENRES = ['댄스', '발라드', '힙합', 'R&B', '트로트', '인디', '록', '포크', '인디팝', '시티팝', '재즈', 'EDM', '클래식', '가요', 'BGM', '팝', '일렉트로닉'];
const MOODS = ['밝고 경쾌한', '슬프고 우울한', '몽환적·신비로운', '에너지틱·강렬한', '로맨틱·달콤한', '그리운·따뜻한', '잔잔하고 편안한', '흥겹고 신나는'];
const VOCAL_STYLES = ['소프트', '파워풀', '위스퍼', '그루비', '클리어', '허스키'];
const VOCAL_OPTIONS = ['남성', '여성'];

const KEY_OPTIONS = ['C major', 'D major', 'E major', 'F major', 'G major', 'A major', 'B major', 'C minor', 'D minor', 'E minor', 'F minor', 'G minor', 'A minor', 'B minor'];

const DIRECTOR_MESSAGES = [
  '곡 제목을 확인해볼게요! 수정이 필요하면 직접 편집해주세요.',
  '가사를 확인해볼게요! 수정이 필요하면 직접 편집할 수 있어요.',
  '', // dynamic: 장르/분위기/스타일 안내
  '보컬을 선택해주세요!',
  '보컬 스타일을 선택해주세요!',
  '참고하고 싶은 아티스트나 곡이 있다면 업로드 해주세요.',
  '더 세밀하게 조절하고 싶은 부분이 있으면 설정해주세요!',
];

interface ChatMessage {
  type: 'director' | 'user';
  text: string;
}

type Props = NativeStackScreenProps<any, 'MusicGeneration'>;

export default function MusicGenerationScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const musicStore = useMusicStore();
  const lyricsStore = useLyricsStore();
  const timerStore = useTimerStore();

  const [step, setStep] = useState(0);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([
    { type: 'director', text: DIRECTOR_MESSAGES[0] },
  ]);

  // Local state for each step
  const [editedTitle, setEditedTitle] = useState(lyricsStore.generatedTitle || '');
  const [editedLyrics, setEditedLyrics] = useState(lyricsStore.generatedLyrics || musicStore.lyrics || '');
  const [selectedGenre, setSelectedGenre] = useState(lyricsStore.genre || musicStore.genre || '');
  const [selectedMood, setSelectedMood] = useState(lyricsStore.mood || musicStore.mood || '');
  const [useVocal, setUseVocal] = useState(true);
  const [selectedVocalStyle, setSelectedVocalStyle] = useState(musicStore.vocalStyle || '');
  const [selectedVocalGender, setSelectedVocalGender] = useState('');
  const [styleDesc, setStyleDesc] = useState('');
  const [refStyle, setRefStyle] = useState('');
  const [negativeTags, setNegativeTags] = useState('');
  const [customVocalInput, setCustomVocalInput] = useState('');
  // Suno 상세 파라미터
  const [negativeTagsOn, setNegativeTagsOn] = useState(false);
  const [styleWeight, setStyleWeight] = useState(0.5);
  const [styleWeightOn, setStyleWeightOn] = useState(false);
  const [weirdness, setWeirdness] = useState(0.3);
  const [weirdnessOn, setWeirdnessOn] = useState(false);
  const [audioWeight, setAudioWeight] = useState(0.5);
  const [audioWeightOn, setAudioWeightOn] = useState(false);
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

  const advanceStep = (userAnswer: string, nextStep: number) => {
    if (nextStep >= DIRECTOR_MESSAGES.length) {
      // All steps done - show generate button
      const newHistory: ChatMessage[] = [
        ...chatHistory,
        { type: 'user', text: userAnswer },
        { type: 'director', text: '모든 설정이 완료됐어요! 아래 버튼을 눌러 음악을 만들어볼까요?' },
      ];
      setChatHistory(newHistory);
      setStep(nextStep);
    } else {
      const newHistory: ChatMessage[] = [
        ...chatHistory,
        { type: 'user', text: userAnswer },
        { type: 'director', text: DIRECTOR_MESSAGES[nextStep] },
      ];
      setChatHistory(newHistory);
      setStep(nextStep);
    }
  };

  // Step 0: Title confirm → step 1(가사 확인)
  const handleTitleConfirm = () => {
    advanceStep(`제목: ${editedTitle || '(없음)'}`, 1);
  };

  // Step 1: Lyrics confirm → step 2(장르/분위기/스타일 안내, 자동)
  const handleLyricsConfirm = () => {
    if (!editedLyrics.trim()) {
      Alert.alert('알림', '가사를 입력해주세요.');
      return;
    }
    const preview = editedLyrics.trim().split('\n').slice(0, 2).join(' ');
    const displayText = preview.length > 40 ? preview.substring(0, 40) + '...' : preview;

    const genreInfo = lyricsStore.genre || selectedGenre;
    const moodInfo = lyricsStore.mood || selectedMood;
    const styleInfo = lyricsStore.style || '';
    const infoText = [genreInfo, moodInfo, styleInfo].filter(Boolean).join(', ');
    const autoMsg = `장르: ${genreInfo}, 분위기: ${moodInfo}${styleInfo ? `, 스타일: ${styleInfo}` : ''}\n작사 디렉터가 넘겨준 대로 설정했어요!`;

    const newHistory: ChatMessage[] = [
      ...chatHistory,
      { type: 'user', text: `가사 확인: "${displayText}"` },
      { type: 'director', text: autoMsg },
    ];
    setChatHistory(newHistory);
    setStep(2);

    // 자동으로 step 2 → step 3(보컬 선택)으로 넘김
    setTimeout(() => {
      setChatHistory((prev) => [
        ...prev,
        { type: 'user', text: `확인! (${infoText})` },
        { type: 'director', text: DIRECTOR_MESSAGES[3] },
      ]);
      setStep(3);
    }, 1500);
  };

  // Step 3: Vocal select
  const handleVocalSelect = (vocal: string) => {
    setUseVocal(true);
    setSelectedVocalGender(vocal);
    advanceStep(vocal, 4);
  };

  // Step 4: Vocal style select
  const handleVocalStyleSelect = (style: string) => {
    setSelectedVocalStyle(style);
    advanceStep(style, 5);
  };

  // Step 5: Reference artist/song
  const handleRefStyleConfirm = () => {
    advanceStep(refStyle.trim() ? refStyle.trim() : '건너뛰기', 6);
  };

  // Step 6: Advanced settings (Suno 상세 파라미터)
  const handleAdvancedConfirm = () => {
    const parts = [];
    if (bpmOn) parts.push(`BPM: ${bpmValue}`);
    if (musicalKeyOn && musicalKey) parts.push(`키: ${musicalKey}`);
    if (negativeTagsOn && negativeTags.trim()) parts.push(`제외: ${negativeTags.trim()}`);
    if (styleWeightOn) parts.push(`스타일 강도: ${styleWeight.toFixed(1)}`);
    if (weirdnessOn) parts.push(`실험성: ${weirdness.toFixed(1)}`);
    if (audioWeightOn) parts.push(`오디오 영향도: ${audioWeight.toFixed(1)}`);
    advanceStep(parts.length > 0 ? parts.join(', ') : '건너뛰기', 7);
  };

  // Step 6: Reference - file upload
  const handlePickReference = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*' });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const file = result.assets[0];
        musicStore.setReferenceFile(file.uri, file.name);
        advanceStep(`파일 업로드: ${file.name}`, 6);
      }
    } catch {
      Alert.alert('오류', '파일 선택에 실패했습니다.');
    }
  };

  // Step 6: Reference - recording
  const handleStartRecording = async () => {
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('권한 필요', '녹음을 위해 마이크 권한이 필요합니다.');
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
      Alert.alert('오류', '녹음을 시작할 수 없습니다.');
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
        const fileName = `녹음_${new Date().toLocaleTimeString()}.m4a`;
        musicStore.setReferenceFile(uri, fileName);
        advanceStep(`녹음 완료: ${fileName}`, 9);
      }
    } catch {
      Alert.alert('오류', '녹음 저장에 실패했습니다.');
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

  // Final generate
  const handleGenerate = () => {
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
    timerStore.startTask('composer', '작곡');
    navigation.navigate('Map' as any);
  };

  const isComplete = step >= DIRECTOR_MESSAGES.length;

  // Render the current step's input area
  const renderInputArea = () => {
    if (isComplete) {
      return (
        <View style={styles.inputArea}>
          <TouchableOpacity style={styles.generateButton} onPress={handleGenerate}>
            <Text style={styles.generateButtonText}>음악 생성 시작</Text>
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
              placeholderTextColor="#555"
            />
            <TouchableOpacity style={styles.confirmButton} onPress={handleTitleConfirm}>
              <Text style={styles.confirmButtonText}>제목 확인</Text>
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
              placeholderTextColor="#555"
            />
            <TouchableOpacity
              style={[styles.confirmButton, !editedLyrics.trim() && styles.confirmButtonDisabled]}
              onPress={handleLyricsConfirm}
              disabled={!editedLyrics.trim()}
            >
              <Text style={styles.confirmButtonText}>가사 확인 완료</Text>
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
                  <Text style={styles.choiceNumber}>{idx + 1}</Text>
                  <Text style={[styles.choiceText, selectedVocalGender === vocal && styles.choiceTextSelected]}>
                    {vocal}
                  </Text>
                </TouchableOpacity>
              ))}
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
                  <Text style={[styles.vocalChipText, selectedVocalStyle === style && styles.vocalChipTextSelected]}>
                    {style}
                  </Text>
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
              <Text style={styles.uploadButtonText}>파일 업로드</Text>
            </TouchableOpacity>
            {musicStore.referenceFileName && (
              <View style={styles.fileInfo}>
                <Text style={styles.fileInfoText}>선택됨: {musicStore.referenceFileName}</Text>
                <TouchableOpacity onPress={() => musicStore.setReferenceFile(null, null)}>
                  <Text style={styles.removeFileText}>제거</Text>
                </TouchableOpacity>
              </View>
            )}
            <TouchableOpacity style={styles.skipButton} onPress={() => advanceStep(musicStore.referenceFileName || '건너뛰기', 6)}>
              <Text style={styles.skipButtonText}>{musicStore.referenceFileName ? '확인' : '건너뛰기'}</Text>
            </TouchableOpacity>
          </View>
        );

      case 6:
        // Suno 상세 파라미터 (슬라이더 + 토글)
        return (
          <View style={styles.inputArea}>
            <ScrollView style={{ maxHeight: 350 }} showsVerticalScrollIndicator={false}>
              {/* 제외 스타일 */}
              <View style={styles.paramRow}>
                <View style={styles.paramHeader}>
                  <View>
                    <Text style={styles.paramTitle}>제외 스타일</Text>
                    <Text style={styles.paramDesc}>원하지 않는 스타일을 배제합니다</Text>
                  </View>
                  <Switch value={negativeTagsOn} onValueChange={setNegativeTagsOn} trackColor={{ false: '#333', true: '#e94560' }} thumbColor="#fff" />
                </View>
                {negativeTagsOn && (
                  <TextInput style={styles.advancedInput} value={negativeTags} onChangeText={setNegativeTags} placeholder="예: 헤비메탈, 디스토션" placeholderTextColor="#555" />
                )}
              </View>

              {/* 스타일 강도 */}
              <View style={styles.paramRow}>
                <View style={styles.paramHeader}>
                  <View>
                    <Text style={styles.paramTitle}>스타일 강도</Text>
                    <Text style={styles.paramDesc}>0=자유, 1=엄격</Text>
                  </View>
                  <Switch value={styleWeightOn} onValueChange={setStyleWeightOn} trackColor={{ false: '#333', true: '#e94560' }} thumbColor="#fff" />
                </View>
                {styleWeightOn && (
                  <View style={styles.sliderRow}>
                    <Slider style={{ flex: 1 }} minimumValue={0} maximumValue={1} step={0.1} value={styleWeight} onValueChange={setStyleWeight} minimumTrackTintColor="#e94560" maximumTrackTintColor="#333" thumbTintColor="#e94560" />
                    <Text style={styles.sliderValue}>{styleWeight.toFixed(1)}</Text>
                  </View>
                )}
              </View>

              {/* 실험성 조절 */}
              <View style={styles.paramRow}>
                <View style={styles.paramHeader}>
                  <View>
                    <Text style={styles.paramTitle}>실험성 조절</Text>
                    <Text style={styles.paramDesc}>0=대중적, 1=실험적</Text>
                  </View>
                  <Switch value={weirdnessOn} onValueChange={setWeirdnessOn} trackColor={{ false: '#333', true: '#e94560' }} thumbColor="#fff" />
                </View>
                {weirdnessOn && (
                  <View style={styles.sliderRow}>
                    <Slider style={{ flex: 1 }} minimumValue={0} maximumValue={1} step={0.1} value={weirdness} onValueChange={setWeirdness} minimumTrackTintColor="#e94560" maximumTrackTintColor="#333" thumbTintColor="#e94560" />
                    <Text style={styles.sliderValue}>{weirdness.toFixed(1)}</Text>
                  </View>
                )}
              </View>

              {/* 오디오 영향도 */}
              <View style={styles.paramRow}>
                <View style={styles.paramHeader}>
                  <View>
                    <Text style={styles.paramTitle}>오디오 영향도</Text>
                    <Text style={styles.paramDesc}>0=무시, 1=강하게 반영</Text>
                  </View>
                  <Switch value={audioWeightOn} onValueChange={setAudioWeightOn} trackColor={{ false: '#333', true: '#e94560' }} thumbColor="#fff" />
                </View>
                {audioWeightOn && (
                  <View style={styles.sliderRow}>
                    <Slider style={{ flex: 1 }} minimumValue={0} maximumValue={1} step={0.1} value={audioWeight} onValueChange={setAudioWeight} minimumTrackTintColor="#e94560" maximumTrackTintColor="#333" thumbTintColor="#e94560" />
                    <Text style={styles.sliderValue}>{audioWeight.toFixed(1)}</Text>
                  </View>
                )}
              </View>

              {/* BPM */}
              <View style={styles.paramRow}>
                <View style={styles.paramHeader}>
                  <View>
                    <Text style={styles.paramTitle}>BPM</Text>
                    <Text style={styles.paramDesc}>60=느린, 120=보통, 180=빠른</Text>
                  </View>
                  <Switch value={bpmOn} onValueChange={setBpmOn} trackColor={{ false: '#333', true: '#e94560' }} thumbColor="#fff" />
                </View>
                {bpmOn && (
                  <View style={styles.sliderRow}>
                    <Slider style={{ flex: 1 }} minimumValue={60} maximumValue={200} step={5} value={bpmValue} onValueChange={setBpmValue} minimumTrackTintColor="#e94560" maximumTrackTintColor="#333" thumbTintColor="#e94560" />
                    <Text style={styles.sliderValue}>{Math.round(bpmValue)}</Text>
                  </View>
                )}
              </View>

              {/* Key (조성) */}
              <View style={styles.paramRow}>
                <View style={styles.paramHeader}>
                  <View>
                    <Text style={styles.paramTitle}>Key (조성)</Text>
                    <Text style={styles.paramDesc}>major=밝은, minor=어두운</Text>
                  </View>
                  <Switch value={musicalKeyOn} onValueChange={setMusicalKeyOn} trackColor={{ false: '#333', true: '#e94560' }} thumbColor="#fff" />
                </View>
                {musicalKeyOn && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
                    {KEY_OPTIONS.map(k => (
                      <TouchableOpacity key={k} style={[styles.keyChip, musicalKey === k && styles.keyChipSelected]} onPress={() => setMusicalKey(musicalKey === k ? '' : k)}>
                        <Text style={[styles.keyChipText, musicalKey === k && styles.keyChipTextSelected]}>{k}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}
              </View>
            </ScrollView>

            <TouchableOpacity style={[styles.confirmButton, { marginTop: 12 }]} onPress={handleAdvancedConfirm}>
              <Text style={styles.confirmButtonText}>확인</Text>
            </TouchableOpacity>
          </View>
        );

      default:
        return null;
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 140 : 80}
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
              <View style={styles.directorPortraitContainer}>
                <Image source={COMPOSER_PORTRAIT} style={styles.directorPortraitImage} />
              </View>
            )}
            <View
              style={[
                styles.messageBubble,
                msg.type === 'user' ? styles.userBubble : styles.directorBubble,
              ]}
            >
              <Text
                style={[
                  styles.messageText,
                  msg.type === 'user' ? styles.userText : styles.directorText,
                ]}
              >
                {msg.text}
              </Text>
            </View>
          </View>
        ))}
      </ScrollView>

      {/* Current step input */}
      {renderInputArea()}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a1a',
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
    borderColor: '#e94560',
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
    backgroundColor: '#f5f5f5',
    borderBottomLeftRadius: 4,
  },
  userBubble: {
    backgroundColor: '#e94560',
    borderBottomRightRadius: 4,
    alignSelf: 'flex-end',
  },
  messageText: {
    fontSize: 15,
    lineHeight: 22,
  },
  directorText: {
    color: '#111',
  },
  userText: {
    color: '#fff',
  },
  inputArea: {
    borderTopWidth: 1,
    borderTopColor: '#1a1a2e',
    paddingBottom: 30,
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  // Lyrics input (step 0)
  lyricsInput: {
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 12,
    padding: 14,
    color: '#fff',
    fontSize: 14,
    minHeight: 120,
    maxHeight: 200,
    lineHeight: 22,
    marginBottom: 10,
  },
  confirmButton: {
    backgroundColor: '#e94560',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  confirmButtonDisabled: {
    backgroundColor: '#333',
  },
  confirmButtonText: {
    color: '#fff',
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
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  choiceButtonSelected: {
    borderColor: '#e94560',
    backgroundColor: '#2a1020',
  },
  choiceNumber: {
    color: '#e94560',
    fontWeight: 'bold',
    fontSize: 14,
    marginRight: 10,
    width: 20,
  },
  choiceText: {
    color: '#ddd',
    fontSize: 14,
  },
  choiceTextSelected: {
    color: '#e94560',
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
    color: '#fff',
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
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  vocalChipSelected: {
    backgroundColor: '#e94560',
    borderColor: '#e94560',
  },
  vocalChipText: {
    color: '#aaa',
    fontSize: 14,
  },
  vocalChipTextSelected: {
    color: '#fff',
    fontWeight: 'bold',
  },
  // Free text input (steps 5, 6)
  freeTextInput: {
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 12,
    padding: 14,
    color: '#fff',
    fontSize: 14,
    minHeight: 60,
    lineHeight: 22,
    marginBottom: 10,
  },
  // Advanced settings (step 7)
  advancedSection: { marginBottom: 12 },
  advancedLabel: { color: '#aaa', fontSize: 13, marginBottom: 6, fontWeight: '600' },
  paramRow: {
    backgroundColor: '#0a0a1a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1a1a2e',
    padding: 12,
    marginBottom: 8,
  },
  paramHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
  },
  paramTitle: { color: '#fff', fontSize: 14, fontWeight: 'bold' as const },
  paramDesc: { color: '#666', fontSize: 11, marginTop: 2 },
  sliderRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    marginTop: 8,
  },
  sliderValue: { color: '#e94560', fontSize: 14, fontWeight: 'bold' as const, minWidth: 30, textAlign: 'right' as const },
  advancedInput: {
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 12,
    padding: 12,
    color: '#fff',
    fontSize: 14,
  },
  keyScroll: { flexGrow: 0, marginBottom: 4 },
  keyChip: {
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 6,
  },
  keyChipSelected: { backgroundColor: '#e94560', borderColor: '#e94560' },
  keyChipText: { color: '#aaa', fontSize: 12 },
  keyChipTextSelected: { color: '#fff', fontWeight: 'bold' },
  // Reference (step 8)
  refButtonRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  uploadButton: {
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 12,
    borderStyle: 'dashed',
    paddingVertical: 20,
    alignItems: 'center',
  },
  uploadButtonText: {
    color: '#888',
    fontSize: 14,
  },
  recordingActive: {
    borderColor: '#e94560',
    backgroundColor: '#1a0a10',
  },
  recordingContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  recordingText: {
    color: '#e94560',
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
    color: '#aaa',
    fontSize: 12,
    flex: 1,
  },
  removeFileText: {
    color: '#e94560',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 8,
  },
  noteText: {
    color: '#666',
    fontSize: 11,
    marginTop: 6,
    fontStyle: 'italic',
  },
  skipButton: {
    marginTop: 10,
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: '#555',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  skipButtonText: {
    color: '#aaa',
    fontSize: 14,
    fontWeight: '600',
  },
  // Generate button
  generateButton: {
    backgroundColor: '#e94560',
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  generateButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: 'bold',
  },
});
