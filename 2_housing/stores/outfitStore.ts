import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

// 현재 아티스트가 착용 중인 아이템 (코디 적용 + 저장 시 영구 보관)
export interface AppliedItem {
  cat: string;             // '상의' / '하의' / '신발' / ...
  name: string;            // 제품명
  brand?: string;          // v3.227: 실제 브랜드(brand, 없으면 advertiser_nickname)
  productUrl?: string;     // 외부 쇼핑몰 링크
  imageObjectName?: string;
  options?: Record<string, string>; // 핏/기장 등
  appliedAt: number;
}

// v3.227(E): 꾸미기 화면(ArtistCody) 선택 draft — 화면을 나갔다 들어와도 고른 옷을 유지한다.
// 텍스트/id만 영속(이미지는 object name 문자열). 카테고리당 1개.
export interface CodyDraftItem {
  id: string;
  name: string;
  product_name?: string;
  brand?: string;
  advertiser_nickname?: string;
  image_object_name?: string;
  product_url?: string;
  color?: string;
  gender?: string;
  category?: string;
  sub_category?: string;
  color_family?: string | null;
  price_krw?: number | null;
}

export interface CodyDraft {
  /** 복원 키 — 흐름(sheet/outfit)·대상 아티스트·실사/가상이 다르면 복원하지 않는다(오염 방지) */
  mode: 'sheet' | 'outfit';
  characterId: string | null;
  kind: 'real' | 'virtual';
  items: Record<string, CodyDraftItem>;
  updatedAt: number;
  /** 적용(생성 요청) 시각 — AppliedItem.appliedAt과 같은 값. ArtistResult가 items를 서버값으로
   *  다시 채우면(=결과 화면 도달) 이 값이 사라지므로 다음 진입 때 draft를 비운다 */
  appliedAt?: number;
}

export interface CodyOptions {
  itemOptions: Record<string, Record<string, string>>;
  freeDirecting: string;
}

interface OutfitState {
  items: AppliedItem[];
  setItems: (items: AppliedItem[]) => void;
  /** 착용 목록 초기화 — 새 시트 시작(ArtistInput)·아티스트 삭제 등. v3.227: 새 시트 흐름의
   *  꾸미기 draft(mode='sheet')도 함께 비운다(이전 생성 흐름의 선택이 새 아티스트에 섞이지 않게) */
  clear: () => void;
  /** v3.227(E) 꾸미기 draft */
  codyDraft: CodyDraft | null;
  codyOptions: CodyOptions | null;
  setCodyDraft: (draft: CodyDraft | null, options: CodyOptions | null) => void;
  clearCodyDraft: () => void;
}

export const useOutfitStore = create<OutfitState>()(
  persist(
    (set) => ({
      items: [],
      setItems: (items) => set({ items }),
      clear: () =>
        set((s) =>
          s.codyDraft?.mode === 'sheet'
            ? { items: [], codyDraft: null, codyOptions: null }
            : { items: [] },
        ),
      codyDraft: null,
      codyOptions: null,
      setCodyDraft: (codyDraft, codyOptions) => set({ codyDraft, codyOptions }),
      clearCodyDraft: () => set({ codyDraft: null, codyOptions: null }),
    }),
    {
      name: 'outfit-store-v1',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
