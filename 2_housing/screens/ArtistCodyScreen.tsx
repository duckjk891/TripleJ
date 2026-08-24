import { useEffect, useLayoutEffect, useState } from 'react';
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
import { AppText } from '../components/ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import api, { BACKEND_BASE_URL } from '../services/api';
import { useCharacterTaskStore } from '../stores/characterTaskStore';
import { useTimerStore } from '../stores/timerStore';
import { usePlayerStore } from '../stores/playerStore';
import { useOutfitStore, type AppliedItem } from '../stores/outfitStore';
import { usePointsStore } from '../stores/pointsStore';
import { colors } from '../theme/colors';

const MINIPLAYER_HEIGHT = 70;

type Cat = '상의' | '하의' | '신발' | '헤어스타일' | '헤어컬러' | '악세서리' | '안경' | '문신';
const CATEGORIES: Cat[] = ['상의', '하의', '신발', '헤어스타일', '헤어컬러', '악세서리', '안경', '문신'];

// 카테고리별 핏/기장 옵션 (선택사항, 빠른 토글) — A방안
type OptionGroup = { label: string; values: string[] };
const CAT_OPTIONS: Partial<Record<Cat, OptionGroup[]>> = {
  상의: [
    { label: '핏', values: ['슬림', '레귤러', '오버핏'] },
    { label: '길이', values: ['크롭', '레귤러', '롱'] },
  ],
  하의: [
    { label: '핏', values: ['스키니', '슬림', '와이드', '와이드오버'] },
    { label: '기장', values: ['반바지', '7부', '9부', '풀'] },
  ],
  신발: [
    { label: '양말', values: ['없음', '발목', '롱'] },
  ],
};

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
// advertiser_nickname은 가상 브랜드명 (실제 광고주가 등록되면 그 브랜드명으로 자동 교체)
const SAMPLE_ITEMS: Record<Cat, AdItem[]> = {
  상의: [
    { id: 'sample_top_1', name: '베이직 흰 티', advertiser_nickname: 'AURA' },
    { id: 'sample_top_2', name: '오버사이즈 후디', advertiser_nickname: 'STARLIGHT' },
    { id: 'sample_top_3', name: '데님 셔츠', advertiser_nickname: 'INDIGO CO.' },
    { id: 'sample_top_4', name: '스트라이프 폴로', advertiser_nickname: 'MOON CLUB' },
    { id: 'sample_top_5', name: '검은 가죽 자켓', advertiser_nickname: 'NOIR' },
  ],
  하의: [
    { id: 'sample_bot_1', name: '슬림 청바지', advertiser_nickname: 'INDIGO CO.' },
    { id: 'sample_bot_2', name: '와이드 슬랙스', advertiser_nickname: 'PIVOT' },
    { id: 'sample_bot_3', name: '카고 팬츠', advertiser_nickname: 'STARLIGHT' },
    { id: 'sample_bot_4', name: '플리츠 스커트', advertiser_nickname: 'AURA' },
    { id: 'sample_bot_5', name: '조거 트레이닝', advertiser_nickname: 'STRIDE' },
  ],
  신발: [
    { id: 'sample_shoes_1', name: '하얀 스니커즈', advertiser_nickname: 'STRIDE' },
    { id: 'sample_shoes_2', name: '컴뱃 부츠', advertiser_nickname: 'NOIR' },
    { id: 'sample_shoes_3', name: '러닝화', advertiser_nickname: 'STRIDE' },
    { id: 'sample_shoes_4', name: '로퍼', advertiser_nickname: 'LACE+' },
    { id: 'sample_shoes_5', name: '플랫폼 슈즈', advertiser_nickname: 'MOON CLUB' },
  ],
  헤어스타일: [
    { id: 'sample_hair_1', name: '단발 컷', advertiser_nickname: 'SALON N' },
    { id: 'sample_hair_2', name: '보브 헤어', advertiser_nickname: 'CURL+' },
    { id: 'sample_hair_3', name: '슬릭백', advertiser_nickname: 'SALON N' },
    { id: 'sample_hair_4', name: '포니테일', advertiser_nickname: 'CURL+' },
    { id: 'sample_hair_5', name: '양갈래 트윈테일', advertiser_nickname: 'CURL+' },
  ],
  헤어컬러: [
    { id: 'sample_color_1', name: '블랙', advertiser_nickname: 'CHROMA' },
    { id: 'sample_color_2', name: '브라운', advertiser_nickname: 'TINT LAB' },
    { id: 'sample_color_3', name: '블론드', advertiser_nickname: 'CHROMA' },
    { id: 'sample_color_4', name: '핑크 염색', advertiser_nickname: 'TINT LAB' },
    { id: 'sample_color_5', name: '핑크-퍼플 그라데이션', advertiser_nickname: 'TINT LAB' },
  ],
  악세서리: [
    { id: 'sample_accessory_1', name: '후프 귀걸이', advertiser_nickname: 'GLEAM' },
    { id: 'sample_accessory_2', name: '진주 목걸이', advertiser_nickname: 'PEARL & CO.' },
    { id: 'sample_accessory_3', name: '체인 목걸이', advertiser_nickname: 'GLEAM' },
    { id: 'sample_accessory_4', name: '가죽 팔찌', advertiser_nickname: 'CHARM' },
    { id: 'sample_accessory_5', name: '골드 팔찌', advertiser_nickname: 'PEARL & CO.' },
  ],
  안경: [
    { id: 'sample_glasses_1', name: '라운드 프레임', advertiser_nickname: 'VISION' },
    { id: 'sample_glasses_2', name: '스퀘어 프레임', advertiser_nickname: 'FRAME WORK' },
    { id: 'sample_glasses_3', name: '캣아이', advertiser_nickname: 'VISION' },
    { id: 'sample_glasses_4', name: '블랙 선글라스', advertiser_nickname: 'NOIR' },
    { id: 'sample_glasses_5', name: '보스턴 클래식', advertiser_nickname: 'FRAME WORK' },
  ],
  문신: [
    { id: 'sample_tattoo_1', name: '손목 작은 별', advertiser_nickname: 'INK STORY' },
    { id: 'sample_tattoo_2', name: '어깨 부족 무늬', advertiser_nickname: 'TRACE' },
    { id: 'sample_tattoo_3', name: '팔뚝 영문 문구', advertiser_nickname: 'INK STORY' },
    { id: 'sample_tattoo_4', name: '발목 별자리', advertiser_nickname: 'TRACE' },
    { id: 'sample_tattoo_5', name: '등 라인 드로잉', advertiser_nickname: 'INK STORY' },
  ],
};

function adImageUrl(objectName?: string): string | null {
  if (!objectName) return null;
  return `${BACKEND_BASE_URL}/api/business/items/image/${objectName}`;
}

export default function ArtistCodyScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const taskStore = useCharacterTaskStore();
  const apiResult = taskStore.apiResult;
  const hasMiniPlayer = !!usePlayerStore((s) => s.track);
  const bottomLift = hasMiniPlayer ? MINIPLAYER_HEIGHT : 0;
  // 'sheet' = 초기 캐릭터 생성 흐름 (시트 없음, 옷 함께 만들기) / 'outfit' = 기존 캐릭터 꾸미기
  const isSheetMode = route?.params?.mode === 'sheet';

  // v3.76(MAIDOL v158): 캐릭터 생성 비용 — /points/costs 단일 소스(실패 시 10 폴백)
  const [characterCost, setCharacterCost] = useState(10);
  const balance = usePointsStore((s) => s.balance);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await api.get('/points/costs');
        if (alive && res.data?.costs?.character != null) setCharacterCost(res.data.costs.character);
      } catch (err: any) {
        console.error('[ArtistCody] /points/costs 조회 실패', { status: err?.response?.status });
      }
    })();
    usePointsStore.getState().fetchBalance();
    return () => { alive = false; };
  }, []);

  // 카테고리별 선택된 아이템 (단일 선택)
  const [selected, setSelected] = useState<Partial<Record<Cat, AdItem>>>({});
  // 카테고리별 옵션 (핏/기장 등)
  const [itemOptions, setItemOptions] = useState<Partial<Record<Cat, Record<string, string>>>>({});

  const toggleOption = (cat: Cat, label: string, value: string) => {
    setItemOptions((prev) => {
      const catOpts = { ...(prev[cat] || {}) };
      if (catOpts[label] === value) {
        delete catOpts[label]; // 같은 값 다시 누르면 해제
      } else {
        catOpts[label] = value;
      }
      return { ...prev, [cat]: catOpts };
    });
  };

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
    // sheet 모드: 시트 없어도 진행 (옷+사진으로 처음부터 만듦). 옷 미선택은 디폴트 fallback.
    if (!isSheetMode && !apiResult) {
      Alert.alert('오류', '먼저 캐릭터 시트가 필요해요.');
      return;
    }
    if (!isSheetMode && selectedEntries.length === 0) {
      Alert.alert('알림', '입혀줄 아이템을 하나 이상 골라주세요.');
      return;
    }
    // v3.76: 잔액 사전 체크 — 대기열 소진 후 402로 실패하는 낭패 방지
    const bal = usePointsStore.getState().balance;
    if (bal != null && bal < characterCost) {
      if (__DEV__) console.info('[ArtistCody] 별 부족 사전 차단', { bal, cost: characterCost });
      Alert.alert('별이 부족해요', `캐릭터 시트 생성에는 ⭐${characterCost}개가 필요해요.\n현재 보유: ⭐${bal}`);
      return;
    }
    // 카테고리별로 분류 — 의상류는 "기존 제거 후 새로 입힘", 헤어/문신은 "명시된 것만 변경"
    const CLOTHING_CATS: Cat[] = ['상의', '하의', '신발', '안경', '악세서리'];
    // 브랜드명 + 옵션(핏/기장)까지 포함: "상의=AURA 베이직 흰 티 (핏:슬림, 길이:크롭)"
    const fmt = (cat: string, item: AdItem) => {
      const opts = itemOptions[cat as Cat];
      const optStr = opts && Object.keys(opts).length > 0
        ? ` (${Object.entries(opts).map(([k, v]) => `${k}:${v}`).join(', ')})`
        : '';
      const brand = item.advertiser_nickname ? `${item.advertiser_nickname} ` : '';
      return `${cat}="${brand}${item.name}${optStr}"`;
    };
    const clothingItems = selectedEntries
      .filter(([cat]) => CLOTHING_CATS.includes(cat as Cat))
      .map(([cat, item]) => fmt(cat, item!))
      .join(', ');
    const styleItems = selectedEntries
      .filter(([cat]) => !CLOTHING_CATS.includes(cat as Cat))
      .map(([cat, item]) => fmt(cat, item!))
      .join(', ');

    // 명시되지 않은 의상 카테고리는 무엇으로 처리할지 결정 ("레깅스" 등 강한 fitted 어휘 절대 X)
    const explicitCats = new Set(selectedEntries.map(([cat]) => cat));
    const missingClothingDefaults: string[] = [];
    if (!explicitCats.has('상의')) missingClothingDefaults.push('상의=단순한 흰 반팔 티');
    if (!explicitCats.has('하의')) missingClothingDefaults.push('하의=무릎 살짝 위 길이의 회색 면반바지(루즈핏)');
    if (!explicitCats.has('신발')) missingClothingDefaults.push('신발=맨발');

    // 사용자가 하의를 선택했는지 → 별도 강력 constraint 추가
    const hasBottomSelected = explicitCats.has('하의');
    const bottomItem = selectedEntries.find(([cat]) => cat === '하의')?.[1];
    const bottomName = bottomItem ? `${bottomItem.advertiser_nickname || ''} ${bottomItem.name}`.trim() : '';

    const parts: string[] = [];
    if (isSheetMode) {
      parts.push('【1단계 — 신규 캐릭터 시트 생성】 첨부된 사용자 사진을 기반으로 새 캐릭터 시트를 처음부터 생성합니다. 시트 형태(정면 standing pose, 전신, 깨끗한 단색 배경).');
    } else {
      parts.push('【1단계 — 의상 완전 제거】 캐릭터가 현재 입고 있는 모든 의상(상의/하의/신발/모자/안경/악세서리)을 완전히 벗긴 깨끗한 빈 캔버스 상태로 리셋하세요. 특히 시트에 그려진 다리 옷(검정 레깅스/타이츠/스판/스키니/쫄바지 등 fitted한 다리 옷)을 모두 지워야 합니다. 절대 기존 옷을 그대로 두고 그 위에 새 옷을 겹쳐 그리지 마세요.');
    }

    if (clothingItems) {
      parts.push(`【2단계 — 새 의상 적용 (최우선 명령)】 아래 의상만 정확히 입히세요:\n${clothingItems}`);
      parts.push('각 아이템의 브랜드명·이름·옵션(핏·기장)에서 연상되는 색상·실루엣·소재·디테일을 충실하게 시각화하세요.');
    }

    // 하의 강력 constraint
    if (hasBottomSelected) {
      parts.push(
        `【하의 특별 지시 — 매우 중요】 사용자는 하의로 "${bottomName}"을(를) 선택했습니다. 결과 이미지는 반드시 이 의상 종류(청바지/슬랙스/팬츠/스커트/반바지 등)의 형태로 그려야 합니다.\n` +
        '  ❌ 절대 금지: 검정 레깅스, 타이츠, 스판/스키니 fitted 다리옷, 쫄바지, 스타킹\n' +
        '  ✓ 청바지를 선택했다면 → 다리 라인이 보이지 않는 일반 데님 바지(독립된 바지 실루엣, 데님 텍스처 명확)\n' +
        '  ✓ 슬랙스를 선택했다면 → 정장 슬랙스 형태(주름선, 적당한 여유)\n' +
        '  ✓ 와이드 핏 → 다리 폭이 넓고 헐렁한 실루엣\n' +
        '  ✓ 스커트를 선택했다면 → 치마 형태(다리가 부분적으로 보임)\n' +
        '  ※ 만약 결과물에 시트의 검정 레깅스/타이츠/스판이 그대로 남아있다면 명령 위반입니다.'
      );
    } else if (missingClothingDefaults.some((d) => d.startsWith('하의='))) {
      parts.push('【하의 기본형】 사용자가 하의를 선택하지 않았으므로, 회색 면반바지(루즈핏, 무릎 위) 한 가지로만 처리. 절대 레깅스/타이츠/스판으로 그리지 마세요.');
    }

    if (missingClothingDefaults.length > 0) {
      parts.push(`【3단계 — 미선택 카테고리】 사용자가 선택하지 않은 의상은 다음 단순한 기본형으로 처리:\n${missingClothingDefaults.join(', ')}`);
    }

    if (styleItems) {
      parts.push(
        isSheetMode
          ? `【4단계 — 헤어/문신】 ${styleItems}.`
          : `【4단계 — 헤어/문신】 ${styleItems}. 명시 안 된 카테고리는 현재 시트 그대로 유지.`,
      );
    } else if (!isSheetMode) {
      parts.push('【4단계 — 헤어/문신】 현재 시트 그대로 유지.');
    }

    if (isSheetMode) {
      parts.push('【필수 유지】 얼굴 인상·체형은 첨부된 사용자 사진을 따라 그리세요. standing pose 자세 유지.');
    } else {
      parts.push('【필수 유지】 캐릭터의 얼굴 인상·체형·standing pose는 반드시 유지.');
    }
    parts.push('【최종 점검】 결과물 다시 검토 — 사용자가 선택한 의상 종류가 정확히 그려졌는지, 특히 하의가 fitted 옷(레깅스/스판)이 아닌 사용자 선택 의상으로 그려졌는지 확인하세요.');
    const desc = parts.join('\n\n');

    // 적용된 아이템 영구 보관 — ArtistResult에서 시트 하단에 표시 + 외부 링크 노출
    const appliedItems: AppliedItem[] = selectedEntries.map(([cat, item]) => ({
      cat: cat as string,
      name: item!.name,
      brand: item!.advertiser_nickname,
      productUrl: item!.product_url,
      imageObjectName: item!.image_object_name,
      options: itemOptions[cat as Cat],
      appliedAt: Date.now(),
    }));
    // 9004 옷 입히기는 image_object_name이 있는 상의/하의/신발만 이미지 첨부 → 정확도 ↑.
    // 누락 항목은 텍스트(desc)로만 묘사돼서 결과가 흔들릴 수 있으니 경고.
    const missingImage = appliedItems.filter(
      (it) => ['상의', '하의', '신발'].includes(it.cat) && !it.imageObjectName,
    );
    if (missingImage.length > 0) {
      console.warn(
        '[ArtistCody] image_object_name 없는 의상 (텍스트로만 묘사됨):',
        missingImage.map((it) => `${it.cat}/${it.name}`).join(', '),
      );
    }
    useOutfitStore.getState().setItems(appliedItems);

    // 작사·작곡 패턴: 큐 등록 후 Map 복귀. 큐 0 도달 후 캐릭터 클릭하면 ArtistLoading에서 API 호출
    if (isSheetMode) {
      // 신규 시트 생성: ArtistInput에서 받은 컨셉 + 옷 desc를 합쳐 user_text로
      const conceptText = taskStore.userText || '';
      const finalText = conceptText
        ? `캐릭터 컨셉: ${conceptText}\n\n${desc}`
        : desc;
      taskStore.setInput({ userText: finalText, outfitDesc: desc });
      taskStore.startTask('sheet');
      useTimerStore.getState().startTask('artist' as any, '아티스트', 'artist');
    } else {
      taskStore.setInput({ outfitDesc: desc });
      taskStore.startTask('outfit');
      useTimerStore.getState().startTask('artist' as any, '코디', 'artist_outfit');
    }
    // web에서 Alert.alert의 onPress 콜백이 호출 안 되므로 바로 navigate
    // reset으로 Studio Stack을 Map만 남기는 상태로 초기화 → 작업실 탭 다시 눌러도 Map이 보임
    // (navigate('Map')은 ArtistCody가 stack에 남아서 작업실 재진입 시 Cody가 다시 표시되는 버그)
    navigation.reset({ index: 0, routes: [{ name: 'Map' }] });
  };

  // Tab 헤더 좌측에 ← 버튼 주입
  useLayoutEffect(() => {
    const parent = navigation.getParent();
    if (!parent) return;
    parent.setOptions({
      headerLeft: () => (
        <TouchableOpacity
          onPress={() => navigation.navigate('Map')}
          style={{ paddingHorizontal: 12, paddingVertical: 6 }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <AppText style={{ fontSize: 26, color: colors.text.primary, fontWeight: '300' }}>‹</AppText>
        </TouchableOpacity>
      ),
    });
    return () => {
      parent.setOptions({ headerLeft: undefined });
    };
  }, [navigation]);

  return (
    <View style={styles.container}>
      <AppText style={[styles.title, { paddingTop: 12 }]}>
        {isSheetMode ? '아티스트 의상 선택' : '옷 입히기'}
      </AppText>
      <AppText style={styles.subtitle}>
        {isSheetMode
          ? '옷·헤어를 골라주세요. 사진과 함께 한 번에 아티스트로 만들어요. (미선택 카테고리는 기본형 적용)'
          : '원하는 카테고리를 골라보세요. 여러 개 동시에 선택할 수 있어요.'}
      </AppText>

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
                <AppText style={styles.catIcon}>{CAT_ICONS[cat]}</AppText>
                <AppText style={styles.catName}>{cat}</AppText>
                <AppText style={styles.catSub} numberOfLines={1}>
                  {sel ? sel.name : '고르기'}
                </AppText>
                {sel?.advertiser_nickname ? (
                  <AppText style={styles.catBrand} numberOfLines={1}>
                    {sel.advertiser_nickname}
                  </AppText>
                ) : null}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* 선택된 카테고리의 옵션 칩 (핏/기장 등) */}
        {selectedEntries.some(([cat]) => CAT_OPTIONS[cat as Cat]) && (
          <View style={styles.optBox}>
            <AppText style={styles.optBoxTitle}>세부 옵션</AppText>
            {selectedEntries
              .filter(([cat]) => CAT_OPTIONS[cat as Cat])
              .map(([cat]) => {
                const groups = CAT_OPTIONS[cat as Cat]!;
                const catOpts = itemOptions[cat as Cat] || {};
                return (
                  <View key={cat} style={styles.optCatRow}>
                    <AppText style={styles.optCatLabel}>{CAT_ICONS[cat as Cat]} {cat}</AppText>
                    {groups.map((group) => (
                      <View key={group.label} style={styles.optGroupRow}>
                        <AppText style={styles.optGroupLabel}>{group.label}</AppText>
                        <View style={styles.optChipsRow}>
                          {group.values.map((v) => {
                            const sel = catOpts[group.label] === v;
                            return (
                              <TouchableOpacity
                                key={v}
                                style={[styles.optChip, sel && styles.optChipSelected]}
                                onPress={() => toggleOption(cat as Cat, group.label, v)}
                              >
                                <AppText style={[styles.optChipText, sel && styles.optChipTextSelected]}>
                                  {v}
                                </AppText>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      </View>
                    ))}
                  </View>
                );
              })}
          </View>
        )}

        {selectedEntries.length > 0 && (
          <View style={styles.summaryBox}>
            <AppText style={styles.summaryLabel}>선택한 아이템 ({selectedEntries.length})</AppText>
            <View style={styles.summaryChips}>
              {selectedEntries.map(([cat, item]) => (
                <View key={cat} style={styles.summaryChip}>
                  <AppText style={styles.summaryChipText}>
                    {CAT_ICONS[cat as Cat]} {item!.name}
                  </AppText>
                  {item!.advertiser_nickname ? (
                    <AppText style={styles.summaryChipBrand}>
                      {item!.advertiser_nickname}
                    </AppText>
                  ) : null}
                </View>
              ))}
            </View>
            <AppText style={styles.hint}>꾹 누르면 카테고리 선택 해제</AppText>
          </View>
        )}
      </ScrollView>

      <View style={[styles.bottomArea, { marginBottom: bottomLift }]}>
        <View style={styles.btnRow}>
          <TouchableOpacity
            style={styles.skipBtn}
            onPress={() => {
              if (isSheetMode) {
                // sheet 모드 취소 → 컨셉 입력 화면으로 복귀
                navigation.replace('ArtistInput');
              } else {
                navigation.replace('ArtistResult');
              }
            }}
          >
            <AppText style={styles.skipBtnText}>취소</AppText>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.applyBtn,
              !isSheetMode && selectedEntries.length === 0 && { opacity: 0.4 },
            ]}
            onPress={handleApply}
            disabled={!isSheetMode && selectedEntries.length === 0}
          >
            <AppText style={styles.applyBtnText}>
              {isSheetMode ? `이 옷으로 만들기 ⭐${characterCost}` : `이 옷으로 입히기 ⭐${characterCost}`}
            </AppText>
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
              <AppText style={styles.modalTitle}>
                {pickerCat ? `${CAT_ICONS[pickerCat]} ${pickerCat} 고르기` : ''}
              </AppText>
              <TouchableOpacity onPress={() => setPickerCat(null)}>
                <AppText style={styles.modalClose}>✕</AppText>
              </TouchableOpacity>
            </View>
            {pickerLoading ? (
              <View style={{ padding: 40, alignItems: 'center' }}>
                <ActivityIndicator size="large" color={colors.accent.primary} />
              </View>
            ) : pickerItems.length === 0 ? (
              <View style={{ padding: 40 }}>
                <AppText style={styles.emptyDesc}>
                  등록된 {pickerCat} 아이템이 없어요.
                </AppText>
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
                      <View style={styles.itemImgWrap}>
                        {url ? (
                          <Image source={{ uri: url }} style={styles.itemImg} />
                        ) : (
                          <View style={[styles.itemImg, styles.itemImgFallback]}>
                            <AppText style={{ fontSize: 28 }}>{pickerCat ? CAT_ICONS[pickerCat] : '?'}</AppText>
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
                      </View>
                      <AppText style={styles.itemName} numberOfLines={2}>{item.name}</AppText>
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
  itemImgWrap: { position: 'relative', marginBottom: 8 },
  itemImg: { width: '100%', aspectRatio: 1, borderRadius: 8 },
  itemImgFallback: {
    backgroundColor: colors.bg.surface2,
    justifyContent: 'center', alignItems: 'center',
  },
  brandBadge: {
    position: 'absolute', top: 6, left: 6,
    backgroundColor: 'rgba(0,0,0,0.78)',
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6,
    maxWidth: '85%',
  },
  brandBadgeText: {
    color: '#fff', fontSize: 10, fontWeight: '800',
    letterSpacing: 0.5,
  },
  itemName: {
    color: colors.text.primary, fontSize: 13, fontWeight: '600',
    minHeight: 34,
  },
  itemBrand: { color: colors.text.muted, fontSize: 11, marginTop: 2 },

  catBrand: {
    color: colors.accent.primary, fontSize: 10, fontWeight: '700',
    marginTop: 2, letterSpacing: 0.3,
  },
  summaryChipBrand: {
    color: colors.accent.primary, fontSize: 10, fontWeight: '700',
    marginTop: 2, letterSpacing: 0.3,
  },

  // 핏/기장 옵션 영역
  optBox: {
    marginTop: 16, padding: 12, borderRadius: 12,
    backgroundColor: colors.bg.surface1,
    borderWidth: 1, borderColor: colors.border.subtle,
  },
  optBoxTitle: {
    color: colors.text.secondary, fontSize: 12, fontWeight: '700',
    marginBottom: 10, letterSpacing: 0.3,
  },
  optCatRow: { marginBottom: 10 },
  optCatLabel: {
    color: colors.text.primary, fontSize: 13, fontWeight: '700',
    marginBottom: 6,
  },
  optGroupRow: { marginBottom: 6 },
  optGroupLabel: {
    color: colors.text.muted, fontSize: 11, fontWeight: '600',
    marginBottom: 4,
  },
  optChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  optChip: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12,
    backgroundColor: colors.bg.surface2,
    borderWidth: 1, borderColor: colors.border.subtle,
  },
  optChipSelected: {
    backgroundColor: colors.accent.primary, borderColor: colors.accent.primary,
  },
  optChipText: { color: colors.text.secondary, fontSize: 11, fontWeight: '600' },
  optChipTextSelected: { color: colors.text.primary, fontWeight: '800' },
});
