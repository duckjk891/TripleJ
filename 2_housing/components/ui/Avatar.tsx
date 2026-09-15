// [ui/Avatar] 프로필/커버 아바타 — 이미지 또는 이니셜 폴백(원형).
// v3.181(대표): ① seed(사용자 id) 기반 폴백 배경색 랜덤 팔레트 — 기본 이미지 사용자끼리
//   구분되게 (같은 사용자는 항상 같은 색 — 해시 결정적) ② ring — 글 주인 표시용 액센트 테두리.
import { View, Image, StyleSheet } from 'react-native';
import AppText from './AppText';
import { colors } from '../../theme/colors';

export interface AvatarProps {
  uri?: string | null;
  name?: string;
  size?: number;
  seed?: string | null;   // 사용자 id 등 — 폴백 배경색 결정(없으면 name 사용)
  ring?: boolean;         // 액센트 테두리(글 주인 표시)
}

// 다크 테마 위에서 잘 보이는 채도 낮은 팔레트 8색
const FALLBACK_PALETTE = [
  '#7C5CBF', '#BF5C8E', '#BF7A5C', '#A8BF5C',
  '#5CBF8A', '#5CA8BF', '#5C6EBF', '#8E5CBF',
];

function seedColor(seed?: string | null, name?: string): string {
  const key = seed || name || '?';
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return FALLBACK_PALETTE[h % FALLBACK_PALETTE.length];
}

export default function Avatar({ uri, name, size = 40, seed, ring }: AvatarProps) {
  const dim = { width: size, height: size, borderRadius: size / 2 };
  const ringStyle = ring ? { borderWidth: 2, borderColor: colors.accent.primary } : null;
  if (uri) return <Image source={{ uri }} style={[dim, styles.img, ringStyle]} />;
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <View style={[dim, styles.fallback, { backgroundColor: seedColor(seed, name) }, ringStyle]}>
      <AppText style={{ fontSize: size * 0.42, fontWeight: '700', color: '#fff' }}>{initial}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  img: { backgroundColor: colors.bg.surface1 },
  fallback: { alignItems: 'center', justifyContent: 'center' },
});
