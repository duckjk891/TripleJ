// v3.227(D): 피커 상품 카드 — 추출 커밋의 BrandGroupGrid renderItem을 공용 카드로 분리.
// 유지: v3.124 선택됨(강조 테두리+체크 배지), 위시 하트(샘플 숨김, v3.176 채움 보라), v3.109 판매처 보기.
// 변경(PLAN D): 배지 = 실제 브랜드(brand, advertiser_nickname은 폴백), 색상 잔재 숨김(매퍼가 정리), 가격 표시.
import { View, TouchableOpacity, Image } from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { AppText } from '../ui';
import { colors } from '../../theme/colors';
import { brandNameOf, formatPrice, type AdItem } from '../../utils/codyCatalog';
import { adImageUrl, pickerStyles as styles } from './codyShared';

interface Props {
  item: AdItem;
  isPicked: boolean;
  wished: boolean;
  wishBusy: boolean;
  onPick: (item: AdItem) => void;
  onWishToggle: (item: { id: string }) => void;
  onOpenLink: (item: { id: string; product_url?: string }) => void;
}

export default function CodyItemCard({ item, isPicked, wished, wishBusy, onPick, onWishToggle, onOpenLink }: Props) {
  const url = adImageUrl(item.image_object_name);
  const isSample = item.id.startsWith('sample_');
  const brand = brandNameOf(item);
  const price = formatPrice(item.price_krw);
  return (
    <TouchableOpacity
      style={[styles.itemCard, isPicked && styles.itemCardPicked]}
      onPress={() => onPick(item)}
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
        {brand ? (
          <View style={styles.brandBadge}>
            <AppText style={styles.brandBadgeText} numberOfLines={1}>
              {brand}
            </AppText>
          </View>
        ) : null}
        {/* 위시 하트 — 샘플 더미는 서버에 없어 담기 불가 → 숨김 */}
        {!isSample && (
          <TouchableOpacity
            style={styles.wishBtn}
            onPress={() => onWishToggle(item)}
            disabled={wishBusy}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            {/* v3.176: 담기면 채워진 하트+플랫폼 보라 (플레이어 착장 카드와 통일) */}
            <MaterialCommunityIcons
              name={wished ? 'heart' : 'heart-outline'}
              size={17}
              color={wished ? colors.accent.primary : '#fff'}
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
      {price ? (
        <AppText style={styles.itemPrice} numberOfLines={1}>{price}</AppText>
      ) : null}
      {/* v3.109: 판매처 링크 — product_url 있는 아이템만 노출 */}
      {item.product_url ? (
        <TouchableOpacity
          style={styles.itemLinkBtn}
          onPress={() => onOpenLink(item)}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <Feather name="external-link" size={11} color={colors.accent.primary} />
          <AppText style={styles.itemLinkText}>판매처 보기</AppText>
        </TouchableOpacity>
      ) : null}
    </TouchableOpacity>
  );
}
