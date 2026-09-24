// [SocialLoginButtons] 소셜 로그인 2종(구글/카카오) — MAIDOL SocialLoginButtons 이식. (v3.194: 네이버 제거)
// 구분선 "또는" + 프로바이더 색상 버튼. SDK 미사용: 백엔드 /auth/oauth/{p}/login 리다이렉트 방식.
// v3.194: 유해한 프리플라이트 api.get 제거(백엔드 OAuth state 선점/소모 방지) + 네이티브 앱 복귀 경로:
//   웹    → 전체 페이지 이동, 콜백은 App.tsx 해시(#token=) 처리.
//   네이티브 → expo-web-browser openAuthSessionAsync + `aidol://oauth/callback#token=` 딥링크 복귀.
//   백엔드가 client=app 리다이렉트를 지원하기 전에는 콜백이 안 와도 취소/닫힘으로 조용히 복귀(크래시·무한 busy 없음).
//   백엔드 요청 문서: 2_housing/백엔드_요청_소셜로그인_앱복귀.md
import { useState } from 'react';
import { View, TouchableOpacity, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { showAlert } from '../../utils/appAlert';
import { BACKEND_BASE_URL } from '../../services/api';
import { resetToChartTab } from '../../services/navigationRef';
import { useAuthStore } from '../../stores/authStore';
import { AppText } from '../ui';
import { colors } from '../../theme/colors';
import { spacing, radius } from '../../theme/spacing';

const PROVIDERS = [
  { key: 'google', label: 'Google 로 계속하기', bg: '#ffffff', fg: '#1f1f1f', border: '#dadce0' },
  { key: 'kakao', label: '카카오로 계속하기', bg: '#FEE500', fg: '#191600', border: '#FEE500' },
] as const;

// 앱 복귀 딥링크(스킴 aidol 은 app.json 기존재) — 백엔드 요청 문서와 동일해야 한다.
const OAUTH_REDIRECT_URL = 'aidol://oauth/callback';

const GENERIC_FAIL_MSG = '소셜 로그인에 실패했습니다. 잠시 후 다시 시도해주세요.';

// 서버가 내려준 오류 문구는 검증 후에만 그대로 노출 — 문자열이 아니거나(null/객체) 과도하게 길면 고정 문구.
function sanitizeServerMessage(value: unknown): string {
  if (typeof value === 'string' && value.trim().length > 0 && value.length <= 80) return value.trim();
  return GENERIC_FAIL_MSG;
}

export default function SocialLoginButtons({ logPrefix = 'SocialLogin' }: { logPrefix?: string }) {
  const [busy, setBusy] = useState<string | null>(null);

  const handlePress = async (provider: string) => {
    if (busy) return;
    setBusy(provider);
    if (__DEV__) console.info(`[${logPrefix}] 소셜 로그인 시도`, { provider, platform: Platform.OS });
    const loginUrl = `${BACKEND_BASE_URL}/api/auth/oauth/${provider}/login`;
    try {
      if (Platform.OS === 'web') {
        // v3.216 ①: 같은 탭 전체 페이지 이동(location.assign). Linking.openURL은 react-native-web에서
        // `_blank` 새 탭을 열어 원 탭이 비로그인으로 잔류하고 탭 간 토큰 전달 장치가 없었다.
        // 콜백(#token=)은 App.tsx useOAuthCallback(웹 해시)이 처리.
        try {
          // v3.224: PC 래퍼(app-shell)는 앱을 iframe 으로 띄운다 — 프레임 안에서 이동하면 구글·카카오가
          // 프레이밍을 거부(403/X-Frame-Options)한다. 최상위 창(동일 출처라 접근 가능)을 이동시키고,
          // 콜백(/oauth/callback#token=)은 래퍼가 다시 iframe 으로 토큰을 넘긴다.
          const w = (globalThis as any).window;
          let target = w;
          try {
            if (w.top && w.top !== w.self) target = w.top;
          } catch {
            target = w; // 교차 출처 top 접근 불가 시 현행 동작
          }
          if (__DEV__) console.info(`[${logPrefix}] 웹 로그인 이동`, { inFrame: target !== w });
          target.location.assign(loginUrl);
        } catch (e: any) {
          console.error(`[${logPrefix}] 소셜 로그인 이동 실패`, { provider, message: e?.message });
          showAlert('알림', '로그인 페이지를 열 수 없습니다. 잠시 후 다시 시도해주세요.');
        }
        return;
      }

      // 네이티브 — 인증 세션 브라우저를 열고 aidol://oauth/callback 복귀를 기다린다.
      // 백엔드 미지원(콜백 미수신) 시 사용자가 브라우저를 닫으면 dismiss 로 복귀 — 조용히 종료.
      const result = await WebBrowser.openAuthSessionAsync(`${loginUrl}?client=app`, OAUTH_REDIRECT_URL);
      if (result?.type === 'success' && result.url) {
        // 토큰 값은 로그 금지 — 수신 여부만 기록한다.
        const tokenMatch = result.url.match(/[#&?]token=([^&]+)/);
        if (__DEV__) console.info(`[${logPrefix}] 콜백 수신`, { provider, hasToken: !!tokenMatch });
        if (tokenMatch) {
          const ok = await useAuthStore.getState().loginWithToken(decodeURIComponent(tokenMatch[1]));
          if (!ok) {
            console.error(`[${logPrefix}] 콜백 토큰 세션 열기 실패`, { provider });
            showAlert('알림', GENERIC_FAIL_MSG);
          } else {
            // v3.216b F1: 로그인 성공 = 항상 차트 탭 착지 (App.tsx 딥링크 경로와 중복 호출돼도 멱등)
            resetToChartTab();
          }
        } else {
          // 콜백은 왔지만 토큰이 없음 — 서버 error 파라미터는 검증 후에만 노출.
          const errMatch = result.url.match(/[#&?](?:error|detail)=([^&]+)/);
          let serverMsg: string | null = null;
          try { serverMsg = errMatch ? decodeURIComponent(errMatch[1]) : null; } catch { serverMsg = null; }
          console.error(`[${logPrefix}] 콜백에 토큰 없음`, { provider, hasError: !!errMatch });
          showAlert('알림', sanitizeServerMessage(serverMsg));
        }
      } else {
        // cancel/dismiss — 사용자가 닫았거나 백엔드 앱 복귀 미지원. 에러 alert 없이 조용히 복귀.
        if (__DEV__) console.info(`[${logPrefix}] 콜백 미수신(취소/닫힘)`, { provider, type: result?.type });
      }
    } catch (err: any) {
      console.error(`[${logPrefix}] 소셜 로그인 실패`, { provider, message: err?.message });
      showAlert('알림', '로그인 페이지를 열 수 없습니다. 잠시 후 다시 시도해주세요.');
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
