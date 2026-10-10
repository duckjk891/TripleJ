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

  const doUpdate = () => {
    console.info('[AppUpdate] 업데이트 실행', { level, platform: Platform.OS });
    if (Platform.OS === 'web') {
      try { window.location.reload(); } catch {}
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
          <View style={styles.btnRow}>
            {!force ? (
              <TouchableOpacity style={[styles.btn, styles.btnLater]} onPress={later} accessibilityLabel="나중에">
                <AppText style={styles.btnLaterText}>나중에</AppText>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={[styles.btn, styles.btnUpdate]} onPress={doUpdate} accessibilityLabel="업데이트">
              <AppText style={styles.btnUpdateText}>{Platform.OS === 'web' ? '지금 업데이트' : '스토어에서 업데이트'}</AppText>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
