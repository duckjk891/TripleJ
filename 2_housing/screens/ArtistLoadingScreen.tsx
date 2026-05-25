import { useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Image,
  Animated,
  Easing,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import api, { BACKEND_BASE_URL } from '../services/api';
import { useCharacterTaskStore, type CharacterTaskMode } from '../stores/characterTaskStore';
import { colors } from '../theme/colors';

const ARTIST_PORTRAIT = require('../assets/portraits/artist_director.png');

function characterPreviewUrl(previewPath: string): string {
  // cache-buster: RN Image가 같은 URL이면 옛 이미지 캐시 사용 → 새 시트로 갱신 안 됨
  const sep = previewPath.includes('?') ? '&' : '?';
  return `${BACKEND_BASE_URL}${previewPath}${sep}t=${Date.now()}`;
}

// platform별 FormData file append — web은 File/Blob 필요, RN은 { uri, name, type } 객체
async function appendFileToForm(form: FormData, field: string, uri: string, name: string, mimeType: string) {
  if (Platform.OS === 'web') {
    const res = await fetch(uri);
    const blob = await res.blob();
    // blob.type이 비어있거나 다른 mime일 수 있으니 명시적으로 File 객체로 wrap
    const file = new File([blob], name, { type: mimeType });
    console.log('[appendFileToForm/web]', field, 'size:', file.size, 'type:', file.type, 'name:', file.name);
    form.append(field, file);
  } else {
    form.append(field, { uri, name, type: mimeType } as any);
  }
}

function inferMimeType(filename: string): string {
  const ext = (filename.split('.').pop() || 'jpg').toLowerCase();
  return `image/${ext === 'jpg' ? 'jpeg' : ext}`;
}

// API 처리 중 표시되는 로딩 단계 (맵 팝업의 컨셉 단계와 의도적으로 다름)
const LOADING_STEPS_BY_MODE: Record<NonNullable<CharacterTaskMode>, { label: string; message: string }[]> = {
  sheet: [
    { label: '인식', message: '얼굴을 인식하고 있어요...' },
    { label: '스타일', message: '스타일을 적용하고 있어요...' },
    { label: '렌더링', message: '시트를 렌더링하고 있어요...' },
    { label: '완성', message: '마무리 중이에요...' },
  ],
  refine: [
    { label: '분석', message: '요청을 분석하고 있어요...' },
    { label: '재작업', message: '캐릭터를 다듬고 있어요...' },
    { label: '완성', message: '마무리 중이에요...' },
  ],
  outfit: [
    { label: '매칭', message: '의상을 캐릭터와 맞추고 있어요...' },
    { label: '입히기', message: '시트에 입혀보고 있어요...' },
    { label: '완성', message: '마무리 중이에요...' },
  ],
};

function modeMeta(mode: CharacterTaskMode | null) {
  if (mode === 'refine') return { taskName: '미세조정' };
  if (mode === 'outfit') return { taskName: '코디' };
  return { taskName: '아티스트' };
}

export default function ArtistLoadingScreen({ navigation }: any) {
  const taskStore = useCharacterTaskStore();
  const mode = taskStore.mode;
  const meta = modeMeta(mode);
  const stages = LOADING_STEPS_BY_MODE[mode ?? 'sheet'];

  const [messageIndex, setMessageIndex] = useState(0);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // ── API 호출 (mount 직후 한 번) ──
  useEffect(() => {
    if (!mode) {
      // store에 작업 정보 없음 — 잘못 진입
      navigation.goBack();
      return;
    }
    let cancelled = false;
    const callApi = async () => {
      try {
        const photoUri = taskStore.photoUri;
        const photoName = taskStore.photoName;

        if (mode === 'sheet') {
          if (!photoUri) throw new Error('사진이 없습니다.');
          const form = new FormData();
          const nameFromUri = photoName || (photoUri.split('/').pop() ?? 'photo.jpg');
          await appendFileToForm(form, 'file', photoUri, nameFromUri, inferMimeType(nameFromUri));
          form.append('user_text', taskStore.userText || '');
          // web에서는 Content-Type 헤더 빼야 boundary 자동 추가됨
          const res = await api.post('/character/generate-sheet', form, {
            headers: Platform.OS === 'web' ? undefined : { 'Content-Type': 'multipart/form-data' },
            timeout: 180000,
          });
          if (cancelled) return;
          // 첫 시트는 자동 저장 (UX: "저장" 버튼 깜빡 잊고 나가도 캐릭터 영구 보존)
          try {
            await api.post('/character/save', { sheet_object_name: res.data.object_name });
          } catch (saveErr) {
            console.warn('[Artist] auto-save sheet failed:', saveErr);
          }
          if (cancelled) return;
          taskStore.completeApi({
            preview_url: characterPreviewUrl(res.data.preview_url),
            object_name: res.data.object_name,
          });
          // 자동 저장됐으니 mode null → ArtistResult에서 "저장" 버튼 안 보이고 "꾸미기"만
          taskStore.clearMode();
          navigation.replace('ArtistResult');
        } else {
          // refine / outfit — /character/refine
          const currentSheetUrl = taskStore.apiResult?.preview_url || null;
          if (!currentSheetUrl) {
            throw new Error('현재 캐릭터 시트를 찾을 수 없어요. 다시 시도해주세요.');
          }
          const reqText = mode === 'refine'
            ? (taskStore.refineRequest || '')
            : (taskStore.outfitDesc || '');
          if (!reqText) throw new Error('요청 내용이 비어있습니다.');

          // photoUri 없으면 (마이뮤직 진입 후 outfit/refine) 시트 자체를 photo로 사용 — 시트에 얼굴이 포함됨
          const effectivePhotoUri = photoUri || currentSheetUrl;
          const effectivePhotoName = photoName || 'sheet.png';

          const form = new FormData();
          await appendFileToForm(form, 'sheet_image', currentSheetUrl, 'sheet.png', 'image/png');
          const photoNameOut = effectivePhotoName || (effectivePhotoUri.split('/').pop() ?? 'photo.jpg');
          await appendFileToForm(form, 'photo', effectivePhotoUri, photoNameOut, inferMimeType(photoNameOut));
          form.append('refine_request', reqText);

          const res = await api.post('/character/refine', form, {
            headers: Platform.OS === 'web' ? undefined : { 'Content-Type': 'multipart/form-data' },
            timeout: 240000,
          });
          if (cancelled) return;
          taskStore.completeApi({
            preview_url: characterPreviewUrl(res.data.preview_url),
            object_name: res.data.object_name,
          });
          navigation.replace('ArtistResult');
        }
      } catch (err: any) {
        if (cancelled) return;
        // 백엔드 상세 에러 출력 (422의 경우 detail에 어떤 field가 missing인지 들어있음)
        console.warn('[ArtistLoading] API error:', {
          status: err?.response?.status,
          data: err?.response?.data,
          message: err?.message,
        });
        const detail = err.response?.data?.detail;
        const detailStr = Array.isArray(detail)
          ? detail.map((d: any) => `${d.loc?.join('.')}: ${d.msg}`).join('; ')
          : typeof detail === 'string' ? detail : null;
        const msg = err.response?.data?.error || detailStr || err.message || '실패했어요.';
        taskStore.failApi(msg);
        navigation.goBack();
        setTimeout(() => {
          Alert.alert('오류', msg);
        }, 100);
      }
    };
    callApi();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 단계 메시지 3초마다 교체 (LyricsLoading 패턴) ─────────
  useEffect(() => {
    const interval = setInterval(() => {
      setMessageIndex((i) => Math.min(i + 1, stages.length - 1));
    }, 3000);
    return () => clearInterval(interval);
  }, [stages.length]);

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

  const currentStage = stages[messageIndex] || stages[0];

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Animated.View style={[styles.portraitContainer, { transform: [{ scale: pulseAnim }] }]}>
          <Image source={ARTIST_PORTRAIT} style={styles.portraitImage} />
        </Animated.View>

        <Text style={styles.loadingText}>{currentStage.message}</Text>

        <ActivityIndicator size="large" color={colors.accent.primary} style={styles.spinner} />

        {/* 스텝 인디케이터 */}
        <View style={styles.stepRow}>
          {stages.map((s, i) => {
            const state = i < messageIndex ? 'done' : i === messageIndex ? 'active' : 'pending';
            return (
              <View key={s.label} style={styles.stepItem}>
                <View
                  style={[
                    styles.stepDot,
                    state === 'active' && styles.stepDotActive,
                    state === 'done' && styles.stepDotDone,
                  ]}
                >
                  <Text style={styles.stepDotText}>
                    {state === 'done' ? '✓' : i + 1}
                  </Text>
                </View>
                <Text
                  style={[
                    styles.stepLabel,
                    state === 'active' && styles.stepLabelActive,
                    state === 'done' && styles.stepLabelDone,
                  ]}
                  numberOfLines={1}
                >
                  {s.label}
                </Text>
              </View>
            );
          })}
        </View>

        <View style={styles.noteContainer}>
          <Text style={styles.noteText}>
            아티스트 디렉터가 {meta.taskName} 마무리 중이에요.{'\n'}잠시만 기다려주세요...
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.deepest },
  content: {
    flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32,
  },
  portraitContainer: {
    width: 120, height: 120, borderRadius: 60, overflow: 'hidden',
    borderWidth: 3, borderColor: colors.accent.primary, marginBottom: 32,
    backgroundColor: colors.bg.surface2,
  },
  // 95x405 전신 → 얼굴 + 목+어깨 살짝 보이게: 1.1x zoom + top 약간 음수
  portraitImage: {
    width: 120 * 1.1,
    height: (120 * 1.1) * 405 / 95,
    position: 'absolute',
    top: -120 / 15,                 // -8: 얼굴 살짝 가운데로
    left: -(120 * 1.1 - 120) / 2,
  },
  loadingText: {
    fontSize: 20, fontWeight: 'bold', color: colors.text.primary,
    marginBottom: 24, textAlign: 'center',
  },
  spinner: { marginBottom: 24 },
  stepRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    width: '100%', marginBottom: 24, paddingHorizontal: 4,
  },
  stepItem: { alignItems: 'center', flex: 1 },
  stepDot: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: colors.bg.surface1, borderWidth: 1.5, borderColor: colors.border.subtle,
    justifyContent: 'center', alignItems: 'center', marginBottom: 4,
  },
  stepDotActive: { backgroundColor: colors.accent.primary, borderColor: colors.accent.primary },
  stepDotDone: { backgroundColor: colors.bg.surface2, borderColor: colors.accent.primary },
  stepDotText: { fontSize: 12, fontWeight: '700', color: colors.text.primary },
  stepLabel: { fontSize: 10, color: colors.text.muted, textAlign: 'center' },
  stepLabelActive: { color: colors.accent.primary, fontWeight: '700' },
  stepLabelDone: { color: colors.text.secondary },
  noteContainer: {
    backgroundColor: colors.bg.surface1, borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: colors.border.subtle,
  },
  noteText: { fontSize: 13, color: colors.text.secondary, textAlign: 'center', lineHeight: 19 },
});
