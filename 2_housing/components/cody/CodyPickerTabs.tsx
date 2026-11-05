// v3.227(D): 피커 상단 [전체 | 내 위시리스트] 탭(v3.90). v3.428(대표 11-05): 악세서리 [모자 | 가방] 전환은 제거 — 코디 보드·선택 스트립에서 칸을 고른다.
// (v3.227 추출 커밋의 CodyFilterBar 상단부를 그대로 옮김 — 성별 칩은 PLAN대로 CodyFilterBar 필터 행으로 이동)
import type { Dispatch, SetStateAction } from 'react';
import { View, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { AppText } from '../ui';
import type { WishItem } from '../../stores/wishlistStore';
import { colors } from '../../theme/colors';
import type { Cat } from '../../utils/codyCatalog';
import { pickerStyles as styles } from './codyShared';

interface Props {
  pickerTab: 'all' | 'wish';
  setPickerTab: Dispatch<SetStateAction<'all' | 'wish'>>;
  isLoggedIn: boolean;
  wishListLoaded: boolean;
  wishListError: unknown;
  wishItemsForCat: WishItem[];
  pickerCat: Cat | null;
}

export default function CodyPickerTabs({
  pickerTab,
  setPickerTab,
  isLoggedIn,
  wishListLoaded,
  wishListError,
  wishItemsForCat,
  pickerCat,
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
    </>
  );
}
