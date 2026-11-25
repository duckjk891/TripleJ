// v3.444 [Carol] 승인 푸시(웹) 링크 `?carol=<신청id>` 와 '스타룰렛 안내' 1회 기록
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const TOLD_KEY = 'carol_ready_told_v1';
let pending: string | null = null;

/** 웹 모듈 로드 시 1회 — React Navigation 이 주소를 바꾸기 전에 읽고 주소에서 뺀다 */
export function captureWebCarolLink(): void {
  try {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const u = new URL(window.location.href);
    const id = u.searchParams.get('carol');
    if (!id) return;
    u.searchParams.delete('carol');
    window.history.replaceState(window.history.state, '', u.pathname + u.search + u.hash);
    if (/^[0-9a-f]{24}$/.test(id)) pending = id;
    console.info('[Carol] 푸시 링크', { ok: !!pending });
  } catch (err: any) {
    console.error('[Carol] 푸시 링크 확인 실패', { message: err?.message });
  }
}

export function takeWebCarolLink(): string | null {
  const id = pending;
  pending = null;
  return id;
}

async function readTold(): Promise<string[]> {
  try {
    const v = JSON.parse((await AsyncStorage.getItem(TOLD_KEY)) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** 돌릴 수 있는데 이 기기에서 아직 안내하지 않은 신청 */
export async function newReadyCarols<T extends { id: string; spin: string | null }>(subs: T[]): Promise<T[]> {
  const ready = subs.filter((s) => s.spin === 'ready');
  if (!ready.length) return [];
  const told = await readTold();
  return ready.filter((s) => !told.includes(s.id));
}

export async function markCarolsTold(subs: { id: string }[]): Promise<void> {
  try {
    await AsyncStorage.setItem(TOLD_KEY, JSON.stringify([...(await readTold()), ...subs.map((s) => s.id)].slice(-100)));
  } catch {
    // 저장이 막힌 브라우저 — 다음에 한 번 더 안내될 뿐
  }
}
