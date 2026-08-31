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
import api from '../services/api';
import {
  listArtists,
  spendExtraSlot,
  artistSheetUrl,
  type ArtistSlots,
} from '../services/characterService';
import { useAuthStore } from '../stores/authStore';
import { usePointsStore } from '../stores/pointsStore';
import { useCharacterTaskStore } from '../stores/characterTaskStore';
import { useArtistProfileStore } from '../stores/artistProfileStore';
import { colors } from '../theme/colors';

// ── v3.103(B-1): 내 아티스트 목록 — 서버 /character/list 기반 N명 체제 ─────────
// 카드 = 시트 썸네일 + 이름(+성별) + 대표 배지 + 목소리 상태. kind 라벨은 표시 금지(대표 방침).
// [＋추가]: slots.used < max → 무료 진입(슬롯 검사는 서버 409가 백업),
//           used >= max → ⭐로 슬롯 확장 confirm → POST /points/spend {action:'extra_slot'}
//           (v216: max_slots 영구 +1 — 구 points/history dedupe 로직 제거됨).
// 레거시(마이그레이션 미실행) 계정: list가 characters:[] 인데 slots.used>=1 →
// GET /character/me(구 shape)로 폴백해 조립 카드 표시, 편집/재생성은 구 계약으로 동작.

type SlotKind = 'real' | 'virtual';

interface ArtistEntry {
  /** 서버 다중 체제의 cid. null = 레거시(me 폴백) 카드 → slot으로 라우팅 */
  characterId: string | null;
  /** 레거시 카드 전용 — ArtistResult { slot } 진입용 */
  slot?: SlotKind;
  kind: SlotKind;
  sheetUrl: string;
  name: string;
  gender: string | null;
  isDefault: boolean;
  personaId: string | null;
  personaName: string | null;
  personaStatus: string | null; // 'ready' | 'missing' | null
}

const EXTRA_SLOT_COST_FALLBACK = 15;
const CHARACTER_COST_FALLBACK = 10;

export default function MyArtistsScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  // 레거시 카드 이름 폴백용 로컬 프로필(이름·성별) — 서버 카드에서는 서버 값 우선
  const profiles = useArtistProfileStore((s) => s.profiles);

  const [loading, setLoading] = useState(true);
  const [artists, setArtists] = useState<ArtistEntry[]>([]);
  const [slots, setSlots] = useState<ArtistSlots>({ used: 0, max: 1 });
  const [isLegacy, setIsLegacy] = useState(false);
  // ⭐ extra_slot 비용 — /points/costs 실측값(없으면 15 폴백)
  const [extraSlotCost, setExtraSlotCost] = useState<number>(EXTRA_SLOT_COST_FALLBACK);
  // v3.105: 캐릭터 생성 비용(costs.character) — [＋추가] 진입 팝업에 ⭐ 소모 명시용
  const [characterCost, setCharacterCost] = useState<number>(CHARACTER_COST_FALLBACK);
  const balance = usePointsStore((s) => s.balance);
  const [spending, setSpending] = useState(false);
  // 슬롯 확장 과금 confirm (앱 내 다이얼로그)
  const [slotConfirmVisible, setSlotConfirmVisible] = useState(false);
  // v3.105: [＋추가] 진입 confirm — 생성 시 ⭐ 소모를 입력 시작 전에 고지 (대표 지적)
  const [addConfirm, setAddConfirm] = useState<{ forceKind?: SlotKind } | null>(null);

  // ArtistResult가 탭 헤더에 주입한 ‹ 가 남아 이중 화살표가 되지 않도록 정리 (VoiceManage 관행)
  useLayoutEffect(() => {
    const parent = navigation.getParent();
    if (!parent) return;
    parent.setOptions({ headerLeft: undefined });
  }, [navigation]);

  // 포커스마다 목록 재로드 (생성/삭제/연결 후 복귀 반영)
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
          // 목록 + 비용 병렬 로드 (모두 조회성 — 과금 없음)
          const [listRes, costsRes] = await Promise.all([
            listArtists(),
            api.get('/points/costs').catch(() => null),
          ]);
          if (cancelled) return;

          const { characters, slots: serverSlots } = listRes;
          let entries: ArtistEntry[] = [];
          let legacy = false;

          if (characters.length > 0) {
            // 서버 다중 체제 — 카드 그대로 매핑
            entries = characters
              .filter((c) => c.sheet_object_name || c.sheet_url)
              .map((c) => ({
                characterId: c.character_id,
                kind: c.kind,
                sheetUrl: c.sheet_object_name ? artistSheetUrl(c.sheet_object_name) : (c.sheet_url || ''),
                name: c.name || '',
                gender: c.gender || null,
                isDefault: c.is_default,
                personaId: c.persona_id,
                personaName: c.persona_name,
                personaStatus: c.persona_status,
              }));
          } else {
            // 레거시(마이그레이션 미실행) 계정 — /me 구 shape로 조립 카드 표시.
            // 편집/재생성은 구 계약(me/save, character_id 미지정), 개별 삭제 UI 금지(me=전체 삭제).
            // v3.116: 기존엔 slots.used>=1일 때만 /me 폴백을 시도했는데, 서버 used 집계와
            // 실제 me 시트가 어긋나는 계정(무cid 잔여 doc 등)은 used=0으로 와서 저장된
            // 아티스트가 있는데도 빈 상태가 떴다. characters가 빈 배열이면 used와 무관하게
            // /me를 실측해 시트가 있으면 레거시 카드로 구제한다(조회성 GET 1회 추가 — 무과금).
            const meRes = await api.get('/character/me');
            if (cancelled) return;
            const ch = meRes.data?.character;
            if (serverSlots.used >= 1) legacy = true;
            if (ch?.sheet_object_name) {
              entries.push({
                characterId: null,
                slot: 'real',
                kind: 'real',
                sheetUrl: artistSheetUrl(ch.sheet_object_name),
                name: ch.name || '',
                gender: ch.gender || null,
                isDefault: false,
                personaId: null,
                personaName: null,
                personaStatus: null,
              });
            }
            if (ch?.virtual_sheet_object_name) {
              entries.push({
                characterId: null,
                slot: 'virtual',
                kind: 'virtual',
                sheetUrl: artistSheetUrl(ch.virtual_sheet_object_name),
                name: ch.name || '',
                gender: ch.gender || null,
                isDefault: false,
                personaId: null,
                personaName: null,
                personaStatus: null,
              });
            }
            // v3.116 구제: used=0으로 왔지만 me에 시트가 실존 — 레거시로 확정(빈 상태 방지)
            if (entries.length > 0 && !legacy) {
              legacy = true;
              console.warn('[MyArtists] slots.used=0인데 /me 시트 존재 — 레거시 폴백 구제', {
                used: serverSlots.used,
              });
            }
          }

          setArtists(entries);
          setSlots(serverSlots);
          setIsLegacy(legacy);

          // /points/costs 실측: {"costs":{"extra_slot":15,"character":10,...}} — 없으면 폴백
          const cost = costsRes?.data?.costs?.extra_slot;
          setExtraSlotCost(typeof cost === 'number' && cost > 0 ? cost : EXTRA_SLOT_COST_FALLBACK);
          const charCost = costsRes?.data?.costs?.character;
          setCharacterCost(typeof charCost === 'number' && charCost > 0 ? charCost : CHARACTER_COST_FALLBACK);
          // v3.105: 진입 팝업의 잔액 부족 안내용 — 최신 ⭐ 잔액 확보
          usePointsStore.getState().fetchBalance();

          if (__DEV__) {
            console.info('[MyArtists] 로드 완료', {
              mode: legacy ? 'legacy' : 'multi',
              cards: entries.length,
              slots: serverSlots,
              extraSlotCost: typeof cost === 'number' ? cost : `fallback:${EXTRA_SLOT_COST_FALLBACK}`,
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
  const handleOpenArtist = (a: ArtistEntry) => {
    if (__DEV__) console.info('[MyArtists] 아티스트 상세 진입', { characterId: a.characterId, slot: a.slot });
    useCharacterTaskStore.getState().clearResult();
    if (a.characterId) navigation.navigate('ArtistResult', { characterId: a.characterId });
    else navigation.navigate('ArtistResult', { slot: a.slot });
  };

  const slotsFull = slots.used >= slots.max;

  // v3.105: 진입 전 ⭐ 잔액 사전 안내 — 부족하면 생성 자체가 402라 입력 낭비 방지
  const guardStarShortage = (): boolean => {
    if (balance != null && balance < characterCost) {
      if (__DEV__) console.info('[MyArtists] 별 부족 사전 안내', { balance, characterCost });
      showAlert(
        '스타가 부족해요',
        `아티스트 생성에는 ⭐${characterCost}가 필요해요. (현재 보유: ⭐${balance})\n출석체크·앱 추천으로 스타를 모아보세요.`
      );
      return true;
    }
    return false;
  };

  // ＋ 아티스트 추가 — 진입 시점에 ⭐ 소모 고지 confirm(대표 지적: 맨 끝 확인 팝업 대신 여기서 1회).
  // used<max: confirm 후 진입(슬롯 검사는 서버 409가 백업), used>=max: ⭐확장 confirm
  const handleAdd = () => {
    if (loading || spending) return;

    if (isLegacy) {
      // 레거시 구 계약: 같은 kind 생성 = 기존 덮어씀 → 빈 kind로만 추가 가능
      const kinds = artists.map((a) => a.kind);
      const hasReal = kinds.includes('real');
      const hasVirtual = kinds.includes('virtual');
      if (hasReal && hasVirtual) {
        showAlert('안내', '구버전 계정은 최대 2명까지 만들 수 있어요. 계정 업그레이드 후 더 추가할 수 있어요.');
        return;
      }
      if (guardStarShortage()) return;
      // v3.112: 빈 kind가 둘 다면 강제하지 않음 — 입력 화면에서 실사/가상 선택.
      // 한쪽만 비었으면 기존대로 forceKind(같은 kind 생성=덮어씀 방지) 유지.
      if (!hasReal && !hasVirtual) {
        if (__DEV__) console.info('[MyArtists] 레거시 추가 confirm 표시(빈 kind 둘 다 — 선택 노출)');
        setAddConfirm({});
        return;
      }
      const emptyKind: SlotKind = hasReal ? 'virtual' : 'real';
      if (__DEV__) console.info('[MyArtists] 레거시 추가 confirm 표시', { emptyKind });
      setAddConfirm({ forceKind: emptyKind });
      return;
    }

    if (!slotsFull) {
      if (guardStarShortage()) return;
      if (__DEV__) console.info('[MyArtists] 아티스트 추가 confirm 표시', { slots, characterCost });
      setAddConfirm({});
      return;
    }
    // 슬롯 가득 → ⭐로 슬롯 확장 제안
    setSlotConfirmVisible(true);
  };

  // v3.105: 추가 confirm 확정 → 입력 시작 (입력 화면 진입 후에는 재확인 팝업 없음)
  const performAddEntry = () => {
    const params = addConfirm;
    setAddConfirm(null);
    if (!params) return;
    if (__DEV__) console.info('[MyArtists] 아티스트 추가 진입', params);
    if (params.forceKind) navigation.navigate('ArtistInput', { forceKind: params.forceKind });
    else navigation.navigate('ArtistInput');
  };

  // 슬롯 확장 확정 → POST /points/spend {action:'extra_slot'} → 성공 시 생성 진입
  const performSlotPurchase = async () => {
    setSlotConfirmVisible(false);
    if (spending) return;
    setSpending(true);
    if (__DEV__) console.info('[MyArtists] extra_slot 과금 요청', { cost: extraSlotCost, slots });
    try {
      const res = await spendExtraSlot();
      usePointsStore.getState().fetchBalance();
      // v216: 응답 max_slots = 영구 확장된 최대 슬롯
      if (typeof res.max_slots === 'number') {
        setSlots((prev) => ({ ...prev, max: res.max_slots! }));
      } else {
        setSlots((prev) => ({ ...prev, max: prev.max + 1 }));
      }
      if (__DEV__) console.info('[MyArtists] extra_slot 과금 성공 → ArtistInput 진입', { max_slots: res.max_slots });
      navigation.navigate('ArtistInput');
    } catch (err: any) {
      const status = err?.response?.status;
      console.error('[MyArtists] extra_slot 과금 실패', { status, message: err?.message });
      if (status === 402) {
        showAlert('스타가 부족해요', `아티스트 슬롯 확장에는 ⭐${extraSlotCost}가 필요해요. 출석체크·앱 추천으로 스타를 모아보세요.`);
      } else {
        showAlert('오류', err?.response?.data?.error || '슬롯 확장에 실패했어요. 잠시 후 다시 시도해주세요.');
      }
    } finally {
      setSpending(false);
    }
  };

  const legacyFull = isLegacy
    && artists.some((a) => a.kind === 'real') && artists.some((a) => a.kind === 'virtual');
  const addLabel = loading
    ? '＋ 아티스트 추가'
    : artists.length === 0 && slots.used === 0
      ? '＋ 첫 아티스트 만들기 (무료)'
      : !isLegacy && slotsFull
        ? `＋ 아티스트 추가 (⭐${extraSlotCost})`
        : '＋ 아티스트 추가';

  // 카드 목소리 상태 문구 — persona_status 'missing'이면 미연결 표시 + 재연결 유도(상세에서)
  const voiceLabelOf = (a: ArtistEntry): string | null => {
    if (a.characterId === null) return null; // 레거시 카드 — 서버 연결 정보 없음
    if (a.personaId && a.personaStatus === 'missing') return '목소리 연결 끊김';
    if (a.personaName) return `목소리 · ${a.personaName}`;
    return '목소리 미연결';
  };

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

          {artists.map((a) => {
            const voiceLabel = voiceLabelOf(a);
            const displayName = a.name
              || (a.slot ? profiles[a.slot]?.name : undefined)
              || '이름 없는 아티스트';
            const displayGender = a.gender || (a.slot ? profiles[a.slot]?.gender : null) || null;
            return (
              <TouchableOpacity
                key={a.characterId ?? `legacy-${a.slot}`}
                style={styles.card}
                onPress={() => handleOpenArtist(a)}
                activeOpacity={0.8}
              >
                <Image source={{ uri: a.sheetUrl }} style={styles.cardImg} />
                <View style={styles.cardBody}>
                  <View style={styles.cardNameRow}>
                    <AppText style={styles.cardName} numberOfLines={1}>
                      {displayGender ? `${displayName} · ${displayGender}` : displayName}
                    </AppText>
                    {a.isDefault && (
                      <View style={styles.defaultBadge}>
                        <AppText style={styles.defaultBadgeText}>대표</AppText>
                      </View>
                    )}
                  </View>
                  {voiceLabel && (
                    <AppText
                      style={[
                        styles.cardVoice,
                        a.personaId && a.personaStatus === 'missing' && styles.cardVoiceWarn,
                      ]}
                      numberOfLines={1}
                    >
                      {voiceLabel}
                    </AppText>
                  )}
                </View>
                <AppText style={styles.cardChevron}>›</AppText>
              </TouchableOpacity>
            );
          })}

          {/* ＋ 아티스트 추가 */}
          <TouchableOpacity
            style={[
              styles.addCard,
              artists.length === 0 && styles.addCardEmphasis,
              (spending || legacyFull) && styles.addCardDisabled,
            ]}
            onPress={handleAdd}
            disabled={spending}
            activeOpacity={legacyFull ? 1 : 0.7}
          >
            {spending ? (
              <ActivityIndicator size="small" color={colors.accent.primary} />
            ) : (
              <AppText
                style={[
                  styles.addCardText,
                  artists.length === 0 && styles.addCardTextEmphasis,
                  legacyFull && styles.addCardTextDisabled,
                ]}
              >
                {addLabel}
              </AppText>
            )}
          </TouchableOpacity>
          {!isLegacy && slotsFull && artists.length > 0 && (
            <AppText style={styles.fullHint}>
              슬롯이 가득 찼어요 ({slots.used}/{slots.max}). ⭐{extraSlotCost}로 슬롯을 영구 확장할 수 있어요.
            </AppText>
          )}
          {legacyFull && (
            <AppText style={styles.fullHint}>
              지금은 최대 2명까지 만들 수 있어요.
            </AppText>
          )}
        </ScrollView>
      )}

      {/* v3.105: [＋추가] 진입 confirm — 생성 ⭐ 소모를 입력 시작 전에 고지 */}
      <ConfirmDialog
        visible={addConfirm !== null}
        title="새 아티스트 추가"
        message={`새 아티스트를 추가하시겠어요?\n생성 시 ⭐${characterCost}이 소모돼요.${balance != null ? ` (현재 보유: ⭐${balance})` : ''}`}
        confirmText="추가하기"
        onConfirm={performAddEntry}
        onCancel={() => setAddConfirm(null)}
      />

      {/* 슬롯 확장 과금 confirm — 앱 내 다이얼로그 */}
      <ConfirmDialog
        visible={slotConfirmVisible}
        title="아티스트 슬롯 확장"
        message={`슬롯이 가득 찼어요 (${slots.used}/${slots.max}).\n⭐${extraSlotCost}를 사용해 슬롯을 1개 영구 확장할까요?\n확장 후 생성 시 ⭐${characterCost}는 별도로 소모돼요.`}
        confirmText={`⭐${extraSlotCost} 사용하기`}
        onConfirm={performSlotPurchase}
        onCancel={() => setSlotConfirmVisible(false)}
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
  cardNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardName: { color: colors.text.primary, fontSize: 15, fontWeight: '700', flexShrink: 1 },
  defaultBadge: {
    backgroundColor: colors.accent.primary, borderRadius: 8,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  defaultBadgeText: { color: colors.text.primary, fontSize: 10, fontWeight: '700' },
  cardVoice: { color: colors.text.muted, fontSize: 11, marginTop: 4 },
  cardVoiceWarn: { color: '#cc8844', fontWeight: '600' },
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
