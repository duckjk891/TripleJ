// [LoginStartButton] "로그인하고 시작하기" 통일 버튼 — 피드/작업실/플레이리스트 등 로그인 유도 지점 공통.
// 버튼 크기·폰트 색상·크기를 한 곳에서 관리해 화면 간 디자인 불일치를 방지한다.
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';

interface Props {
  onPress: () => void;
  label?: string;
}

export default function LoginStartButton({ onPress, label = '로그인하고 시작하기' }: Props) {
  return (
    <TouchableOpacity style={styles.button} onPress={onPress} activeOpacity={0.85} accessibilityLabel={label}>
      <Text style={styles.buttonText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  // 작업실/피드 로그인 오버레이 버튼과 동일 스펙(통일 기준)
  button: {
    backgroundColor: colors.accent.primary,
    borderRadius: 24,
    paddingVertical: 14,
    paddingHorizontal: 40,
  },
  buttonText: {
    color: colors.text.primary,
    fontSize: 16,
    fontWeight: 'bold',
  },
});
