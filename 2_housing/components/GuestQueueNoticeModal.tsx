// [GuestQueueNoticeModal] 비회원이 '담기'(재생목록에 추가)를 누를 때 뜨는 선택 팝업.
// 로그인 화면으로 튕기지 않고, 사용자가 [로그인하고 시작하기] / [계속 담기] 중 고를 수 있게 한다.
// 계속 담기를 고르면 비회원도 재생목록을 쓸 수 있으나, 다음 접속 시 사라지고 별도 받지 못한다는 점을 안내.
import { Modal, View, TouchableOpacity, StyleSheet } from 'react-native';
import { AppText } from './ui';
import LoginStartButton from './LoginStartButton';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';

interface Props {
  visible: boolean;
  onLogin: () => void;     // 로그인하고 시작하기
  onContinue: () => void;  // 계속 담기 (비회원 유지)
  onClose: () => void;     // 배경 탭/닫기
}

export default function GuestQueueNoticeModal({ visible, onLogin, onContinue, onClose }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity style={styles.card} activeOpacity={1} onPress={() => {}}>
          <AppText variant="title3" center style={styles.title}>재생목록에 담을까요?</AppText>
          <AppText variant="body" tone="secondary" center style={styles.desc}>
            로그인하지 않으면 다음 접속 시 재생목록이 사라져요.{'\n'}
            음악을 들으면 받는 <AppText variant="bodyStrong" tone="accent">스타(⭐)</AppText>도 쌓이지 않아요.{'\n'}
            스타를 모으면 작업실에서 나만의 음악을 만들 수 있어요.
          </AppText>

          <LoginStartButton onPress={onLogin} />

          <TouchableOpacity style={styles.continueBtn} onPress={onContinue} accessibilityLabel="계속 담기">
            <AppText variant="bodyStrong" tone="secondary">계속 담기</AppText>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  card: {
    width: '100%', maxWidth: 340, backgroundColor: colors.bg.surface1,
    borderRadius: radius.xxl, padding: spacing.xl, alignItems: 'center',
  },
  title: { marginBottom: spacing.md },
  desc: { lineHeight: 22, marginBottom: spacing.xl },
  continueBtn: { marginTop: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.xl },
});
