// [InApp] 인앱 브라우저 안내 배너 — v3.217 ①(b) 웹 전용(네이티브는 즉시 null — 무영향)
// 카카오톡: 진입 즉시 자동 탈출(public/index.html 인라인 스크립트 + 여기 폴백 1회) →
//           1.5s 내 미이탈 시 배너 폴백(재시도 버튼 포함).
// Android 기타 인앱: "Chrome으로 열기"(intent://…;package=com.android.chrome;end) 버튼.
// iOS 기타 인앱: 강제 탈출 불가(WebKit 정책) — 공유→'Safari로 열기' 안내 문구.
// 일반 브라우저: detectInApp() null → 아무것도 렌더하지 않음(무개입).
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from './ui';
import { colors } from '../theme/colors';
import {
  chromeIntentUrl,
  detectInApp,
  InAppKind,
  inlineEscapeTriedAt,
  isAndroidWeb,
  isIOSWeb,
  kakaoOpenExternalUrl,
  tryEscape,
} from '../utils/browserEnv';

export default function InAppEscapeBanner() {
  const insets = useSafeAreaInsets();
  const [kind, setKind] = useState<InAppKind | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const k = detectInApp();
    if (!k) return;
    setKind(k);
    if (__DEV__) console.info('[InApp] 인앱 브라우저 감지', { kind: k });
    if (k === 'kakaotalk') {
      // 인라인 스크립트(index.html)가 이미 시도했으면 재시도 생략 — 여기선 폴백 1회만
      if (inlineEscapeTriedAt() == null) {
        if (__DEV__) console.info('[InApp] 카카오톡 openExternal 자동 시도(번들 폴백)');
        tryEscape(kakaoOpenExternalUrl());
      }
      // 1.5s 내 미이탈(스킴 미지원·차단 등) — 안내 배너 폴백
      const t = setTimeout(() => {
        if (typeof document === 'undefined' || document.visibilityState === 'visible') {
          setVisible(true);
        }
      }, 1500);
      return () => clearTimeout(t);
    }
    setVisible(true);
  }, []);

  if (Platform.OS !== 'web' || !visible || !kind) return null;

  const android = isAndroidWeb();
  const ios = isIOSWeb();
  const canEscape = kind === 'kakaotalk' || android;
  const handleOpenExternal = () => {
    if (kind === 'kakaotalk') {
      tryEscape(kakaoOpenExternalUrl());
    } else if (android) {
      tryEscape(chromeIntentUrl());
    }
  };

  return (
    <View style={[styles.wrap, { top: insets.top + 8 }]} pointerEvents="box-none">
      <View style={styles.banner}>
        <View style={styles.body}>
          <AppText style={styles.title}>외부 브라우저로 열어주세요</AppText>
          <AppText style={styles.desc}>
            {ios && kind !== 'kakaotalk'
              ? '인앱 브라우저에서는 음악 재생이 끊길 수 있어요. 공유 버튼에서 "Safari로 열기"를 눌러주세요.'
              : '인앱 브라우저에서는 음악 재생이 끊길 수 있어요. 외부 브라우저에서 MAIDOL을 이용해주세요.'}
          </AppText>
          {canEscape && (
            <TouchableOpacity
              style={styles.btn}
              onPress={handleOpenExternal}
              accessibilityLabel="외부 브라우저로 열기"
            >
              <AppText style={styles.btnText}>
                {kind === 'kakaotalk' ? '외부 브라우저로 열기' : 'Chrome으로 열기'}
              </AppText>
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity
          onPress={() => setVisible(false)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel="안내 닫기"
        >
          <AppText style={styles.close}>✕</AppText>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 10000,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    width: '100%',
    maxWidth: 480,
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: 14,
    padding: 14,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  body: { flex: 1 },
  title: { color: colors.text.primary, fontSize: 14, fontWeight: '700', marginBottom: 4 },
  desc: { color: colors.text.secondary, fontSize: 12, lineHeight: 18 },
  btn: {
    alignSelf: 'flex-start',
    marginTop: 10,
    backgroundColor: colors.accent.primary,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  btnText: { color: colors.text.primary, fontSize: 13, fontWeight: '700' },
  close: { color: colors.text.muted, fontSize: 16, paddingHorizontal: 2 },
});
