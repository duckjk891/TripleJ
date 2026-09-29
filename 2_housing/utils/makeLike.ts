// v3.256 [MakeLike]: '이 곡 느낌으로 만들기' 공용 로직 — TrackActionSheet(⋯ 시트)와
// PlayerScreen v3.237 '나도 이런 곡 만들기'(공유 링크 CTA)의 창작 진입 배선이 이 파일에 모인다(중복 구현 금지).
//
// 정책(CEO 스펙):
// - 곡의 장르·분위기만 프리셋 — 제목·가사·주제는 비운다("느낌"만 가져온다).
// - 작사 디렉터(LyricsInput)로 직행(맵 미경유). 선답은 v3.219 draft 복원 메커니즘 재사용 —
//   화면이 draftStep/draftChat을 마운트 hydrate하므로 장르·분위기 질문이 자동 통과(선답 버블 탭 시 재선택 가능).
// - 서버 값이 선택지 목록(GENRE_OPTIONS/MOOD_OPTIONS)에 없으면 미지정 폴백 — 흐름은 정상 진행(1번 질문부터).
// - 진행 중 창작물(작사 draft·요청서·작곡 draft)이 있으면 덮어쓰기 전 확인 다이얼로그
//   [이어서 하기/새로 시작] (2026-09-07 사용자 생성물 보호 정책·v3.219 draft 관행).
import { showAlert } from './appAlert';
import { useLyricsStore, LyricsDraftChatMessage } from '../stores/lyricsStore';
import { useMusicStore } from '../stores/musicStore';
import {
  isLyricsDraftResumable,
  getResumableComposeDraft,
  getDirectorResumeTarget,
} from './directorResume';
import {
  GENRE_OPTIONS,
  MOOD_OPTIONS,
  GENRE_QUESTION,
  buildMoodQuestion,
  DUET_QUESTION,
} from './lyricsPrompt';

export interface MakeLikePreset {
  genre: string; // ''=미지정(폴백)
  mood: string;  // ''=미지정(폴백)
}

/** 시트·차트가 넘기는 곡 객체에서 쓰는 필드만 (RowTrack/ChartTrack/TrackData 구조적 호환) */
export interface MakeLikeTrackLike {
  id?: string | number;
  title?: string;
  genre?: string | string[] | null;
  mood?: string | string[] | null;
}

/**
 * 곡의 genre/mood → 작사 디렉터 선택지 프리셋.
 * 배열이면 첫 값, 옵션 목록에 없는 값은 ''(미지정) 폴백.
 * 대화 순서상 분위기(step 1)는 장르(step 0) 선답 이후에만 선답 가능 — 장르 폴백 시 분위기도 미지정
 * ("답변 버블 없는 숨은 store 값" 금지 — v3.202 H-⑤ 괴리 차단 원칙).
 */
export function resolveMakeLikePreset(track: MakeLikeTrackLike | null | undefined): MakeLikePreset {
  const pick = (v: unknown, options: string[]): string => {
    const first = Array.isArray(v) ? v[0] : v;
    const s = typeof first === 'string' ? first.trim() : '';
    return s && options.includes(s) ? s : '';
  };
  const genre = pick(track?.genre, GENRE_OPTIONS);
  const mood = genre ? pick(track?.mood, MOOD_OPTIONS) : '';
  return { genre, mood };
}

/** 진행 중 창작물 존재 여부 — 작사 draft·완성 가사(요청서 포함)·작곡 draft. 덮어쓰기 확인 게이트. */
export function hasCreationWorkInProgress(): boolean {
  const s = useLyricsStore.getState();
  return (
    isLyricsDraftResumable(s) ||
    !!s.generatedPrompt ||
    !!s.generatedLyrics ||
    !!getResumableComposeDraft()
  );
}

/**
 * 프리셋 반영 — lyricsStore 전체 초기화(제목·가사·주제·키워드 비움) 후
 * 장르·분위기를 v3.219 draft 대화(선답 버블)로 기록. 반환값 = 선답으로 도달한 step(0/1/2).
 */
export function applyMakeLikePreset(preset: MakeLikePreset): number {
  const s = useLyricsStore.getState();
  s.reset(); // "느낌"만 가져온다 — 이전 작업본·결과물 전부 비움(호출측이 덮어쓰기 확인 담당)
  if (!preset.genre) return 0; // 폴백: 프리셋 없이 1번 질문부터(흐름 정상 진행)
  s.setGenre(preset.genre);
  const chat: LyricsDraftChatMessage[] = [
    { type: 'director', text: GENRE_QUESTION },
    { type: 'user', text: preset.genre, step: 0 },
    { type: 'director', text: buildMoodQuestion(preset.genre) },
  ];
  let step = 1;
  if (preset.mood) {
    s.setMood(preset.mood);
    chat.push({ type: 'user', text: preset.mood, step: 1 });
    chat.push({ type: 'director', text: DUET_QUESTION });
    step = 2;
  }
  s.setDraftStep(step);
  s.setDraftChat(chat);
  // v3.229 관행: draft에는 창작 모드를 함께 저장(복귀 시 모드 선택 스킵) — 현재 sticky 모드 그대로
  s.setDraftCreationMode(useMusicStore.getState().creationMode);
  return step;
}

/** 작사 디렉터 직행 배선 — MainTabs 하위 어느 화면(차트·검색·마이페이지·피드·플레이리스트)에서든 동작.
 *  initial:false로 Map을 하부에 적재(뒤로가기 = Map, v3.222 InstLoading 관행).
 *  nonce는 이미 떠 있는 LyricsInput의 재수화 키(navigate가 params만 갱신·재마운트 없음). */
export function navigateToLyricsDirector(
  navigation: any,
  makeLike: { title?: string; nonce: string }
): void {
  navigation.navigate('MainTabs', {
    screen: 'Studio',
    params: { screen: 'LyricsInput', initial: false, params: { makeLike } },
  });
}

/** '이어서 하기' — 기존 보존본으로 이동(맵 바로 가기와 같은 directorResume 판정 재사용).
 *  작곡 draft가 있으면 작곡(더 진행된 단계) 우선, 없으면 작사 보존본, 그마저 없으면 Map. */
function resumeExistingWork(navigation: any): void {
  const target =
    (getResumableComposeDraft() ? getDirectorResumeTarget('composer') : null) ||
    getDirectorResumeTarget('lyricist');
  if (__DEV__) console.info('[MakeLike] 이어서 하기 →', target?.route || 'Map');
  navigation.navigate('MainTabs', {
    screen: 'Studio',
    params: target
      ? { screen: target.route, initial: false, params: target.params }
      : { screen: 'Map' },
  });
}

/**
 * 시트 '이 곡 느낌으로 만들기' 전체 흐름 — 로그인 게이트는 호출측(시트 requireLogin 관행)이 담당.
 * 진행 중 작업이 있으면 확인 다이얼로그(showAlert — 앱 내 다이얼로그 규칙) 후 분기.
 */
export function startMakeLikeFlow(navigation: any, track: MakeLikeTrackLike): void {
  const preset = resolveMakeLikePreset(track);
  const title = typeof track?.title === 'string' ? track.title : '';
  const go = () => {
    const presetStep = applyMakeLikePreset(preset);
    const nonce = String(Date.now());
    if (__DEV__) {
      console.info('[MakeLike] 작사 디렉터 직행', {
        trackId: track?.id != null ? String(track.id) : '',
        genre: preset.genre || '(미지정)',
        mood: preset.mood || '(미지정)',
        presetStep,
        nonce,
      });
    }
    navigateToLyricsDirector(navigation, { title, nonce });
  };
  if (hasCreationWorkInProgress()) {
    if (__DEV__) console.info('[MakeLike] 진행 중 작업 감지 — 덮어쓰기 확인 다이얼로그');
    showAlert('진행 중인 작곡이 있어요', '새로 시작할까요?', [
      { text: '이어서 하기', style: 'cancel', onPress: () => resumeExistingWork(navigation) },
      { text: '새로 시작', onPress: go },
    ]);
    return;
  }
  go();
}

/**
 * v3.237 공유 링크 CTA('나도 이런 곡 만들기') 목적지 배선 — v3.256에서 이 공용 파일로 이동(동작 불변).
 * 회원(어린이 포함 — 작업실 제한 없음) → Player를 닫고 작업실 Map
 * (RN7 navigate는 기존 MainTabs로 pop하지 않으므로 popTo).
 * 비회원 → 가입 화면 직행(추천코드 보관 v3.230은 AuthPanel이 그대로 복원), 성공 시 작업실 Map.
 */
export function navigateShareCtaDestination(navigation: any, loggedIn: boolean): void {
  if (loggedIn) {
    navigation.popTo('MainTabs', { screen: 'Studio', params: { screen: 'Map' } });
  } else {
    navigation.navigate('Settings', { authMode: 'register', after: 'studio' });
  }
}
