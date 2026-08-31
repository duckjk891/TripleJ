import api from './api';
import { FatigueDirector, FatigueStatus, FatigueStatusAll, FatigueSkipResult } from '../types';

/**
 * v3.94: 디렉터 피로/쿨다운 (MAIDOL StarEcon v158 파리티 — Wave 4 A-3)
 * v3.118: 전 디렉터 일반화 (backend_9004 v220) — director 파라미터 추가.
 *
 * 계약 (backend_9004 v220 실측):
 * - GET  /api/fatigue/status?director=composer|lyricist|image|artist → FatigueStatus
 *   director 미지정=composer (v3.94 호출부 무수정 하위호환).
 *   사다리: 그날 1개 완성→2h / 2개→4h / 3개→8h / 4개+→12h (fatigue_service.LADDER_HOURS_BY_DIRECTOR,
 *   현재 4 디렉터 동일 — 서버 상수만 바꾸면 개별 튜닝), KST 자정 lazy 리셋(전 디렉터).
 * - GET  /api/fatigue/status?all=1 → FatigueStatusAll (4종 일괄 — Map 티켓 1회 조회)
 * - POST /api/fatigue/skip {method:'points'|'ad', director} → FatigueSkipResult
 *   points=⭐디렉터별 차등(composer 5/lyricist 2/image 2/artist 3 — status의 skip_point_cost 실값)로
 *   30분 단축(반복 가능), ad=광고권(skip_wait_count) 1장 소비(디렉터 공용).
 *   409=활성 쿨다운 없음(무과금) / 402=별 부족 또는 {"error":"no_skip_tickets"}.
 * - 쿨다운 중 생성 시작 시 429 {"error":"director_fatigue", director, message,
 *   cooldown_remaining_sec, cooldown_until} + Retry-After — 모두 ⭐/슬롯 차감 전 게이트(무과금).
 *   게이트 대상: 작곡(POST /generate/, /{id}/start/) · 작사(POST /generate/lyrics) ·
 *   커버(POST /upload/generate-cover — refine/revert 무과금이라 미게이트) ·
 *   아티스트(POST /character/generate-sheet* 4종).
 */

/** 디렉터 표기명 (대표 방침 v3.118: 작곡/작사/커버/아티스트) */
export const FATIGUE_DIRECTOR_LABELS: Record<FatigueDirector, string> = {
  composer: '작곡',
  lyricist: '작사',
  image: '커버',
  artist: '아티스트',
};

export const getFatigueStatus = async (
  director: FatigueDirector = 'composer'
): Promise<FatigueStatus> => {
  const response = await api.get('/fatigue/status', {
    params: director === 'composer' ? undefined : { director }, // composer=미지정 (구 서버 호환)
  });
  if (__DEV__) {
    console.info(`[fatigue:${director}] status:`, JSON.stringify({
      today_completed: response.data?.today_completed,
      cooldown_active: response.data?.cooldown_active,
      cooldown_remaining_sec: response.data?.cooldown_remaining_sec,
      skip_point_cost: response.data?.skip_point_cost,
      skip_wait_count: response.data?.skip_wait_count,
    }));
  }
  return response.data;
};

/** v3.118: 4 디렉터 일괄 상태 — Map 휴식 티켓용 1회 조회 (?all=1) */
export const getFatigueStatusAll = async (): Promise<FatigueStatusAll> => {
  const response = await api.get('/fatigue/status', { params: { all: 1 } });
  if (__DEV__) {
    const dirs = response.data?.directors || {};
    const active = Object.keys(dirs).filter((d) => dirs[d]?.cooldown_active);
    console.info('[fatigue] status(all):', JSON.stringify({
      active,
      skip_wait_count: response.data?.skip_wait_count,
    }));
  }
  return response.data;
};

export const skipFatigue = async (
  method: 'points' | 'ad',
  director: FatigueDirector = 'composer'
): Promise<FatigueSkipResult> => {
  console.log(`[fatigue:${director}] skip 요청:`, method);
  // composer는 director 미전송 — 구 서버(v219 이하)와도 동작 (v3.94 하위호환)
  const body: any = director === 'composer' ? { method } : { method, director };
  const response = await api.post('/fatigue/skip', body);
  console.log(`[fatigue:${director}] skip 완료:`, JSON.stringify({
    method,
    skipped_minutes: response.data?.skipped_minutes,
    cooldown_remaining_sec: response.data?.cooldown_remaining_sec,
  }));
  return response.data;
};

/** 생성 제출 에러가 피로 게이트(429)인지 판별 — MAIDOL api.isDirectorFatigued 관행 (api/index.js:837) */
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
