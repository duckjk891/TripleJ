// v3.389 [Diary] [내 일기] 미니홈피 달력 — 한 달을 기분 이모지로 보고, 날짜를 누르면 그날 일기.
// 데이터는 화면(FeedScreen)이 GET /feeds/diary/month 로 받아 넘긴다(이 컴포넌트는 표시만).
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { AppText, Avatar } from '../ui';
import { colors } from '../../theme/colors';
import { spacing, radius } from '../../theme/spacing';
import { monthCells, moodOf } from '../../utils/diary';

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

interface Props {
  month: string;                                   // 'YYYY-MM'
  today: string;                                   // 'YYYY-MM-DD' KST
  days: Record<string, { count: number; mood?: string | null }>;
  selected: string | null;
  streak: number;
  stars: number;
  nickname?: string;
  avatarUri?: string | null;
  onSelect: (ymd: string) => void;
  onMonthChange: (delta: number) => void;
}

export default function DiaryCalendar({ month, today, days, selected, streak, stars, nickname, avatarUri, onSelect, onMonthChange }: Props) {
  const cells = monthCells(month);
  const [y, m] = month.split('-');
  const total = Object.values(days).reduce((n, d) => n + (d?.count || 0), 0);
  const canNext = month < today.slice(0, 7);
  return (
    <View style={styles.box}>
      <View style={styles.top}>
        <Avatar name={nickname || '나'} uri={avatarUri || null} size={40} />
        <View style={{ flex: 1, marginLeft: spacing.sm }}>
          <AppText variant="bodyStrong" numberOfLines={1}>{nickname || '내 일기장'}</AppText>
          <AppText variant="caption" tone="muted">이번 달 일기 {total}편 · 받은 별 ⭐{stars}</AppText>
        </View>
        <View style={styles.streak}>
          <AppText variant="caption" tone="muted">연속</AppText>
          <AppText variant="bodyStrong" style={{ color: colors.accent.secondary }}>{streak}일</AppText>
        </View>
      </View>

      <View style={styles.monthRow}>
        <TouchableOpacity onPress={() => onMonthChange(-1)} style={styles.navBtn} accessibilityLabel="이전 달">
          <Feather name="chevron-left" size={18} color={colors.text.secondary} />
        </TouchableOpacity>
        <AppText variant="bodyStrong">{`${y}년 ${parseInt(m, 10)}월`}</AppText>
        <TouchableOpacity onPress={() => canNext && onMonthChange(1)} style={[styles.navBtn, !canNext && { opacity: 0.3 }]} disabled={!canNext} accessibilityLabel="다음 달">
          <Feather name="chevron-right" size={18} color={colors.text.secondary} />
        </TouchableOpacity>
      </View>

      <View style={styles.grid}>
        {WEEK.map((w, i) => (
          <View key={w} style={styles.cell}>
            <AppText variant="caption" style={{ color: i === 0 ? colors.status.error : colors.text.muted, fontSize: 11 }}>{w}</AppText>
          </View>
        ))}
        {cells.map((ymd, i) => {
          if (!ymd) return <View key={`e${i}`} style={styles.cell} />;
          const info = days[ymd];
          const has = !!info?.count;
          const isToday = ymd === today;
          const isSel = ymd === selected;
          const future = ymd > today;
          const mood = moodOf(info?.mood);
          return (
            <TouchableOpacity
              key={ymd}
              style={[styles.cell, styles.day, has && styles.dayHas, isSel && styles.daySel, future && { opacity: 0.35 }]}
              disabled={future}
              onPress={() => onSelect(ymd)}
              accessibilityLabel={`${parseInt(ymd.slice(8), 10)}일${has ? ` 일기 ${info.count}편` : ''}`}
            >
              <AppText variant="caption" style={[styles.dayNum, has && { color: colors.text.secondary }, isToday && styles.todayNum]}>
                {parseInt(ymd.slice(8), 10)}
              </AppText>
              {has ? (
                <AppText style={styles.emoji}>{mood ? mood.emoji : '📝'}</AppText>
              ) : isToday ? (
                <AppText style={[styles.emoji, { color: colors.accent.secondary }]}>+</AppText>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </View>
      <View style={styles.legend}>
        <AppText variant="caption" tone="muted">이모지 = 그날 기분</AppText>
        <AppText variant="caption" style={{ color: colors.accent.secondary }}>+ 오늘 쓰기</AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: colors.bg.surface1, borderRadius: radius.lg, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border.subtle,
  },
  top: { flexDirection: 'row', alignItems: 'center' },
  streak: { alignItems: 'flex-end' },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md, marginBottom: spacing.xs },
  navBtn: { padding: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 2 },
  day: { height: 44, borderRadius: radius.md, justifyContent: 'flex-start', paddingTop: 4 },
  dayHas: { backgroundColor: colors.bg.surface2 },
  daySel: { borderWidth: 1.5, borderColor: colors.accent.primary },
  dayNum: { fontSize: 11, color: colors.text.muted },
  todayNum: { color: colors.accent.secondary, fontWeight: '700' },
  emoji: { fontSize: 16, lineHeight: 20 },
  legend: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xs },
});
