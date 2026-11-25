// v3.442 [Winter] 겨울 디자인 기간 — 11월 25일 ~ 2월 말이면 자동으로 켜지고, 지나면 저절로 원래 디자인으로 돌아간다(대표 11-25).
export function isWinterSeason(now: Date = new Date()): boolean {
  const m = now.getMonth() + 1;
  return m === 12 || m === 1 || m === 2 || (m === 11 && now.getDate() >= 25);
}

/** 산타모자·조명 장식 — 11월 25일 ~ 12월 25일(크리스마스가 지나면 눈만 남는다) */
export function isXmasSeason(now: Date = new Date()): boolean {
  const m = now.getMonth() + 1;
  const d = now.getDate();
  return (m === 11 && d >= 25) || (m === 12 && d <= 25);
}
