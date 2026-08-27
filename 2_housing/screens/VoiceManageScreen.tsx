import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  createVoicePersona,
  deleteVoicePersona,
  personaVocalStreamUrl,
  VoicePersona,
} from '../services/voiceService';

// ── 내 목소리 관리 화면 ────────────────────────────────────────────────────────
// 노래 음원(파일 업로드/녹음)으로 Voice Persona를 만들고, 미리듣기·삭제한다.
// route.params.select === 'artist' → 선택 모드: 항목 탭 시 아티스트 목소리로 연결 후 goBack.

type Props = NativeStackScreenProps<any, 'VoiceManage'>;

export default function VoiceManageScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const selectMode = (route.params as any)?.select === 'artist';

  const personas = useVoiceStore((s) => s.personas);
  const loading = useVoiceStore((s) => s.loading);
  const fetchPersonas = useVoiceStore((s) => s.fetchPersonas);
  const artistPersonaId = useVoiceStore((s) => s.artistPersonaId);
  const setArtistPersona = useVoiceStore((s) => s.setArtistPersona);
  const clearArtistPersona = useVoiceStore((s) => s.clearArtistPersona);

  // 만들기 폼
  const [newName, setNewName] = useState('');
  const [fileUri, setFileUri] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // 녹음 (MusicGenerationScreen 관행 재사용)
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 미리듣기
  const soundRef = useRef<Audio.Sound | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  // v3.79 UX-1: ArtistResult 가 탭 헤더에 주입한 ‹ 가 남아 이중 화살표가 되지 않도록
  // 진입 시 parent 헤더의 headerLeft 를 정리한다 (자체 헤더 ‹ 하나만 남김).
  // ArtistResult 는 focus 시 재주입하므로 복귀하면 원래대로 돌아온다.
  useLayoutEffect(() => {
    const parent = navigation.getParent();
    if (!parent) return;
    if (__DEV__) console.log('[VoiceManage] parent headerLeft 정리 (이중 뒤로가기 방지)');
    parent.setOptions({ headerLeft: undefined });
  }, [navigation]);

  useEffect(() => {
    console.log('[VoiceManage] 진입, selectMode=', selectMode);
    fetchPersonas();
    return () => {
      // 화면 이탈 시 사운드/녹음/타이머 정리
      soundRef.current?.unloadAsync().catch(() => {});
      soundRef.current = null;
      recordingRef.current?.stopAndUnloadAsync().catch(() => {});
      recordingRef.current = null;
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopPreview = async () => {
    const sound = soundRef.current;
    soundRef.current = null;
    setPlayingId(null);
    if (sound) {
      try {
        await sound.stopAsync();
      } catch {}
      try {
        await sound.unloadAsync();
      } catch {}
    }
  };

  const handlePreview = async (p: VoicePersona) => {
    if (playingId === p.persona_id) {
      await stopPreview();
      return;
    }
    await stopPreview();
    try {
      const url = personaVocalStreamUrl(p.persona_id);
      if (__DEV__) console.log('[VoiceManage] 미리듣기 시작:', p.persona_id);
      const { sound } = await Audio.Sound.createAsync({ uri: url }, { shouldPlay: true });
      soundRef.current = sound;
      setPlayingId(p.persona_id);
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          stopPreview();
        }
      });
    } catch (err: any) {
      console.error('[VoiceManage] 미리듣기 실패:', err?.message);
      showAlert('미리듣기 실패', '목소리 샘플을 재생할 수 없어요. 잠시 후 다시 시도해주세요.');
    }
  };

  // ── 만들기: 파일 업로드 ──
  const handlePickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*' });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const file = result.assets[0];
        setFileUri(file.uri);
        setFileName(file.name);
      }
    } catch {
      showAlert('오류', '파일 선택에 실패했습니다.');
    }
  };

  // ── 만들기: 녹음 (MusicGenerationScreen 288-330행 패턴) ──
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
      console.error('[VoiceManage] 녹음 시작 실패:', err?.message);
      showAlert('녹음 불가', '웹에서는 파일 업로드를 이용해주세요.');
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
        const recName = `녹음_${new Date().toLocaleTimeString()}.m4a`;
        setFileUri(uri);
        setFileName(recName);
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

  // ── 만들기 실행 ──
  const handleCreate = async () => {
    if (!newName.trim() || !fileUri || !fileName || creating) return;
    setCreating(true);
    console.log('[VoiceManage] 페르소나 생성 요청:', newName.trim(), fileName);
    try {
      await createVoicePersona(fileUri, fileName, newName.trim());
      setNewName('');
      setFileUri(null);
      setFileName(null);
      await fetchPersonas();
      // v3.79 UX-2: persona 생성은 ⭐차감 — 헤더 별 배지 즉시 갱신
      usePointsStore.getState().fetchBalance();
      showAlert(
        '목소리 등록 완료',
        '목소리를 분석하고 있어요. 처리가 끝나면 목록에서 "사용 가능"으로 표시됩니다.'
      );
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.response?.data?.detail || err?.message || '알 수 없는 오류';
      showAlert('만들기 실패', `목소리 생성에 실패했어요.\n${msg}`);
    } finally {
      setCreating(false);
    }
  };

  // ── 삭제 ──
  const handleDelete = (p: VoicePersona) => {
    showAlert('목소리 삭제', `"${p.name}" 목소리를 삭제할까요?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          try {
            await stopPreview();
            await deleteVoicePersona(p.persona_id);
            if (artistPersonaId === p.persona_id) clearArtistPersona();
            await fetchPersonas();
          } catch (err: any) {
            const msg = err?.response?.data?.error || err?.message || '알 수 없는 오류';
            showAlert('삭제 실패', msg);
          }
        },
      },
    ]);
  };

  // ── 선택 모드: 아티스트 목소리로 연결 ──
  const handleSelect = (p: VoicePersona) => {
    if (!selectMode) return;
    if (p.status !== 'completed' || !p.persona_id) {
      showAlert('아직 처리 중', '이 목소리는 아직 준비 중이에요. 처리가 끝난 후 선택해주세요.');
      return;
    }
    console.log('[VoiceManage] 아티스트 목소리 연결:', p.persona_id, p.name);
    setArtistPersona(p.persona_id, p.name);
    showAlert('연결 완료', `"${p.name}" 목소리를 아티스트에 연결했어요.\n작곡 시 이 목소리가 기본으로 제안됩니다.`, [
      { text: '확인', onPress: () => navigation.goBack() },
    ]);
  };

  return (
    <View style={styles.container}>
      {/* 헤더 (StudioStack headerShown:false → 화면 내부 헤더) */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <AppText style={styles.backBtnText}>‹</AppText>
        </TouchableOpacity>
        <AppText style={styles.headerTitle}>🎙 내 목소리</AppText>
        <View style={styles.backBtn} />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        {selectMode && (
          <View style={styles.selectBanner}>
            <AppText style={styles.selectBannerText}>
              아티스트에 연결할 목소리를 선택해주세요. (사용 가능 상태만 선택돼요)
            </AppText>
          </View>
        )}

        {/* ── 만들기 ── */}
        <View style={styles.createBox}>
          <AppText style={styles.sectionTitle}>새 목소리 만들기</AppText>
          <AppText style={styles.sectionDesc}>
            내 노래 음원을 올리면 AI가 목소리를 학습해 곡 생성에 사용할 수 있어요.
          </AppText>
          <TextInput
            style={styles.nameInput}
            value={newName}
            onChangeText={setNewName}
            placeholder="목소리 이름 (예: 내 목소리)"
            placeholderTextColor={colors.text.muted}
          />
          <View style={styles.srcBtnRow}>
            <TouchableOpacity style={styles.srcBtn} onPress={handlePickFile} disabled={isRecording || creating}>
              <AppText style={styles.srcBtnText}>📁 파일 업로드</AppText>
            </TouchableOpacity>
            {isRecording ? (
              <TouchableOpacity style={[styles.srcBtn, styles.srcBtnRecording]} onPress={handleStopRecording}>
                <AppText style={styles.srcBtnRecordingText}>⏹ 중지 {formatDuration(recordingDuration)}</AppText>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.srcBtn} onPress={handleStartRecording} disabled={creating}>
                <AppText style={styles.srcBtnText}>🎙 녹음하기</AppText>
              </TouchableOpacity>
            )}
          </View>
          {fileName && (
            <View style={styles.fileInfo}>
              <AppText style={styles.fileInfoText} numberOfLines={1}>선택됨: {fileName}</AppText>
              <TouchableOpacity onPress={() => { setFileUri(null); setFileName(null); }}>
                <AppText style={styles.removeFileText}>제거</AppText>
              </TouchableOpacity>
            </View>
          )}
          <TouchableOpacity
            style={[styles.createBtn, (!newName.trim() || !fileUri || creating) && { opacity: 0.4 }]}
            onPress={handleCreate}
            disabled={!newName.trim() || !fileUri || creating}
          >
            {creating ? (
              <ActivityIndicator size="small" color={colors.text.primary} />
            ) : (
              <AppText style={styles.createBtnText}>내 목소리 만들기</AppText>
            )}
          </TouchableOpacity>
          {creating && (
            <AppText style={styles.creatingNote}>
              음원 업로드·분석 중이에요. 최대 2분 정도 걸릴 수 있어요.
            </AppText>
          )}
        </View>

        {/* ── 목록 ── */}
        <AppText style={[styles.sectionTitle, { marginTop: 20, marginBottom: 8 }]}>
          내 목소리 목록
        </AppText>
        {loading && personas.length === 0 ? (
          <ActivityIndicator size="small" color={colors.accent.primary} style={{ marginTop: 16 }} />
        ) : personas.length === 0 ? (
          <AppText style={styles.emptyText}>
            아직 만든 목소리가 없어요. 위에서 노래 음원으로 첫 목소리를 만들어보세요.
          </AppText>
        ) : (
          personas.map((p) => {
            const completed = p.status === 'completed' && !!p.persona_id;
            const isArtist = artistPersonaId === p.persona_id;
            return (
              <TouchableOpacity
                key={p.persona_id || p.name}
                style={[styles.personaRow, selectMode && completed && styles.personaRowSelectable]}
                activeOpacity={selectMode ? 0.7 : 1}
                onPress={() => handleSelect(p)}
                disabled={!selectMode}
              >
                <View style={{ flex: 1 }}>
                  <View style={styles.personaNameRow}>
                    <AppText style={styles.personaName} numberOfLines={1}>{p.name}</AppText>
                    {isArtist && (
                      <View style={styles.artistBadge}>
                        <AppText style={styles.artistBadgeText}>아티스트 목소리</AppText>
                      </View>
                    )}
                    {!completed && (
                      <View style={styles.pendingBadge}>
                        <AppText style={styles.pendingBadgeText}>처리 중</AppText>
                      </View>
                    )}
                  </View>
                  {!!p.description && (
                    <AppText style={styles.personaDesc} numberOfLines={1}>{p.description}</AppText>
                  )}
                  <AppText style={styles.personaStatus}>
                    {completed ? '사용 가능' : `상태: ${p.status || '알 수 없음'}`}
                  </AppText>
                </View>
                {completed && (
                  <TouchableOpacity
                    style={styles.iconBtn}
                    onPress={() => handlePreview(p)}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  >
                    <AppText style={styles.iconBtnText}>
                      {playingId === p.persona_id ? '⏹' : '▶'}
                    </AppText>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={styles.iconBtn}
                  onPress={() => handleDelete(p)}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <AppText style={styles.iconBtnText}>🗑</AppText>
                </TouchableOpacity>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
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

  selectBanner: {
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.accent.primary,
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  selectBannerText: { color: colors.accent.primary, fontSize: 12, fontWeight: '600', lineHeight: 17 },

  createBox: {
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: 14,
    padding: 14,
  },
  sectionTitle: { color: colors.text.primary, fontSize: 15, fontWeight: '700', marginBottom: 4 },
  sectionDesc: { color: colors.text.muted, fontSize: 11, lineHeight: 16, marginBottom: 10 },
  nameInput: {
    backgroundColor: colors.bg.deepest,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: 10,
    padding: 12,
    color: colors.text.primary,
    fontSize: 14,
    marginBottom: 10,
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
    // 녹음 중 표시 배경 (MusicGeneration 관행)
    backgroundColor: '#1a0a10',
  },
  srcBtnRecordingText: { color: colors.accent.primary, fontSize: 13, fontWeight: '700' },
  fileInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    paddingHorizontal: 2,
  },
  fileInfoText: { color: colors.text.secondary, fontSize: 12, flex: 1 },
  removeFileText: { color: colors.accent.primary, fontSize: 12, fontWeight: '600', marginLeft: 8 },
  createBtn: {
    marginTop: 12,
    backgroundColor: colors.accent.primary,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  createBtnText: { color: colors.text.primary, fontSize: 14, fontWeight: '700' },
  creatingNote: { color: colors.text.muted, fontSize: 11, marginTop: 8, textAlign: 'center' },

  emptyText: { color: colors.text.muted, fontSize: 13, lineHeight: 19, marginTop: 8 },
  personaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    gap: 8,
  },
  personaRowSelectable: { borderColor: colors.accent.primary },
  personaNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  personaName: { color: colors.text.primary, fontSize: 14, fontWeight: '700', flexShrink: 1 },
  personaDesc: { color: colors.text.secondary, fontSize: 12, marginTop: 2 },
  personaStatus: { color: colors.text.muted, fontSize: 11, marginTop: 2 },
  artistBadge: {
    backgroundColor: colors.accent.primary,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  artistBadgeText: { color: colors.text.primary, fontSize: 10, fontWeight: '700' },
  pendingBadge: {
    backgroundColor: colors.bg.surface2,
    borderWidth: 1,
    borderColor: colors.text.muted,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  pendingBadgeText: { color: colors.text.muted, fontSize: 10, fontWeight: '700' },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.bg.surface2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconBtnText: { color: colors.text.primary, fontSize: 14 },
});
