// [LyricSyncView] 동영상 탭 가사 싱크(노래방식) — MAIDOL LyricSyncVideo 이식.
// 커버 블러 배경 + 현재 재생 위치(positionMillis)의 가사 라인을 박스 세로 '가운데'에 굵게,
// 위아래 라인은 흐리게. 긴 줄은 박스 가로폭에 맞춰 자동 개행.
// 계약: GET /tracks/{id}/lyrics-timeline → { has_timestamps, segments:[{text,start,end}] } (초 단위)
import { useMemo } from 'react';
import { View, ImageBackground, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import AppText from './ui/AppText';

export interface LyricSegment { text: string; start: number; end: number }

interface Props {
  segments: LyricSegment[];
  positionMillis: number;   // 현재 재생 위치(ms)
  coverUri?: string | null;
  height?: number;
}

const WINDOW = 2; // 활성 라인 위아래로 보여줄 줄 수

export default function LyricSyncView({ segments, positionMillis, coverUri, height = 210 }: Props) {
  const sec = positionMillis / 1000;

  // 현재 라인 = start <= sec 인 마지막 세그먼트 (이진 탐색)
  const activeIdx = useMemo(() => {
    let lo = 0, hi = segments.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (segments[mid].start <= sec) { ans = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return ans;
  }, [segments, sec]);

  // 활성 라인을 '항상' 박스 세로 정중앙에 두기 위해, 위아래 각 WINDOW개 슬롯을 고정 렌더.
  // 범위를 벗어난 슬롯(곡 시작/끝 부근)은 빈 라인으로 채워 대칭을 유지 → 활성 라인이 정중앙.
  const center = activeIdx < 0 ? 0 : activeIdx;
  const rows: { text: string; offset: number; key: string }[] = [];
  for (let off = -WINDOW; off <= WINDOW; off++) {
    const i = center + off;
    rows.push({ text: i >= 0 && i < segments.length ? segments[i].text : '', offset: off, key: `${center}_${off}` });
  }

  const Inner = (
    <View style={styles.lyricsCol}>
      {rows.map(({ text, offset, key }) => {
        const active = offset === 0 && activeIdx >= 0;
        const dist = Math.abs(offset);
        return (
          <AppText
            key={key}
            variant={active ? 'title3' : 'body'}
            tone={active ? 'primary' : 'muted'}
            center
            style={[styles.lyricLine, { opacity: text ? (active ? 1 : dist === 1 ? 0.55 : 0.3) : 0 }]}
          >
            {text || ' '}
          </AppText>
        );
      })}
    </View>
  );

  if (coverUri) {
    return (
      <ImageBackground source={{ uri: coverUri }} style={[styles.wrap, { height }]} imageStyle={styles.bgImg} blurRadius={14}>
        <View style={styles.scrim} />
        {Inner}
      </ImageBackground>
    );
  }
  return <View style={[styles.wrap, { height, backgroundColor: colors.bg.surface1 }]}>{Inner}</View>;
}

const styles = StyleSheet.create({
  wrap: { width: '100%', borderRadius: 16, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
  bgImg: { borderRadius: 16 },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(13,8,32,0.74)' },
  // 세로 가운데 정렬 + 가로 패딩(박스폭에 맞춰 개행)
  lyricsCol: { width: '100%', alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl, gap: 10 },
  lyricLine: { width: '100%', lineHeight: 24 },
});
