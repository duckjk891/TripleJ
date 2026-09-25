import { create } from 'zustand';
import api, { setAuthToken } from '../services/api';
import { usePlayerStore } from './playerStore';
import { useMusicStore } from './musicStore';
import { useCharacterTaskStore } from './characterTaskStore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  interpretNicknameError,
  interpretNicknameSuccess,
  pickServerErrorMessage,
  renameUploaderInTrack,
  type NicknameResult,
} from '../utils/nicknameRules';
import { clearPendingReferral, noteSignupReferral } from '../utils/pendingReferral';

interface AuthUser {
  id: string;
  email: string;
  nickname: string;
  company_name?: string | null;
  display_title?: string | null;
  // v3.92 계정 위생 — /auth/me 응답 필드(로그인 응답엔 일부만 옴, 편집 진입 시 getMe로 보강)
  profile_image?: string | null;
  bio?: string | null;
  birth_date?: string | null; // "YYYY-MM-DD"
  gender?: string | null; // male | female | other
  region?: string | null; // 17개 시·도 또는 '해외'
  nationality?: string | null; // domestic | foreign
  sns_links?: string[];
  is_verified?: boolean; // 본인인증 계정은 birth_date/gender 수정 금지(서버 400)
}

/** PATCH /auth/me/profile 페이로드 — undefined=미전송, null=지우기 (백엔드 exclude_unset 계약) */
export interface ProfilePatch {
  company_name?: string;
  display_title?: string;
  bio?: string;
  birth_date?: string | null;
  gender?: string | null;
  region?: string | null;
  nationality?: string | null;
  sns_links?: string[];
  /** v3.230 A2(S1): 닉네임 — changeNickname 전용(검증·오류 해석 포함). 서버 규칙 2~15자·중복 409 */
  nickname?: string;
}

const TOKEN_KEY = 'auth-token-v1';

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  isLoading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<boolean>;
  /** 소셜 로그인 콜백용 — JWT를 직접 받아 세션을 연다(OAuth 리다이렉트 `#token=` 수신 경로) */
  loginWithToken: (token: string) => Promise<boolean>;
  register: (
    email: string,
    password: string,
    nickname: string,
    companyName?: string,
    displayTitle?: string,
    extra?: Record<string, any>  // birth_date/nationality/gender/region/consents/referral_code (현행 백엔드 필수 필드 포함)
  ) => Promise<boolean>;
  // v3.190: starGranted — 프로필 완성 보상 ⭐10 이 이번 저장으로 지급됐는지(1회성)
  updateProfile: (patch: ProfilePatch) => Promise<{ ok: boolean; starGranted?: boolean }>;
  /** v3.230 A2: 닉네임 변경 — PATCH /auth/me/profile {nickname}. 성공 시 user·재생 큐 표시 캐시 갱신.
   *  구서버(닉네임 무시)면 code='unsupported'. 전역 isLoading/error 는 건드리지 않는다(모달이 자체 표시). */
  changeNickname: (nickname: string) => Promise<NicknameResult>;
  /** v3.92: 서버 반영 후 로컬 user 부분 갱신(프로필 이미지·getMe 보강 등) */
  setUser: (patch: Partial<AuthUser>) => void;
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
      AsyncStorage.setItem(TOKEN_KEY, token).catch(() => {}); // 세션 영속화(앱 재시작 유지)
      set({ token, user, isLoading: false });
      // 로그인: 이 계정이 쓰던 재생목록을 복원해서 보여준다(보관 목록이 없으면 담아둔 목록 승계)
      try { usePlayerStore.getState().restoreQueueFor(String(user?.id)); } catch (err) { console.error('[authStore] restoreQueueFor 실패(login)', { err }); }
      return true;
    } catch (err: any) {
      set({ error: err.response?.data?.error || err.response?.data?.detail || '로그인에 실패했습니다.', isLoading: false });
      return false;
    }
  },
  loginWithToken: async (token) => {
    set({ isLoading: true, error: null });
    try {
      setAuthToken(token);
      const res = await api.get('/auth/me'); // user 객체 최상위 응답
      const user = res.data?.user ?? res.data;
      if (!user?.id) throw new Error('invalid user payload');
      AsyncStorage.setItem(TOKEN_KEY, token).catch(() => {});
      set({ token, user, isLoading: false });
      try { usePlayerStore.getState().restoreQueueFor(String(user.id)); } catch (err) { console.error('[authStore] restoreQueueFor 실패(social)', { err }); }
      return true;
    } catch (err: any) {
      console.error('[authStore] loginWithToken 실패', { status: err?.response?.status });
      setAuthToken(null);
      set({ error: '소셜 로그인에 실패했습니다. 다시 시도해주세요.', isLoading: false, token: null, user: null });
      return false;
    }
  },
  register: async (email, password, nickname, companyName, displayTitle, extra) => {
    set({ isLoading: true, error: null });
    try {
      const body: Record<string, any> = { email, password, nickname, ...(extra || {}) };
      if (companyName && companyName.trim()) body.company_name = companyName.trim();
      if (displayTitle && displayTitle.trim()) body.display_title = displayTitle.trim();
      const res = await api.post('/auth/register', body);
      const { token, user } = res.data;
      // v3.230 A7 [ReferralPending]: 추천코드 적용 결과(referral.applied)를 가입 선물 안내에 넘기고 보관 코드 소진
      if (typeof body.referral_code === 'string' && body.referral_code) {
        const applied = typeof res.data?.referral?.applied === 'boolean' ? res.data.referral.applied : null;
        noteSignupReferral(body.referral_code, applied);
        console.info('[ReferralPending] 이메일 가입 추천 결과', { applied });
      }
      clearPendingReferral('email-register').catch(() => {});
      setAuthToken(token);
      AsyncStorage.setItem(TOKEN_KEY, token).catch(() => {});
      set({ token, user, isLoading: false });
      // 회원가입: 가입 직전까지 비회원으로 담아둔 재생목록을 그대로 새 계정에 승계(보존)
      try { usePlayerStore.getState().claimQueue(String(user?.id)); } catch (err) { console.error('[authStore] claimQueue 실패(register)', { err }); }
      return true;
    } catch (err: any) {
      // v3.101(A-19) — 서버측 만14세 미만 판정: error 코드 대신 사람이 읽는 message를 표시
      const data = err.response?.data;
      // v3.230c: 닉네임 400(nickname_invalid 등 코드형 error)은 서버 message 를 그대로 표시
      const message =
        data?.error === 'guardian_consent_required'
          ? (data?.message || '만 14세 미만 가입은 보호자 동의가 필요합니다.')
          : pickServerErrorMessage(data, '회원가입에 실패했습니다.');
      console.error('[authStore] register 실패', { status: err?.response?.status, error: typeof data?.error === 'string' && /^[a-z0-9_]+$/.test(data.error) ? data.error : null });
      set({ error: message, isLoading: false });
      return false;
    }
  },
  updateProfile: async (patch) => {
    set({ isLoading: true, error: null });
    try {
      // undefined 필드만 제외 — null은 "지우기"로 그대로 전송(백엔드 PATCH exclude_unset 계약)
      const body: Record<string, any> = {};
      (Object.keys(patch) as Array<keyof ProfilePatch>).forEach((key) => {
        if (patch[key] !== undefined) body[key] = patch[key];
      });
      const res = await api.patch('/auth/me/profile', body);
      // v3.190: profile_bonus_granted 는 1회성 응답 플래그 — user 상태에 섞지 않고 분리
      const { profile_bonus_granted, ...updated } = res.data?.user ?? res.data ?? {};
      set((state) => ({
        user: state.user ? { ...state.user, ...updated } : state.user,
        isLoading: false,
      }));
      return { ok: true, starGranted: !!profile_bonus_granted };
    } catch (err: any) {
      set({
        error: err.response?.data?.detail || err.response?.data?.error || '프로필 수정에 실패했습니다.',
        isLoading: false,
      });
      return { ok: false };
    }
  },
  changeNickname: async (nickname) => {
    const prev = useAuthStore.getState().user;
    if (!prev) return { code: 'auth', message: '로그인이 필요해요.' };
    console.info('[NicknameChange] PATCH 요청', { len: nickname.length });
    let result: NicknameResult;
    try {
      const res = await api.patch('/auth/me/profile', { nickname });
      result = interpretNicknameSuccess(nickname, res.data);
      console.info('[NicknameChange] PATCH 응답', { code: result.code, synced: result.synced ?? null });
    } catch (err: any) {
      const status = err?.response?.status;
      result = interpretNicknameError(status, err?.response?.data);
      console.error('[NicknameChange] PATCH 실패', { status, code: result.code, error: err?.response?.data?.error ?? null });
    }
    if (result.code !== 'ok' || !result.nickname) return result;
    const newNick = result.nickname;
    const oldNick = prev.nickname;
    // 1) 인증 store 사용자 정보(설정·내 곡·댓글 표기의 소스)
    set((state) => ({ user: state.user ? { ...state.user, nickname: newNick } : state.user }));
    // 2) 표시 캐시 — 재생 큐·현재 곡·계정 보관함의 내 곡 스냅샷(uploader_nickname·폴백 표기)
    try {
      const uid = String(prev.id);
      const ps = usePlayerStore.getState();
      let n = 0;
      const mapT = (t: any) => {
        const r = renameUploaderInTrack(t, uid, oldNick, newNick);
        if (r !== t) n++;
        return r;
      };
      const queue = ps.queue.map(mapT);
      const track = mapT(ps.track);
      const savedQueues: typeof ps.savedQueues = {};
      for (const [owner, entry] of Object.entries(ps.savedQueues || {})) {
        savedQueues[owner] = entry ? { ...entry, queue: (entry.queue || []).map(mapT), track: mapT(entry.track) } : entry;
      }
      if (n > 0) usePlayerStore.setState({ queue, track, savedQueues });
      console.info('[NicknameChange] 표시 캐시 갱신', { tracks: n, len: newNick.length });
    } catch (err: any) {
      console.error('[NicknameChange] 표시 캐시 갱신 실패(무시)', { message: err?.message });
    }
    return result;
  },
  setUser: (patch) =>
    set((state) => ({ user: state.user ? { ...state.user, ...patch } : state.user })),
  logout: () => {
    setAuthToken(null);
    AsyncStorage.removeItem(TOKEN_KEY).catch(() => {});
    set({ token: null, user: null });
    // 내 재생목록(큐)은 로그인 사용자 기능 → 로그아웃 시 초기화(재진입 시 비회원에겐 아무것도 남기지 않음)
    try { usePlayerStore.getState().resetOnLogout(); } catch (err) { console.error('[authStore] resetOnLogout 실패', { err }); }
    // v3.219 [DraftKeep]: 계정 전환 오염 방지 — 디렉터 작업 draft 일괄 청소.
    // lyricsStore(작사 draft)는 기본안대로 유지 — 가사 텍스트는 사용자 생성물(2026-09-07 유실
    // 사고 이력), 기기 공유 계정 전환 오염보다 보존 우선.
    try {
      useCharacterTaskStore.getState().reset();
      const music = useMusicStore.getState();
      music.clearComposeDraft();
      music.clearVideoDraft();
      music.clearCoverContext();
      if (__DEV__) console.info('[DraftKeep] logout — 아티스트/작곡/영상/커버 draft 청소(가사 draft 유지)');
    } catch (err) {
      console.error('[DraftKeep] logout draft 청소 실패', { err });
    }
  },
  clearError: () => set({ error: null }),
}));

// 앱 부팅 시 저장된 토큰으로 세션 복원(JWT 7일) — App.tsx에서 1회 호출.
// 유효하면 자동 로그인 + 계정 재생목록 복원, 만료/무효면 조용히 로그아웃 상태 유지.
export async function restoreSession(): Promise<boolean> {
  try {
    const token = await AsyncStorage.getItem(TOKEN_KEY);
    if (!token) return false;
    if (__DEV__) console.info('[authStore] restoreSession — 저장 토큰으로 복원 시도');
    const ok = await useAuthStore.getState().loginWithToken(token);
    if (!ok) AsyncStorage.removeItem(TOKEN_KEY).catch(() => {});
    return ok;
  } catch (err: any) {
    console.error('[authStore] restoreSession 실패', { message: err?.message });
    return false;
  }
}
