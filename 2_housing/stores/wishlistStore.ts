import { create } from 'zustand';
import api from '../services/api';
import { useAuthStore } from './authStore';

// [wishlistStore] 광고상품 위시리스트 — 백엔드 연동(MAIDOL 계약과 동일).
//   POST /wishlist/{item_id}/toggle          → { wishlisted: boolean }
//   GET  /wishlist/                          → { items: WishItem[] }
//   (v3.227 C: /wishlist/check는 더 이상 호출하지 않음 — sync도 목록 기반. 서버 라우트는 구버전 앱 호환용 유지)
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
  // 낙관적 토글 → 실패 시 롤백. 반환=최종 상태.
  // trackId: 곡 문맥(플레이어 착장 카드)에서 담을 때 전달 — 서버 ad_wish_events 어트리뷰션용(웹 MAIDOL 계약 동일)
  toggle: (itemId: string, trackId?: string) => Promise<boolean>;
  fetchList: (force?: boolean) => Promise<void>;    // 위시리스트 목록 로드(카테고리 필터는 클라이언트에서)
}

// v3.227 C: sync 캐시(모듈 메모리) — 내 위시 id 집합·조회 시각·진행 중 요청
const SYNC_CACHE_MS = 60 * 1000;
let _listedCache: Set<string> | null = null;
let _listedAt = 0;
let _listedUser: string | null = null; // 캐시 소유 계정 — 계정 전환 시 무효
let _syncInflight: Promise<Set<string> | null> | null = null;

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
    // v3.227 C: /wishlist/check?item_ids=<수백 개 콤마 결합>(URL 13~34KB — Network Error 원인) 폐기 →
    // 내 위시 전량 GET /wishlist/ 1회(보통 수십 건, 쿼리스트링 없음)로 wished 맵을 채운다.
    // 목록 id → true, 요청 id 중 목록에 없는 것 → false. 60초 이내 재호출은 캐시(피커를 열 때마다 불려도 1회).
    // 시그니처 불변(2조 호출부 무변경). 토글은 wished·캐시를 낙관적으로 함께 갱신한다.
    const now = Date.now();
    const uid = useAuthStore.getState().user?.id ? String(useAuthStore.getState().user?.id) : null;
    if (!uid) return; // 비로그인 — 위시 조회 불가(서버 401), 하트 비활성 유지
    const cacheFresh = _listedCache !== null && _listedUser === uid && now - _listedAt < SYNC_CACHE_MS;
    let listedIds: Set<string>;
    if (cacheFresh) {
      listedIds = _listedCache as Set<string>;
    } else {
      if (!_syncInflight) {
        _syncInflight = (async () => {
          try {
            const { data } = await api.get('/wishlist/');
            const items: WishItem[] = Array.isArray(data?.items) ? data.items : [];
            _listedCache = new Set(items.map((it) => String(it.id)).filter(Boolean));
            _listedAt = Date.now();
            _listedUser = uid;
            // 같은 응답이므로 위시 탭 목록도 채워 둔다(추가 요청 절약)
            set({ items, listLoaded: true, listError: false });
            return _listedCache;
          } catch (err: any) {
            // 미로그인(401) 등은 조용히 — 하트 비활성 상태 유지
            if (err?.response?.status !== 401) {
              console.error('[wishlistStore] sync 실패', { status: err?.response?.status });
            }
            return null;
          } finally {
            _syncInflight = null;
          }
        })();
      }
      const got = await _syncInflight;
      if (!got) return;
      listedIds = got;
    }
    set((s) => {
      const next = { ...s.wished };
      ids.forEach((id) => { next[id] = listedIds.has(id); });
      listedIds.forEach((id) => { next[id] = true; });
      return { wished: next };
    });
    console.info('[wishlistStore] sync via list', { listed: listedIds.size, requested: ids.length, cached: cacheFresh });
  },

  toggle: async (itemId, trackId) => {
    if (!itemId || get().busy[itemId]) return get().isWished(itemId);
    const prev = get().isWished(itemId);
    const next = !prev;
    // 낙관적 반영
    set((s) => ({ wished: { ...s.wished, [itemId]: next }, busy: { ...s.busy, [itemId]: true } }));
    if (__DEV__) console.info('[wishlistStore] toggle', { itemId, next, trackId });
    try {
      const { data } = await api.post(
        `/wishlist/${itemId}/toggle`,
        trackId ? { track_id: trackId } : undefined,
      );
      const serverState = typeof data?.wishlisted === 'boolean' ? data.wishlisted : next;
      // v3.227 C: sync 캐시도 서버 확정값으로 갱신(60초 캐시 동안 하트 상태 일관)
      if (_listedCache) {
        if (serverState) _listedCache.add(itemId);
        else _listedCache.delete(itemId);
      }
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
      _listedCache = new Set(items.map((it) => String(it.id)).filter(Boolean));
      _listedAt = Date.now();
      _listedUser = useAuthStore.getState().user?.id ? String(useAuthStore.getState().user?.id) : null;
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
