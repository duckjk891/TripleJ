import { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Image,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Animated,
  Easing,
} from 'react-native';
import { AppText } from '../components/ui';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMusicStore } from '../stores/musicStore';
import { useTimerStore } from '../stores/timerStore';
import { useGemsStore } from '../stores/gemsStore';
import { GEM_REWARDS } from '../data/directors';
import api, { BACKEND_BASE_URL } from '../services/api';
import { colors } from '../theme/colors';

const IMAGE_PORTRAIT = require('../assets/portraits/image_director.png');

const STYLE_OPTIONS = ['포토리얼', '일러스트', '미니멀', '추상적', '빈티지', '네온', '수채화', '팝아트'];

const LOADING_STEPS = [
  { label: '구상', message: '커버 이미지를 구상하고 있어요...' },
  { label: '색감', message: '색감을 조합하고 있어요...' },
  { label: '디자인', message: '디자인 중이에요...' },
  { label: '마무리', message: '마무리 중이에요...' },
];

interface ChatMessage { type: 'director' | 'user'; text: string; }
interface MyTrack { id: string; title: string; cover_image?: string; cover_image_url?: string; genre?: string[]; mood?: string[]; }

type Props = NativeStackScreenProps<any, 'CoverGeneration'>;

// 화면 모드
type ScreenMode = 'dialogue' | 'loading' | 'result';

export default function CoverGenerationScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const musicStore = useMusicStore();
  const timerStore = useTimerStore();
  const scrollRef = useRef<ScrollView>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const hasPendingGeneration = !!musicStore.coverTrackId;

  // 화면 모드: dialogue(대화) / loading(생성중) / result(결과)
  const [mode, setMode] = useState<ScreenMode>(hasPendingGeneration ? 'loading' : 'dialogue');

  // 대화 관련
  const [step, setStep] = useState(0);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([
    { type: 'director', text: '안녕하세요! 이미지 디렉터예요. 어떤 곡의 커버 이미지를 만들어볼까요?' },
  ]);
  const [tracks, setTracks] = useState<MyTrack[]>([]);
  const [selectedTrack, setSelectedTrack] = useState<MyTrack | null>(null);
  const [styleInput, setStyleInput] = useState('');
  const [trackLoading, setTrackLoading] = useState(!hasPendingGeneration);
  // v3.80: 커버에 포함할 캐릭터 — 실사/가상 슬롯 object_name (선택 결과는 musicStore에 저장:
  // 대기 후 재진입 시 로컬 state가 초기화돼 "아티스트 포함"이 유실되던 버그의 근본 픽스)
  const [realObjName, setRealObjName] = useState<string | null>(null);
  const [virtualObjName, setVirtualObjName] = useState<string | null>(null);
  // 재생성 시 슬롯 선택 유지용 (doGenerate 정리부에서 store가 비워진 뒤 복원)
  const lastCharObjRef = useRef<string | null>(null);

  // 로딩/결과 관련
  const [loadingMsgIndex, setLoadingMsgIndex] = useState(0);
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(null);
  const [coverObjectName, setCoverObjectName] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, [chatHistory, step]);

  // 트랙 조회
  useEffect(() => {
    if (hasPendingGeneration) return;
    (async () => {
      try {
        const res = await api.get('/tracks/my', { params: { page: 1, limit: 50, sort: 'created_at' } });
        setTracks(res.data.tracks || []);
      } catch { setTracks([]); }
      finally { setTrackLoading(false); }
    })();
  }, []);

  // 로딩 애니메이션
  useEffect(() => {
    if (mode !== 'loading') return;
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.1, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    pulse.start();
    const msgInterval = setInterval(
      () => setLoadingMsgIndex((i) => Math.min(i + 1, LOADING_STEPS.length - 1)),
      3000
    );
    return () => { pulse.stop(); clearInterval(msgInterval); };
  }, [mode]);

  // 대기 완료 후 자동 생성
  useEffect(() => {
    if (hasPendingGeneration) {
      doGenerate(musicStore.coverTrackId!, musicStore.coverTrackTitle || '', musicStore.coverStyle || '');
    }
  }, []);

  const doGenerate = async (trackId: string, title: string, style: string) => {
    // 재생성 시 사용할 수 있도록 로컬에 보존
    if (!selectedTrack) {
      setSelectedTrack({ id: trackId, title } as MyTrack);
    }
    setMode('loading');
    setErrorMsg(null);
    // v3.80: 로컬 state 대신 musicStore에서 읽음 — 대기 후 재진입해도 "아티스트 포함" 유지.
    // 재생성 시 선택 유지를 위해 ref에 백업 (handleStyleConfirm에서 복원).
    const charObjectName = useMusicStore.getState().coverCharacterObjectName;
    lastCharObjRef.current = charObjectName;
    try {
      let genre = '', mood = '';
      try {
        const trackRes = await api.get(`/tracks/${trackId}`);
        genre = trackRes.data?.genre?.[0] || '';
        mood = trackRes.data?.mood?.[0] || '';
      } catch {}

      const payload = {
        title: title || '새로운 곡',
        genre: genre || undefined,
        mood: mood || undefined,
        style: style || undefined,
        user_prompt: style || undefined,
        // v3.80: 선택한 슬롯(실사/가상)의 object_name — 미포함이면 undefined
        character_object_name: charObjectName || undefined,
        image_model: 'gpt_image_2',
      };
      console.log('[Cover] generate-cover payload:', JSON.stringify(payload));
      const t0 = Date.now();
      const res = await api.post('/upload/generate-cover', payload, {
        timeout: 600000, // GPT Image 2는 캐릭터 ref 포함 시 5분 이상 걸리기도 함 → 10분
      });
      console.log('[Cover] generate-cover OK', Date.now() - t0, 'ms');
      setCoverImageUrl(`${BACKEND_BASE_URL}${res.data.image_url}`);
      setCoverObjectName(res.data.object_name);
      setMode('result');
    } catch (err: any) {
      console.warn('[Cover] generate-cover FAIL', {
        message: err?.message,
        code: err?.code,
        status: err?.response?.status,
        data: err?.response?.data,
      });
      setErrorMsg(err?.response?.data?.error || err?.message || '커버 생성에 실패했습니다.');
      setMode('result');
    } finally {
      musicStore.setCoverTrackId(null);
      musicStore.setCoverTrackTitle(null);
      musicStore.setCoverStyle(null);
      // v3.80: 다음 커버에 유령처럼 포함되지 않게 정리 (재생성은 lastCharObjRef로 복원)
      musicStore.setCoverCharacterObjectName(null);
    }
  };

  // 대화: 곡 선택 → 캐릭터 시트 보유 여부 확인
  const handleTrackSelect = async (track: MyTrack) => {
    setSelectedTrack(track);
    setChatHistory((prev) => [
      ...prev,
      { type: 'user', text: `"${track.title}"` },
    ]);

    // v3.80: /character/me 조회 — 실사·가상 시트 모두 확보. 하나라도 있으면 "아티스트 포함?" 질문
    try {
      const res = await api.get('/character/me');
      const ch = res.data?.character;
      const realObj: string | null = ch?.sheet_object_name || null;
      const virtualObj: string | null = ch?.virtual_sheet_object_name || null;
      setRealObjName(realObj);
      setVirtualObjName(virtualObj);
      if (__DEV__) console.info('[Cover] 캐릭터 슬롯 확인', { hasReal: !!realObj, hasVirtual: !!virtualObj });
      if (realObj || virtualObj) {
        setChatHistory((prev) => [
          ...prev,
          { type: 'director', text: '내 아티스트가 있네요! 이 아티스트가 포함된 커버 이미지로 만드시겠어요?' },
        ]);
        setStep(1); // 아티스트 포함 여부 단계
      } else {
        musicStore.setCoverCharacterObjectName(null);
        setChatHistory((prev) => [
          ...prev,
          { type: 'director', text: '좋아요! 원하시는 커버 이미지의 느낌을 설명해주세요.' },
        ]);
        setStep(2); // 스타일로 바로
      }
    } catch (err) {
      console.warn('[Cover] /character/me 조회 실패, 캐릭터 없이 진행:', err);
      musicStore.setCoverCharacterObjectName(null);
      setChatHistory((prev) => [
        ...prev,
        { type: 'director', text: '좋아요! 원하시는 커버 이미지의 느낌을 설명해주세요.' },
      ]);
      setStep(2);
    }
  };

  // 대화: 아티스트 포함 여부 선택 → (둘 다 있으면 슬롯 선택) → 스타일 단계로
  const handleArtistChoice = (include: boolean) => {
    if (!include) {
      musicStore.setCoverCharacterObjectName(null);
      setChatHistory((prev) => [
        ...prev,
        { type: 'user', text: '아티스트 빼고' },
        { type: 'director', text: '알겠습니다. 원하시는 커버 이미지의 느낌을 설명해주세요.' },
      ]);
      setStep(2);
      return;
    }
    // v3.81: 아티스트 1명=슬롯 1개 모델 — 두 명 있으면 아티스트 선택(step 1.5), 한 명이면 자동 선택
    if (realObjName && virtualObjName) {
      setChatHistory((prev) => [
        ...prev,
        { type: 'user', text: '아티스트 포함' },
        { type: 'director', text: '아티스트가 두 명 있네요! 어느 아티스트로 넣을까요?' },
      ]);
      setStep(1.5);
      return;
    }
    const obj = realObjName || virtualObjName;
    musicStore.setCoverCharacterObjectName(obj);
    if (__DEV__) console.info('[Cover] 캐릭터 슬롯 자동 선택', { slot: realObjName ? 'real' : 'virtual', obj });
    setChatHistory((prev) => [
      ...prev,
      { type: 'user', text: '아티스트 포함' },
      { type: 'director', text: '좋아요! 아티스트가 들어간 커버로 만들게요. 원하시는 느낌이나 스타일을 설명해주세요.' },
    ]);
    setStep(2);
  };

  // v3.80: step 1.5 — 실사화/가상화 슬롯 선택
  const handleSlotSelect = (slot: 'real' | 'virtual') => {
    const obj = slot === 'real' ? realObjName : virtualObjName;
    if (!obj) return;
    musicStore.setCoverCharacterObjectName(obj);
    if (__DEV__) console.info('[Cover] 캐릭터 슬롯 선택', { slot, obj });
    setChatHistory((prev) => [
      ...prev,
      { type: 'user', text: slot === 'real' ? '아티스트①로' : '아티스트②로' },
      { type: 'director', text: '좋아요! 원하시는 커버 이미지의 느낌이나 스타일을 설명해주세요.' },
    ]);
    setStep(2);
  };

  // 대화: 스타일 확인 → 대기번호
  const handleStyleConfirm = (style: string) => {
    setStyleInput(style);
    const trackId = selectedTrack?.id || musicStore.coverTrackId;
    const trackTitle = selectedTrack?.title || musicStore.coverTrackTitle;
    if (!trackId) {
      Alert.alert('오류', '곡을 먼저 선택해주세요.');
      setStep(0);
      return;
    }
    musicStore.setCoverTrackId(trackId);
    musicStore.setCoverTrackTitle(trackTitle || '');
    musicStore.setCoverStyle(style);
    // v3.80: 재생성 경로 — doGenerate 정리부에서 비워진 슬롯 선택을 복원 (재생성은 선택 유지)
    if (useMusicStore.getState().coverCharacterObjectName == null && lastCharObjRef.current) {
      if (__DEV__) console.info('[Cover] 재생성: 캐릭터 슬롯 선택 복원', { obj: lastCharObjRef.current });
      musicStore.setCoverCharacterObjectName(lastCharObjRef.current);
    }
    timerStore.startTask('image', '커버 생성');
    setChatHistory((prev) => [
      ...prev,
      { type: 'user', text: style },
      { type: 'director', text: '커버 작업을 시작할게요! 곧 결과를 보여드릴게요.' },
    ]);
    setTimeout(() => navigation.popToTop(), 1500);
  };

  // 결과: 확정 → PUT /tracks/{id}로 cover_image_url 업데이트
  const handleConfirm = async () => {
    const trackId = selectedTrack?.id || musicStore.coverTrackId;
    if (coverObjectName && trackId) {
      try {
        await api.put(`/tracks/${trackId}`, { cover_image_url: coverObjectName });
        console.log('[Cover] 트랙에 커버 연결 성공:', trackId, coverObjectName);
      } catch (err: any) {
        console.error('[Cover] 연결 실패:', err?.message);
      }
    }
    useGemsStore.getState().earn(GEM_REWARDS.TRACK_COVER_DONE, 'track_cover_done', String(trackId ?? ''));
    Alert.alert('완료', '커버 이미지가 저장되었습니다!');
    navigation.popToTop();
  };

  // 결과: 다시 생성 → 스타일 변경 화면
  const handleRegenerate = () => {
    setCoverImageUrl(null);
    setErrorMsg(null);
    setStyleInput('');
    setMode('dialogue');
    setStep(2); // 스타일 선택으로 (아티스트 포함 여부는 이전 선택 유지)
    setChatHistory([
      { type: 'director', text: '원하시는 커버 이미지의 느낌을 다시 설명해주세요.' },
    ]);
  };

  // ─── 로딩 화면 (MusicLoadingScreen과 동일) ───
  if (mode === 'loading') {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContent}>
          <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
            <View style={styles.loadingPortrait}>
              <Image source={IMAGE_PORTRAIT} style={styles.loadingPortraitImage} />
            </View>
          </Animated.View>
          <AppText style={styles.loadingText}>{LOADING_STEPS[loadingMsgIndex].message}</AppText>
          <ActivityIndicator size="large" color={colors.accent.primary} style={{ marginTop: 20 }} />

          {/* 스텝 인디케이터 */}
          <View style={styles.stepRow}>
            {LOADING_STEPS.map((s, i) => {
              const state = i < loadingMsgIndex ? 'done' : i === loadingMsgIndex ? 'active' : 'pending';
              return (
                <View key={s.label} style={styles.stepItem}>
                  <View
                    style={[
                      styles.stepDot,
                      state === 'active' && styles.stepDotActive,
                      state === 'done' && styles.stepDotDone,
                    ]}
                  >
                    <AppText style={styles.stepDotText}>
                      {state === 'done' ? '✓' : i + 1}
                    </AppText>
                  </View>
                  <AppText
                    style={[
                      styles.stepLabel,
                      state === 'active' && styles.stepLabelActive,
                      state === 'done' && styles.stepLabelDone,
                    ]}
                    numberOfLines={1}
                  >
                    {s.label}
                  </AppText>
                </View>
              );
            })}
          </View>

          <View style={styles.loadingNote}>
            <AppText style={styles.loadingNoteText}>
              {`이미지 디렉터가 ${loadingMsgIndex + 1}/${LOADING_STEPS.length} 단계를 진행 중이에요.\n잠시만 기다려주세요.`}
            </AppText>
          </View>
        </View>
      </View>
    );
  }

  // ─── 결과 화면 (MusicResultScreen과 동일 패턴) ───
  if (mode === 'result') {
    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={[styles.resultContent, { paddingTop: insets.top + 16 }]}>
          {/* 디렉터 메시지 */}
          <View style={styles.directorRow}>
            <View style={styles.portraitCircle}>
              <Image source={IMAGE_PORTRAIT} style={styles.portraitCircleImage} />
            </View>
            <View style={styles.directorBubble}>
              <AppText style={styles.directorName}>이미지 디렉터</AppText>
              <AppText style={styles.directorText}>
                {errorMsg ? '앗, 문제가 생겼어요. 다시 시도해볼까요?' : '커버 이미지가 완성됐어요!'}
              </AppText>
            </View>
          </View>

          {/* 에러 */}
          {errorMsg && (
            <View style={styles.errorBox}>
              <AppText style={styles.errorText}>{errorMsg}</AppText>
            </View>
          )}

          {/* 결과 이미지 */}
          {coverImageUrl && (
            <View style={styles.resultCard}>
              <Image source={{ uri: coverImageUrl }} style={styles.resultImage} />
            </View>
          )}

          {/* 버튼 */}
          <View style={styles.buttonContainer}>
            <TouchableOpacity style={styles.regenerateButton} onPress={handleRegenerate}>
              <AppText style={styles.regenerateButtonText}>다시 생성하기</AppText>
            </TouchableOpacity>

            {coverImageUrl && (
              <TouchableOpacity style={styles.saveButton} onPress={handleConfirm}>
                <AppText style={styles.saveButtonText}>커버 이미지 확정</AppText>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={styles.backButton} onPress={() => navigation.popToTop()}>
              <AppText style={styles.backButtonText}>맵으로 돌아가기</AppText>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    );
  }

  // ─── 대화 화면 ───
  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 140 : 80}>
      <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={[{ padding: 16 }, { paddingTop: insets.top + 16 }]} showsVerticalScrollIndicator={false}>
        {chatHistory.map((msg, idx) => (
          <View key={idx} style={[styles.messageRow, msg.type === 'user' ? styles.userRow : styles.dirRow]}>
            {msg.type === 'director' && (
              <View style={styles.smallPortrait}><Image source={IMAGE_PORTRAIT} style={styles.smallPortraitImg} /></View>
            )}
            <View style={[styles.bubble, msg.type === 'user' ? styles.userBubble : styles.dirBubble]}>
              <AppText style={[styles.bubbleText, msg.type === 'user' ? { color: colors.text.primary } : { color: colors.bg.deepest }]}>{msg.text}</AppText>
            </View>
          </View>
        ))}
      </ScrollView>

      {/* 입력 영역 */}
      <View style={styles.inputArea}>
        {trackLoading ? (
          <ActivityIndicator size="large" color={colors.accent.primary} />
        ) : step === 0 ? (
          tracks.length === 0 ? (
            <AppText style={{ color: colors.text.secondary, textAlign: 'center', paddingVertical: 20 }}>곡이 없어요. 먼저 곡을 만들어주세요!</AppText>
          ) : (
            <ScrollView style={{ maxHeight: 200 }} showsVerticalScrollIndicator={false}>
              {tracks.map((t) => (
                <TouchableOpacity key={t.id} style={styles.trackOption} onPress={() => handleTrackSelect(t)}>
                  <AppText style={{ color: colors.text.primary, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{t.title}</AppText>
                  <AppText style={{ color: colors.text.secondary, fontSize: 12 }}>{(t.cover_image || t.cover_image_url) ? '커버 있음 (재생성 가능)' : '커버 없음'}</AppText>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )
        ) : step === 1 ? (
          // 9004: 아티스트 포함 여부 선택 (캐릭터 시트 있을 때만 보임)
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity
              style={[styles.chip, styles.choiceChip]}
              onPress={() => handleArtistChoice(true)}
            >
              <AppText style={styles.choiceChipText}>네, 아티스트 포함</AppText>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.chip, styles.choiceChip, styles.choiceChipAlt]}
              onPress={() => handleArtistChoice(false)}
            >
              <AppText style={styles.choiceChipTextAlt}>아니요, 빼고</AppText>
            </TouchableOpacity>
          </View>
        ) : step === 1.5 ? (
          // v3.81: 아티스트 선택 카드 (두 명 있을 때만 진입) — v3.82: kind 병기 제거, 썸네일로 구분
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity style={styles.slotCard} onPress={() => handleSlotSelect('real')} activeOpacity={0.8}>
              {realObjName ? (
                <Image
                  source={{ uri: `${BACKEND_BASE_URL}/api/character/preview/${realObjName}` }}
                  style={styles.slotCardImg}
                />
              ) : null}
              <AppText style={styles.slotCardLabel}>아티스트①</AppText>
            </TouchableOpacity>
            <TouchableOpacity style={styles.slotCard} onPress={() => handleSlotSelect('virtual')} activeOpacity={0.8}>
              {virtualObjName ? (
                <Image
                  source={{ uri: `${BACKEND_BASE_URL}/api/character/preview/${virtualObjName}` }}
                  style={styles.slotCardImg}
                />
              ) : null}
              <AppText style={styles.slotCardLabel}>아티스트②</AppText>
            </TouchableOpacity>
          </View>
        ) : step === 2 ? (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
              {STYLE_OPTIONS.map((s) => (
                <TouchableOpacity key={s} style={[styles.chip, styleInput === s && styles.chipSelected]} onPress={() => handleStyleConfirm(s)}>
                  <AppText style={[styles.chipText, styleInput === s && styles.chipTextSelected]}>{s}</AppText>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={styles.inputRow}>
              <TextInput style={styles.textInput} value={styleInput} onChangeText={setStyleInput} placeholder="자유롭게 입력..." placeholderTextColor={colors.text.muted} onSubmitEditing={() => styleInput.trim() && handleStyleConfirm(styleInput.trim())} />
              <TouchableOpacity style={[styles.sendBtn, !styleInput.trim() && { opacity: 0.4 }]} onPress={() => styleInput.trim() && handleStyleConfirm(styleInput.trim())} disabled={!styleInput.trim()}>
                <AppText style={styles.sendBtnText}>확인</AppText>
              </TouchableOpacity>
            </View>
          </>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.deepest },
  // 로딩
  loadingContent: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  loadingPortrait: { width: 120, height: 120, borderRadius: 60, overflow: 'hidden', borderWidth: 3, borderColor: colors.accent.primary, marginBottom: 32 },
  loadingPortraitImage: { width: 120, height: 360, resizeMode: 'cover', position: 'absolute', top: 0, left: 0 },
  loadingText: { fontSize: 20, fontWeight: 'bold', color: colors.text.primary, textAlign: 'center' },
  stepRow: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginTop: 20, marginBottom: 4, paddingHorizontal: 4 },
  stepItem: { alignItems: 'center', flex: 1 },
  stepDot: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.bg.surface1, borderWidth: 1.5, borderColor: colors.border.subtle, justifyContent: 'center', alignItems: 'center', marginBottom: 4 },
  stepDotActive: { backgroundColor: colors.accent.primary, borderColor: colors.accent.primary },
  stepDotDone: { backgroundColor: colors.bg.surface2, borderColor: colors.accent.primary },
  stepDotText: { fontSize: 11, fontWeight: '700', color: colors.text.primary },
  stepLabel: { fontSize: 10, color: colors.text.muted, textAlign: 'center' },
  stepLabelActive: { color: colors.accent.primary, fontWeight: '700' },
  stepLabelDone: { color: colors.text.secondary },
  loadingNote: { backgroundColor: colors.bg.surface1, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: colors.border.subtle, marginTop: 20 },
  loadingNoteText: { fontSize: 13, color: colors.text.secondary, textAlign: 'center', lineHeight: 20 },
  // 결과 (MusicResultScreen과 동일)
  resultContent: { padding: 16 },
  directorRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 24 },
  portraitCircle: { width: 60, height: 60, borderRadius: 30, overflow: 'hidden', borderWidth: 2, borderColor: colors.accent.primary, marginRight: 12 },
  portraitCircleImage: { width: 60, height: 180, resizeMode: 'cover', position: 'absolute', top: 0, left: 0 },
  directorBubble: { flex: 1, backgroundColor: colors.bg.surface1, borderRadius: 12, borderWidth: 1, borderColor: colors.accent.primary, padding: 12 },
  directorName: { fontSize: 13, fontWeight: 'bold', color: colors.accent.primary, marginBottom: 4 },
  directorText: { fontSize: 14, color: colors.text.primary, lineHeight: 20 },
  errorBox: { backgroundColor: colors.bg.surface2, borderWidth: 1, borderColor: colors.accent.primary, borderRadius: 12, padding: 14, marginBottom: 16 },
  errorText: { color: colors.status.error, fontSize: 13, lineHeight: 20 },
  resultCard: { alignItems: 'center', marginBottom: 24 },
  resultImage: { width: 240, height: 240, borderRadius: 16, borderWidth: 3, borderColor: colors.accent.primary },
  buttonContainer: { gap: 12 },
  regenerateButton: { backgroundColor: colors.bg.surface1, borderWidth: 1, borderColor: colors.accent.primary, borderRadius: 16, paddingVertical: 16, alignItems: 'center' },
  regenerateButtonText: { color: colors.accent.primary, fontSize: 16, fontWeight: 'bold' },
  saveButton: { backgroundColor: colors.accent.primary, borderRadius: 16, paddingVertical: 16, alignItems: 'center' },
  saveButtonText: { color: colors.text.primary, fontSize: 16, fontWeight: 'bold' },
  backButton: { backgroundColor: colors.bg.surface1, borderRadius: 16, paddingVertical: 16, alignItems: 'center', borderWidth: 1, borderColor: colors.border.subtle },
  backButtonText: { color: colors.text.secondary, fontSize: 16, fontWeight: '600' },
  // 대화
  messageRow: { flexDirection: 'row', marginBottom: 12, alignItems: 'flex-end' },
  dirRow: { justifyContent: 'flex-start', paddingRight: 50 },
  userRow: { justifyContent: 'flex-end', paddingLeft: 50 },
  smallPortrait: { width: 36, height: 36, borderRadius: 18, overflow: 'hidden', borderWidth: 1.5, borderColor: colors.accent.primary, marginRight: 8 },
  smallPortraitImg: { width: 36, height: 108, resizeMode: 'cover', position: 'absolute', top: 0, left: 0 },
  bubble: { borderRadius: 16, padding: 12, maxWidth: '80%' },
  dirBubble: { backgroundColor: colors.text.primary, borderBottomLeftRadius: 4 },
  userBubble: { backgroundColor: colors.accent.primary, borderBottomRightRadius: 4, alignSelf: 'flex-end' },
  bubbleText: { fontSize: 15, lineHeight: 22 },
  inputArea: { borderTopWidth: 1, borderTopColor: colors.bg.surface1, paddingBottom: 30, paddingHorizontal: 12, paddingTop: 10 },
  trackOption: { backgroundColor: colors.bg.surface1, borderRadius: 12, padding: 14, marginBottom: 6, borderWidth: 1, borderColor: colors.border.subtle },
  chip: { backgroundColor: colors.bg.surface1, borderWidth: 1, borderColor: colors.border.subtle, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8, marginRight: 8 },
  chipSelected: { backgroundColor: colors.accent.primary, borderColor: colors.accent.primary },
  chipText: { color: colors.text.secondary, fontSize: 14 },
  choiceChip: {
    flex: 1, paddingVertical: 12, paddingHorizontal: 12,
    backgroundColor: colors.accent.primary, borderColor: colors.accent.primary,
    alignItems: 'center', marginRight: 0,
  },
  choiceChipText: { color: colors.text.primary, fontSize: 14, fontWeight: '700' },
  choiceChipAlt: { backgroundColor: colors.bg.surface2, borderColor: colors.border.subtle },
  choiceChipTextAlt: { color: colors.text.secondary, fontSize: 14, fontWeight: '600' },
  // v3.80: 실사/가상 슬롯 선택 카드
  slotCard: {
    flex: 1, alignItems: 'center', padding: 10, borderRadius: 12,
    backgroundColor: colors.bg.surface1, borderWidth: 1, borderColor: colors.border.subtle,
  },
  slotCardImg: {
    width: 96, height: 120, borderRadius: 8, marginBottom: 8,
    backgroundColor: colors.bg.surface2, resizeMode: 'cover',
  },
  slotCardLabel: { color: colors.text.primary, fontSize: 13, fontWeight: '700' },
  chipTextSelected: { color: colors.text.primary, fontWeight: 'bold' },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  textInput: { flex: 1, backgroundColor: colors.bg.surface1, borderWidth: 1, borderColor: colors.border.subtle, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, color: colors.text.primary, fontSize: 14 },
  sendBtn: { backgroundColor: colors.accent.primary, borderRadius: 20, paddingHorizontal: 20, paddingVertical: 10 },
  sendBtnText: { color: colors.text.primary, fontWeight: 'bold', fontSize: 14 },
});
