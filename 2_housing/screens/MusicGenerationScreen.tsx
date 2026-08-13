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
import { AppText } from '../components/ui';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Slider from '@react-native-community/slider';
import { Switch } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMusicStore } from '../stores/musicStore';
import { useLyricsStore } from '../stores/lyricsStore';
import { useTimerStore } from '../stores/timerStore';
import * as DocumentPicker from 'expo-document-picker';
import { Audio } from 'expo-av';
import { colors } from '../theme/colors';

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
  '제외하고 싶은 스타일이 있으시면 얘기해주세요.',
  '설정한 스타일에서 자유도는 얼마나 드릴까요?',
  '대중적인 음악으로 갈까요, 실험적인 음악으로 갈까요?',
  '참고 음원의 세기는 얼마만큼 반영할까요?',
  '템포(BPM)를 정해둘까요? 기본은 자동이에요.',
  '곡의 분위기 키(조성)를 골라주세요. 건너뛰면 자동이에요.',
  '마지막으로, 페르소나 모델을 선택해주세요. 스타일을 따라할지, 보이스를 따라할지!',
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
  const [personaModel, setPersonaModel] = useState<'' | 'style' | 'voice'>('');
  const [personaModelOn, setPersonaModelOn] = useState(false);
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
  // 편집한 제목을 lyricsStore에 반영 (이걸 안 하면 MyMusic / LyricsResult에서 원본만 보임)
  const handleTitleConfirm = () => {
    lyricsStore.setGeneratedTitle(editedTitle.trim());
    advanceStep(`제목: ${editedTitle || '(없음)'}`, 1);
  };

  // Step 1: Lyrics confirm → step 2(장르/분위기/스타일 안내, 자동)
  // 편집한 가사를 lyricsStore와 musicStore 양쪽에 즉시 반영
  const handleLyricsConfirm = () => {
    if (!editedLyrics.trim()) {
      Alert.alert('알림', '가사를 입력해주세요.');
      return;
    }
    lyricsStore.setGeneratedLyrics(editedLyrics.trim());
    musicStore.setLyrics(editedLyrics.trim());
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
      const vocalQuestion = lyricsStore.isDuet
        ? '듀엣 곡이네요! 메인 보컬 성별을 선택해주세요.'
        : DIRECTOR_MESSAGES[3];
      setChatHistory((prev) => [
        ...prev,
        { type: 'user', text: `확인! (${infoText})` },
        { type: 'director', text: vocalQuestion },
      ]);
      setStep(3);
    }, 1500);
  };

  // Step 3: Vocal select (메인 보컬)
  const handleVocalSelect = (vocal: string) => {
    setUseVocal(true);
    setSelectedVocalGender(vocal);
    if (lyricsStore.isDuet) {
      advanceStep(`메인 보컬: ${vocal}`, 4);
    } else {
      advanceStep(vocal, 4);
    }
  };

  // Step 4: Vocal style select (메인 보컬 스타일)
  const handleVocalStyleSelect = (style: string) => {
    setSelectedVocalStyle(style);
    if (lyricsStore.isDuet) {
      // 듀엣: 메인 스타일 선택 후 서브 보컬 질문
      const newHistory: ChatMessage[] = [
        ...chatHistory,
        { type: 'user', text: `메인 보컬 스타일: ${style}` },
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
      { type: 'user', text: `서브 보컬: ${vocal}` },
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
  const handlePersonaConfirm = (apply: boolean) => {
    setPersonaModelOn(apply && !!personaModel);
    const label = personaModel === 'style' ? 'Style Persona' : personaModel === 'voice' ? 'Voice Persona' : '';
    advanceStep(apply && label ? `페르소나: ${label}` : '자동', 13);
  };

  const handleKeyConfirm = (apply: boolean) => {
    setMusicalKeyOn(apply && !!musicalKey);
    advanceStep(apply && musicalKey ? `키: ${musicalKey}` : '자동 키', 12);
  };
  // 참고: handlePersonaConfirm은 위에 정의됨 (case 12에서 호출)

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
    musicStore.setPersonaModel(personaModelOn ? personaModel : '');
    musicStore.setSubVocal(subVocalGender);
    musicStore.setSubVocalStyle(subVocalStyle);
    setChatHistory((prev) => [
      ...prev,
      { type: 'director', text: '작곡을 시작할게요! 곧 결과를 보여드릴게요.' },
    ]);
    // Wondera 제거됨 — 항상 composer/suno
    timerStore.startTask('composer', '작곡', 'composer');
    setTimeout(() => navigation.navigate('Map' as any), 1500);
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
        // Persona Model (Style Persona / Voice Persona)
        return (
          <View style={styles.inputArea}>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
              <TouchableOpacity
                style={[styles.keyChip, { flex: 1 }, personaModel === 'style' && styles.keyChipSelected]}
                onPress={() => setPersonaModel(personaModel === 'style' ? '' : 'style')}
              >
                <AppText style={[styles.keyChipText, personaModel === 'style' && styles.keyChipTextSelected]}>
                  🎨 Style Persona
                </AppText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.keyChip, { flex: 1 }, personaModel === 'voice' && styles.keyChipSelected]}
                onPress={() => setPersonaModel(personaModel === 'voice' ? '' : 'voice')}
              >
                <AppText style={[styles.keyChipText, personaModel === 'voice' && styles.keyChipTextSelected]}>
                  🎤 Voice Persona
                </AppText>
              </TouchableOpacity>
            </View>
            <View style={styles.twoBtnRow}>
              <TouchableOpacity style={styles.skipBtn} onPress={() => handlePersonaConfirm(false)}>
                <AppText style={styles.skipBtnText}>자동</AppText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.applyBtn, !personaModel && { opacity: 0.4 }]}
                onPress={() => handlePersonaConfirm(true)}
                disabled={!personaModel}
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

      {/* Current step input */}
      {renderInputArea()}
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
