// v3.360 [PhotoConsent] 얼굴 사진 AI 처리 동의 화면 — utils/photoConsent.ensurePhotoAiConsent() 가 연다(App 루트 1개).
import { Modal, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { AppText } from '../ui';
import { colors } from '../../theme/colors';
import { CONSENTS } from '../../constants/consentTexts';
import { usePhotoConsentStore } from '../../utils/photoConsent';
import { openPolicyPage } from '../../utils/policyLinks';

export default function PhotoConsentHost() {
  const visible = usePhotoConsentStore((s) => s.visible);
  const resolve = usePhotoConsentStore((s) => s.resolve);
  const c = (CONSENTS as any).photo_ai;
  const answer = (ok: boolean) => resolve?.(ok);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => answer(false)}>
      <View style={styles.overlay}>
        <View style={styles.box}>
          <AppText style={styles.title}>{c.label}</AppText>
          <ScrollView style={styles.body}>
            <AppText style={styles.text}>{c.body}</AppText>
            <TouchableOpacity onPress={() => void openPolicyPage('privacy')} accessibilityLabel="개인정보 처리방침 보기">
              <AppText style={styles.link}>개인정보 처리방침 보기</AppText>
            </TouchableOpacity>
          </ScrollView>
          <View style={styles.btnRow}>
            <TouchableOpacity style={[styles.btn, styles.btnCancel]} onPress={() => answer(false)}>
              <AppText style={styles.btnCancelText}>동의하지 않음</AppText>
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
  box: { width: '100%', maxHeight: '86%', backgroundColor: colors.bg.surface1, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: colors.border.subtle },
  title: { fontSize: 18, fontWeight: '700', color: colors.text.primary, marginBottom: 12, textAlign: 'center' },
  body: { flexGrow: 0 },
  text: { fontSize: 13, color: colors.text.secondary, lineHeight: 20 },
  link: { fontSize: 13, color: colors.accent.primary, marginTop: 12, textDecorationLine: 'underline' },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  btn: { flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  btnCancel: { backgroundColor: colors.bg.surface2, borderWidth: 1, borderColor: colors.border.subtle },
  btnCancelText: { color: colors.text.secondary, fontSize: 15, fontWeight: '600' },
  btnOk: { backgroundColor: colors.accent.primary },
  btnOkText: { color: colors.text.primary, fontSize: 15, fontWeight: '700' },
});
