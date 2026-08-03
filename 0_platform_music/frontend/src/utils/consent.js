// v125 — 동의 상태 공용 헬퍼 (컴포넌트 파일과 분리 — react-refresh 규칙 준수).
// 주의: 로그에는 key 와 agreed bool 만 남긴다.
import { CONSENTS } from '../constants/consentTexts';
import * as api from '../api';

// 필수 항목(CONSENTS[key].required)이 모두 체크됐는지 판단 — 가입/온보딩 버튼 활성화 판정용.
export function areRequiredConsentsChecked(values, keys) {
  return (keys || [])
    .filter((k) => CONSENTS[k]?.required)
    .every((k) => !!values?.[k]);
}

// 세션(모듈) 내 동의 캐시 — 기능 시점 게이트(photo_ai/voice_ai) 재확인/재팝업 방지.
const agreedCache = new Set();

// 동기 캐시 조회 — true 면 서버 확인 없이 바로 진행 가능(파일 선택 등 사용자 제스처 유지).
export function hasConsentCached(key) {
  return agreedCache.has(key);
}

// 동의 기록 성공 시 캐시 적재 (ConsentGateModal 이 호출)
export function markConsentAgreed(key) {
  agreedCache.add(key);
}

// 서버 최신 상태 확인(캐시 우선). 동의 상태면 캐시에 적재 후 true.
// API 실패는 throw — 호출측에서 모달 표시(안전측)로 폴백할 것.
export async function checkConsent(key) {
  if (agreedCache.has(key)) return true;
  const { data } = await api.getMyConsents();
  const agreed = !!data?.consents?.[key]?.agreed;
  if (agreed) agreedCache.add(key);
  if (import.meta.env.DEV) console.info('[ConsentGate] check', { key, agreed });
  return agreed;
}
