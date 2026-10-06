// v3.281 [CodyBoard] 코디 보드 "입혀보기"(대표 승인 1안) — 순수 UI(서버·과금 없음).
// 세로 3:4 보드: 가운데 = 꾸미는 대상 캐릭터(시트 미리보기, contain), 둘레 = 고른 아이템 카드를 신체 위치에 배치.
//   모자=머리 위(우상단) · 상의=가슴 좌측 · 하의=허리 좌측 아래 · 신발=발 아래 · 가방=우측 허리.
// 카드는 흰 배경(상품 사진이 흰 배경이 많음) + 얇은 연결선·위치 점으로 신체 부위를 가리킨다.
// 빈 슬롯 = 점선 "＋ 상의"(탭 → 그 카테고리 피커). 아이템 카드 탭 → 피커, 길게 누르기/× → 해제(v3.278 clearItem).
// 금액 비노출(v3.275) — 카드에는 사진·이름만. 실제 착용 모습(AI 미리보기)은 범위 밖 → 하단 안내 1줄.
import { useState } from 'react';
import { View, TouchableOpacity, Image, StyleSheet, type LayoutChangeEvent } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { AppText } from '../ui';
import { colors } from '../../theme/colors';
import { brandNameOf, type AdItem, type Cat } from '../../utils/codyCatalog';
import { adImageUrl } from './codyShared';

interface Props {
  /** 대상 캐릭터 시트 미리보기 URL — 없으면 실루엣 플레이스홀더 */
  imageUrl: string | null;
  /** 대상 캐릭터 이름(보드 상단 표기 — 누구 옷을 고르는지 확인용). 없으면 생략 */
  characterLabel?: string | null;
  selected: Partial<Record<Cat, AdItem>>;
  /** '착용 안 함'(벗기기)을 켠 카테고리 — 빈 슬롯에 "○○ 없이" 표기 */
  removedCats?: Cat[];
  /** 판매 종료(카탈로그에서 사라진) 아이템 id */
  staleIds?: Set<string>;
  onPickSlot: (cat: Cat) => void;
  onClear: (cat: Cat) => void;
  /** 실제 착용을 만드는 버튼 이름(안내 문구용) — 예: '이 옷으로 입히기' */
  applyLabel: string;
  /** 보드 최대 폭(px) — 화면이 넓어도 과도하게 커지지 않게 */
  maxWidth?: number;
}

// 보드 좌표계: 폭 W 기준 비율. 캐릭터 이미지 S×S(정사각 시트) 가운데, 카드 C×C.
const IMG = 0.56;
const CARD = 0.22;
const IMG_LEFT = (1 - IMG) / 2;
const IMG_TOP = (4 / 3 - IMG) / 2;

type SlotGeo = {
  /** 카드 좌상단(W 배수) */
  x: number;
  y: number;
  /** 신체 위치 점 — 이미지 내부 비율(0~1) */
  ax: number;
  ay: number;
};

// 시트는 보통 정면 전신이 왼쪽, 측·후면이 오른쪽 → 좌측 슬롯은 왼쪽 인물, 우측 슬롯은 오른쪽을 가리킨다(근사)
const SLOT_GEO: Record<Cat, SlotGeo> = {
  모자: { x: 1 - CARD - 0.06, y: 0.04, ax: 0.6, ay: 0.05 },
  상의: { x: 0.03, y: IMG_TOP + IMG * 0.04, ax: 0.17, ay: 0.3 },
  하의: { x: 0.03, y: IMG_TOP + IMG * 0.56, ax: 0.17, ay: 0.62 },
  가방: { x: 1 - CARD - 0.03, y: IMG_TOP + IMG * 0.4, ax: 0.8, ay: 0.5 },
  신발: { x: (1 - CARD) / 2, y: IMG_TOP + IMG + 0.03, ax: 0.5, ay: 0.95 },
};
// 그리기 순서(선 → 카드). 카드 겹침 없음.
const SLOT_ORDER: Cat[] = ['모자', '상의', '가방', '하의', '신발'];

const REMOVED_LABEL: Partial<Record<Cat, string>> = { 모자: '모자 없이', 가방: '가방 없이', 신발: '맨발' };

/** 두 점을 잇는 1px 선(회전한 View) */
function Connector({ x1, y1, x2, y2, active }: { x1: number; y1: number; x2: number; y2: number; active: boolean }) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 2) return null;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: (x1 + x2) / 2 - len / 2,
        top: (y1 + y2) / 2 - 0.5,
        width: len,
        height: 1,
        backgroundColor: active ? colors.accent.primary : colors.text.muted,
        opacity: active ? 0.9 : 0.5,
        transform: [{ rotate: `${angle}deg` }],
      }}
    />
  );
}

export default function CodyBoard({
  imageUrl, characterLabel, selected, removedCats = [], staleIds, onPickSlot, onClear, applyLabel, maxWidth = 380,
}: Props) {
  const [w, setW] = useState(0);
  const [imgFailed, setImgFailed] = useState(false);
  const onLayout = (e: LayoutChangeEvent) => {
    const next = Math.round(e.nativeEvent.layout.width);
    if (next > 0 && next !== w) setW(next);
  };
  const H = (w * 4) / 3;
  const S = w * IMG;
  const C = w * CARD;
  const imgL = w * IMG_LEFT;
  const imgT = w * IMG_TOP;
  const showImage = !!imageUrl && !imgFailed;
  const count = SLOT_ORDER.filter((c) => !!selected[c]).length;

  const tapSlot = (cat: Cat) => {
    if (__DEV__) console.info('[CodyBoard] 슬롯 탭', { cat, picked: !!selected[cat] });
    onPickSlot(cat);
  };
  const clearSlot = (cat: Cat, via: string) => {
    if (!selected[cat]) return;
    if (__DEV__) console.info('[CodyBoard] 슬롯 해제', { cat, via });
    onClear(cat);
  };

  return (
    <View style={[s.wrap, { maxWidth }]}>
      <View style={s.headRow}>
        <AppText style={s.headTitle} numberOfLines={1}>
          {characterLabel ? `${characterLabel}의 코디 보드` : '코디 보드'}
        </AppText>
        <AppText style={s.headCount}>{count}/{SLOT_ORDER.length}</AppText>
      </View>
      <View style={[s.board, w > 0 && { height: H }]} onLayout={onLayout}>
        {w > 0 ? (
          <>
            {/* 가운데 캐릭터 */}
            <View style={[s.figure, { left: imgL, top: imgT, width: S, height: S }]}>
              {showImage ? (
                <Image
                  source={{ uri: imageUrl! }}
                  style={s.figureImg}
                  resizeMode="contain"
                  onError={() => {
                    console.warn('[CodyBoard] 캐릭터 이미지 로드 실패 — 실루엣 표시');
                    setImgFailed(true);
                  }}
                />
              ) : (
                <View style={s.silhouette}>
                  <Feather name="user" size={Math.round(S * 0.5)} color={colors.text.muted} />
                  <AppText style={s.silhouetteText}>캐릭터 미리보기 없음</AppText>
                </View>
              )}
            </View>

            {/* 연결선 + 위치 점 (카드보다 먼저 — 카드가 선 시작점을 덮음) */}
            {SLOT_ORDER.map((cat) => {
              const g = SLOT_GEO[cat];
              const picked = !!selected[cat];
              const cx = w * g.x + C / 2;
              const cy = w * g.y + C / 2;
              const ax = imgL + S * g.ax;
              const ay = imgT + S * g.ay;
              return (
                <View key={`ln-${cat}`} pointerEvents="none" style={StyleSheet.absoluteFill}>
                  <Connector x1={cx} y1={cy} x2={ax} y2={ay} active={picked} />
                  <View
                    style={[
                      s.dot,
                      { left: ax - 4, top: ay - 4 },
                      picked ? s.dotActive : s.dotIdle,
                    ]}
                  />
                </View>
              );
            })}

            {/* 아이템 카드 / 빈 슬롯 */}
            {SLOT_ORDER.map((cat) => {
              const g = SLOT_GEO[cat];
              const it = selected[cat];
              const url = it ? adImageUrl(it.image_object_name) : null;
              const removed = !it && removedCats.includes(cat);
              const stale = !!it && !!staleIds?.has(it.id);
              const brand = it ? brandNameOf(it) : '';
              return (
                <View key={`card-${cat}`} style={{ position: 'absolute', left: w * g.x, top: w * g.y, width: C }}>
                  <TouchableOpacity
                    style={[s.card, { width: C, height: C }, it ? s.cardFilled : s.cardEmpty]}
                    onPress={() => tapSlot(cat)}
                    onLongPress={() => clearSlot(cat, 'longpress')}
                    accessibilityLabel={
                      it ? `${cat} ${it.name} — 눌러서 바꾸기, 길게 눌러 해제` : `${cat} 고르기`
                    }
                  >
                    {it ? (
                      url ? (
                        <Image source={{ uri: url }} style={s.cardImg} resizeMode="contain" />
                      ) : (
                        <AppText style={s.cardNoImg} numberOfLines={3}>{it.name}</AppText>
                      )
                    ) : (
                      <View style={s.emptyInner}>
                        <AppText style={s.emptyPlus}>{removed ? '－' : '＋'}</AppText>
                        <AppText style={s.emptyLabel} numberOfLines={1}>
                          {removed ? REMOVED_LABEL[cat] || `${cat} 없이` : cat}
                        </AppText>
                      </View>
                    )}
                    {it ? (
                      <View style={s.catTag}>
                        <AppText style={s.catTagText}>{cat}</AppText>
                      </View>
                    ) : null}
                    {stale ? (
                      <View style={s.staleBadge}>
                        <AppText style={s.staleText}>판매 종료</AppText>
                      </View>
                    ) : null}
                  </TouchableOpacity>
                  {it ? (
                    <TouchableOpacity
                      style={s.clearBtn}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      onPress={() => clearSlot(cat, 'x')}
                      accessibilityLabel={`${cat} 선택 해제`}
                    >
                      <Feather name="x" size={11} color="#fff" />
                    </TouchableOpacity>
                  ) : null}
                  {it ? (
                    <AppText style={s.cardName} numberOfLines={1}>
                      {brand ? `${brand} · ` : ''}{it.name}
                    </AppText>
                  ) : null}
                </View>
              );
            })}
          </>
        ) : null}
      </View>
      <AppText style={s.footNote}>
        보드는 조합 미리보기예요. 실제 착용 모습은 [{applyLabel}] 버튼으로 만들어요.
      </AppText>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { width: '100%', alignSelf: 'center' },
  headRow: {
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
    marginBottom: 6, paddingHorizontal: 2,
  },
  headTitle: { flex: 1, color: colors.text.primary, fontSize: 14, fontWeight: '800' },
  headCount: { color: colors.text.muted, fontSize: 11, fontWeight: '700', marginLeft: 8 },
  board: {
    width: '100%', aspectRatio: 3 / 4,
    borderRadius: 16, overflow: 'hidden',
    backgroundColor: colors.bg.surface1,
    borderWidth: 1, borderColor: colors.border.subtle,
  },
  figure: { position: 'absolute', borderRadius: 12, overflow: 'hidden', backgroundColor: colors.bg.surface2 },
  figureImg: { width: '100%', height: '100%' },
  silhouette: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderStyle: 'dashed', borderColor: colors.text.muted, borderRadius: 12,
  },
  silhouetteText: { color: colors.text.muted, fontSize: 10, marginTop: 4 },
  dot: { position: 'absolute', width: 8, height: 8, borderRadius: 4, borderWidth: 1.5 },
  dotActive: { backgroundColor: colors.accent.primary, borderColor: '#fff' },
  dotIdle: { backgroundColor: 'transparent', borderColor: colors.text.muted },
  card: { borderRadius: 12, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  cardFilled: {
    backgroundColor: '#fff', borderWidth: 2, borderColor: colors.accent.primary,
  },
  cardEmpty: {
    backgroundColor: 'rgba(0,0,0,0.18)',
    borderWidth: 1, borderStyle: 'dashed', borderColor: colors.text.muted,
  },
  cardImg: { width: '100%', height: '100%' },
  cardNoImg: { color: '#222', fontSize: 9, fontWeight: '700', textAlign: 'center', padding: 4 },
  emptyInner: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  emptyPlus: { color: colors.text.secondary, fontSize: 18, fontWeight: '700', lineHeight: 20 },
  emptyLabel: { color: colors.text.secondary, fontSize: 10, fontWeight: '700', marginTop: 2 },
  catTag: {
    position: 'absolute', left: 3, top: 3,
    paddingHorizontal: 4, paddingVertical: 1, borderRadius: 6,
    backgroundColor: 'rgba(0,0,0,0.62)',
  },
  catTagText: { color: '#fff', fontSize: 8, fontWeight: '800' },
  staleBadge: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.72)', alignItems: 'center', paddingVertical: 1,
  },
  staleText: { color: '#fff', fontSize: 8, fontWeight: '800' },
  clearBtn: {
    position: 'absolute', top: -6, right: -6,
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.8)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.6)',
    alignItems: 'center', justifyContent: 'center',
  },
  cardName: { color: colors.text.primary, fontSize: 9, fontWeight: '600', marginTop: 3, textAlign: 'center' },
  footNote: { color: colors.text.muted, fontSize: 11, textAlign: 'center', marginTop: 8 },
});
