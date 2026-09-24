// v3.227(D): 피커 상단 [전체 | 내 위시리스트] 탭(v3.90) + 악세서리 [모자 | 가방] 서브탭(v3.206).
// (v3.227 추출 커밋의 CodyFilterBar 상단부를 그대로 옮김 — 성별 칩은 PLAN대로 CodyFilterBar 필터 행으로 이동)
import type { Dispatch, SetStateAction } from 'react';
import { View, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { AppText } from '../ui';
import type { WishItem } from '../../stores/wishlistStore';
import { colors } from '../../theme/colors';
import { ACCESSORY_SUBCATS, type AdItem, type Cat } from '../../utils/codyCatalog';
import { pickerStyles as styles } from './codyShared';

interface Props {
  pickerTab: 'all' | 'wish';
  setPickerTab: Dispatch<SetStateAction<'all' | 'wish'>>;
  isLoggedIn: boolean;
  wishListLoaded: boolean;
  wishListError: unknown;
  wishItemsForCat: WishItem[];
  pickerCat: Cat | null;
  accessoryMode: boolean;
  selected: Partial<Record<Cat, AdItem>>;
  switchAccessorySub: (sub: Cat) => void;
}

export default function CodyPickerTabs({
  pickerTab,
  setPickerTab,
  isLoggedIn,
  wishListLoaded,
  wishListError,
  wishItemsForCat,
  pickerCat,
  accessoryMode,
  selected,
  switchAccessorySub,
}: Props) {
  return (
    <>
      {/* v3.90: 전체 | 위시리스트 탭 */}
      <View style={styles.pickerTabs}>
        <TouchableOpacity
          style={[styles.pickerTab, pickerTab === 'all' && styles.pickerTabActive]}
          onPress={() => setPickerTab('all')}
        >
          <AppText style={[styles.pickerTabText, pickerTab === 'all' && styles.pickerTabTextActive]}>
            전체
          </AppText>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.pickerTab, pickerTab === 'wish' && styles.pickerTabActive]}
          onPress={() => setPickerTab('wish')}
        >
          <Feather
            name="heart"
            size={12}
            color={pickerTab === 'wish' ? colors.accent.primary : colors.text.muted}
          />
          <AppText style={[styles.pickerTabText, pickerTab === 'wish' && styles.pickerTabTextActive]}>
            {' '}내 위시리스트{isLoggedIn && wishListLoaded && !wishListError ? ` (${wishItemsForCat.length})` : ''}
          </AppText>
        </TouchableOpacity>
      </View>

      {/* v3.206: 악세서리 하위 구분 세그먼트 [모자 | 가방] — 각 1개씩 동시 선택 */}
      {accessoryMode && (
        <View style={styles.subcatRow}>
          {ACCESSORY_SUBCATS.map((sub) => {
            const active = pickerCat === sub;
            const picked = selected[sub];
            return (
              <TouchableOpacity
                key={sub}
                style={[styles.subcatSeg, active && styles.subcatSegActive]}
                onPress={() => switchAccessorySub(sub)}
              >
                <AppText style={[styles.subcatSegText, active && styles.subcatSegTextActive]}>
                  {sub}
                  {picked ? ` · ${picked.name}` : ''}
                </AppText>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </>
  );
}
