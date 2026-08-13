import { create } from 'zustand';

// 전역 UI 모달 상태 — 출석체크/초대(추천) 팝업을 헤더·로그인 어디서든 열 수 있게.
interface UiState {
  attendanceOpen: boolean;
  inviteOpen: boolean;
  openAttendance: () => void;
  closeAttendance: () => void;
  openInvite: () => void;
  closeInvite: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  attendanceOpen: false,
  inviteOpen: false,
  openAttendance: () => set({ attendanceOpen: true }),
  closeAttendance: () => set({ attendanceOpen: false }),
  openInvite: () => set({ inviteOpen: true }),
  closeInvite: () => set({ inviteOpen: false }),
}));
