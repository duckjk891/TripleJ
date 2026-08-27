import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  StyleSheet,
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Modal,
  Dimensions,
  StatusBar,
  Animated,
  PanResponder,
  Linking,
} from 'react-native';
import { AppText } from '../components/ui';
import { showAlert } from '../utils/appAlert';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import api, { BACKEND_BASE_URL } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { useCharacterTaskStore } from '../stores/characterTaskStore';
import { usePlayerStore } from '../stores/playerStore';
import { useOutfitStore } from '../stores/outfitStore';
import { useVoiceStore, artistVoiceLabel } from '../stores/voiceStore';
import ConfirmDialog from '../components/ConfirmDialog';
import { useArtistProfileStore } from '../stores/artistProfileStore';
import { colors } from '../theme/colors';

export default function ArtistResultScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  // v3.81: MyArtists 목록에서 카드 탭으로 진입하면 해당 슬롯만 표시(탭 UI 없음).
  // 파라미터 없이 진입(생성 완료 직후)하면 characterKind 기준.
  const slotParam: 'real' | 'virtual' | undefined = route?.params?.slot;
  const taskStore = useCharacterTaskStore();
  const apiResult = taskStore.apiResult;
  // v3.82: 로컬 프로필(이름·성별) — 서버 /me에 gender가 없어 로컬 persist에서 표시
  const profiles = useArtistProfileStore((s) => s.profiles);
  // 방금 새로 만들거나 코디/미세조정한 시트는 저장 필요. mode === null이면 이미 저장된 상태.
  const isUnsaved = taskStore.mode !== null;
  const outfitItems = useOutfitStore((s) => s.items);
  // v3.84: 아티스트 목소리 (프리셋 XOR 클론 — VoiceManage에서 설정)
  const artistVoice = useVoiceStore((s) => s.artistVoice);

  const [saving, setSaving] = useState(false);
  const [hydrating, setHydrating] = useState(!apiResult); // apiResult가 비어 있으면 /character/me로 가져옴
  const [zoomVisible, setZoomVisible] = useState(false);
  // 9004: /me 응답의 original_photo_object_name → 미리보기 URL 캐싱
  const [originalPhotoUrl, setOriginalPhotoUrl] = useState<string | null>(null);
  const [meeName, setMeName] = useState<string>('');
  // 앱 내부 디자인 다이얼로그 (시스템 Alert 대신)
  const [resetConfirmVisible, setResetConfirmVisible] = useState(false);
  const [errorDialog, setErrorDialog] = useState<{ title: string; message: string } | null>(null);

  // v3.80: 실사/가상 2슬롯 — /me 하이드레이션에서 각각 보관
  const [realSheet, setRealSheet] = useState<{ objectName: string; url: string } | null>(null);
  const [virtualSheet, setVirtualSheet] = useState<{ objectName: string; url: string; artStyle: string | null } | null>(null);
  // v3.81: 탭 제거 — 표시 슬롯은 slot param(목록 진입) 또는 characterKind(생성 직후)로 결정되는 내부 값
  const [activeSlot, setActiveSlot] = useState<'real' | 'virtual'>(
    slotParam ?? (taskStore.characterKind === 'virtual' ? 'virtual' : 'real')
  );
  const slotInitRef = useRef(false);

  // v3.82: 이 화면에서는 미니플레이어 UI 숨김(오디오 재생은 유지 — playerStore 전역 소유)
  // → bottomArea(꾸미기/저장)가 탭바 바로 위에 고정된다. blur 시 반드시 복원.
  useFocusEffect(
    useCallback(() => {
      usePlayerStore.getState().setMiniHidden(true);
      if (__DEV__) console.info('[ArtistResult] 미니플레이어 숨김(focus)');
      return () => {
        usePlayerStore.getState().setMiniHidden(false);
        if (__DEV__) console.info('[ArtistResult] 미니플레이어 복원(blur)');
      };
    }, [])
  );

  // Tab 헤더 좌측에 ← 버튼 주입.
  // v3.79 UX-1: useLayoutEffect(마운트 기준)이면 VoiceManage 등 다음 화면을 push 해도
  // 주입이 남아 이중 뒤로가기 화살표(탭 헤더 ‹ + 화면 자체 ‹)가 생김 →
  // useFocusEffect 로 전환해 blur 시 정리, 복귀(focus) 시 재주입.
  useFocusEffect(
    useCallback(() => {
      const parent = navigation.getParent();
      if (!parent) return;
      parent.setOptions({
        headerLeft: () => (
          <TouchableOpacity
            // v3.81: 목록(slot param)에서 온 경우 pop으로 복귀(navigate는 목록을 새로 push해
            // 목록↔상세 핑퐁이 생김), 생성 직후는 기존대로 Map으로
            onPress={() => {
              if (slotParam && navigation.canGoBack()) navigation.goBack();
              else navigation.navigate(slotParam ? 'MyArtists' : 'Map');
            }}
            style={{ paddingHorizontal: 12, paddingVertical: 6 }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <AppText style={{ fontSize: 26, color: colors.text.primary, fontWeight: '300' }}>‹</AppText>
          </TouchableOpacity>
        ),
      });
      return () => {
        parent.setOptions({ headerLeft: undefined });
      };
    }, [navigation, slotParam])
  );

  // 화면 포커스마다 /character/me로 최신화
  // 9004: 시트 + 원본 사진 + used_items 모두 백엔드 응답에서 가져옴
  // (apiResult가 이미 있어도 used_items/원본 사진은 stale일 수 있으니 매번 fetch)
  useFocusEffect(
    useCallback(() => {
      if (!user) {
        setHydrating(false);
        return;
      }
      const hasCachedSheet = !!useCharacterTaskStore.getState().apiResult;
      setHydrating(!hasCachedSheet);
      let cancelled = false;
      (async () => {
        try {
          const res = await api.get('/character/me');
          if (cancelled) return;
          const ch = res.data?.character;
          // 진단 로그: 어떤 필드가 비어있는지 한눈에
          console.log('[ArtistResult] /me 응답:', {
            sheet: !!ch?.sheet_object_name,
            virtual_sheet: !!ch?.virtual_sheet_object_name,
            virtual_art_style: ch?.virtual_art_style || '(없음)',
            name: ch?.name || '(없음)',
            original_photo: ch?.original_photo_object_name || '(없음)',
            used_items_count: Array.isArray(ch?.used_items) ? ch.used_items.length : 0,
            raw: JSON.stringify(ch),
          });
          // v3.80: 실사·가상 슬롯 각각 보관
          const hasRealSheet = !!ch?.sheet_object_name;
          const hasVirtualSheet = !!ch?.virtual_sheet_object_name;
          setRealSheet(hasRealSheet
            ? {
                objectName: ch.sheet_object_name,
                url: `${BACKEND_BASE_URL}/api/character/preview/${ch.sheet_object_name}?t=${Date.now()}`,
              }
            : null);
          setVirtualSheet(hasVirtualSheet
            ? {
                objectName: ch.virtual_sheet_object_name,
                url: `${BACKEND_BASE_URL}/api/character/preview/${ch.virtual_sheet_object_name}?t=${Date.now()}`,
                artStyle: ch.virtual_art_style || null,
              }
            : null);
          if (!hasRealSheet && !hasVirtualSheet) {
            // 백엔드에 저장된 캐릭터가 없음 (자동저장 실패 또는 v46 이전 캐릭터)
            // mode === null이고 cached apiResult가 있으면 일시적 오류일 수 있어 store는 건드리지 않음
            if (!hasCachedSheet) {
              console.log('[ArtistResult] /me: 저장된 캐릭터 없음');
            }
            return;
          }
          // v3.81: 슬롯 초기 선택 — slot param(목록 진입) 우선, 없으면 방금 생성한 쪽(characterKind)
          if (!slotInitRef.current) {
            slotInitRef.current = true;
            if (slotParam) {
              // param 슬롯이 사라졌으면(레이스) 남은 슬롯으로
              setActiveSlot(
                slotParam === 'virtual'
                  ? (hasVirtualSheet ? 'virtual' : 'real')
                  : (hasRealSheet ? 'real' : 'virtual')
              );
            } else {
              const kind = useCharacterTaskStore.getState().characterKind;
              setActiveSlot(kind === 'virtual' && hasVirtualSheet ? 'virtual' : hasRealSheet ? 'real' : 'virtual');
            }
          } else {
            // 선택 중인 슬롯이 사라졌으면(삭제 등) 남은 슬롯으로 이동
            setActiveSlot((cur) =>
              cur === 'virtual' && !hasVirtualSheet ? 'real'
              : cur === 'real' && !hasRealSheet && hasVirtualSheet ? 'virtual'
              : cur);
          }
          // 시트 URL (cache-buster: RN Image가 같은 URL이면 옛 이미지 보임)
          // v3.81: slot param이 있으면 그 슬롯으로 하이드레이션, 없으면 실사 우선(v3.80 동작)
          if (!hasCachedSheet) {
            const preferVirtual = slotParam ? slotParam === 'virtual' : !hasRealSheet;
            const hydrateObj = preferVirtual && hasVirtualSheet
              ? ch.virtual_sheet_object_name
              : hasRealSheet ? ch.sheet_object_name : ch.virtual_sheet_object_name;
            const url = `${BACKEND_BASE_URL}/api/character/preview/${hydrateObj}?t=${Date.now()}`;
            useCharacterTaskStore.getState().completeApi({
              preview_url: url,
              object_name: hydrateObj,
            });
          }
          // 원본 사진 URL (있으면)
          if (ch.original_photo_object_name) {
            const photoUrl = `${BACKEND_BASE_URL}/api/character/preview/${ch.original_photo_object_name}?t=${Date.now()}`;
            setOriginalPhotoUrl(photoUrl);
            useCharacterTaskStore.getState().setInput({
              originalPhotoObjectName: ch.original_photo_object_name,
            });
          } else {
            setOriginalPhotoUrl(null);
          }
          // 이름 (있으면)
          if (ch.name) setMeName(ch.name);
          // 백엔드 used_items로 outfit store 동기화 (백엔드 = 진실의 원천)
          if (Array.isArray(ch.used_items) && ch.used_items.length > 0) {
            const mapped = ch.used_items.map((it: any) => ({
              cat: it.category || '',
              name: it.name || '',
              productUrl: it.product_url || undefined,
              imageObjectName: it.image_object_name || undefined,
              appliedAt: Date.now(),
            }));
            useOutfitStore.getState().setItems(mapped);
          }
        } catch (err: any) {
          console.warn('[ArtistResult] /me 조회 실패:', err?.response?.status, err?.message);
        } finally {
          if (!cancelled) setHydrating(false);
        }
      })();
      return () => { cancelled = true; };
    }, [user, slotParam])
  );

  const handleSave = async () => {
    if (!apiResult) return;
    setSaving(true);
    try {
      // v3.80: 방금 생성분이 가상이면 variant/art_style 포함 (실사 페이로드는 불변).
      // outfit/refine은 실사 전용이므로 characterKind 잔존값에 속지 않도록 mode도 확인.
      const isVirtualSave =
        apiResult.object_name === virtualSheet?.objectName ||
        (apiResult.object_name !== realSheet?.objectName &&
          taskStore.characterKind === 'virtual' &&
          taskStore.mode !== 'outfit' && taskStore.mode !== 'refine');
      const saveBody: any = { sheet_object_name: apiResult.object_name };
      if (isVirtualSave) {
        saveBody.variant = 'virtual';
        saveBody.art_style =
          virtualSheet?.artStyle || (taskStore.styleImageUri ? 'custom' : taskStore.stylePreset) || undefined;
      }
      if (__DEV__) console.info('[ArtistResult] 수동 저장', { isVirtualSave, art_style: saveBody.art_style });
      await api.post('/character/save', saveBody);
      showAlert('저장 완료', '아티스트 캐릭터를 저장했어요.', [
        {
          text: '확인',
          onPress: () => {
            taskStore.reset();
            if (navigation.canGoBack()) {
              navigation.popToTop();
            } else {
              navigation.navigate('Map');
            }
          },
        },
      ]);
    } catch (err: any) {
      showAlert('오류', err.response?.data?.error || '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const handleGoCody = () => {
    if (!apiResult) return;
    navigation.replace('ArtistCody');
  };

  const handleResetCharacter = () => {
    setResetConfirmVisible(true);
  };

  const performResetCharacter = async () => {
    setResetConfirmVisible(false);
    console.log('[ArtistResult] 캐릭터 삭제 요청 시작');
    try {
      const res = await api.delete('/character/me');
      console.log('[ArtistResult] 캐릭터 삭제 성공:', res.status);
      taskStore.reset();
      useOutfitStore.getState().clear();
      // v3.82: 서버 전체 삭제와 함께 로컬 프로필(이름·성별)도 정리
      useArtistProfileStore.getState().clearAll();
      // v3.81: 삭제 후엔 목록으로 (목록이 포커스 시 재로드 → 빈 상태 + 추가 버튼)
      navigation.navigate('MyArtists');
    } catch (err: any) {
      console.error('[ArtistResult] 캐릭터 삭제 실패:', err?.response?.status, err?.response?.data, err?.message);
      const msg = err.response?.data?.error || err.message || '삭제에 실패했어요.';
      setErrorDialog({ title: '삭제 실패', message: msg });
    }
  };

  if (hydrating) {
    return (
      <View style={styles.container}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent.primary} />
        </View>
      </View>
    );
  }

  if (!apiResult) {
    return (
      <View style={styles.container}>
        <View style={styles.center}>
          <AppText style={styles.emptyTitle}>아직 만든 아티스트가 없어요</AppText>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => navigation.replace('ArtistInput')}
          >
            <AppText style={styles.primaryBtnText}>아티스트 만들러 가기</AppText>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // v3.80: 슬롯별 표시 — 선택 슬롯 시트 우선, 하이드레이션 전엔 방금 생성분(apiResult) fallback
  const activeSheet = activeSlot === 'virtual' ? virtualSheet : realSheet;
  const displayUrl = activeSheet?.url || apiResult.preview_url;
  const isVirtualTab = activeSlot === 'virtual';
  const bothSlots = !!realSheet && !!virtualSheet;
  // v3.82: kind 배지 대신 이름·성별 — 이름은 서버 name 우선, 없으면 로컬 프로필
  const profile = profiles[activeSlot];
  const displayName = meeName || profile?.name || '이름 없는 아티스트';
  const displayGender = profile?.gender || null;

  return (
    <View style={styles.container}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 24 }}>
        <AppText style={styles.title}>
          {isUnsaved ? '완성된 아티스트 시트' : meeName ? `내 아티스트 · ${meeName}` : '내 아티스트'}
        </AppText>
        <AppText style={styles.subtitle}>
          {isUnsaved
            ? '마음에 드시면 저장하세요. 꾸미기로 옷·악세서리·헤어를 바꿀 수 있어요.'
            : '꾸미기로 옷·악세서리·헤어스타일·염색까지 모두 바꿀 수 있어요.'}
        </AppText>

        {/* v3.82: kind 배지·화풍 라벨 제거 — 이름 · 성별만 표시(성별 미상이면 이름만) */}
        <View style={styles.kindRow}>
          <View style={styles.kindBadge}>
            <AppText style={styles.kindBadgeText}>
              {displayGender ? `${displayName} · ${displayGender}` : displayName}
            </AppText>
          </View>
        </View>

        {/* 9004: 캐릭터 생성 시 업로드한 원본 사진 표시 — 실사 슬롯 전용 */}
        {!isVirtualTab && originalPhotoUrl && (
          <View style={styles.originalPhotoBox}>
            <View style={{ flex: 1 }}>
              <AppText style={styles.originalPhotoLabel}>내가 올린 사진</AppText>
              <AppText style={styles.originalPhotoSub}>
                이 사진을 바탕으로 캐릭터가 생성됐어요. 꾸미기 시에도 이 사진이 다시 사용돼요.
              </AppText>
            </View>
            <Image source={{ uri: originalPhotoUrl }} style={styles.originalPhotoImg} />
          </View>
        )}

        <TouchableOpacity
          style={styles.previewBox}
          activeOpacity={0.85}
          onPress={() => setZoomVisible(true)}
        >
          <Image source={{ uri: displayUrl }} style={styles.previewImg} />
          <View style={styles.zoomHint}>
            <AppText style={styles.zoomHintText}>탭하여 확대 보기</AppText>
          </View>
        </TouchableOpacity>

        {/* 착용 중인 제품 정보 — 실사 슬롯 전용(코디는 실사만) */}
        {!isVirtualTab && outfitItems.length > 0 && (
          <View style={styles.outfitListBox}>
            <AppText style={styles.outfitListTitle}>착용 중인 제품</AppText>
            {outfitItems.map((it, i) => {
              const optStr = it.options && Object.keys(it.options).length > 0
                ? Object.entries(it.options).map(([k, v]) => `${k}:${v}`).join(' · ')
                : null;
              return (
                <View key={`${it.cat}-${i}`} style={styles.outfitRow}>
                  {it.imageObjectName ? (
                    <Image
                      source={{ uri: `${BACKEND_BASE_URL}/api/character/preview/${it.imageObjectName}` }}
                      style={styles.outfitThumb}
                    />
                  ) : (
                    <View style={[styles.outfitThumb, styles.outfitThumbPh]}>
                      <AppText style={{ fontSize: 18 }}>?</AppText>
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <AppText style={styles.outfitRowCat}>{it.cat}</AppText>
                    <AppText style={styles.outfitRowName} numberOfLines={2}>
                      {it.brand ? `${it.brand} ` : ''}{it.name}
                    </AppText>
                    {optStr ? <AppText style={styles.outfitRowOpt}>{optStr}</AppText> : null}
                  </View>
                  {it.productUrl ? (
                    <TouchableOpacity
                      style={styles.outfitLinkBtn}
                      onPress={() => Linking.openURL(it.productUrl!).catch(() => {
                        showAlert('링크 열기 실패', '브라우저로 열 수 없는 링크예요.');
                      })}
                    >
                      <AppText style={styles.outfitLinkBtnText}>보러가기</AppText>
                    </TouchableOpacity>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}

        {/* v3.84: 아티스트 목소리 — 간편(프리셋)/내 목소리(클론)/미설정 3분기 표기 */}
        <View style={styles.voiceBox}>
          <AppText style={styles.voiceBoxLabel}>아티스트 목소리</AppText>
          <AppText style={styles.voiceBoxDesc}>
            {artistVoice?.type === 'preset'
              ? `간편 목소리(${artistVoiceLabel(artistVoice)})가 설정되어 있어요. 곡을 만들 때 이 스타일이 적용돼요.`
              : artistVoice?.type === 'clone'
                ? `"${artistVoice.name}" 목소리가 연결되어 있어요. 작곡 시 기본으로 제안됩니다.`
                : '간편 목소리(스타일 프리셋)를 고르거나 내 목소리를 클로닝해 아티스트에 연결해보세요.'}
          </AppText>
          <TouchableOpacity
            style={styles.voiceBtn}
            onPress={() => navigation.navigate('VoiceManage', { select: 'artist' })}
            activeOpacity={0.7}
          >
            <AppText style={styles.voiceBtnText}>
              {artistVoice?.type === 'preset'
                ? `간편 목소리: ${artistVoiceLabel(artistVoice)}`
                : artistVoice?.type === 'clone'
                  ? `내 목소리: ${artistVoice.name}`
                  : '목소리 설정'}
            </AppText>
          </TouchableOpacity>
        </View>

        {/* v3.82: 캐릭터 다시 만들기 — 하단 [🗑 삭제] 버튼 제거 후 유일한 삭제 진입점.
            트러블슈팅 문구 대신 일반 문구, 모든 슬롯에서 노출(발견성 유지) */}
        <View style={styles.resetBox}>
          <AppText style={styles.resetBoxLabel}>처음부터 다시 만들고 싶나요?</AppText>
          <AppText style={styles.resetBoxDesc}>
            아티스트를 삭제하고 처음부터 다시 만듭니다. (현재 아티스트와 코디 기록은 모두 삭제돼요)
          </AppText>
          <TouchableOpacity style={styles.resetBtn} onPress={handleResetCharacter} activeOpacity={0.7}>
            <AppText style={styles.resetBtnText}>캐릭터 다시 만들기</AppText>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* v3.82: 미니플레이어를 숨기므로 bottomLift 제거 — bottomArea는 탭바 바로 위 고정.
          저장된 가상 슬롯은 남는 버튼이 없어(꾸미기=실사 전용) bottomArea 자체를 숨김 */}
      {(isUnsaved || !isVirtualTab) && (
      <View style={styles.bottomArea}>
        {isUnsaved ? (
          <View style={styles.btnRow}>
            {/* v3.80: 꾸미기(outfit)는 실사 전용 — 가상 슬롯에서는 숨김 */}
            {!isVirtualTab && (
              <TouchableOpacity style={styles.skipBtn} onPress={handleGoCody}>
                <AppText style={styles.skipBtnText}>꾸미기</AppText>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.applyBtn, saving && { opacity: 0.5 }]}
              onPress={handleSave}
              disabled={saving}
            >
              <AppText style={styles.applyBtnText}>{saving ? '저장 중...' : '저장'}</AppText>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.btnRow}>
            {/* v3.82: [🗑 삭제] 제거 — "캐릭터 다시 만들기"(스크롤 끝)와 동일 기능(DELETE /character/me) 중복 */}
            <TouchableOpacity
              style={[styles.applyBtn, { justifyContent: 'center', minHeight: 44 }]}
              onPress={handleGoCody}
            >
              <AppText
                style={[
                  styles.applyBtnText,
                  { textAlign: 'center', lineHeight: 16, includeFontPadding: false as any },
                ]}
              >
                아티스트 꾸미기
              </AppText>
            </TouchableOpacity>
          </View>
        )}
      </View>
      )}

      {/* 시트 확대 보기 — pinch zoom + pan */}
      <ZoomModal
        visible={zoomVisible}
        uri={displayUrl}
        onClose={() => setZoomVisible(false)}
      />

      {/* 캐릭터 삭제 confirm */}
      <ConfirmDialog
        visible={resetConfirmVisible}
        title="캐릭터 다시 만들기"
        message={
          bothSlots
            ? '서버 제약으로 현재는 모든 아티스트가 함께 삭제됩니다(개별 삭제는 준비 중이에요). 모든 코디 기록도 함께 삭제돼요. 진행할까요?'
            : '현재 아티스트와 모든 코디 기록이 삭제됩니다. 새로운 아티스트를 처음부터 만들 수 있어요. 진행할까요?'
        }
        confirmText="삭제하고 다시 만들기"
        destructive
        onConfirm={performResetCharacter}
        onCancel={() => setResetConfirmVisible(false)}
      />

      {/* 에러 알림 (단일 확인 버튼) */}
      <ConfirmDialog
        visible={!!errorDialog}
        title={errorDialog?.title || ''}
        message={errorDialog?.message || ''}
        confirmText="확인"
        cancelText={null}
        onConfirm={() => setErrorDialog(null)}
      />
    </View>
  );
}

// ── 풀스크린 시트 뷰어 (+/- 버튼 + 탭으로 위치 잡기 + 드래그 이동) ──────────────
// web/native 모두 자연스럽게 작동하도록 단순화: gesture pinch 대신 버튼 기반.
function ZoomModal({
  visible,
  uri,
  onClose,
}: {
  visible: boolean;
  uri: string;
  onClose: () => void;
}) {
  const { width: screenW, height: screenH } = Dimensions.get('window');

  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;

  // 누적 값 (animation/gesture release 시 저장)
  const lastScale = useRef(1);
  const lastTx = useRef(0);
  const lastTy = useRef(0);

  // 단계별 scale (+/- 버튼)
  const SCALE_STEPS = [1, 1.5, 2, 3, 4, 5];

  const animateTo = (s: number, tx: number, ty: number) => {
    Animated.parallel([
      Animated.spring(scale, { toValue: s, useNativeDriver: true, friction: 8 }),
      Animated.spring(translateX, { toValue: tx, useNativeDriver: true, friction: 8 }),
      Animated.spring(translateY, { toValue: ty, useNativeDriver: true, friction: 8 }),
    ]).start();
    lastScale.current = s;
    lastTx.current = tx;
    lastTy.current = ty;
  };

  const reset = () => animateTo(1, 0, 0);

  const zoomIn = () => {
    const next = SCALE_STEPS.find((s) => s > lastScale.current + 0.001) ?? SCALE_STEPS[SCALE_STEPS.length - 1];
    animateTo(next, lastTx.current, lastTy.current);
  };
  const zoomOut = () => {
    const prev = [...SCALE_STEPS].reverse().find((s) => s < lastScale.current - 0.001) ?? 1;
    // scale 1로 가면 위치도 초기화
    if (prev === 1) {
      animateTo(1, 0, 0);
    } else {
      animateTo(prev, lastTx.current, lastTy.current);
    }
  };

  // 이미지 탭 → 그 위치를 화면 중앙으로 이동 (현재 scale 유지, 1배일 때는 2.5배로 확대)
  const handleImageTap = (evt: any) => {
    const { locationX, locationY } = evt.nativeEvent;
    // locationX/Y는 이미지 컨테이너 기준 (이미 transform 적용된 좌표)
    // 화면 중앙으로 이동시키려면 컨테이너 중심 기준 offset만큼 반대로 이동
    const cx = screenW / 2;
    const cy = screenH / 2;
    // 현재 transform 상태에서의 탭 위치를 "원본 좌표"로 역변환
    const origX = (locationX - lastTx.current) / lastScale.current;
    const origY = (locationY - lastTy.current) / lastScale.current;
    // 1배 상태면 2.5배로 확대하면서, 아니면 현재 scale 유지하면서 위치만 이동
    const newScale = lastScale.current < 1.1 ? 2.5 : lastScale.current;
    // 탭한 원본 좌표가 화면 중심에 오도록: tx = cx - origX * newScale
    const newTx = cx - origX * newScale;
    const newTy = cy - origY * newScale;
    animateTo(newScale, newTx, newTy);
  };

  // 드래그 이동 (확대 상태에서만 활성)
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_evt, gs) =>
        lastScale.current > 1 && (Math.abs(gs.dx) > 5 || Math.abs(gs.dy) > 5),
      onPanResponderMove: (_evt, gs) => {
        translateX.setValue(lastTx.current + gs.dx);
        translateY.setValue(lastTy.current + gs.dy);
      },
      onPanResponderRelease: () => {
        translateX.stopAnimation((v) => { lastTx.current = v; });
        translateY.stopAnimation((v) => { lastTy.current = v; });
      },
    })
  ).current;

  // 모달 닫힐 때 초기화
  useEffect(() => {
    if (!visible) {
      scale.setValue(1);
      translateX.setValue(0);
      translateY.setValue(0);
      lastScale.current = 1;
      lastTx.current = 0;
      lastTy.current = 0;
    }
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <StatusBar hidden />
      <View style={styles.zoomOverlay}>
        {/* 이미지 레이어: 탭 → 위치 잡기 + 확대 / 드래그 → 이동 */}
        <View style={StyleSheet.absoluteFill} {...panResponder.panHandlers}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={handleImageTap}
          >
            <Animated.Image
              source={{ uri }}
              style={{
                width: screenW,
                height: screenH,
                resizeMode: 'contain',
                transform: [
                  { translateX },
                  { translateY },
                  { scale },
                ],
              }}
            />
          </TouchableOpacity>
        </View>

        {/* 상단 좌측: +/- 버튼 */}
        <View style={styles.zoomCtrlGroup}>
          <TouchableOpacity style={styles.zoomCtrlBtn} onPress={zoomIn} activeOpacity={0.7}>
            <AppText style={styles.zoomCtrlText}>＋</AppText>
          </TouchableOpacity>
          <TouchableOpacity style={styles.zoomCtrlBtn} onPress={zoomOut} activeOpacity={0.7}>
            <AppText style={styles.zoomCtrlText}>－</AppText>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.zoomCtrlBtn, styles.zoomCtrlBtnWide]} onPress={reset} activeOpacity={0.7}>
            <AppText style={styles.zoomCtrlTextSmall}>↺</AppText>
          </TouchableOpacity>
        </View>

        {/* 상단 우측: 닫기 */}
        <TouchableOpacity style={styles.zoomCloseBtn} onPress={onClose} activeOpacity={0.7}>
          <AppText style={styles.zoomCloseText}>✕</AppText>
        </TouchableOpacity>

        {/* 하단 힌트 */}
        <View style={styles.zoomBottomHint}>
          <AppText style={styles.zoomBottomHintText}>
            +/− 확대·축소  ·  이미지 탭 → 그 위치 자세히 보기  ·  드래그로 이동
          </AppText>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.deepest },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  emptyTitle: { color: colors.text.primary, fontSize: 16, fontWeight: '700', marginBottom: 16, textAlign: 'center' },

  title: { color: colors.text.primary, fontSize: 18, fontWeight: '700', marginBottom: 4 },
  subtitle: { color: colors.text.secondary, fontSize: 13, marginBottom: 16, lineHeight: 19 },

  // v3.81: 카드 상단 kind 배지 (탭 대체)
  kindRow: { flexDirection: 'row', marginBottom: 10 },
  kindBadge: {
    backgroundColor: colors.bg.surface2, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: colors.accent.primary,
  },
  kindBadgeText: { color: colors.accent.primary, fontSize: 12, fontWeight: '700' },

  previewBox: {
    alignItems: 'center', padding: 12, marginBottom: 16,
    backgroundColor: colors.bg.surface1, borderRadius: 16,
    borderWidth: 1, borderColor: colors.accent.primary,
  },
  previewImg: { width: 280, height: 280, borderRadius: 12 },
  zoomHint: {
    position: 'absolute', bottom: 18, right: 18,
    backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 12,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  zoomHintText: { color: '#fff', fontSize: 11, fontWeight: '600' },

  zoomOverlay: { flex: 1, backgroundColor: '#000' },
  zoomCloseBtn: {
    position: 'absolute', top: 50, right: 20,
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center', alignItems: 'center',
    zIndex: 10, elevation: 10,
  },
  zoomCloseText: { color: '#fff', fontSize: 22, fontWeight: '600' },
  // +/- 컨트롤 그룹 (상단 좌측)
  zoomCtrlGroup: {
    position: 'absolute', top: 50, left: 20,
    flexDirection: 'row', gap: 8,
    zIndex: 10, elevation: 10,
  },
  zoomCtrlBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center', alignItems: 'center',
  },
  zoomCtrlBtnWide: { width: 44 },
  zoomCtrlText: { color: '#fff', fontSize: 22, fontWeight: '600', lineHeight: 24 },
  zoomCtrlTextSmall: { color: '#fff', fontSize: 18, fontWeight: '600' },
  zoomBottomHint: {
    position: 'absolute', bottom: 40, left: 0, right: 0,
    alignItems: 'center',
  },
  zoomBottomHintText: {
    color: 'rgba(255,255,255,0.8)', fontSize: 12,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16,
  },

  refineBox: { marginBottom: 16 },
  refineLabel: { color: colors.text.secondary, fontSize: 12, fontWeight: '700', marginBottom: 6 },
  textInput: {
    backgroundColor: colors.bg.surface1, borderWidth: 1, borderColor: colors.border.subtle,
    borderRadius: 12, padding: 12, color: colors.text.primary,
    fontSize: 14, minHeight: 60, maxHeight: 140, marginBottom: 8,
  },
  refineBtn: {
    paddingVertical: 12, borderRadius: 12, alignItems: 'center',
    backgroundColor: colors.bg.surface2, borderWidth: 1, borderColor: colors.accent.primary,
  },
  refineBtnText: { color: colors.accent.primary, fontSize: 13, fontWeight: '700' },

  bottomArea: {
    padding: 14, borderTopWidth: 1, borderTopColor: colors.bg.surface1,
    backgroundColor: colors.bg.deepest,
  },
  btnRow: { flexDirection: 'row', gap: 8 },
  skipBtn: {
    flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center',
    backgroundColor: colors.bg.surface2, borderWidth: 1, borderColor: colors.border.subtle,
  },
  skipBtnText: { color: colors.text.secondary, fontSize: 13, fontWeight: '600' },
  applyBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center',
    backgroundColor: colors.accent.primary,
  },
  applyBtnText: {
    color: colors.text.primary, fontSize: 13, fontWeight: '700',
    lineHeight: 18,
  },

  primaryBtn: {
    backgroundColor: colors.accent.primary, borderRadius: 14,
    paddingVertical: 14, paddingHorizontal: 28, alignItems: 'center',
  },
  primaryBtnText: { color: colors.text.primary, fontWeight: '700', fontSize: 15 },

  originalPhotoBox: {
    flexDirection: 'row', alignItems: 'center',
    padding: 12, marginBottom: 12, borderRadius: 12,
    backgroundColor: colors.bg.surface1,
    borderWidth: 1, borderColor: colors.border.subtle,
    gap: 12,
  },
  originalPhotoLabel: {
    fontSize: 12, fontWeight: '700', color: colors.accent.primary,
    marginBottom: 4, letterSpacing: 0.3,
  },
  originalPhotoSub: {
    fontSize: 11, color: colors.text.muted, lineHeight: 15,
  },
  originalPhotoImg: {
    width: 72, height: 96, borderRadius: 8,
    backgroundColor: colors.bg.surface2,
  },

  outfitListBox: {
    marginTop: 4, padding: 12, borderRadius: 12,
    backgroundColor: colors.bg.surface1,
    borderWidth: 1, borderColor: colors.border.subtle,
  },
  outfitThumb: {
    width: 48, height: 48, borderRadius: 8,
    backgroundColor: colors.bg.surface2,
    marginRight: 10,
  },
  outfitThumbPh: {
    justifyContent: 'center', alignItems: 'center',
  },
  outfitListTitle: {
    color: colors.text.secondary, fontSize: 12, fontWeight: '700',
    marginBottom: 10, letterSpacing: 0.3,
  },
  outfitRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border.subtle,
  },
  outfitRowCat: {
    fontSize: 11, color: colors.accent.primary, fontWeight: '700',
    marginBottom: 2, letterSpacing: 0.3,
  },
  outfitRowName: { fontSize: 13, color: colors.text.primary, fontWeight: '600' },
  outfitRowOpt: { fontSize: 11, color: colors.text.muted, marginTop: 2 },
  outfitLinkBtn: {
    backgroundColor: colors.bg.surface2,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10,
    borderWidth: 1, borderColor: colors.accent.primary,
    marginLeft: 8,
  },
  outfitLinkBtnText: { fontSize: 11, color: colors.accent.primary, fontWeight: '700' },

  voiceBox: {
    marginTop: 16, padding: 14, borderRadius: 12,
    backgroundColor: colors.bg.surface1,
    borderWidth: 1, borderColor: colors.border.subtle,
  },
  voiceBoxLabel: {
    color: colors.text.primary, fontSize: 13, fontWeight: '700',
    marginBottom: 4,
  },
  voiceBoxDesc: {
    color: colors.text.muted, fontSize: 11, lineHeight: 16,
    marginBottom: 10,
  },
  voiceBtn: {
    paddingVertical: 11, borderRadius: 10, alignItems: 'center',
    backgroundColor: colors.bg.surface2,
    borderWidth: 1, borderColor: colors.accent.primary,
  },
  voiceBtnText: { color: colors.accent.primary, fontSize: 13, fontWeight: '700' },

  resetBox: {
    marginTop: 32, padding: 14, borderRadius: 12,
    backgroundColor: colors.bg.surface1,
    borderWidth: 1, borderColor: '#553030',
  },
  resetBoxLabel: {
    color: colors.text.primary, fontSize: 13, fontWeight: '700',
    marginBottom: 4,
  },
  resetBoxDesc: {
    color: colors.text.muted, fontSize: 11, lineHeight: 16,
    marginBottom: 10,
  },
  resetBtn: {
    paddingVertical: 10, borderRadius: 10, alignItems: 'center',
    backgroundColor: 'transparent',
    borderWidth: 1, borderColor: '#a04444',
  },
  resetBtnText: { color: '#cc6868', fontSize: 13, fontWeight: '700' },
});
