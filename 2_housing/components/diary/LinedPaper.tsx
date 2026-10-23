// v3.403 [LinedNote] 낙서 줄 노트(대표 10-23 "줄글 노트 형태로 입력되는 거 아니었어?").
// 글 높이를 재서(onLayout·onContentSizeChange) 글자 한 줄(lineHeight)마다 가로줄을 그린다 — 웹·앱 공통(줄 = View).
// 줄은 글자 줄 상자의 아래쪽에서 NOTE.sink 만큼 올라온 자리(글자가 줄 위에 앉게). 왼쪽 빨간 여백선은 대표 요청으로 뺌(10-23).
// 입력칸은 내부 스크롤 없이 글 길이만큼 늘어나고(바깥 화면이 스크롤) 줄도 같이 늘어나 어긋나지 않는다.
import { ReactNode, useState } from 'react';
import { View, Text, TextInput, TextInputProps, StyleSheet, Platform, StyleProp, ViewStyle } from 'react-native';
import { radius } from '../../theme/spacing';

export const NOTE = {
  lineHeight: 28,
  fontSize: 20,
  padTop: 6,
  padBottom: 8,
  padX: 14,       // 좌우 여백(여백선 없음)
  sink: 7,        // 줄 상자 아래에서 줄까지 — 웹 실측: 중학생체 20px 한글 바닥 ≈ 줄 상자 위에서 21px
  paper: '#1b1338',
  ink: '#f3edff',
  line: 'rgba(192,132,252,0.24)',
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
      </View>
      <View style={styles.body}>{children}</View>
    </View>
  );
}

/** 줄 노트 입력칸 — 글 길이만큼 늘고 줄어드는 여러 줄 입력(내부 스크롤 없음).
 *  높이는 같은 글꼴·폭의 보이지 않는 글자 사본(Text)을 재서 정한다 — 웹 textarea 의 contentSize(scrollHeight)는
 *  상자 높이 아래로 줄지 않아(화면 폭이 잠깐 바뀌면 커진 채 남음) 쓰지 않는다. 웹·앱 공통, 되먹임 없음. */
export function LinedTextInput({ minLines = 6, style, value, ...rest }: TextInputProps & { minLines?: number }) {
  const [textH, setTextH] = useState(0);
  // 글 줄 수 + 빈 줄 1개(쓰는 줄 아래에 항상 여유 줄)
  const lines = Math.max(minLines, Math.ceil(Math.round(textH) / NOTE.lineHeight) + 1);
  const fontFamily = (StyleSheet.flatten(style) as any)?.fontFamily;
  return (
    <LinedPaper minLines={lines}>
      <View>
        <Text
          style={[noteTextStyle, styles.mirror, fontFamily ? { fontFamily } : null]}
          onLayout={(e) => setTextH(e.nativeEvent.layout.height)}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {(value || '') + '\u200b'}
        </Text>
        <TextInput
          {...rest}
          value={value}
          multiline
          scrollEnabled={false}
          textAlignVertical="top"
          placeholderTextColor={rest.placeholderTextColor || NOTE.placeholder}
          style={[noteTextStyle, styles.input, { height: lines * NOTE.lineHeight }, style]}
        />
      </View>
    </LinedPaper>
  );
}

const styles = StyleSheet.create({
  paper: { backgroundColor: NOTE.paper, borderRadius: radius.md, overflow: 'hidden' },
  rule: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth * 2, backgroundColor: NOTE.line },
  mirror: { position: 'absolute', top: 0, left: 0, right: 0, opacity: 0 },
  body: { paddingTop: NOTE.padTop, paddingBottom: NOTE.padBottom, paddingLeft: NOTE.padX, paddingRight: NOTE.padX },
  input: {
    padding: 0, paddingTop: 0, paddingBottom: 0, margin: 0,
    ...(Platform.OS === 'android' ? { includeFontPadding: false } : null),
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none', resize: 'none', overflow: 'hidden' } as any) : null),
  },
});
