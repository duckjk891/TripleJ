import api from './api';
import { FatigueStatus, FatigueSkipResult } from '../types';

/**
 * v3.94: 디렉터 피로/쿨다운 (MAIDOL StarEcon v158 파리티 — Wave 4 A-3)
 *
 * 계약 (backend_9004 스냅샷 실측):
 * - GET  /api/fatigue/status (fatigue.py:46) → FatigueStatus
 *   사다리: 그날 1곡 완성→2h / 2곡→4h / 3곡→8h / 4곡+→12h 쿨다운 (fatigue_service.py:37 _LADDER_HOURS),
 *   KST 자정 lazy 리셋(카운트+쿨다운 해제, fatigue_service.py:86).
 * - POST /api/fatigue/skip {method:'points'|'ad'} (fatigue.py:63) → FatigueSkipResult
 *   points=⭐5 로 30분 단축(반복 가능), ad=광고권(skip_wait_count) 1장 소비.
 *   409=활성 쿨다운 없음(무과금) / 402=별 부족 또는 {"error":"no_skip_tickets"}.
 * - 작곡 시작(POST /generate/ start_music_gen=true, POST /generate/{id}/start/)이 쿨다운 중이면
 *   429 {"error":"director_fatigue", message, cooldown_remaining_sec, cooldown_until} + Retry-After
 *   (generate.py:97 _fatigue_gate_response). 429 는 ⭐ 차감 전 게이트 — 과금 없음 (generate.py:444-447, 573-577).
 *   작사/커버/캐릭터는 미게이트 (fatigue_service.py:5-6).
 */

export const getFatigueStatus = async (): Promise<FatigueStatus> => {
  const response = await api.get('/fatigue/status');
  if (__DEV__) {
    console.info('[fatigue] status:', JSON.stringify({
      today_completed: response.data?.today_completed,
      cooldown_active: response.data?.cooldown_active,
      cooldown_remaining_sec: response.data?.cooldown_remaining_sec,
      skip_wait_count: response.data?.skip_wait_count,
    }));
  }
  return response.data;
};

export const skipFatigue = async (method: 'points' | 'ad'): Promise<FatigueSkipResult> => {
  console.log('[fatigue] skip 요청:', method);
  const response = await api.post('/fatigue/skip', { method });
  console.log('[fatigue] skip 완료:', JSON.stringify({
    method,
    skipped_minutes: response.data?.skipped_minutes,
    cooldown_remaining_sec: response.data?.cooldown_remaining_sec,
  }));
  return response.data;
};

/** 작곡 제출 에러가 피로 게이트(429)인지 판별 — MAIDOL api.isDirectorFatigued 관행 (api/index.js:837) */
export const isDirectorFatigued = (err: any): boolean => err?.response?.status === 429;

/** 쿨다운 남은 시간 포맷 — 1시간 미만 mm:ss, 이상 h:mm:ss (MAIDOL StudioTab2 formatCooldown 관행) */
export const formatCooldown = (totalSec: number): string => {
  const sec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = m.toString().padStart(2, '0');
  const ss = s.toString().padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};
