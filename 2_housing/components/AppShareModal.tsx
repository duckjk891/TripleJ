// [AppShareModal] 앱 추천(초대) — MAIDOL AppShareModal 이식.
// 추천코드 표시 + 복사(📋) + 공유 4종(카카오톡/인스타그램/페이스북/링크복사).
// 백엔드 계약: GET /referral/my-code → {referral_code, invite_url:"/invite/{code}"}
import { useState, useEffect } from 'react';
import { Modal, View, TouchableOpacity, ActivityIndicator, Share, StyleSheet } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import api, { BACKEND_BASE_URL } from '../services/api';
import { useUiStore } from '../stores/uiStore';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { AppText, Button } from './ui';

// 공유 타깃 라벨 — MAIDOL과 동일 구성. RN에서는 세 소셜 모두 네이티브 공유 시트로 위임.
const SHARE_BUTTONS: { key: string; label: string }[] = [
  { key: 'kakao', label: '💬 카카오톡' },
  { key: 'instagram', label: '📸 인스타그램' },
  { key: 'facebook', label: '📘 페이스북' },
];

export default function AppShareModal() {
  const open = useUiStore((s) => s.inviteOpen);
  const close = useUiStore((s) => s.closeInvite);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPhase('loading'); setMessage('');
    (async () => {
      if (__DEV__) console.info('[AppShareModal] load my referral code');
      try {
        const { data } = await api.get('/referral/my-code');
        if (cancelled) return;
        if (__DEV__) console.info('[AppShareModal] code loaded', { code: data?.referral_code });
        setCode(data?.referral_code || '');
        setPhase('ready');
      } catch (err: any) {
        if (cancelled) return;
        console.error('[AppShareModal] my-code 실패', { status: err?.response?.status });
        setPhase('error');
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  const inviteUrl = code ? `${BACKEND_BASE_URL}/invite/${code}` : '';
  // v160 — URL 중복 방지: 네이티브 시트엔 base 메시지, 복사엔 URL 포함 full.
  // v3.58 — 베타 이벤트 문구 삽입(공유 메시지에 이벤트가 함께 전달되도록)
  const shareTextBase = `AIDOL — AI가 만든 음악의 새로운 세계 🎵\n🎁 베타 테스트 기간 가입 시 스타 50 추가 증정!\n추천코드: ${code}`;
  const shareTextFull = `${shareTextBase}\n${inviteUrl}`;

  const showMsg = (m: string) => { setMessage(m); setTimeout(() => setMessage(''), 4000); };

  const handleCopyCode = async () => {
    try { await Clipboard.setStringAsync(code); if (__DEV__) console.info('[AppShareModal] copy code'); showMsg('복사 완료!'); }
    catch { showMsg('복사에 실패했습니다.'); }
  };
  const handleCopyLink = async () => {
    try { await Clipboard.setStringAsync(shareTextFull); if (__DEV__) console.info('[AppShareModal] copy link'); showMsg('초대 링크가 복사되었습니다.'); }
    catch { showMsg('복사에 실패했습니다.'); }
  };
  const handleShare = async (target: string) => {
    if (__DEV__) console.info('[AppShareModal] native share', { target });
    try {
      await Share.share({ message: shareTextFull });
    } catch (err: any) {
      console.error('[AppShareModal] share 실패', { target, message: err?.message });
      showMsg('공유에 실패했습니다. 링크 복사를 이용해주세요.');
    }
  };

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={close}>
        <TouchableOpacity style={styles.modal} activeOpacity={1} onPress={() => {}}>
          <View style={styles.head}>
            <AppText variant="title2">📢 AIDOL 추천하기</AppText>
            <TouchableOpacity onPress={close} accessibilityLabel="닫기">
              <AppText variant="title3" tone="muted">✕</AppText>
            </TouchableOpacity>
          </View>

          {phase === 'loading' ? (
            <View style={styles.state}><ActivityIndicator color={colors.accent.primary} /></View>
          ) : phase === 'error' ? (
            <AppText tone="secondary" center style={styles.state}>추천코드를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.</AppText>
          ) : (
            <>
              <AppText variant="footnote" tone="secondary" center style={styles.desc}>
                친구가 내 추천코드로 가입하면 두 사람 모두 스타 50을 받아요!{'\n'}🎁 베타 테스트 기간엔 가입만 해도 스타 50 추가 증정!
              </AppText>

              <View style={styles.codeBox}>
                <AppText variant="headline" tone="accent">{code || '—'}</AppText>
                <TouchableOpacity onPress={handleCopyCode} accessibilityLabel="추천코드 복사" style={styles.copyBtn}>
                  <AppText variant="footnote" tone="accent">📋 복사</AppText>
                </TouchableOpacity>
              </View>

              <View style={styles.buttons}>
                {SHARE_BUTTONS.map((b) => (
                  <View key={b.key} style={styles.btnCell}>
                    <Button label={b.label} variant="tonal" fullWidth onPress={() => handleShare(b.key)} />
                  </View>
                ))}
                <View style={styles.btnCell}>
                  <Button label="🔗 링크 복사" variant="tonal" fullWidth onPress={handleCopyLink} />
                </View>
              </View>

              {message ? <AppText variant="caption" tone="accent" center style={styles.msg}>{message}</AppText> : null}
            </>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  modal: { width: '100%', maxWidth: 360, backgroundColor: colors.bg.surface1, borderRadius: radius.xxl, padding: spacing.xl },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg },
  state: { paddingVertical: spacing.xxl, textAlign: 'center' },
  desc: { marginBottom: spacing.md },
  codeBox: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.bg.deepest, borderRadius: radius.lg, borderWidth: 1,
    borderColor: colors.border.accent, paddingVertical: spacing.md, paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
  },
  copyBtn: { paddingVertical: spacing.xs, paddingHorizontal: spacing.sm },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  btnCell: { width: '48%' },
  msg: { marginTop: spacing.md },
});
