// [PolicySheet] 이용약관/개인정보 처리방침 등 정책 문서 전문 표시 모달.
// 문서 원문은 constants/consentTexts.ts(가입 동의 문구와 단일 출처)에서 가져와 불일치를 방지한다.
import { Modal, View, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { AppText } from './ui';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';

interface Props {
  visible: boolean;
  title: string;
  body: string;
  onClose: () => void;
}

export default function PolicySheet({ visible, title, body, onClose }: Props) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <AppText variant="title3">{title}</AppText>
          <TouchableOpacity onPress={onClose} accessibilityLabel="닫기" hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Feather name="x" size={22} color={colors.text.muted} />
          </TouchableOpacity>
        </View>
        <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: spacing.huge }}>
          <AppText variant="footnote" tone="secondary" style={styles.text}>{body}</AppText>
        </ScrollView>
      </View>
    </Modal>
  );
}

// 사업자 정보(전자상거래법 표기) — MAIDOL Footer와 동일 내용, 설정 하단·로그인 하단에 공용 표기
export function CompanyFooter() {
  return (
    <View style={styles.companyBox}>
      <AppText variant="caption" tone="muted" style={styles.companyText}>
        AIDOL | My AI Idol{'\n'}
        AI로 만든 음악을 공유하는 플랫폼{'\n'}
        (주)Lotus AI | 대표 이재규 | 사업자등록번호 334-87-04045{'\n'}
        통신판매업 신고 면제 (자본금 1억원 미만){'\n'}
        서울시 중구 퇴계로36길 2, 10층 16호·18호{'\n'}
        대표전화 02-2272-8952 | 이메일 kimpearl@lotusai.co.kr{'\n'}
        개인정보보호책임자 김진주{'\n'}
        © 2026 Lotus AI. All Rights Reserved.
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.deepest, paddingTop: 50 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.xl, paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.subtle,
  },
  body: { flex: 1, paddingHorizontal: spacing.xl, paddingTop: spacing.lg },
  text: { lineHeight: 20 },
  companyBox: {
    marginTop: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border.subtle,
  },
  companyText: { lineHeight: 18 },
});
