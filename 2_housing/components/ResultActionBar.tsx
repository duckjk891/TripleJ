import { ActivityIndicator, StyleSheet, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';
import { AppText } from './ui';
import { colors } from '../theme/colors';

// v3.290 [ResultBar]: 모든 디렉터 최종 결과 화면 하단 공통 바 — [‹ 이전] + 주요 버튼(저장 등).
// 상단바 ← 와 별개로 화면 안에서도 "이전"이 보이게(대표 지시 10-06). onBack 은 각 화면의
// 상단바 ← 와 같은 목적지로 보낸다. primary 미지정 시 [‹ 이전] 이 전체 폭.

type Props = {
  /** 로그 prefix 용 화면 이름 */
  screen: string;
  onBack: () => void;
  backLabel?: string;
  primaryLabel?: string;
  onPrimary?: () => void;
  primaryDisabled?: boolean;
  primaryBusy?: boolean;
  style?: StyleProp<ViewStyle>;
  /** v3.322 저장 단계 AI 확인 안내 — 미지정 = 주요 버튼이 있고 '다시 생성'이 아닐 때 자동 표시 */
  aiNotice?: boolean;
};

// v3.322 (대표 10-09): 각 디렉터 저장 단계 — AI 결과는 틀릴 수 있으니 확인 후 저장하도록 안내
export const AI_SAVE_NOTICE = 'AI는 실수를 할 수 있어요. 내용을 꼭 확인한 뒤 저장해 주세요.';

export default function ResultActionBar({
  screen,
  onBack,
  backLabel = '이전',
  primaryLabel,
  onPrimary,
  primaryDisabled,
  primaryBusy,
  style,
  aiNotice,
}: Props) {
  const hasPrimary = !!primaryLabel && !!onPrimary;
  const showNotice = aiNotice ?? (hasPrimary && !/다시 생성/.test(primaryLabel || ''));
  return (
    <View style={[{ width: '100%' }, style]}>
    {showNotice ? (
      <View style={styles.noticeRow} accessibilityRole="text">
        <AppText style={styles.noticeText}>ⓘ {AI_SAVE_NOTICE}</AppText>
      </View>
    ) : null}
    <View style={styles.row}>
      <TouchableOpacity
        style={[styles.backBtn, !hasPrimary && { flex: 1 }]}
        onPress={() => {
          if (__DEV__) console.info(`[ResultBar] ${screen} 이전`);
          onBack();
        }}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel={backLabel}
      >
        <AppText style={styles.backText}>‹ {backLabel}</AppText>
      </TouchableOpacity>
      {hasPrimary && (
        <TouchableOpacity
          style={[styles.primaryBtn, (primaryDisabled || primaryBusy) && { opacity: 0.55 }]}
          onPress={onPrimary}
          disabled={primaryDisabled || primaryBusy}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={primaryLabel}
        >
          {primaryBusy ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <AppText style={styles.primaryText} numberOfLines={1}>{primaryLabel}</AppText>
          )}
        </TouchableOpacity>
      )}
    </View>
    </View>
  );
}

/** 결과 화면 보조 버튼(외곽선) — 바 위에 1~2개씩 가로로 배치 */
export function ResultSecondaryButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.secondaryBtn, disabled && { opacity: 0.5 }]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <AppText style={styles.secondaryText} numberOfLines={1}>{label}</AppText>
    </TouchableOpacity>
  );
}

export const resultBarStyles = StyleSheet.create({
  secondaryRow: { flexDirection: 'row', gap: 8, width: '100%' },
});

const styles = StyleSheet.create({
  noticeRow: { width: '100%', paddingHorizontal: 4, marginBottom: 8 },
  noticeText: { color: colors.text.muted, fontSize: 12, lineHeight: 17, textAlign: 'center' },
  row: { flexDirection: 'row', gap: 8, width: '100%', alignItems: 'stretch' },
  backBtn: {
    minWidth: 96,
    paddingVertical: 15,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    backgroundColor: colors.bg.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backText: { color: colors.text.primary, fontSize: 15, fontWeight: '600' },
  primaryBtn: {
    flex: 1,
    paddingVertical: 15,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: colors.accent.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  secondaryBtn: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.accent.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { color: colors.accent.primary, fontSize: 14, fontWeight: '600' },
});
