import { useCallback, useEffect, useRef } from 'react';
import { BackHandler, Platform } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { showAlert } from '../utils/appAlert';

/**
 * v3.230 A1-1 [LeaveGuard] 생성 진행 화면 이탈 가드(대표 결정 D1 — 아티스트·작곡·작사·Inst 4곳).
 *
 * - 진행 중(active=true)에 사용자가 화면을 빠져나가려 하면(헤더 ←·Android 뒤로·Studio 탭 재탭·웹 ←
 *   가운데 React Navigation 액션으로 오는 것) 앱 내 다이얼로그로 [계속 기다리기]/[나가기]를 묻는다.
 * - 원칙 문구 "작업이 끝날 때까지 이 화면을 벗어나지 마세요"는 그대로 — 가드는 사용자가 이미
 *   나가려 할 때만 뜬다(이탈 권장 버튼·문구를 화면에 추가하지 않는다).
 * - 코드가 일으키는 이동(성공 후 replace·reset, 실패 후 goBack 등)은 막지 않는다:
 *   · REPLACE·RESET 액션은 항상 통과
 *   · 그 밖의 코드 이동(goBack·navigate·popTo) 직전에는 호출부가 allowLeave()를 부른다
 * - Android 하드웨어 뒤로가기는 포커스된 동안 BackHandler로 먼저 받아 같은 다이얼로그를 띄운다
 *   (스택 루트라 goBack할 곳이 없어도 앱이 닫히지 않게).
 * - 한계(기록): 웹 브라우저 뒤로가기는 URL이 먼저 바뀌고 linking이 상태를 되돌리는 경로라
 *   beforeRemove가 오지 않을 수 있다 — 그 경우에도 접수된 작업은 전역 추적기가 회수한다.
 */
export type LeaveGuardOptions = {
  /** 로그 prefix용 화면 이름(예: 'ArtistLoading') */
  screen: string;
  /** 지금 가드가 필요한지(진행 중) */
  active: boolean;
  /** 다이얼로그 본문 — 미지정 시 기본 문구 */
  message?: string;
  /** [나가기]를 눌러 실제로 떠나기 직전 호출(로그·상태 정리) */
  onLeave?: () => void;
};

export const LEAVE_GUARD_TITLE = '아직 만드는 중이에요';
// 원칙 문구 유지 + 사실 안내만(이탈 권장 문구 금지 — D1)
export const LEAVE_GUARD_DEFAULT_BODY =
  '작업이 끝날 때까지 이 화면을 벗어나지 마세요.\n이미 접수된 작업은 완성되면 작업실에서 알려드려요.';

/** 코드 발 이동으로 보고 항상 통과시키는 액션 */
const PASS_THROUGH_ACTIONS = new Set(['REPLACE', 'RESET']);

export function useGenerationLeaveGuard(navigation: any, opts: LeaveGuardOptions) {
  const activeRef = useRef(opts.active);
  activeRef.current = opts.active;
  const optsRef = useRef(opts);
  optsRef.current = opts;
  /** 코드가 이동을 시작했음 — 이후 beforeRemove는 통과 */
  const bypassRef = useRef(false);
  /** 가드 다이얼로그가 떠 있는 중(중복 표시 방지) */
  const promptingRef = useRef(false);
  /** 다이얼로그가 닫히길 기다리는 쪽(아티스트 POST 직전 대기) */
  const waitersRef = useRef<Array<() => void>>([]);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // 화면이 사라지면 대기 중인 쪽을 풀어준다(호출부는 cancelled로 판단)
      const ws = waitersRef.current;
      waitersRef.current = [];
      ws.forEach((w) => w());
    };
  }, []);

  const releaseWaiters = useCallback(() => {
    const ws = waitersRef.current;
    waitersRef.current = [];
    ws.forEach((w) => w());
  }, []);

  /** 가드 다이얼로그가 떠 있으면 사용자가 고를 때까지 기다린다(없으면 즉시) */
  const waitWhilePrompting = useCallback((): Promise<void> => {
    if (!promptingRef.current) return Promise.resolve();
    console.info(`[LeaveGuard] ${optsRef.current.screen} 확인 대기 — 요청 보류`);
    return new Promise<void>((resolve) => {
      waitersRef.current.push(resolve);
    });
  }, []);

  const allowLeave = useCallback(() => {
    bypassRef.current = true;
  }, []);

  const prompt = useCallback((trigger: string, proceed: () => void) => {
    const { screen } = optsRef.current;
    if (promptingRef.current) {
      console.info(`[LeaveGuard] ${screen} 이미 확인 중 — 입력 무시`, { trigger });
      return;
    }
    promptingRef.current = true;
    console.info(`[LeaveGuard] prompt action=${trigger} screen=${screen}`);
    showAlert(LEAVE_GUARD_TITLE, optsRef.current.message ?? LEAVE_GUARD_DEFAULT_BODY, [
      {
        text: '계속 기다리기',
        style: 'cancel',
        onPress: () => {
          promptingRef.current = false;
          console.info(`[LeaveGuard] ${screen} 계속 기다리기`, { trigger });
          releaseWaiters();
        },
      },
      {
        text: '나가기',
        onPress: () => {
          promptingRef.current = false;
          if (!mountedRef.current) {
            // 확인하는 사이 코드가 이미 화면을 바꿨다(완성 → 결과 화면 등) — 옛 이동을 재생하지 않는다
            console.info(`[LeaveGuard] ${screen} 나가기 — 이미 화면 전환됨, 이동 생략`, { trigger });
            releaseWaiters();
            return;
          }
          // 확인하는 사이 작업이 끝나 가드가 풀렸어도 사용자가 고른 이동은 그대로 수행
          console.info(`[LeaveGuard] ${screen} 나가기`, { trigger, stillActive: activeRef.current });
          bypassRef.current = true;
          try {
            optsRef.current.onLeave?.();
          } catch (err: any) {
            console.error(`[LeaveGuard] ${screen} onLeave 오류`, { message: err?.message });
          }
          try {
            proceed();
          } catch (err: any) {
            console.error(`[LeaveGuard] ${screen} 이동 실패`, { trigger, message: err?.message });
          }
          releaseWaiters();
        },
      },
    ]);
  }, [releaseWaiters]);

  // 스택 이탈(헤더 ←·탭 재탭·goBack/popTo 등) — beforeRemove
  useEffect(() => {
    if (!navigation?.addListener) return undefined;
    const unsub = navigation.addListener('beforeRemove', (e: any) => {
      const actionType: string = e?.data?.action?.type ?? '';
      if (!activeRef.current || bypassRef.current || PASS_THROUGH_ACTIONS.has(actionType)) return;
      e.preventDefault();
      prompt(`nav:${actionType || 'unknown'}`, () => navigation.dispatch(e.data.action));
    });
    return unsub;
  }, [navigation, prompt]);

  // Android 하드웨어 뒤로가기 — 포커스된 동안만
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return undefined;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (!activeRef.current || bypassRef.current) return false; // 기본 동작(스택 goBack)
        prompt('android-back', () => {
          if (navigation.canGoBack?.()) navigation.goBack();
          else navigation.navigate?.('Map');
        });
        return true;
      });
      return () => sub.remove();
    }, [navigation, prompt])
  );

  return { allowLeave, waitWhilePrompting };
}
