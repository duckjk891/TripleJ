// v3.400 [NakseoFont] 낙서장 본문 손글씨 — '나눔손글씨 중학생' 부분 글꼴(한글 2,350자, 이름 MAIDOL Nakseo, 0.9MB).
// 대표 확정 10-22(시안 3판 추천안). 라이선스·수정 내역: assets/fonts/MaidolNakseo_LICENSE.txt
// 낙서장 화면을 처음 열 때만 불러온다(앱 첫 로딩 무영향). 실패하면 기본 글꼴로 보인다.
import { useEffect, useState } from 'react';
import * as Font from 'expo-font';

export const NAKSEO_FONT = 'MaidolNakseo';

let loaded = false;
let loading: Promise<boolean> | null = null;

export function loadNakseoFont(): Promise<boolean> {
  if (loaded) return Promise.resolve(true);
  if (!loading) {
    loading = Font.loadAsync({ [NAKSEO_FONT]: require('../assets/fonts/MaidolNakseo-Regular.ttf') })
      .then(() => { loaded = true; return true; })
      .catch((err: any) => {
        console.error('[NakseoFont] 손글씨 글꼴 로드 실패(기본 글꼴로 표시)', { message: err?.message });
        loading = null;
        return false;
      });
  }
  return loading;
}

/** 손글씨 글꼴 이름(불러오기 전·실패 시 undefined → 기본 글꼴) */
export function useNakseoFont(): string | undefined {
  const [ready, setReady] = useState(loaded);
  useEffect(() => {
    if (ready) return;
    let alive = true;
    loadNakseoFont().then((ok) => { if (alive && ok) setReady(true); });
    return () => { alive = false; };
  }, [ready]);
  return ready ? NAKSEO_FONT : undefined;
}
