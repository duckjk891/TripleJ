// v3.415: 앱이 화면에 떠 있는가(AppState 'active') — 화면이 꺼지면 장식용 애니메이션 타이머를 멈추는 데 쓴다.
// iOS 는 백그라운드 재생 중에도 JS 타이머가 계속 돌아, 느린 기기에서 백그라운드 CPU 한도를 넘으면 앱을 종료한다(10-27).
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

export function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => setActive(st === 'active'));
    return () => sub.remove();
  }, []);
  return active;
}
