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
