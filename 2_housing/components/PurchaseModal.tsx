import { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TRACK_PRICE_KRW, splitRevenue, splitPlatformFee, formatKrw } from '../data/pricing';
import { colors } from '../theme/colors';

interface Props {
  visible: boolean;
  trackTitle: string;
  trackArtist?: string;
  onClose: () => void;
  onPurchase: () => void;   // 결제 완료 콜백 (백엔드 반영 후)
}

export default function PurchaseModal({ visible, trackTitle, trackArtist, onClose, onPurchase }: Props) {
  const insets = useSafeAreaInsets();
  const [licenseAgreed, setLicenseAgreed] = useState(false);
  const split = splitRevenue(TRACK_PRICE_KRW);

  const handlePay = () => {
    if (!licenseAgreed) {
      Alert.alert('알림', '라이선스 약관에 동의해주세요.');
      return;
    }
    // mock — 백엔드 결제 시스템 반영 후 실제 토스페이먼츠 호출로 교체
    Alert.alert(
      '결제 시스템 준비 중',
      `다운로드 결제 기능은 백엔드 결제 인프라 반영 후 활성화됩니다.\n\n(예정 가격: ${formatKrw(TRACK_PRICE_KRW)} / Creator 받는 금액 ${formatKrw(split.creator)})`,
      [{ text: '확인', onPress: () => { onClose(); } }]
    );
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.box, { paddingBottom: 16 + insets.bottom }]}>
          <Text style={styles.title}>💿 다운로드 구매</Text>
          <Text style={styles.trackName} numberOfLines={1}>
            {trackTitle}
          </Text>
          {trackArtist ? (
            <Text style={styles.trackArtist} numberOfLines={1}>
              by {trackArtist}
            </Text>
          ) : null}

          <View style={styles.priceCard}>
            <View style={styles.row}>
              <Text style={styles.label}>가격 (부가세 포함)</Text>
              <Text style={styles.amount}>{formatKrw(split.total)}</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.row}>
              <Text style={styles.subLabel}>· 부가세</Text>
              <Text style={styles.subAmount}>{formatKrw(split.vat)}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.subLabel}>· 결제 수수료</Text>
              <Text style={styles.subAmount}>{formatKrw(split.pgFee)}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.subLabel}>· 플랫폼 수수료 (디렉터 보상)</Text>
              <Text style={styles.subAmount}>{formatKrw(split.platformFee)}</Text>
            </View>
            {splitPlatformFee(split.platformFee).map((d) => (
              <View key={d.key} style={styles.row}>
                <Text style={styles.deepSubLabel}>   ↳ {d.emoji} {d.label}</Text>
                <Text style={styles.deepSubAmount}>{formatKrw(d.amount)}</Text>
              </View>
            ))}
            <View style={styles.divider} />
            <View style={styles.row}>
              <Text style={styles.creatorLabel}>🎤 아티스트에게 가는 금액</Text>
              <Text style={styles.creatorAmount}>{formatKrw(split.creator)}</Text>
            </View>
          </View>

          <TouchableOpacity
            style={styles.licenseRow}
            onPress={() => setLicenseAgreed(!licenseAgreed)}
            activeOpacity={0.7}
          >
            <View style={[styles.checkbox, licenseAgreed && styles.checkboxChecked]}>
              {licenseAgreed && <Text style={styles.checkboxMark}>✓</Text>}
            </View>
            <Text style={styles.licenseText}>
              <Text style={{ fontWeight: '700' }}>개인용 라이선스</Text>에 동의합니다.{'\n'}
              <Text style={{ color: colors.text.muted, fontSize: 11 }}>
                본인 청취·소장 한정. 상업적 이용·재배포는 불가합니다.
              </Text>
            </Text>
          </TouchableOpacity>

          <View style={styles.btnRow}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelText}>취소</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.payBtn, !licenseAgreed && { opacity: 0.4 }]}
              onPress={handlePay}
              disabled={!licenseAgreed}
            >
              <Text style={styles.payText}>{formatKrw(split.total)} 결제하기</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  box: {
    backgroundColor: colors.bg.deepest,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    borderTopWidth: 1.5,
    borderTopColor: colors.accent.primary,
  },
  title: { color: colors.text.primary, fontSize: 18, fontWeight: '800', marginBottom: 12 },
  trackName: { color: colors.text.primary, fontSize: 15, fontWeight: '700' },
  trackArtist: { color: colors.text.secondary, fontSize: 13, marginTop: 2, marginBottom: 16 },
  priceCard: {
    backgroundColor: colors.bg.surface1,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    marginBottom: 14,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  label: { color: colors.text.primary, fontSize: 14, fontWeight: '700' },
  amount: { color: colors.text.primary, fontSize: 14, fontWeight: '700' },
  subLabel: { color: colors.text.muted, fontSize: 12 },
  subAmount: { color: colors.text.muted, fontSize: 12 },
  deepSubLabel: { color: colors.text.muted, fontSize: 11, fontStyle: 'italic' },
  deepSubAmount: { color: colors.text.muted, fontSize: 11, fontStyle: 'italic' },
  creatorLabel: { color: colors.accent.primary, fontSize: 13, fontWeight: '700' },
  creatorAmount: { color: colors.accent.primary, fontSize: 14, fontWeight: '800' },
  divider: { height: 1, backgroundColor: colors.border.subtle, marginVertical: 6 },

  licenseRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16 },
  checkbox: {
    width: 22, height: 22, borderRadius: 6,
    borderWidth: 1.5, borderColor: colors.border.subtle,
    marginRight: 10, marginTop: 1,
    justifyContent: 'center', alignItems: 'center',
  },
  checkboxChecked: {
    backgroundColor: colors.accent.primary, borderColor: colors.accent.primary,
  },
  checkboxMark: { color: colors.text.primary, fontWeight: '800' },
  licenseText: { flex: 1, color: colors.text.primary, fontSize: 13, lineHeight: 19 },

  btnRow: { flexDirection: 'row', gap: 8 },
  cancelBtn: {
    flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center',
    backgroundColor: colors.bg.surface2, borderWidth: 1, borderColor: colors.border.subtle,
  },
  cancelText: { color: colors.text.secondary, fontSize: 13, fontWeight: '700' },
  payBtn: {
    flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center',
    backgroundColor: colors.accent.primary,
  },
  payText: { color: colors.text.primary, fontSize: 13, fontWeight: '800' },
});
