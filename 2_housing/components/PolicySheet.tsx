// [PolicySheet] 이용약관/개인정보 처리방침 등 정책 문서 전문 표시 모달.
// 문서 원문은 constants/consentTexts.ts(가입 동의 문구와 단일 출처)에서 가져와 불일치를 방지한다.
// v3.214 ②: variant 분기 — 'page'(기본, 현행 전체화면: 약관·개인정보 사용처 무변경) |
//   'sheet'(바텀시트: 헤더 하단까지만 — DialogueScreen 창작 과정 기록 안내가 상단바를 덮던 침범 봉합).
//   시트 관행(TrackActionSheet 등) 준수: transparent Modal + backdrop 0.6 + flex-end +
//   maxHeight = winH − topLimit − spacing.md + paddingBottom insets.bottom+spacing.xl.
import { Modal, View, TouchableOpacity, ScrollView, StyleSheet, Linking, useWindowDimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from './ui';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { showAlert } from '../utils/appAlert';

interface Props {
  visible: boolean;
  title: string;
  body: string;
  onClose: () => void;
  /** v3.214 ②: 'page'=전체화면(기본, 현행), 'sheet'=헤더 하단 제한 바텀시트 */
  variant?: 'page' | 'sheet';
  /** variant='sheet' 전용 — 시트 상단이 넘지 말아야 할 화면 상단 오프셋(보통 헤더 높이).
   *  Modal 은 별도 창이라 useHeaderHeight 훅이 무효 → 호출 화면에서 측정해 prop 으로 전달. */
  topLimit?: number;
}

export default function PolicySheet({ visible, title, body, onClose, variant = 'page', topLimit = 0 }: Props) {
  // v3.73: 상단 공백 제거 — 고정 50 대신 기기 상태바 높이만큼만(웹 0)
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();

  if (variant === 'sheet') {
    // 규칙: 시트 상단 ≥ 헤더 하단 — maxHeight 로 강제(내용이 짧으면 더 낮게 붙는다)
    const maxHeight = Math.max(0, winH - topLimit - spacing.md);
    return (
      <Modal visible={visible} transparent statusBarTranslucent animationType="slide" onRequestClose={onClose}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} accessibilityLabel="닫기 배경">
          <TouchableOpacity
            style={[styles.sheet, { maxHeight, paddingBottom: insets.bottom + spacing.xl }]}
            activeOpacity={1}
            onPress={() => {}}
          >
            <View style={[styles.header, styles.sheetHeader]}>
              <AppText variant="title3">{title}</AppText>
              <TouchableOpacity onPress={onClose} accessibilityLabel="닫기" hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Feather name="x" size={22} color={colors.text.muted} />
              </TouchableOpacity>
            </View>
            {/* flexGrow:0 — 내용 길이만큼만 차지(앱 시트 관행), 길면 maxHeight 안에서 스크롤.
                page 의 styles.body(flex:1, flexBasis 0)를 쓰면 시트에서 0 높이로 붕괴 → 전용 스타일 */}
            <ScrollView style={styles.sheetBody} contentContainerStyle={{ paddingBottom: spacing.lg }}>
              <AppText variant="footnote" tone="secondary" style={styles.text}>{body}</AppText>
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
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

// 사업자 정보(전자상거래법 표기) — MAIDOL Footer 구성(정보 + 이용약관/개인정보처리방침/고객센터 링크).
// 설정 하단·로그인 하단에 공용 표기. 통신판매업 신고 면제 문구는 표시 의무 아님 → 미표기.
export function CompanyFooter({ onOpenPolicy }: { onOpenPolicy?: (key: 'terms' | 'privacy') => void }) {
  // v3.194: 로그인 화면에서 소셜 버튼 바로 아래라 오탭으로 메일 앱이 열리는 사고 방지 — 확인 다이얼로그 경유
  const openMail = () => {
    showAlert('고객센터', '고객센터로 메일을 보낼까요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '메일 열기',
        onPress: () => {
          Linking.openURL('mailto:kimpearl@lotusai.co.kr').catch((err) =>
            console.error('[CompanyFooter] 고객센터 메일 열기 실패', { message: err?.message }));
        },
      },
    ]);
  };
  return (
    <View style={styles.companyBox}>
      {/* 정책·고객센터 링크 — MAIDOL Footer와 동일 구성 */}
      <View style={styles.companyLinks}>
        <TouchableOpacity onPress={() => onOpenPolicy?.('terms')} accessibilityLabel="이용약관">
          <AppText variant="caption" tone="secondary" style={styles.companyLink}>이용약관</AppText>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => onOpenPolicy?.('privacy')} accessibilityLabel="개인정보처리방침">
          <AppText variant="caption" tone="secondary" style={styles.companyLink}>개인정보처리방침</AppText>
        </TouchableOpacity>
        <TouchableOpacity onPress={openMail} accessibilityLabel="고객센터">
          <AppText variant="caption" tone="secondary" style={styles.companyLink}>고객센터</AppText>
        </TouchableOpacity>
      </View>
      <AppText variant="caption" tone="muted" style={styles.companyText}>
        MAIDOL | My AI Idol{'\n'}
        AI로 만든 음악을 공유하는 플랫폼{'\n'}
        주식회사 로터스에이아이 | 대표 이재규 | 사업자등록번호 334-87-04045{'\n'}
        서울시 중구 퇴계로36길 2, 10층 16호·18호{'\n'}
        대표전화 02-2272-8952 | 이메일 kimpearl@lotusai.co.kr{'\n'}
        개인정보보호책임자 김진주{'\n'}
        © 2026 Lotus AI. All Rights Reserved.
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.deepest },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.xl, paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.subtle,
  },
  body: { flex: 1, paddingHorizontal: spacing.xl, paddingTop: spacing.lg },
  // v3.214 ②: 바텀시트 변형 — 시트 관행(TrackShareDownloadSheet 등)과 동일 톤
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg.surface1,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    paddingTop: spacing.lg,
  },
  sheetHeader: { paddingTop: 0 },
  sheetBody: { flexGrow: 0, paddingHorizontal: spacing.xl, paddingTop: spacing.lg },
  text: { lineHeight: 20 },
  companyBox: {
    // v3.194: 소셜 로그인 버튼과의 간격 확대 — 고객센터 링크 오탭 방지
    marginTop: spacing.xxl, paddingTop: spacing.lg, paddingBottom: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border.subtle,
  },
  companyText: { lineHeight: 18 },
  companyLinks: { flexDirection: 'row', gap: spacing.lg, marginBottom: spacing.md },
  companyLink: { textDecorationLine: 'underline' },
});
