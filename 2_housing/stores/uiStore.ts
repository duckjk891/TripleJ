import { create } from 'zustand';
import { waitModalTurn } from '../utils/modalTurn';

// v3.384 [ModalTurn]: 다른 창이 닫히는 중이면(별 안내 → 출석 전환 등) 닫힘이 끝난 뒤 연다 — iOS 는 겹쳐 띄우지 못한다.
// 사용자가 누른 것이라 우선순위 최상·최대 3초만 기다린다.
const openWhenFree = (key: string, open: () => void) => {
  void waitModalTurn(key, 9, 3000).promise.then(open);
};

// 전역 UI 모달 상태 — 출석체크/초대(추천)/별 안내 팝업을 헤더·로그인 어디서든 열 수 있게.
interface UiState {
  attendanceOpen: boolean;
  inviteOpen: boolean;
  starGuideOpen: boolean;
  openAttendance: () => void;
  closeAttendance: () => void;
  openInvite: () => void;
  closeInvite: () => void;
  openStarGuide: () => void;
  closeStarGuide: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  attendanceOpen: false,
  inviteOpen: false,
  starGuideOpen: false,
  openAttendance: () => openWhenFree('attendance', () => set({ attendanceOpen: true })),
  closeAttendance: () => set({ attendanceOpen: false }),
  openInvite: () => openWhenFree('app-share', () => set({ inviteOpen: true })),
  closeInvite: () => set({ inviteOpen: false }),
  openStarGuide: () => openWhenFree('star-guide', () => set({ starGuideOpen: true })),
  closeStarGuide: () => set({ starGuideOpen: false }),
}));
