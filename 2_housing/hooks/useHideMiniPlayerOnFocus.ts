// [MiniHide] v3.288 — 화면이 포커스된 동안 미니플레이어 UI만 숨김(오디오 재생은 유지 — v3.105 작업실 방침).
// 화면 인스턴스마다 고유 tag 로 숨김을 요청/해제하므로, 숨기는 화면끼리 전환할 때(꾸미기→로딩 등)
// 앞 화면 blur 의 해제가 새 화면의 숨김을 덮어쓰지 않는다(종전 단일 불리언의 순서 경합 제거).
import { useCallback, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { usePlayerStore } from '../stores/playerStore';

let _seq = 0;

export function useHideMiniPlayerOnFocus(screen: string): void {
  const tagRef = useRef<string>('');
  if (!tagRef.current) tagRef.current = `${screen}#${++_seq}`;
  useFocusEffect(
    useCallback(() => {
      const tag = tagRef.current;
      usePlayerStore.getState().setMiniHidden(true, tag);
      if (__DEV__) console.info('[MiniHide] hide', { tag });
      return () => {
        usePlayerStore.getState().setMiniHidden(false, tag);
        if (__DEV__) console.info('[MiniHide] release', { tag });
      };
    }, [])
  );
}
