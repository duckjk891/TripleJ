// v3.229 [DirectorResume]: 디렉터별 보존 draft 판정 — 작업실 맵(바로 가기·"이어서 하기" 말풍선)과
// 각 디렉터 화면(마운트 복원)이 같은 함수를 쓴다. 판정이 한 곳에 있어야 "맵은 이어하기로 보냈는데
// 화면은 새 대화로 여는" 불일치(빈 화면·draft 폐기)가 생기지 않는다.
// 전부 부작용 없는 순수 판정이다 — draft 폐기(키 불일치 등)는 기존대로 각 화면이 담당한다.
import type { DirectorType } from '../components/Character';
import { useLyricsStore } from '../stores/lyricsStore';
import { useMusicStore, type ComposeDraft, type VideoDraft } from '../stores/musicStore';
import { useCharacterTaskStore, type ArtistDraft } from '../stores/characterTaskStore';

type LyricsSnap = ReturnType<typeof useLyricsStore.getState>;
type MusicSnap = ReturnType<typeof useMusicStore.getState>;

// ── 작사 ──
/** LyricsInput 진행 대화 draft가 이어가기 대상인가 (v3.219 LyricsInputScreen 마운트 규칙 그대로) */
export function isLyricsDraftResumable(s: Pick<LyricsSnap, 'draftStep' | 'draftChat'> = useLyricsStore.getState()): boolean {
  return s.draftStep > 0 && s.draftChat.length > 0;
}

// ── 작곡 ──
/**
 * v3.219 [ComposeDraft]: 가사 신원 키 — lyricsSource.lyrics_id 우선, 없으면 가사 텍스트 해시.
 * (v3.229: MusicGenerationScreen에서 이동 — 맵 바로 가기 판정과 공용)
 * 미러링 시마다 재계산해 draft에 싣는다(가사 확인 단계의 사용자 편집이 store에 반영돼도
 * draft.lyricsKey가 함께 갱신 — 같은 대화의 재진입 판정 유지). 다른 가사로 진입(ComposeLyricsPick
 * handlePick·연주곡)하면 키가 달라져 draft 폐기 → 새 대화(잔존 오염 차단).
 */
export function computeComposeLyricsKey(): string {
  const music = useMusicStore.getState();
  if (music.lyricsSource?.lyrics_id) return `id:${music.lyricsSource.lyrics_id}`;
  const lyrics = (music.lyrics || useLyricsStore.getState().generatedLyrics || '').trim();
  if (music.instrumental && !lyrics) return 'instrumental';
  let h = 0;
  for (let i = 0; i < lyrics.length; i++) {
    h = (h * 31 + lyrics.charCodeAt(i)) | 0;
  }
  return `h:${h}:${lyrics.length}`;
}

/** 작곡 draft 이어가기 대상 — lyricsKey 일치 + 사용자 답 1개 이상 (MusicGenerationScreen 마운트 규칙) */
export function getResumableComposeDraft(): ComposeDraft | null {
  const d = useMusicStore.getState().composeDraft;
  if (!d) return null;
  if (d.lyricsKey !== computeComposeLyricsKey()) return null;
  if (!d.chatHistory.some((m) => m.type === 'user')) return null;
  return d;
}

// ── 영상 ──
/** 영상 draft 이어가기 대상 — 사용자 답 존재 + 'making'·'done' 단계 제외 (회수 진입 제외는 화면이 판단) */
export function isVideoDraftResumable(d: VideoDraft | null | undefined): d is VideoDraft {
  return !!d && d.chat.some((m) => m.type === 'user') && d.step !== 'making' && d.step !== 'done';
}

export function getResumableVideoDraft(): VideoDraft | null {
  const d = useMusicStore.getState().videoDraft;
  return isVideoDraftResumable(d) ? d : null;
}

// ── 아티스트 ──
/** 아티스트 draft에 사용자 진행이 있는가 (환영 인사만 있는 draft는 복원 대상 아님) */
export function hasArtistDraftProgress(d: ArtistDraft | null | undefined): d is ArtistDraft {
  return !!d && d.chat.some((m) => m.type === 'user');
}

/** 읽기 전용 판정 — 키 불일치 폐기 같은 부작용은 넣지 않는다(ArtistInputScreen이 담당) */
export function peekArtistDraft(): ArtistDraft | null {
  const d = useCharacterTaskStore.getState().draft;
  return hasArtistDraftProgress(d) ? d : null;
}

// ── 이미지(커버, 트랙 모드 전용 — 앨범 모드는 store를 쓰지 않는다) ──
/** 스타일 확정까지 마친 생성 대기(이어보기) — CoverGenerationScreen hasPendingGeneration 규칙 */
export function isCoverPendingGeneration(s: Pick<MusicSnap, 'coverTrackId' | 'coverStyle'> = useMusicStore.getState()): boolean {
  return !!s.coverTrackId && s.coverStyle != null;
}

/** 화면 복원용 — 영속된 대화가 있는가 (v3.202 H-⑤ 규칙 그대로: 인사만 있어도 복원) */
export function hasCoverDialogueSnapshot(s: Pick<MusicSnap, 'coverMessages'> = useMusicStore.getState()): boolean {
  return (s.coverMessages?.length ?? 0) > 0;
}

/** 대화에 사용자 답이 1개 이상 — 맵 바로 가기·'처음부터' 노출 기준(인사만 본 방문은 새로 시작으로 본다) */
export function hasCoverUserProgress(s: Pick<MusicSnap, 'coverMessages'> = useMusicStore.getState()): boolean {
  return !!s.coverMessages?.some((m) => m.type === 'user');
}

export function isCoverDraftResumable(s: Pick<MusicSnap, 'coverTrackId' | 'coverStyle' | 'coverMessages'> = useMusicStore.getState()): boolean {
  return isCoverPendingGeneration(s) || hasCoverUserProgress(s);
}

// ── 맵 바로 가기 대상 ──
export interface DirectorResumeTarget {
  route: string;
  params?: Record<string, unknown>;
  /** 로그용 — 어떤 보존본으로 판정했는지 */
  reason: string;
}

/**
 * 작업실 디렉터 탭 → 보존 화면으로 바로 갈 대상. null이면 보존본 없음(새로 시작 흐름).
 * 추적 작업(v3.228 만드는 중·완성)은 호출 측이 먼저 처리한다 — 이 함수는 보존 draft만 본다.
 */
export function getDirectorResumeTarget(type: DirectorType): DirectorResumeTarget | null {
  switch (type) {
    case 'lyricist': {
      const s = useLyricsStore.getState();
      // 요청서가 있으면 기존대로 요청 확인 화면이 우선
      if (s.generatedPrompt) return { route: 'LyricsPromptReview', reason: 'lyrics-prompt' };
      if (isLyricsDraftResumable(s)) return { route: 'LyricsInput', reason: 'lyrics-draft' };
      return null;
    }
    case 'composer':
    case 'wondera': {
      // 가사 게이트·모델 확정은 기존 경로(ComposerSelect → replace MusicGeneration) 그대로 탄다
      if (getResumableComposeDraft()) return { route: 'ComposerSelect', reason: 'compose-draft' };
      return null;
    }
    case 'image': {
      if (isCoverDraftResumable()) {
        return { route: 'CoverGeneration', reason: isCoverPendingGeneration() ? 'cover-pending' : 'cover-draft' };
      }
      return null;
    }
    case 'video': {
      if (getResumableVideoDraft()) return { route: 'VideoDirector', reason: 'video-draft' };
      return null;
    }
    case 'artist': {
      const d = peekArtistDraft();
      if (!d) return null;
      // 키를 반드시 넘긴다 — 안 넘기면 ArtistInput이 키 불일치로 draft를 폐기한다
      const params: Record<string, unknown> = {};
      if (d.targetCharacterId) params.characterId = d.targetCharacterId;
      if (d.forceKind) params.forceKind = d.forceKind;
      return {
        route: 'ArtistInput',
        params: Object.keys(params).length > 0 ? params : undefined,
        reason: d.targetCharacterId ? 'artist-regen-draft' : 'artist-draft',
      };
    }
    default:
      return null;
  }
}

/**
 * 맵 "이어서 하기" 말풍선 노출 기준 — 바로 가기 대상이 있고, 그 디렉터의 작업이 아직 끝나지 않았을 때.
 * 작사는 가사가 이미 만들어졌으면(요청서만 남은 상태) 다음 단계(작곡)가 "작업 시작" 대상이라 말풍선을 띄우지 않는다
 * (탭하면 바로 가기는 그대로 동작).
 */
export function hasDirectorWorkInProgress(type: DirectorType): boolean {
  const target = getDirectorResumeTarget(type);
  if (!target) return false;
  if (type === 'lyricist' && useLyricsStore.getState().generatedLyrics) return false;
  return true;
}
