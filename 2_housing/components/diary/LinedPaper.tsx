// v3.403 [LinedNote] 낙서 줄 노트(대표 10-23 "줄글 노트 형태로 입력되는 거 아니었어?").
// 글 높이를 재서(onLayout·onContentSizeChange) 글자 한 줄(lineHeight)마다 가로줄을 그린다 — 웹·앱 공통(줄 = View).
// 줄은 글자 줄 상자의 아래쪽에서 NOTE.sink 만큼 올라온 자리(글자가 줄 위에 앉게), 왼쪽엔 옅은 빨간 여백선.
// 입력칸은 내부 스크롤 없이 글 길이만큼 늘어나고(바깥 화면이 스크롤) 줄도 같이 늘어나 어긋나지 않는다.
import { ReactNode, useState } from 'react';
import { View, TextInput, TextInputProps, StyleSheet, Platform, StyleProp, ViewStyle } from 'react-native';
import { radius } from '../../theme/spacing';

export const NOTE = {
  lineHeight: 28,
  fontSize: 18,
  padTop: 6,
  padBottom: 8,
  marginLeft: 26, // 여백선 위치
  sink: 6,        // 줄 상자 아래에서 줄까지(중학생체 글자 바닥에 맞춤)
  paper: '#1b1338',
  ink: '#f3edff',
  line: 'rgba(192,132,252,0.24)',
  margin: 'rgba(248,113,113,0.38)',
  placeholder: '#7d6aa8',
};

/** 줄 노트 글자 스타일(손글씨 글꼴은 호출부가 fontFamily 로) */
export const noteTextStyle = { fontSize: NOTE.fontSize, lineHeight: NOTE.lineHeight, color: NOTE.ink };

const MAX_LINES = 400;

interface PaperProps {
  children: ReactNode;
  minLines?: number;
  style?: StyleProp<ViewStyle>;
}

export default function LinedPaper({ children, minLines = 1, style }: PaperProps) {
  const [h, setH] = useState(0);
  const avail = h - NOTE.padTop - NOTE.padBottom;
  const count = Math.min(MAX_LINES, Math.max(minLines, Math.round(avail / NOTE.lineHeight)));
  return (
    <View style={[styles.paper, style]} onLayout={(e) => setH(e.nativeEvent.layout.height)}>
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {Array.from({ length: count }, (_, i) => (
          <View key={i} style={[styles.rule, { top: NOTE.padTop + (i + 1) * NOTE.lineHeight - NOTE.sink }]} />
        ))}
        <View style={styles.marginLine} />
      </View>
      <View style={styles.body}>{children}</View>
    </View>
  );
}

/** 줄 노트 입력칸 — 글 길이만큼 늘어나는 여러 줄 입력(내부 스크롤 없음) */
export function LinedTextInput({ minLines = 6, style, onContentSizeChange, ...rest }: TextInputProps & { minLines?: number }) {
  const [contentH, setContentH] = useState(0);
  const lines = Math.max(minLines, Math.ceil((contentH || 0) / NOTE.lineHeight));
  return (
    <LinedPaper minLines={lines}>
      <TextInput
        {...rest}
        multiline
        scrollEnabled={false}
        textAlignVertical="top"
        placeholderTextColor={rest.placeholderTextColor || NOTE.placeholder}
        onContentSizeChange={(e) => {
          setContentH(e.nativeEvent.contentSize.height);
          onContentSizeChange?.(e);
        }}
        style={[
          noteTextStyle,
          styles.input,
          { height: lines * NOTE.lineHeight },
          style,
        ]}
      />
    </LinedPaper>
  );
}

const styles = StyleSheet.create({
  paper: { backgroundColor: NOTE.paper, borderRadius: radius.md, overflow: 'hidden' },
  rule: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth * 2, backgroundColor: NOTE.line },
  marginLine: { position: 'absolute', top: 0, bottom: 0, left: NOTE.marginLeft - 8, width: 1.5, backgroundColor: NOTE.margin },
  body: { paddingTop: NOTE.padTop, paddingBottom: NOTE.padBottom, paddingLeft: NOTE.marginLeft, paddingRight: 12 },
  input: {
    padding: 0, paddingTop: 0, paddingBottom: 0, margin: 0,
    ...(Platform.OS === 'android' ? { includeFontPadding: false } : null),
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none', resize: 'none', overflow: 'hidden' } as any) : null),
  },
});
