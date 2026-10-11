// v3.340 [PolicyReconsent] 개인정보 처리방침 개정(2026-10-11 — 국외 이전 협력사 추가 등) 재동의 팝업.
// 대표 결정(10-11): 공지 + 앱 재동의 팝업. 로그인한 회원 중 '국외 이전 동의' 판이 최신(CONSENT_VERSION)이 아니면 표시.
//  · [동의하기] → POST /auth/me/consents privacy·overseas(최신 판) — 다시 뜨지 않음
//  · [나중에] → 이 계정은 하루 동안 다시 묻지 않음(기기 저장). 시행일 이후 미동의자 제한은 별도 결정.
//  · 어린이 계정은 띄우지 않음(법정대리인 대상 — 보호자 안내로 대체). 가입 마무리(SignupCompleteGate)가 떠 있으면 그쪽이 우선.
import { useEffect, useState } from 'react';
import { Modal, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppText } from '../ui';
import { colors } from '../../theme/colors';
import { useAuthStore } from '../../stores/authStore';
import { useIsChild } from '../../utils/kidsMode';
import { CONSENT_VERSION } from '../../constants/consentTexts';
import { getMyConsents, recordConsents } from '../../services/authService';
import { getOnboardingStatus } from '../../services/identityService';
import { openPolicyPage } from '../../utils/policyLinks';
import { showAlert } from '../../utils/appAlert';

export const POLICY_EFFECTIVE_DATE = '2026-10-18';
const SNOOZE_MS = 24 * 60 * 60 * 1000;
const snoozeKey = (uid: string) => `policy_reconsent_snooze:${CONSENT_VERSION}:${uid}`;

export const POLICY_CHANGE_LINES = [
  'AI 생성 협력사에 Anthropic(가사·번역 등 글 생성)을 추가했어요.',
  'Wondera 이용 목적에 작곡을 추가했어요.',
  '앱 알림을 보내는 협력사(Expo)를 추가했고, 알림을 허용하면 알림 토큰을 수집해요.',
  '문의 이메일이 maidol_official@lotusai.co.kr 로 바뀌었어요.',
];

/** 최신 판 동의 필요 여부(순수) — 국외 이전 동의 판이 다르거나 없으면 true */
export function needsReconsent(consents: Record<string, { agreed?: boolean; version?: string } | undefined>, current = CONSENT_VERSION): boolean {
  const o = consents?.overseas;
  return !(o?.agreed && o?.version === current);
}

export default function PolicyReconsentGate() {
  const uid = useAuthStore((s) => (s.user?.id != null ? String(s.user.id) : ''));
  const isChild = useIsChild();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setVisible(false);
    if (!uid || isChild) return;
    (async () => {
      try {
        const snooze = Number((await AsyncStorage.getItem(snoozeKey(uid))) || 0);
        if (snooze && Date.now() - snooze < SNOOZE_MS) return;
        // 가입 마무리 화면이 뜨는 계정은 그쪽에서 동의를 받는다(중복 팝업 방지)
        const ob = await getOnboardingStatus();
        if (ob?.required) return;
        const consents = await getMyConsents();
        if (alive && needsReconsent(consents as any)) {
          console.info('[PolicyReconsent] 재동의 필요', { version: CONSENT_VERSION, had: (consents as any)?.overseas?.version ?? null });
          setVisible(true);
        }
      } catch (err: any) {
        console.warn('[PolicyReconsent] 조회 실패 — 다음 진입 때 다시 확인', { status: err?.response?.status });
      }
    })();
    return () => { alive = false; };
  }, [uid, isChild]);

  if (!visible) return null;

  const agree = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await recordConsents([{ key: 'privacy', agreed: true }, { key: 'overseas', agreed: true }], CONSENT_VERSION);
      console.info('[PolicyReconsent] 동의 기록', { version: CONSENT_VERSION });
      setVisible(false);
    } catch (err: any) {
      console.error('[PolicyReconsent] 동의 기록 실패', { status: err?.response?.status });
      showAlert('알림', '동의를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  const later = async () => {
    console.info('[PolicyReconsent] 나중에');
    try { await AsyncStorage.setItem(snoozeKey(uid), String(Date.now())); } catch { /* 저장 실패 = 다음 실행 때 다시 표시 */ }
    setVisible(false);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={later}>
      <View style={styles.overlay}>
        <View style={styles.box}>
          <AppText style={styles.title}>개인정보 처리방침이 바뀌어요</AppText>
          <ScrollView style={{ flexGrow: 0 }}>
            <AppText style={styles.lead}>{POLICY_EFFECTIVE_DATE} 부터 아래 내용이 적용돼요. 계속 이용하려면 바뀐 내용에 동의해 주세요.</AppText>
            {POLICY_CHANGE_LINES.map((l) => (
              <AppText key={l} style={styles.line}>· {l}</AppText>
            ))}
            <TouchableOpacity onPress={() => void openPolicyPage('privacy')} accessibilityLabel="개인정보 처리방침 전문 보기">
              <AppText style={styles.link}>개인정보 처리방침 전문 보기</AppText>
            </TouchableOpacity>
          </ScrollView>
          <View style={styles.btnRow}>
            <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={later} disabled={busy}>
              <AppText style={styles.btnGhostText}>나중에</AppText>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.btnOk, busy && { opacity: 0.6 }]} onPress={agree} disabled={busy}>
              <AppText style={styles.btnOkText}>동의하기</AppText>
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
