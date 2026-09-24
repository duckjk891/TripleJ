// v3.227(D 추출 1단계): 피커 '전체' 탭 본문 — 로딩/빈 상태/성별 필터 0건 안내 + 드릴다운
// (전체 › 플랫폼 › 브랜드 › 성별 › 제품) 브레드크럼·패싯 타일 + 상품 그리드.
// ArtistCodyScreen :698-761(파생값·핸들러)과 :1070-1208(JSX)에서 동작 무변경 이동.
import type { Dispatch, SetStateAction } from 'react';
import { View, TouchableOpacity, Image, FlatList, ActivityIndicator } from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { AppText } from '../ui';
import { colors } from '../../theme/colors';
import {
  EMPTY_DRILL,
  adImageUrl,
  brandOf,
  genderLabel,
  genderMatches,
  platformOf,
  productOf,
  pickerStyles as styles,
  type AdItem,
  type Cat,
  type DrillLevel,
  type DrillState,
} from './codyShared';

interface Props {
  pickerLoading: boolean;
  pickerCat: Cat | null;
  sourceItems: AdItem[];
  baseItems: AdItem[];
  genderFilterActive: boolean;
  artistGender: '남' | '여' | null;
  drill: DrillState;
  setDrill: Dispatch<SetStateAction<DrillState>>;
  pickedId: string | undefined;
  wished: Record<string, boolean>;
  wishBusy: Record<string, boolean>;
  pickItem: (item: AdItem) => void;
  handleWishToggle: (item: { id: string }) => void;
  openItemLink: (item: { id: string; product_url?: string }) => void;
}

export default function BrandGroupGrid({
  pickerLoading,
  pickerCat,
  sourceItems,
  baseItems,
  genderFilterActive,
  artistGender,
  drill,
  setDrill,
  pickedId,
  wished,
  wishBusy,
  pickItem,
  handleWishToggle,
  openItemLink,
}: Props) {
  // ── v3.90 5단계 드릴다운 파생값 (MAIDOL ItemSelectModal 이식) ──
  const byPlatform = drill.platform ? baseItems.filter((i) => platformOf(i) === drill.platform) : baseItems;
  const byBrand = drill.brand ? byPlatform.filter((i) => brandOf(i) === drill.brand) : byPlatform;
  const drillGender = drill.gender;
  const byGender = drillGender ? byBrand.filter((i) => genderMatches(i, drillGender)) : byBrand;
  const byProductRaw = drill.product ? byGender.filter((i) => productOf(i) === drill.product) : byGender;
  // v3.123(대표): 기선택 아이템이 있으면 목록 맨 앞에 노출 — 재선택/변경 시 바로 보이게
  const byProduct = pickedId
    ? [...byProductRaw].sort((a, b) => (a.id === pickedId ? -1 : b.id === pickedId ? 1 : 0))
    : byProductRaw;

  const currentLevel: DrillLevel | 'color' = !drill.platform
    ? 'platform'
    : !drill.brand
      ? 'brand'
      : !drill.gender
        ? 'gender'
        : !drill.product
          ? 'product'
          : 'color';

  const facetOptions: string[] =
    currentLevel === 'platform' ? [...new Set(baseItems.map(platformOf))]
    : currentLevel === 'brand' ? [...new Set(byPlatform.map(brandOf))]
    : currentLevel === 'gender' ? ['남', '여'].filter((g) => byBrand.some((i) => genderMatches(i, g)))
    : currentLevel === 'product' ? [...new Set(byGender.map(productOf))]
    : [];
  const facetLabel =
    currentLevel === 'platform' ? '플랫폼'
    : currentLevel === 'brand' ? '브랜드'
    : currentLevel === 'gender' ? '성별'
    : currentLevel === 'product' ? '제품'
    : '';

  const crumbs: { level: DrillLevel; label: string }[] = [];
  if (drill.platform) crumbs.push({ level: 'platform', label: drill.platform });
  if (drill.brand) crumbs.push({ level: 'brand', label: drill.brand });
  if (drill.gender) crumbs.push({ level: 'gender', label: genderLabel(drill.gender) });
  if (drill.product) crumbs.push({ level: 'product', label: drill.product });
  const drillActive = crumbs.length > 0;

  const selectLevel = (level: DrillLevel, value: string) => {
    const next = { ...drill, [level]: value };
    if (__DEV__) console.info('[ArtistCody] drill', next);
    setDrill(next);
  };

  const jumpTo = (level: DrillLevel) => {
    if (level === 'platform') setDrill(EMPTY_DRILL);
    else if (level === 'brand') setDrill((d) => ({ ...d, brand: null, gender: null, product: null }));
    else if (level === 'gender') setDrill((d) => ({ ...d, gender: null, product: null }));
    else if (level === 'product') setDrill((d) => ({ ...d, product: null }));
  };

  const goBack = () => {
    setDrill((d) => {
      if (d.product) return { ...d, product: null };
      if (d.gender) return { ...d, gender: null, product: null };
      if (d.brand) return { ...d, brand: null, gender: null, product: null };
      if (d.platform) return EMPTY_DRILL;
      return d;
    });
  };

  return pickerLoading ? (
    <View style={{ padding: 40, alignItems: 'center' }}>
      <ActivityIndicator size="large" color={colors.accent.primary} />
    </View>
  ) : sourceItems.length === 0 ? (
    <View style={{ padding: 40 }}>
      <AppText style={styles.emptyDesc}>
        등록된 {pickerCat} 아이템이 없어요.
      </AppText>
    </View>
  ) : genderFilterActive && baseItems.length === 0 ? (
    // v3.205(⑤): 필터 결과 0건 — 전체 보기 전환 안내
    <View style={{ padding: 40 }}>
      <AppText style={styles.emptyDesc}>
        {genderLabel(artistGender!)}용 {pickerCat} 아이템이 없어요.{'\n'}상단 칩을 누르면 전체 보기로 전환됩니다.
      </AppText>
    </View>
  ) : (
    <FlatList
      data={byProduct}
      keyExtractor={(item) => item.id}
      numColumns={2}
      ListHeaderComponent={
        <View>
          {/* 브레드크럼: 전체 › 플랫폼 › 브랜드 › 성별 › 제품 */}
          <View style={styles.crumbRow}>
            <TouchableOpacity onPress={() => jumpTo('platform')} disabled={!drillActive}>
              <AppText style={[styles.crumbText, !drillActive && styles.crumbTextMuted]}>전체</AppText>
            </TouchableOpacity>
            {crumbs.map((c) => (
              <View key={c.level} style={styles.crumbItem}>
                <AppText style={styles.crumbSep}>›</AppText>
                <TouchableOpacity onPress={() => jumpTo(c.level)}>
                  <AppText style={styles.crumbText}>{c.label}</AppText>
                </TouchableOpacity>
              </View>
            ))}
            {drillActive && (
              <TouchableOpacity style={styles.drillBackBtn} onPress={goBack}>
                <Feather name="chevron-left" size={13} color={colors.text.secondary} />
                <AppText style={styles.drillBackText}>뒤로</AppText>
              </TouchableOpacity>
            )}
          </View>

          {/* 현재 단계 패싯 타일 */}
          {currentLevel !== 'color' && facetOptions.length > 0 && (
            <View style={styles.facetBox}>
              <AppText style={styles.facetLabel}>{facetLabel} 선택</AppText>
              <View style={styles.facetTiles}>
                {facetOptions.map((opt) => (
                  <TouchableOpacity
                    key={opt}
                    style={styles.facetTile}
                    onPress={() => selectLevel(currentLevel as DrillLevel, opt)}
                  >
                    <AppText style={styles.facetTileText} numberOfLines={1}>
                      {currentLevel === 'gender' ? genderLabel(opt) : opt}
                    </AppText>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
        </View>
      }
      renderItem={({ item }) => {
        const url = adImageUrl(item.image_object_name);
        const isSample = item.id.startsWith('sample_');
        // v3.124: 기선택 아이템 시각 표시 — 정렬로 맨 앞에 오는 것만으로는
        // "내가 고른 것"임을 알 수 없다는 대표 피드백 → 강조 테두리 + ✓ 선택됨 배지
        const isPicked = item.id === pickedId;
        return (
          <TouchableOpacity
            style={[styles.itemCard, isPicked && styles.itemCardPicked]}
            onPress={() => pickItem(item)}
          >
            <View style={styles.itemImgWrap}>
              {url ? (
                <Image source={{ uri: url }} style={styles.itemImg} />
              ) : (
                <View style={[styles.itemImg, styles.itemImgFallback]}>
                  <AppText style={{ fontSize: 28 }}>?</AppText>
                </View>
              )}
              {isPicked && (
                <View style={styles.pickedBadge}>
                  <Feather name="check" size={11} color="#fff" />
                  <AppText style={styles.pickedBadgeText}>선택됨</AppText>
                </View>
              )}
              {/* 브랜드 배지 — 이미지 좌상단에 강조 */}
              {item.advertiser_nickname ? (
                <View style={styles.brandBadge}>
                  <AppText style={styles.brandBadgeText} numberOfLines={1}>
                    {item.advertiser_nickname}
                  </AppText>
                </View>
              ) : null}
              {/* 위시 하트 — 샘플 더미는 서버에 없어 담기 불가 → 숨김 */}
              {!isSample && (
                <TouchableOpacity
                  style={styles.wishBtn}
                  onPress={() => handleWishToggle(item)}
                  disabled={!!wishBusy[item.id]}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  {/* v3.176: 담기면 채워진 하트+플랫폼 보라 (플레이어 착장 카드와 통일) */}
                  <MaterialCommunityIcons
                    name={wished[item.id] ? 'heart' : 'heart-outline'}
                    size={17}
                    color={wished[item.id] ? colors.accent.primary : '#fff'}
                  />
                </TouchableOpacity>
              )}
            </View>
            <AppText style={styles.itemName} numberOfLines={2}>
              {item.product_name || item.name}
            </AppText>
            {item.color ? (
              <AppText style={styles.itemBrand} numberOfLines={1}>{item.color}</AppText>
            ) : null}
            {/* v3.109: 판매처 링크 — product_url 있는 아이템만 노출 */}
            {item.product_url ? (
              <TouchableOpacity
                style={styles.itemLinkBtn}
                onPress={() => openItemLink(item)}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                <Feather name="external-link" size={11} color={colors.accent.primary} />
                <AppText style={styles.itemLinkText}>판매처 보기</AppText>
              </TouchableOpacity>
            ) : null}
          </TouchableOpacity>
        );
      }}
      contentContainerStyle={{ padding: 12 }}
    />
  );
}
