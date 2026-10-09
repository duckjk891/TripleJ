// v3.230 A6 [Chart] 차트 기준 안내 문구 — 서버 routes/charts.py 구현과 1:1로 맞춘다.
// v3.313(대표 확정 2026-10-09): 전 차트(TOP100 누적·일간·주간·월간) = 재생수 순. 재생 = 곡 70% 이상 재생 1회
// (services/playRecord.ts), 1계정(비로그인은 IP 해시)·1곡·KST 하루 1회, 본인 곡 포함, 다운로드·좋아요 미반영.
// 빈 차트 폴백 = (일/주/월간) 총 재생수. 문구 규칙: 과장 금지, 외부 차트 서비스 명칭 금지, 이모지 금지.

export type ChartCriteriaTab = 'top100' | 'daily' | 'weekly' | 'monthly';

// v3.313 (대표 10-09): 전 차트 공통 — 재생수 순, 1계정·1곡·하루 1회(본인 포함), 다운로드 비중 없음
const COMMON_LINES = [
  '· 곡을 70% 이상 들으면 재생 1회로 세요.',
  '· 같은 사람이 같은 곡을 하루에 여러 번 들어도 하루 1회예요. (로그인하지 않은 경우 같은 기기 기준)',
  '· 내 곡을 내가 들은 것도 하루 1회는 세요.',
  '· 재생수가 같으면 들은 사람 수가 많은 곡이 위예요.',
];

const PERIOD_LABEL: Record<Exclude<ChartCriteriaTab, 'top100'>, string> = {
  daily: '오늘(0시부터)',
  weekly: '이번 주(월요일 0시부터)',
  monthly: '이번 달(1일 0시부터)',
};

export function chartCriteriaText(tab: ChartCriteriaTab): { title: string; message: string } {
  if (tab === 'top100') {
    return {
      title: 'TOP 100 차트 기준',
      message: [
        '순위 = 재생수 (곡 옆 재생 아이콘 숫자)',
        '· 지금까지 쌓인 전체 기록(누적)으로 순위를 정해요.',
        ...COMMON_LINES,
      ].join('\n'),
    };
  }
  return {
    title: `${tab === 'daily' ? '일간' : tab === 'weekly' ? '주간' : '월간'} 차트 기준`,
    message: [
      '순위 = 재생수 (곡 옆 재생 아이콘 숫자)',
      `· ${PERIOD_LABEL[tab]} 모인 재생으로 순위를 정해요.`,
      ...COMMON_LINES,
      '',
      '아직 집계된 재생이 없을 때는 전체 재생수 순으로 임시로 보여드려요.',
    ].join('\n'),
  };
}

export const isChartCriteriaTab = (tab: string): tab is ChartCriteriaTab =>
  tab === 'top100' || tab === 'daily' || tab === 'weekly' || tab === 'monthly';
