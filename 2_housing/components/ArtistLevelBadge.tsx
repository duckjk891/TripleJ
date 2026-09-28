// v3.251 [Recog] 아티스트 인지도 휘장 — 티어별 5종 순수 SVG + 세부 단계 숫자 뱃지(우하단 원형).
//  · 연습생 = 무광 이름표 / 신인 = 브론즈 마이크 / 루키 = 실버 마이크 /
//    라이징 = 골드 마이크 + 스포트라이트 / 아이돌 = MAIDOL 크레스트(방패+별).
//  · 이모지·이미지 에셋 금지 — react-native-svg 기하 도형만. 다크테마(colors 토큰) 대응.
//  · sizes: sm(16) / md(22) / lg(28). 숫자(px) 지정 = 승급 다이얼로그 등 대형 전시용.
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Polygon, Rect } from 'react-native-svg';
import { colors } from '../theme/colors';
import { recognitionLabel, type RecognitionSub, type RecognitionTier } from '../data/levels';

export type ArtistBadgeSize = 'sm' | 'md' | 'lg' | number;

export const BADGE_SIZES: Record<'sm' | 'md' | 'lg', number> = { sm: 16, md: 22, lg: 28 };

/** 티어별 금속 팔레트 — 다크 배경(bg.deepest~surface2) 위 대비 검증값 */
export const TIER_BADGE_COLORS: Record<RecognitionTier, { main: string; dim: string; accent: string }> = {
  trainee: { main: '#8a8496', dim: '#5c5668', accent: '#a8a2b4' }, // 무광 회보라
  newcomer: { main: '#cd8a4f', dim: '#8a5a30', accent: '#e8b07a' }, // 브론즈
  rookie: { main: '#c9ced6', dim: '#8b919c', accent: '#eef1f5' }, // 실버
  rising: { main: colors.accent.secondary, dim: colors.accent.secondaryDim, accent: '#fde68a' }, // 골드
  idol: { main: colors.accent.secondary, dim: colors.accent.primary, accent: '#fde68a' }, // 골드+보라 크레스트
};

interface Props {
  tier: RecognitionTier;
  sub: RecognitionSub | number;
  size?: ArtistBadgeSize;
  /** 우하단 세부 단계 숫자 뱃지 표시(기본 true) */
  showSub?: boolean;
  testID?: string;
}

/** 마이크(신인·루키·라이징 공용) — 헤드 원 + 그릴 + 스탠드 */
function MicShape({ main, dim, accent }: { main: string; dim: string; accent: string }) {
  return (
    <>
      <Circle cx={12} cy={8} r={5} fill={main} stroke={dim} strokeWidth={1} />
      <Line x1={9.2} y1={6.2} x2={14.8} y2={6.2} stroke={dim} strokeWidth={0.9} />
      <Line x1={8.6} y1={8.2} x2={15.4} y2={8.2} stroke={dim} strokeWidth={0.9} />
      <Line x1={9.2} y1={10.2} x2={14.8} y2={10.2} stroke={dim} strokeWidth={0.9} />
      <Path d="M6.8 9.5 A5.6 5.6 0 0 0 17.2 9.5" fill="none" stroke={accent} strokeWidth={1.3} strokeLinecap="round" />
      <Line x1={12} y1={15} x2={12} y2={19} stroke={main} strokeWidth={1.6} strokeLinecap="round" />
      <Line x1={8.5} y1={20.5} x2={15.5} y2={20.5} stroke={main} strokeWidth={1.6} strokeLinecap="round" />
    </>
  );
}

/** 5각 별 — 크레스트 중앙용 */
function starPoints(cx: number, cy: number, rOut: number, rIn: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? rOut : rIn;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
}

function TierGlyph({ tier }: { tier: RecognitionTier }) {
  const c = TIER_BADGE_COLORS[tier];
  switch (tier) {
    case 'trainee':
      // 무광 이름표 — 클립 + 명찰(텍스트 자리 선 2개)
      return (
        <>
          <Rect x={10.4} y={3.5} width={3.2} height={4} rx={1} fill={c.dim} />
          <Rect x={3.5} y={6.5} width={17} height={13.5} rx={2.5} fill={c.main} stroke={c.dim} strokeWidth={1} />
          <Line x1={6.5} y1={11.5} x2={17.5} y2={11.5} stroke={c.dim} strokeWidth={1.4} strokeLinecap="round" />
          <Line x1={6.5} y1={15.5} x2={13.5} y2={15.5} stroke={c.dim} strokeWidth={1.4} strokeLinecap="round" />
        </>
      );
    case 'newcomer':
    case 'rookie':
      return <MicShape main={c.main} dim={c.dim} accent={c.accent} />;
    case 'rising':
      // 골드 마이크 + 스포트라이트 빔
      return (
        <>
          <Polygon points="12,1 3,22 21,22" fill={c.main} opacity={0.22} />
          <MicShape main={c.main} dim={c.dim} accent={c.accent} />
        </>
      );
    case 'idol':
      // MAIDOL 크레스트 — 방패(보라) + 골드 테두리 + 중앙 별
      return (
        <>
          <Path
            d="M12 2 L21 5.5 V12.5 C21 17.8 17.2 21 12 22.5 C6.8 21 3 17.8 3 12.5 V5.5 Z"
            fill={colors.bg.surface2}
            stroke={c.main}
            strokeWidth={1.6}
          />
          <Polygon points={starPoints(12, 11.8, 5, 2.1)} fill={c.main} stroke={c.accent} strokeWidth={0.6} />
          <Line x1={7} y1={18} x2={17} y2={18} stroke={c.main} strokeWidth={1.2} strokeLinecap="round" />
        </>
      );
    default:
      return null;
  }
}

export default function ArtistLevelBadge({ tier, sub, size = 'md', showSub = true, testID }: Props) {
  const px = typeof size === 'number' ? size : BADGE_SIZES[size];
  const c = TIER_BADGE_COLORS[tier] || TIER_BADGE_COLORS.trainee;
  // 세부 숫자 뱃지 — 우하단 원형(본체와 겹침). sm(16)에서도 판독 가능한 최소 10px.
  const subD = Math.max(10, Math.round(px * 0.52));
  const subFont = Math.max(7, Math.round(subD * 0.62));
  return (
    <View
      style={{ width: px, height: px }}
      testID={testID}
      accessibilityLabel={`${recognitionLabel(tier, Number(sub))} 휘장`}
    >
      <Svg width={px} height={px} viewBox="0 0 24 24">
        <TierGlyph tier={tier} />
      </Svg>
      {showSub && (
        <View
          style={[
            styles.subBadge,
            {
              width: subD,
              height: subD,
              borderRadius: subD / 2,
              right: -Math.round(subD * 0.25),
              bottom: -Math.round(subD * 0.2),
              borderColor: c.main,
            },
          ]}
        >
          <Text style={[styles.subText, { fontSize: subFont, lineHeight: subFont + 1 }]}>{sub}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  subBadge: {
    position: 'absolute',
    backgroundColor: colors.bg.deepest,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subText: {
    color: colors.text.primary,
    fontWeight: '800',
  },
});
