// [ui/Avatar] 프로필/커버 아바타 — 이미지 또는 이니셜 폴백(원형).
import { View, Image, StyleSheet } from 'react-native';
import AppText from './AppText';
import { colors } from '../../theme/colors';

export interface AvatarProps {
  uri?: string | null;
  name?: string;
  size?: number;
}

export default function Avatar({ uri, name, size = 40 }: AvatarProps) {
  const dim = { width: size, height: size, borderRadius: size / 2 };
  if (uri) return <Image source={{ uri }} style={[dim, styles.img]} />;
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <View style={[dim, styles.fallback]}>
      <AppText variant="bodyStrong">{initial}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  img: { backgroundColor: colors.bg.surface1 },
  fallback: { backgroundColor: colors.bg.surface2, alignItems: 'center', justifyContent: 'center' },
});
