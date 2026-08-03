// 익명 클릭 기록용 anon id — localStorage 'aimu:anonId' 에 UUID 를 생성/재사용.
// 실패(사파리 프라이빗 모드 등 localStorage/crypto 불가) 시 null 반환 → 익명 기록 생략.
// 주의: anon_id 값 자체는 절대 콘솔에 출력하지 않는다(원격 로깅으로 서버에 남음).

const STORAGE_KEY = 'aimu:anonId';

export function getAnonId() {
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') {
      return null;
    }
    const id = crypto.randomUUID();
    window.localStorage.setItem(STORAGE_KEY, id);
    return id;
  } catch {
    return null;
  }
}
