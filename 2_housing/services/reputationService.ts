import api from './api';

// v3.297 [Reputation] 배지·피드백 온도 — 서버 GET /api/reputation/{userId} (공개, 10분 캐시)

export interface ReputationBadge {
  key: string;
  label: string;
  icon: string;
  desc: string;
}

export interface Reputation {
  temperature: number;
  base: number;
  badges: ReputationBadge[];
}

export async function getReputation(userId: string): Promise<Reputation> {
  if (__DEV__) console.info('[Reputation] 조회', { userId });
  try {
    const res = await api.get(`/reputation/${userId}`);
    const d = res.data ?? {};
    return {
      temperature: typeof d.temperature === 'number' ? d.temperature : 36.5,
      base: typeof d.base === 'number' ? d.base : 36.5,
      badges: (Array.isArray(d.badges) ? d.badges : [])
        .filter((b: any) => b && typeof b.key === 'string')
        .map((b: any) => ({ key: b.key, label: String(b.label ?? ''), icon: String(b.icon ?? 'award'), desc: String(b.desc ?? '') })),
    };
  } catch (err: any) {
    console.error('[Reputation] 조회 실패', { userId, status: err?.response?.status });
    throw err;
  }
}
