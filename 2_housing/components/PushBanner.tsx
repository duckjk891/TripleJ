// v3.298 [WebPush] 알림함 상단 '푸시 켜기' 배너 — 웹(지원 브라우저·아이폰 홈 화면 앱)에서 미구독일 때만. 닫으면 다시 안 보임.
import { useEffect, useState } from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { AppText } from './ui';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { webPushSupport, isWebPushEnabled } from '../services/pushService';
import { turnOnPushWithFeedback, PUSH_IOS_GUIDE } from './PushToggleRow';

const DISMISS_KEY = 'maidol-push-banner-dismissed-v1';

function dismissed(): boolean {
  try { return typeof window !== 'undefined' && window.localStorage?.getItem(DISMISS_KEY) === '1'; } catch { return false; }
}

export default function PushBanner() {
  const [show, setShow] = useState(false);
  const support = webPushSupport();
  useEffect(() => {
    if (support === 'native' || support === 'unsupported' || dismissed()) return;
    if (support === 'ios_needs_install') { setShow(true); return; }
    isWebPushEnabled().then((on) => setShow(!on)).catch(() => setShow(false));
  }, [support]);
  if (!show) return null;
  const close = () => {
    try { window.localStorage?.setItem(DISMISS_KEY, '1'); } catch { /* 저장 불가 환경 — 이번 화면만 숨김 */ }
    setShow(false);
  };
  return (
    <View style={styles.banner}>
      <Feather name="bell" size={16} color={colors.accent.primary} />
      <AppText variant="caption" tone="secondary" style={{ flex: 1 }}>
        {support === 'ios_needs_install' ? PUSH_IOS_GUIDE : '앱이 꺼져 있어도 댓글·좋아요·팔로우 알림을 받아보세요.'}
      </AppText>
      {support === 'supported' ? (
        <TouchableOpacity
          style={styles.btn}
          onPress={async () => { if (await turnOnPushWithFeedback()) setShow(false); }}
          accessibilityLabel="푸시 알림 켜기"
        >
          <AppText variant="caption" style={{ color: '#fff', fontWeight: '700' }}>켜기</AppText>
        </TouchableOpacity>
      ) : null}
      <TouchableOpacity onPress={close} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityLabel="푸시 안내 닫기">
        <Feather name="x" size={16} color={colors.text.muted} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    margin: spacing.md, padding: spacing.md, borderRadius: radius.lg,
    backgroundColor: colors.bg.surface1, borderWidth: 1, borderColor: colors.border.subtle,
  },
  btn: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.accent.primary },
});
