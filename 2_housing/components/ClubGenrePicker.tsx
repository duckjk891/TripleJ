// v3.296 [ClubGenre] 크루 장르 선택 칩(최대 3) — 크루 만들기·크루 정보 수정 공용
import { View, StyleSheet } from 'react-native';
import { Tag } from './ui';
import { CLUB_GENRES, MAX_CLUB_GENRES } from '../services/clubService';
import { showAlert } from '../utils/appAlert';
import { spacing } from '../theme/spacing';

export default function ClubGenrePicker({ value, onChange, disabled }: {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const toggle = (g: string) => {
    if (disabled) return;
    if (value.includes(g)) {
      onChange(value.filter((x) => x !== g));
      return;
    }
    if (value.length >= MAX_CLUB_GENRES) {
      showAlert('알림', `장르는 최대 ${MAX_CLUB_GENRES}개까지 고를 수 있어요.`);
      return;
    }
    onChange([...value, g]);
  };
  return (
    <View style={styles.wrap}>
      {CLUB_GENRES.map((g) => (
        <Tag key={g} label={g} selected={value.includes(g)} onPress={() => toggle(g)} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
