// v3.227(E): 선택 아이템 미리보기 스트립 — 피커 모달 헤더 바로 아래, 상의·하의·신발·모자·가방 5칸 고정.
// 각 칸 = 44px 썸네일(선택 없으면 점선 빈 칸) + 카테고리명. 현재 카테고리 칸은 강조 테두리.
// 탭 = 해당 카테고리 피커로 전환(모자/가방은 악세서리 서브탭). 해제는 기존대로 카테고리 카드·칩 길게 누르기
// (스트립은 전환만 — 실수로 지우는 것 방지).
import { View, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { AppText } from '../ui';
import { colors } from '../../theme/colors';
import { CATEGORIES, type AdItem, type Cat } from '../../utils/codyCatalog';
import { adImageUrl } from './codyShared';

interface Props {
  selected: Partial<Record<Cat, AdItem>>;
  currentCat: Cat | null;
  staleIds: Set<string>;
  onJump: (cat: Cat) => void;
  /** v3.278: 칸의 × 버튼 = 그 카테고리 선택 해제 */
  onClear?: (cat: Cat) => void;
  /** v3.281 [CodyBoard]: 있으면 요약 줄에 [보드로 보기]/[목록으로] 토글 */
  onToggleBoard?: () => void;
  boardOpen?: boolean;
}

export default function SelectedItemsStrip({ selected, currentCat, staleIds, onJump, onClear, onToggleBoard, boardOpen }: Props) {
  const count = CATEGORIES.filter((c) => !!selected[c]).length;
  return (
    <View>
    {/* v3.278(대표): 내가 고른 옷이 잘 보이게 — 요약 줄 + 큰 썸네일·선택 강조·× 해제 */}
    <View style={s.summaryRow}>
      <AppText style={s.summaryText}>내가 고른 아이템 {count}/{CATEGORIES.length}</AppText>
      {onToggleBoard ? (
        <TouchableOpacity
          style={s.boardBtn}
          onPress={onToggleBoard}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          accessibilityLabel={boardOpen ? '아이템 목록으로' : '코디 보드로 보기'}
        >
          <Feather name={boardOpen ? 'grid' : 'layout'} size={11} color={colors.accent.primary} />
          <AppText style={s.boardBtnText}>{boardOpen ? '목록으로' : '보드로 보기'}</AppText>
        </TouchableOpacity>
      ) : (
        <AppText style={s.summaryHint}>{count ? '× 로 해제 · 칸을 누르면 그 종류로 이동' : '아래에서 골라보세요'}</AppText>
      )}
    </View>
    {onToggleBoard ? (
      <AppText style={[s.summaryHint, s.summaryHintLine]}>
        {count ? '× 로 해제 · 칸을 누르면 그 종류로 이동' : '아래에서 골라보세요'}
      </AppText>
    ) : null}
    <View style={s.row}>
      {CATEGORIES.map((cat) => {
        const it = selected[cat];
        const url = it ? adImageUrl(it.image_object_name) : null;
        const current = currentCat === cat;
        const stale = !!it && staleIds.has(it.id);
        return (
          <TouchableOpacity
            key={cat}
            style={s.cell}
            onPress={() => onJump(cat)}
            accessibilityLabel={`${cat}${it ? ` ${it.name}` : ' 선택 안 함'} — 이 카테고리 고르기`}
          >
            <View
              style={[
                s.thumb,
                !it && s.thumbEmpty,
                !!it && s.thumbSelected,
                it && !url && s.thumbNoImg,
                current && s.thumbCurrent,
              ]}
            >
              {url ? (
                <Image source={{ uri: url }} style={s.img} />
              ) : it ? (
                <AppText style={s.noImgText} numberOfLines={2}>{it.name}</AppText>
              ) : null}
              {stale ? (
                <View style={s.staleBadge}>
                  <AppText style={s.staleText}>종료</AppText>
                </View>
              ) : null}
            </View>
            {it && onClear ? (
              <TouchableOpacity
                style={s.clearBtn} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                onPress={(e: any) => { e?.stopPropagation?.(); onClear(cat); }}
                accessibilityLabel={`${cat} 선택 해제`}
              >
                <Feather name="x" size={11} color="#fff" />
              </TouchableOpacity>
            ) : null}
            <AppText style={[s.label, current && s.labelCurrent]} numberOfLines={1}>{cat}</AppText>
          </TouchableOpacity>
        );
      })}
    </View>
    </View>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingTop: 10, paddingBottom: 8,
    borderBottomWidth: 1, borderBottomColor: colors.bg.surface1,
  },
  cell: { flex: 1, alignItems: 'center' },
  summaryRow: {
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingTop: 10,
  },
  summaryText: { color: colors.text.primary, fontSize: 13, fontWeight: '800' },
  summaryHint: { color: colors.text.muted, fontSize: 10 },
  summaryHintLine: { paddingHorizontal: 14, marginTop: 2 },
  boardBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10,
    borderWidth: 1, borderColor: colors.accent.primary,
  },
  boardBtnText: { color: colors.accent.primary, fontSize: 11, fontWeight: '700' },
  thumbSelected: { borderWidth: 2, borderColor: colors.accent.primary },
  clearBtn: {
    position: 'absolute', top: -4, right: '50%', marginRight: -34,
    width: 18, height: 18, borderRadius: 9, backgroundColor: 'rgba(0,0,0,0.78)',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.5)',
  },
  thumb: {
    width: 56, height: 56, borderRadius: 10, overflow: 'hidden',
    backgroundColor: '#fff',
    borderWidth: 1, borderColor: colors.border.subtle,
    justifyContent: 'center', alignItems: 'center',
  },
  thumbEmpty: {
    backgroundColor: 'transparent',
    borderStyle: 'dashed', borderColor: colors.text.muted,
  },
  thumbNoImg: { backgroundColor: colors.bg.surface2, padding: 2 },
  thumbCurrent: { borderWidth: 2, borderStyle: 'solid', borderColor: colors.accent.primary },
  img: { width: '100%', height: '100%' },
  noImgText: { color: colors.text.primary, fontSize: 8, fontWeight: '700', textAlign: 'center' },
  staleBadge: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.72)', alignItems: 'center',
  },
  staleText: { color: '#fff', fontSize: 8, fontWeight: '800' },
  label: { color: colors.text.muted, fontSize: 10, fontWeight: '600', marginTop: 4 },
  labelCurrent: { color: colors.text.primary, fontWeight: '800' },
});
