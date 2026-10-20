// v3.384 [ModalTurn] 앱 루트 팝업은 한 번에 하나씩 — 애플 심사(10-20, iPad) "로그인 뒤 화면 전체가 반응 없음" 대응.
// iOS 는 앱 루트(App.tsx)에 나란히 놓인 RN Modal 을 동시에 하나만 띄울 수 있다. 하나가 떠 있거나 닫히는 중에
// 다른 하나를 띄우면 그 팝업은 화면에 안 나오면서 '떠 있음' 상태로 굳고, 닫히는 쪽과 겹치면 빈 창이 화면을 덮을 수 있다.
// 로그인 직후에는 로그인 창 닫힘·가입 마무리·출석·처리방침 재동의·추적 허용(ATT)·⭐ 안내가 한꺼번에 몰린다.
//  · 떠 있는 루트 모달은 useRootModalOpen 으로 등록(사용자가 직접 연 창·다이얼로그 — 기다리지 않음)
//  · 자동으로 뜨는 팝업은 차례(waitModalTurn / useModalTurn)를 받아서 띄운다 — 떠 있는 창이 없고 마지막 닫힘에서 GAP 지난 뒤,
//    우선순위 높은 것부터 하나씩.
//  · 다이얼로그(showAlert)는 전체 화면 창 안에서 띄워야 iOS 에서 보인다 — useDialogOwner(AppDialogHost nested) 참고.
import { useEffect, useState, useSyncExternalStore } from 'react';

/** 닫힘 애니메이션(fade·slide ≈ 0.3초) + 여유 */
export const MODAL_GAP_MS = 600;
/** 차례를 받은 팝업이 실제로 뜰(등록될) 때까지 다음 차례를 묶어 두는 시간 */
const RESERVE_MS = 1200;

const openKeys = new Set<string>();
let lastChangeAt = 0;
let reservedUntil = 0;
let seq = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

interface Waiter {
  key: string;
  priority: number;
  seq: number;
  since: number;
  maxWaitMs: number;
  grant: () => void;
}
const waiters: Waiter[] = [];

function schedule(ms: number) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(pump, Math.max(0, ms));
}

function pump() {
  timer = null;
  if (!waiters.length) return;
  const now = Date.now();
  waiters.sort((a, b) => b.priority - a.priority || a.seq - b.seq);
  // 꼭 떠야 하는 창(가입 마무리 등)은 다른 창이 굳어 있어도 maxWait 뒤엔 띄운다(영영 안 뜨는 것 방지)
  const overdue = waiters.find((w) => w.maxWaitMs > 0 && now - w.since >= w.maxWaitMs);
  if (!overdue) {
    const limits = waiters.filter((w) => w.maxWaitMs > 0).map((w) => w.since + w.maxWaitMs - now);
    if (openKeys.size > 0) {
      if (limits.length) schedule(Math.min(...limits));
      return; // 닫힐 때 setRootModalOpen 이 다시 깨운다
    }
    const readyAt = Math.max(lastChangeAt + MODAL_GAP_MS, reservedUntil);
    if (now < readyAt) {
      schedule(Math.min(readyAt - now, ...limits));
      return;
    }
  }
  const w = overdue ?? waiters[0];
  waiters.splice(waiters.indexOf(w), 1);
  if (overdue) console.warn('[ModalTurn] 대기 한도 초과 — 띄움', { key: w.key, open: [...openKeys] });
  reservedUntil = now + RESERVE_MS;
  w.grant();
  if (waiters.length) schedule(RESERVE_MS);
}

/** 루트 모달 표시 상태 등록 — 떠 있는 동안 자동 팝업은 차례를 기다린다 */
export function setRootModalOpen(key: string, isOpen: boolean): void {
  if (openKeys.has(key) === isOpen) return;
  if (isOpen) {
    openKeys.add(key);
    reservedUntil = 0; // 차례 받은 창이 떴다 — 이제 이 창이 닫힐 때까지 기다리면 된다
  } else {
    openKeys.delete(key);
  }
  lastChangeAt = Date.now();
  if (!isOpen && waiters.length) schedule(MODAL_GAP_MS);
}

/** 화면 전환(모달 화면 닫힘 등)이 막 일어났다 — 다음 팝업은 GAP 뒤에 */
export function noteModalTransition(): void {
  lastChangeAt = Date.now();
  if (waiters.length) schedule(MODAL_GAP_MS);
}

export interface ModalTurnTicket {
  promise: Promise<void>;
  cancel: () => void;
}

/**
 * 자동 팝업 차례 기다리기. promise 가 풀리면 바로 띄운다(띄운 창은 useRootModalOpen 으로 등록되어 다음 차례를 막는다).
 * @param maxWaitMs 0 이면 무한 대기. 가입 마무리처럼 반드시 떠야 하는 창만 한도를 둔다.
 */
export function waitModalTurn(key: string, priority = 0, maxWaitMs = 0): ModalTurnTicket {
  let w: Waiter | null = null;
  const promise = new Promise<void>((resolve) => {
    w = { key, priority, seq: ++seq, since: Date.now(), maxWaitMs, grant: resolve };
    waiters.push(w);
  });
  schedule(0);
  return {
    promise,
    cancel: () => {
      const i = w ? waiters.indexOf(w) : -1;
      if (i >= 0) waiters.splice(i, 1);
    },
  };
}

/** 표시 중인 동안 등록 */
export function useRootModalOpen(key: string, isOpen: boolean): void {
  useEffect(() => {
    setRootModalOpen(key, isOpen);
    return () => setRootModalOpen(key, false);
  }, [key, isOpen]);
}

/** want 가 켜지면 차례를 기다렸다가 true(표시 중 유지) — want 가 꺼지면 바로 false */
export function useModalTurn(key: string, want: boolean, priority = 0, maxWaitMs = 0): boolean {
  const [granted, setGranted] = useState(false);
  useEffect(() => {
    if (!want) {
      setGranted(false);
      return undefined;
    }
    let alive = true;
    const t = waitModalTurn(key, priority, maxWaitMs);
    t.promise.then(() => {
      if (alive) setGranted(true);
    });
    return () => {
      alive = false;
      t.cancel();
    };
  }, [key, want, priority, maxWaitMs]);
  const shown = want && granted;
  useRootModalOpen(key, shown);
  return shown;
}

// ── 다이얼로그(showAlert) 띄울 곳 ───────────────────────────────────────────
// 전체 화면 창(로그인·가입 마무리·계정 통합·재동의)이 떠 있으면 그 창 안의 AppDialogHost(nested)가 다이얼로그를 띄운다
// (iOS 는 창 안에 넣은 Modal 만 그 창 위에 겹쳐 뜬다). 떠 있는 창이 없을 때만 루트 AppDialogHost 가 띄운다.
let hostStack: string[] = [];
const hostListeners = new Set<() => void>();
const emitHosts = () => hostListeners.forEach((l) => l());
const subscribeHosts = (l: () => void) => {
  hostListeners.add(l);
  return () => {
    hostListeners.delete(l);
  };
};
const topHost = () => hostStack[hostStack.length - 1] ?? null;

function registerDialogHost(id: string): () => void {
  hostStack = [...hostStack.filter((h) => h !== id), id];
  emitHosts();
  return () => {
    hostStack = hostStack.filter((h) => h !== id);
    emitHosts();
  };
}

/**
 * 이 AppDialogHost 가 지금 다이얼로그를 띄울 차례인가 — nested 는 그 창이 떠 있고(active) 맨 위일 때,
 * 루트는 창이 하나도 없을 때(마지막 창이 내려가고 GAP 뒤). 닫히는 중인 창(active=false)에는 띄우지 않는다.
 */
export function useDialogOwner(nestedId: string | null, active = true): boolean {
  const registered = nestedId && active ? nestedId : null;
  useEffect(() => (registered ? registerDialogHost(registered) : undefined), [registered]);
  const top = useSyncExternalStore(subscribeHosts, topHost, topHost);
  const rootFree = top === null;
  const [rootReady, setRootReady] = useState(rootFree);
  useEffect(() => {
    if (nestedId) return undefined;
    if (!rootFree) {
      setRootReady(false);
      return undefined;
    }
    const t = setTimeout(() => setRootReady(true), MODAL_GAP_MS);
    return () => clearTimeout(t);
  }, [nestedId, rootFree]);
  if (nestedId) return !!registered && top === registered;
  return rootFree && rootReady;
}
