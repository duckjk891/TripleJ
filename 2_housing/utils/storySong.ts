// v3.410 [StorySong] 낙서·사진 → 노래 흐름 상태(대표 확정 SP-1, 10-23).
// ① 재료 담기 화면으로 넘길 1회용 입력(낙서 글·사진·기분·날짜)
// ② 분석 결과(이런 마음이 보여요 화면이 읽음)
// ③ 노래 맥락 — 어떤 분석·추천으로 가사를 썼는지, 어느 낙서에 노래를 붙일지. 작사 요청 1번에만 붙고(pendingLyrics),
//    완성 화면에서 '이 낙서에 노래 붙이기'에 쓴다. 앱을 다시 열어도 남게 AsyncStorage 에 둔다(24시간).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import api from '../services/api';
import type { StoryAnalysis, StoryPhotoKind } from '../services/storySongService';

export interface StoryInput {
  source: 'diary' | 'paste';
  text?: string;
  /** 이미 올라간 낙서 사진(feeds/{uid}/...) — 최대 5장이 넘어오면 앞 2장을 고른 상태로 */
  photos?: { objectName: string; uri?: string | null; kind?: StoryPhotoKind }[];
  /** 저장된 낙서에서 시작했으면 그 낙서 — 완성곡을 여기에 붙인다 */
  feedId?: string | null;
  mood?: string | null;
  diaryDate?: string | null;
  /** 낙서 쓰기 화면에서 왔을 때(아직 저장 전) — 낙서장에 남기면 그 임시저장을 지운다 */
  draftKey?: string | null;
}

let pendingInput: StoryInput | null = null;
export function setStoryInput(input: StoryInput | null): void {
  pendingInput = input;
}
export function consumeStoryInput(): StoryInput | null {
  const v = pendingInput;
  pendingInput = null;
  return v;
}

let currentAnalysis: StoryAnalysis | null = null;
export function setStoryAnalysis(a: StoryAnalysis | null): void {
  currentAnalysis = a;
}
export function getStoryAnalysis(): StoryAnalysis | null {
  return currentAnalysis;
}

export interface StorySongContext {
  analysisId: string;
  pick: string; // p1 | p2 | p3 | twist | custom
  feedId: string | null;
  guest: boolean;
  at: number;
  pendingLyrics: boolean;
  linked: boolean;
}

const CTX_KEY = 'maidol_story_song_ctx_v1';
const CTX_TTL_MS = 24 * 3600 * 1000;
let ctx: StorySongContext | null = null;

function save(): void {
  if (ctx) AsyncStorage.setItem(CTX_KEY, JSON.stringify(ctx)).catch(() => {});
  else AsyncStorage.removeItem(CTX_KEY).catch(() => {});
}

export function armStorySong(c: { analysisId: string; pick: string; feedId: string | null; guest: boolean }): void {
  ctx = { ...c, at: Date.now(), pendingLyrics: true, linked: false };
  console.info('[StorySong] 노래 맥락 준비', { pick: c.pick, hasFeed: !!c.feedId, guest: c.guest });
  save();
}

export function clearStorySong(why: string): void {
  if (ctx) console.info('[StorySong] 노래 맥락 지움', { why });
  ctx = null;
  save();
}

/** 작사 요청 본문에 붙일 칸(다시 쓰기 포함). 맥락은 작사 디렉터 대화·느낌 프리셋으로 새로 시작할 때 지워진다
 *  (LyricsInput 진입·applyMakeLikePreset → clearStorySong) — 다른 곡에 잘못 붙지 않게. */
export function storyLyricsFields(): { story_analysis_id?: string; story_pick?: string } {
  if (!ctx) return {};
  if (Date.now() - ctx.at > CTX_TTL_MS) {
    clearStorySong('expired');
    return {};
  }
  if (ctx.pendingLyrics) {
    ctx = { ...ctx, pendingLyrics: false, linked: true };
    save();
  }
  return { story_analysis_id: ctx.analysisId, story_pick: ctx.pick };
}

/** 완성 화면용 — 기록에서 쓴 가사로 만든 곡이면 맥락(24시간 안) */
export async function loadLinkedStorySong(): Promise<StorySongContext | null> {
  if (!ctx) {
    try {
      const raw = await AsyncStorage.getItem(CTX_KEY);
      ctx = raw ? JSON.parse(raw) : null;
    } catch {
      ctx = null;
    }
  }
  if (!ctx || !ctx.linked) return null;
  if (Date.now() - ctx.at > CTX_TTL_MS) {
    clearStorySong('expired');
    return null;
  }
  return ctx;
}

export function setStorySongFeed(feedId: string): void {
  if (!ctx) return;
  ctx = { ...ctx, feedId };
  save();
}

export const STORY_TEXT = {
  mapTitle: '내 낙서로 노래 만들기',
  mapSub: '글이나 사진만 넣으면 장르까지 골라 드려요',
  readButton: '내 마음 들여다보기',
  readButtonSub: '무료 · 하루 10번',
  readTitle: '이런 마음이 보여요',
  reading: '마음을 들여다보는 중이에요',
  readingSub: '20초쯤 걸려요. 화면을 닫지 말고 기다려 주세요.',
  careTitle: '많이 힘든 하루였나요?',
  careBody: '혼자 견디기 어려우면 언제든 이야기할 곳이 있어요.\n\n자살예방상담전화 109 (24시간)\n청소년상담 1388\n\n원하면 이 마음을 노래로 이어서 풀어 봐도 좋아요.',
};

// 서버에 /story-song 이 있을 때만 진입 버튼을 보인다 — 앱·웹이 서버 배포보다 먼저 나가도 깨진 버튼이 보이지 않게(앱 실행당 1번 확인).
let availability: Promise<boolean> | null = null;
export function storySongAvailable(): Promise<boolean> {
  if (!availability) {
    availability = api.get('/story-song/cities', { timeout: 8000 })
      .then((r) => Array.isArray(r.data?.cities))
      .catch((err) => {
        console.info('[StorySong] 서버 미지원 — 진입 버튼 숨김', { status: err?.response?.status ?? null });
        availability = err?.response?.status === 404 ? Promise.resolve(false) : null; // 네트워크 오류는 다음에 다시
        return false;
      });
  }
  return availability;
}
export function useStorySongAvailable(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let alive = true;
    storySongAvailable().then((v) => { if (alive) setOk(v); });
    return () => { alive = false; };
  }, []);
  return ok;
}
