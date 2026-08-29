import { create } from 'zustand';
import api from '../services/api';

// [wishlistStore] 광고상품 위시리스트 — 백엔드 연동(MAIDOL 계약과 동일).
//   POST /wishlist/{item_id}/toggle          → { wishlisted: boolean }
//   GET  /wishlist/check?item_ids=a,b,c      → { wishlisted_ids: string[] }
//   GET  /wishlist/                          → { items: WishItem[] }
// likesStore 패턴(낙관적 토글·실패 롤백·busy 가드)을 따른다.
// 주의: 서버는 add/remove가 아닌 "토글"이므로 응답의 wishlisted로 최종 상태를 보정한다.

export interface WishItem {
  id: string;
  name: string;
  image_object_name?: string;
  product_url?: string;
  category?: string;
  advertiser_nickname?: string;
  is_active?: boolean;
  wishlisted_at?: string;
}

interface WishlistState {
  wished: Record<string, boolean>;   // itemId → 위시 여부
  busy: Record<string, boolean>;     // 토글 진행 중(중복 클릭 방지)
  items: WishItem[];                 // 내 위시리스트 목록(전 카테고리)
  listLoaded: boolean;               // 목록 최초 로드 완료 여부
  listLoading: boolean;
  listError: boolean;
  isWished: (itemId: string) => boolean;
  sync: (itemIds: string[]) => Promise<void>;       // 보이는 아이템 위시 여부 일괄 조회
  toggle: (itemId: string) => Promise<boolean>;     // 낙관적 토글 → 실패 시 롤백. 반환=최종 상태
  fetchList: (force?: boolean) => Promise<void>;    // 위시리스트 목록 로드(카테고리 필터는 클라이언트에서)
}

export const useWishlistStore = create<WishlistState>((set, get) => ({
  wished: {},
  busy: {},
  items: [],
  listLoaded: false,
  listLoading: false,
  listError: false,

  isWished: (itemId) => !!get().wished[itemId],

  sync: async (itemIds) => {
    // 샘플 더미(sample_*)는 서버에 존재하지 않으므로 조회 대상에서 제외
    const ids = itemIds.filter((id) => id && !id.startsWith('sample_'));
    if (!ids.length) return;
    if (__DEV__) console.info('[wishlistStore] sync', { count: ids.length });
    try {
      const { data } = await api.get('/wishlist/check', { params: { item_ids: ids.join(',') } });
      const wishedIds: string[] = data?.wishlisted_ids || [];
      set((s) => {
        const next = { ...s.wished };
        ids.forEach((id) => { next[id] = false; });   // 조회 대상은 기본 false
        wishedIds.forEach((id) => { next[id] = true; });
        return { wished: next };
      });
    } catch (err: any) {
      // 미로그인(401) 등은 조용히 — 하트 비활성 상태 유지
      if (err?.response?.status !== 401) {
        console.error('[wishlistStore] sync 실패', { status: err?.response?.status });
      }
    }
  },

  toggle: async (itemId) => {
    if (!itemId || get().busy[itemId]) return get().isWished(itemId);
    const prev = get().isWished(itemId);
    const next = !prev;
    // 낙관적 반영
    set((s) => ({ wished: { ...s.wished, [itemId]: next }, busy: { ...s.busy, [itemId]: true } }));
    if (__DEV__) console.info('[wishlistStore] toggle', { itemId, next });
    try {
      const { data } = await api.post(`/wishlist/${itemId}/toggle`);
      const serverState = typeof data?.wishlisted === 'boolean' ? data.wishlisted : next;
      if (serverState !== next) {
        console.warn('[wishlistStore] 서버 상태 불일치 → 서버값 채택', { itemId, next, serverState });
      }
      set((s) => ({
        wished: { ...s.wished, [itemId]: serverState },
        // 해제됐으면 목록에서도 제거, 추가됐으면 다음 fetchList에서 반영되도록 listLoaded 리셋
        items: serverState ? s.items : s.items.filter((it) => it.id !== itemId),
        listLoaded: serverState ? false : s.listLoaded,
      }));
      return serverState;
    } catch (err: any) {
      console.error('[wishlistStore] toggle 실패 → 롤백', { itemId, status: err?.response?.status });
      set((s) => ({ wished: { ...s.wished, [itemId]: prev } }));
      return prev;
    } finally {
      set((s) => ({ busy: { ...s.busy, [itemId]: false } }));
    }
  },

  fetchList: async (force = false) => {
    const { listLoaded, listLoading } = get();
    if (listLoading || (listLoaded && !force)) return;
    set({ listLoading: true, listError: false });
    if (__DEV__) console.info('[wishlistStore] fetchList start');
    try {
      // 서버 category 필터는 상의/하의/신발/장소만 허용 → 전체 조회 후 클라이언트에서 필터
      const { data } = await api.get('/wishlist/');
      const items: WishItem[] = data?.items || [];
      set((s) => {
        const wished = { ...s.wished };
        items.forEach((it) => { wished[it.id] = true; });
        return { items, wished, listLoaded: true, listLoading: false };
      });
      if (__DEV__) console.info('[wishlistStore] fetchList done', { count: items.length });
    } catch (err: any) {
      console.error('[wishlistStore] fetchList 실패', { status: err?.response?.status });
      set({ listError: true, listLoaded: true, listLoading: false });
    }
  },
}));
