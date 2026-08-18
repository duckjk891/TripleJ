// [DraggableQueue] 재생목록(큐)을 드래그로 순서 편집. 외부 제스처 라이브러리 없이 내장 PanResponder만 사용.
// 우측 그립(≡) 핸들을 잡고 위/아래로 끌면 순서가 바뀌고, 놓으면 onReorder(from,to) 호출.
// 고정 행 높이(ROW_H) 기반: 끌리는 행은 translateY로 손가락을 따라오고, 사이 행들은 ±ROW_H로 자리를 비켜준다.
// 주의: PanResponder는 반드시 렌더마다 재생성하지 말 것(제스처 중 재생성 시 responder가 terminate됨).
//       → index별로 한 번만 만들어 캐시(respondersRef)하고, 가변값(data 길이/콜백)은 ref로 최신값 참조.
import { useRef, useState } from 'react';
import { View, Animated, PanResponder, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { AppText } from './ui';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';

const ROW_H = 60;

interface Props {
  data: any[];
  currentIndex: number;
  onReorder: (from: number, to: number) => void;
  onPress: (index: number) => void;
  onRemove: (index: number) => void;
}

export default function DraggableQueue({ data, currentIndex, onReorder, onPress, onRemove }: Props) {
  const [dragIndex, setDragIndex] = useState(-1); // 현재 끌고 있는 원본 인덱스
  const [target, setTarget] = useState(-1);       // 드롭될 목표 인덱스
  const dragY = useRef(new Animated.Value(0)).current;
  const dragIndexRef = useRef(-1);
  const targetRef = useRef(-1);

  // 렌더마다 바뀌는 값을 gesture 콜백이 최신으로 참조하도록 ref에 보관
  const lenRef = useRef(data.length); lenRef.current = data.length;
  const onReorderRef = useRef(onReorder); onReorderRef.current = onReorder;

  const reset = () => {
    dragIndexRef.current = -1; targetRef.current = -1;
    setDragIndex(-1); setTarget(-1); dragY.setValue(0);
  };
  const resetRef = useRef(reset); resetRef.current = reset;

  // index별 PanResponder를 최초 1회만 생성해 캐시 → 제스처 도중 재생성 방지
  const respondersRef = useRef<Record<number, any>>({});
  const getResponder = (index: number) => {
    if (respondersRef.current[index]) return respondersRef.current[index];
    const pr = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 2,
      onMoveShouldSetPanResponderCapture: (_e, g) => Math.abs(g.dy) > 2,
      onPanResponderGrant: () => {
        dragIndexRef.current = index; targetRef.current = index;
        setDragIndex(index); setTarget(index); dragY.setValue(0);
      },
      onPanResponderMove: (_e, g) => {
        dragY.setValue(g.dy);
        const raw = index + Math.round(g.dy / ROW_H);
        const clamped = Math.max(0, Math.min(lenRef.current - 1, raw));
        if (clamped !== targetRef.current) { targetRef.current = clamped; setTarget(clamped); }
      },
      onPanResponderRelease: () => {
        const from = dragIndexRef.current, to = targetRef.current;
        resetRef.current();
        if (from !== to && from >= 0 && to >= 0) {
          if (__DEV__) console.info('[DraggableQueue] reorder', { from, to });
          onReorderRef.current(from, to);
        }
      },
      onPanResponderTerminate: () => resetRef.current(),
    });
    respondersRef.current[index] = pr;
    return pr;
  };

  // 끌리는 중이 아닌 행 i가, drag(d)→target(t) 이동에 맞춰 비켜줄 오프셋
  const shiftFor = (i: number): number => {
    const d = dragIndex, t = target;
    if (d < 0 || i === d) return 0;
    if (d < t && i > d && i <= t) return -ROW_H; // 아래로 이동 → 사이 행 위로
    if (d > t && i >= t && i < d) return ROW_H;  // 위로 이동 → 사이 행 아래로
    return 0;
  };

  return (
    <View style={{ height: data.length * ROW_H }}>
      {data.map((q: any, i: number) => {
        const playing = i === currentIndex;
        const isDragging = i === dragIndex;
        const rowStyle = isDragging
          ? { top: i * ROW_H, transform: [{ translateY: dragY }], zIndex: 20, elevation: 8 }
          : { top: i * ROW_H, transform: [{ translateY: shiftFor(i) }], zIndex: 0 };
        return (
          <Animated.View key={`${q?.id}-${i}`} style={[styles.row, isDragging && styles.rowDragging, rowStyle]}>
            <TouchableOpacity style={styles.main} activeOpacity={0.7} onPress={() => onPress(i)}>
              <AppText variant="footnote" tone={playing ? 'accent' : 'muted'} style={styles.idx}>{playing ? '▶' : i + 1}</AppText>
              <View style={{ flex: 1 }}>
                <AppText variant="body" tone={playing ? 'accent' : 'primary'} numberOfLines={1}>{q?.title || '제목 없음'}</AppText>
                <AppText variant="caption" tone="muted" numberOfLines={1}>{q?.artist_name || q?.uploader_nickname || '아티스트'}</AppText>
              </View>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => onRemove(i)} accessibilityLabel="목록에서 제거" style={styles.iconBtn}>
              <Feather name="x" size={16} color={colors.text.muted} />
            </TouchableOpacity>
            {/* 드래그 핸들 — 이 영역을 잡고 끌어 순서 변경 */}
            <View style={styles.handle} {...getResponder(i).panHandlers} accessibilityLabel="순서 변경 손잡이">
              <Feather name="menu" size={18} color={colors.text.muted} />
            </View>
          </Animated.View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    position: 'absolute', left: 0, right: 0, height: ROW_H,
    flexDirection: 'row', alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.subtle,
    backgroundColor: colors.bg.surface1,
  },
  rowDragging: {
    backgroundColor: colors.bg.surface2,
    borderRadius: 10, borderBottomWidth: 0,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 8,
  },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  idx: { width: 24 },
  iconBtn: { padding: 8 },
  handle: { paddingHorizontal: 6, paddingVertical: 12 },
});

export { ROW_H };
