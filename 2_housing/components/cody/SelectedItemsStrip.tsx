// v3.227(E): 선택 아이템 미리보기 스트립 — 피커 모달 헤더 바로 아래, 상의·하의·신발·모자·가방 5칸 고정.
// 각 칸 = 44px 썸네일(선택 없으면 점선 빈 칸) + 카테고리명. 현재 카테고리 칸은 강조 테두리.
// 탭 = 해당 카테고리 피커로 전환(모자/가방은 악세서리 서브탭). 해제는 기존대로 카테고리 카드·칩 길게 누르기
// (스트립은 전환만 — 실수로 지우는 것 방지).
import { View, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { AppText } from '../ui';
import { colors } from '../../theme/colors';
import { CATEGORIES, type AdItem, type Cat } from '../../utils/codyCatalog';
import { adImageUrl } from './codyShared';

interface Props {
  selected: Partial<Record<Cat, AdItem>>;
  currentCat: Cat | null;
  staleIds: Set<string>;
  onJump: (cat: Cat) => void;
}

export default function SelectedItemsStrip({ selected, currentCat, staleIds, onJump }: Props) {
  return (
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
            <AppText style={[s.label, current && s.labelCurrent]} numberOfLines={1}>{cat}</AppText>
          </TouchableOpacity>
        );
      })}
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
  thumb: {
    width: 44, height: 44, borderRadius: 8, overflow: 'hidden',
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
