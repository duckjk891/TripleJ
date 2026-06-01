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
// expo-file-system v19+ : 신 API에서는 cacheDirectory/downloadAsync가 빠짐 → legacy 사용
import * as FileSystem from 'expo-file-system/legacy';
import api, { BACKEND_BASE_URL } from '../services/api';
import { useCharacterTaskStore, type CharacterTaskMode } from '../stores/characterTaskStore';
import { useOutfitStore, type AppliedItem } from '../stores/outfitStore';
import AppScreenLayout from '../components/AppScreenLayout';
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

// 9004: 백엔드 MinIO에 영구 저장된 이미지(object_name)를 fetch해서 form에 첨부.
// web은 Blob/File, RN은 expo-file-system으로 로컬 캐시에 다운로드 후 file:// uri 첨부.
async function appendMinioImageToForm(
  form: FormData,
  field: string,
  objectName: string,
) {
  const url = `${BACKEND_BASE_URL}/api/character/preview/${objectName}`;
  const ext = (objectName.split('.').pop() || 'jpg').toLowerCase();
  const name = `${field}.${ext}`;
  const mime = inferMimeType(name);

  if (Platform.OS === 'web') {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`fetch ${objectName} 실패: ${r.status}`);
    const blob = await r.blob();
    const file = new File([blob], name, { type: blob.type || mime });
    form.append(field, file);
  } else {
    const localPath = `${FileSystem.cacheDirectory}${field}-${Date.now()}.${ext}`;
    const dl = await FileSystem.downloadAsync(url, localPath);
    form.append(field, { uri: dl.uri, name, type: mime } as any);
  }
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
          // ── 신규 캐릭터 시트 생성 (옷까지 함께 입혀서 한 번에) ──
          if (!photoUri) throw new Error('사진이 없습니다.');
          const form = new FormData();
          const nameFromUri = photoName || (photoUri.split('/').pop() ?? 'photo.jpg');
          const mime = inferMimeType(nameFromUri);
          await appendFileToForm(form, 'file', photoUri, nameFromUri, mime);

          // 9004 신규 흐름: ArtistCody에서 선택한 옷을 photo와 함께 첨부 → 옷 정확도 ↑
          const items: AppliedItem[] = useOutfitStore.getState().items;
          const topItem = items.find((it) => it.cat === '상의' && it.imageObjectName);
          const bottomItem = items.find((it) => it.cat === '하의' && it.imageObjectName);
          const shoesItem = items.find((it) => it.cat === '신발' && it.imageObjectName);
          if (topItem?.imageObjectName) {
            await appendMinioImageToForm(form, 'top_image', topItem.imageObjectName);
          }
          if (bottomItem?.imageObjectName) {
            await appendMinioImageToForm(form, 'bottom_image', bottomItem.imageObjectName);
          }
          if (shoesItem?.imageObjectName) {
            await appendMinioImageToForm(form, 'shoes_image', shoesItem.imageObjectName);
          }

          form.append('user_text', taskStore.userText || '');
          form.append('image_model', 'gpt_image_2');
          const res = await api.post('/character/generate-sheet', form, {
            // web: 브라우저가 FormData boundary 자동 설정 / RN: 명시 필요
            headers: Platform.OS === 'web' ? {} : { 'Content-Type': 'multipart/form-data' },
            timeout: 600000,
          });
          if (cancelled) return;

          // 9004: 원본 사진을 영구 위치에 업로드 (이후 옷 갈아입기 시 재사용)
          let originalObjectName: string | null = null;
          try {
            const photoForm = new FormData();
            await appendFileToForm(photoForm, 'file', photoUri, nameFromUri, mime);
            const upRes = await api.post('/character/upload-original-photo', photoForm, {
              // web: 브라우저가 FormData boundary 자동 설정 / RN: 명시 필요
              headers: Platform.OS === 'web' ? {} : { 'Content-Type': 'multipart/form-data' },
              timeout: 60000,
            });
            originalObjectName = upRes.data?.object_name || null;
          } catch (uploadErr) {
            console.warn('[Artist] upload-original-photo 실패:', uploadErr);
          }
          if (cancelled) return;

          // 첫 시트 자동 저장 + used_items + original_photo_object_name 영속화
          const usedItems = items
            .filter((it) => it.imageObjectName)
            .map((it) => ({
              name: it.name,
              image_object_name: it.imageObjectName,
              product_url: it.productUrl,
              category: it.cat,
            }));
          try {
            const saveBody: any = {
              sheet_object_name: res.data.object_name,
              used_items: usedItems,
            };
            if (originalObjectName) saveBody.original_photo_object_name = originalObjectName;
            await api.post('/character/save', saveBody);
          } catch (saveErr) {
            console.warn('[Artist] auto-save sheet failed:', saveErr);
          }
          if (cancelled) return;

          taskStore.completeApi({
            preview_url: characterPreviewUrl(res.data.preview_url),
            object_name: res.data.object_name,
          });
          if (originalObjectName) {
            taskStore.setInput({ originalPhotoObjectName: originalObjectName });
          }
          taskStore.clearMode();
          navigation.replace('ArtistResult');
        } else if (mode === 'outfit') {
          // ── 9004 옷 입히기 = refine 폐기, generate-sheet 재호출 ──
          // photo는 백엔드 영구 저장본 + 옷 이미지는 코디 선택분(MinIO object_name)에서 fetch
          //  → 텍스트로만 묘사하지 않고 실제 이미지를 모델에 첨부 → 옷 정확도 ↑

          // 1) originalPhotoObjectName 확보 (store 캐시 우선, 없으면 /me)
          let origObjectName = taskStore.originalPhotoObjectName;
          if (!origObjectName) {
            try {
              const meRes = await api.get('/character/me');
              origObjectName = meRes.data?.character?.original_photo_object_name || null;
              if (origObjectName) {
                taskStore.setInput({ originalPhotoObjectName: origObjectName });
              }
            } catch (meErr) {
              console.warn('[Artist] /me 조회 실패:', meErr);
            }
          }
          if (!origObjectName) {
            throw new Error('원본 사진이 없어요. 캐릭터를 다시 만들어주세요.');
          }

          // 2) 코디에서 선택한 아이템 (cat별 첫 번째만 사용 — 백엔드는 카테고리당 1개)
          const items: AppliedItem[] = useOutfitStore.getState().items;
          const topItem = items.find((it) => it.cat === '상의' && it.imageObjectName);
          const bottomItem = items.find((it) => it.cat === '하의' && it.imageObjectName);
          const shoesItem = items.find((it) => it.cat === '신발' && it.imageObjectName);

          // 3) FormData 구성: photo + cat별 옷 이미지
          const form = new FormData();
          await appendMinioImageToForm(form, 'file', origObjectName);
          if (topItem?.imageObjectName) {
            await appendMinioImageToForm(form, 'top_image', topItem.imageObjectName);
          }
          if (bottomItem?.imageObjectName) {
            await appendMinioImageToForm(form, 'bottom_image', bottomItem.imageObjectName);
          }
          if (shoesItem?.imageObjectName) {
            await appendMinioImageToForm(form, 'shoes_image', shoesItem.imageObjectName);
          }
          form.append('user_text', taskStore.outfitDesc || '');
          form.append('image_model', 'gpt_image_2');

          const res = await api.post('/character/generate-sheet', form, {
            // web: 브라우저가 FormData boundary 자동 설정 / RN: 명시 필요
            headers: Platform.OS === 'web' ? {} : { 'Content-Type': 'multipart/form-data' },
            timeout: 600000,
          });
          if (cancelled) return;

          // 4) used_items 영구 저장 (UsedItemPayload 형식)
          const usedItems = items
            .filter((it) => it.imageObjectName)
            .map((it) => ({
              name: it.name,
              image_object_name: it.imageObjectName,
              product_url: it.productUrl,
              category: it.cat,
            }));
          try {
            await api.post('/character/save', {
              sheet_object_name: res.data.object_name,
              used_items: usedItems,
            });
          } catch (saveErr) {
            console.warn('[Artist] auto-save outfit failed:', saveErr);
          }
          if (cancelled) return;

          taskStore.completeApi({
            preview_url: characterPreviewUrl(res.data.preview_url),
            object_name: res.data.object_name,
          });
          taskStore.clearMode();
          navigation.replace('ArtistResult');
        } else {
          // ── refine: 얼굴/체형 미세조정 (옷 입히기 아님). 기존 /character/refine 흐름 유지 ──
          const currentSheetUrl = taskStore.apiResult?.preview_url || null;
          if (!currentSheetUrl) {
            throw new Error('현재 캐릭터 시트를 찾을 수 없어요. 다시 시도해주세요.');
          }
          const reqText = taskStore.refineRequest || '';
          if (!reqText) throw new Error('요청 내용이 비어있습니다.');

          const effectivePhotoUri = photoUri || currentSheetUrl;
          const effectivePhotoName = photoName || 'sheet.png';

          const form = new FormData();
          await appendFileToForm(form, 'sheet_image', currentSheetUrl, 'sheet.png', 'image/png');
          const photoNameOut = effectivePhotoName || (effectivePhotoUri.split('/').pop() ?? 'photo.jpg');
          await appendFileToForm(form, 'photo', effectivePhotoUri, photoNameOut, inferMimeType(photoNameOut));
          form.append('refine_request', reqText);
          form.append('image_model', 'gpt_image_2');

          const res = await api.post('/character/refine', form, {
            // web: 브라우저가 FormData boundary 자동 설정 / RN: 명시 필요
            headers: Platform.OS === 'web' ? {} : { 'Content-Type': 'multipart/form-data' },
            timeout: 600000,
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
          mode,
          status: err?.response?.status,
          data: err?.response?.data,
          message: err?.message,
        });
        const detail = err.response?.data?.detail;
        // 422 detail은 보통 [{loc, msg, type}] 배열. 펼쳐서 명시적으로 stringify.
        if (Array.isArray(detail)) {
          console.warn('[ArtistLoading] 422 detail (펼침):', JSON.stringify(detail, null, 2));
        }
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
    <AppScreenLayout scroll={false} insideTab avoidMiniPlayer={false}>
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
    </AppScreenLayout>
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
