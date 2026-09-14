// [WishlistScreen] v3.175(대표): 내 위시리스트 전용 화면.
//   플레이어 착장 카드 / 꾸미기 아이템 피커에서 하트로 담은 광고 상품(옷·장소)을
//   한곳에서 모아 보고, 판매처로 이동하거나 해제한다.
//   - 데이터: wishlistStore.fetchList()(GET /wishlist/) — 전 카테고리 items[] 재사용
//   - 카드: 이미지 + 카테고리 배지 + 이름 + 브랜드 + [판매처 보기] + 해제 하트
//   - 당겨서 새로고침, 미로그인/빈 목록 안내
import { useCallback } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  RefreshControl,
  Linking,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import { showAlert } from '../utils/appAlert';
import { colors } from '../theme/colors';
import { AppText, EmptyState } from '../components/ui';
import { BACKEND_BASE_URL } from '../services/api';
import { useWishlistStore, type WishItem } from '../stores/wishlistStore';
import { useAuthStore } from '../stores/authStore';

export default function WishlistScreen({ navigation }: any) {
  const user = useAuthStore((s) => s.user);
  const isLoggedIn = !!user;
  const items = useWishlistStore((s) => s.items);
  const listLoading = useWishlistStore((s) => s.listLoading);
  const listLoaded = useWishlistStore((s) => s.listLoaded);
  const listError = useWishlistStore((s) => s.listError);
  const busy = useWishlistStore((s) => s.busy);

  useFocusEffect(
    useCallback(() => {
      if (!isLoggedIn) return;
      if (__DEV__) console.info('[WishlistScreen] focus → fetchList');
      useWishlistStore.getState().fetchList(true);
    }, [isLoggedIn]),
  );

  const handleOpenUrl = (item: WishItem) => {
    if (!item.product_url) return;
    const url = item.product_url.startsWith('http') ? item.product_url : `https://${item.product_url}`;
    if (__DEV__) console.info('[WishlistScreen] open url', { id: item.id });
    Linking.openURL(url).catch((err) => {
      console.error('[WishlistScreen] openURL 실패', { id: item.id });
      showAlert('알림', '링크를 열 수 없어요');
    });
  };

  const handleUnwish = (item: WishItem) => {
    if (__DEV__) console.info('[WishlistScreen] unwish', { id: item.id });
    useWishlistStore.getState().toggle(item.id);
  };

  const renderItem = ({ item }: { item: WishItem }) => {
    const img = item.image_object_name
      ? `${BACKEND_BASE_URL}/api/character/preview/${item.image_object_name}`
      : null;
    const hasUrl = !!item.product_url;
    return (
      <View style={styles.card}>
        <View>
          {img ? (
            <Image source={{ uri: img }} style={styles.cardImg} />
          ) : (
            <View style={[styles.cardImg, styles.cardImgPh]}>
              <Feather name="image" size={22} color={colors.text.muted} />
            </View>
          )}
          <TouchableOpacity
            style={styles.wishBtn}
            onPress={() => handleUnwish(item)}
            disabled={!!busy[item.id]}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel={`위시 해제 ${item.name || ''}`}
          >
            <MaterialCommunityIcons name="heart" size={18} color="#FF4D6D" />
          </TouchableOpacity>
        </View>
        <View style={styles.cardBody}>
          {item.category ? <AppText style={styles.cardCat}>{item.category}</AppText> : null}
          <AppText style={styles.cardName} numberOfLines={2}>{item.name || '아이템'}</AppText>
          {item.advertiser_nickname ? (
            <AppText style={styles.cardBrand} numberOfLines={1}>{item.advertiser_nickname}</AppText>
          ) : null}
          {hasUrl ? (
            <TouchableOpacity style={styles.linkBtn} onPress={() => handleOpenUrl(item)}>
              <Feather name="external-link" size={12} color={colors.accent.primary} />
              <AppText style={styles.linkBtnText}> 판매처 보기</AppText>
            </TouchableOpacity>
          ) : (
            <View style={[styles.linkBtn, styles.linkBtnDisabled]}>
              <AppText style={styles.linkBtnTextDisabled}>링크 없음</AppText>
            </View>
          )}
        </View>
      </View>
    );
  };

  if (!isLoggedIn) {
    return (
      <View style={styles.container}>
        <EmptyState icon="🔒" title="로그인이 필요해요" hint="로그인하면 담아둔 아이템을 볼 수 있어요." />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {listLoading && !listLoaded ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent.primary} /></View>
      ) : listError ? (
        <View style={styles.center}>
          <EmptyState icon="⚠️" title="불러오지 못했어요" hint="당겨서 새로고침 해주세요." />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.id}
          renderItem={renderItem}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={listLoading}
              onRefresh={() => useWishlistStore.getState().fetchList(true)}
              tintColor={colors.accent.primary}
            />
          }
          ListHeaderComponent={
            items.length > 0 ? (
              <AppText style={styles.headerHint}>담아둔 아이템 {items.length}개 · 하트를 다시 누르면 해제돼요</AppText>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <EmptyState
                icon="🤍"
                title="담아둔 아이템이 없어요"
                hint="곡 재생 화면의 '착장' 탭이나 아티스트 꾸미기에서 하트를 눌러 담아보세요."
              />
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.deepest },
  center: { flex: 1, minHeight: 320, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  listContent: { padding: 12, paddingBottom: 40 },
  row: { gap: 12 },
  headerHint: { fontSize: 12, color: colors.text.secondary, marginBottom: 10, marginLeft: 2 },
  card: {
    flex: 1,
    backgroundColor: colors.bg.surface1,
    borderRadius: 12,
    borderWidth: 1, borderColor: colors.border.subtle,
    padding: 8, marginBottom: 12,
  },
  cardImg: { width: '100%', aspectRatio: 1, borderRadius: 8, backgroundColor: colors.bg.surface2 },
  cardImgPh: { justifyContent: 'center', alignItems: 'center' },
  wishBtn: {
    position: 'absolute', top: 6, right: 6,
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderWidth: 1.5, borderColor: '#FF4D6D',
    justifyContent: 'center', alignItems: 'center',
  },
  cardBody: { paddingTop: 8, paddingHorizontal: 2 },
  cardCat: { fontSize: 10, color: colors.accent.primary, fontWeight: '700', letterSpacing: 0.3, marginBottom: 2 },
  cardName: { fontSize: 12, color: colors.text.primary, lineHeight: 16, minHeight: 32 },
  cardBrand: { fontSize: 11, color: colors.text.muted, marginTop: 2 },
  linkBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    marginTop: 8, paddingVertical: 7, borderRadius: 8,
    backgroundColor: colors.bg.surface2,
  },
  linkBtnText: { color: colors.text.primary, fontSize: 11, fontWeight: '700' },
  linkBtnDisabled: { backgroundColor: 'transparent' },
  linkBtnTextDisabled: { color: colors.text.muted, fontSize: 11, fontWeight: '600' },
});
