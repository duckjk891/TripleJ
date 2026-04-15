import { create } from 'zustand';
import api, { setAuthToken } from '../services/api';

interface AuthState {
  token: string | null;
  user: { id: string; email: string; nickname: string } | null;
  isLoading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<boolean>;
  register: (email: string, password: string, nickname: string) => Promise<boolean>;
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
  register: async (email, password, nickname) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.post('/auth/register', { email, password, nickname });
      const { token, user } = res.data;
      setAuthToken(token);
      set({ token, user, isLoading: false });
      return true;
    } catch (err: any) {
      set({ error: err.response?.data?.detail || '회원가입에 실패했습니다.', isLoading: false });
      return false;
    }
  },
  logout: () => {
    setAuthToken(null);
    set({ token: null, user: null });
  },
  clearError: () => set({ error: null }),
}));
