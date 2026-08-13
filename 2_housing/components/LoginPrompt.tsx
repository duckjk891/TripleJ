// [LoginPrompt] 로그인 유도 공통 콘텐츠 — 아이콘(선택)·제목(선택)·설명 + "로그인하고 시작하기" 버튼.
// 피드/작업실/플레이리스트가 동일한 폰트(색상·크기)·버튼을 쓰도록 한 곳에서 관리.
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import LoginStartButton from './LoginStartButton';

interface Props {
  icon?: string;
  title?: string;
  desc?: string;
  onPress: () => void;
}

export default function LoginPrompt({ icon, title, desc, onPress }: Props) {
  return (
    <View style={styles.content}>
      {icon ? <Text style={styles.icon}>{icon}</Text> : null}
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {desc ? <Text style={styles.desc}>{desc}</Text> : null}
      <LoginStartButton onPress={onPress} />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { alignItems: 'center', paddingHorizontal: 40 },
  icon: { fontSize: 48, marginBottom: 16 },
  title: { fontSize: 20, fontWeight: 'bold', color: colors.text.primary, marginBottom: 12 },
  desc: { fontSize: 15, color: colors.text.secondary, textAlign: 'center', lineHeight: 24, marginBottom: 28 },
});
