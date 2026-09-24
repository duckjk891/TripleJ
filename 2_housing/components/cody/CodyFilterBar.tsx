// v3.227(D 추출 1단계): 피커 상단 [전체 | 내 위시리스트] 탭 + 성별 필터 칩(v3.205/207) +
// 악세서리 [모자 | 가방] 서브탭(v3.206) — ArtistCodyScreen :994-1068에서 동작 무변경 이동.
import type { Dispatch, SetStateAction } from 'react';
import { View, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { AppText } from '../ui';
import { showAlert } from '../../utils/appAlert';
import type { WishItem } from '../../stores/wishlistStore';
import { colors } from '../../theme/colors';
import {
  ACCESSORY_SUBCATS,
  GENDER_FILTER_CATS,
  genderLabel,
  pickerStyles as styles,
  type AdItem,
  type Cat,
} from './codyShared';

interface Props {
  pickerTab: 'all' | 'wish';
  setPickerTab: Dispatch<SetStateAction<'all' | 'wish'>>;
  isLoggedIn: boolean;
  wishListLoaded: boolean;
  wishListError: unknown;
  wishItemsForCat: WishItem[];
  pickerCat: Cat | null;
  artistGender: '남' | '여' | null;
  genderFilterOn: boolean;
  setGenderFilterOn: Dispatch<SetStateAction<boolean>>;
  accessoryMode: boolean;
  selected: Partial<Record<Cat, AdItem>>;
  switchAccessorySub: (sub: Cat) => void;
}

export default function CodyFilterBar({
  pickerTab,
  setPickerTab,
  isLoggedIn,
  wishListLoaded,
  wishListError,
  wishItemsForCat,
  pickerCat,
  artistGender,
  genderFilterOn,
  setGenderFilterOn,
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
        {/* v3.205(⑤)→v3.207(⑩): 성별 필터 칩 — 대상 카테고리(상의/하의/신발)에서 상시 노출.
            성별 판별 시 = 기존 "◯◯용만/전체 보기" 토글, 미상 시 = "성별 미설정" 안내 칩(발견성). */}
        {pickerCat && GENDER_FILTER_CATS.includes(pickerCat) ? (
          artistGender ? (
            <TouchableOpacity
              style={[styles.genderChip, genderFilterOn && styles.genderChipActive]}
              onPress={() => setGenderFilterOn((v) => !v)}
              accessibilityLabel="성별 필터 전환"
            >
              <AppText style={[styles.genderChipText, genderFilterOn && styles.genderChipTextActive]}>
                {genderFilterOn ? `${genderLabel(artistGender)}용만` : '전체 보기'}
              </AppText>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.genderChip}
              onPress={() => {
                if (__DEV__) console.info('[ArtistCody] 성별 자동 필터 — 미설정 칩 탭(안내)');
                showAlert(
                  '성별 미설정',
                  '아티스트 성별이 설정되지 않아 전체 아이템을 보여드리고 있어요.\n아티스트 프로필에서 성별을 설정하면 성별 맞춤 필터를 사용할 수 있어요.'
                );
              }}
              accessibilityLabel="성별 미설정 안내"
            >
              <AppText style={styles.genderChipText}>성별 미설정 · 전체 표시</AppText>
            </TouchableOpacity>
          )
        ) : null}
      </View>

      {/* v3.206: 악세서리 하위 구분 세그먼트 [모자 | 가방] — baseItems 앞단 필터, 각 1개씩 동시 선택 */}
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
