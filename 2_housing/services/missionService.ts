import api from './api';

// v3.293 [WeeklyMission] 주간 미션 현황 — 서버 GET /api/missions/weekly
// 응답 { week:'2026-W41', ends_at:ISO, missions:[{ key, title, target, count, reward, rewarded }] }

export interface WeeklyMission {
  key: string;
  title: string;
  target: number;
  count: number;
  reward: number;
  rewarded: boolean;
}

export interface WeeklyMissionStatus {
  week: string;
  ends_at: string | null;
  missions: WeeklyMission[];
}

export async function getWeeklyMissions(): Promise<WeeklyMissionStatus> {
  if (__DEV__) console.info('[WeeklyMission] GET /missions/weekly 요청');
  try {
    const res = await api.get('/missions/weekly');
    const raw = res.data ?? {};
    const missions: WeeklyMission[] = (Array.isArray(raw.missions) ? raw.missions : [])
      .filter((m: any) => m && typeof m.key === 'string')
      .map((m: any) => ({
        key: m.key,
        title: String(m.title ?? ''),
        target: Number(m.target) || 0,
        count: Number(m.count) || 0,
        reward: Number(m.reward) || 0,
        rewarded: !!m.rewarded,
      }));
    if (__DEV__) console.info('[WeeklyMission] 응답', { week: raw.week, n: missions.length });
    return { week: String(raw.week ?? ''), ends_at: typeof raw.ends_at === 'string' ? raw.ends_at : null, missions };
  } catch (err: any) {
    console.error('[WeeklyMission] 조회 실패', { status: err?.response?.status, msg: err?.message });
    throw err;
  }
}

/**
 * v3.304 [EarnNews] 발매·커버 직후 안내에 붙일 주간 미션 진행 한 줄.
 * 실패·지연(timeoutMs) 시 null — 호출부는 기존 문구만 띄운다(안내 지연 방지).
 */
export async function weeklyMissionLine(key: string, timeoutMs = 2500): Promise<string | null> {
  try {
    const status = await Promise.race([
      getWeeklyMissions(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    const m = status?.missions.find((x) => x.key === key);
    if (!m || m.target <= 0) return null;
    if (m.rewarded || m.count >= m.target) return `🎯 주간 미션 달성! ${m.title} ⭐${m.reward}`;
    return `🎯 주간 미션 ${Math.min(m.count, m.target)}/${m.target} — ${m.title} (달성 시 ⭐${m.reward})`;
  } catch (err: any) {
    console.warn('[WeeklyMission] 진행 한 줄 생략', { key, msg: err?.message });
    return null;
  }
}
