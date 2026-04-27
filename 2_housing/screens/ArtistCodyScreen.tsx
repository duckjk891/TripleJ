import { useEffect, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Image,
  Modal,
  FlatList,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import api, { BACKEND_BASE_URL } from '../services/api';
import { useCharacterTaskStore } from '../stores/characterTaskStore';
import { colors } from '../theme/colors';

type Cat = '상의' | '하의' | '신발' | '헤어스타일' | '헤어컬러' | '악세서리' | '안경' | '문신';
const CATEGORIES: Cat[] = ['상의', '하의', '신발', '헤어스타일', '헤어컬러', '악세서리', '안경', '문신'];

const CAT_ICONS: Record<Cat, string> = {
  '상의': '👕', '하의': '👖', '신발': '👟',
  '헤어스타일': '💇', '헤어컬러': '🎨',
  '악세서리': '💍', '안경': '👓', '문신': '🎭',
};

interface AdItem {
  id: string;
  name: string;
  image_object_name?: string;
  product_url?: string;
  advertiser_nickname?: string;
}

// 광고 0개일 때 노출할 더미 샘플 (UX 데모용) — 카테고리당 5개
const SAMPLE_ITEMS: Record<Cat, AdItem[]> = {
  상의: [
    { id: 'sample_top_1', name: '베이직 흰 티', advertiser_nickname: '샘플' },
    { id: 'sample_top_2', name: '오버사이즈 후디', advertiser_nickname: '샘플' },
    { id: 'sample_top_3', name: '데님 셔츠', advertiser_nickname: '샘플' },
    { id: 'sample_top_4', name: '스트라이프 폴로', advertiser_nickname: '샘플' },
    { id: 'sample_top_5', name: '검은 가죽 자켓', advertiser_nickname: '샘플' },
  ],
  하의: [
    { id: 'sample_bot_1', name: '슬림 청바지', advertiser_nickname: '샘플' },
    { id: 'sample_bot_2', name: '와이드 슬랙스', advertiser_nickname: '샘플' },
    { id: 'sample_bot_3', name: '카고 팬츠', advertiser_nickname: '샘플' },
    { id: 'sample_bot_4', name: '플리츠 스커트', advertiser_nickname: '샘플' },
    { id: 'sample_bot_5', name: '조거 트레이닝', advertiser_nickname: '샘플' },
  ],
  신발: [
    { id: 'sample_shoes_1', name: '하얀 스니커즈', advertiser_nickname: '샘플' },
    { id: 'sample_shoes_2', name: '컴뱃 부츠', advertiser_nickname: '샘플' },
    { id: 'sample_shoes_3', name: '러닝화', advertiser_nickname: '샘플' },
    { id: 'sample_shoes_4', name: '로퍼', advertiser_nickname: '샘플' },
    { id: 'sample_shoes_5', name: '플랫폼 슈즈', advertiser_nickname: '샘플' },
  ],
  헤어스타일: [
    { id: 'sample_hair_1', name: '단발 컷', advertiser_nickname: '샘플' },
    { id: 'sample_hair_2', name: '보브 헤어', advertiser_nickname: '샘플' },
    { id: 'sample_hair_3', name: '슬릭백', advertiser_nickname: '샘플' },
    { id: 'sample_hair_4', name: '포니테일', advertiser_nickname: '샘플' },
    { id: 'sample_hair_5', name: '양갈래 트윈테일', advertiser_nickname: '샘플' },
  ],
  헤어컬러: [
    { id: 'sample_color_1', name: '블랙', advertiser_nickname: '샘플' },
    { id: 'sample_color_2', name: '브라운', advertiser_nickname: '샘플' },
    { id: 'sample_color_3', name: '블론드', advertiser_nickname: '샘플' },
    { id: 'sample_color_4', name: '핑크 염색', advertiser_nickname: '샘플' },
    { id: 'sample_color_5', name: '핑크-퍼플 그라데이션', advertiser_nickname: '샘플' },
  ],
  악세서리: [
    { id: 'sample_accessory_1', name: '후프 귀걸이', advertiser_nickname: '샘플' },
    { id: 'sample_accessory_2', name: '진주 목걸이', advertiser_nickname: '샘플' },
    { id: 'sample_accessory_3', name: '체인 목걸이', advertiser_nickname: '샘플' },
    { id: 'sample_accessory_4', name: '가죽 팔찌', advertiser_nickname: '샘플' },
    { id: 'sample_accessory_5', name: '골드 팔찌', advertiser_nickname: '샘플' },
  ],
  안경: [
    { id: 'sample_glasses_1', name: '라운드 프레임', advertiser_nickname: '샘플' },
    { id: 'sample_glasses_2', name: '스퀘어 프레임', advertiser_nickname: '샘플' },
    { id: 'sample_glasses_3', name: '캣아이', advertiser_nickname: '샘플' },
    { id: 'sample_glasses_4', name: '블랙 선글라스', advertiser_nickname: '샘플' },
    { id: 'sample_glasses_5', name: '보스턴 클래식', advertiser_nickname: '샘플' },
  ],
  문신: [
    { id: 'sample_tattoo_1', name: '손목 작은 별', advertiser_nickname: '샘플' },
    { id: 'sample_tattoo_2', name: '어깨 부족 무늬', advertiser_nickname: '샘플' },
    { id: 'sample_tattoo_3', name: '팔뚝 영문 문구', advertiser_nickname: '샘플' },
    { id: 'sample_tattoo_4', name: '발목 별자리', advertiser_nickname: '샘플' },
    { id: 'sample_tattoo_5', name: '등 라인 드로잉', advertiser_nickname: '샘플' },
  ],
};

function adImageUrl(objectName?: string): string | null {
  if (!objectName) return null;
  return `${BACKEND_BASE_URL}/api/business/items/image/${objectName}`;
}

export default function ArtistCodyScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const taskStore = useCharacterTaskStore();
  const apiResult = taskStore.apiResult;

  // 카테고리별 선택된 아이템 (단일 선택)
  const [selected, setSelected] = useState<Partial<Record<Cat, AdItem>>>({});

  const [pickerCat, setPickerCat] = useState<Cat | null>(null);
  const [pickerItems, setPickerItems] = useState<AdItem[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);

  const openPicker = async (cat: Cat) => {
    setPickerCat(cat);
    setPickerLoading(true);
    try {
      const res = await api.get('/business/ads/active', { params: { category: cat } });
      const items: AdItem[] = res.data?.items || [];
      setPickerItems(items.length > 0 ? items : SAMPLE_ITEMS[cat]);
    } catch {
      setPickerItems(SAMPLE_ITEMS[cat]);
    } finally {
      setPickerLoading(false);
    }
  };

  const pickItem = (item: AdItem) => {
    if (!pickerCat) return;
    setSelected((prev) => ({ ...prev, [pickerCat]: item }));
    api.post(`/business/ads/${item.id}/impression`).catch(() => {});
    setPickerCat(null);
  };

  const clearItem = (cat: Cat) => {
    setSelected((prev) => {
      const next = { ...prev };
      delete next[cat];
      return next;
    });
  };

  const selectedEntries = CATEGORIES
    .map((c) => [c, selected[c]] as const)
    .filter(([, item]) => !!item);

  const handleApply = () => {
    if (!apiResult) {
      Alert.alert('오류', '먼저 캐릭터 시트가 필요해요.');
      return;
    }
    if (selectedEntries.length === 0) {
      Alert.alert('알림', '입혀줄 아이템을 하나 이상 골라주세요.');
      return;
    }
    const desc = selectedEntries.map(([cat, item]) => `${cat}: ${item!.name}`).join(', ');
    navigation.replace('ArtistLoading', {
      mode: 'outfit',
      outfitDesc: desc,
    });
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      <Text style={styles.title}>옷 입히기</Text>
      <Text style={styles.subtitle}>원하는 카테고리를 골라보세요. 여러 개 동시에 선택할 수 있어요.</Text>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
        <View style={styles.grid}>
          {CATEGORIES.map((cat) => {
            const sel = selected[cat];
            return (
              <TouchableOpacity
                key={cat}
                style={[styles.catCard, sel && styles.catCardSelected]}
                onPress={() => openPicker(cat)}
                onLongPress={() => sel && clearItem(cat)}
              >
                <Text style={styles.catIcon}>{CAT_ICONS[cat]}</Text>
                <Text style={styles.catName}>{cat}</Text>
                <Text style={styles.catSub} numberOfLines={1}>
                  {sel ? sel.name : '고르기'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {selectedEntries.length > 0 && (
          <View style={styles.summaryBox}>
            <Text style={styles.summaryLabel}>선택한 아이템 ({selectedEntries.length})</Text>
            <View style={styles.summaryChips}>
              {selectedEntries.map(([cat, item]) => (
                <View key={cat} style={styles.summaryChip}>
                  <Text style={styles.summaryChipText}>
                    {CAT_ICONS[cat as Cat]} {item!.name}
                  </Text>
                </View>
              ))}
            </View>
            <Text style={styles.hint}>꾹 누르면 카테고리 선택 해제</Text>
          </View>
        )}
      </ScrollView>

      <View style={[styles.bottomArea, { paddingBottom: 16 + insets.bottom }]}>
        <View style={styles.btnRow}>
          <TouchableOpacity style={styles.skipBtn} onPress={() => navigation.replace('ArtistResult')}>
            <Text style={styles.skipBtnText}>취소</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.applyBtn, selectedEntries.length === 0 && { opacity: 0.4 }]}
            onPress={handleApply}
            disabled={selectedEntries.length === 0}
          >
            <Text style={styles.applyBtnText}>이 옷으로 입히기 (대기 필요)</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 카테고리별 아이템 선택 모달 */}
      <Modal
        visible={pickerCat !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setPickerCat(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {pickerCat ? `${CAT_ICONS[pickerCat]} ${pickerCat} 고르기` : ''}
              </Text>
              <TouchableOpacity onPress={() => setPickerCat(null)}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            {pickerLoading ? (
              <View style={{ padding: 40, alignItems: 'center' }}>
                <ActivityIndicator size="large" color={colors.accent.primary} />
              </View>
            ) : pickerItems.length === 0 ? (
              <View style={{ padding: 40 }}>
                <Text style={styles.emptyDesc}>
                  등록된 {pickerCat} 아이템이 없어요.
                </Text>
              </View>
            ) : (
              <FlatList
                data={pickerItems}
                keyExtractor={(item) => item.id}
                numColumns={2}
                renderItem={({ item }) => {
                  const url = adImageUrl(item.image_object_name);
                  return (
                    <TouchableOpacity
                      style={styles.itemCard}
                      onPress={() => pickItem(item)}
                    >
                      {url ? (
                        <Image source={{ uri: url }} style={styles.itemImg} />
                      ) : (
                        <View style={[styles.itemImg, { backgroundColor: colors.bg.surface2, justifyContent: 'center', alignItems: 'center' }]}>
                          <Text style={{ fontSize: 28 }}>{pickerCat ? CAT_ICONS[pickerCat] : '?'}</Text>
                        </View>
                      )}
                      <Text style={styles.itemName} numberOfLines={1}>{item.name}</Text>
                      {item.advertiser_nickname ? (
                        <Text style={styles.itemBrand} numberOfLines={1}>{item.advertiser_nickname}</Text>
                      ) : null}
                    </TouchableOpacity>
                  );
                }}
                contentContainerStyle={{ padding: 12 }}
              />
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.deepest },
  title: { color: colors.text.primary, fontSize: 18, fontWeight: '700', paddingHorizontal: 16 },
  subtitle: { color: colors.text.secondary, fontSize: 13, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  catCard: {
    width: '48%',
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  catCardSelected: {
    borderColor: colors.accent.primary,
    backgroundColor: colors.bg.surface2,
  },
  catIcon: { fontSize: 30, marginBottom: 6 },
  catName: { color: colors.text.primary, fontSize: 13, fontWeight: '700', marginBottom: 4 },
  catSub: { color: colors.text.secondary, fontSize: 11, paddingHorizontal: 8 },

  summaryBox: {
    marginTop: 16, padding: 12,
    backgroundColor: colors.bg.surface1, borderRadius: 12,
    borderWidth: 1, borderColor: colors.border.subtle,
  },
  summaryLabel: { color: colors.accent.primary, fontSize: 12, fontWeight: '700', marginBottom: 8 },
  summaryChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  summaryChip: {
    backgroundColor: colors.bg.surface2,
    borderColor: colors.accent.primary,
    borderWidth: 1,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 12,
  },
  summaryChipText: { color: colors.text.primary, fontSize: 12, fontWeight: '600' },
  hint: { color: colors.text.muted, fontSize: 10, marginTop: 8 },

  bottomArea: {
    padding: 14, borderTopWidth: 1, borderTopColor: colors.bg.surface1,
    backgroundColor: colors.bg.deepest,
  },
  btnRow: { flexDirection: 'row', gap: 8 },
  skipBtn: {
    flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center',
    backgroundColor: colors.bg.surface2, borderWidth: 1, borderColor: colors.border.subtle,
  },
  skipBtnText: { color: colors.text.secondary, fontSize: 13, fontWeight: '600' },
  applyBtn: {
    flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center',
    backgroundColor: colors.accent.primary,
  },
  applyBtnText: { color: colors.text.primary, fontSize: 13, fontWeight: '700' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(13, 8, 32, 0.85)', justifyContent: 'flex-end' },
  modalBox: {
    backgroundColor: colors.bg.deepest,
    borderTopLeftRadius: 18, borderTopRightRadius: 18,
    maxHeight: '80%',
    borderTopWidth: 1, borderTopColor: colors.accent.primary,
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 16, borderBottomWidth: 1, borderBottomColor: colors.bg.surface1,
  },
  modalTitle: { color: colors.text.primary, fontSize: 16, fontWeight: '700' },
  modalClose: { color: colors.text.secondary, fontSize: 22 },
  emptyDesc: { fontSize: 14, color: colors.text.secondary, textAlign: 'center', lineHeight: 22 },

  itemCard: {
    flex: 1, margin: 6, padding: 10,
    backgroundColor: colors.bg.surface1, borderRadius: 12,
    borderWidth: 1, borderColor: colors.border.subtle,
  },
  itemImg: { width: '100%', aspectRatio: 1, borderRadius: 8, marginBottom: 8 },
  itemName: { color: colors.text.primary, fontSize: 13, fontWeight: '600' },
  itemBrand: { color: colors.text.muted, fontSize: 11, marginTop: 2 },
});
