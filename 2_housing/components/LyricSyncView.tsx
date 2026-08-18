// [LyricSyncView] 동영상 탭 가사 싱크(노래방식) — MAIDOL LyricSyncVideo 이식.
// 커버 배경 + 현재 재생 위치(positionMillis)에 맞춰 활성 가사 라인을 중앙으로 하이라이트.
// 계약: GET /tracks/{id}/lyrics-timeline → { has_timestamps, segments:[{text,start,end}] } (초 단위)
import { useMemo, useRef, useEffect } from 'react';
import { View, ScrollView, ImageBackground, StyleSheet } from 'react-native';
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

const LINE_H = 34;

export default function LyricSyncView({ segments, positionMillis, coverUri, height = 300 }: Props) {
  const scrollRef = useRef<ScrollView>(null);
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

  // 활성 라인이 바뀔 때만 중앙으로 스크롤
  useEffect(() => {
    if (activeIdx < 0) return;
    scrollRef.current?.scrollTo({ y: Math.max(0, activeIdx * LINE_H - height / 2 + LINE_H), animated: true });
  }, [activeIdx, height]);

  const Inner = (
    <ScrollView
      ref={scrollRef}
      style={{ height }}
      contentContainerStyle={{ paddingVertical: height / 2 }}
      showsVerticalScrollIndicator={false}
      scrollEnabled={false}
    >
      {segments.map((s, i) => {
        const dist = Math.abs(i - activeIdx);
        const active = i === activeIdx;
        return (
          <View key={i} style={styles.line}>
            <AppText
              variant={active ? 'title3' : 'body'}
              tone={active ? 'primary' : 'muted'}
              center
              style={{ opacity: active ? 1 : dist === 1 ? 0.6 : 0.3 }}
            >
              {s.text}
            </AppText>
          </View>
        );
      })}
    </ScrollView>
  );

  if (coverUri) {
    return (
      <ImageBackground source={{ uri: coverUri }} style={[styles.wrap, { height }]} imageStyle={styles.bgImg} blurRadius={12}>
        <View style={styles.scrim} />
        {Inner}
      </ImageBackground>
    );
  }
  return <View style={[styles.wrap, { height, backgroundColor: colors.bg.surface1 }]}>{Inner}</View>;
}

const styles = StyleSheet.create({
  wrap: { width: '100%', borderRadius: 16, overflow: 'hidden', justifyContent: 'center' },
  bgImg: { borderRadius: 16 },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(13,8,32,0.72)' },
  line: { height: LINE_H, justifyContent: 'center', paddingHorizontal: spacing.lg },
});
