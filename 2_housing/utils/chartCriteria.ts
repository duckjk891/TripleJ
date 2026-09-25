// v3.230 A6 [Chart] 차트 기준 안내 문구 — 서버 S2(routes/charts.py, 대표 결정 D5) 구현과 1:1로 맞춘다.
// 서버 규칙: 점수 = 순 청취자 ×0.4 + 순 다운로더 ×0.6(로그인 사용자만, 기간별 1인 1회) · 순 청취자 = 곡 70%
// 이상 재생 시 1회 기록(services/playRecord.ts) · TOP100 = 롤링 최근 24시간 50% + 최근 1시간 50%,
// 01:00~07:59 는 최근 24시간만 · 본인 곡 재생·다운로드 제외 · 좋아요·총 재생수는 점수에 쓰지 않음 ·
// 빈 차트 폴백 = (TOP100) 주간 점수 → 총 재생수, (일/주/월간) 총 재생수.
// 문구 규칙: 과장 금지, 외부 차트 서비스 명칭 금지, 이모지 금지.

export type ChartCriteriaTab = 'top100' | 'daily' | 'weekly' | 'monthly';

const COMMON_LINES = [
  '· 순 청취자: 로그인한 사용자가 곡을 70% 이상 들으면 1인 1회로 세요.',
  '· 순 다운로더: 로그인한 사용자의 다운로드를 1인 1회로 세요.',
  '· 내 곡을 내가 재생하거나 다운로드한 것은 순위에 반영되지 않아요.',
  '· 좋아요 수와 총 재생수는 순위에 반영되지 않아요.',
];

const PERIOD_LABEL: Record<Exclude<ChartCriteriaTab, 'top100'>, string> = {
  daily: '오늘',
  weekly: '이번 주',
  monthly: '이번 달',
};

export function chartCriteriaText(tab: ChartCriteriaTab): { title: string; message: string } {
  if (tab === 'top100') {
    return {
      title: 'TOP 100 차트 기준',
      message: [
        '점수 = 순 청취자 40% + 순 다운로더 60%',
        '· 최근 24시간 점수 50% + 최근 1시간 점수 50%로 순위를 정해요. 새벽 1시~8시 전에는 최근 24시간 점수만 써요.',
        ...COMMON_LINES,
        '',
        '집계된 기록이 없을 때는 이번 주 점수, 그래도 없으면 총 재생수 순으로 임시로 보여드려요.',
      ].join('\n'),
    };
  }
  return {
    title: `${tab === 'daily' ? '일간' : tab === 'weekly' ? '주간' : '월간'} 차트 기준`,
    message: [
      '점수 = 순 청취자 40% + 순 다운로더 60%',
      `· ${PERIOD_LABEL[tab]} 모인 기록으로 순위를 정해요.`,
      ...COMMON_LINES,
      '',
      '집계된 기록이 없을 때는 총 재생수 순으로 임시로 보여드려요.',
    ].join('\n'),
  };
}

export const isChartCriteriaTab = (tab: string): tab is ChartCriteriaTab =>
  tab === 'top100' || tab === 'daily' || tab === 'weekly' || tab === 'monthly';
