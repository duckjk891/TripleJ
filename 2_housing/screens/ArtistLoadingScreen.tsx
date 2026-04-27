import { useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Image,
  Animated,
  Easing,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import api, { BACKEND_BASE_URL } from '../services/api';
import { useTimerStore, DIRECTOR_STAGES } from '../stores/timerStore';
import { useCharacterTaskStore, type CharacterTaskMode } from '../stores/characterTaskStore';
import { colors } from '../theme/colors';

const ARTIST_PORTRAIT = require('../assets/portraits/artist_director.png');

interface RouteParams {
  mode: CharacterTaskMode;
  // sheet: userText (캐릭터 컨셉 텍스트)
  // refine: refineRequest (미세조정 텍스트)
  // outfit: outfitDesc (옷 설명 텍스트)
  userText?: string;
  refineRequest?: string;
  outfitDesc?: string;
}

function characterPreviewUrl(previewPath: string): string {
  return `${BACKEND_BASE_URL}${previewPath}`;
}

// 모드별 timerStore modelKey · stage 키 매핑
function modeMeta(mode: CharacterTaskMode) {
  if (mode === 'sheet') {
    return { modelKey: 'artist', stageKey: 'artist', taskName: '캐릭터 만들기' };
  }
  if (mode === 'refine') {
    return { modelKey: 'artist_refine', stageKey: 'artist_refine', taskName: '미세조정' };
  }
  return { modelKey: 'artist_outfit', stageKey: 'artist_outfit', taskName: '코디' };
}

export default function ArtistLoadingScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const params = (route.params || {}) as RouteParams;
  const mode = params.mode;
  const meta = modeMeta(mode);

  const timerStore = useTimerStore();
  const taskStore = useCharacterTaskStore();
  const stages = DIRECTOR_STAGES[meta.stageKey] || DIRECTOR_STAGES.artist;

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const [apiDone, setApiDone] = useState(false);
  const [apiFailed, setApiFailed] = useState<string | null>(null);
  const [, forceTick] = useState(0); // queueNumber 변화 watch용

  // ── 작업 시작 (timerStore + API) ────────────────────────────
  useEffect(() => {
    // timerStore에 task 시작 (artist 디렉터 타입은 동일, modelKey만 다름)
    timerStore.startTask('artist' as any, meta.taskName, meta.modelKey);
    taskStore.startTask(mode);

    // API 호출 (백그라운드)
    const callApi = async () => {
      try {
        const photoUri = taskStore.photoUri;
        const photoName = taskStore.photoName;

        if (mode === 'sheet') {
          if (!photoUri) {
            throw new Error('사진이 없습니다.');
          }
          const form = new FormData();
          const nameFromUri = photoName || (photoUri.split('/').pop() ?? 'photo.jpg');
          const ext = (nameFromUri.split('.').pop() || 'jpg').toLowerCase();
          form.append('file', {
            uri: photoUri,
            name: nameFromUri,
            type: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
          } as any);
          form.append('user_text', params.userText || '');
          const res = await api.post('/character/generate-sheet', form, {
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 180000,
          });
          taskStore.completeApi({
            preview_url: characterPreviewUrl(res.data.preview_url),
            object_name: res.data.object_name,
          });
          setApiDone(true);
        } else {
          // refine 또는 outfit — 둘 다 /character/refine 사용
          const currentSheetUrl =
            taskStore.apiResult?.preview_url ||
            // Result에서 진입 시엔 useCharacterTaskStore에 이전 시트 URL이 없을 수 있음
            // → ArtistResult가 미리 sheet URL을 store에 채워놓는 책임을 짐 (아래 ArtistResult 구현 참고)
            null;
          if (!currentSheetUrl || !photoUri) {
            throw new Error('이전 캐릭터 시트가 없습니다. 다시 시도해주세요.');
          }
          const reqText = mode === 'refine'
            ? (params.refineRequest || '')
            : (params.outfitDesc ? `다음 옷/스타일을 입혀주세요. ${params.outfitDesc}.` : '');
          if (!reqText) throw new Error('요청 내용이 비어있습니다.');

          const form = new FormData();
          form.append('sheet_image', {
            uri: currentSheetUrl, name: 'sheet.png', type: 'image/png',
          } as any);
          const photoNameOut = photoName || (photoUri.split('/').pop() ?? 'photo.jpg');
          const ext = (photoNameOut.split('.').pop() || 'jpg').toLowerCase();
          form.append('photo', {
            uri: photoUri, name: photoNameOut,
            type: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
          } as any);
          form.append('refine_request', reqText);

          const res = await api.post('/character/refine', form, {
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 240000,
          });
          taskStore.completeApi({
            preview_url: characterPreviewUrl(res.data.preview_url),
            object_name: res.data.object_name,
          });
          setApiDone(true);
        }
      } catch (err: any) {
        const msg = err.response?.data?.error || err.response?.data?.detail || err.message || '실패했어요.';
        taskStore.failApi(msg);
        setApiFailed(msg);
      }
    };
    callApi();
    // 컴포넌트 unmount 시 timer task는 그대로 둠 (MapScreen으로 가도 진행)

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 자연 자동 진행 (틱) ─────────────────────────────────────
  useEffect(() => {
    const config = timerStore.getModelConfig(meta.modelKey);
    const intervalMs = Math.max(1000, config.tickIntervalSec * 1000);
    const t = setInterval(() => {
      timerStore.tickForType('artist');
      forceTick((x) => x + 1);
    }, intervalMs);
    return () => clearInterval(t);
  }, [meta.modelKey, timerStore]);

  // ── Pulse animation ────────────────────────────────────────
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.1, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, []);

  // ── 큐 0 + API 응답 → ArtistResult로 ────────────────────────
  const task = timerStore.getTask('artist' as any);
  const queueNumber = task?.queueNumber ?? 0;
  const initialQueue = task?.initialQueue ?? 1;
  const stageIdx = stages.length > 0
    ? Math.min(stages.length - 1, Math.max(0, Math.floor((1 - queueNumber / Math.max(1, initialQueue)) * stages.length)))
    : 0;
  const stage = stages[stageIdx] || stages[0];
  const progressPercent = Math.min(100, Math.round((1 - queueNumber / Math.max(1, initialQueue)) * 100));

  useEffect(() => {
    if (apiDone && queueNumber <= 0) {
      timerStore.completeTask('artist' as any);
      navigation.replace('ArtistResult');
    }
  }, [apiDone, queueNumber, navigation, timerStore]);

  // ── 광고 단축 (간단 버전 — 실제 광고 SDK 없이 즉시 단축) ────
  const handleWatchAd = () => {
    const reduce = timerStore.getAdReduce('artist' as any);
    timerStore.reduceQueue('artist' as any, reduce);
    forceTick((x) => x + 1);
    Alert.alert('광고 시청', `대기번호 ${reduce} 단축됐어요!`);
  };

  const handleGoMap = () => {
    // MapScreen으로 이동 (작업은 백그라운드 timerStore에서 계속 진행)
    navigation.getParent()?.navigate('MainTabs');
  };

  if (apiFailed) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 24 }]}>
        <View style={styles.centerBox}>
          <Text style={styles.failTitle}>문제가 생겼어요</Text>
          <Text style={styles.failMsg}>{apiFailed}</Text>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => {
              timerStore.completeTask('artist' as any);
              taskStore.reset();
              navigation.goBack();
            }}
          >
            <Text style={styles.primaryBtnText}>돌아가기</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 24 }]}>
      <View style={styles.centerBox}>
        <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
          <View style={styles.portraitFrame}>
            <Image source={ARTIST_PORTRAIT} style={styles.portraitImg} />
          </View>
        </Animated.View>

        <Text style={styles.taskName}>{meta.taskName}</Text>

        <View style={styles.stageBox}>
          <Text style={styles.stageIcon}>{stage.icon}</Text>
          <Text style={styles.stageName}>{stage.name}</Text>
          <Text style={styles.stageDesc}>{stage.description}</Text>
        </View>

        {/* 진행 바 */}
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
        </View>
        <Text style={styles.progressText}>
          {progressPercent}% · 대기번호 {queueNumber}
        </Text>

        {!apiDone && queueNumber <= 0 && (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 16, gap: 8 }}>
            <ActivityIndicator size="small" color={colors.accent.primary} />
            <Text style={styles.almostText}>마무리 중이에요...</Text>
          </View>
        )}
      </View>

      <View style={[styles.bottomArea, { paddingBottom: 16 + insets.bottom }]}>
        <TouchableOpacity style={styles.applyBtn} onPress={handleWatchAd}>
          <Text style={styles.applyBtnText}>📺 광고 보고 단축하기</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.skipBtn, { marginTop: 8 }]} onPress={handleGoMap}>
          <Text style={styles.skipBtnText}>작업실로 돌아가기 (백그라운드 진행)</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.deepest },
  centerBox: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  portraitFrame: {
    width: 100, height: 100, borderRadius: 50, overflow: 'hidden',
    borderWidth: 2, borderColor: colors.accent.primary,
    backgroundColor: colors.bg.surface2, marginBottom: 18,
  },
  portraitImg: {
    width: 100, height: 100 * 405 / 95, resizeMode: 'cover',
    position: 'absolute', top: 0, left: 0,
  },
  taskName: { color: colors.text.primary, fontSize: 14, fontWeight: '700', marginBottom: 6 },
  stageBox: { alignItems: 'center', marginBottom: 16 },
  stageIcon: { fontSize: 36, marginBottom: 6 },
  stageName: { color: colors.accent.primary, fontSize: 16, fontWeight: '700', marginBottom: 4 },
  stageDesc: { color: colors.text.secondary, fontSize: 13, textAlign: 'center', lineHeight: 19 },

  progressTrack: {
    width: 240, height: 8, borderRadius: 4,
    backgroundColor: colors.bg.surface1, overflow: 'hidden', marginTop: 10,
  },
  progressFill: { height: '100%', backgroundColor: colors.accent.primary },
  progressText: { color: colors.text.muted, fontSize: 11, marginTop: 6 },
  almostText: { color: colors.text.secondary, fontSize: 13 },

  bottomArea: { padding: 14 },
  applyBtn: {
    paddingVertical: 14, borderRadius: 12, alignItems: 'center',
    backgroundColor: colors.accent.primary,
  },
  applyBtnText: { color: colors.text.primary, fontSize: 14, fontWeight: '700' },
  skipBtn: {
    paddingVertical: 13, borderRadius: 12, alignItems: 'center',
    backgroundColor: colors.bg.surface2, borderWidth: 1, borderColor: colors.border.subtle,
  },
  skipBtnText: { color: colors.text.secondary, fontSize: 13, fontWeight: '600' },

  primaryBtn: {
    backgroundColor: colors.accent.primary, borderRadius: 14,
    paddingVertical: 14, paddingHorizontal: 28, alignItems: 'center', marginTop: 16,
  },
  primaryBtnText: { color: colors.text.primary, fontWeight: '700', fontSize: 15 },
  failTitle: { color: colors.text.primary, fontSize: 18, fontWeight: '700', marginBottom: 8 },
  failMsg: { color: colors.text.secondary, fontSize: 13, textAlign: 'center', lineHeight: 20 },
});
