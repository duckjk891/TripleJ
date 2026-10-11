// v3.341 [PolicyConsentGate] 디렉터 진입 시 처리방침 동의 팝업(필수) — utils/policyConsent.ensurePolicyConsent 가 연다.
import { Modal, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { AppText } from '../ui';
import { colors } from '../../theme/colors';
import { usePolicyConsentStore } from '../../utils/policyConsent';
import { openPolicyPage } from '../../utils/policyLinks';
import { POLICY_CHANGE_LINES, POLICY_EFFECTIVE_DATE } from './PolicyReconsentGate';

export default function PolicyConsentHost() {
  const visible = usePolicyConsentStore((s) => s.visible);
  const resolve = usePolicyConsentStore((s) => s.resolve);
  const answer = (ok: boolean) => resolve?.(ok);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => answer(false)}>
      <View style={styles.overlay}>
        <View style={styles.box}>
          <AppText style={styles.title}>개인정보 처리방침 동의가 필요해요</AppText>
          <ScrollView style={{ flexGrow: 0 }}>
            <AppText style={styles.lead}>
              디렉터는 모두 AI 로 작업해요. 바뀐 개인정보 처리방침({POLICY_EFFECTIVE_DATE} 시행)에 동의해야 작업을 이어갈 수 있어요.
            </AppText>
            {POLICY_CHANGE_LINES.map((l) => (
              <AppText key={l} style={styles.line}>· {l}</AppText>
            ))}
            <TouchableOpacity onPress={() => void openPolicyPage('privacy')} accessibilityLabel="개인정보 처리방침 전문 보기">
              <AppText style={styles.link}>개인정보 처리방침 전문 보기</AppText>
            </TouchableOpacity>
          </ScrollView>
          <View style={styles.btnRow}>
            <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={() => answer(false)}>
              <AppText style={styles.btnGhostText}>동의하지 않음</AppText>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.btnOk]} onPress={() => answer(true)}>
              <AppText style={styles.btnOkText}>동의하고 계속</AppText>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(13, 8, 32, 0.85)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20 },
  box: { width: '100%', maxWidth: 440, maxHeight: '86%', backgroundColor: colors.bg.surface1, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: colors.border.subtle },
  title: { fontSize: 18, fontWeight: '700', color: colors.text.primary, marginBottom: 12, textAlign: 'center' },
  lead: { fontSize: 13, color: colors.text.secondary, lineHeight: 20, marginBottom: 10 },
  line: { fontSize: 13, color: colors.text.primary, lineHeight: 20, marginBottom: 4 },
  link: { fontSize: 13, color: colors.accent.primary, marginTop: 10, textDecorationLine: 'underline' },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  btn: { flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  btnGhost: { backgroundColor: colors.bg.surface2, borderWidth: 1, borderColor: colors.border.subtle },
  btnGhostText: { color: colors.text.secondary, fontSize: 15, fontWeight: '600' },
  btnOk: { backgroundColor: colors.accent.primary },
  btnOkText: { color: colors.text.primary, fontSize: 15, fontWeight: '700' },
});
