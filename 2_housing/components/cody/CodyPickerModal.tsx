// v3.227(D·E): 꾸미기 아이템 선택 모달.
// 구성(위→아래): 헤더 · E 선택 스트립 · [전체 | 내 위시리스트] 탭 · 악세서리 [모자 | 가방] 서브탭 ·
//   (전체) 필터 바(보기 전환·대분류·성별/색상/가격/브랜드) + 브랜드 모아보기/펼쳐보기 그리드 · (위시) 위시 그리드.
// 피커 state(카테고리·탭·보기/필터·성별 토글·아이템·로딩)와 open/pick/close/jump 핸들러는 화면이 소유하고
// props로 받는다(피커를 닫아도 카테고리별 보기·필터 유지 — PLAN D). 여기서는 파생 계산만 한다.
import { useEffect, useMemo, type Dispatch, type SetStateAction } from 'react';
import { View, TouchableOpacity, Image, Modal, FlatList, ActivityIndicator } from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '../ui';
import { useWishlistStore, type WishItem } from '../../stores/wishlistStore';
import { colors } from '../../theme/colors';
import { getSubCategoryOrder } from '../../services/catalogService';
import { useIsChild } from '../../utils/kidsMode';
import {
  DEFAULT_VIEW,
  GENDER_FILTER_CATS,
  activeFilterCount,
  applyFilters,
  brandFacets,
  brandNameOf,
  colorFacets,
  codyFilterGender,
  genderMatches,
  pinPicked,
  priceFacets,
  subCategoryFacets,
  type AdItem,
  type Cat,
  type CodyGenderChoice,
  type CodyViewState,
} from '../../utils/codyCatalog';
import CodyPickerTabs from './CodyPickerTabs';
import CodyFilterBar from './CodyFilterBar';
import BrandGroupGrid from './BrandGroupGrid';
import SelectedItemsStrip from './SelectedItemsStrip';
import { adImageUrl, getSampleItems, pickerStyles as styles } from './codyShared';

interface Props {
  pickerCat: Cat | null;
  accessoryMode: boolean;
  pickerItems: AdItem[];
  pickerLoading: boolean;
  pickerTab: 'all' | 'wish';
  setPickerTab: Dispatch<SetStateAction<'all' | 'wish'>>;
  view: CodyViewState;
  updateView: (patch: Partial<CodyViewState>) => void;
  /** v3.230 A4: 현재 성별 필터 선택(남/여/전체) · 기본값(답·대상 아티스트 기준, 없으면 null) · 칩 선택 */
  genderChoice: CodyGenderChoice;
  defaultGender: '남' | '여' | null;
  onGenderChoice: (choice: CodyGenderChoice) => void;
  selected: Partial<Record<Cat, AdItem>>;
  staleIds: Set<string>;
  isLoggedIn: boolean;
  closePicker: () => void;
  switchAccessorySub: (sub: Cat) => void;
  jumpToCategory: (cat: Cat) => void;
  pickItem: (item: AdItem) => void;
  handleWishToggle: (item: { id: string }) => void;
  openItemLink: (item: { id: string; product_url?: string }) => void;
}

export default function CodyPickerModal({
  pickerCat,
  accessoryMode,
  pickerItems,
  pickerLoading,
  pickerTab,
  setPickerTab,
  view,
  updateView,
  genderChoice,
  defaultGender,
  onGenderChoice,
  selected,
  staleIds,
  isLoggedIn,
  closePicker,
  switchAccessorySub,
  jumpToCategory,
  pickItem,
  handleWishToggle,
  openItemLink,
}: Props) {
  const insets = useSafeAreaInsets();
  const wished = useWishlistStore((s) => s.wished);
  const wishBusy = useWishlistStore((s) => s.busy);
  const wishItemsAll = useWishlistStore((s) => s.items);
  const wishListLoaded = useWishlistStore((s) => s.listLoaded);
  const wishListLoading = useWishlistStore((s) => s.listLoading);
  const wishListError = useWishlistStore((s) => s.listError);
  // v3.232 K17 [KidsGate]: 어린이 계정 — 위시 탭 "판매처 보기" 숨김(위시 목록·해제는 유지). 성인은 false.
  const isChild = useIsChild();

  // ── v3.205(⑤) 성별 자동 필터 — 목록에 선적용(대분류·색상 등 패싯 수치도 필터 후 기준) ──
  // genderMatches: 해당 성별용 + '공용'(미지정 포함) 노출, 반대 성별 숨김.
  // SAMPLE 폴백은 gender 미지정 → '공용' 취급으로 자연 통과. 위시리스트 탭은 불변.
  // v3.230 A4: 남/여/전체 칩 선택이 곧 필터 성별('all' = 필터 없음)
  const artistGender = codyFilterGender(genderChoice);
  const genderFilterActive =
    !!artistGender && !!pickerCat && GENDER_FILTER_CATS.includes(pickerCat);
  // v3.206: 악세서리 피커 — 서브탭(모자|가방)이 앞단 필터.
  // 해당 서브카테고리 실데이터 0건이면 SAMPLE 폴백(장신구 아닌 모자/가방 샘플).
  const sourceItems = useMemo(() => {
    if (!(accessoryMode && pickerCat)) return pickerItems;
    const sub = pickerItems.filter((i) => i.category === pickerCat);
    return sub.length > 0 ? sub : getSampleItems(pickerCat);
  }, [accessoryMode, pickerCat, pickerItems]);
  const baseItems = useMemo(
    () => (genderFilterActive ? sourceItems.filter((i) => genderMatches(i, artistGender!)) : sourceItems),
    [genderFilterActive, sourceItems, artistGender],
  );
  useEffect(() => {
    if (__DEV__ && genderFilterActive && !pickerLoading) {
      console.info('[ArtistCody] 성별 자동 필터', {
        gender: artistGender,
        category: pickerCat,
        filtered: baseItems.length,
        total: pickerItems.length,
      });
    }
  }, [genderFilterActive, pickerLoading, artistGender, pickerCat, baseItems.length, pickerItems.length]);

  // ── v3.227(D) 대분류·색상·가격·브랜드 필터(클라이언트) + 패싯 개수(자기 축 제외 기준) ──
  const v = view || DEFAULT_VIEW;
  const filtered = useMemo(() => applyFilters(baseItems, v), [baseItems, v]);
  const facets = useMemo(() => {
    const forSub = applyFilters(baseItems, v, 'sub');
    return {
      subTotal: forSub.length,
      // 칩 순서: 서버 catalog의 sub_categories 우선, 폴백(active·SAMPLE)이면 앱 규칙 순서
      sub: pickerCat ? subCategoryFacets(forSub, pickerCat, getSubCategoryOrder(pickerCat)) : [],
      color: colorFacets(applyFilters(baseItems, v, 'colors')),
      price: priceFacets(applyFilters(baseItems, v, 'prices')),
      brand: v.mode === 'all' ? brandFacets(applyFilters(baseItems, v, 'brands')) : [],
      hasColor: baseItems.some((i) => !!i.color_family),
      hasPrice: baseItems.some((i) => typeof i.price_krw === 'number' && i.price_krw > 0),
    };
  }, [baseItems, v, pickerCat]);
  const resetFilters = () => {
    if (__DEV__) console.info('[ArtistCody] filter reset', { category: pickerCat });
    updateView({ sub: null, colors: [], prices: [], brands: [], groupBrand: null });
  };
  const hasNarrowing = activeFilterCount(v) > 0 || !!v.sub;

  // v3.123: 기선택 아이템 id — 전체 탭·위시 탭 공용
  const pickedId = pickerCat ? selected[pickerCat]?.id : undefined;

  // 위시리스트 탭: 현재 카테고리의 내 찜 목록 (store엔 전 카테고리 보관)
  const wishItemsForCatRaw: WishItem[] = pickerCat
    ? wishItemsAll.filter((it) => it.category === pickerCat)
    : [];
  // v3.123: 위시 탭도 기선택 우선 정렬
  const wishItemsForCat = pinPicked(wishItemsForCatRaw, pickedId);

  const filterBar = pickerCat ? (
    <CodyFilterBar
      pickerCat={pickerCat}
      view={v}
      updateView={updateView}
      subTotal={facets.subTotal}
      subFacets={facets.sub}
      colorFacets={facets.color}
      priceFacets={facets.price}
      brandFacets={facets.brand}
      hasColor={facets.hasColor}
      hasPrice={facets.hasPrice}
      genderChoice={genderChoice}
      defaultGender={defaultGender}
      onGenderChoice={onGenderChoice}
      onReset={resetFilters}
    />
  ) : null;

  // 카테고리별 아이템 선택 모달
  return (
    <Modal
      visible={pickerCat !== null}
      transparent
      animationType="slide"
      onRequestClose={closePicker}
    >
      <View style={styles.modalOverlay}>
        {/* v3.196: Modal은 루트 인셋 미상속 → 하단 제스처 바만큼 paddingBottom 보강(v3.191 queueSheet 패턴) */}
        <View style={[styles.modalBox, { paddingBottom: insets.bottom }]}>
          <View style={styles.modalHeader}>
            <AppText style={styles.modalTitle}>
              {accessoryMode ? '악세서리 고르기' : pickerCat ? `${pickerCat} 고르기` : ''}
            </AppText>
            <TouchableOpacity onPress={closePicker}>
              <AppText style={styles.modalClose}>✕</AppText>
            </TouchableOpacity>
          </View>
          {/* v3.227(E): 선택 아이템 스트립 — 탭하면 해당 카테고리 피커로 전환 */}
          <SelectedItemsStrip
            selected={selected}
            currentCat={pickerCat}
            staleIds={staleIds}
            onJump={jumpToCategory}
          />
          <CodyPickerTabs
            pickerTab={pickerTab}
            setPickerTab={setPickerTab}
            isLoggedIn={isLoggedIn}
            wishListLoaded={wishListLoaded}
            wishListError={wishListError}
            wishItemsForCat={wishItemsForCat}
            pickerCat={pickerCat}
            accessoryMode={accessoryMode}
            selected={selected}
            switchAccessorySub={switchAccessorySub}
          />

          {pickerTab === 'all' && (
            <BrandGroupGrid
              pickerLoading={pickerLoading}
              pickerCat={pickerCat}
              sourceCount={sourceItems.length}
              baseCount={baseItems.length}
              genderFilterActive={genderFilterActive}
              artistGender={artistGender}
              view={v}
              updateView={updateView}
              filterBar={filterBar}
              filtered={filtered}
              hasNarrowing={hasNarrowing}
              onResetFilters={resetFilters}
              pickedId={pickedId}
              wished={wished}
              wishBusy={wishBusy}
              pickItem={pickItem}
              handleWishToggle={handleWishToggle}
              openItemLink={openItemLink}
            />
          )}

          {pickerTab === 'wish' && (
            !isLoggedIn ? (
              <View style={{ padding: 40 }}>
                <AppText style={styles.emptyDesc}>로그인 후 이용할 수 있습니다.</AppText>
              </View>
            ) : wishListLoading || !wishListLoaded ? (
              <View style={{ padding: 40, alignItems: 'center' }}>
                <ActivityIndicator size="large" color={colors.accent.primary} />
              </View>
            ) : wishListError ? (
              <View style={{ padding: 40 }}>
                <AppText style={styles.emptyDesc}>위시리스트를 불러오지 못했습니다.</AppText>
              </View>
            ) : wishItemsForCat.length === 0 ? (
              <View style={{ padding: 40 }}>
                <AppText style={styles.emptyDesc}>
                  위시리스트에 담긴 {pickerCat} 아이템이 없어요.{'\n'}전체 탭에서 하트를 눌러 담아보세요.
                </AppText>
              </View>
            ) : (
              <FlatList
                data={wishItemsForCat}
                initialNumToRender={8}
                windowSize={5}
                keyExtractor={(item) => item.id}
                numColumns={2}
                renderItem={({ item }) => {
                  const url = adImageUrl(item.image_object_name);
                  const inactive = item.is_active === false;
                  // v3.124: 위시 탭에도 동일한 기선택 표시
                  const isPicked = item.id === pickedId;
                  return (
                    <TouchableOpacity
                      style={[styles.itemCard, isPicked && styles.itemCardPicked, inactive && styles.itemCardInactive]}
                      onPress={() => pickItem(item)}
                      disabled={inactive}
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
                        {inactive && (
                          <View style={styles.inactiveBadge}>
                            <AppText style={styles.inactiveBadgeText}>판매종료</AppText>
                          </View>
                        )}
                        {/* 하트 = 위시 해제 (위시 탭이므로 항상 담긴 상태 = 채워진 보라) */}
                        <TouchableOpacity
                          style={styles.wishBtn}
                          onPress={() => handleWishToggle(item)}
                          disabled={!!wishBusy[item.id]}
                          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                        >
                          <MaterialCommunityIcons name="heart" size={17} color={colors.accent.primary} />
                        </TouchableOpacity>
                      </View>
                      <AppText style={styles.itemName} numberOfLines={2}>{item.name}</AppText>
                      {/* v3.227: 실제 브랜드(brand 우선, advertiser_nickname 폴백) */}
                      {brandNameOf(item) ? (
                        <AppText style={styles.itemBrand} numberOfLines={1}>
                          {brandNameOf(item)}
                        </AppText>
                      ) : null}
                      {/* v3.109: 판매처 링크 — 위시 탭에도 동일 노출(판매종료 아이템도 링크는 유효) */}
                      {item.product_url && !isChild ? (
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
            )
          )}
        </View>
      </View>
    </Modal>
  );
}
