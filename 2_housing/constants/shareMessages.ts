// [ShareCompose] v3.237 곡 공유 문구 — 내장 기본 설정(서버 `app/constants/share_messages_default.json` 과 같은 내용).
//  · 정본은 서버 설정(Mongo share_message_config / GET /api/share/track/{id}). 이 파일은 서버 실패·구서버·설정 없음 폴백.
//  · SHARE_MESSAGES_DEFAULT 는 서버 JSON 과 키·문구가 같아야 한다(T4 비교 스크립트) — 문구를 바꿀 땐 양쪽 함께.
//  · 문구 안의 이모지는 요청서 원문(공유 본문 = 사용자 콘텐츠·외부 발송). 칩 표기 = label 그대로 — label 에 요청서
//    대표 이모지 포함(v3.237 D4 대표 변경 — 요청서 4-2 예시 표기: "🐱 집사 공감"·"🎵 기본"·"💌 바치는 노래",
//    테마 B안은 "짧게" — 한 화면엔 테마 1종 + default A + 바치는 노래만 나와 중복 없음, default 만일 땐 기본/짧게). 서버가 emoji 를 따로 주면 앞에 붙인다.
//  · body = 내 곡용, body_other = 남의 곡용(1인칭 제작 주장 제거판 — planner 초안, 대표 검수 대상, D5). body_other 가
//    없는 안은 남의 곡 공유에서 숨긴다.
//  · 치환 변수: {곡명} {아티스트} {링크} {theme} {받는 사람} — utils/shareMessage.ts renderTemplate.

export type ShareTemplateKind = 'normal' | 'dedication';

export interface ShareThemeConfig {
  key: string;
  name: string;
  /** 작을수록 먼저 판정(서버 자동 분류용 — 앱은 표시명만 사용) */
  priority: number;
  keywords: string[];
}

export interface ShareTemplateConfig {
  id: string;
  /** 'default' | 테마 key | '*'(모든 곡 — 바치는 노래) */
  theme: string;
  kind: ShareTemplateKind;
  /** 칩 이모지(선택 — 기본 설정은 label 에 이모지 포함이라 미사용). 있으면 칩 표기 = `${emoji} ${label}` */
  emoji?: string;
  /** 칩 라벨(요청서 대표 이모지 포함, D4 변경) */
  label: string;
  order: number;
  enabled: boolean;
  body: string;
  body_other?: string;
}

export interface ShareLimits {
  body: number;
  recipient: number;
  head_title: number;
}

export interface ShareMessageConfig {
  version: number;
  themes: ShareThemeConfig[];
  templates: ShareTemplateConfig[];
  benefit: { text: string };
  og_description: string;
  limits: ShareLimits;
  recipient_default: string;
}

export const SHARE_MESSAGES_DEFAULT: ShareMessageConfig = {
  version: 1,
  themes: [
    { key: 'cat', name: '냥이', priority: 1, keywords: ['고양이', '냥이', '냥냥', '집사', '반려묘', '야옹', '츄르', 'kitten', 'kitty'] },
    { key: 'family', name: '가족', priority: 2, keywords: ['가족', '엄마', '아빠', '부모', '어머니', '아버지', '환갑', '칠순', '팔순', '생신', '효도', '어버이', '할머니', '할아버지', 'family'] },
    { key: 'team', name: '팀', priority: 3, keywords: ['우리 팀', '팀워크', '팀 응원', '응원단', '동아리', '팀원', '구단', '우승', '치어', 'team'] },
    { key: 'youth', name: '청춘', priority: 4, keywords: ['청춘', '청년', '학교', '방학', '시험', '수능', '학생', '교실', '급식', '학원', '취준', 'youth', '스무살', '단짝'] },
  ],
  templates: [
    {
      id: 'default_a', theme: 'default', kind: 'normal', label: '🎵 기본', order: 1, enabled: true,
      body: '🎵 이런 날엔 이런 노래 어때요?\n「{곡명}」 - {아티스트}\n제 이야기로 MAIDOL에서 직접 만든 곡이에요.\n듣다 보면… 나도 만들어볼까? 😆',
      body_other: '🎵 이런 날엔 이런 노래 어때요?\n「{곡명}」 - {아티스트}\n누군가의 이야기로 MAIDOL에서 만든 곡이에요.\n듣다 보면… 나도 만들어볼까? 😆',
    },
    {
      id: 'default_b', theme: 'default', kind: 'normal', label: '🎵 짧게', order: 2, enabled: true,
      body: '🎵 내 이야기로 만든 노래예요\n「{곡명}」 - {아티스트}\n1분이면 나만의 곡 완성!',
      body_other: '🎵 누군가의 이야기로 만든 노래예요\n「{곡명}」 - {아티스트}\n1분이면 나만의 곡 완성!',
    },
    {
      id: 'cat_a', theme: 'cat', kind: 'normal', label: '🐱 집사 공감', order: 1, enabled: true,
      body: '🐱 집사님들, 이 노래 우리 애 얘기 아닌가요?\n「{곡명}」 - {아티스트}\n우리 냥이 테마곡 만들어봤어요 😻\n조심하세요, 플리에 냥이 노래만 가득해져요\n우리 애 노래도 만들 수 있다고?',
      body_other: '🐱 집사님들, 이 노래 우리 애 얘기 아닌가요?\n「{곡명}」 - {아티스트}\n어느 집사님이 만든 냥이 테마곡이에요 😻\n조심하세요, 플리에 냥이 노래만 가득해져요\n우리 애 노래도 만들 수 있다고?',
    },
    {
      id: 'cat_b', theme: 'cat', kind: 'normal', label: '😻 짧게', order: 2, enabled: true,
      body: '😻 우리 냥이 테마곡 나왔어요\n「{곡명}」 - {아티스트}\n집사라면 하나쯤 있어야죠!',
      body_other: '😻 냥이 테마곡 발견했어요\n「{곡명}」 - {아티스트}\n집사라면 하나쯤 있어야죠!',
    },
    {
      id: 'family_a', theme: 'family', kind: 'normal', label: '🎉 선물', order: 1, enabled: true,
      body: '🎉 꽃다발 대신 노래 한 곡, 어때요?\n「{곡명}」 - {아티스트}\n부모님 환갑에 드린 세상에 하나뿐인 노래예요.\n우리 집 이야기로 직접 만들 수 있어요 🎵',
      body_other: '🎉 꽃다발 대신 노래 한 곡, 어때요?\n「{곡명}」 - {아티스트}\n가족 이야기로 만든 세상에 하나뿐인 노래예요.\n우리 집 이야기로도 직접 만들 수 있어요 🎵',
    },
    {
      id: 'family_b', theme: 'family', kind: 'normal', label: '💐 짧게', order: 2, enabled: true,
      body: '💐 우리 가족 이야기가 노래가 됐어요\n「{곡명}」 - {아티스트}\n세상에 하나뿐인 선물 🎵',
      body_other: '💐 어느 가족의 이야기가 노래가 됐어요\n「{곡명}」 - {아티스트}\n세상에 하나뿐인 선물 🎵',
    },
    {
      id: 'youth_a', theme: 'youth', kind: 'normal', label: '😮‍💨 공감', order: 1, enabled: true,
      body: '😮‍💨 요즘 우리 얘기, 노래로 만들어봤어요\n「{곡명}」 - {아티스트}\n듣다 보면 "어? 이거 완전 내 얘긴데?"\n나도 내 이야기로 한 곡?',
      body_other: '😮‍💨 요즘 우리 얘기 같은 노래 발견했어요\n「{곡명}」 - {아티스트}\n듣다 보면 "어? 이거 완전 내 얘긴데?"\n나도 내 이야기로 한 곡?',
    },
    {
      id: 'youth_b', theme: 'youth', kind: 'normal', label: '🎧 짧게', order: 2, enabled: true,
      body: '🎧 오늘 내 기분, 노래로 만들었어요\n「{곡명}」 - {아티스트}\n내 얘기로도 한 곡 가능!',
      body_other: '🎧 오늘 내 기분 같은 노래예요\n「{곡명}」 - {아티스트}\n내 얘기로도 한 곡 가능!',
    },
    {
      id: 'team_a', theme: 'team', kind: 'normal', label: '🙌 응원가', order: 1, enabled: true,
      body: '🙌 우리 팀 응원가 나왔습니다!\n「{곡명}」 - {아티스트}\n다른 팀도 하나쯤 있어야 하지 않아요? 😎\n1분이면 우리 팀 노래 완성',
      body_other: '🙌 이 팀 응원가 들어보세요!\n「{곡명}」 - {아티스트}\n우리 팀도 하나쯤 있어야 하지 않아요? 😎\n1분이면 우리 팀 노래 완성',
    },
    {
      id: 'team_b', theme: 'team', kind: 'normal', label: '📣 짧게', order: 2, enabled: true,
      body: '📣 우리 팀 노래 완성!\n「{곡명}」 - {아티스트}\n다 같이 들어요 🙌',
      body_other: '📣 팀 노래 한 곡 소개해요!\n「{곡명}」 - {아티스트}\n다 같이 들어요 🙌',
    },
    {
      id: 'dedication', theme: '*', kind: 'dedication', label: '💌 바치는 노래', order: 1, enabled: true,
      body: '💌 {받는 사람}에게 바치는 노래\n「{곡명}」 - {아티스트}\n{받는 사람} 생각하면서 직접 만들었어요.\n세상에 하나뿐인 노래, 들어줄래요? 🎵',
      body_other: '💌 {받는 사람}에게 바치는 노래\n「{곡명}」 - {아티스트}\n{받는 사람} 생각하면서 골랐어요.\n세상에 하나뿐인 노래, 들어줄래요? 🎵',
    },
  ],
  benefit: { text: '베타 테스트 기간 가입 시 ⭐{amount} 추가 증정!' },
  og_description: '이런 날엔 이런 노래 🎵 탭하면 재생 · 나도 1분 만에 만들기',
  limits: { body: 200, recipient: 20, head_title: 40 },
  recipient_default: '소중한 당신',
};

/** 앱 오프라인 폴백 전용 — 베타 가입 혜택(서버 auth.py BETA_SIGNUP_BONUS_AMOUNT·BETA_SIGNUP_BONUS_UNTIL_KST 와 같은 값).
 *  종료일(KST) 당일까지 표시, 2026-10-31 00:00 KST 부터 혜택 줄 제거(D3). 연장 시 서버 상수와 함께 수정. */
export const SHARE_BENEFIT_FALLBACK = { amount: 50, untilKst: '2026-10-30' } as const;
