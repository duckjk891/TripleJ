// [ConsentList] 회원가입 약관 동의 — MAIDOL ConsentList 이식.
// 전체 동의 + 5항목(필수4·선택1), 각 항목 '보기/접기'로 본문 전문 인라인 표시, 하단 행태정보 고지문.
import { useState } from 'react';
import { View, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { CONSENTS, SIGNUP_CONSENT_KEYS, BEHAVIOR_NOTICE } from '../../constants/consentTexts';
import { AppText } from '../ui';
import { colors } from '../../theme/colors';
import { spacing, radius } from '../../theme/spacing';

export type ConsentState = Record<string, boolean>;

interface Props {
  value: ConsentState;
  onChange: (next: ConsentState) => void;
}

export default function ConsentList({ value, onChange }: Props) {
  const [openKey, setOpenKey] = useState<string | null>(null);

  const allChecked = SIGNUP_CONSENT_KEYS.every((k) => value[k]);
  const toggleAll = () => {
    const next: ConsentState = {};
    SIGNUP_CONSENT_KEYS.forEach((k) => { next[k] = !allChecked; });
    onChange(next);
  };
  const toggleOne = (k: string) => onChange({ ...value, [k]: !value[k] });

  return (
    <View>
      {/* 전체 동의 */}
      <TouchableOpacity style={[styles.row, styles.allRow]} onPress={toggleAll} accessibilityLabel="전체 동의">
        <Feather name={allChecked ? 'check-square' : 'square'} size={20} color={allChecked ? colors.accent.primary : colors.text.muted} />
        <AppText variant="bodyStrong">전체 동의</AppText>
      </TouchableOpacity>

      {SIGNUP_CONSENT_KEYS.map((k) => {
        const c = (CONSENTS as any)[k];
        const checked = !!value[k];
        const open = openKey === k;
        return (
          <View key={k}>
            <View style={styles.row}>
              <TouchableOpacity style={styles.rowMain} onPress={() => toggleOne(k)} accessibilityLabel={c.label}>
                <Feather name={checked ? 'check-square' : 'square'} size={18} color={checked ? colors.accent.primary : colors.text.muted} />
                <AppText variant="footnote" tone={checked ? 'primary' : 'secondary'} style={{ flex: 1 }}>{c.label}</AppText>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setOpenKey(open ? null : k)} accessibilityLabel={`${c.label} ${open ? '접기' : '보기'}`}>
                <AppText variant="caption" tone="accent">{open ? '접기' : '보기'}</AppText>
              </TouchableOpacity>
            </View>
            {open ? (
              <ScrollView style={styles.body} nestedScrollEnabled>
                <AppText variant="caption" tone="secondary" style={styles.bodyText}>{c.body}</AppText>
              </ScrollView>
            ) : null}
          </View>
        );
      })}

      <AppText variant="caption" tone="muted" style={styles.notice}>{BEHAVIOR_NOTICE}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  allRow: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.subtle, paddingBottom: spacing.md, marginBottom: spacing.xs },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  body: {
    maxHeight: 180, backgroundColor: colors.bg.deepest, borderRadius: radius.md,
    padding: spacing.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border.subtle,
  },
  bodyText: { lineHeight: 18 },
  notice: { marginTop: spacing.sm, lineHeight: 16 },
});
