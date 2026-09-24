// v3.227(D): 피커 '전체' 탭 본문 — 로딩/빈 상태/성별 필터 0건 안내(v3.205) + 필터 바(헤더) +
//   · 브랜드 모아보기: 브랜드 그룹 카드(상품 수 내림차순·썸네일 3장) → 탭 → "전체 브랜드 › {브랜드}" 상품 그리드
//   · 브랜드 펼쳐보기: 필터 적용된 전체 상품 그리드(추천순/가격순)
// v3.90 드릴다운(플랫폼 › 브랜드 › 성별 › 제품)은 PLAN D에 따라 폐지 — 판매자 계정 대신 실제 브랜드로 통합.
import { useMemo, type ReactElement } from 'react';
import { View, TouchableOpacity, Image, FlatList, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { AppText } from '../ui';
import { colors } from '../../theme/colors';
import {
  brandOf,
  genderLabel,
  groupByBrand,
  pinPicked,
  sortItems,
  type AdItem,
  type BrandGroup,
  type Cat,
  type CodyViewState,
} from '../../utils/codyCatalog';
import CodyItemCard from './CodyItemCard';
import { adImageUrl, pickerStyles as styles } from './codyShared';

interface Props {
  pickerLoading: boolean;
  pickerCat: Cat | null;
  sourceCount: number;
  baseCount: number;
  genderFilterActive: boolean;
  artistGender: '남' | '여' | null;
  view: CodyViewState;
  updateView: (patch: Partial<CodyViewState>) => void;
  filterBar: ReactElement | null;
  filtered: AdItem[];
  hasNarrowing: boolean;
  onResetFilters: () => void;
  pickedId: string | undefined;
  wished: Record<string, boolean>;
  wishBusy: Record<string, boolean>;
  pickItem: (item: AdItem) => void;
  handleWishToggle: (item: { id: string }) => void;
  openItemLink: (item: { id: string; product_url?: string }) => void;
}

const LIST_PERF = { initialNumToRender: 8, windowSize: 5, removeClippedSubviews: true } as const;

export default function BrandGroupGrid({
  pickerLoading,
  pickerCat,
  sourceCount,
  baseCount,
  genderFilterActive,
  artistGender,
  view,
  updateView,
  filterBar,
  filtered,
  hasNarrowing,
  onResetFilters,
  pickedId,
  wished,
  wishBusy,
  pickItem,
  handleWishToggle,
  openItemLink,
}: Props) {
  const inBrand = view.mode === 'group' && !!view.groupBrand;
  const groups = useMemo(
    () => (view.mode === 'group' && !view.groupBrand ? groupByBrand(filtered) : []),
    [filtered, view.mode, view.groupBrand],
  );
  const products = useMemo(() => {
    if (view.mode === 'all') return pinPicked(sortItems(filtered, view.sort), pickedId);
    if (view.groupBrand) return pinPicked(filtered.filter((i) => brandOf(i) === view.groupBrand), pickedId);
    return [];
  }, [filtered, view.mode, view.sort, view.groupBrand, pickedId]);
  const pickedBrand = useMemo(() => {
    const it = pickedId ? filtered.find((i) => i.id === pickedId) : undefined;
    return it ? brandOf(it) : null;
  }, [filtered, pickedId]);

  if (pickerLoading) {
    return (
      <View style={{ padding: 40, alignItems: 'center' }}>
        <ActivityIndicator size="large" color={colors.accent.primary} />
      </View>
    );
  }
  if (sourceCount === 0) {
    return (
      <View style={{ padding: 40 }}>
        <AppText style={styles.emptyDesc}>
          등록된 {pickerCat} 아이템이 없어요.
        </AppText>
      </View>
    );
  }

  const empty =
    genderFilterActive && baseCount === 0 ? (
      // v3.205(⑤): 성별 필터 결과 0건 — 전체 보기 전환 안내
      <View style={{ padding: 40 }}>
        <AppText style={styles.emptyDesc}>
          {genderLabel(artistGender!)}용 {pickerCat} 아이템이 없어요.{'\n'}상단 칩을 누르면 전체 보기로 전환됩니다.
        </AppText>
      </View>
    ) : (
      <View style={{ padding: 32 }}>
        <AppText style={styles.emptyDesc}>조건에 맞는 {pickerCat} 아이템이 없어요.</AppText>
        {hasNarrowing ? (
          <TouchableOpacity style={styles.emptyResetBtn} onPress={onResetFilters}>
            <AppText style={styles.emptyResetText}>필터 초기화</AppText>
          </TouchableOpacity>
        ) : null}
      </View>
    );

  const header = (
    <View>
      {filterBar}
      {inBrand ? (
        // 모아보기 브레드크럼: 전체 브랜드 › {브랜드}
        <View style={styles.crumbRow}>
          <TouchableOpacity onPress={() => updateView({ groupBrand: null })}>
            <AppText style={styles.crumbText}>전체 브랜드</AppText>
          </TouchableOpacity>
          <View style={styles.crumbItem}>
            <AppText style={styles.crumbSep}>›</AppText>
            <AppText style={[styles.crumbText, styles.crumbTextMuted]} numberOfLines={1}>
              {view.groupBrand}
            </AppText>
          </View>
          <TouchableOpacity style={styles.drillBackBtn} onPress={() => updateView({ groupBrand: null })}>
            <Feather name="chevron-left" size={13} color={colors.text.secondary} />
            <AppText style={styles.drillBackText}>뒤로</AppText>
          </TouchableOpacity>
        </View>
      ) : null}
      {filtered.length > 0 ? (
        <AppText style={styles.resultCount}>
          {view.mode === 'group' && !inBrand
            ? `브랜드 ${groups.length}개 · 상품 ${filtered.length}개`
            : `상품 ${products.length}개`}
        </AppText>
      ) : null}
    </View>
  );

  if (view.mode === 'group' && !inBrand) {
    return (
      <FlatList<BrandGroup>
        key="group"
        data={groups}
        keyExtractor={(g) => g.brand}
        numColumns={2}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        keyboardShouldPersistTaps="handled"
        {...LIST_PERF}
        renderItem={({ item: g }) => (
          <TouchableOpacity
            style={[styles.groupCard, pickedBrand === g.brand && styles.groupCardPicked]}
            onPress={() => {
              if (__DEV__) console.info('[ArtistCody] brand group', { category: pickerCat, brand: g.brand, count: g.count });
              updateView({ groupBrand: g.brand });
            }}
          >
            <View style={styles.groupThumbs}>
              {[0, 1, 2].map((k) => {
                const it = g.thumbs[k];
                const url = it ? adImageUrl(it.image_object_name) : null;
                return url ? (
                  <Image key={k} source={{ uri: url }} style={styles.groupThumb} />
                ) : (
                  <View key={k} style={[styles.groupThumb, styles.groupThumbEmpty]} />
                );
              })}
            </View>
            <AppText style={styles.groupBrand} numberOfLines={1}>{g.brand}</AppText>
            <AppText style={styles.groupCount}>
              {g.count}개{pickedBrand === g.brand ? ' · 선택됨' : ''}
            </AppText>
          </TouchableOpacity>
        )}
        contentContainerStyle={{ padding: 12 }}
      />
    );
  }

  return (
    <FlatList<AdItem>
      key={inBrand ? 'brand' : 'all'}
      data={products}
      keyExtractor={(item) => item.id}
      numColumns={2}
      ListHeaderComponent={header}
      ListEmptyComponent={empty}
      keyboardShouldPersistTaps="handled"
      {...LIST_PERF}
      renderItem={({ item }) => (
        <CodyItemCard
          item={item}
          isPicked={item.id === pickedId}
          wished={!!wished[item.id]}
          wishBusy={!!wishBusy[item.id]}
          onPick={pickItem}
          onWishToggle={handleWishToggle}
          onOpenLink={openItemLink}
        />
      )}
      contentContainerStyle={{ padding: 12 }}
    />
  );
}
