// v3.446 [DiaryInline] 낙서 쓰는 종이 — 글 칸과 사진이 한 장의 줄 노트에 이어진다. 사진은 커서 자리에 들어간다.
import { MutableRefObject, useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { AppText } from '../ui';
import { LinedTextInput, NOTE } from './LinedPaper';
import { colors } from '../../theme/colors';
import { radius, spacing } from '../../theme/spacing';
import { Seg, SegCursor, canMoveImage } from '../../utils/feedBlocks';

export interface EditorImage {
  key: string;
  localUri: string;
  status: 'uploading' | 'done' | 'failed';
}

interface Props {
  segs: Seg[];
  images: EditorImage[];
  cursorRef: MutableRefObject<SegCursor | null>;
  fontFamily?: string | null;
  placeholder: string;
  maxTotal: number;
  onChangeText: (key: string, text: string) => void;
  onPressImage: (imgKey: string) => void;
  onMoveImage: (imgKey: string, dir: 'up' | 'down') => void;
  onRemoveImage: (imgKey: string) => void;
}

export default function DiaryEditor({
  segs, images, cursorRef, fontFamily, placeholder, maxTotal, onChangeText, onPressImage, onMoveImage, onRemoveImage,
}: Props) {
  const total = segs.reduce((n, s) => n + (s.type === 'text' ? s.text.length : 0), 0);
  const single = segs.length === 1;
  const allEmpty = total === 0;
  return (
    <View style={styles.sheet}>
      {segs.map((s, i) => {
        if (s.type === 'image') {
          const img = images.find((x) => x.key === s.imgKey);
          if (!img) return null;
          return (
            <InlinePhoto
              key={s.key}
              img={img}
              canUp={canMoveImage(segs, s.imgKey, 'up')}
              canDown={canMoveImage(segs, s.imgKey, 'down')}
              onPress={() => onPressImage(s.imgKey)}
              onMove={(d) => onMoveImage(s.imgKey, d)}
              onRemove={() => onRemoveImage(s.imgKey)}
            />
          );
        }
        const last = i === segs.length - 1;
        return (
          <LinedTextInput
            key={s.key}
            minLines={single ? 6 : last ? 3 : 1}
            spareLines={last ? 1 : 0}
            style={fontFamily ? { fontFamily } : null}
            placeholder={i === 0 && allEmpty ? placeholder : i === 0 ? '사진 위에 쓰기' : '이어서 쓰기'}
            value={s.text}
            onChangeText={(t) => onChangeText(s.key, t)}
            onFocus={() => {
              if (cursorRef.current?.key !== s.key) cursorRef.current = { key: s.key, start: s.text.length };
            }}
            onSelectionChange={(e) => { cursorRef.current = { key: s.key, start: e.nativeEvent.selection.start }; }}
            maxLength={Math.max(s.text.length, maxTotal - (total - s.text.length))}
            accessibilityLabel={single ? '낙서 내용' : `낙서 내용 ${i / 2 + 1}번째 칸`}
          />
        );
      })}
    </View>
  );
}

function InlinePhoto({ img, canUp, canDown, onPress, onMove, onRemove }: {
  img: EditorImage; canUp: boolean; canDown: boolean; onPress: () => void; onMove: (d: 'up' | 'down') => void; onRemove: () => void;
}) {
  const [ratio, setRatio] = useState(4 / 3);
  useEffect(() => {
    let alive = true;
    if (!img.localUri) return undefined;
    Image.getSize(img.localUri, (w, h) => {
      if (alive && w > 0 && h > 0) setRatio(Math.min(Math.max(w / h, 0.6), 3));
    }, () => {});
    return () => { alive = false; };
  }, [img.localUri]);
  return (
    <View style={styles.photoWrap}>
      <TouchableOpacity
        activeOpacity={0.85}
        disabled={img.status === 'uploading'}
        onPress={onPress}
        accessibilityLabel={img.status === 'failed' ? '사진 업로드 재시도' : '사진 — 다시 찍기·삭제'}
      >
        <Image source={{ uri: img.localUri }} style={[styles.photo, { aspectRatio: ratio }, img.status !== 'done' && { opacity: 0.45 }]} resizeMode="cover" />
      </TouchableOpacity>
      {img.status === 'uploading' ? (
        <View style={styles.overlay} pointerEvents="none"><ActivityIndicator size="large" color={colors.accent.primary} /></View>
      ) : null}
      {img.status === 'failed' ? (
        <View style={styles.overlay} pointerEvents="none">
          <Feather name="alert-circle" size={24} color={colors.status.error} />
          <AppText variant="caption" style={styles.failText}>눌러서 다시 올리기</AppText>
        </View>
      ) : null}
      <View style={styles.tools}>
        <Tool icon="arrow-up" label="사진을 위로" disabled={!canUp} onPress={() => onMove('up')} />
        <Tool icon="arrow-down" label="사진을 아래로" disabled={!canDown} onPress={() => onMove('down')} />
        <Tool icon="x" label="사진 제거" onPress={onRemove} />
      </View>
    </View>
  );
}

function Tool({ icon, label, disabled, onPress }: { icon: any; label: string; disabled?: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.tool, disabled && { opacity: 0.35 }]}
      disabled={disabled}
      onPress={onPress}
      hitSlop={{ top: 6, bottom: 6, left: 3, right: 3 }}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Feather name={icon} size={15} color="#fff" />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  sheet: { backgroundColor: NOTE.paper, borderRadius: radius.md, overflow: 'hidden' },
  photoWrap: { marginHorizontal: NOTE.padX, marginVertical: spacing.xs },
  photo: { width: '100%', borderRadius: radius.md, backgroundColor: '#e4d8b8' },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 4 },
  failText: { color: NOTE.ink, fontWeight: '700' },
  tools: { position: 'absolute', top: spacing.sm, right: spacing.sm, flexDirection: 'row', gap: 6 },
  tool: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(20,12,40,0.72)', alignItems: 'center', justifyContent: 'center' },
});
