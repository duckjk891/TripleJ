// [UpdateGate] v3.324 앱 업데이트 안내 — 필수(닫을 수 없음)·선택([지금 업데이트]/[나중에]) 2단계(대표 확정 2026-10-10).
//  · 확인 시점: 앱 시작 3초 뒤, 10분마다, 앱으로 돌아올 때(웹 visibilitychange·네이티브 AppState active).
//  · 웹: 서버 GET /api/app/version 의 web.min_build(필수) + /app HTML 번들 해시 비교(새 배포 = 선택).
//    업데이트 = 페이지 새로고침. 네이티브: android/ios min·latest — 업데이트 = 스토어 열기.
//  · 작업 중 화면(UPDATE_BUSY_ROUTES)에서는 띄우지 않고, 벗어나면 띄운다(저장 안 된 작업 보호 — 필수 포함).
//  · [나중에] 는 같은 새 버전에 대해 이번 실행 동안 다시 묻지 않는다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Modal, Platform, StyleSheet, TouchableOpacity, View } from 'react-native';
import api from '../services/api';
import { navigationRef } from '../services/navigationRef';
import { AppText } from './ui';
import { colors } from '../theme/colors';
import {
  APP_VERSION, WEB_BUILD, UPDATE_BUSY_ROUTES, decideUpdate, parseBundleName, versionLabel,
  type UpdateLevel, type VersionConfig,
} from '../utils/appVersion';

const CHECK_INTERVAL_MS = 10 * 60 * 1000;
const BUNDLE_DIR = '/_expo/static/js/web/';
const PREFETCH_TRIES = 6;
const PREFETCH_WAIT_MS = 5000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** v3.356 웹 업데이트 전 새 번들 미리 받기 — 새 /app 이 가리키는 번들을 캐시 갱신(reload)으로 받아 JS 인지 확인.
 *  배포 직후 엣지 전파 전이면 HTML(또는 404)이 오므로 잠시 기다렸다 다시 시도. 끝까지 안 되면 false(새로고침 보류). */
export async function prefetchDeployedBundle(
  fetchFn: typeof fetch = fetch, wait = sleep, onProgress?: (pct: number) => void,
): Promise<boolean> {
  for (let i = 0; i < PREFETCH_TRIES; i++) {
    try {
      const html = await fetchFn(`/app?vc=${Date.now()}`, { cache: 'no-store' }).then((r) => r.text());
      const name = parseBundleName(html);
      if (!name) return true; // 번들 이름을 못 찾으면 예전처럼 바로 새로고침
      const total = Number((html.match(/data-size="(\d+)"/) || [])[1]) || 0; // deploy.sh 가 넣은 원본 바이트
      const res = await fetchFn(BUNDLE_DIR + name, { cache: 'reload' });
      const ct = res.headers.get('content-type') || '';
      if (res.ok && ct.includes('javascript')) {
        // 끝까지 받아 캐시에 넣는다(새로고침이 바로 뜨게). 가능하면 받는 만큼 진행률 표시
        const reader: any = total && onProgress && (res as any).body?.getReader ? (res as any).body.getReader() : null;
        if (reader) {
          let got = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            got += value?.byteLength || 0;
            onProgress?.(Math.min(99, Math.floor((got * 100) / total)));
          }
        } else {
          await res.arrayBuffer();
        }
        onProgress?.(100);
        console.info('[AppUpdate] 새 번들 미리 받기 완료', { name, try: i + 1 });
        return true;
      }
      console.warn('[AppUpdate] 새 번들 아직 준비 전 — 대기', { name, status: res.status, ct, try: i + 1 });
    } catch (err: any) {
      console.warn('[AppUpdate] 새 번들 미리 받기 실패 — 대기', { message: err?.message, try: i + 1 });
    }
    await wait(PREFETCH_WAIT_MS);
  }
  return false;
}

function currentBundleName(): string {
  try {
    if (typeof document === 'undefined') return '';
    const src = Array.from(document.scripts).map((s) => s.src).find((x) => x.includes('AppEntry-')) || '';
    return parseBundleName(src);
  } catch {
    return '';
  }
}

export default function UpdateGate() {
  const [level, setLevel] = useState<UpdateLevel>('none');
  const [config, setConfig] = useState<VersionConfig | null>(null);
  const [visible, setVisible] = useState(false);
  const [updating, setUpdating] = useState(false); // v3.356 두 번 누름 방지·진행 안내
  const [updateNote, setUpdateNote] = useState('');
  const [updatePct, setUpdatePct] = useState(-1); // v3.356 진행률(받기 시작 전 -1)
  const dismissedRef = useRef<string>('');
  const pendingKeyRef = useRef<string>('');

  const isBusy = () => {
    try {
      const name = navigationRef.isReady() ? navigationRef.getCurrentRoute()?.name : 'Splash';
      return !name || UPDATE_BUSY_ROUTES.has(name);
    } catch {
      return true;
    }
  };

  const maybeShow = useCallback((lv: UpdateLevel, key: string) => {
    if (lv === 'none') { setVisible(false); return; }
    if (lv === 'soft' && dismissedRef.current === key) return;
    if (isBusy()) { if (__DEV__) console.info('[AppUpdate] 작업 중 화면 — 보류', { lv }); return; }
    setVisible(true);
  }, []);

  const check = useCallback(async () => {
    try {
      const { data } = await api.get('/app/version');
      let webNewBundle = false;
      let key = '';
      if (Platform.OS === 'web') {
        const running = currentBundleName();
        const html = await fetch(`/app?vc=${Date.now()}`, { cache: 'no-store' }).then((r) => r.text()).catch(() => '');
        const deployed = parseBundleName(html);
        webNewBundle = !!running && !!deployed && running !== deployed;
        key = deployed;
      } else {
        key = String((Platform.OS === 'ios' ? data?.ios?.latest : data?.android?.latest) || '');
      }
      const lv = decideUpdate({ platform: Platform.OS, appVersion: APP_VERSION, webBuild: WEB_BUILD, config: data, webNewBundle });
      if (lv !== 'none') console.info('[AppUpdate] 업데이트 감지', { lv, version: versionLabel() });
      setConfig(data);
      setLevel(lv);
      pendingKeyRef.current = key;
      maybeShow(lv, key);
    } catch (err: any) {
      console.warn('[AppUpdate] 확인 실패(무시)', { status: err?.response?.status, message: err?.message });
    }
  }, [maybeShow]);

  useEffect(() => {
    const t = setTimeout(check, 3000);
    const iv = setInterval(check, CHECK_INTERVAL_MS);
    let sub: any;
    let onVis: any;
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      onVis = () => { if (document.visibilityState === 'visible') check(); };
      document.addEventListener('visibilitychange', onVis);
    } else {
      sub = AppState.addEventListener('change', (st) => { if (st === 'active') check(); });
    }
    return () => {
      clearTimeout(t); clearInterval(iv);
      if (onVis) document.removeEventListener('visibilitychange', onVis);
      sub?.remove?.();
    };
  }, [check]);

  // 작업 중이라 미뤘던 안내 — 화면이 바뀔 때 다시 시도
  useEffect(() => {
    const unsub = navigationRef.addListener?.('state', () => {
      if (level !== 'none' && !visible) maybeShow(level, pendingKeyRef.current);
    });
    return () => { try { unsub?.(); } catch {} };
  }, [level, visible, maybeShow]);

  const doUpdate = async () => {
    if (updating) return;
    console.info('[AppUpdate] 업데이트 실행', { level, platform: Platform.OS });
    if (Platform.OS === 'web') {
      // v3.356: 새 번들을 먼저 받아 두고 새로고침(배포 직후 하얀 화면·반복 새로고침 방지)
      setUpdating(true);
      setUpdateNote('업데이트 중이에요. 잠시만 기다려 주세요.');
      const ready = await prefetchDeployedBundle(fetch, sleep, (pct) => {
        setUpdatePct(pct);
        setUpdateNote(`새 버전을 받는 중이에요… ${pct}%`);
      });
      if (ready) {
        try { window.location.reload(); } catch {}
        return;
      }
      setUpdating(false);
      setUpdateNote('새 버전을 준비하고 있어요. 1~2분 뒤 다시 눌러 주세요.');
      return;
    }
    const url = (Platform.OS === 'ios' ? config?.ios?.store_url : config?.android?.store_url) || '';
    if (url) Linking.openURL(url).catch(() => {});
  };

  const later = () => {
    dismissedRef.current = pendingKeyRef.current;
    setVisible(false);
    console.info('[AppUpdate] 나중에');
  };

  if (!visible || level === 'none') return null;
  const force = level === 'force';
  const msg = (config?.message || '').trim()
    || (force ? '새 버전으로 업데이트해야 계속 이용할 수 있어요.' : '새 버전이 나왔어요. 업데이트하면 더 안정적으로 이용할 수 있어요.');
  return (
    <Modal visible transparent animationType="fade" onRequestClose={force ? () => {} : later}>
      <View style={styles.overlay}>
        <View style={styles.box}>
          <AppText style={styles.title}>{force ? '필수 업데이트' : '새 버전 안내'}</AppText>
          <AppText style={styles.body}>{msg}</AppText>
          <AppText style={styles.ver}>{`현재 ${versionLabel()}`}</AppText>
          {updateNote ? <AppText style={styles.ver}>{updateNote}</AppText> : null}
          {updating && updatePct >= 0 ? (
            <View style={styles.progTrack}><View style={[styles.progFill, { width: `${Math.max(2, updatePct)}%` }]} /></View>
          ) : null}
          <View style={styles.btnRow}>
            {!force ? (
              <TouchableOpacity style={[styles.btn, styles.btnLater]} onPress={later} disabled={updating} accessibilityLabel="나중에">
                <AppText style={styles.btnLaterText}>나중에</AppText>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={[styles.btn, styles.btnUpdate, updating && { opacity: 0.6 }]} onPress={() => { void doUpdate(); }} disabled={updating} accessibilityLabel="업데이트">
              <AppText style={styles.btnUpdateText}>{updating ? '업데이트 중…' : Platform.OS === 'web' ? '지금 업데이트' : '스토어에서 업데이트'}</AppText>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  progTrack: { height: 6, borderRadius: 3, backgroundColor: 'rgba(168, 85, 247, 0.2)', overflow: 'hidden' },
  progFill: { height: '100%', backgroundColor: '#a855f7' },
  overlay: { flex: 1, backgroundColor: 'rgba(13, 8, 32, 0.9)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  box: { width: '100%', maxWidth: 360, backgroundColor: colors.bg.surface1, borderRadius: 16, padding: 22, gap: 10 },
  title: { fontSize: 18, fontWeight: '700', color: colors.text.primary },
  body: { fontSize: 14, lineHeight: 21, color: colors.text.secondary },
  ver: { fontSize: 11, color: colors.text.muted },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  btn: { flex: 1, paddingVertical: 13, borderRadius: 10, alignItems: 'center' },
  btnLater: { backgroundColor: colors.bg.surface2 },
  btnLaterText: { color: colors.text.secondary, fontSize: 15 },
  btnUpdate: { backgroundColor: colors.accent.primary },
  btnUpdateText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
