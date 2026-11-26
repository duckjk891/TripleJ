// v3.446 [DiaryInline] 글·사진을 저장 순서대로 보여 주는 공용 본문(곡·착장 아이템은 호출부가 아래에 따로 그린다).
//  · detail: 낙서 상세 — 줄 노트 전체  · card: 낙서장 목록 — 글은 줄여 보이고 [더 보기]  · plain: 채널·마이페이지·크루 게시판
// 예전 낙서(글 → 사진)는 순서가 그대로라 지금과 똑같이 보인다.
// v3.449: card + 낙서 = 사진 전부 위·글 아래(인스타처럼). card 공지(낙서 아님)는 쓴 순서 그대로.
import { StyleProp, StyleSheet, TextStyle, TouchableOpacity, View } from 'react-native';
import { AppText } from '../ui';
import LinedPaper, { NOTE, noteTextStyle } from '../diary/LinedPaper';
import FeedImageBlock, { feedImageUri } from './FeedImageBlock';
import { bodyParts, cardParts } from '../../utils/feedBlocks';
import FeedPhotoGallery from './FeedPhotoGallery'; // v3.449 [DiaryPhotoTop]
import { radius, spacing } from '../../theme/spacing';

const CARD_FIRST_LINES = 5;
const CARD_NEXT_LINES = 3;
const CARD_MAX_IMAGES = 5;

interface Props {
  blocks: any[];
  variant: 'detail' | 'card' | 'plain';
  /** 낙서(줄 노트·손글씨)인가 — 아니면 일반 글자 */
  diary?: boolean;
  fontFamily?: string | null;
  textStyle?: StyleProp<TextStyle>;
  /** card — 잘린 글·남은 사진을 누르면(상세로) */
  onMore?: () => void;
}

const isLong = (t: string, lines: number, chars: number) => t.split('\n').length > lines || t.length > chars;

export default function FeedBody({ blocks, variant, diary, fontFamily, textStyle, onMore }: Props) {
  // v3.449 [DiaryPhotoTop] 낙서장 목록의 낙서 = 사진 전부 위(옆으로 넘기기)·글 아래(인스타처럼). 상세는 아래 쓴 순서 그대로.
  if (variant === 'card' && diary) {
    const { images, text } = cardParts(blocks);
    const uris = images.map((b) => feedImageUri(b)).filter(Boolean) as string[];
    const long = !!text && isLong(text, CARD_FIRST_LINES, 110);
    const cardFont = fontFamily ? { fontFamily } : null;
    return (
      <View>
        <FeedPhotoGallery uris={uris} />
        {text ? (
          <TouchableOpacity activeOpacity={0.85} disabled={!long || !onMore} onPress={onMore} style={uris.length ? styles.next : styles.first}>
            <LinedPaper>
              <AppText numberOfLines={CARD_FIRST_LINES} style={[noteTextStyle, cardFont]}>{text}</AppText>
            </LinedPaper>
            {long ? <AppText variant="caption" tone="accent" style={styles.more}>더 보기</AppText> : null}
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }
  const parts = bodyParts(blocks);
  const imageCount = parts.filter((p) => p.kind === 'image').length;
  // 사진 뒤에 글이 이어지면 블로그형 — 짧은 글도 줄 수만큼만(예전 모양 글→사진은 최소 3줄 그대로)
  const inline = parts.some((p, i) => p.kind === 'text' && parts.slice(0, i).some((q) => q.kind === 'image'));
  // 블로그형 낙서는 쓰는 화면처럼 한 장의 종이에 글·사진이 이어진다
  const sheet = !!diary && inline && variant !== 'plain';
  const hidden = variant === 'card' && imageCount > CARD_MAX_IMAGES ? imageCount - CARD_MAX_IMAGES : 0;
  const font = fontFamily ? { fontFamily } : null;
  let shownImages = 0;
  let textIndex = -1;
  const out: any[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.kind === 'image') {
      if (hidden && shownImages >= CARD_MAX_IMAGES) break; // 넘친 사진부터는 [더 보기]로
      const uri = feedImageUri(p.block);
      if (uri) {
        out.push(sheet
          ? <View key={`im${i}`} style={styles.sheetImage}><FeedImageBlock uri={uri} /></View>
          : <FeedImageBlock key={`im${i}`} uri={uri} />);
        shownImages++;
      }
      continue;
    }
    textIndex++;
    if (!diary) {
      out.push(<AppText key={`t${i}`} variant="body" style={textStyle}>{p.text}</AppText>);
      continue;
    }
    if (variant === 'detail') {
      out.push(
        <LinedPaper key={`t${i}`} minLines={inline ? 1 : 3} style={sheet ? styles.flat : i === 0 ? styles.first : styles.next}>
          <AppText style={[noteTextStyle, font]}>{p.text}</AppText>
        </LinedPaper>,
      );
      continue;
    }
    const lines = textIndex === 0 ? CARD_FIRST_LINES : CARD_NEXT_LINES;
    const long = isLong(p.text, lines, textIndex === 0 ? 110 : 66);
    out.push(
      <TouchableOpacity key={`t${i}`} activeOpacity={0.85} disabled={!long || !onMore} onPress={onMore} style={sheet ? null : i === 0 ? styles.first : styles.next}>
        <LinedPaper style={sheet ? styles.flat : null}>
          <AppText numberOfLines={lines} style={[noteTextStyle, font]}>{p.text}</AppText>
        </LinedPaper>
        {long ? <AppText variant="caption" tone="accent" style={[styles.more, sheet && styles.sheetMore]}>더 보기</AppText> : null}
      </TouchableOpacity>,
    );
  }
  if (hidden) {
    out.push(
      <TouchableOpacity key="more" activeOpacity={0.8} disabled={!onMore} onPress={onMore} accessibilityLabel={`사진 ${hidden}장 더 보기`}>
        <AppText variant="caption" tone="accent" style={[styles.more, sheet && styles.sheetMore]}>{`사진 ${hidden}장 더 보기`}</AppText>
      </TouchableOpacity>,
    );
  }
  return <View style={sheet ? styles.sheet : null}>{out}</View>;
}

const styles = StyleSheet.create({
  first: { marginTop: spacing.sm },
  next: { marginTop: spacing.md },
  sheet: { marginTop: spacing.sm, backgroundColor: NOTE.paper, borderRadius: radius.md, overflow: 'hidden', paddingBottom: spacing.sm },
  flat: { borderRadius: 0 },
  sheetImage: { paddingHorizontal: NOTE.padX },
  sheetMore: { marginRight: NOTE.padX, color: '#7c3aed', fontWeight: '700' },
  more: { alignSelf: 'flex-end', marginTop: 4 },
});
