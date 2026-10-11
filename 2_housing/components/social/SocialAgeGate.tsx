// v3.331 [SocialAgeGate] 소셜 화면(피드·커뮤니티·크루·피드 상세) 감싸기 — iOS 13세 미만이면 안내 화면으로 대체.
// 화면에 처음 들어올 때 Apple 나이대(Declared Age Range)를 1회 확인한다(utils/socialAgeGate). Android·웹은 그대로 통과.
import { useEffect } from 'react';
import type { ComponentType } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { EmptyState } from '../ui';
import { colors } from '../../theme/colors';
import { ensureDeclaredAgeChecked, useSocialAgeGate, SOCIAL_BLOCKED_TEXT } from '../../utils/socialAgeGate';

export function SocialAgeGate({ name, children }: { name: string; children: React.ReactNode }) {
  const { blocked, checking } = useSocialAgeGate();
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    void ensureDeclaredAgeChecked();
  }, []);
  useEffect(() => {
    if (blocked) console.info('[SocialAgeGate] 소셜 화면 차단(iOS 13세 미만)', { screen: name });
  }, [blocked, name]);
  if (blocked) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg.deepest }}>
        <EmptyState
          icon={<Feather name="lock" size={32} color={colors.text.muted} />}
          title={SOCIAL_BLOCKED_TEXT.title}
          hint={SOCIAL_BLOCKED_TEXT.body}
        />
      </View>
    );
  }
  if (checking) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg.deepest }}>
        <ActivityIndicator color={colors.accent.primary} />
      </View>
    );
  }
  return <>{children}</>;
}

/** 화면 컴포넌트를 게이트로 감싼다(모듈 최상위에서 1회 생성 — 렌더마다 새 컴포넌트 금지) */
export function withSocialAgeGate<P extends object>(Screen: ComponentType<P>, name: string): ComponentType<P> {
  const Gated = (props: P) => (
    <SocialAgeGate name={name}>
      <Screen {...props} />
    </SocialAgeGate>
  );
  Gated.displayName = `SocialAgeGate(${name})`;
  return Gated;
}
