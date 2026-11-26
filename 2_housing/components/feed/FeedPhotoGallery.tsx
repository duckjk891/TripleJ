// v3.449 [DiaryPhotoTop] 낙서장 목록 카드 맨 위 사진첩(인스타처럼, 오리쟁이 11-09 제안·대표 11-26).
// 사진 1장 = FeedImageBlock 그대로. 2장 이상 = 옆으로 넘기는 한 장씩 보기 + "1/3" 표시 + 아래 점.
// 높이는 첫 사진 비율(0.8~1.91 사이로 맞춤)로 고정해 넘길 때 카드 높이가 출렁이지 않게. 누르면 크게 보기(AppModal — iOS 창 겹침 방지).
import { useEffect, useState } from 'react';
import { View, Image, ScrollView, TouchableOpacity, StyleSheet, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import AppModal from '../AppModal';
import { AppText } from '../ui';
import FeedImageBlock from './FeedImageBlock';
import { colors } from '../../theme/colors';
import { spacing, radius } from '../../theme/spacing';

const clampRatio = (r: number) => Math.min(Math.max(r, 0.8), 1.91);

export default function FeedPhotoGallery({ uris }: { uris: string[] }) {
  const [width, setWidth] = useState(0);
  const [ratio, setRatio] = useState(1);
  const [page, setPage] = useState(0);
  const [viewer, setViewer] = useState<string | null>(null);
  const first = uris[0];

  useEffect(() => {
    if (!first || uris.length < 2) return;
    let alive = true;
    Image.getSize(
      first,
      (w, h) => { if (alive && w > 0 && h > 0) setRatio(clampRatio(w / h)); },
      () => {},
    );
    return () => { alive = false; };
  }, [first, uris.length]);

  if (!uris.length) return null;
  if (uris.length === 1) return <FeedImageBlock uri={uris[0]} />;

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!width) return;
    const p = Math.round(e.nativeEvent.contentOffset.x / width);
    if (p !== page && p >= 0 && p < uris.length) setPage(p);
  };

  return (
    <View style={styles.wrap} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 ? (
        <ScrollView
          horizontal
          pagingEnabled
          nestedScrollEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={32}
          style={[styles.pager, { height: width / ratio }]}
        >
          {uris.map((u, i) => (
            <TouchableOpacity key={`${i}${u}`} activeOpacity={0.9} onPress={() => setViewer(u)} accessibilityLabel={`사진 ${i + 1} 크게 보기`}>
              <Image source={{ uri: u }} style={{ width, height: width / ratio }} resizeMode="cover" />
            </TouchableOpacity>
          ))}
        </ScrollView>
      ) : (
        <View style={[styles.pager, { aspectRatio: ratio }]} />
      )}
      <View style={styles.counter} pointerEvents="none">
        <AppText variant="caption" style={styles.counterText}>{`${page + 1}/${uris.length}`}</AppText>
      </View>
      <View style={styles.dots} pointerEvents="none">
        {uris.map((_, i) => <View key={i} style={[styles.dot, i === page && styles.dotOn]} />)}
      </View>

      <AppModal visible={!!viewer} transparent animationType="fade" onRequestClose={() => setViewer(null)}>
        <TouchableOpacity style={styles.viewerBackdrop} activeOpacity={1} onPress={() => setViewer(null)}>
          {viewer ? <Image source={{ uri: viewer }} style={styles.viewerImage} resizeMode="contain" /> : null}
          <TouchableOpacity style={styles.viewerCloseBtn} onPress={() => setViewer(null)} accessibilityLabel="닫기">
            <AppText variant="footnote" style={styles.viewerCloseText}>닫기</AppText>
          </TouchableOpacity>
        </TouchableOpacity>
      </AppModal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.md },
  pager: { width: '100%', borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.bg.surface2 },
  counter: {
    position: 'absolute', top: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2,
  },
  counterText: { color: '#fff', fontWeight: '700' },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 5, marginTop: 8 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.text.muted, opacity: 0.4 },
  dotOn: { backgroundColor: colors.accent.primary, opacity: 1 },
  viewerBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  viewerImage: { width: '100%', height: '75%' },
  viewerCloseBtn: { marginTop: spacing.lg, backgroundColor: colors.bg.surface2, borderRadius: radius.lg, paddingHorizontal: 28, paddingVertical: 10 },
  viewerCloseText: { fontWeight: '600', color: colors.text.primary },
});
