import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Image,
  Modal,
  FlatList,
  ActivityIndicator,
  ScrollView,
  Linking,
  TextInput,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { AppText } from '../components/ui';
import { showAlert } from '../utils/appAlert';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import api, { BACKEND_BASE_URL } from '../services/api';
import { useCharacterTaskStore } from '../stores/characterTaskStore';
import { usePlayerStore } from '../stores/playerStore';
import { useOutfitStore, type AppliedItem } from '../stores/outfitStore';
import { usePointsStore } from '../stores/pointsStore';
import { useWishlistStore, type WishItem } from '../stores/wishlistStore';
import { useAuthStore } from '../stores/authStore';
import { getFatigueStatus } from '../services/fatigueService';
import { showFatigueCooldownDialog } from '../utils/fatigueGate';
import { colors } from '../theme/colors';

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

interface AdItem {
  id: string;
  name: string;
  image_object_name?: string;
  product_url?: string;
  advertiser_nickname?: string;
  // v3.90(MAIDOL v147/v148): 5단계 드릴다운용 패싯 필드 — ad_items 원본 그대로 내려옴
  brand?: string;
  gender?: string;        // '남성용' | '여성용' | '공용'
  product_name?: string;
  color?: string;
  category?: string;
  is_active?: boolean;
}

// v3.90: 5단계 드릴다운 — 플랫폼 › 브랜드 › 성별 › 제품 › 색상(leaf). MAIDOL ItemSelectModal 이식.
type DrillLevel = 'platform' | 'brand' | 'gender' | 'product';
type DrillState = Record<DrillLevel, string | null>;
const EMPTY_DRILL: DrillState = { platform: null, brand: null, gender: null, product: null };

const platformOf = (i: AdItem) => i.advertiser_nickname || '기타';
const brandOf = (i: AdItem) => i.brand || i.advertiser_nickname || '기타';
const productOf = (i: AdItem) => i.product_name || i.name || '기타';
// 성별 멤버십: 공용(및 미지정)은 남/여 모두에 포함
const genderMatches = (i: AdItem, g: string) => {
  const ig = i.gender || '공용';
  if (ig === '공용') return true;
  if (g === '남') return ig === '남성용';
  if (g === '여') return ig === '여성용';
  return false;
};
const genderLabel = (g: string) => (g === '남' ? '남성' : '여성');

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
  // v3.105: 작업실 화면은 미니플레이어 숨김 + 백그라운드 재생 유지(대표 방침) —
  // bottomLift(하단 공백) 제거, ArtistResult 관행(setMiniHidden)으로 통일. blur 시 복원.
  useFocusEffect(
    useCallback(() => {
      usePlayerStore.getState().setMiniHidden(true);
      if (__DEV__) console.info('[ArtistCody] 미니플레이어 숨김(focus)');
      return () => {
        usePlayerStore.getState().setMiniHidden(false);
      };
    }, [])
  );
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
  // v3.116: 상세설정 자유 디렉팅 — 칩(핏/기장)으로 못 담는 지시("셔츠는 넣어입지 말기",
  // "왼쪽만 넣어입기" 등)를 자유 텍스트로 받아 프롬프트에 합성. 서버 계약 변화 없음.
  const FREE_DIRECTING_MAX = 200;
  const [freeDirecting, setFreeDirecting] = useState('');

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
  // v3.90: 전체 | 위시리스트 탭 + 5단계 드릴다운 상태
  const [pickerTab, setPickerTab] = useState<'all' | 'wish'>('all');
  const [drill, setDrill] = useState<DrillState>(EMPTY_DRILL);

  const isLoggedIn = useAuthStore((s) => !!s.token);
  const wished = useWishlistStore((s) => s.wished);
  const wishBusy = useWishlistStore((s) => s.busy);
  const wishItemsAll = useWishlistStore((s) => s.items);
  const wishListLoaded = useWishlistStore((s) => s.listLoaded);
  const wishListLoading = useWishlistStore((s) => s.listLoading);
  const wishListError = useWishlistStore((s) => s.listError);

  const openPicker = async (cat: Cat) => {
    setPickerCat(cat);
    setPickerTab('all');
    setDrill(EMPTY_DRILL);
    setPickerLoading(true);
    try {
      const res = await api.get('/business/ads/active', { params: { category: cat } });
      const items: AdItem[] = res.data?.items || [];
      setPickerItems(items.length > 0 ? items : SAMPLE_ITEMS[cat]);
      // 실아이템 위시 여부 일괄 조회 (샘플/미로그인은 store가 알아서 스킵)
      if (isLoggedIn && items.length > 0) {
        useWishlistStore.getState().sync(items.map((i) => i.id));
      }
    } catch {
      setPickerItems(SAMPLE_ITEMS[cat]);
    } finally {
      setPickerLoading(false);
    }
  };

  // 위시리스트 탭 최초 진입 시 lazy 로드 (미로그인은 스킵 — 렌더에서 안내)
  useEffect(() => {
    if (pickerCat !== null && pickerTab === 'wish' && isLoggedIn) {
      useWishlistStore.getState().fetchList();
    }
  }, [pickerCat, pickerTab, isLoggedIn]);

  const handleWishToggle = (item: { id: string }) => {
    if (!isLoggedIn) {
      showAlert('알림', '로그인 후 이용할 수 있습니다.');
      return;
    }
    if (__DEV__) console.info('[ArtistCody] wish toggle', { id: item.id });
    useWishlistStore.getState().toggle(item.id);
  };

  // v3.109: 각 옷(광고 아이템)의 판매처 링크 노출(대표 피드백) —
  // PlayerScreen 광고 링크 관행(:470대)과 동일: click 로깅 + http 보정 + openURL 실패 시 앱 내 알림.
  // product_url 없는 아이템(샘플 더미 포함)은 버튼 미노출.
  const openItemLink = (item: { id: string; product_url?: string }) => {
    if (!item.product_url) return;
    if (!item.id.startsWith('sample_')) {
      api.post(`/business/ads/${item.id}/click`).catch(() => {});
    }
    const url = item.product_url.startsWith('http') ? item.product_url : `https://${item.product_url}`;
    if (__DEV__) console.info('[ArtistCody] 판매처 링크 열기', { id: item.id, url });
    Linking.openURL(url).catch(() => showAlert('알림', '링크를 열 수 없어요'));
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

  const handleApply = async () => {
    // sheet 모드: 시트 없어도 진행 (옷+사진으로 처음부터 만듦). 옷 미선택은 디폴트 fallback.
    if (!isSheetMode && !apiResult) {
      showAlert('오류', '먼저 캐릭터 시트가 필요해요.');
      return;
    }
    if (!isSheetMode && selectedEntries.length === 0) {
      showAlert('알림', '입혀줄 아이템을 하나 이상 골라주세요.');
      return;
    }
    // v3.118: 아티스트 디렉터 휴식(쿨다운) 게이트 — 적용(생성 요청) 전 사전 확인.
    // 서버는 generate-sheet* 4종을 슬롯/⭐ 차감 전 429로 게이트(무과금) — character.py v220.
    try {
      const fatigueStatus = await getFatigueStatus('artist');
      const remain = Math.max(0, Math.floor(fatigueStatus?.cooldown_remaining_sec ?? 0));
      if (remain > 0) {
        console.log('[ArtistCody] [fatigue:artist] 게이트 — 남은', remain, '초');
        showFatigueCooldownDialog({
          status: fatigueStatus,
          remainingSec: remain,
          director: 'artist',
          onCleared: () => handleApply(), // 해제 후 같은 선택으로 재시도
        });
        return;
      }
    } catch (err: any) {
      // 조회 실패는 게이트 오픈 — 서버 429가 최종 방어 (ArtistLoading에서 동일 다이얼로그)
      console.warn('[ArtistCody] [fatigue:artist] 상태 조회 실패:', err?.response?.status, err?.message);
    }
    // v3.76: 잔액 사전 체크 — 대기열 소진 후 402로 실패하는 낭패 방지
    const bal = usePointsStore.getState().balance;
    if (bal != null && bal < characterCost) {
      if (__DEV__) console.info('[ArtistCody] 별 부족 사전 차단', { bal, cost: characterCost });
      showAlert('별이 부족해요', `캐릭터 시트 생성에는 ⭐${characterCost}개가 필요해요.\n현재 보유: ⭐${bal}`);
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

    // v3.80: 가상화(그림) 모드 — "사진 기반" 지시문 대신 컨셉 기반 문구.
    // 화풍 지시는 서버가 style_preset/style_image로 처리하므로 프롬프트에 넣지 않음(중복 주입 금지).
    const isVirtualKind = isSheetMode && taskStore.characterKind === 'virtual';
    // v3.122: 가상(캐릭터) 아티스트 꾸미기 — outfit 모드에서 cartoon 경로(v223 use_saved_sheet).
    // 기준 이미지는 서버가 저장된 시트에서 로드하므로 프롬프트에는 화풍 유지 지시만 보강.
    const isVirtualOutfit = !isSheetMode && taskStore.characterKind === 'virtual';
    const parts: string[] = [];
    if (isSheetMode) {
      if (isVirtualKind) {
        parts.push('【1단계 — 신규 캐릭터 시트 생성】 설명된 컨셉을 바탕으로 새 캐릭터 시트를 처음부터 생성합니다. (사진이 첨부된 경우 인물의 인상만 참고). 시트 형태(정면 standing pose, 전신, 깨끗한 단색 배경).');
      } else {
        parts.push('【1단계 — 신규 캐릭터 시트 생성】 첨부된 사용자 사진을 기반으로 새 캐릭터 시트를 처음부터 생성합니다. 시트 형태(정면 standing pose, 전신, 깨끗한 단색 배경).');
      }
    } else {
      parts.push('【1단계 — 의상 완전 제거】 캐릭터가 현재 입고 있는 모든 의상(상의/하의/신발/모자/안경/악세서리)을 완전히 벗긴 깨끗한 빈 캔버스 상태로 리셋하세요. 특히 시트에 그려진 다리 옷(검정 레깅스/타이츠/스판/스키니/쫄바지 등 fitted한 다리 옷)을 모두 지워야 합니다. 절대 기존 옷을 그대로 두고 그 위에 새 옷을 겹쳐 그리지 마세요.');
    }

    if (clothingItems) {
      parts.push(`【2단계 — 새 의상 적용 (최우선 명령)】 아래 의상만 정확히 입히세요:\n${clothingItems}`);
      // v3.124: 참조 이미지가 첨부되는 아이템은 제품 사진 그대로 재현하도록 명시 —
      // 기존 "이름에서 연상해 시각화" 문구가 이미지 있는 아이템의 디자인 변형을 유도(대표 지적).
      const hasRefImage = selectedEntries.some(
        ([cat, it]) => ['상의', '하의', '신발'].includes(cat) && it?.image_object_name,
      );
      if (hasRefImage) {
        parts.push(
          '참조 이미지가 첨부된 아이템(상의/하의/신발)은 첨부된 제품 사진과 동일하게(색상·패턴·로고 위치·실루엣·기장·디테일) 그대로 재현하세요. 사진에 없는 디테일을 상상해서 추가하거나 바꾸지 마세요. 참조 이미지가 없는 아이템만 브랜드명·이름·옵션에서 연상되는 색상·실루엣·소재·디테일로 시각화하세요.'
        );
        // v3.125: 로고·프린팅 정밀 복제 — "로고가 조금씩 다르다" 대표 피드백 반영
        parts.push(
          '【로고·프린팅 — 매우 중요】 제품 사진에 로고나 프린팅이 있으면 그대로 복제하세요. 텍스트 로고는 정확한 철자·대소문자·서체 느낌으로, 그래픽 도안은 동일한 형태·크기·부착 위치로 재현하세요. 임의의 다른 문자나 도안으로 바꾸지 말고, 사진에 없는 로고를 새로 만들어 넣지도 마세요.'
        );
      } else {
        parts.push('각 아이템의 브랜드명·이름·옵션(핏·기장)에서 연상되는 색상·실루엣·소재·디테일을 충실하게 시각화하세요.');
      }
    }

    // 하의 강력 constraint
    // v3.126: 참조 이미지가 있는 하의는 "일반 ○○ 형태" 같은 제네릭 유도 문구가
    // 프린트·디테일 변형을 부추김(대표 실측: 한쪽 다리 나선 1개 → 양다리 반복 패턴) —
    // 참조 사진 그대로 재현(종류·프린트 개수·배치 포함)으로 교체. 이미지 없으면 기존 유지.
    const bottomHasRef = !!(bottomItem as any)?.image_object_name;
    if (hasBottomSelected && bottomHasRef) {
      parts.push(
        `【하의 특별 지시 — 매우 중요】 사용자는 하의로 "${bottomName}"을(를) 선택했고 [하의 참조] 제품 사진이 첨부되어 있습니다. 하의는 반드시 이 참조 사진의 실제 제품 그대로 그려야 합니다:\n` +
        '  ✓ 종류(반바지/팬츠/스커트 등)·색상·핏·기장·허리 형태(고무줄/벨트)를 참조 사진과 동일하게\n' +
        '  ✓ 프린트·도안이 있다면 형태는 물론 개수와 배치까지 동일하게 — 참조에서 한쪽 다리 한 곳에만 있는 도안이면 결과에서도 정확히 그 위치에 그 개수만. 단일 도안을 양쪽 다리나 여러 곳으로 복사·반복 패턴화하는 것 절대 금지\n' +
        '  ❌ 절대 금지: 검정 레깅스, 타이츠, 스판/스키니 fitted 다리옷, 쫄바지, 스타킹, "일반적인" 제네릭 바지로 대체'
      );
    } else if (hasBottomSelected) {
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

    // v3.116: 자유 디렉팅 합성 — 미입력 시 기존 프롬프트와 완전 동일(추가 블록 없음).
    const directing = freeDirecting.trim().slice(0, FREE_DIRECTING_MAX);
    if (directing) {
      parts.push(
        `【착장 디렉팅 — 사용자 자유 지시】 ${directing}\n` +
        '(위 의상 지시와 함께 반드시 반영하세요. 선택된 아이템 자체를 바꾸라는 지시가 아닌 한 아이템 종류는 유지합니다.)'
      );
    }

    if (isSheetMode) {
      if (isVirtualKind) {
        parts.push('【필수 유지】 설명된 컨셉의 얼굴 인상·체형을 일관되게 유지하세요. standing pose 자세 유지.');
      } else {
        parts.push('【필수 유지】 얼굴 인상·체형은 첨부된 사용자 사진을 따라 그리세요. standing pose 자세 유지.');
      }
    } else {
      parts.push('【필수 유지】 캐릭터의 얼굴 인상·체형·standing pose는 반드시 유지.');
    }
    // v3.122: 가상 꾸미기 — 화풍 붕괴 금지(실사화 금지). 서버도 doc.art_style로 화풍을
    // 복원하지만, 프롬프트 차원에서도 이중 안전망을 둔다.
    if (isVirtualOutfit) {
      parts.push(
        '【화풍 유지 — 매우 중요】 이 캐릭터는 그림(만화) 화풍의 가상 아티스트입니다. ' +
        '현재 시트의 그림체·화풍·채색 스타일을 그대로 유지하고, 절대 실사(사진) 스타일로 변환하지 마세요. ' +
        '선택된 의류 아이템 이미지는 현실 제품 사진이지만 동일 화풍으로 변환해 입히세요.'
      );
    }
    parts.push('【최종 점검】 결과물 다시 검토 — 사용자가 선택한 의상 종류가 정확히 그려졌는지, 특히 하의가 fitted 옷(레깅스/스판)이 아닌 사용자 선택 의상으로 그려졌는지, 그리고 각 아이템의 프린트·로고가 참조 사진과 동일한 개수·위치인지(단일 도안이 반복 패턴으로 늘어나지 않았는지) 확인하세요.');
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

    // v3.107: 대기열 타이머 폐지 — 요청 즉시 ArtistLoading으로 직행해 API 호출·결과 표시
    if (isSheetMode) {
      // 신규 시트 생성: ArtistInput에서 받은 컨셉 + 옷 desc를 합쳐 user_text로
      // v3.105: 실패 후 재시도 시 userText에 이전 의상 desc가 섞여 있을 수 있어 순수 컨셉 우선
      const conceptText = taskStore.conceptText || taskStore.userText || '';
      const finalText = conceptText
        ? `캐릭터 컨셉: ${conceptText}\n\n${desc}`
        : desc;
      taskStore.setInput({ userText: finalText, outfitDesc: desc });
      taskStore.startTask('sheet');
    } else {
      taskStore.setInput({ outfitDesc: desc });
      taskStore.startTask('outfit');
    }
    // reset으로 스택을 [Map, ArtistLoading]으로 재구성 — ArtistLoading이 실패 시 goBack하면
    // Map에 착지하고(v3.105 실패 다이얼로그·입력 보존 흐름 유지), 성공 시 replace('ArtistResult').
    // (navigate('Map')만 남기면 ArtistCody가 stack에 남아 작업실 재진입 시 Cody가 다시 표시되는 버그)
    console.log('[ArtistCody] 적용 — ArtistLoading 직행 (대기열 없음)', {
      mode: isSheetMode ? 'sheet' : 'outfit',
      virtual: isVirtualKind || isVirtualOutfit,
    });
    navigation.reset({ index: 1, routes: [{ name: 'Map' }, { name: 'ArtistLoading' }] });
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

  // ── v3.90 5단계 드릴다운 파생값 (MAIDOL ItemSelectModal 이식) ──
  const byPlatform = drill.platform ? pickerItems.filter((i) => platformOf(i) === drill.platform) : pickerItems;
  const byBrand = drill.brand ? byPlatform.filter((i) => brandOf(i) === drill.brand) : byPlatform;
  const drillGender = drill.gender;
  const byGender = drillGender ? byBrand.filter((i) => genderMatches(i, drillGender)) : byBrand;
  const byProductRaw = drill.product ? byGender.filter((i) => productOf(i) === drill.product) : byGender;
  // v3.123(대표): 기선택 아이템이 있으면 목록 맨 앞에 노출 — 재선택/변경 시 바로 보이게
  const pickedId = pickerCat ? selected[pickerCat]?.id : undefined;
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
    currentLevel === 'platform' ? [...new Set(pickerItems.map(platformOf))]
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

  // 위시리스트 탭: 현재 카테고리의 내 찜 목록 (store엔 전 카테고리 보관)
  const wishItemsForCatRaw: WishItem[] = pickerCat
    ? wishItemsAll.filter((it) => it.category === pickerCat)
    : [];
  // v3.123: 위시 탭도 기선택 우선 정렬
  const wishItemsForCat = pickedId
    ? [...wishItemsForCatRaw].sort((a, b) => (a.id === pickedId ? -1 : b.id === pickedId ? 1 : 0))
    : wishItemsForCatRaw;

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
                    <AppText style={styles.optCatLabel}>{cat}</AppText>
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

        {/* v3.116: 상세설정 자유 디렉팅 — 핏/기장 칩으로 못 담는 착장 지시 자유 입력.
            미입력 시 프롬프트 불변, 최대 200자. 서버 계약 변화 없음(문자열 합성). */}
        <View style={styles.optBox}>
          <AppText style={styles.optBoxTitle}>착장 디렉팅 (선택)</AppText>
          <TextInput
            style={styles.directingInput}
            value={freeDirecting}
            onChangeText={setFreeDirecting}
            placeholder="착장 디렉팅을 자유롭게 적어주세요 — 예: 셔츠는 넣어입지 말기"
            placeholderTextColor={colors.text.muted}
            multiline
            maxLength={FREE_DIRECTING_MAX}
          />
          <AppText style={styles.directingCount}>
            {freeDirecting.length}/{FREE_DIRECTING_MAX}
          </AppText>
        </View>

        {selectedEntries.length > 0 && (
          <View style={styles.summaryBox}>
            <AppText style={styles.summaryLabel}>선택한 아이템 ({selectedEntries.length})</AppText>
            <View style={styles.summaryChips}>
              {selectedEntries.map(([cat, item]) => (
                <View key={cat} style={styles.summaryChip}>
                  <AppText style={styles.summaryChipText}>
                    {item!.name}
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

      <View style={styles.bottomArea}>
        <View style={styles.btnRow}>
          <TouchableOpacity
            style={styles.skipBtn}
            onPress={() => {
              if (isSheetMode) {
                // sheet 모드 취소 → 컨셉 입력 화면으로 복귀
                // v3.105: restore — store에 보존된 컨셉/사진/화풍·재생성 대상(cid)을 버리지 않고
                // "이어서 만들기"로 재개 가능 (취소해도 입력 데이터 보존 — 대표 지적)
                navigation.replace('ArtistInput', { restore: true });
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
                {pickerCat ? `${pickerCat} 고르기` : ''}
              </AppText>
              <TouchableOpacity onPress={() => setPickerCat(null)}>
                <AppText style={styles.modalClose}>✕</AppText>
              </TouchableOpacity>
            </View>
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

            {pickerTab === 'all' && (pickerLoading ? (
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
                            <Feather
                              name="heart"
                              size={16}
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
            ))}

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
                          {/* 하트 = 위시 해제 */}
                          <TouchableOpacity
                            style={styles.wishBtn}
                            onPress={() => handleWishToggle(item)}
                            disabled={!!wishBusy[item.id]}
                            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                          >
                            <Feather name="heart" size={16} color={colors.accent.primary} />
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
  itemCardInactive: { opacity: 0.45 },
  // v3.124: 기선택 아이템 강조 — 액센트 테두리 + 살짝 밝은 배경
  itemCardPicked: {
    borderWidth: 2, borderColor: colors.accent.primary,
    backgroundColor: colors.bg.surface2,
  },
  pickedBadge: {
    position: 'absolute', bottom: 6, right: 6,
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: colors.accent.primary,
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6,
  },
  pickedBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  // v3.109: 판매처 링크 버튼 (아이템 카드 하단)
  itemLinkBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    alignSelf: 'flex-start', marginTop: 6,
    paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8,
    backgroundColor: colors.bg.surface2,
    borderWidth: 1, borderColor: colors.border.subtle,
  },
  itemLinkText: { color: colors.accent.primary, fontSize: 11, fontWeight: '700' },

  // v3.90: 전체 | 위시리스트 탭
  pickerTabs: {
    flexDirection: 'row',
    borderBottomWidth: 1, borderBottomColor: colors.bg.surface1,
  },
  pickerTab: {
    flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    paddingVertical: 11,
    borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  pickerTabActive: { borderBottomColor: colors.accent.primary },
  pickerTabText: { color: colors.text.muted, fontSize: 13, fontWeight: '600' },
  pickerTabTextActive: { color: colors.text.primary, fontWeight: '700' },

  // v3.90: 드릴다운 브레드크럼
  crumbRow: {
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center',
    paddingHorizontal: 4, paddingBottom: 8, gap: 4,
  },
  crumbItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  crumbText: { color: colors.accent.primary, fontSize: 12, fontWeight: '700' },
  crumbTextMuted: { color: colors.text.muted, fontWeight: '600' },
  crumbSep: { color: colors.text.muted, fontSize: 12 },
  drillBackBtn: {
    flexDirection: 'row', alignItems: 'center', marginLeft: 'auto',
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8,
    backgroundColor: colors.bg.surface2,
  },
  drillBackText: { color: colors.text.secondary, fontSize: 11, fontWeight: '600' },

  // v3.90: 패싯 타일 (플랫폼/브랜드/성별/제품)
  facetBox: {
    marginBottom: 10, padding: 10, borderRadius: 12,
    backgroundColor: colors.bg.surface1,
    borderWidth: 1, borderColor: colors.border.subtle,
  },
  facetLabel: {
    color: colors.text.secondary, fontSize: 11, fontWeight: '700',
    marginBottom: 8, letterSpacing: 0.3,
  },
  facetTiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  facetTile: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10,
    backgroundColor: colors.bg.surface2,
    borderWidth: 1, borderColor: colors.border.subtle,
    maxWidth: '100%',
  },
  facetTileText: { color: colors.text.primary, fontSize: 12, fontWeight: '600' },

  // v3.90: 위시 하트 버튼 (이미지 우상단)
  wishBtn: {
    position: 'absolute', top: 6, right: 6,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center', alignItems: 'center',
  },
  inactiveBadge: {
    position: 'absolute', bottom: 6, left: 6,
    backgroundColor: 'rgba(0,0,0,0.78)',
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6,
  },
  inactiveBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },

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
  // v3.116: 착장 자유 디렉팅 입력
  directingInput: {
    minHeight: 64, padding: 10, borderRadius: 10,
    backgroundColor: colors.bg.surface2,
    borderWidth: 1, borderColor: colors.border.subtle,
    color: colors.text.primary, fontSize: 13,
    textAlignVertical: 'top',
  },
  directingCount: {
    color: colors.text.muted, fontSize: 11, textAlign: 'right', marginTop: 4,
  },
});
