import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

// 현재 아티스트가 착용 중인 아이템 (코디 적용 + 저장 시 영구 보관)
export interface AppliedItem {
  cat: string;             // '상의' / '하의' / '신발' / ...
  name: string;            // 제품명
  brand?: string;          // advertiser_nickname
  productUrl?: string;     // 외부 쇼핑몰 링크
  imageObjectName?: string;
  options?: Record<string, string>; // 핏/기장 등
  appliedAt: number;
}

interface OutfitState {
  items: AppliedItem[];
  setItems: (items: AppliedItem[]) => void;
  clear: () => void;
}

export const useOutfitStore = create<OutfitState>()(
  persist(
    (set) => ({
      items: [],
      setItems: (items) => set({ items }),
      clear: () => set({ items: [] }),
    }),
    {
      name: 'outfit-store-v1',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
