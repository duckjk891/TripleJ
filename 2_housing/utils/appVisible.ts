// v3.441 [SeenAck] 앱이 지금 사용자 화면에 떠 있는가(화면 꺼짐·다른 앱·숨은 브라우저 탭이면 false)
import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { useIsFocused } from '@react-navigation/native';

export function isAppVisible(): boolean {
  if (Platform.OS === 'web') {
    return typeof document === 'undefined' || document.visibilityState !== 'hidden';
  }
  return AppState.currentState === 'active';
}

/** 이 화면이 실제로 보이는가(포커스 + 앱 표시) — 결과를 자동 확정하는 대기 화면용 */
export function useScreenSeen(): boolean {
  const focused = useIsFocused();
  const [visible, setVisible] = useState(isAppVisible);
  useEffect(() => {
    const update = () => setVisible(isAppVisible());
    update();
    if (Platform.OS === 'web') {
      if (typeof document === 'undefined') return undefined;
      document.addEventListener('visibilitychange', update);
      return () => document.removeEventListener('visibilitychange', update);
    }
    const sub = AppState.addEventListener('change', update);
    return () => sub.remove();
  }, []);
  // 작업실 탭을 누르면 대기 화면을 순간 거쳐 맵으로 간다 — 다시 보이기 시작한 뒤 1초 유지돼야 '보임'
  const now = focused && visible;
  const [seen, setSeen] = useState(now);
  useEffect(() => {
    if (!now) {
      setSeen(false);
      return undefined;
    }
    const t = setTimeout(() => setSeen(true), 1000);
    return () => clearTimeout(t);
  }, [now]);
  return now && seen;
}
