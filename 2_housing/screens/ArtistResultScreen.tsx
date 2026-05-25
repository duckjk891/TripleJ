import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  StyleSheet,
  View,
  Text,
  Image,
  TouchableOpacity,
  Alert,
  ScrollView,
  ActivityIndicator,
  Modal,
  Dimensions,
  StatusBar,
  Animated,
  PanResponder,
  Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import api, { BACKEND_BASE_URL } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { useCharacterTaskStore } from '../stores/characterTaskStore';
import { usePlayerStore } from '../stores/playerStore';
import { useOutfitStore } from '../stores/outfitStore';
import { colors } from '../theme/colors';

const MINIPLAYER_HEIGHT = 70;

export default function ArtistResultScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const taskStore = useCharacterTaskStore();
  const apiResult = taskStore.apiResult;
  const hasMiniPlayer = !!usePlayerStore((s) => s.track);
  // 미니플레이어가 탭바 위에 absolute로 떠있어서 그만큼 bottomArea를 위로 올림
  const bottomLift = hasMiniPlayer ? MINIPLAYER_HEIGHT : 0;
  // 방금 새로 만들거나 코디/미세조정한 시트는 저장 필요. mode === null이면 이미 저장된 상태.
  const isUnsaved = taskStore.mode !== null;
  const outfitItems = useOutfitStore((s) => s.items);

  const [saving, setSaving] = useState(false);
  const [hydrating, setHydrating] = useState(!apiResult); // apiResult가 비어 있으면 /character/me로 가져옴
  const [zoomVisible, setZoomVisible] = useState(false);

  // Tab 헤더 좌측에 ← 버튼 주입
  useLayoutEffect(() => {
    const parent = navigation.getParent();
    if (!parent) return;
    parent.setOptions({
      headerLeft: () => (
        <TouchableOpacity
          onPress={() => navigation.navigate('Map')}
          style={{ paddingHorizontal: 12, paddingVertical: 6 }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={{ fontSize: 26, color: colors.text.primary, fontWeight: '300' }}>‹</Text>
        </TouchableOpacity>
      ),
    });
    return () => {
      parent.setOptions({ headerLeft: undefined });
    };
  }, [navigation]);

  // 화면 포커스마다 apiResult 비어있으면 /character/me로 hydrate
  // (마이뮤직에서 카드 탭 시 ArtistResult가 캐시 마운트라 useEffect는 재실행 안 됨)
  useFocusEffect(
    useCallback(() => {
      if (!user) {
        setHydrating(false);
        return;
      }
      // 이미 채워져있으면 그대로 사용
      if (useCharacterTaskStore.getState().apiResult) {
        setHydrating(false);
        return;
      }
      setHydrating(true);
      let cancelled = false;
      (async () => {
        try {
          const res = await api.get('/character/me');
          if (cancelled) return;
          const ch = res.data?.character;
          if (ch?.sheet_object_name) {
            // cache-buster: RN Image가 같은 URL이면 재페치 안 해서 옛 이미지 보임
            const url = `${BACKEND_BASE_URL}/api/character/preview/${ch.sheet_object_name}?t=${Date.now()}`;
            useCharacterTaskStore.getState().completeApi({
              preview_url: url,
              object_name: ch.sheet_object_name,
            });
          }
        } catch {
          // 무시
        } finally {
          if (!cancelled) setHydrating(false);
        }
      })();
      return () => { cancelled = true; };
    }, [user])
  );

  const handleSave = async () => {
    if (!apiResult) return;
    setSaving(true);
    try {
      await api.post('/character/save', {
        sheet_object_name: apiResult.object_name,
      });
      Alert.alert('저장 완료', '아티스트 캐릭터를 저장했어요.', [
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
      Alert.alert('오류', err.response?.data?.error || '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const handleGoCody = () => {
    if (!apiResult) return;
    navigation.replace('ArtistCody');
  };

  const handleResetCharacter = () => {
    Alert.alert(
      '캐릭터 다시 만들기',
      '현재 아티스트와 모든 코디 기록이 삭제됩니다. 새로운 아티스트를 처음부터 만들 수 있어요. 진행할까요?',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제하고 다시 만들기',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete('/character/me');
              taskStore.reset();
              useOutfitStore.getState().clear();
              navigation.replace('ArtistInput');
            } catch (err: any) {
              Alert.alert('오류', err.response?.data?.error || '삭제에 실패했어요.');
            }
          },
        },
      ]
    );
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
          <Text style={styles.emptyTitle}>아직 만든 아티스트가 없어요</Text>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => navigation.replace('ArtistInput')}
          >
            <Text style={styles.primaryBtnText}>아티스트 만들러 가기</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 24 }}>
        <Text style={styles.title}>
          {isUnsaved ? '완성된 아티스트 시트' : '내 아티스트'}
        </Text>
        <Text style={styles.subtitle}>
          {isUnsaved
            ? '마음에 드시면 저장하세요. 꾸미기로 옷·악세서리·헤어를 바꿀 수 있어요.'
            : '꾸미기로 옷·악세서리·헤어스타일·염색까지 모두 바꿀 수 있어요.'}
        </Text>

        <TouchableOpacity
          style={styles.previewBox}
          activeOpacity={0.85}
          onPress={() => setZoomVisible(true)}
        >
          <Image source={{ uri: apiResult.preview_url }} style={styles.previewImg} />
          <View style={styles.zoomHint}>
            <Text style={styles.zoomHintText}>🔍 탭하여 확대 보기</Text>
          </View>
        </TouchableOpacity>

        {/* 착용 중인 제품 정보 */}
        {outfitItems.length > 0 && (
          <View style={styles.outfitListBox}>
            <Text style={styles.outfitListTitle}>👕 착용 중인 제품</Text>
            {outfitItems.map((it, i) => {
              const optStr = it.options && Object.keys(it.options).length > 0
                ? Object.entries(it.options).map(([k, v]) => `${k}:${v}`).join(' · ')
                : null;
              return (
                <View key={`${it.cat}-${i}`} style={styles.outfitRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.outfitRowCat}>{it.cat}</Text>
                    <Text style={styles.outfitRowName} numberOfLines={2}>
                      {it.brand ? `${it.brand} ` : ''}{it.name}
                    </Text>
                    {optStr ? <Text style={styles.outfitRowOpt}>{optStr}</Text> : null}
                  </View>
                  {it.productUrl ? (
                    <TouchableOpacity
                      style={styles.outfitLinkBtn}
                      onPress={() => Linking.openURL(it.productUrl!).catch(() => {
                        Alert.alert('링크 열기 실패', '브라우저로 열 수 없는 링크예요.');
                      })}
                    >
                      <Text style={styles.outfitLinkBtnText}>🛒 보러가기</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}

        {/* 캐릭터 다시 만들기 — destructive (스크롤 끝) */}
        <View style={styles.resetBox}>
          <Text style={styles.resetBoxLabel}>옷 갈아입히기가 잘 안 되시나요?</Text>
          <Text style={styles.resetBoxDesc}>
            현재 캐릭터의 베이스 의상이 코디 적용을 방해할 수 있어요. 처음부터 다시 만들면 코디가 잘 적용됩니다. (현재 캐릭터와 코디 기록은 모두 삭제돼요)
          </Text>
          <TouchableOpacity style={styles.resetBtn} onPress={handleResetCharacter} activeOpacity={0.7}>
            <Text style={styles.resetBtnText}>🗑 캐릭터 다시 만들기</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <View style={[styles.bottomArea, { marginBottom: bottomLift }]}>
        {isUnsaved ? (
          <View style={styles.btnRow}>
            <TouchableOpacity style={styles.skipBtn} onPress={handleGoCody}>
              <Text style={styles.skipBtnText}>✨ 꾸미기</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.applyBtn, saving && { opacity: 0.5 }]}
              onPress={handleSave}
              disabled={saving}
            >
              <Text style={styles.applyBtnText}>{saving ? '저장 중...' : '💾 저장'}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.applyBtn, { flex: 0, alignSelf: 'stretch' }]}
            onPress={handleGoCody}
          >
            <Text style={styles.applyBtnText}>✨ 아티스트 꾸미기</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* 시트 확대 보기 — pinch zoom + pan */}
      <ZoomModal
        visible={zoomVisible}
        uri={apiResult.preview_url}
        onClose={() => setZoomVisible(false)}
      />
    </View>
  );
}

// ── 풀스크린 시트 뷰어 (pinch zoom + pan) ──────────────────────────────
// PanResponder 기반 자체 구현. native dependency 없이 expo go에서도 작동.
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

  // 누적 값 (gesture release 시 저장)
  const lastScale = useRef(1);
  const lastTx = useRef(0);
  const lastTy = useRef(0);

  // pinch 시작 시점 손가락 거리 / 두 손가락 중심점
  const initialDistance = useRef<number | null>(null);
  const initialFocalX = useRef(0);
  const initialFocalY = useRef(0);

  const MIN_SCALE = 1;
  const MAX_SCALE = 5;

  const reset = () => {
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 7 }),
      Animated.spring(translateX, { toValue: 0, useNativeDriver: true, friction: 7 }),
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, friction: 7 }),
    ]).start();
    lastScale.current = 1;
    lastTx.current = 0;
    lastTy.current = 0;
  };

  const panResponder = useRef(
    PanResponder.create({
      // 단일 탭은 자식(닫기 버튼 등)에 양보, 멀티터치 또는 드래그만 캡처
      onStartShouldSetPanResponder: (evt) => evt.nativeEvent.touches.length >= 2,
      onMoveShouldSetPanResponder: (evt, gestureState) =>
        evt.nativeEvent.touches.length >= 2 ||
        Math.abs(gestureState.dx) > 5 ||
        Math.abs(gestureState.dy) > 5,
      onPanResponderGrant: (evt) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length === 2) {
          const dx = touches[0].pageX - touches[1].pageX;
          const dy = touches[0].pageY - touches[1].pageY;
          initialDistance.current = Math.sqrt(dx * dx + dy * dy);
          initialFocalX.current = (touches[0].pageX + touches[1].pageX) / 2;
          initialFocalY.current = (touches[0].pageY + touches[1].pageY) / 2;
        } else {
          initialDistance.current = null;
        }
      },
      onPanResponderMove: (evt, gestureState) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length === 2) {
          // pinch zoom
          const dx = touches[0].pageX - touches[1].pageX;
          const dy = touches[0].pageY - touches[1].pageY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (initialDistance.current == null) {
            initialDistance.current = dist;
            initialFocalX.current = (touches[0].pageX + touches[1].pageX) / 2;
            initialFocalY.current = (touches[0].pageY + touches[1].pageY) / 2;
            return;
          }
          const ratio = dist / initialDistance.current;
          const newScale = Math.min(
            MAX_SCALE,
            Math.max(MIN_SCALE, lastScale.current * ratio)
          );
          scale.setValue(newScale);
        } else if (touches.length === 1 && lastScale.current > 1) {
          // pan (확대 상태에서만)
          translateX.setValue(lastTx.current + gestureState.dx);
          translateY.setValue(lastTy.current + gestureState.dy);
        }
      },
      onPanResponderRelease: (evt) => {
        // 현재 scale 값 누적 저장
        scale.stopAnimation((v) => {
          lastScale.current = v;
        });
        translateX.stopAnimation((v) => {
          lastTx.current = v;
        });
        translateY.stopAnimation((v) => {
          lastTy.current = v;
        });
        // scale가 1에 가까우면 자동 reset
        setTimeout(() => {
          if (lastScale.current <= 1.05) {
            reset();
          }
        }, 50);
      },
      onPanResponderTerminate: () => {
        scale.stopAnimation((v) => { lastScale.current = v; });
        translateX.stopAnimation((v) => { lastTx.current = v; });
        translateY.stopAnimation((v) => { lastTy.current = v; });
      },
    })
  ).current;

  // 모달이 닫힐 때마다 초기화
  useEffect(() => {
    if (!visible) {
      scale.setValue(1);
      translateX.setValue(0);
      translateY.setValue(0);
      lastScale.current = 1;
      lastTx.current = 0;
      lastTy.current = 0;
      initialDistance.current = null;
    }
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <StatusBar hidden />
      <View style={styles.zoomOverlay}>
        {/* PanResponder가 붙은 이미지 레이어 (버튼들과 분리) */}
        <View style={StyleSheet.absoluteFill} {...panResponder.panHandlers}>
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
        </View>
        {/* 버튼 레이어 — PanResponder 영역 위에 zIndex로 올림 */}
        <TouchableOpacity style={styles.zoomCloseBtn} onPress={onClose} activeOpacity={0.7}>
          <Text style={styles.zoomCloseText}>✕</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.zoomResetBtn} onPress={reset} activeOpacity={0.7}>
          <Text style={styles.zoomResetText}>↺ 원래 크기</Text>
        </TouchableOpacity>
        <View style={styles.zoomBottomHint}>
          <Text style={styles.zoomBottomHintText}>두 손가락으로 확대 · 한 손가락으로 이동</Text>
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
  zoomResetBtn: {
    position: 'absolute', top: 56, left: 20,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16,
    zIndex: 10, elevation: 10,
  },
  zoomResetText: { color: '#fff', fontSize: 12, fontWeight: '600' },
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
    flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center',
    backgroundColor: colors.accent.primary,
  },
  applyBtnText: { color: colors.text.primary, fontSize: 13, fontWeight: '700' },

  primaryBtn: {
    backgroundColor: colors.accent.primary, borderRadius: 14,
    paddingVertical: 14, paddingHorizontal: 28, alignItems: 'center',
  },
  primaryBtnText: { color: colors.text.primary, fontWeight: '700', fontSize: 15 },

  outfitListBox: {
    marginTop: 4, padding: 12, borderRadius: 12,
    backgroundColor: colors.bg.surface1,
    borderWidth: 1, borderColor: colors.border.subtle,
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
