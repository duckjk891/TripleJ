// v3.253 [CrewRecog] 크루 레벨 배지 — Feather 'users' 글리프 + Lv 숫자 조합의 경량 뱃지.
//  · 아티스트 휘장(ArtistLevelBadge — SVG 기하)과 구분되는 텍스트형: 크루 카드·ClubHome 헤더용.
//  · 티어 색(Lv1~5): 그레이/브론즈/실버/골드/보라 — ArtistLevelBadge 금속 팔레트 토큰 관행 준수
//    (브론즈·실버는 동일 HEX, 골드=accent.secondary, 보라=accent.primary).
//  · sizes: sm(글리프 14) / md(글리프 18). label 전달 시 옆에 muted 라벨 병기.
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors } from '../theme/colors';

export type CrewBadgeSize = 'sm' | 'md';

/** 글리프(Feather users) 픽셀 — sm14/md18 규격 */
export const CREW_BADGE_GLYPH: Record<CrewBadgeSize, number> = { sm: 14, md: 18 };

/** Lv1~5 티어 색 — 그레이/브론즈/실버/골드/보라 (다크 배경 대비 검증값, ArtistLevelBadge 관행) */
export const CREW_LEVEL_COLORS: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: '#8a8496', // 그레이(무광 회보라)
  2: '#cd8a4f', // 브론즈
  3: '#c9ced6', // 실버
  4: colors.accent.secondary, // 골드
  5: colors.accent.primary, // 보라
};

/** 레벨 방어 정규화 — 이상값(구서버·NaN)은 1~5 로 클램프 */
export function crewLevelColor(level: number): string {
  const lv = Number.isFinite(level) ? Math.min(5, Math.max(1, Math.round(level))) : 1;
  return CREW_LEVEL_COLORS[lv as 1 | 2 | 3 | 4 | 5];
}

interface Props {
  /** 1..5 (범위 밖은 클램프) */
  level: number;
  /** 티어 라벨(예: '신생 크루') — 전달 시 배지 옆 muted 병기 */
  label?: string | null;
  size?: CrewBadgeSize;
  testID?: string;
}

export default function CrewLevelBadge({ level, label, size = 'sm', testID }: Props) {
  const lv = Number.isFinite(level) ? Math.min(5, Math.max(1, Math.round(level))) : 1;
  const tint = crewLevelColor(lv);
  const glyph = CREW_BADGE_GLYPH[size];
  const font = size === 'md' ? 12 : 10;
  return (
    <View style={styles.row} testID={testID} accessibilityLabel={`크루 레벨 ${lv}${label ? ` ${label}` : ''}`}>
      <View style={[styles.pill, { borderColor: tint }]}>
        <Feather name="users" size={glyph} color={tint} />
        <Text style={[styles.lvText, { color: tint, fontSize: font, lineHeight: font + 2 }]}>{`Lv${lv}`}</Text>
      </View>
      {label ? (
        <Text style={[styles.label, { fontSize: font }]} numberOfLines={1}>
          {label}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 5, paddingVertical: 1,
    borderRadius: 999, borderWidth: 1,
    backgroundColor: colors.bg.surface2,
  },
  lvText: { fontWeight: '800' },
  label: { color: colors.text.muted, flexShrink: 1 },
});
