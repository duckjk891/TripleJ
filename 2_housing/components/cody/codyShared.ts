// v3.227(D 추출 1단계): ArtistCodyScreen 피커 공용 타입·상수·헬퍼·스타일 — 동작 무변경 이동.
// 원본: screens/ArtistCodyScreen.tsx (v3.226) — 타입/헬퍼 :33-39·:75-119·:121-166, 스타일 :1369-1525를 그대로 옮김.
import { StyleSheet } from 'react-native';
import { BACKEND_BASE_URL } from '../../services/api';
import { colors } from '../../theme/colors';

// v3.206: 카테고리 개편 — 활성 선택 슬롯은 상의/하의/신발/모자/가방.
// 그리드에는 모자·가방을 '악세서리' 통합 카드 1장으로 노출(내부 슬롯은 분리 → 동시 선택 가능).
// 나머지(헤어스타일/헤어컬러/안경/문신)는 잠금 카드(Feather lock)로만 노출 — 선택 불가, Cat에서 제외.
export type Cat = '상의' | '하의' | '신발' | '모자' | '가방';
export const ACCESSORY_SUBCATS: Cat[] = ['모자', '가방'];

export interface AdItem {
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
export type DrillLevel = 'platform' | 'brand' | 'gender' | 'product';
export type DrillState = Record<DrillLevel, string | null>;
export const EMPTY_DRILL: DrillState = { platform: null, brand: null, gender: null, product: null };

export const platformOf = (i: AdItem) => i.advertiser_nickname || '기타';
export const brandOf = (i: AdItem) => i.brand || i.advertiser_nickname || '기타';
export const productOf = (i: AdItem) => i.product_name || i.name || '기타';
// 성별 멤버십: 공용(및 미지정)은 남/여 모두에 포함
export const genderMatches = (i: AdItem, g: string) => {
  const ig = i.gender || '공용';
  if (ig === '공용') return true;
  if (g === '남') return ig === '남성용';
  if (g === '여') return ig === '여성용';
  return false;
};
export const genderLabel = (g: string) => (g === '남' ? '남성' : '여성');

// v3.205(⑤): 성별 데이터가 실재하는 카테고리만 자동 필터(상의 남69/여87/공용1, 하의 남74/여71,
// 신발 남65/여88 — 프로덕션 /business/ads/active 실측). 나머지는 무필터(전량 사라지는 사고 방지).
export const GENDER_FILTER_CATS: Cat[] = ['상의', '하의', '신발'];

// 광고 0개일 때 노출할 더미 샘플 (UX 데모용) — 카테고리당 5개
// advertiser_nickname은 가상 브랜드명 (실제 광고주가 등록되면 그 브랜드명으로 자동 교체)
export const SAMPLE_ITEMS: Record<Cat, AdItem[]> = {
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
  // v3.206: 기존 장신구(귀걸이·목걸이·팔찌) 샘플 제거 — 악세서리 피커는 모자/가방 서브탭이므로
  // 서브카테고리별 5종 샘플(실데이터 0건 폴백)로 교체. 가상 브랜드 관행 유지.
  모자: [
    { id: 'sample_hat_1', name: '클래식 볼캡', advertiser_nickname: 'STRIDE' },
    { id: 'sample_hat_2', name: '코듀로이 버킷햇', advertiser_nickname: 'AURA' },
    { id: 'sample_hat_3', name: '와치 비니', advertiser_nickname: 'NOIR' },
    { id: 'sample_hat_4', name: '울 베레모', advertiser_nickname: 'MOON CLUB' },
    { id: 'sample_hat_5', name: '로고 스냅백', advertiser_nickname: 'STARLIGHT' },
  ],
  가방: [
    { id: 'sample_bag_1', name: '미니 크로스백', advertiser_nickname: 'CHARM' },
    { id: 'sample_bag_2', name: '캔버스 토트백', advertiser_nickname: 'AURA' },
    { id: 'sample_bag_3', name: '데일리 백팩', advertiser_nickname: 'STRIDE' },
    { id: 'sample_bag_4', name: '퀼팅 숄더백', advertiser_nickname: 'GLEAM' },
    { id: 'sample_bag_5', name: '가죽 클러치', advertiser_nickname: 'NOIR' },
  ],
};

export function adImageUrl(objectName?: string): string | null {
  if (!objectName) return null;
  return `${BACKEND_BASE_URL}/api/business/items/image/${objectName}`;
}

// 피커 모달·필터 바·브랜드 그리드 공용 스타일 (원본 styles 중 모달/피커 전용 항목 그대로)
export const pickerStyles = StyleSheet.create({
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
  // v3.180(대표): 투명 png 제품컷 흰 배경 — 어두운 테마에서 옷이 잘 보이게 (플레이어 착장과 통일)
  itemImg: { width: '100%', aspectRatio: 1, borderRadius: 8, backgroundColor: '#fff' },
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

  // v3.206: 악세서리 하위 구분 세그먼트 [모자 | 가방]
  subcatRow: {
    flexDirection: 'row', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: colors.bg.surface1,
  },
  subcatSeg: {
    flex: 1, alignItems: 'center',
    paddingVertical: 8, borderRadius: 10,
    backgroundColor: colors.bg.surface1,
    borderWidth: 1, borderColor: colors.border.subtle,
  },
  subcatSegActive: {
    backgroundColor: colors.bg.surface2,
    borderColor: colors.accent.primary,
  },
  subcatSegText: { color: colors.text.secondary, fontSize: 12, fontWeight: '600' },
  subcatSegTextActive: { color: colors.text.primary, fontWeight: '800' },

  // v3.205(⑤): 성별 필터 토글 칩 (탭 행 우측)
  genderChip: {
    alignSelf: 'center', marginRight: 10,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12,
    backgroundColor: colors.bg.surface2,
    borderWidth: 1, borderColor: colors.border.subtle,
  },
  genderChipActive: { borderColor: colors.accent.primary },
  genderChipText: { color: colors.text.secondary, fontSize: 11, fontWeight: '700' },
  genderChipTextActive: { color: colors.accent.primary },

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
});
