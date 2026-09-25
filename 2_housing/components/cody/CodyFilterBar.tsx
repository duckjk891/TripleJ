// v3.227(D): 피커 '전체' 탭 상단 컨트롤 — [브랜드 모아보기 | 브랜드 펼쳐보기] 보기 전환, 대분류 칩(개수·0건 숨김),
// 필터 행([성별 칩 남성·여성·전체](v3.230 A4) · 색상 ▾ · 가격 ▾ · 브랜드 ▾(펼쳐보기 전용) · 활성 개수 배지 · 초기화),
// 펼친 필터 패널, 안내 문구, 펼쳐보기 정렬. 데이터가 지원하는 축만 노출(색상/가격 정보가 없으면 숨김).
import { useState } from 'react';
import { View, TouchableOpacity, ScrollView, TextInput, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { AppText } from '../ui';
import { colors } from '../../theme/colors';
import {
  COLOR_SWATCHES,
  GENDER_FILTER_CATS,
  MULTI,
  PRICE_BUCKETS,
  activeFilterCount,
  type Cat,
  type CodyGenderChoice,
  type CodySort,
  type CodyViewMode,
  type CodyViewState,
  type FacetCount,
} from '../../utils/codyCatalog';
import { pickerStyles } from './codyShared';

type Panel = 'color' | 'price' | 'brand' | null;

interface Props {
  pickerCat: Cat;
  view: CodyViewState;
  updateView: (patch: Partial<CodyViewState>) => void;
  subTotal: number;
  subFacets: FacetCount[];
  colorFacets: FacetCount[];
  priceFacets: FacetCount[];
  brandFacets: FacetCount[];
  hasColor: boolean;
  hasPrice: boolean;
  /** v3.230 A4: 성별 필터 남/여/전체 칩 — 현재 선택 · 기본값(답/대상 아티스트, 없으면 null) · 선택 콜백 */
  genderChoice: CodyGenderChoice;
  defaultGender: '남' | '여' | null;
  onGenderChoice: (choice: CodyGenderChoice) => void;
  onReset: () => void;
}

const SORTS: { key: CodySort; label: string }[] = [
  { key: 'rec', label: '추천순' },
  { key: 'low', label: '낮은 가격순' },
  { key: 'high', label: '높은 가격순' },
];

// v3.230 A4: 성별 필터 칩(남성용·여성용은 해당 성별용 + 공용 아이템 노출)
const GENDER_CHOICES: { key: CodyGenderChoice; label: string }[] = [
  { key: '남', label: '남성' },
  { key: '여', label: '여성' },
  { key: 'all', label: '전체' },
];

const toggleIn = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

export default function CodyFilterBar({
  pickerCat,
  view,
  updateView,
  subTotal,
  subFacets,
  colorFacets,
  priceFacets,
  brandFacets,
  hasColor,
  hasPrice,
  genderChoice,
  defaultGender,
  onGenderChoice,
  onReset,
}: Props) {
  const [panel, setPanel] = useState<Panel>(null);
  const [brandQuery, setBrandQuery] = useState('');
  const activeCount = activeFilterCount(view);
  const showBrandFilter = view.mode === 'all' && (brandFacets.length > 1 || view.brands.length > 0);
  const showSubChips = subFacets.length > 1 || !!view.sub;

  const setMode = (mode: CodyViewMode) => {
    if (mode === view.mode) return;
    if (__DEV__) console.info('[ArtistCody] view mode', { category: pickerCat, mode });
    if (mode === 'group' && panel === 'brand') setPanel(null);
    updateView({ mode, groupBrand: null });
  };
  const togglePanel = (p: Exclude<Panel, null>) => setPanel((cur) => (cur === p ? null : p));

  const q = brandQuery.trim().toLowerCase();
  const brandList = brandFacets
    .filter((b) => !q || b.label.toLowerCase().includes(q))
    // 선택한 브랜드는 목록 맨 앞(검색 중에도 해제할 수 있게)
    .sort((a, b) => Number(view.brands.includes(b.key)) - Number(view.brands.includes(a.key)));
  // 선택했지만 현재 조건에서 0건이 된 브랜드도 해제할 수 있게 노출
  const orphanBrands = view.brands.filter((b) => !brandFacets.some((f) => f.key === b));

  return (
    <View style={s.wrap}>
      {/* 보기 전환: 브랜드 모아보기 | 브랜드 펼쳐보기 */}
      <View style={s.segRow}>
        {(['group', 'all'] as CodyViewMode[]).map((m) => {
          const active = view.mode === m;
          return (
            <TouchableOpacity key={m} style={[s.seg, active && s.segActive]} onPress={() => setMode(m)}>
              <Feather
                name={m === 'group' ? 'grid' : 'list'}
                size={12}
                color={active ? colors.text.primary : colors.text.muted}
              />
              <AppText style={[s.segText, active && s.segTextActive]}>
                {m === 'group' ? ' 브랜드 모아보기' : ' 브랜드 펼쳐보기'}
              </AppText>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* 대분류 칩 — '전체' + 세부 분류(개수, 0건 숨김) */}
      {showSubChips && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
          <TouchableOpacity
            style={[s.chip, !view.sub && s.chipActive]}
            onPress={() => updateView({ sub: null })}
          >
            <AppText style={[s.chipText, !view.sub && s.chipTextActive]}>전체 {subTotal}</AppText>
          </TouchableOpacity>
          {subFacets.map((f) => {
            const active = view.sub === f.key;
            return (
              <TouchableOpacity
                key={f.key}
                style={[s.chip, active && s.chipActive]}
                onPress={() => {
                  if (__DEV__) console.info('[ArtistCody] sub category', { category: pickerCat, sub: active ? null : f.key });
                  updateView({ sub: active ? null : f.key });
                }}
              >
                <AppText style={[s.chipText, active && s.chipTextActive]}>
                  {f.label} {f.count}
                </AppText>
              </TouchableOpacity>
            );
          })}
          {view.sub && !subFacets.some((f) => f.key === view.sub) ? (
            <TouchableOpacity style={[s.chip, s.chipActive]} onPress={() => updateView({ sub: null })}>
              <AppText style={[s.chipText, s.chipTextActive]}>{view.sub} 0</AppText>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      )}

      {/* 필터 행 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
        {/* v3.205(⑤)→v3.207(⑩)→v3.230(A4): 성별 필터 — 대상 카테고리(상의/하의/신발)에서 남성/여성/전체 칩.
            기본 선택 = 방금 답한 성별(신규) 또는 대상 아티스트 성별, 없으면 전체. 사용자가 직접 바꿀 수 있다. */}
        {GENDER_FILTER_CATS.includes(pickerCat)
          ? GENDER_CHOICES.map(({ key, label }) => {
              const active = genderChoice === key;
              return (
                <TouchableOpacity
                  key={key}
                  style={[pickerStyles.genderChip, active && pickerStyles.genderChipActive]}
                  onPress={() => {
                    if (!active) onGenderChoice(key);
                  }}
                  accessibilityLabel={`성별 필터 ${label}`}
                  accessibilityState={{ selected: active }}
                >
                  <AppText style={[pickerStyles.genderChipText, active && pickerStyles.genderChipTextActive]}>
                    {label}
                    {key !== 'all' && key === defaultGender ? ' · 기본' : ''}
                  </AppText>
                </TouchableOpacity>
              );
            })
          : null}
        {hasColor && (
          <TouchableOpacity
            style={[s.chip, (view.colors.length > 0 || panel === 'color') && s.chipActive]}
            onPress={() => togglePanel('color')}
          >
            <AppText style={[s.chipText, view.colors.length > 0 && s.chipTextActive]}>
              색상{view.colors.length ? ` ${view.colors.length}` : ''}
            </AppText>
            <Feather name={panel === 'color' ? 'chevron-up' : 'chevron-down'} size={12} color={colors.text.secondary} />
          </TouchableOpacity>
        )}
        {hasPrice && (
          <TouchableOpacity
            style={[s.chip, (view.prices.length > 0 || panel === 'price') && s.chipActive]}
            onPress={() => togglePanel('price')}
          >
            <AppText style={[s.chipText, view.prices.length > 0 && s.chipTextActive]}>
              가격{view.prices.length ? ` ${view.prices.length}` : ''}
            </AppText>
            <Feather name={panel === 'price' ? 'chevron-up' : 'chevron-down'} size={12} color={colors.text.secondary} />
          </TouchableOpacity>
        )}
        {showBrandFilter && (
          <TouchableOpacity
            style={[s.chip, (view.brands.length > 0 || panel === 'brand') && s.chipActive]}
            onPress={() => togglePanel('brand')}
          >
            <AppText style={[s.chipText, view.brands.length > 0 && s.chipTextActive]}>
              브랜드{view.brands.length ? ` ${view.brands.length}` : ''}
            </AppText>
            <Feather name={panel === 'brand' ? 'chevron-up' : 'chevron-down'} size={12} color={colors.text.secondary} />
          </TouchableOpacity>
        )}
        {activeCount > 0 && (
          <TouchableOpacity
            style={s.resetBtn}
            onPress={() => {
              setPanel(null);
              setBrandQuery('');
              onReset();
            }}
            accessibilityLabel="필터 초기화"
          >
            <View style={s.countBadge}>
              <AppText style={s.countBadgeText}>{activeCount}</AppText>
            </View>
            <AppText style={s.resetText}>초기화</AppText>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* 펼친 필터 패널 */}
      {panel === 'color' && hasColor && (
        <View style={s.panel}>
          {colorFacets.length === 0 && view.colors.length === 0 ? (
            <AppText style={s.note}>지금 조건에서 고를 수 있는 색상이 없어요.</AppText>
          ) : null}
          <View style={s.wrapRow}>
            {[
              ...colorFacets,
              ...view.colors.filter((c) => !colorFacets.some((f) => f.key === c)).map((c) => ({ key: c, label: c, count: 0 })),
            ].map((f) => {
              const active = view.colors.includes(f.key);
              return (
                <TouchableOpacity
                  key={f.key}
                  style={[s.swatchChip, active && s.chipActive]}
                  onPress={() => updateView({ colors: toggleIn(view.colors, f.key) })}
                >
                  {f.key === MULTI ? (
                    <View style={[s.swatch, s.swatchMulti]}>
                      <View style={[s.swatchHalf, { backgroundColor: '#F29CB7' }]} />
                      <View style={[s.swatchHalf, { backgroundColor: '#3D7BE0' }]} />
                    </View>
                  ) : (
                    <View style={[s.swatch, { backgroundColor: COLOR_SWATCHES[f.key] || colors.bg.surface2 }]} />
                  )}
                  <AppText style={[s.chipText, active && s.chipTextActive]}>
                    {f.label} {f.count}
                  </AppText>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}
      {panel === 'price' && hasPrice && (
        <View style={s.panel}>
          <View style={s.wrapRow}>
            {[
              ...priceFacets,
              ...view.prices.filter((p) => !priceFacets.some((f) => f.key === p)).map((p) => ({ key: p, label: PRICE_BUCKETS.find((b) => b.key === p)?.label || p, count: 0 })),
            ].map((f) => {
              const active = view.prices.includes(f.key);
              return (
                <TouchableOpacity
                  key={f.key}
                  style={[s.chip, active && s.chipActive]}
                  onPress={() => updateView({ prices: toggleIn(view.prices, f.key) })}
                >
                  <AppText style={[s.chipText, active && s.chipTextActive]}>
                    {f.label} {f.count}
                  </AppText>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}
      {panel === 'brand' && showBrandFilter && (
        <View style={s.panel}>
          <View style={s.searchBox}>
            <Feather name="search" size={13} color={colors.text.muted} />
            <TextInput
              style={s.searchInput}
              value={brandQuery}
              onChangeText={setBrandQuery}
              placeholder="브랜드 검색"
              placeholderTextColor={colors.text.muted}
              autoCorrect={false}
              autoCapitalize="none"
            />
          </View>
          <ScrollView style={s.brandScroll} nestedScrollEnabled keyboardShouldPersistTaps="handled">
            <View style={s.wrapRow}>
              {[...orphanBrands.map((b) => ({ key: b, label: b, count: 0 })), ...brandList].map((f) => {
                const active = view.brands.includes(f.key);
                return (
                  <TouchableOpacity
                    key={f.key}
                    style={[s.chip, active && s.chipActive]}
                    onPress={() => {
                      if (__DEV__) console.info('[ArtistCody] brand filter', { brand: f.key, on: !active });
                      updateView({ brands: toggleIn(view.brands, f.key) });
                    }}
                  >
                    <AppText style={[s.chipText, active && s.chipTextActive]} numberOfLines={1}>
                      {f.label} {f.count}
                    </AppText>
                  </TouchableOpacity>
                );
              })}
              {brandList.length === 0 && orphanBrands.length === 0 ? (
                <AppText style={s.note}>검색 결과가 없어요.</AppText>
              ) : null}
            </View>
          </ScrollView>
        </View>
      )}

      {/* 안내 — 정보 없는 상품이 빠진다는 사실을 숨기지 않는다 */}
      {view.prices.length > 0 || view.colors.length > 0 ? (
        <AppText style={s.note}>
          {[view.prices.length > 0 ? '가격 정보가 있는 상품만' : '', view.colors.length > 0 ? '색상 정보가 있는 상품만' : '']
            .filter(Boolean)
            .join(' · ')}{' '}
          보여요.
        </AppText>
      ) : null}

      {/* 펼쳐보기 정렬 — 가격 정보가 있을 때만 */}
      {view.mode === 'all' && hasPrice && (
        <View style={s.sortRow}>
          {SORTS.map((o) => {
            const active = view.sort === o.key;
            return (
              <TouchableOpacity key={o.key} onPress={() => updateView({ sort: o.key })} hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
                <AppText style={[s.sortText, active && s.sortTextActive]}>{o.label}</AppText>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { paddingBottom: 6 },
  segRow: {
    flexDirection: 'row', gap: 6, marginBottom: 8,
    padding: 3, borderRadius: 10, backgroundColor: colors.bg.surface1,
  },
  seg: {
    flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    paddingVertical: 7, borderRadius: 8,
  },
  segActive: { backgroundColor: colors.bg.surface2 },
  segText: { color: colors.text.muted, fontSize: 12, fontWeight: '600' },
  segTextActive: { color: colors.text.primary, fontWeight: '800' },

  chipRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingBottom: 8, paddingRight: 4 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12,
    backgroundColor: colors.bg.surface2,
    borderWidth: 1, borderColor: colors.border.subtle,
    maxWidth: 220,
  },
  chipActive: { borderColor: colors.accent.primary },
  chipText: { color: colors.text.secondary, fontSize: 11, fontWeight: '700' },
  chipTextActive: { color: colors.text.primary },

  resetBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 5, borderRadius: 12,
  },
  countBadge: {
    minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4,
    backgroundColor: colors.accent.primary, justifyContent: 'center', alignItems: 'center',
  },
  countBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  resetText: { color: colors.text.secondary, fontSize: 11, fontWeight: '700', textDecorationLine: 'underline' },

  panel: {
    marginBottom: 8, padding: 10, borderRadius: 12,
    backgroundColor: colors.bg.surface1,
    borderWidth: 1, borderColor: colors.border.subtle,
  },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  swatchChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 8, paddingVertical: 5, borderRadius: 12,
    backgroundColor: colors.bg.surface2,
    borderWidth: 1, borderColor: colors.border.subtle,
  },
  swatch: {
    width: 14, height: 14, borderRadius: 7,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)',
  },
  swatchMulti: { flexDirection: 'row', overflow: 'hidden' },
  swatchHalf: { flex: 1 },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, marginBottom: 8, borderRadius: 10,
    backgroundColor: colors.bg.surface2,
    borderWidth: 1, borderColor: colors.border.subtle,
  },
  searchInput: { flex: 1, color: colors.text.primary, fontSize: 13, paddingVertical: 7 },
  brandScroll: { maxHeight: 180 },
  note: { color: colors.text.muted, fontSize: 11, marginBottom: 6 },
  sortRow: { flexDirection: 'row', gap: 14, paddingVertical: 4, paddingHorizontal: 2 },
  sortText: { color: colors.text.muted, fontSize: 12, fontWeight: '600' },
  sortTextActive: { color: colors.text.primary, fontWeight: '800' },
});
