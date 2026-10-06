// [ArrangeSheet] v3.281 편곡하기 — 완성 곡을 다른 장르·분위기로 다시 만드는 바텀시트.
// 장르·분위기 칩(작사·작곡과 같은 GENRE_OPTIONS/MOOD_OPTIONS — 다시 누르면 해제), 자유 입력 1줄,
// "원곡 멜로디 유지" 3단(조금/보통/많이 → audioWeight). 하나 이상 골라야 [⭐N 편곡하기] 활성.
// 요청·⭐ 확인·오류 처리는 호출 화면(MusicResult)이 담당 — 이 시트는 입력만 모은다.
import { useEffect, useState } from 'react';
import { Modal, View, ScrollView, TouchableOpacity, TextInput, StyleSheet } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, Button, Tag } from '../ui';
import { colors } from '../../theme/colors';
import { spacing, radius } from '../../theme/spacing';
import { GENRE_OPTIONS, MOOD_OPTIONS } from '../../utils/lyricsPrompt';
import { ARRANGE_KEEP_LEVELS } from '../../services/musicService';

export interface ArrangeSelection {
  genreKo: string | null;
  moodKo: string | null;
  styleText: string;
  keepMelody: number;
}

interface Props {
  visible: boolean;
  /** 현재 곡 장르(한글 라벨이면 "지금" 표시) */
  currentGenre?: string | null;
  /** v3.291: 편곡 원본 버전 라벨(예: '버전 A') — 어느 버전을 편곡하는지 명시 */
  sourceLabel?: string | null;
  /** ⭐ 비용(compose) */
  cost: number;
  busy?: boolean;
  onClose: () => void;
  onSubmit: (sel: ArrangeSelection) => void;
}

const DEFAULT_KEEP = ARRANGE_KEEP_LEVELS[1].value; // 보통 0.65

export default function ArrangeSheet({ visible, currentGenre, sourceLabel, cost, busy, onClose, onSubmit }: Props) {
  const insets = useSafeAreaInsets(); // Modal 은 루트 인셋 미상속 → 시트에 직접 보강(PlaylistPickerSheet 관행)
  const [genreKo, setGenreKo] = useState<string | null>(null);
  const [moodKo, setMoodKo] = useState<string | null>(null);
  const [styleText, setStyleText] = useState('');
  const [keep, setKeep] = useState<number>(DEFAULT_KEEP);

  // 열 때마다 초기화 — 이전 곡의 선택이 남지 않게
  useEffect(() => {
    if (!visible) return;
    setGenreKo(null);
    setMoodKo(null);
    setStyleText('');
    setKeep(DEFAULT_KEEP);
  }, [visible]);

  const canSubmit = !busy && !!(genreKo || moodKo || styleText.trim());

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({ genreKo, moodKo, styleText: styleText.trim(), keepMelody: keep });
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior="padding"
        keyboardVerticalOffset={-insets.bottom}
        pointerEvents="box-none"
      >
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={busy ? undefined : onClose}>
          <TouchableOpacity
            style={[styles.sheet, { paddingBottom: insets.bottom + spacing.xl }]}
            activeOpacity={1}
            onPress={() => {}}
          >
            <AppText variant="title3">{sourceLabel ? `편곡하기 · ${sourceLabel}` : '편곡하기'}</AppText>
            <AppText variant="footnote" tone="secondary" style={styles.subtitle}>
              {sourceLabel
                ? `${sourceLabel}를 바탕으로 가사와 목소리는 그대로, 사운드만 새로 만들어요.`
                : '가사와 목소리는 그대로, 사운드만 새로 만들어요.'}
            </AppText>
            <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <AppText variant="footnote" tone="secondary" style={styles.label}>장르</AppText>
              <View style={styles.chips}>
                {GENRE_OPTIONS.map((g) => (
                  <Tag
                    key={g}
                    label={currentGenre === g ? `${g} (지금)` : g}
                    selected={genreKo === g}
                    disabled={busy}
                    onPress={() => setGenreKo((cur) => (cur === g ? null : g))}
                  />
                ))}
              </View>

              <AppText variant="footnote" tone="secondary" style={styles.label}>분위기</AppText>
              <View style={styles.chips}>
                {MOOD_OPTIONS.map((m) => (
                  <Tag
                    key={m}
                    label={m}
                    selected={moodKo === m}
                    disabled={busy}
                    onPress={() => setMoodKo((cur) => (cur === m ? null : m))}
                  />
                ))}
              </View>

              <AppText variant="footnote" tone="secondary" style={styles.label}>더 원하는 느낌 (선택)</AppText>
              <TextInput
                style={styles.input}
                value={styleText}
                onChangeText={setStyleText}
                placeholder="예: 어쿠스틱 기타로 잔잔하게"
                placeholderTextColor={colors.text.muted}
                maxLength={100}
                editable={!busy}
                returnKeyType="done"
                onSubmitEditing={submit}
              />

              <AppText variant="footnote" tone="secondary" style={styles.label}>원곡 멜로디 유지</AppText>
              <View style={styles.segment}>
                {ARRANGE_KEEP_LEVELS.map((lv) => {
                  const active = keep === lv.value;
                  return (
                    <TouchableOpacity
                      key={lv.label}
                      style={[styles.segItem, active && styles.segItemActive]}
                      disabled={busy}
                      onPress={() => setKeep(lv.value)}
                    >
                      <AppText variant="footnote" tone={active ? 'primary' : 'secondary'}>{lv.label}</AppText>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <AppText variant="caption" tone="muted" style={styles.hint}>
                많이 유지할수록 원곡과 비슷하게, 조금만 유지하면 더 과감하게 바뀌어요.
              </AppText>
            </ScrollView>

            <Button
              label={`⭐${cost} 편곡하기`}
              fullWidth
              loading={busy}
              disabled={!canSubmit}
              onPress={submit}
            />
            {!genreKo && !moodKo && !styleText.trim() ? (
              <AppText variant="caption" tone="muted" center style={styles.hint}>
                장르·분위기·느낌 중 하나 이상 골라주세요.
              </AppText>
            ) : null}
          </TouchableOpacity>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg.surface1, borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl,
    padding: spacing.xl, maxHeight: '88%',
  },
  subtitle: { marginTop: spacing.xs, marginBottom: spacing.md },
  scroll: { marginBottom: spacing.lg },
  label: { marginTop: spacing.md, marginBottom: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  input: {
    backgroundColor: colors.bg.deepest, borderRadius: radius.md, padding: spacing.md,
    color: colors.text.primary, borderWidth: 1, borderColor: colors.border.subtle,
  },
  segment: {
    flexDirection: 'row', borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border.default,
    overflow: 'hidden',
  },
  segItem: { flex: 1, paddingVertical: spacing.sm, alignItems: 'center' },
  segItemActive: { backgroundColor: colors.bg.surface2, borderColor: colors.accent.primary },
  hint: { marginTop: spacing.sm },
});
