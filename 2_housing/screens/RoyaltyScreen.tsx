import { StyleSheet, View, Text, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRoyaltyStore } from '../stores/royaltyStore';
import { useFanSimulationStore } from '../stores/fanSimulationStore';
import { useArtistStore } from '../stores/artistStore';
import {
  MIN_PAYOUT_KRW,
  PAYOUT_FEE_KRW,
  TRACK_PRICE_KRW,
  splitRevenue,
  formatKrw,
} from '../data/pricing';
import { colors } from '../theme/colors';

export default function RoyaltyScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { totalEarnedKrw, availableKrw, pendingPayoutKrw, downloadsCount } = useRoyaltyStore();
  const totalSimulatedPlays = useFanSimulationStore((s) => s.totalSimulatedPlays);
  const { totalPlays, songsReleased, level } = useArtistStore();
  const split = splitRevenue(TRACK_PRICE_KRW);

  const canPayout = availableKrw >= MIN_PAYOUT_KRW;

  const handlePayout = () => {
    Alert.alert(
      '출금 신청 (준비 중)',
      `출금은 백엔드 정산 시스템 반영 후 활성화됩니다.\n\n현재 출금 가능 금액: ${formatKrw(availableKrw)}\n최소 출금: ${formatKrw(MIN_PAYOUT_KRW)} / 수수료: ${formatKrw(PAYOUT_FEE_KRW)}`,
      [{ text: '확인' }]
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← 뒤로</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>내 정산</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 16 + insets.bottom }}
      >
        {/* 매출 카드 */}
        <View style={styles.bigCard}>
          <Text style={styles.bigLabel}>누적 매출</Text>
          <Text style={styles.bigValue}>{formatKrw(totalEarnedKrw)}</Text>
          <View style={styles.subRow}>
            <View style={styles.subItem}>
              <Text style={styles.subItemLabel}>출금 가능</Text>
              <Text style={styles.subItemValue}>{formatKrw(availableKrw)}</Text>
            </View>
            <View style={styles.subItem}>
              <Text style={styles.subItemLabel}>출금 진행 중</Text>
              <Text style={styles.subItemValue}>{formatKrw(pendingPayoutKrw)}</Text>
            </View>
            <View style={styles.subItem}>
              <Text style={styles.subItemLabel}>다운로드 수</Text>
              <Text style={styles.subItemValue}>{downloadsCount.toLocaleString()}회</Text>
            </View>
          </View>
          <TouchableOpacity
            style={[styles.payoutBtn, !canPayout && styles.payoutBtnDisabled]}
            onPress={handlePayout}
            disabled={!canPayout}
          >
            <Text style={[styles.payoutText, !canPayout && { color: colors.text.muted }]}>
              {canPayout ? '💸 출금 신청하기' : `최소 ${formatKrw(MIN_PAYOUT_KRW)}부터 출금 가능`}
            </Text>
          </TouchableOpacity>
        </View>

        {/* 가격 분해 */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>곡 1회 다운로드 정산 구조</Text>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>판매가 (부가세 포함)</Text>
            <Text style={styles.rowAmount}>{formatKrw(split.total)}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.rowSub}>· 부가세 (9%)</Text>
            <Text style={styles.rowSubAmount}>{formatKrw(split.vat)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowSub}>· 결제 수수료 (3%)</Text>
            <Text style={styles.rowSubAmount}>{formatKrw(split.pgFee)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowSub}>· 플랫폼 수수료 (22%)</Text>
            <Text style={styles.rowSubAmount}>{formatKrw(split.platformFee)}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: colors.accent.primary }]}>
              🎤 아티스트 받는 금액
            </Text>
            <Text style={[styles.rowAmount, { color: colors.accent.primary }]}>
              {formatKrw(split.creator)}
            </Text>
          </View>
        </View>

        {/* 활동 통계 */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>아티스트 활동</Text>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>레벨</Text>
            <Text style={styles.rowAmount}>Lv.{level}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>발매한 곡</Text>
            <Text style={styles.rowAmount}>{songsReleased}곡</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>총 청취 수</Text>
            <Text style={styles.rowAmount}>{totalPlays.toLocaleString()}회</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowSub}>· 그중 가상 팬덤</Text>
            <Text style={styles.rowSubAmount}>{totalSimulatedPlays.toLocaleString()}회</Text>
          </View>
        </View>

        <Text style={styles.notice}>
          ⓘ 결제·출금은 백엔드 결제 시스템 반영 후 활성화됩니다. 현재는 미리보기 단계입니다.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.deepest },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: colors.bg.surface1,
  },
  backBtn: { paddingVertical: 6, paddingHorizontal: 6, width: 60 },
  backText: { color: colors.text.primary, fontSize: 14, fontWeight: '600' },
  headerTitle: { color: colors.text.primary, fontSize: 16, fontWeight: '800' },

  bigCard: {
    backgroundColor: colors.bg.surface1,
    borderRadius: 16, padding: 18, marginBottom: 16,
    borderWidth: 1.5, borderColor: colors.accent.primary,
  },
  bigLabel: { color: colors.text.secondary, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  bigValue: { color: colors.accent.primaryGlow, fontSize: 32, fontWeight: '900', marginVertical: 8 },
  subRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  subItem: { flex: 1, padding: 8, backgroundColor: colors.bg.surface2, borderRadius: 10, alignItems: 'center' },
  subItemLabel: { color: colors.text.muted, fontSize: 10 },
  subItemValue: { color: colors.text.primary, fontSize: 13, fontWeight: '700', marginTop: 4 },

  payoutBtn: {
    paddingVertical: 13, borderRadius: 12, alignItems: 'center',
    backgroundColor: colors.accent.primary,
  },
  payoutBtnDisabled: { backgroundColor: colors.bg.surface2 },
  payoutText: { color: colors.text.primary, fontSize: 14, fontWeight: '800' },

  card: {
    backgroundColor: colors.bg.surface1,
    borderRadius: 14, padding: 14, marginBottom: 12,
    borderWidth: 1, borderColor: colors.border.subtle,
  },
  cardTitle: { color: colors.text.primary, fontSize: 13, fontWeight: '700', marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  rowLabel: { color: colors.text.primary, fontSize: 13 },
  rowAmount: { color: colors.text.primary, fontSize: 13, fontWeight: '700' },
  rowSub: { color: colors.text.muted, fontSize: 12 },
  rowSubAmount: { color: colors.text.muted, fontSize: 12 },
  divider: { height: 1, backgroundColor: colors.border.subtle, marginVertical: 6 },

  notice: {
    color: colors.text.muted, fontSize: 12, textAlign: 'center',
    marginTop: 12, lineHeight: 18,
  },
});
