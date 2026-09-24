// v3.227(D 추출 1단계): 꾸미기 아이템 선택 모달 — ArtistCodyScreen :976-1300(JSX)과
// :286-291(위시 store 구독)·:671-696(성별 자동 필터)·:705(기선택 id)·:763-770(위시 탭 목록)에서 동작 무변경 이동.
// 피커 state(카테고리·탭·드릴·성별 토글·아이템·로딩)와 open/pick/close 핸들러는 화면이 소유하고 props로 받는다.
import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { View, TouchableOpacity, Image, Modal, FlatList, ActivityIndicator } from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '../ui';
import { useWishlistStore, type WishItem } from '../../stores/wishlistStore';
import { colors } from '../../theme/colors';
import CodyFilterBar from './CodyFilterBar';
import BrandGroupGrid from './BrandGroupGrid';
import {
  GENDER_FILTER_CATS,
  SAMPLE_ITEMS,
  adImageUrl,
  genderMatches,
  pickerStyles as styles,
  type AdItem,
  type Cat,
  type DrillState,
} from './codyShared';

interface Props {
  pickerCat: Cat | null;
  accessoryMode: boolean;
  pickerItems: AdItem[];
  pickerLoading: boolean;
  pickerTab: 'all' | 'wish';
  setPickerTab: Dispatch<SetStateAction<'all' | 'wish'>>;
  drill: DrillState;
  setDrill: Dispatch<SetStateAction<DrillState>>;
  genderFilterOn: boolean;
  setGenderFilterOn: Dispatch<SetStateAction<boolean>>;
  artistGender: '남' | '여' | null;
  selected: Partial<Record<Cat, AdItem>>;
  isLoggedIn: boolean;
  closePicker: () => void;
  switchAccessorySub: (sub: Cat) => void;
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
  drill,
  setDrill,
  genderFilterOn,
  setGenderFilterOn,
  artistGender,
  selected,
  isLoggedIn,
  closePicker,
  switchAccessorySub,
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

  // ── v3.205(⑤) 성별 자동 필터 — 드릴 소스 목록에 선적용(패싯 수치도 필터 후 기준) ──
  // genderMatches 재사용: 해당 성별용 + '공용'(미지정 포함) 노출, 반대 성별 숨김.
  // SAMPLE 폴백은 gender 미지정 → '공용' 취급으로 자연 통과. 위시리스트 탭은 불변.
  const genderFilterActive =
    !!artistGender && !!pickerCat && GENDER_FILTER_CATS.includes(pickerCat) && genderFilterOn;
  // v3.206: 악세서리 피커 — 서브탭(모자|가방)이 baseItems 앞단 필터.
  // 해당 서브카테고리 실데이터 0건이면 SAMPLE 폴백(장신구 아닌 모자/가방 샘플).
  const accessorySubItems =
    accessoryMode && pickerCat ? pickerItems.filter((i) => i.category === pickerCat) : null;
  const sourceItems =
    accessorySubItems !== null
      ? (accessorySubItems.length > 0 ? accessorySubItems : SAMPLE_ITEMS[pickerCat!])
      : pickerItems;
  const baseItems = genderFilterActive
    ? sourceItems.filter((i) => genderMatches(i, artistGender!))
    : sourceItems;
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

  // v3.123: 기선택 아이템 id — 전체 탭(BrandGroupGrid)·위시 탭 공용
  const pickedId = pickerCat ? selected[pickerCat]?.id : undefined;

  // 위시리스트 탭: 현재 카테고리의 내 찜 목록 (store엔 전 카테고리 보관)
  const wishItemsForCatRaw: WishItem[] = pickerCat
    ? wishItemsAll.filter((it) => it.category === pickerCat)
    : [];
  // v3.123: 위시 탭도 기선택 우선 정렬
  const wishItemsForCat = pickedId
    ? [...wishItemsForCatRaw].sort((a, b) => (a.id === pickedId ? -1 : b.id === pickedId ? 1 : 0))
    : wishItemsForCatRaw;

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
          <CodyFilterBar
            pickerTab={pickerTab}
            setPickerTab={setPickerTab}
            isLoggedIn={isLoggedIn}
            wishListLoaded={wishListLoaded}
            wishListError={wishListError}
            wishItemsForCat={wishItemsForCat}
            pickerCat={pickerCat}
            artistGender={artistGender}
            genderFilterOn={genderFilterOn}
            setGenderFilterOn={setGenderFilterOn}
            accessoryMode={accessoryMode}
            selected={selected}
            switchAccessorySub={switchAccessorySub}
          />

          {pickerTab === 'all' && (
            <BrandGroupGrid
              pickerLoading={pickerLoading}
              pickerCat={pickerCat}
              sourceItems={sourceItems}
              baseItems={baseItems}
              genderFilterActive={genderFilterActive}
              artistGender={artistGender}
              drill={drill}
              setDrill={setDrill}
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
                      {item.advertiser_nickname ? (
                        <AppText style={styles.itemBrand} numberOfLines={1}>
                          {item.advertiser_nickname}
                        </AppText>
                      ) : null}
                      {/* v3.109: 판매처 링크 — 위시 탭에도 동일 노출(판매종료 아이템도 링크는 유효) */}
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
            )
          )}
        </View>
      </View>
    </Modal>
  );
}
