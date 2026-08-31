// [coverLibraryStore] v3.104(B-5): 커버 보관함 "이 커버 사용" 선택 전달용.
// 관행: 선택 화면은 store에 쓰고 goBack (VoiceManage select → voiceStore, LyricsBook → musicStore.lyricsSource).
// 소비 측(TrackUpload/MusicResult)은 useFocusEffect에서 읽은 뒤 즉시 clear — 유령 선택 방지.
import { create } from 'zustand';

export interface PickedCover {
  objectName: string;
  /** 렌더 가능한 절대 URL (coverSessionImageUri 결과) */
  imageUri: string;
  title: string | null;
}

interface CoverLibraryState {
  pickedCover: PickedCover | null;
  setPickedCover: (v: PickedCover | null) => void;
}

export const useCoverLibraryStore = create<CoverLibraryState>((set) => ({
  pickedCover: null,
  setPickedCover: (pickedCover) => set({ pickedCover }),
}));
