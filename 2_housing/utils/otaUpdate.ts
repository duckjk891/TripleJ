// v3.391 [OTA] 설치 앱 JS 업데이트(EAS Update) — 웹처럼 스토어 심사 없이 화면·로직 수정을 내려보낸다.
//  · 앱 시작: expo-updates 가 자동으로 확인·내려받기(app.json updates.checkAutomatically=ON_LOAD, fallbackToCacheTimeout=0
//    → 기다리지 않고 지금 번들로 켜진 뒤 뒤에서 받는다). 받은 업데이트는 "다음에 앱을 새로 켤 때" 적용된다.
//  · 이 모듈: 앱으로 돌아올 때·10분마다 한 번 더 확인해 미리 받아 두고, 받아 둔 게 있으면 pending 으로 알린다.
//    UpdateGate 가 작업 중·재생 중이 아닐 때만 [지금 적용]을 묻는다 — 사용 중 갑자기 재시작하지 않는다.
//  · 네이티브가 바뀐 수정은 runtimeVersion(fingerprint)이 달라 옛 앱에 내려가지 않는다(스토어 빌드로만).
//  · 웹·개발 서버·expo-updates 없는 옛 빌드: 전부 조용히 아무것도 안 함.
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { dmSocketDisconnect } from '../services/dmSocket';
import { stopAllNativeShims } from '../services/nativeAudioShim';
import { colors } from '../theme/colors';

type UpdatesModule = typeof import('expo-updates');

let Updates: UpdatesModule | null = null;
if (Platform.OS !== 'web') {
  try {
    const mod = require('expo-updates') as UpdatesModule;
    Updates = mod?.isEnabled ? mod : null;
  } catch {
    Updates = null;
  }
}

let checking = false;
let pendingId = '';

export function isOtaEnabled(): boolean {
  return !!Updates && !__DEV__;
}

/** 받아 둔(아직 적용 안 된) 업데이트 id — 없으면 '' */
export function pendingOtaId(): string {
  return pendingId;
}

/**
 * 서버에 새 업데이트가 있는지 보고, 있으면 내려받아 둔다(적용은 하지 않음).
 * 반환: 받아 둔 업데이트 id('' = 없음·실패). 동시 호출은 하나로 합친다.
 */
export async function checkAndFetchOta(reason: string): Promise<string> {
  if (!isOtaEnabled() || !Updates || checking) return pendingId;
  checking = true;
  try {
    const res = await Updates.checkForUpdateAsync();
    if (!res.isAvailable) return pendingId;
    const fetched = await Updates.fetchUpdateAsync();
    const id = String((fetched as any)?.manifest?.id || (res as any)?.manifest?.id || '');
    if (id && id !== Updates.updateId) {
      if (id !== pendingId) console.info('[OTA] 새 업데이트 받아 둠(다음 실행 때 적용)', { reason, id: id.slice(0, 8) });
      pendingId = id;
    }
    return pendingId;
  } catch (err: any) {
    // 앱 시작 자동 확인과 겹치면 "이미 진행 중" 오류가 날 수 있다 — 다음 확인 때 다시
    console.warn('[OTA] 확인 실패(무시)', { reason, message: err?.message });
    return pendingId;
  } finally {
    checking = false;
  }
}

// v3.443 (대표 11-25): 안드로이드에서 [지금 적용] 뒤 로딩만 돌고 다시 켜지지 않는 일이 있었다(라이브러리가 앱 안에서
// JS 를 다시 만드는 동안 멈춤 — 원인 미확정). 다시 켜기 전에 붙잡고 있는 것(팝업 창·소켓·소리)을 먼저 놓고,
// 멈추면 로딩을 걷고 안내하며, 결과를 다음 실행 때 원격 로그로 남겨 원인을 찾는다.
const APPLY_MARK_KEY = 'maidol-ota-apply-v1';
const APPLY_SETTLE_MS = 800; // 안내 팝업(Modal) 창이 완전히 닫힐 시간
const APPLY_STALL_MS = 12000;

/**
 * 받아 둔 업데이트로 지금 다시 켠다(사용자가 [지금 적용]을 눌렀을 때만 호출).
 * onStalled: 다시 켜지지 않고 멈췄거나 실패했을 때(앱이 아직 살아 있으면) 1회 호출 — 호출부가 안내한다.
 */
export async function applyOtaNow(onStalled?: () => void): Promise<void> {
  if (!Updates || !pendingId) return;
  const id = pendingId;
  console.info('[OTA] 지금 적용 — 앱 다시 시작', { id: id.slice(0, 8) });
  try {
    await AsyncStorage.setItem(APPLY_MARK_KEY, JSON.stringify({ id, from: String(Updates.updateId || ''), at: Date.now() }));
  } catch {
    /* 기록 실패는 적용에 영향 없음 */
  }
  try { dmSocketDisconnect(); } catch { /* 무시 */ }
  try { stopAllNativeShims('ota-apply'); } catch { /* 무시 */ }
  await new Promise((r) => setTimeout(r, APPLY_SETTLE_MS));
  let reported = false;
  const stalled = (why: string, message?: string) => {
    if (reported) return;
    reported = true;
    console.warn('[OTA] 적용 멈춤·실패', { why, id: id.slice(0, 8), message });
    void Updates?.hideReloadScreen?.().catch(() => undefined);
    onStalled?.();
  };
  setTimeout(() => stalled('timeout'), APPLY_STALL_MS);
  try {
    await Updates.reloadAsync({
      reloadScreenOptions: { backgroundColor: colors.bg.deepest, fade: false, spinner: { enabled: true, color: colors.accent.primary, size: 'medium' } },
    });
  } catch (err: any) {
    stalled('error', err?.message);
  }
}

/** 앱 시작 때 1회 — 지난번 [지금 적용]이 실제로 됐는지 원격 로그로 남긴다(안 됐으면 라이브러리 오류 기록 포함). */
export async function reportLastOtaApply(): Promise<void> {
  if (!isOtaEnabled() || !Updates) return;
  try {
    const raw = await AsyncStorage.getItem(APPLY_MARK_KEY);
    if (!raw) return;
    await AsyncStorage.removeItem(APPLY_MARK_KEY);
    const mark = JSON.parse(raw) as { id: string; from: string; at: number };
    const now = String(Updates.updateId || '');
    const sec = Math.round((Date.now() - mark.at) / 1000);
    let logs: string[] = [];
    try {
      const entries = await Updates.readLogEntriesAsync(Math.min(24 * 3600 * 1000, Date.now() - mark.at + 60000));
      logs = entries.filter((e) => e.level !== 'info' && e.level !== 'debug' && e.level !== 'trace')
        .slice(-6).map((e) => `${e.code}:${String(e.message).slice(0, 160)}`);
    } catch {
      /* 무시 */
    }
    console.warn('[OTA] 지난 적용 결과', { applied: now === mark.id, sec, want: mark.id.slice(0, 8), now: now.slice(0, 8), from: mark.from.slice(0, 8), logs });
  } catch (err: any) {
    console.warn('[OTA] 지난 적용 결과 확인 실패(무시)', { message: err?.message });
  }
}

/** 지금 실행 중인 번들 정보(문의·로그용) */
export function otaInfo(): { channel: string; runtime: string; updateId: string; embedded: boolean } {
  return {
    channel: String(Updates?.channel || ''),
    runtime: String(Updates?.runtimeVersion || ''),
    updateId: String(Updates?.updateId || ''),
    embedded: Updates ? !!Updates.isEmbeddedLaunch : true,
  };
}
