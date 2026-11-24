// [chatDate] v3.434 채팅 날짜 구분선(지유님 의견 11-20) — 기기 현지 날짜 기준. Intl 없이(Hermes) 직접 조립.
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** 앞 메시지와 날짜가 다른가(첫 메시지 = true). 날짜를 못 읽는 메시지에는 구분선을 두지 않는다 */
export function startsNewDay(cur: Date, prev?: Date | null): boolean {
  if (Number.isNaN(cur.getTime())) return false;
  return !prev || Number.isNaN(prev.getTime()) || !sameDay(cur, prev);
}

/** '2026년 11월 20일 금요일' — 오늘·어제는 앞에 표기 */
export function chatDayLabel(d: Date, now: Date = new Date()): string {
  const full = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEKDAYS[d.getDay()]}요일`;
  if (sameDay(d, now)) return `오늘 · ${full}`;
  if (sameDay(d, new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) return `어제 · ${full}`;
  return full;
}
