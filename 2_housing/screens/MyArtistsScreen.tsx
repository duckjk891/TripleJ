import { useCallback, useLayoutEffect, useState } from 'react';
import {
  StyleSheet,
  View,
  TouchableOpacity,
  Image,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '../components/ui';
import { showAlert } from '../utils/appAlert';
import ConfirmDialog from '../components/ConfirmDialog';
import api, { BACKEND_BASE_URL } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { usePointsStore } from '../stores/pointsStore';
import { useCharacterTaskStore } from '../stores/characterTaskStore';
import { useArtistProfileStore } from '../stores/artistProfileStore';
import { colors } from '../theme/colors';

// ── v3.81: 내 아티스트 목록 ────────────────────────────────────────────────────
// 확정 모델: 아티스트 1명 = 슬롯 1개, 실사/가상은 아티스트의 kind일 뿐.
// 현 서버는 계정당 문서 1개에 실사 시트 + 가상 시트 이중 필드 →
// 프론트 매핑: 실사 시트 = 아티스트①(실사), 가상 시트 = 아티스트②(가상), 최대 2명.
// (백엔드 B-1 다중 캐릭터 후 N명 확장 예정)

type SlotKind = 'real' | 'virtual';

// v3.82: 목록 카드에서 실사/가상 표기 전면 제거 — 카드 = 시트 썸네일 + 이름만.
// slot은 내부 라우팅·forceKind 계산용으로만 유지(서버 제약: 같은 kind 생성=기존 덮어씀).
interface ArtistEntry {
  slot: SlotKind;
  sheetUrl: string;       // /api/character/preview/{obj} + cache-buster
  name: string;           // 서버 이름은 계정 공유 — 두 카드에 동일 표시 허용
}

const MAX_SLOTS = 2; // 서버 이중 필드 제약 (B-1 후 확장)
const EXTRA_SLOT_COST_FALLBACK = 15;

export default function MyArtistsScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  // v3.82: 로컬 프로필(이름·성별) — 서버 name이 비어있을 때 이름 폴백
  const profiles = useArtistProfileStore((s) => s.profiles);

  const [loading, setLoading] = useState(true);
  const [artists, setArtists] = useState<ArtistEntry[]>([]);
  // ⭐ extra_slot 과금 관련 — /points/costs 실측값(없으면 15 폴백) + 구매 이력
  const [extraSlotCost, setExtraSlotCost] = useState<number>(EXTRA_SLOT_COST_FALLBACK);
  const [purchasedExtra, setPurchasedExtra] = useState(false);
  const [spending, setSpending] = useState(false);
  // 슬롯 추가 과금 confirm (ArtistResult의 ConfirmDialog 관행)
  const [slotConfirm, setSlotConfirm] = useState<{ kind: SlotKind } | null>(null);

  // ArtistResult가 탭 헤더에 주입한 ‹ 가 남아 이중 화살표가 되지 않도록 정리 (VoiceManage 관행)
  useLayoutEffect(() => {
    const parent = navigation.getParent();
    if (!parent) return;
    parent.setOptions({ headerLeft: undefined });
  }, [navigation]);

  // 포커스마다 목록 재로드 (생성/삭제 후 복귀 반영)
  useFocusEffect(
    useCallback(() => {
      if (!user) {
        setArtists([]);
        setLoading(false);
        return;
      }
      let cancelled = false;
      setLoading(true);
      (async () => {
        try {
          // 캐릭터 + 과금 정보 병렬 로드 (모두 조회성 — 과금 없음)
          const [meRes, costsRes, historyRes] = await Promise.all([
            api.get('/character/me'),
            api.get('/points/costs').catch(() => null),
            api.get('/points/history').catch(() => null),
          ]);
          if (cancelled) return;

          const ch = meRes.data?.character;
          const list: ArtistEntry[] = [];
          if (ch?.sheet_object_name) {
            list.push({
              slot: 'real',
              sheetUrl: `${BACKEND_BASE_URL}/api/character/preview/${ch.sheet_object_name}?t=${Date.now()}`,
              name: ch.name || '',
            });
          }
          if (ch?.virtual_sheet_object_name) {
            list.push({
              slot: 'virtual',
              sheetUrl: `${BACKEND_BASE_URL}/api/character/preview/${ch.virtual_sheet_object_name}?t=${Date.now()}`,
              name: ch.name || '',
            });
          }
          setArtists(list);

          // /points/costs 실측: {"costs":{"extra_slot":15,...}} — 없으면 15 폴백
          const cost = costsRes?.data?.costs?.extra_slot;
          setExtraSlotCost(typeof cost === 'number' && cost > 0 ? cost : EXTRA_SLOT_COST_FALLBACK);

          // /points/history 실측: {"history":[{"action":"spend:character","amount":-10,...}]}
          // extra_slot 지출 항목이 있으면 기구매 → 무과금 재진입 (방어 파싱)
          const rawHistory = historyRes?.data;
          const items: any[] = Array.isArray(rawHistory?.history)
            ? rawHistory.history
            : Array.isArray(rawHistory)
              ? rawHistory
              : Array.isArray(rawHistory?.items)
                ? rawHistory.items
                : [];
          const bought = items.some(
            (it) => typeof it?.action === 'string' && it.action.includes('extra_slot')
          );
          setPurchasedExtra(bought);

          if (__DEV__) {
            console.info('[MyArtists] 로드 완료', {
              artists: list.map((a) => a.slot),
              extraSlotCost: typeof cost === 'number' ? cost : `fallback:${EXTRA_SLOT_COST_FALLBACK}`,
              purchasedExtra: bought,
            });
          }
        } catch (err: any) {
          console.error('[MyArtists] 로드 실패', { status: err?.response?.status, message: err?.message });
          if (!cancelled) setArtists([]);
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => { cancelled = true; };
    }, [user])
  );

  const handleBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('Map');
  };

  // 카드 탭 → 해당 아티스트 상세 (신선한 데이터로 hydrate되도록 store 초기화 — Map 관행)
  const handleOpenArtist = (slot: SlotKind) => {
    if (__DEV__) console.info('[MyArtists] 아티스트 상세 진입', { slot });
    useCharacterTaskStore.getState().clearResult();
    navigation.navigate('ArtistResult', { slot });
  };

  // ＋ 아티스트 추가
  const handleAdd = () => {
    if (loading || spending) return;
    if (artists.length >= MAX_SLOTS) {
      // 서버가 계정당 실사1+가상1 이중 필드 구조 — 3명째는 백엔드 확장(B-1) 대기
      showAlert('안내', '아티스트 슬롯 확장은 준비 중이에요.');
      return;
    }
    if (artists.length === 0) {
      // 첫 아티스트는 무료 — kind 자유
      if (__DEV__) console.info('[MyArtists] 첫 아티스트 생성 진입(무료)');
      navigation.navigate('ArtistInput');
      return;
    }
    // 1명 보유 → 빈 슬롯 kind 계산 (같은 kind로 만들면 기존 아티스트를 덮어쓰는 서버 제약)
    const emptyKind: SlotKind = artists[0].slot === 'real' ? 'virtual' : 'real';
    if (purchasedExtra) {
      if (__DEV__) console.info('[MyArtists] extra_slot 기구매 — 무과금 진입', { emptyKind });
      navigation.navigate('ArtistInput', { forceKind: emptyKind });
      return;
    }
    setSlotConfirm({ kind: emptyKind });
  };

  // 슬롯 추가 과금 확정 → POST /points/spend {action:'extra_slot'}
  const performSlotPurchase = async () => {
    const kind = slotConfirm?.kind;
    setSlotConfirm(null);
    if (!kind || spending) return;
    setSpending(true);
    if (__DEV__) console.info('[MyArtists] extra_slot 과금 요청', { kind, cost: extraSlotCost });
    try {
      await api.post('/points/spend', { action: 'extra_slot' });
      usePointsStore.getState().fetchBalance();
      setPurchasedExtra(true);
      if (__DEV__) console.info('[MyArtists] extra_slot 과금 성공 → ArtistInput 진입', { forceKind: kind });
      navigation.navigate('ArtistInput', { forceKind: kind });
    } catch (err: any) {
      const status = err?.response?.status;
      console.error('[MyArtists] extra_slot 과금 실패', { status, message: err?.message });
      if (status === 402) {
        showAlert('스타가 부족해요', `아티스트 슬롯 추가에는 ⭐${extraSlotCost}가 필요해요. 출석체크·앱 추천으로 스타를 모아보세요.`);
      } else {
        showAlert('오류', err?.response?.data?.error || '슬롯 추가에 실패했어요. 잠시 후 다시 시도해주세요.');
      }
    } finally {
      setSpending(false);
    }
  };

  const slotsFull = artists.length >= MAX_SLOTS;
  const addLabel = loading
    ? '＋ 아티스트 추가'
    : slotsFull
      ? '아티스트 슬롯 확장은 준비 중이에요'
      : artists.length === 0
        ? '＋ 첫 아티스트 만들기 (무료)'
        : purchasedExtra
          ? '＋ 아티스트 추가'
          : `＋ 아티스트 추가 (⭐${extraSlotCost})`;

  return (
    <View style={styles.container}>
      {/* 헤더 (StudioStack headerShown:false → 화면 내부 헤더, VoiceManage 관행) */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          onPress={handleBack}
          style={styles.backBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <AppText style={styles.backBtnText}>‹</AppText>
        </TouchableOpacity>
        <AppText style={styles.headerTitle}>내 아티스트</AppText>
        <View style={styles.backBtn} />
      </View>

      {!user ? (
        <View style={styles.centerBox}>
          <AppText style={styles.emptyTitle}>로그인이 필요해요</AppText>
          <AppText style={styles.emptyDesc}>로그인하고 나만의 아티스트를 만들어보세요!</AppText>
        </View>
      ) : loading ? (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color={colors.accent.primary} />
        </View>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
          {artists.length === 0 && (
            <View style={styles.emptyBox}>
              <AppText style={styles.emptyTitle}>아직 아티스트가 없어요</AppText>
              <AppText style={styles.emptyDesc}>
                아티스트 디렉터와 함께 우리 기획사의 첫 아티스트를 만들어보세요. 첫 아티스트는 무료예요!
              </AppText>
            </View>
          )}

          {artists.map((a) => (
            <TouchableOpacity
              key={a.slot}
              style={styles.card}
              onPress={() => handleOpenArtist(a.slot)}
              activeOpacity={0.8}
            >
              <Image source={{ uri: a.sheetUrl }} style={styles.cardImg} />
              <View style={styles.cardBody}>
                {/* v3.82: 카드 = 시트 썸네일 + 이름만 (실사/가상 배지·화풍 라벨 제거) */}
                <AppText style={styles.cardName} numberOfLines={1}>
                  {a.name || profiles[a.slot]?.name || '이름 없는 아티스트'}
                </AppText>
              </View>
              <AppText style={styles.cardChevron}>›</AppText>
            </TouchableOpacity>
          ))}

          {/* ＋ 아티스트 추가 */}
          <TouchableOpacity
            style={[
              styles.addCard,
              artists.length === 0 && styles.addCardEmphasis,
              (slotsFull || spending) && styles.addCardDisabled,
            ]}
            onPress={handleAdd}
            disabled={spending}
            activeOpacity={slotsFull ? 1 : 0.7}
          >
            {spending ? (
              <ActivityIndicator size="small" color={colors.accent.primary} />
            ) : (
              <AppText
                style={[
                  styles.addCardText,
                  artists.length === 0 && styles.addCardTextEmphasis,
                  slotsFull && styles.addCardTextDisabled,
                ]}
              >
                {addLabel}
              </AppText>
            )}
          </TouchableOpacity>
          {slotsFull && (
            <AppText style={styles.fullHint}>
              지금은 최대 2명까지 만들 수 있어요.
            </AppText>
          )}
        </ScrollView>
      )}

      {/* 슬롯 추가 과금 confirm — v3.82: kind 언급 없이 비용만 안내(forceKind는 내부 로직으로만 전달) */}
      <ConfirmDialog
        visible={!!slotConfirm}
        title="아티스트 슬롯 추가"
        message={`⭐${extraSlotCost}를 사용해 아티스트 슬롯을 추가할까요?`}
        confirmText={`⭐${extraSlotCost} 사용하기`}
        onConfirm={performSlotPurchase}
        onCancel={() => setSlotConfirm(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.deepest },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingBottom: 8,
    borderBottomWidth: 1, borderBottomColor: colors.bg.surface1,
  },
  backBtn: { width: 40, alignItems: 'center', paddingVertical: 2 },
  backBtnText: { fontSize: 28, color: colors.text.primary, fontWeight: '300' },
  headerTitle: { fontSize: 16, fontWeight: '700', color: colors.text.primary },

  centerBox: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },

  emptyBox: { alignItems: 'center', paddingVertical: 28, paddingHorizontal: 12 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 17, color: colors.text.primary, fontWeight: '700', marginBottom: 8 },
  emptyDesc: {
    fontSize: 13, color: colors.text.secondary, textAlign: 'center', lineHeight: 20,
  },

  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.bg.surface1, borderRadius: 16,
    borderWidth: 1, borderColor: colors.border.subtle,
    padding: 12, marginBottom: 12, gap: 12,
  },
  cardImg: {
    width: 84, height: 84, borderRadius: 12,
    backgroundColor: colors.bg.surface2,
  },
  cardBody: { flex: 1 },
  cardName: { color: colors.text.primary, fontSize: 15, fontWeight: '700' },
  cardChevron: { color: colors.text.muted, fontSize: 24, fontWeight: '300', paddingHorizontal: 2 },

  addCard: {
    borderRadius: 16, borderWidth: 1.5, borderColor: colors.border.subtle,
    borderStyle: 'dashed', paddingVertical: 18, alignItems: 'center',
    marginTop: 4,
  },
  addCardEmphasis: { borderColor: colors.accent.primary, backgroundColor: colors.bg.surface1 },
  addCardDisabled: { opacity: 0.5 },
  addCardText: { color: colors.text.secondary, fontSize: 14, fontWeight: '700' },
  addCardTextEmphasis: { color: colors.accent.primary },
  addCardTextDisabled: { color: colors.text.muted, fontWeight: '600' },
  fullHint: {
    color: colors.text.muted, fontSize: 11, textAlign: 'center', marginTop: 8, lineHeight: 16,
  },
});
