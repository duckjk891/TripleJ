// [SocialLoginButtons] 소셜 로그인 3종(구글/카카오/네이버) — MAIDOL SocialLoginButtons 이식.
// 구분선 "또는" + 프로바이더 색상 버튼. SDK 미사용: 백엔드 /auth/oauth/{p}/login 리다이렉트 방식.
// 서버에 OAuth 키가 미설정이면 503 → 서버 안내 문구를 그대로 보여준다(키 설정 시 자동 활성).
import { useState } from 'react';
import { View, TouchableOpacity, ActivityIndicator, StyleSheet, Linking } from 'react-native';
import { showAlert } from '../../utils/appAlert';
import api, { BACKEND_BASE_URL } from '../../services/api';
import { AppText } from '../ui';
import { colors } from '../../theme/colors';
import { spacing, radius } from '../../theme/spacing';

const PROVIDERS = [
  { key: 'google', label: 'Google 로 계속하기', bg: '#ffffff', fg: '#1f1f1f', border: '#dadce0' },
  { key: 'kakao', label: '카카오로 계속하기', bg: '#FEE500', fg: '#191600', border: '#FEE500' },
  { key: 'naver', label: '네이버로 계속하기', bg: '#03C75A', fg: '#ffffff', border: '#03C75A' },
] as const;

export default function SocialLoginButtons({ logPrefix = 'SocialLogin' }: { logPrefix?: string }) {
  const [busy, setBusy] = useState<string | null>(null);

  const handlePress = async (provider: string) => {
    if (busy) return;
    setBusy(provider);
    if (__DEV__) console.info(`[${logPrefix}] 소셜 로그인 시도`, { provider });
    try {
      // 키 미설정이면 503 JSON을 돌려준다 — 이 경우 서버 안내 문구를 표시.
      await api.get(`/auth/oauth/${provider}/login`);
      // 2xx JSON이 오는 경우는 없지만, 도달하면 리다이렉트 방식으로 폴백
      await Linking.openURL(`${BACKEND_BASE_URL}/api/auth/oauth/${provider}/login`);
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 503) {
        const msg = err?.response?.data?.detail || err?.response?.data?.error || '소셜 로그인은 현재 사용할 수 없습니다.';
        console.error(`[${logPrefix}] 소셜 로그인 비활성`, { provider, status });
        showAlert('알림', msg);
      } else {
        // 302 리다이렉트를 axios가 따라가다 CORS 등으로 실패한 케이스 → 전체 페이지 이동으로 진행
        if (__DEV__) console.info(`[${logPrefix}] 리다이렉트 진행`, { provider, status });
        await Linking.openURL(`${BACKEND_BASE_URL}/api/auth/oauth/${provider}/login`).catch((e) =>
          console.error(`[${logPrefix}] 소셜 로그인 이동 실패`, { provider, message: e?.message }));
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.wrap}>
      {/* 구분선 "또는" */}
      <View style={styles.divider}>
        <View style={styles.line} />
        <AppText variant="caption" tone="muted">또는</AppText>
        <View style={styles.line} />
      </View>

      {PROVIDERS.map((p) => (
        <TouchableOpacity
          key={p.key}
          style={[styles.btn, { backgroundColor: p.bg, borderColor: p.border }]}
          onPress={() => handlePress(p.key)}
          disabled={!!busy}
          accessibilityLabel={p.label}
        >
          {busy === p.key
            ? <ActivityIndicator size="small" color={p.fg} />
            : <AppText variant="bodyStrong" style={{ color: p.fg }}>{p.label}</AppText>}
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.lg, gap: spacing.sm },
  divider: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.xs },
  line: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border.subtle },
  btn: {
    height: 46, borderRadius: radius.md, borderWidth: 1,
    justifyContent: 'center', alignItems: 'center',
  },
});
