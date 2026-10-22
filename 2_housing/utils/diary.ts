// v3.389 [Diary] 피드 → 일기장(대표 확정 10-21) 공용 상수·헬퍼.
// 서버 계약(routes/feeds.py [Diary]): kind='feed' 글 = 일기. visibility 'public'|'followers'|'private',
// mood 8키, diary_date 'YYYY-MM-DD'(KST, 오늘~6일 전), 보상 = 하루 1번 +3⭐(공백 뺀 50자↑·서로 다른 글자 10↑).

export type DiaryVisibility = 'public' | 'followers' | 'private';

export const DIARY_REWARD = 3;
export const DIARY_MIN_CHARS = 50;
const DIARY_MIN_DISTINCT = 10;
export const DIARY_BACKDATE_DAYS = 7;
// v3.396(대표 10-22): '이 낙서로 노래 만들기' 카드는 숨김 — 별도 세션이 '일기·사진으로 노래 만들기' 새 파이프라인을
// 설계한 뒤 이 자리(시안 v1 ④A)에 연결한다. 켜면 v3.395 makeLike 배선(startDiarySongFlow)이 그대로 동작.
export const DIARY_SONG_ENABLED = false;

export const DIARY_MOODS: { key: string; emoji: string; label: string }[] = [
  { key: 'good', emoji: '😊', label: '좋음' },
  { key: 'flutter', emoji: '🥰', label: '설렘' },
  { key: 'excited', emoji: '🎵', label: '신남' },
  { key: 'calm', emoji: '😌', label: '평온' },
  { key: 'meh', emoji: '😐', label: '그냥' },
  { key: 'sad', emoji: '😢', label: '슬픔' },
  { key: 'angry', emoji: '😡', label: '화남' },
  { key: 'tired', emoji: '😴', label: '피곤' },
];

export const moodOf = (key?: string | null) => DIARY_MOODS.find((m) => m.key === key) || null;

export const VISIBILITY_OPTIONS: { key: DiaryVisibility; label: string; hint: string }[] = [
  { key: 'public', label: '전체', hint: '[전체]에 올라가고 팔로워에게 알림이 가요.' },
  { key: 'followers', label: '팔로워만', hint: '나를 팔로우한 사람만 볼 수 있어요.' },
  { key: 'private', label: '나만 보기', hint: '나만 볼 수 있어요. 스타는 똑같이 받아요.' },
];

// 글의 공개 범위 — 서버 visibility 우선, 구서버 응답은 is_public 으로
export const visibilityOf = (feed: any): DiaryVisibility => {
  const v = feed?.visibility;
  if (v === 'public' || v === 'followers' || v === 'private') return v;
  return feed?.is_public === false ? 'private' : 'public';
};

// 보상 글자 수 — 서버와 같은 규칙(공백·줄바꿈 제외)
export const diaryCharCount = (text: string): number => (text || '').replace(/\s/g, '').length;
export const diaryRewardEligible = (text: string): boolean => {
  const compact = (text || '').replace(/\s/g, '');
  return compact.length >= DIARY_MIN_CHARS && new Set(Array.from(compact)).size >= DIARY_MIN_DISTINCT;
};

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

// KST 오늘 'YYYY-MM-DD' (기기 시간대와 무관)
export const kstToday = (offsetDays = 0): string => {
  const d = new Date(Date.now() + 9 * 3600 * 1000 - offsetDays * 86400 * 1000);
  return d.toISOString().slice(0, 10);
};

const parts = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map((x) => parseInt(x, 10));
  return { y, m, d, wd: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
};

// '2026-10-21' → '2026.10.21 화'
export const fmtDiaryDate = (ymd?: string | null): string => {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return '';
  const { y, m, d, wd } = parts(ymd);
  return `${y}.${String(m).padStart(2, '0')}.${String(d).padStart(2, '0')} ${WEEKDAYS[wd]}`;
};

// '2026-10-18' → '10월 18일 토요일'
export const fmtDiaryDateLong = (ymd: string): string => {
  const { m, d, wd } = parts(ymd);
  return `${m}월 ${d}일 ${WEEKDAYS[wd]}요일`;
};

// 쓰기 화면 날짜 칩 — 오늘·어제·그 외 'M.D'
export const backdateOptions = (): { ymd: string; label: string }[] =>
  Array.from({ length: DIARY_BACKDATE_DAYS }, (_, i) => {
    const ymd = kstToday(i);
    const { m, d, wd } = parts(ymd);
    return { ymd, label: i === 0 ? '오늘' : i === 1 ? '어제' : `${m}.${d} ${WEEKDAYS[wd]}` };
  });

// 달력 칸 — 해당 달 1일 앞 빈칸 포함, 7의 배수로 채움(null = 빈칸)
export const monthCells = (month: string): (string | null)[] => {
  const [y, m] = month.split('-').map((x) => parseInt(x, 10));
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = Array(first).fill(null);
  for (let d = 1; d <= days; d++) cells.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  while (cells.length % 7) cells.push(null);
  return cells;
};

export const shiftMonth = (month: string, delta: number): string => {
  const [y, m] = month.split('-').map((x) => parseInt(x, 10));
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
};
