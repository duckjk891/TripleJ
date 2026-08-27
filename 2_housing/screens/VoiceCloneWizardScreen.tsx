import { useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  View,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import { Audio } from 'expo-av';
import { AppText } from '../components/ui';
import { showAlert } from '../utils/appAlert';
import { colors } from '../theme/colors';
import { useVoiceStore } from '../stores/voiceStore';
import { usePointsStore } from '../stores/pointsStore';
import {
  createVoiceClone,
  getVoiceClone,
  regenerateClonePhrase,
  verifyVoiceClone,
  cloneValidatePhrase,
} from '../services/voiceService';

// ── v3.83: Voice Clone 4단계 위저드 (MAIDOL VoiceCloneWizard.jsx 이식) ─────────
// ① 노래 샘플(녹음/업로드) + 보컬 구간 + 이름 → POST /voice-clone/create
// ② 서버 낭독 문구 수신(validate_info 폴링, 문구 다시 받기)
// ③ 검증 녹음 + 가창 실력 → POST /voice-clone/{id}/verify
// ④ 완료 안내 (학습은 백그라운드 — 목록에서 상태 확인)
// route.params.resumeCloneId → 클론 GET 후 문구 있으면 3단계, 없으면 2단계부터 재개.

type Props = NativeStackScreenProps<any, 'VoiceCloneWizard'>;

// MAIDOL STATUS_LABEL 이식 (+expired)
const STATUS_LABEL: Record<string, string> = {
  validating: '입력 분석 중...',
  awaiting_verify: '검증 녹음을 기다리는 중',
  generating: '목소리 학습 중...',
  ready: '학습 완료',
  failed: '학습 실패',
  expired: '만료됨',
};

// 서버 ALLOWED_SKILL_LEVELS = { beginner, intermediate, advanced, professional }
// (MAIDOL 프론트의 'pro' 는 서버에서 400 — 서버 enum 기준으로 교정)
const SKILL_LEVELS = [
  { value: 'beginner', label: '초급' },
  { value: 'intermediate', label: '중급' },
  { value: 'advanced', label: '상급' },
  { value: 'professional', label: '프로' },
];

const STYLE_MODES = [
  { value: 'sing', label: '노래' },
  { value: 'speak', label: '말' },
];

type AudioSrc = { uri: string; name: string } | null;

const POLL_INTERVAL_MS = 3500;
const POLL_MAX_TRIES = 60;

export default function VoiceCloneWizardScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const resumeCloneId: string | undefined = (route.params as any)?.resumeCloneId;

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [cloneId, setCloneId] = useState<string | null>(resumeCloneId ?? null);
  const [busy, setBusy] = useState(false);
  const [resuming, setResuming] = useState(!!resumeCloneId);
  const [errText, setErrText] = useState('');

  // STEP 1
  const [voiceName, setVoiceName] = useState('');
  const [sampleSrc, setSampleSrc] = useState<AudioSrc>(null);
  const [vocalStartS, setVocalStartS] = useState('0');
  const [vocalEndS, setVocalEndS] = useState('60');
  const [styleMode, setStyleMode] = useState<'sing' | 'speak'>('sing');

  // STEP 2
  const [validateInfo, setValidateInfo] = useState<any>(null);
  const [phrasePolling, setPhrasePolling] = useState(false);

  // STEP 3
  const [verifySrc, setVerifySrc] = useState<AudioSrc>(null);
  const [skill, setSkill] = useState('intermediate');

  // 녹음 (MusicGenerationScreen 288-330행 expo-av 패턴 — step에 따라 sample/verify 대상 분기)
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 미리듣기
  const soundRef = useRef<Audio.Sound | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const pollCancelRef = useRef(false);

  const phrase = cloneValidatePhrase(validateInfo);

  // ── 재개: 클론 GET 후 상태 기반으로 2 또는 3단계 진입 ──
  useEffect(() => {
    if (!resumeCloneId) return;
    (async () => {
      try {
        console.log('[VoiceCloneWizard] resume 진입, clone_id=', resumeCloneId);
        const clone = await getVoiceClone(resumeCloneId);
        setVoiceName(clone.voice_name || '');
        setValidateInfo(clone.validate_info ?? null);
        const hasPhrase = !!cloneValidatePhrase(clone.validate_info);
        if (clone.status === 'generating' || clone.status === 'ready') {
          setStep(4);
        } else if (hasPhrase) {
          setStep(3);
        } else {
          setStep(2);
        }
        console.log('[VoiceCloneWizard] resume 상태:', clone.status, 'phrase=', hasPhrase);
      } catch (err: any) {
        console.error('[VoiceCloneWizard] resume 실패:', resumeCloneId, err?.response?.status, err?.message);
        showAlert('불러오기 실패', '진행 중인 목소리 정보를 불러오지 못했어요.', [
          { text: '확인', onPress: () => navigation.goBack() },
        ]);
      } finally {
        setResuming(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeCloneId]);

  // ── 정리 ──
  useEffect(() => {
    return () => {
      pollCancelRef.current = true;
      soundRef.current?.unloadAsync().catch(() => {});
      soundRef.current = null;
      recordingRef.current?.stopAndUnloadAsync().catch(() => {});
      recordingRef.current = null;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // ── STEP 2: validate_info 폴링 (3.5초 간격, 최대 60회) ──
  useEffect(() => {
    if (step !== 2 || !cloneId || phrase) return;
    let cancelled = false;
    let tries = 0;
    setPhrasePolling(true);
    setErrText('');
    const tick = async () => {
      if (cancelled || pollCancelRef.current) return;
      tries += 1;
      try {
        const clone = await getVoiceClone(cloneId);
        if (cancelled) return;
        const info = clone.validate_info;
        if (cloneValidatePhrase(info)) {
          console.log('[VoiceCloneWizard] 문구 수신, clone_id=', cloneId, 'tries=', tries);
          setValidateInfo(info);
          setPhrasePolling(false);
          return;
        }
        if (clone.status === 'failed') {
          const msg = clone.error_message || '분석 단계에서 실패했어요.';
          console.warn('[VoiceCloneWizard] 폴링 중 failed, clone_id=', cloneId, msg);
          setPhrasePolling(false);
          setErrText(`분석에 실패했어요. (${msg})\n[문구 다시 받기]로 재시도하거나 처음부터 다시 만들어주세요.`);
          return;
        }
      } catch (err: any) {
        console.error('[VoiceCloneWizard] 문구 폴링 실패:', cloneId, err?.response?.status, err?.message);
      }
      if (tries >= POLL_MAX_TRIES) {
        setPhrasePolling(false);
        setErrText('문구를 받지 못했어요. [문구 다시 받기]를 눌러 다시 시도해주세요.');
        return;
      }
      setTimeout(tick, POLL_INTERVAL_MS);
    };
    tick();
    return () => {
      cancelled = true;
      setPhrasePolling(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, cloneId, validateInfo]);

  // ── 미리듣기 ──
  const stopPreview = async () => {
    const sound = soundRef.current;
    soundRef.current = null;
    setPreviewing(false);
    if (sound) {
      try {
        await sound.stopAsync();
      } catch {}
      try {
        await sound.unloadAsync();
      } catch {}
    }
  };

  const handlePreview = async (src: AudioSrc) => {
    if (!src) return;
    if (previewing) {
      await stopPreview();
      return;
    }
    try {
      const { sound } = await Audio.Sound.createAsync({ uri: src.uri }, { shouldPlay: true });
      soundRef.current = sound;
      setPreviewing(true);
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          stopPreview();
        }
      });
    } catch (err: any) {
      console.error('[VoiceCloneWizard] 미리듣기 실패:', err?.message);
      showAlert('미리듣기 실패', '선택한 음원을 재생할 수 없어요.');
    }
  };

  // ── 파일 업로드 ──
  const handlePickFile = async (target: 'sample' | 'verify') => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*' });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const file = result.assets[0];
        console.log('[VoiceCloneWizard] 파일 선택:', target, file.name);
        await stopPreview();
        if (target === 'sample') {
          setSampleSrc({ uri: file.uri, name: file.name });
        } else {
          setVerifySrc({ uri: file.uri, name: file.name });
        }
      }
    } catch {
      showAlert('오류', '파일 선택에 실패했습니다.');
    }
  };

  // ── 녹음 ──
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
    } catch (err: any) {
      console.error('[VoiceCloneWizard] 녹음 시작 실패:', err?.message);
      showAlert('녹음 불가', '웹에서는 파일 업로드를 이용해주세요.');
    }
  };

  const handleStopRecording = async (target: 'sample' | 'verify') => {
    if (!recordingRef.current) return;
    try {
      if (timerRef.current) clearInterval(timerRef.current);
      setIsRecording(false);
      await recordingRef.current.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;
      if (uri) {
        const recName = target === 'sample' ? '노래녹음.m4a' : '검증녹음.m4a';
        console.log('[VoiceCloneWizard] 녹음 완료:', target, recordingDuration, '초');
        await stopPreview();
        if (target === 'sample') {
          setSampleSrc({ uri, name: recName });
          // 녹음 길이로 구간 끝 기본값 보정 (5초~120초)
          if (recordingDuration > 0) {
            setVocalEndS(String(Math.min(120, Math.max(5, recordingDuration))));
          }
        } else {
          setVerifySrc({ uri, name: recName });
        }
      }
    } catch {
      showAlert('오류', '녹음 저장에 실패했습니다.');
    }
  };

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // ── STEP 1: 클로닝 시작 ──
  const handleStep1Next = async () => {
    const name = voiceName.trim();
    if (!name) {
      showAlert('입력 필요', '목소리 이름을 입력해주세요.');
      return;
    }
    if (!sampleSrc) {
      showAlert('입력 필요', '목소리 샘플을 녹음하거나 업로드해주세요.');
      return;
    }
    const startS = parseInt(vocalStartS, 10);
    const endS = parseInt(vocalEndS, 10);
    if (!Number.isFinite(startS) || !Number.isFinite(endS) || startS < 0 || endS <= startS) {
      showAlert('구간 확인', '보컬 구간을 올바르게 입력해주세요.\n(끝 시각이 시작보다 커야 해요)');
      return;
    }
    setBusy(true);
    setErrText('');
    try {
      console.log('[VoiceCloneWizard] step1 createVoiceClone:', { name, startS, endS, styleMode });
      const res = await createVoiceClone({
        fileUri: sampleSrc.uri,
        fileName: sampleSrc.name,
        voiceName: name,
        vocalStartS: startS,
        vocalEndS: endS,
        styleMode,
      });
      if (!res.clone_id) throw new Error('clone_id missing in response');
      setCloneId(res.clone_id);
      setStep(2);
      console.log('[VoiceCloneWizard] step1 ok, clone_id=', res.clone_id);
      // 과금이 있을 수 있어 헤더 별 배지 갱신 (persona 생성 관행)
      usePointsStore.getState().fetchBalance();
    } catch (err: any) {
      const detail =
        err?.response?.data?.detail || err?.response?.data?.error || err?.message || '알 수 없는 오류';
      console.error('[VoiceCloneWizard] step1 실패:', err?.response?.status, detail);
      showAlert('만들기 시작 실패', `샘플 등록에 실패했어요.\n${detail}`);
    } finally {
      setBusy(false);
    }
  };

  // ── STEP 2: 문구 다시 받기 ──
  const handleRegeneratePhrase = async () => {
    if (!cloneId) return;
    setErrText('');
    setValidateInfo(null); // 폴링 재시작 트리거
    try {
      console.log('[VoiceCloneWizard] regenerate-phrase, clone_id=', cloneId);
      await regenerateClonePhrase(cloneId);
    } catch (err: any) {
      const detail =
        err?.response?.data?.detail || err?.response?.data?.error || err?.message || '알 수 없는 오류';
      console.error('[VoiceCloneWizard] regenerate-phrase 실패:', cloneId, detail);
      showAlert('문구 요청 실패', `새 문구 요청에 실패했어요.\n${detail}`);
    }
  };

  // ── STEP 3: 검증 제출 ──
  const handleStep3Submit = async () => {
    if (!verifySrc) {
      showAlert('입력 필요', '검증 녹음을 입력해주세요.');
      return;
    }
    if (!cloneId) {
      showAlert('오류', '진행 정보가 없어요. 처음부터 다시 시도해주세요.');
      return;
    }
    setBusy(true);
    try {
      console.log('[VoiceCloneWizard] step3 verify 제출, clone_id=', cloneId, 'skill=', skill);
      await verifyVoiceClone(cloneId, {
        fileUri: verifySrc.uri,
        fileName: verifySrc.name,
        singerSkillLevel: skill,
      });
      console.log('[VoiceCloneWizard] step3 ok, clone_id=', cloneId);
      setStep(4);
    } catch (err: any) {
      const detail =
        err?.response?.data?.detail || err?.response?.data?.error || err?.message || '알 수 없는 오류';
      console.error('[VoiceCloneWizard] step3 실패:', cloneId, err?.response?.status, detail);
      showAlert('검증 제출 실패', `검증 녹음 제출에 실패했어요.\n${detail}`);
    } finally {
      setBusy(false);
    }
  };

  // ── STEP 4: 목록으로 ──
  const handleDone = () => {
    console.log('[VoiceCloneWizard] 완료 — 목록으로, clone_id=', cloneId);
    useVoiceStore.getState().fetchClones();
    navigation.goBack();
  };

  // ── 녹음/업로드 패널 (RecordPanel 이식 — RN 단순화) ──
  const renderAudioPanel = (target: 'sample' | 'verify', src: AudioSrc, clear: () => void) => (
    <View>
      <View style={styles.srcBtnRow}>
        {isRecording ? (
          <TouchableOpacity
            style={[styles.srcBtn, styles.srcBtnRecording]}
            onPress={() => handleStopRecording(target)}
          >
            <AppText style={styles.srcBtnRecordingText}>
              ⏹ 중지 {formatDuration(recordingDuration)}
            </AppText>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.srcBtn} onPress={handleStartRecording} disabled={busy}>
            <AppText style={styles.srcBtnText}>{src ? '다시 녹음' : '녹음하기'}</AppText>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={styles.srcBtn}
          onPress={() => handlePickFile(target)}
          disabled={isRecording || busy}
        >
          <AppText style={styles.srcBtnText}>파일 업로드</AppText>
        </TouchableOpacity>
      </View>
      {src && (
        <View style={styles.fileInfo}>
          <AppText style={styles.fileInfoText} numberOfLines={1}>
            선택됨: {src.name}
          </AppText>
          <TouchableOpacity onPress={() => handlePreview(src)}>
            <AppText style={styles.previewText}>{previewing ? '⏹ 정지' : '▶ 미리듣기'}</AppText>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={async () => {
              await stopPreview();
              clear();
            }}
          >
            <AppText style={styles.removeFileText}>제거</AppText>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  const renderPhraseBox = (readonly: boolean) => (
    <View style={styles.phraseBox}>
      {phrase ? (
        <AppText style={styles.phraseText}>{phrase}</AppText>
      ) : phrasePolling ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <ActivityIndicator size="small" color={colors.accent.primary} />
          <AppText style={styles.phraseLoading}>문구 생성 중...</AppText>
        </View>
      ) : (
        <AppText style={styles.phraseLoading}>
          {readonly ? '(이전 단계에서 받은 문구가 없어요)' : '문구를 받지 못했어요. 다시 시도해주세요.'}
        </AppText>
      )}
    </View>
  );

  const guidanceText =
    styleMode === 'sing'
      ? '1단계에서 샘플을 "노래"로 선택했어요. 이 문구도 노래로 불러주세요.'
      : '1단계에서 샘플을 "말"로 선택했어요. 같은 톤으로 말로 읽어주세요.';

  return (
    <View style={styles.container}>
      {/* 헤더 (StudioStack headerShown:false → 화면 내부 헤더, VoiceManage 관행) */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <AppText style={styles.backBtnText}>‹</AppText>
        </TouchableOpacity>
        <AppText style={styles.headerTitle}>내 목소리 만들기</AppText>
        <View style={styles.backBtn} />
      </View>

      {/* 단계 표시 */}
      <View style={styles.stepsRow}>
        {[1, 2, 3, 4].map((s) => (
          <View
            key={s}
            style={[styles.stepDot, step === s && styles.stepDotActive, step > s && styles.stepDotDone]}
          >
            <AppText
              style={[styles.stepDotText, (step === s || step > s) && styles.stepDotTextActive]}
            >
              {step > s ? '✓' : s}
            </AppText>
          </View>
        ))}
      </View>

      {resuming ? (
        <ActivityIndicator size="large" color={colors.accent.primary} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
          {!!errText && (
            <View style={styles.errBox}>
              <AppText style={styles.errBoxText}>{errText}</AppText>
            </View>
          )}

          {step === 1 && (
            <View>
              <AppText style={styles.stepTitle}>1. 목소리 샘플 입력</AppText>
              <AppText style={styles.stepHint}>
                최소 15초 ~ 2분 길이의 깨끗한 음원이 필요해요. 노래도 좋고, 말해도 괜찮아요. 잡음이 적을수록 결과가 좋아져요.
              </AppText>

              <AppText style={styles.fieldLabel}>목소리 이름 *</AppText>
              <TextInput
                style={styles.nameInput}
                value={voiceName}
                onChangeText={setVoiceName}
                placeholder="예: 내 목소리, 발라드 톤"
                placeholderTextColor={colors.text.muted}
                maxLength={40}
              />

              <AppText style={styles.fieldLabel}>목소리 샘플 *</AppText>
              {renderAudioPanel('sample', sampleSrc, () => setSampleSrc(null))}

              <AppText style={styles.fieldLabel}>방금 넣은 샘플은 어떤 음성인가요? *</AppText>
              <View style={styles.chipRow}>
                {STYLE_MODES.map((m) => (
                  <TouchableOpacity
                    key={m.value}
                    style={[styles.chip, styleMode === m.value && styles.chipSelected]}
                    onPress={() => setStyleMode(m.value as 'sing' | 'speak')}
                  >
                    <AppText
                      style={[styles.chipText, styleMode === m.value && styles.chipTextSelected]}
                    >
                      {m.label}
                    </AppText>
                  </TouchableOpacity>
                ))}
              </View>

              <AppText style={styles.fieldLabel}>보컬 구간 (초) *</AppText>
              <AppText style={styles.stepHint}>
                샘플에서 목소리가 잘 들리는 구간을 초 단위로 지정해주세요.
              </AppText>
              <View style={styles.rangeRow}>
                <View style={styles.rangeField}>
                  <AppText style={styles.rangeLabel}>시작</AppText>
                  <TextInput
                    style={styles.rangeInput}
                    value={vocalStartS}
                    onChangeText={(t) => setVocalStartS(t.replace(/[^0-9]/g, ''))}
                    keyboardType="number-pad"
                    placeholder="0"
                    placeholderTextColor={colors.text.muted}
                  />
                </View>
                <View style={styles.rangeField}>
                  <AppText style={styles.rangeLabel}>끝</AppText>
                  <TextInput
                    style={styles.rangeInput}
                    value={vocalEndS}
                    onChangeText={(t) => setVocalEndS(t.replace(/[^0-9]/g, ''))}
                    keyboardType="number-pad"
                    placeholder="60"
                    placeholderTextColor={colors.text.muted}
                  />
                </View>
              </View>


              <TouchableOpacity
                style={[
                  styles.primaryBtn,
                  (!voiceName.trim() || !sampleSrc || busy) && { opacity: 0.4 },
                ]}
                onPress={handleStep1Next}
                // 미충족 시에도 탭 가능 — handleStep1Next의 showAlert가 무엇이 빠졌는지 안내 (무반응 방지)
                disabled={busy}
              >
                {busy ? (
                  <ActivityIndicator size="small" color={colors.text.primary} />
                ) : (
                  <AppText style={styles.primaryBtnText}>다음: 만들기 시작</AppText>
                )}
              </TouchableOpacity>
              {busy && (
                <AppText style={styles.busyNote}>
                  음원 업로드·분석 요청 중이에요. 최대 3분 정도 걸릴 수 있어요.
                </AppText>
              )}
            </View>
          )}

          {step === 2 && (
            <View>
              <AppText style={styles.stepTitle}>2. 낭독 문구 받기</AppText>
              <AppText style={styles.stepHint}>{guidanceText}</AppText>
              {renderPhraseBox(false)}
              <View style={styles.twoBtnRow}>
                <TouchableOpacity style={styles.ghostBtn} onPress={handleRegeneratePhrase}>
                  <AppText style={styles.ghostBtnText}>↺ 문구 다시 받기</AppText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.primaryBtn, { flex: 1, marginTop: 0 }, !phrase && { opacity: 0.4 }]}
                  onPress={() => setStep(3)}
                  disabled={!phrase}
                >
                  <AppText style={styles.primaryBtnText}>다음</AppText>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {step === 3 && (
            <View>
              <AppText style={styles.stepTitle}>3. 검증 녹음</AppText>
              <AppText style={styles.stepHint}>
                아래 문구를 {styleMode === 'sing' ? '노래로 불러' : '말로 읽어'} 녹음해주세요.
              </AppText>
              {renderPhraseBox(true)}

              <AppText style={styles.fieldLabel}>검증 녹음 *</AppText>
              {renderAudioPanel('verify', verifySrc, () => setVerifySrc(null))}

              <AppText style={styles.fieldLabel}>노래 실력</AppText>
              <View style={styles.chipRow}>
                {SKILL_LEVELS.map((s) => (
                  <TouchableOpacity
                    key={s.value}
                    style={[styles.chip, skill === s.value && styles.chipSelected]}
                    onPress={() => setSkill(s.value)}
                  >
                    <AppText style={[styles.chipText, skill === s.value && styles.chipTextSelected]}>
                      {s.label}
                    </AppText>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.twoBtnRow}>
                <TouchableOpacity style={styles.ghostBtn} onPress={() => setStep(2)}>
                  <AppText style={styles.ghostBtnText}>이전</AppText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.primaryBtn,
                    { flex: 1, marginTop: 0 },
                    (!verifySrc || busy) && { opacity: 0.4 },
                  ]}
                  onPress={handleStep3Submit}
                  disabled={busy}
                >
                  {busy ? (
                    <ActivityIndicator size="small" color={colors.text.primary} />
                  ) : (
                    <AppText style={styles.primaryBtnText}>제출</AppText>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}

          {step === 4 && (
            <View>
              <AppText style={styles.stepTitle}>4. 완료</AppText>
              <View style={styles.doneBox}>
                <AppText style={styles.doneTitle}>검증이 접수됐어요</AppText>
                <AppText style={styles.doneDesc}>
                  목소리 학습이 백그라운드에서 진행돼요.{'\n'}처리가 끝나면 목소리 목록에
                  "사용 가능"으로 나타나요.
                </AppText>
                <AppText style={styles.doneStatus}>{STATUS_LABEL.generating}</AppText>
              </View>
              <TouchableOpacity style={styles.primaryBtn} onPress={handleDone}>
                <AppText style={styles.primaryBtnText}>목록으로</AppText>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.deepest },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.bg.surface1,
  },
  backBtn: { width: 44, paddingHorizontal: 12, paddingVertical: 4 },
  backBtnText: { fontSize: 26, color: colors.text.primary, fontWeight: '300' },
  headerTitle: { fontSize: 16, fontWeight: '700', color: colors.text.primary },

  stepsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 12,
  },
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepDotActive: { borderColor: colors.accent.primary, backgroundColor: colors.bg.surface2 },
  stepDotDone: { backgroundColor: colors.accent.primary, borderColor: colors.accent.primary },
  stepDotText: { color: colors.text.muted, fontSize: 12, fontWeight: '700' },
  stepDotTextActive: { color: colors.text.primary },

  errBox: {
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: '#EF4444',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  errBoxText: { color: '#EF4444', fontSize: 12, lineHeight: 17 },

  stepTitle: { color: colors.text.primary, fontSize: 16, fontWeight: '700', marginBottom: 4 },
  stepHint: { color: colors.text.muted, fontSize: 12, lineHeight: 17, marginBottom: 10 },
  fieldLabel: { color: colors.text.secondary, fontSize: 13, fontWeight: '600', marginTop: 14, marginBottom: 6 },

  nameInput: {
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: 10,
    padding: 12,
    color: colors.text.primary,
    fontSize: 14,
  },

  srcBtnRow: { flexDirection: 'row', gap: 8 },
  srcBtn: {
    flex: 1,
    backgroundColor: colors.bg.surface2,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderStyle: 'dashed',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  srcBtnText: { color: colors.text.secondary, fontSize: 13, fontWeight: '600' },
  srcBtnRecording: {
    borderColor: colors.accent.primary,
    borderStyle: 'solid',
    backgroundColor: '#1a0a10',
  },
  srcBtnRecordingText: { color: colors.accent.primary, fontSize: 13, fontWeight: '700' },
  fileInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    paddingHorizontal: 2,
    gap: 10,
  },
  fileInfoText: { color: colors.text.secondary, fontSize: 12, flex: 1 },
  previewText: { color: colors.accent.primary, fontSize: 12, fontWeight: '600' },
  removeFileText: { color: colors.text.muted, fontSize: 12, fontWeight: '600' },

  rangeRow: { flexDirection: 'row', gap: 10 },
  rangeField: { flex: 1 },
  rangeLabel: { color: colors.text.muted, fontSize: 11, marginBottom: 4 },
  rangeInput: {
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: 10,
    padding: 12,
    color: colors.text.primary,
    fontSize: 14,
  },

  chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: {
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipSelected: { borderColor: colors.accent.primary, backgroundColor: colors.bg.surface2 },
  chipText: { color: colors.text.secondary, fontSize: 13, fontWeight: '600' },
  chipTextSelected: { color: colors.accent.primary },

  phraseBox: {
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.accent.primary,
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
    minHeight: 72,
    justifyContent: 'center',
  },
  phraseText: { color: colors.text.primary, fontSize: 15, lineHeight: 23, fontWeight: '600' },
  phraseLoading: { color: colors.text.muted, fontSize: 13 },

  primaryBtn: {
    marginTop: 20,
    backgroundColor: colors.accent.primary,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  primaryBtnText: { color: colors.text.primary, fontSize: 14, fontWeight: '700' },
  busyNote: { color: colors.text.muted, fontSize: 11, marginTop: 8, textAlign: 'center' },

  twoBtnRow: { flexDirection: 'row', gap: 8, marginTop: 20, alignItems: 'center' },
  ghostBtn: {
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  ghostBtnText: { color: colors.text.secondary, fontSize: 13, fontWeight: '600' },

  doneBox: {
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: 14,
    padding: 24,
    alignItems: 'center',
    marginTop: 8,
  },
  doneEmoji: { fontSize: 36, marginBottom: 8 },
  doneTitle: { color: colors.text.primary, fontSize: 16, fontWeight: '700', marginBottom: 8 },
  doneDesc: { color: colors.text.secondary, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  doneStatus: { color: colors.accent.primary, fontSize: 12, fontWeight: '600', marginTop: 12 },
});
