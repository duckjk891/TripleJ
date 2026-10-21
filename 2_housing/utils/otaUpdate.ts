// v3.391 [OTA] 설치 앱 JS 업데이트(EAS Update) — 웹처럼 스토어 심사 없이 화면·로직 수정을 내려보낸다.
//  · 앱 시작: expo-updates 가 자동으로 확인·내려받기(app.json updates.checkAutomatically=ON_LOAD, fallbackToCacheTimeout=0
//    → 기다리지 않고 지금 번들로 켜진 뒤 뒤에서 받는다). 받은 업데이트는 "다음에 앱을 새로 켤 때" 적용된다.
//  · 이 모듈: 앱으로 돌아올 때·10분마다 한 번 더 확인해 미리 받아 두고, 받아 둔 게 있으면 pending 으로 알린다.
//    UpdateGate 가 작업 중·재생 중이 아닐 때만 [지금 적용]을 묻는다 — 사용 중 갑자기 재시작하지 않는다.
//  · 네이티브가 바뀐 수정은 runtimeVersion(fingerprint)이 달라 옛 앱에 내려가지 않는다(스토어 빌드로만).
//  · 웹·개발 서버·expo-updates 없는 옛 빌드: 전부 조용히 아무것도 안 함.
import { Platform } from 'react-native';

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

/** 받아 둔 업데이트로 지금 다시 켠다(사용자가 [지금 적용]을 눌렀을 때만 호출). */
export async function applyOtaNow(): Promise<void> {
  if (!Updates || !pendingId) return;
  console.info('[OTA] 지금 적용 — 앱 다시 시작', { id: pendingId.slice(0, 8) });
  await Updates.reloadAsync();
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
