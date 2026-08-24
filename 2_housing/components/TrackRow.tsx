// [TrackRow] 곡 목록 한 줄 — 차트·검색 등 곡을 나열하는 모든 화면이 같은 디자인을 쓰도록 공용화.
// 구성: 좌측 슬롯(순위/NEW/▶/번호) | 커버 48 | 마퀴 제목 + 아티스트 | 재생수·좋아요수 | 더보기(⋮)
import { ReactNode } from 'react';
import { View, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { BACKEND_BASE_URL } from '../services/api';
import { AppText } from './ui';
import Marquee from './Marquee';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';

export interface RowTrack {
  id: string;
  title: string;
  artist_name?: string;
  cover_image?: string;
  cover_image_url?: string;
  play_count?: number;
  like_count?: number;
}

export function getTrackCoverUri(track: RowTrack): string | null {
  const img = track.cover_image || track.cover_image_url;
  if (!img) return null;
  return `${BACKEND_BASE_URL}/api/upload/cover-preview/${encodeURIComponent(img)}`;
}

/** left=true면 좌측 슬롯(순번)이 없는 목록 — 앞쪽 여백 없이 커버부터 시작한다 */
export function TrackCover({ track, left }: { track: RowTrack; left?: boolean }) {
  const uri = getTrackCoverUri(track);
  return (
    <View style={[styles.cover, left && styles.coverFirst]}>
      {uri ? <Image source={{ uri }} style={styles.coverImg} />
        : <View style={styles.coverPlaceholder}><AppText variant="title2" tone="muted">{'♪'}</AppText></View>}
    </View>
  );
}

interface Props {
  track: RowTrack;
  /** 좌측 영역(순위 숫자, NEW 뱃지, ▶ 등). 없으면 자리를 비우지 않고 커버가 앞으로 당겨진다 */
  left?: ReactNode;
  liked?: boolean;
  onPress: () => void;
  onMore?: () => void;
  /** 행 하단 부가 정보(장르 태그·공개상태 등 — 마이뮤직) */
  footer?: ReactNode;
  /** v3.70: 커버 우하단 소형 재생 배지 — 탭하면 재생됨을 시각화(피드 등). 'pause'=재생 중 표시 */
  playBadge?: 'play' | 'pause';
}

export default function TrackRow({ track, left, liked, onPress, onMore, footer, playBadge }: Props) {
  return (
    <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={onPress}>
      {left}
      <View>
        <TrackCover track={track} left={!left} />
        {playBadge ? (
          <View style={styles.playBadge}>
            <Feather name={playBadge} size={11} color="#fff" />
          </View>
        ) : null}
      </View>
      <View style={styles.info}>
        <Marquee text={track.title} variant="bodyStrong" tone="primary" />
        <AppText variant="footnote" tone="secondary" numberOfLines={1} style={styles.artist}>
          {track.artist_name || '알 수 없는 아티스트'}
        </AppText>
        {footer ?? null}
      </View>
      {/* 재생수 · 좋아요수 — 좋아요 실행은 ⋮ 액션시트에서 */}
      <View style={styles.statCol}>
        <View style={styles.statLine}>
          <Feather name="play" size={11} color={colors.text.muted} />
          <AppText variant="caption" tone="muted">{(track.play_count ?? 0).toLocaleString()}</AppText>
        </View>
        <View style={styles.statLine}>
          <Feather name="heart" size={11} color={liked ? colors.accent.primary : colors.text.muted} />
          <AppText variant="caption" tone={liked ? 'accent' : 'muted'}>{(track.like_count ?? 0).toLocaleString()}</AppText>
        </View>
      </View>
      {onMore ? (
        <TouchableOpacity style={styles.action} accessibilityLabel="더보기" onPress={(e) => { e.stopPropagation?.(); onMore(); }}>
          <Feather name="more-vertical" size={20} color={colors.text.muted} />
        </TouchableOpacity>
      ) : null}
    </TouchableOpacity>
  );
}

export const trackRowStyles = StyleSheet.create({
  rank: { width: 32 },
  newBadge: {
    width: 32, height: 18, backgroundColor: colors.accent.primary, borderRadius: radius.sm,
    justifyContent: 'center', alignItems: 'center',
  },
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.subtle,
  },
  rank: { width: 32 },
  cover: { width: 48, height: 48, borderRadius: radius.md, overflow: 'hidden', marginHorizontal: spacing.md },
  coverFirst: { marginLeft: 0 }, // 순번 없는 목록: 좌측 빈 공간 제거
  coverImg: { width: 48, height: 48 },
  coverPlaceholder: { width: 48, height: 48, backgroundColor: colors.bg.surface1, justifyContent: 'center', alignItems: 'center' },
  info: { flex: 1, marginRight: spacing.sm },
  artist: { marginTop: 3 },
  statCol: { alignItems: 'flex-end', gap: 3, marginRight: spacing.xs, minWidth: 44 },
  // v3.70 커버 우하단 재생 배지 → v3.71: 커버의 marginHorizontal(12)을 보정해 이미지 '내부' 우하단에 오도록
  playBadge: {
    position: 'absolute', right: spacing.md + 2, bottom: 2,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center',
  },
  statLine: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  action: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
});
