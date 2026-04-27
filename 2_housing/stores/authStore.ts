import { create } from 'zustand';
import api, { setAuthToken } from '../services/api';

interface AuthUser {
  id: string;
  email: string;
  nickname: string;
  company_name?: string | null;
  display_title?: string | null;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  isLoading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<boolean>;
  register: (
    email: string,
    password: string,
    nickname: string,
    companyName?: string,
    displayTitle?: string
  ) => Promise<boolean>;
  updateProfile: (patch: { company_name?: string; display_title?: string; bio?: string }) => Promise<boolean>;
  logout: () => void;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  isLoading: false,
  error: null,
  login: async (email, password) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.post('/auth/login', { email, password });
      const { token, user } = res.data;
      setAuthToken(token);
      set({ token, user, isLoading: false });
      return true;
    } catch (err: any) {
      set({ error: err.response?.data?.detail || '로그인에 실패했습니다.', isLoading: false });
      return false;
    }
  },
  register: async (email, password, nickname, companyName, displayTitle) => {
    set({ isLoading: true, error: null });
    try {
      const body: Record<string, string> = { email, password, nickname };
      if (companyName && companyName.trim()) body.company_name = companyName.trim();
      if (displayTitle && displayTitle.trim()) body.display_title = displayTitle.trim();
      const res = await api.post('/auth/register', body);
      const { token, user } = res.data;
      setAuthToken(token);
      set({ token, user, isLoading: false });
      return true;
    } catch (err: any) {
      set({ error: err.response?.data?.detail || '회원가입에 실패했습니다.', isLoading: false });
      return false;
    }
  },
  updateProfile: async (patch) => {
    set({ isLoading: true, error: null });
    try {
      const body: Record<string, string> = {};
      if (patch.company_name !== undefined) body.company_name = patch.company_name;
      if (patch.display_title !== undefined) body.display_title = patch.display_title;
      if (patch.bio !== undefined) body.bio = patch.bio;
      const res = await api.patch('/auth/me/profile', body);
      const updated = res.data?.user ?? res.data;
      set((state) => ({
        user: state.user ? { ...state.user, ...updated } : state.user,
        isLoading: false,
      }));
      return true;
    } catch (err: any) {
      set({
        error: err.response?.data?.detail || err.response?.data?.error || '프로필 수정에 실패했습니다.',
        isLoading: false,
      });
      return false;
    }
  },
  logout: () => {
    setAuthToken(null);
    set({ token: null, user: null });
  },
  clearError: () => set({ error: null }),
}));
