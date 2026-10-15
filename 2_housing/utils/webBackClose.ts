// v3.369 [WebBack]: 웹(설치형 웹앱 포함)에서 시트·팝업이 열린 채 휴대폰 뒤로 가기를 누르면
// 앱 전체가 닫히던 문제(10-15 지유 제보) — 열려 있는 동안 브라우저 기록에 한 칸을 올려 두고,
// 뒤로 가기가 그 칸을 내리면 시트만 닫는다. 네이티브는 Modal onRequestClose 가 이미 처리(무동작).
//
// React Navigation(웹 linking)도 popstate 를 듣는다 — 우리 칸의 이동은 capture 단계에서 먼저 받아
// stopImmediatePropagation 으로 내비게이터에 전달하지 않는다(화면 상태가 흔들리지 않게).
// 올려 둔 칸 state 에는 내비게이터의 id 를 그대로 복사해, 혹시 내비게이터가 보더라도 같은 화면으로 인식한다.
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

type Entry = { token: string; close: () => void };

const stack: Entry[] = [];
const deadTokens = new Set<string>();
let swallowNext = 0;
let installed = false;
let seq = 0;

const canUse = () =>
  Platform.OS === 'web' && typeof window !== 'undefined' && !!window.history && typeof window.history.pushState === 'function';

function onPopState(e: PopStateEvent) {
  const st: any = window.history.state;
  // 우리가 시트를 코드로 닫으며 부른 history.back() — 조용히 삼킨다
  if (swallowNext > 0) {
    swallowNext -= 1;
    e.stopImmediatePropagation();
    return;
  }
  // 뒤로 가다 '이미 닫힌 시트 칸'에 도착 — 한 칸 더 내려 원래 화면 칸으로(사용자는 한 번만 누름)
  if (st?.maidolSheet && deadTokens.has(st.maidolSheet)) {
    deadTokens.delete(st.maidolSheet);
    e.stopImmediatePropagation();
    // 다음 popstate(원래 화면 칸)는 내비게이터가 받아 같은 화면으로 맞춘다
    window.history.back();
    return;
  }
  // 열린 시트의 칸을 벗어남 = 뒤로 가기 → 맨 위 시트만 닫는다
  const top = stack[stack.length - 1];
  if (top && st?.maidolSheet !== top.token) {
    stack.pop();
    e.stopImmediatePropagation();
    console.info('[WebBack] 뒤로 가기 — 시트 닫기', { token: top.token, remaining: stack.length });
    try {
      top.close();
    } catch (err) {
      console.error('[WebBack] close failed', { err });
    }
  }
}

function ensureInstalled() {
  if (installed) return;
  installed = true;
  // capture: 같은 window 의 일반 리스너(React Navigation)보다 먼저 받는다
  window.addEventListener('popstate', onPopState, true);
}

/**
 * 시트·팝업이 열려 있는 동안 웹 뒤로 가기를 '닫기'로 쓴다.
 * @param visible 열림 여부
 * @param onClose 뒤로 가기로 닫을 때 부를 함수(보통 Modal onRequestClose 와 같은 것)
 */
export function useWebBackClose(visible: boolean, onClose: () => void): void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!visible || !canUse()) return;
    ensureInstalled();
    seq += 1;
    const token = `s${Date.now().toString(36)}${seq}`;
    const entry: Entry = { token, close: () => closeRef.current() };
    stack.push(entry);
    try {
      window.history.pushState({ ...(window.history.state || {}), maidolSheet: token }, '', window.location.href);
    } catch (err) {
      console.warn('[WebBack] pushState 실패 — 뒤로 가기 처리 생략', { err });
    }
    return () => {
      // 뒤로 가기로 닫힌 경우: onPopState 가 이미 stack 에서 뺐다 — 할 일 없음
      const i = stack.indexOf(entry);
      if (i < 0) return;
      stack.splice(i, 1);
      // 버튼·바깥 누르기로 닫힘: 올려 둔 칸을 정리. 같은 순간 화면 이동이 있으면(칸이 이미 묻힘)
      // 되돌리면 그 이동을 취소하게 되므로, 잠시 뒤 칸이 여전히 맨 위일 때만 내린다.
      setTimeout(() => {
        try {
          if (window.history.state?.maidolSheet === token) {
            swallowNext += 1;
            window.history.back();
          } else {
            deadTokens.add(token); // 묻힌 칸 — 나중에 뒤로 가다 도착하면 건너뛴다
          }
        } catch (err) {
          console.warn('[WebBack] 칸 정리 실패', { err });
        }
      }, 120);
    };
  }, [visible]);
}
