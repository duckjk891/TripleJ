import { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Image,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Animated,
  Easing,
} from 'react-native';
import { showAlert } from '../utils/appAlert';
import { AppText } from '../components/ui';
// v3.204(④): 답변 편집 UX 통일 — step 0(곡 변경) 외에는 확인 팝업 없이 즉시 편집 모달
import AnswerEditModal, { AnswerEditExtraAction } from '../components/AnswerEditModal';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMusicStore } from '../stores/musicStore';
import { useGemsStore } from '../stores/gemsStore';
import { usePointsStore } from '../stores/pointsStore';
import { GEM_REWARDS } from '../data/directors';
import api, { BACKEND_BASE_URL } from '../services/api';
import { updateAlbumCover } from '../services/albumService';
import * as DocumentPicker from 'expo-document-picker';
import { uploadCoverBackground } from '../services/trackService';
import { listLyricsAssets } from '../services/lyricsService';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback } from 'react';
import { getFatigueStatus, isDirectorFatigued } from '../services/fatigueService';
import { showFatigueCooldownDialog } from '../utils/fatigueGate';
import { FatigueStatus } from '../types';
import { colors } from '../theme/colors';
import { Feather } from '@expo/vector-icons';
// v3.228 W2 [GenJob:cover]: 서버 원장(request_id) 연동 — 추적기 공개 API(1조) + cover 어댑터(2조, import 시 registerKind)
import {
  newRequestId, registerGenJob, adoptGenJob, markGenJobDone, guardGeneration, openGenJob,
  discardGenJob, endGenRequest, setViewerJob, releaseViewerJob, settleGenJob,
} from '../services/generationTracker';
import {
  genRequestHeaders, parseGenInProgress, isRequestAlreadyFailed, genLedgerFields,
} from '../services/genJobsService';
import { failureBody, CHARGE_UNCONFIRMED_BODY, type GenJobSnapshot } from '../services/genJobs';
import { fetchImageJob, COVER_CAP_MS, COVER_TEXT, COVER_REFINE_TEXT } from '../services/genJobs/cover';
import { useGenerationJobStore, listUserGenJobs } from '../stores/generationJobStore';
// v3.229 [DirectorResume]: 보존 대화 판정 공용(작업실 맵 바로 가기와 같은 규칙)
import { isCoverPendingGeneration, hasCoverDialogueSnapshot, hasCoverUserProgress } from '../utils/directorResume';

const IMAGE_PORTRAIT = require('../assets/portraits/image_director.png');

const STYLE_OPTIONS = ['포토리얼', '일러스트', '미니멀', '추상적', '빈티지', '네온', '수채화', '팝아트'];
// v3.150(대표 확정): 대화 보강 선택지 — 전부 선택사항(건너뛰기 가능)
const SHOT_OPTIONS = ['클로즈업', '반신', '전신', '뒷모습'];
const SHOT_NO_PERSON = '인물 없이'; // 아티스트 미포함일 때만 노출
const PALETTE_OPTIONS = ['파스텔', '비비드', '다크 무디', '흑백'];

// v3.150: 보강 답변 — 생성 도중 이탈·재진입(remount)에도 유지되도록 모듈 스코프 보관
// v3.202(H-⑤): 모듈 상태가 화면(chatHistory)과 따로 놀아 "안 보이는 답이 요청에 실리는" 괴리의
// 원인이었다 — 변경은 setCoverExtras 경유로 musicStore.coverExtrasSnapshot에도 동기화하고,
// 대화(coverMessages/coverStep)도 store에 영속해 재진입 시 화면과 답변이 항상 일치하게 한다.
const coverExtras: {
  shot: string | null; expression: string | null; palette: string | null;
  bgPrompt: string | null; bgObjectName: string | null; lyricsExcerpt: string | null;
  charKind: 'real' | 'virtual' | null; virtualArtStyle: string | null;
} = { shot: null, expression: null, palette: null, bgPrompt: null, bgObjectName: null, lyricsExcerpt: null, charKind: null, virtualArtStyle: null };
const syncCoverExtrasToStore = () => {
  useMusicStore.getState().setCoverExtrasSnapshot({ ...coverExtras });
};
// syncStore=false: 앨범 모드 마운트 초기화용 — 트랙 모드의 진행 중 스냅샷을 지우지 않는다(v3.202)
const resetCoverExtras = (syncStore = true) => {
  coverExtras.shot = null; coverExtras.expression = null; coverExtras.palette = null;
  coverExtras.bgPrompt = null; coverExtras.bgObjectName = null; coverExtras.lyricsExcerpt = null;
  coverExtras.charKind = null; coverExtras.virtualArtStyle = null;
  if (syncStore) syncCoverExtrasToStore();
};

// v3.202(H-⑤): 성공 확정 시에만 커버 컨텍스트 전체 클리어 (v3.228 W2: 화면 밖 요청 완료에서도 쓰도록 모듈 스코프)
const clearCoverContextStore = () => {
  const s = useMusicStore.getState();
  s.setCoverTrackId(null);
  s.setCoverTrackTitle(null);
  s.setCoverStyle(null);
  // v3.80 승계: 다음 커버에 유령처럼 포함되지 않게 정리 (재생성은 lastCharObjRef로 복원)
  s.setCoverCharacterObjectName(null);
  s.setCoverMessages(null);
  s.setCoverStep(null);
  s.setCoverExtrasSnapshot(null);
  s.setCoverLyricsExcerpt(null);
  s.setCoverLyricsId(null);
};

// ── v3.202(I-lite): 네트워크 단절/타임아웃 판정 — 서버 generate-cover는 150~180s 동기 처리라
// 클라이언트 연결이 먼저 끊겨도(실측 11/44/153s ERR_NETWORK) 서버는 완성 + ⭐ 차감을 마친다. ──
const isRecoverableNetErr = (err: any) =>
  !err?.response &&
  (err?.code === 'ERR_NETWORK' ||
    err?.code === 'ECONNABORTED' ||
    /network|timeout/i.test(String(err?.message || '')));
// v3.228 W2: 게이트웨이 오류(HTML 502/503/504 — 서버 JSON 본문 없음)도 서버 처리 여부 미확정 → 결과 확인 대상.
// 서버 JSON 오류(앱 계약 {error} · FastAPI 기본 {detail})는 서버 확정 실패.
const isGatewayErr = (err: any) => {
  const st = err?.response?.status;
  const data = err?.response?.data;
  return (st === 502 || st === 503 || st === 504)
    && !(data && typeof data === 'object' && (data.error || data.detail));
};

// 서버 시각은 타임존 표기 없는 UTC — 'Z' 보정 파싱 (AppealModal fmtDate 관행)
const parseCoverTs = (iso?: string | null) => {
  if (!iso) return NaN;
  return new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + 'Z').getTime();
};

// v3.202(I-lite) 1회분: GET /upload/cover-sessions — threshold(요청 시각-120s) 이후 완성 세션 중 최신 1건
const pollCoverSessionsOnce = async (threshold: number, attempt: number): Promise<any | null> => {
  try {
    const res = await api.get('/upload/cover-sessions', { params: { page: 1, limit: 5 } });
    const covers: any[] = res.data?.covers || [];
    const found = covers
      .filter((c) => c?.cover_object_name && parseCoverTs(c?.created_at) >= threshold)
      .sort((a, b) => parseCoverTs(b?.created_at) - parseCoverTs(a?.created_at))[0];
    if (found) {
      console.log('[Cover] 폴링 복구 성공', { attempt, cover_session_id: found.cover_session_id, created_at: found.created_at });
      return found;
    }
    console.log('[Cover] 폴링 복구 — 완성본 미발견', { attempt, count: covers.length });
  } catch (pollErr: any) {
    console.warn('[Cover] 폴링 복구 조회 실패', { attempt, status: pollErr?.response?.status, code: pollErr?.code });
  }
  return null;
};

const coverSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** v3.228 W2: 결과 표시용 정규화 — POST 응답·cover-sessions 항목·원장 result(cover·cover_refine) 공용 */
interface CoverSuccessData {
  objectName: string | null;
  imageUrlPath: string | null;
  sessionId: string | null;
  imageModel?: string;
  version: number;
  createdAt?: string | null;
  /** 응답을 직접 받지 못하고 회수함 — 잔액 동기화·전체 이력 재조회 */
  recovered: boolean;
}
const coverDataFrom = (r: any, recovered: boolean): CoverSuccessData => ({
  objectName: r?.object_name ?? r?.cover_object_name ?? null,
  imageUrlPath: r?.image_url ?? null,
  sessionId: r?.cover_session_id ? String(r.cover_session_id) : null,
  imageModel: r?.image_model ?? undefined,
  version: typeof r?.current_version === 'number' ? r.current_version : 0,
  createdAt: r?.created_at ?? null,
  recovered,
});

type CoverGenOutcome =
  | { kind: 'success'; data: CoverSuccessData }
  | { kind: 'fatigue'; err: any }
  | { kind: 'adopted'; key: string; snap: GenJobSnapshot }
  | { kind: 'failed'; message: string };

/**
 * v3.228 W2: 진행 중 커버 생성 1건(모듈 스코프 — 화면 재마운트에도 유지).
 * 재진입 시 새 POST(=재과금) 대신 이 요청에 합류(attach)해 결과를 받는다(0-3 이중 과금 경로 봉합).
 * 스토어 부수효과(성공 시 컨텍스트 클리어·실패 시 coverStyle 해제)는 러너가 1회 수행, 화면은 UI만 반영.
 */
interface ActiveCoverGen {
  genKey: string;
  requestId: string;
  startedAt: number;
  albumId: string | null;
  trackId: string;
  title: string;
  style: string;
  charObjectName: string | null;
  /** 결과를 보여줄(부착된) 화면 인스턴스 토큰 — null = 화면 밖(추적기 도착 알림) */
  owner: number | null;
  notice: string | null;
  onNotice: ((n: string | null) => void) | null;
  promise: Promise<CoverGenOutcome>;
}
let activeCoverGen: ActiveCoverGen | null = null;
let coverScreenSeq = 0;

const setGenNotice = (e: ActiveCoverGen, n: string | null) => {
  e.notice = n;
  e.onNotice?.(n);
};

const logCoverDupBlock = (reason: string, extra?: Record<string, unknown>) => {
  console.warn('[Cover] 중복 요청 차단', { reason, ...extra });
};


/**
 * v3.228 W2: 응답 미확정(ERR_NETWORK·timeout·게이트웨이 5xx) 결과 확인 — 재요청 없음(무과금).
 * 매 회차 ① 서버 원장(GET /generate/jobs/req/{rid}) ② 원장이 없으면(구서버·킬스위치) v3.202 I-lite cover-sessions.
 * 기한 = v3.202 리듬(15s×12 ≈ 3분), 원장이 processing 이면 서버 상한(15분)까지 연장.
 * 앨범 모드는 기존에도 I-lite 없음 — 원장이 없으면 즉시 종료(구서버 동작 보존).
 */
async function recoverCoverResult(e: ActiveCoverGen): Promise<
  | { kind: 'found'; data: CoverSuccessData; result: any; serverJobId: string | null }
  | { kind: 'failed'; error: string | null; refunded: boolean | null; notCharged: boolean | null }
  | { kind: 'none' }
> {
  const POLL_INTERVAL_MS = 15000;
  const isAlbum = !!e.albumId;
  const threshold = e.startedAt - 120000;
  let deadline = Date.now() + 12 * POLL_INTERVAL_MS;
  let ledgerSeen = false;
  let attempt = 0;
  while (Date.now() <= deadline) {
    attempt++;
    await coverSleep(POLL_INTERVAL_MS);
    let snap: GenJobSnapshot | null | undefined;
    try {
      snap = await fetchImageJob({ kind: 'cover', requestId: e.requestId });
    } catch {
      snap = undefined; // 네트워크·5xx — 다음 회차
    }
    if (snap?.status === 'done' && snap.result) {
      const data = coverDataFrom(snap.result, true);
      if (data.objectName) {
        console.info('[GenJob:cover] 원장 완성 확인', { attempt, jobId: e.genKey });
        return { kind: 'found', data, result: snap.result, serverJobId: snap.jobId };
      }
    }
    if (snap?.status === 'failed') {
      return { kind: 'failed', error: snap.error ?? null, refunded: snap.refunded ?? null, notCharged: snap.notCharged ?? null };
    }
    if (snap?.status === 'processing') {
      if (!ledgerSeen) {
        ledgerSeen = true;
        deadline = Math.max(deadline, e.startedAt + COVER_CAP_MS);
        console.info('[GenJob:cover] 서버 원장 진행 중 — 상한까지 추적', { jobId: e.genKey });
      }
      continue;
    }
    if (isAlbum) {
      if (snap === null) return { kind: 'none' };
      continue;
    }
    const found = await pollCoverSessionsOnce(threshold, attempt);
    if (found) {
      return {
        kind: 'found',
        data: coverDataFrom(found, true),
        result: {
          cover_session_id: found.cover_session_id ?? null, object_name: found.cover_object_name,
          image_url: found.image_url ?? null, image_model: found.image_model ?? null,
        },
        serverJobId: null,
      };
    }
  }
  return { kind: 'none' };
}

/** v3.228 W2: 커버 생성 요청 러너(모듈 스코프 — 화면 이탈과 무관하게 끝까지 수행, 결과는 부착 화면이 반영) */
async function runCoverGenerate(e: ActiveCoverGen, payload: Record<string, any>): Promise<CoverGenOutcome> {
  const isAlbum = !!e.albumId;
  try {
    const res = await api.post('/upload/generate-cover', payload, {
      timeout: 600000, // GPT Image 2는 캐릭터 ref 포함 시 5분 이상 걸리기도 함 → 10분
      headers: genRequestHeaders(e.requestId),
    });
    console.log('[Cover] generate-cover OK', Date.now() - e.startedAt, 'ms');
    const data = coverDataFrom(res.data, false);
    markGenJobDone(e.genKey, {
      cover_session_id: data.sessionId, object_name: data.objectName,
      image_url: data.imageUrlPath, image_model: data.imageModel ?? null,
    }, { acked: e.owner !== null, serverJobId: genLedgerFields(res.data).genJobId });
    // v3.202(H-⑤): 컨텍스트 클리어는 성공 경로에서만
    if (!isAlbum) clearCoverContextStore();
    return { kind: 'success', data };
  } catch (err: any) {
    console.warn('[Cover] generate-cover FAIL', {
      message: err?.message,
      code: err?.code,
      status: err?.response?.status,
      data: err?.response?.data,
    });
    const status = err?.response?.status;
    const data = err?.response?.data;
    // v3.118: 커버(image) 디렉터 피로 429 — 과금 전 게이트(원장 없음)
    if (isDirectorFatigued(err)) {
      discardGenJob(e.genKey, 'cover-429');
      if (!isAlbum) useMusicStore.getState().setCoverStyle(null);
      return { kind: 'fatigue', err };
    }
    // v3.228 W2: 409 generation_in_progress(커버·다듬기 한 슬롯) — 이 요청은 원장 전 거절(무과금), 진행 중 job 편입
    const inProgress = parseGenInProgress(err, 'cover');
    if (inProgress) {
      logCoverDupBlock('server-409', { kind: inProgress.kind, jobId: inProgress.jobId });
      const key = adoptGenJob(inProgress, { replaceKey: e.genKey });
      if (!isAlbum) useMusicStore.getState().setCoverStyle(null);
      return { kind: 'adopted', key, snap: inProgress };
    }
    // v3.202(I-lite)+v3.228: 응답 미확정 — 실패 확정 전에 결과 확인(재생성 호출 금지 = 재차감 금지)
    if (isRecoverableNetErr(err) || isGatewayErr(err)) {
      console.log('[Cover] 응답 미확정 — 결과 확인 시작', { code: err?.code, status, elapsedMs: Date.now() - e.startedAt });
      setGenNotice(e, '이미지가 거의 다 됐어요, 잠시만요…');
      const r = await recoverCoverResult(e);
      setGenNotice(e, null);
      if (r.kind === 'found') {
        // 완성본 회수 = 성공 처리 — 재생성 호출 없음(⭐ 재차감 없음)
        markGenJobDone(e.genKey, r.result, { acked: e.owner !== null, serverJobId: r.serverJobId });
        if (!isAlbum) clearCoverContextStore();
        usePointsStore.getState().fetchBalance(); // 서버는 이미 처리 완료 — 잔액 표시 동기화
        return { kind: 'success', data: r.data };
      }
      // 화면 추적 종료 → 이후는 전역 추적기가 원장으로 판정(구서버는 유예 뒤 조용히 정리)
      endGenRequest(e.genKey);
      if (!isAlbum) useMusicStore.getState().setCoverStyle(null);
      usePointsStore.getState().fetchBalance();
      if (r.kind === 'failed') {
        // 화면이 보고 있으면 실패 확인 처리, 화면 밖이면 추적기가 도착 알림으로 안내
        if (e.owner !== null) settleGenJob('cover', e.genKey, 'failed', { error: r.error, refunded: r.refunded });
        return { kind: 'failed', message: `${COVER_TEXT.failTitle}. ${failureBody(r.error, r.refunded, r.notCharged)}` };
      }
      console.warn('[Cover] 폴링 복구 실패 — 결과 미확정');
      return { kind: 'failed', message: `커버 이미지 결과를 확인하지 못했어요. ${CHARGE_UNCONFIRMED_BODY}` };
    }
    // 서버가 명시적으로 답한 실패 — 원장 있는 5xx 는 서버 실패 확정(서버 환불 처리), 그 외는 원장 전 거절
    if (typeof status === 'number' && status >= 500 && genLedgerFields(data).genJobId) {
      if (e.owner !== null) settleGenJob('cover', e.genKey, 'failed', { error: data?.error ?? null });
    } else {
      discardGenJob(e.genKey, isRequestAlreadyFailed(err) ? 'cover-request-already-failed' : `cover-${status ?? 'error'}`);
    }
    // v3.202(H-⑤): 실패 확정 — coverStyle만 해제(곡·대화·보강 답변·아티스트 선택 보존)
    if (!isAlbum) useMusicStore.getState().setCoverStyle(null);
    return { kind: 'failed', message: data?.error || err?.message || '커버 생성에 실패했습니다.' };
  }
}

// v3.169(대표): 인물 표정 선택지 — 아티스트 포함 시 구도 다음 질문
const EXPRESSION_OPTIONS = ['환하게 웃는', '은은한 미소', '시크한 무표정', '아련한 눈빛', '강렬한 카리스마'];

// v3.204(④): 답변 편집 분류 — step 0(곡 변경)만 파괴적 확인 팝업 유지(이후 선택 전부 초기화),
// 나머지 선택지형은 즉시 AnswerEditModal(setStep 금지). 자유 입력은 1.8·1.82·1.85·1.9·2만.
const COVER_EDIT_STEPS = new Set([1, 1.5, 1.7, 1.75, 1.8, 1.82, 1.85, 1.9, 2]);
const COVER_FREETEXT_STEPS = new Set([1.8, 1.82, 1.85, 1.9, 2]);
const EDIT_SKIP_LABEL = '건너뛰기';
const EDIT_STYLE_SKIP_LABEL = '이대로 만들기 (건너뛰기)';

const LOADING_STEPS = [
  { label: '구상', message: '커버 이미지를 구상하고 있어요...' },
  { label: '색감', message: '색감을 조합하고 있어요...' },
  { label: '디자인', message: '디자인 중이에요...' },
  { label: '마무리', message: '마무리 중이에요...' },
];

interface ChatMessage {
  type: 'director' | 'user';
  text: string;
  /** v3.151 — 이 답변이 응답한 step. 있으면 말풍선 탭 → 그 단계부터 다시 선택(타 디렉터 UX 통일) */
  step?: number;
  /** v3.202(H-④) — director 메시지가 어느 step의 사용자 답변에 대한 응답(에코/다음 질문)인지.
   *  비파괴 되감기의 "직후 에코 버블" 식별은 이 메타 매치로만 한다(1조 MusicGeneration 패턴 동일 —
   *  암묵 idx+1 가정·문자열 검색 금지). musicStore.CoverChatMessage와 구조 동일(영속 호환). */
  echoOfStep?: number;
}
interface MyTrack { id: string; title: string; cover_image?: string; cover_image_url?: string; genre?: string[]; mood?: string[]; }

// v3.89: 커버 미세조정(refine) 버전 히스토리 엔트리 — 백엔드 cover_sessions.cover_refine_history와 동일 구조
interface CoverHistoryEntry {
  version: number;
  object_name: string;
  refine_prompt: string | null;
  image_model?: string;
  created_at?: string;
}

// 커버 object_name → 프록시 미리보기 URL (다른 화면들과 동일 관행)
const coverPreviewUrl = (obj: string) =>
  `${BACKEND_BASE_URL}/api/upload/cover-preview/${encodeURIComponent(obj)}`;

const REFINE_PROMPT_MAX_LEN = 500; // 백엔드 REFINE_PROMPT_MAX_LEN과 동일

type Props = NativeStackScreenProps<any, 'CoverGeneration'>;

// v3.120: 앨범 모드 파라미터 — AlbumDetail '커버 변경 > AI 커버 생성'에서 진입(RootStack
// 'AlbumCoverGeneration'). 컨텍스트(앨범 제목·수록곡)는 musicStore를 오염시키지 않도록
// 파라미터로만 받고, 확정 시 트랙 부착 대신 PATCH /albums/{id}/cover(objectName)를 호출.
interface AlbumModeParams { albumId: string; albumTitle: string; trackTitles?: string[] }

// 화면 모드
type ScreenMode = 'dialogue' | 'loading' | 'result';

export default function CoverGenerationScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const musicStore = useMusicStore();
  const scrollRef = useRef<ScrollView>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // v3.120: 앨범 모드 — route 파라미터로만 판별 (마운트 후 불변)
  const albumMode: AlbumModeParams | undefined = route.params?.albumMode;

  // 앨범 모드는 musicStore cover* 재진입 컨텍스트를 쓰지 않음 (트랙 커버 대기 이어보기 전용)
  // v3.202(H-⑤): coverTrackId는 이제 곡 선택 시점부터 "대화 컨텍스트"로 보관되므로,
  // "생성 대기(이어보기)" 판별은 스타일 확정(coverStyle != null, handleStyleConfirm)까지 요구.
  // 실패 확정 시 coverStyle을 지워(catch) 재진입 자동 doGenerate(재차감)를 막는다.
  const hasPendingGeneration = !albumMode && isCoverPendingGeneration(musicStore);
  // v3.228 W2: 회수 진입(recoverJobId — 작업실 말풍선·도착 알림·가드 [진행 상황 보기]) / 진행 중 요청 합류
  const recoverAtMount = !!(route.params as any)?.recoverJobId;
  const attachAtMount = useRef(
    !recoverAtMount && !!activeCoverGen && (activeCoverGen.albumId ?? null) === (albumMode?.albumId ?? null)
  ).current;
  // v3.202(H-⑤): 진행 중이던 대화가 store에 영속돼 있으면 이어서 복원 (성공 확정 시에만 클리어)
  const initialStore = useRef(useMusicStore.getState()).current;
  const hasResumableDialogue =
    !albumMode && !hasPendingGeneration && hasCoverDialogueSnapshot(initialStore);
  // v3.229 [CoverDraft]: 복원 안내 버블(+'처음부터') — 다른 디렉터와 같은 UX. 사용자 답이 있는 대화를
  // 이어갈 때만(인사만 있는 복원은 새로 시작과 같음). 회수·진행 중 요청 합류 진입에는 띄우지 않는다.
  const [showResumeNotice, setShowResumeNotice] = useState(
    hasResumableDialogue && hasCoverUserProgress(initialStore) && !recoverAtMount && !attachAtMount
  );
  const resumeChatLenRef = useRef(initialStore.coverMessages?.length ?? 0);

  // 화면 모드: dialogue(대화) / loading(생성중) / result(결과)
  const [mode, setMode] = useState<ScreenMode>(
    hasPendingGeneration || recoverAtMount || attachAtMount ? 'loading' : 'dialogue'
  );

  // 대화 관련 — v3.202(H-⑤): 재진입 시 store 영속본으로 hydrate
  const [step, setStep] = useState(hasResumableDialogue ? (initialStore.coverStep ?? 0) : 0);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>(() => {
    if (albumMode) {
      return [{ type: 'director', text: `안녕하세요! 이미지 디렉터예요. 앨범 "${albumMode.albumTitle}"의 커버 이미지를 만들어볼까요?` }];
    }
    if (hasResumableDialogue) return initialStore.coverMessages as ChatMessage[];
    if (hasPendingGeneration && initialStore.coverMessages?.length) {
      return initialStore.coverMessages as ChatMessage[];
    }
    return [{ type: 'director', text: '안녕하세요! 이미지 디렉터예요. 어떤 곡의 커버 이미지를 만들어볼까요?' }];
  });
  const [tracks, setTracks] = useState<MyTrack[]>([]);
  const [selectedTrack, setSelectedTrack] = useState<MyTrack | null>(
    // v3.202(H-⑤): 재진입 시 곡 선택 복원 — coverTrackId는 handleTrackSelect부터 기록됨
    !albumMode && musicStore.coverTrackId
      ? ({ id: musicStore.coverTrackId, title: musicStore.coverTrackTitle || '' } as MyTrack)
      : null
  );
  const [styleInput, setStyleInput] = useState('');
  const [trackLoading, setTrackLoading] = useState(!hasPendingGeneration);
  // v3.80: 커버에 포함할 캐릭터 — 실사/가상 슬롯 object_name (선택 결과는 musicStore에 저장:
  // 대기 후 재진입 시 로컬 state가 초기화돼 "아티스트 포함"이 유실되던 버그의 근본 픽스)
  const [realObjName, setRealObjName] = useState<string | null>(null);
  const [virtualObjName, setVirtualObjName] = useState<string | null>(null);
  // 재생성 시 슬롯 선택 유지용 (doGenerate 정리부에서 store가 비워진 뒤 복원)
  const lastCharObjRef = useRef<string | null>(null);

  // v3.202(H-⑤): 보강 답변 변경 단일 통로 — 모듈 값 + (트랙 모드) store 스냅샷 동시 갱신.
  // 앨범 모드는 store를 오염시키지 않는다(모듈 값만).
  const applyExtras = (patch: Partial<typeof coverExtras>) => {
    Object.assign(coverExtras, patch);
    if (!albumMode) syncCoverExtrasToStore();
  };

  // v3.202(H-④): 비파괴 되감기 컨텍스트 — 1조 MusicGeneration commitExchange 패턴 동일.
  // 활성 중에는 답변 핸들러가 대화를 덧붙이는 대신 해당 버블/에코만 치환하고 resumeStep으로 복귀.
  const rewindRef = useRef<{ idx: number; target: number; resumeStep: number } | null>(null);
  // v3.204(④): 선택지형 답변 편집 모달이 보여주는 스텝(null=닫힘) — setStep과 독립(입력 영역 유지)
  const [editStep, setEditStep] = useState<number | null>(null);

  // v3.202(H-⑤): 성공 확정 시에만 커버 컨텍스트 전체 클리어 (실패는 coverStyle만 해제해
  // 재진입 자동 재요청(재차감)을 막고, 대화·곡 선택·아티스트 선택은 보존 → 이어서 수정 가능)
  // v3.228 W2: 구현은 모듈 스코프 clearCoverContextStore(화면 밖 요청 완료에서도 1회 수행)
  const clearCoverContext = clearCoverContextStore;

  // 로딩/결과 관련
  const [loadingMsgIndex, setLoadingMsgIndex] = useState(0);
  // v3.202(I-lite): 네트워크 단절 후 cover-sessions 폴링 복구 중 안내 문구 (loading 화면 대체 표기)
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(null);
  const [coverObjectName, setCoverObjectName] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // v3.89: 미세조정(refine) 세션 — doGenerate는 재진입 mount에서 실행되고 세션 id는
  // 결과 화면 단계에서만 쓰이므로 로컬 state로 충분 (store 불필요)
  const [coverSessionId, setCoverSessionId] = useState<string | null>(null);
  const [coverHistory, setCoverHistory] = useState<CoverHistoryEntry[]>([]);
  const [currentVersion, setCurrentVersion] = useState(0); // 서버 세션의 현재 버전
  const [viewVersion, setViewVersion] = useState(0);       // 화면에서 보고 있는 버전
  const [refineInput, setRefineInput] = useState('');
  // v3.169(대표): 미세조정 ⭐ 비용 — /points/costs의 cover_refine 키가 있을 때만 고지·confirm
  const [refineCost, setRefineCost] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await api.get('/points/costs');
        const c = res.data?.costs?.cover_refine;
        if (alive && typeof c === 'number') setRefineCost(c);
      } catch (err: any) {
        console.error('[Cover] /points/costs 조회 실패', { status: err?.response?.status });
      }
    })();
    return () => { alive = false; };
  }, []);
  const [refining, setRefining] = useState(false);
  // v3.204(⑤): refine 이중 제출 봉인 — refining state는 ⭐ confirm await 대기 중의 재진입
  // (입력창 Enter·적용 버튼 재탭)을 못 막는다(setRefining이 confirm 뒤에 실행). 동기 ref 가드를
  // confirm await 전에 세우고 취소·완료·실패 모든 경로(finally)에서 해제한다.
  const refineSubmitGuardRef = useRef(false);
  // v3.204(⑤): refine 네트워크 단절 → cover-history 폴링 회수 중 안내 (refineHint 대체 표기)
  const [refinePollingNotice, setRefinePollingNotice] = useState<string | null>(null);
  const [reverting, setReverting] = useState(false);
  // v3.120: 앨범 모드 확정(PATCH /albums/{id}/cover) 진행 중 — 중복 탭 방지
  const [applying, setApplying] = useState(false);
  // v3.150: 대화 보강 상태 — 선택 슬롯(의상 새로고침용)·배경 텍스트 버퍼·업로드 중 표시
  const [chosenSlot, setChosenSlot] = useState<'real' | 'virtual' | null>(null);
  const [bgText, setBgText] = useState('');
  // v3.168(대표): 구도·색감도 직접 입력 가능해야 함
  const [shotText, setShotText] = useState('');
  const [expressionText, setExpressionText] = useState('');
  const [paletteText, setPaletteText] = useState('');
  const [bgUploading, setBgUploading] = useState(false);

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, [chatHistory, step]);

  // v3.150: 새 대화 시작 시 이전 세션의 보강 답변 초기화 (생성 중 재진입은 유지)
  // v3.202(H-⑤): 이어가는 대화(영속본)면 초기화 대신 스냅샷으로 모듈 값을 hydrate.
  // 앨범 모드는 모듈 값만 리셋(트랙 모드의 진행 중 스냅샷 보존 — syncStore=false).
  useEffect(() => {
    if (albumMode) { resetCoverExtras(false); return; }
    if (hasPendingGeneration || hasResumableDialogue) {
      const snap = useMusicStore.getState().coverExtrasSnapshot;
      if (snap) {
        Object.assign(coverExtras, snap);
        if (snap.charKind) setChosenSlot(snap.charKind); // 의상 미리보기 슬롯 복원
      }
      // 아티스트 관련 스텝(1~1.7)에서 복원된 경우 — 슬롯 object_name 재확보(대화 append 없음)
      if (hasResumableDialogue && (initialStore.coverStep ?? 0) >= 1 && (initialStore.coverStep ?? 0) < 1.75) {
        api.get('/character/me')
          .then((res) => {
            const ch = res.data?.character;
            setRealObjName(ch?.sheet_object_name || null);
            setVirtualObjName(ch?.virtual_sheet_object_name || null);
          })
          .catch((err) => console.warn('[Cover] 복원 시 캐릭터 재조회 실패:', err?.response?.status));
      }
      return;
    }
    resetCoverExtras();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // v3.202(H-⑤): 대화 영속 — 트랙 모드 dialogue 진행분을 store에 미러링(재진입 복원 원천).
  // 성공 확정(clearCoverContext) 시에만 지워진다.
  useEffect(() => {
    if (albumMode) return;
    const s = useMusicStore.getState();
    s.setCoverMessages(chatHistory);
    s.setCoverStep(step);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatHistory, step]);

  // v3.229 [CoverDraft]: 이어서 답하기 시작하면(대화가 늘어나면) 복원 안내 버블 접기 — 작사·작곡 관행 동일
  useEffect(() => {
    if (showResumeNotice && chatHistory.length !== resumeChatLenRef.current) setShowResumeNotice(false);
  }, [chatHistory, showResumeNotice]);

  // v3.229 [CoverDraft]: '처음부터' — 커버 대화 컨텍스트(곡 선택·답변·대화) 청소 후 새 대화 마운트로 교체.
  // 로컬 상태를 하나씩 되돌리는 대신 화면을 다시 올려 "새로 시작한 마운트"와 동치로 만든다.
  // 진행 중 생성이 있으면 막는다(버튼도 dialogue 모드 복원 진입에서만 보인다).
  const handleRestartCover = () => {
    showAlert('처음부터 다시 할까요?', '진행하던 커버 대화와 선택한 답변이 지워지고 곡 선택부터 새로 시작해요.', [
      { text: '취소', style: 'cancel' },
      {
        text: '처음부터',
        onPress: () => {
          if (activeCoverGen) {
            console.info('[CoverDraft] 처음부터 보류 — 진행 중 생성 있음', { jobId: activeCoverGen.genKey });
            setShowResumeNotice(false);
            return;
          }
          console.info('[CoverDraft] 처음부터 — 커버 컨텍스트 청소·새 대화');
          clearCoverContextStore();
          resetCoverExtras();
          setShowResumeNotice(false);
          navigation.replace(route.name as any);
        },
      },
    ]);
  };

  // 트랙 조회 (앨범 모드는 곡 선택 단계가 없어 불필요)
  const loadTracks = async () => {
    try {
      const res = await api.get('/tracks/my', { params: { page: 1, limit: 50, sort: 'created_at' } });
      setTracks(res.data.tracks || []);
    } catch { setTracks([]); }
    finally { setTrackLoading(false); }
  };
  useEffect(() => {
    if (hasPendingGeneration || albumMode) return;
    loadTracks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // v3.120: 앨범 모드 — 곡 선택 없이 캐릭터(아티스트 포함) 확인부터 시작.
  // trackLoading이 스피너를 대신하므로 확인이 끝나면 해제.
  useEffect(() => {
    if (!albumMode) return;
    (async () => {
      await checkCharacterAndProceed();
      setTrackLoading(false);
    })();
  }, []);

  // 로딩 애니메이션
  useEffect(() => {
    if (mode !== 'loading') return;
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.1, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    pulse.start();
    const msgInterval = setInterval(
      () => setLoadingMsgIndex((i) => Math.min(i + 1, LOADING_STEPS.length - 1)),
      3000
    );
    return () => { pulse.stop(); clearInterval(msgInterval); };
  }, [mode]);

  // ── v3.228 W2: 화면 인스턴스·추적 뷰어 ──
  const tokenRef = useRef(0);
  if (tokenRef.current === 0) tokenRef.current = ++coverScreenSeq;
  const mountedRef = useRef(true);
  const viewerKeyRef = useRef<string | null>(null);
  // 원장 추적(409 편입·회수) 중 로딩 문구 — recoveryNotice(연결 불안정)와 구분
  const [trackNotice, setTrackNotice] = useState<{ text: string; note: string } | null>(null);
  // handleStyleConfirm 은 피로 조회 await 뒤 doGenerate — 칩 연타·다이얼로그 연타 재진입 봉인
  const styleConfirmBusyRef = useRef(false);
  const viewJob = (key: string | null) => {
    if (key) setViewerJob(key);
    else releaseViewerJob(viewerKeyRef.current);
    viewerKeyRef.current = key;
  };
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const e = activeCoverGen;
      if (e && e.owner === tokenRef.current) {
        // 화면 이탈 — 요청은 계속, 완료는 전역 추적기 도착 알림(또는 재진입 화면이 합류)
        e.owner = null;
        e.onNotice = null;
      }
      if (viewerKeyRef.current) {
        releaseViewerJob(viewerKeyRef.current); // 다른 화면의 뷰어는 건드리지 않음
        viewerKeyRef.current = null;
      }
    };
  }, []);

  // v3.228 W2: 성공 결과 반영(UI만 — 스토어 부수효과는 러너가 수행). 회수 결과는 전체 버전 이력 재조회.
  const applyCoverSuccess = (d: CoverSuccessData) => {
    setErrorMsg(null);
    setCoverObjectName(d.objectName);
    setCoverImageUrl(
      d.imageUrlPath
        ? (d.imageUrlPath.startsWith('http') ? d.imageUrlPath : `${BACKEND_BASE_URL}${d.imageUrlPath}`)
        : d.objectName ? coverPreviewUrl(d.objectName) : null
    );
    // v3.89: cover_session_id 보관 → refine 세션 (옛 응답에 없으면 refine UI 비활성 — defensive)
    if (d.sessionId && d.objectName) {
      console.log('[Cover] refine 세션 시작 cover_session_id:', d.sessionId);
      setCoverSessionId(d.sessionId);
      setCoverHistory([{
        version: d.version,
        object_name: d.objectName,
        refine_prompt: null,
        image_model: d.imageModel,
        created_at: d.createdAt || new Date().toISOString(),
      }]);
    } else {
      console.log('[Cover] cover_session_id 없음 — refine 비활성');
    }
    setCurrentVersion(d.version);
    setViewVersion(d.version);
    setMode('result');
    if (d.recovered && d.sessionId) void refreshCoverHistory(d.sessionId);
  };

  // v3.228 W2: 회수 결과의 전체 버전 이력(GET /upload/cover-history/{session}) — 실패는 단건 표시 유지
  const refreshCoverHistory = async (sessionId: string) => {
    try {
      const res = await api.get(`/upload/cover-history/${sessionId}`);
      if (!mountedRef.current) return;
      const h = res.data?.cover_refine_history;
      if (Array.isArray(h) && h.length > 0) setCoverHistory(h);
      const v = res.data?.current_version;
      if (typeof v === 'number') {
        setCurrentVersion(v);
        setViewVersion(v);
      }
      const obj = res.data?.cover_object_name;
      if (typeof obj === 'string' && obj) setCoverObjectName(obj);
    } catch (err: any) {
      console.warn('[Cover] 버전 이력 재조회 실패(단건 유지)', { status: err?.response?.status });
    }
  };

  // v3.228 W2: 러너 결과 → 화면 반영
  const applyCoverOutcome = async (e: ActiveCoverGen, o: CoverGenOutcome) => {
    if (o.kind === 'success') {
      applyCoverSuccess(o.data);
      return;
    }
    if (o.kind === 'adopted') {
      void trackAdoptedImageJob(o.key, o.snap);
      return;
    }
    if (o.kind === 'fatigue') {
      // v3.118: 커버(image) 디렉터 피로 429 — 실패 화면 미진입·무과금 (서버 ⭐5 차감 전 게이트).
      // 동일 다이얼로그로 스킵 안내, 해제되면 같은 인자로 재시도 (아티스트 슬롯 선택은 ref로 복원).
      const gateRemain = Math.max(0, Math.floor(o.err?.response?.data?.cooldown_remaining_sec ?? 0));
      console.log('[Cover] [fatigue:image] 429 게이트 — 남은', gateRemain, '초 (과금 없음)');
      let fatigueStatus: FatigueStatus | null = null;
      try {
        fatigueStatus = await getFatigueStatus('image');
      } catch (statusErr: any) {
        console.warn('[Cover] [fatigue:image] 상태 조회 실패:', statusErr?.response?.status);
      }
      showFatigueCooldownDialog({
        status: fatigueStatus,
        remainingSec: Math.max(gateRemain, Math.floor(fatigueStatus?.cooldown_remaining_sec ?? 0)),
        director: 'image',
        cancelText: '돌아가기',
        onCancel: () => doRegenerate(), // 스타일 대화 화면으로 복귀 (에러 화면 미진입)
        onCleared: () => {
          // 스킵으로 해제 — 같은 인자로 재시도 (⭐ 커버 비용은 재시도에서 정상 차감)
          if (lastCharObjRef.current) musicStore.setCoverCharacterObjectName(lastCharObjRef.current);
          doGenerate(e.trackId, e.title, e.style);
        },
      });
      // v3.202(H-③): 대화 와이프 제거 — 기존 대화에 휴식 안내만 append, 스타일 단계(2)로 복귀.
      // (coverStyle 해제는 러너가 수행 — 재진입 자동 재요청 방지)
      setMode('dialogue');
      setStep(2);
      setChatHistory((prev) => [
        ...prev,
        { type: 'director', text: '잠깐 쉬는 중이에요. 휴식이 끝나면 다시 만들어드릴게요!', echoOfStep: 2 },
      ]);
      return;
    }
    // v3.202(H-⑤): 실패 확정 — 곡 선택·대화·보강 답변·아티스트 선택은 보존 → '다시 생성하기'로 이어서 수정 가능.
    setErrorMsg(o.message);
    setMode('result');
  };

  // v3.228 W2: 진행 중 요청에 합류 — 새 POST 없음. 결과는 이 화면(owner)이 반영.
  const attachCoverGen = async (e: ActiveCoverGen) => {
    e.owner = tokenRef.current;
    e.onNotice = (n) => {
      if (mountedRef.current && e.owner === tokenRef.current) setRecoveryNotice(n);
    };
    setRecoveryNotice(e.notice);
    setTrackNotice(null);
    setErrorMsg(null);
    lastCharObjRef.current = e.charObjectName;
    setMode('loading');
    viewJob(e.genKey);
    const o = await e.promise;
    if (!mountedRef.current || e.owner !== tokenRef.current) return;
    e.owner = null;
    e.onNotice = null;
    if (viewerKeyRef.current === e.genKey) viewJob(null);
    setRecoveryNotice(null);
    await applyCoverOutcome(e, o);
  };

  const doGenerate = (trackId: string, title: string, style: string) => {
    // v3.228 W2: 진행 중 요청이 있으면 새 POST 금지(재과금 경로) — 같은 화면 대상이면 그 요청에 합류
    const cur = activeCoverGen;
    if (cur) {
      logCoverDupBlock('in-flight', { jobId: cur.genKey });
      if ((cur.albumId ?? null) === (albumMode?.albumId ?? null) && cur.owner !== tokenRef.current) {
        void attachCoverGen(cur);
      }
      return;
    }
    // 재생성 시 사용할 수 있도록 로컬에 보존 (앨범 모드는 트랙 개념 없음)
    if (!albumMode && !selectedTrack) {
      setSelectedTrack({ id: trackId, title } as MyTrack);
    }
    setMode('loading');
    setErrorMsg(null);
    setRecoveryNotice(null);
    setTrackNotice(null);
    // v3.89: 새 생성 시작 — 이전 refine 세션/히스토리 폐기 (MAIDOL v58 Q4-a 관행:
    // 재생성마다 백엔드가 신규 cover_session을 발급하므로 옛 세션은 버림)
    setCoverSessionId(null);
    setCoverHistory([]);
    setCurrentVersion(0);
    setViewVersion(0);
    setRefineInput('');
    // v3.80: 로컬 state 대신 musicStore에서 읽음 — 대기 후 재진입해도 "아티스트 포함" 유지.
    // 재생성 시 선택 유지를 위해 ref에 백업 (handleStyleConfirm에서 복원).
    const charObjectName = useMusicStore.getState().coverCharacterObjectName;
    lastCharObjRef.current = charObjectName;
    const t0 = Date.now(); // v3.202(I-lite): 폴링 복구 판정 기준 시각
    // v3.150(대표): 장르/분위기 자동 주입 제거 — 이미지에 왜 필요한지 불명확(대표 지적).
    // 사용자가 원하면 배경/자유 서술로 직접 표현한다.
    // v3.120: 앨범 모드 — 서버 generate-cover는 곡 기준이라 앨범 정보를 모름 →
    // 앨범 제목(title)·수록곡 제목들을 user_prompt 힌트로 전달 (트랙 모드는 기존 그대로)
    const albumHint = albumMode
      ? [
          '앨범 커버 이미지',
          albumMode.trackTitles?.length
            ? `수록곡: ${albumMode.trackTitles.slice(0, 20).join(', ')}`
            : '',
        ].filter(Boolean).join('. ')
      : '';
    const payload = {
      title: title || (albumMode ? '새 앨범' : '새로운 곡'),
      style: style || undefined,
      user_prompt: albumMode ? [style, albumHint].filter(Boolean).join('. ') : (style || undefined),
      // v3.80: 선택한 슬롯(실사/가상)의 object_name — 미포함이면 undefined
      character_object_name: charObjectName || undefined,
      image_model: 'gpt_image_2',
      // v3.150: 대화 보강 답변 — 전부 선택사항 (undefined=미주입)
      shot: coverExtras.shot || undefined,
      expression: coverExtras.expression || undefined, // v3.169 — 인물 표정
      palette: coverExtras.palette || undefined,
      background_prompt: coverExtras.bgPrompt || undefined,
      background_object_name: coverExtras.bgObjectName || undefined,
      lyrics_excerpt: coverExtras.lyricsExcerpt || undefined,
      // v3.152: 실사/가상 분기 — 가상이면 화풍 라벨 동봉 (서버가 일러스트 강제 프롬프트로 전환)
      character_kind: charObjectName ? (coverExtras.charKind || 'real') : undefined,
      character_art_style: charObjectName && coverExtras.charKind === 'virtual'
        ? (coverExtras.virtualArtStyle || undefined) : undefined,
    };
    console.log('[Cover] generate-cover payload:', JSON.stringify(payload));
    // v3.228 W2: 서버 원장 요청 ID — POST 직전 발급·추적 등록(응답 유실·재진입·앱 재시작 후 회수)
    const requestId = newRequestId();
    const genKey = registerGenJob({
      kind: 'cover',
      requestId,
      meta: albumMode
        ? { title: payload.title, album_id: albumMode.albumId, album_title: albumMode.albumTitle }
        : { title: payload.title, track_id: trackId || null, track_title: title || null },
    });
    const e = {
      genKey, requestId, startedAt: t0, albumId: albumMode?.albumId ?? null,
      trackId, title, style, charObjectName, owner: null, notice: null, onNotice: null,
    } as unknown as ActiveCoverGen;
    e.promise = runCoverGenerate(e, payload)
      .catch((err: any): CoverGenOutcome => {
        console.error('[Cover] 러너 예외', { message: err?.message });
        return { kind: 'failed', message: err?.message || '커버 생성에 실패했습니다.' };
      })
      .finally(() => {
        if (activeCoverGen === e) activeCoverGen = null;
      });
    activeCoverGen = e;
    console.info('[GenJob:cover] 접수', { jobId: genKey, album: !!albumMode });
    void attachCoverGen(e);
  };

  // ── v3.228 W2: 원장 job 추적(409 편입·회수 진입) — POST 없음 ──
  type ImageTrackOutcome =
    | { kind: 'done'; jobKind: string; result: any; serverJobId: string | null }
    | { kind: 'failed'; error: string | null; refunded: boolean | null; notCharged: boolean | null }
    | { kind: 'expired' } | { kind: 'gone' } | { kind: 'unmounted' };

  const trackImageJob = async (key: string): Promise<ImageTrackOutcome> => {
    const start = useGenerationJobStore.getState().jobs[key]?.startedAt ?? Date.now();
    const deadline = Math.max(start + COVER_CAP_MS, Date.now() + 60 * 1000);
    while (Date.now() <= deadline) {
      if (!mountedRef.current) return { kind: 'unmounted' };
      const rec = useGenerationJobStore.getState().jobs[key];
      if (!rec) return { kind: 'gone' }; // 추적기가 정리(원장 없음·확인 완료)
      if (rec.lastStatus === 'done' && rec.genResult) {
        return { kind: 'done', jobKind: rec.kind, result: rec.genResult, serverJobId: rec.serverJobId ?? null };
      }
      if (rec.lastStatus === 'failed') {
        return { kind: 'failed', error: rec.error ?? null, refunded: rec.refunded ?? null, notCharged: rec.notCharged ?? null };
      }
      let snap: GenJobSnapshot | null | undefined;
      try {
        snap = await fetchImageJob({
          kind: rec.kind === 'cover_refine' ? 'cover_refine' : 'cover',
          requestId: rec.requestId ?? null, serverJobId: rec.serverJobId ?? null,
        });
      } catch {
        snap = undefined;
      }
      if (snap?.status === 'done' && snap.result) {
        return { kind: 'done', jobKind: rec.kind, result: snap.result, serverJobId: snap.jobId };
      }
      if (snap?.status === 'failed') {
        return { kind: 'failed', error: snap.error ?? null, refunded: snap.refunded ?? null, notCharged: snap.notCharged ?? null };
      }
      await coverSleep(10000);
    }
    return { kind: 'expired' };
  };

  const applyTrackedImage = (key: string, o: ImageTrackOutcome) => {
    if (o.kind === 'unmounted') return;
    if (viewerKeyRef.current === key) viewJob(null);
    setTrackNotice(null);
    if (o.kind === 'done') {
      const data = coverDataFrom(o.result, true);
      if (!data.objectName) {
        setErrorMsg(`결과를 확인하지 못했어요. ${CHARGE_UNCONFIRMED_BODY}`);
        setMode('result');
        return;
      }
      console.info('[GenJob:cover] 결과 도착', { jobId: key, kind: o.jobKind });
      // 결과를 보여줌 = 확인(로컬 정리 + 서버 ack). 로컬 레코드가 없으면 서버 job id 로 ack 만
      const rec = useGenerationJobStore.getState().jobs[key];
      settleGenJob(o.jobKind === 'cover_refine' ? 'cover_refine' : 'cover', rec ? key : o.serverJobId, 'done', { result: o.result });
      usePointsStore.getState().fetchBalance();
      applyCoverSuccess(data);
      return;
    }
    if (o.kind === 'failed') {
      const isRefine = useGenerationJobStore.getState().jobs[key]?.kind === 'cover_refine';
      const text = isRefine ? COVER_REFINE_TEXT : COVER_TEXT;
      console.info('[GenJob:cover] 서버 실패 확정', { jobId: key, refunded: o.refunded });
      settleGenJob(isRefine ? 'cover_refine' : 'cover', key, 'failed', { error: o.error, refunded: o.refunded });
      usePointsStore.getState().fetchBalance();
      setErrorMsg(`${text.failTitle}. ${failureBody(o.error, o.refunded, o.notCharged)}`);
      setMode('result');
      return;
    }
    if (o.kind === 'gone') {
      // 추적기가 정리(원장 없음) — 추적기가 뷰어에 중립 안내를 이미 띄움. 대화로 복귀
      setMode('dialogue');
      return;
    }
    setErrorMsg(`결과를 확인하지 못했어요. ${CHARGE_UNCONFIRMED_BODY}`);
    setMode('result');
  };

  // 409 편입 — 커버면 이 화면에서 추적, 다듬기(같은 슬롯)면 안내 후 대화로
  const trackAdoptedImageJob = async (key: string, snap: GenJobSnapshot) => {
    if (snap.kind === 'cover_refine') {
      setMode('dialogue');
      setStep(2);
      showAlert(COVER_REFINE_TEXT.busyTitle, COVER_REFINE_TEXT.busyBody, [
        { text: '닫기', style: 'cancel' },
        { text: '진행 상황 보기', onPress: () => { void openGenJob(key, navigation); } },
      ]);
      return;
    }
    setMode('loading');
    setTrackNotice({
      text: '이미 만들고 있는 이미지가 있어요',
      note: '그 이미지가 완성되면 바로 보여드릴게요.\n작업이 끝날 때까지 이 화면을 벗어나지 마세요.',
    });
    viewJob(key);
    applyTrackedImage(key, await trackImageJob(key));
  };

  // 회수 진입 — done: 결과 화면(+ack) / processing: 로딩 추적 / failed: 안내(+ack)
  const startImageRecovery = (key: string) => {
    const cur = activeCoverGen;
    if (cur && cur.genKey === key) {
      console.info('[GenJob:cover] 회수 진입 — 진행 중 요청에 합류', { jobId: key });
      void attachCoverGen(cur);
      return;
    }
    const job = useGenerationJobStore.getState().jobs[key];
    if (!job || (job.kind !== 'cover' && job.kind !== 'cover_refine')) {
      console.warn('[GenJob:cover] 회수 대상 없음', { jobId: key });
      setMode((m) => (m === 'loading' ? 'dialogue' : m));
      return;
    }
    if (refineSubmitGuardRef.current || (cur && cur.owner === tokenRef.current)) {
      logCoverDupBlock('recover-while-busy', { jobId: key });
      return;
    }
    const trackId = job.meta?.track_id ? String(job.meta.track_id) : null;
    if (!albumMode && trackId) setSelectedTrack({ id: trackId, title: String(job.meta?.track_title ?? '') } as MyTrack);
    console.info('[GenJob:cover] 회수 진입', { jobId: key, kind: job.kind, status: job.lastStatus });
    if (job.lastStatus === 'processing') {
      setMode('loading');
      setErrorMsg(null);
      setTrackNotice({
        text: job.kind === 'cover_refine' ? '요청하신 부분을 다듬는 중이에요' : '커버 이미지를 만들고 있어요',
        note: '작업이 끝날 때까지 이 화면을 벗어나지 마세요.',
      });
      viewJob(key);
      void (async () => applyTrackedImage(key, await trackImageJob(key)))();
      return;
    }
    if (job.lastStatus === 'done') {
      applyTrackedImage(key, { kind: 'done', jobKind: job.kind, result: job.genResult, serverJobId: job.serverJobId ?? null });
      return;
    }
    applyTrackedImage(key, { kind: 'failed', error: job.error ?? null, refunded: job.refunded ?? null, notCharged: job.notCharged ?? null });
  };

  const recoverJobParam: string | null = (route.params as any)?.recoverJobId
    ? String((route.params as any).recoverJobId) : null;
  useEffect(() => {
    if (recoverJobParam) startImageRecovery(recoverJobParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recoverJobParam]);

  // v3.228 W2: 재진입(0-3 이중 과금 경로 봉합) — 기존 "대기 완료 후 자동 생성"(마운트 시 doGenerate = 새 POST·⭐ 재차감)
  // 제거. 진행 중 요청이 있으면 합류, 없으면 추적 레코드로 회수, 둘 다 없으면 스타일 단계로 복귀(자동 재요청 0).
  useEffect(() => {
    if (recoverAtMount) return; // 회수 effect 가 처리
    const e = activeCoverGen;
    if (e && (e.albumId ?? null) === (albumMode?.albumId ?? null)) {
      console.info('[Cover] 재진입 — 진행 중 요청에 합류(재요청 없음)', { jobId: e.genKey });
      void attachCoverGen(e);
      return;
    }
    if (!hasPendingGeneration) return;
    const tracked = listUserGenJobs(['cover']).find((j) => j.lastStatus === 'processing' || j.lastStatus === 'done');
    if (tracked) {
      console.info('[Cover] 재진입 — 추적 중인 커버 회수(재요청 없음)', { jobId: tracked.jobId });
      startImageRecovery(tracked.jobId);
      return;
    }
    logCoverDupBlock('reentry-no-inflight');
    musicStore.setCoverStyle(null);
    setMode('dialogue');
    setStep(2);
    setChatHistory((prev) => [
      ...prev,
      { type: 'director', text: '진행하던 커버 작업을 이어서 확인하지 못했어요. 스타일을 다시 골라 주시면 새로 만들어 드릴게요.', echoOfStep: 2 },
    ]);
    loadTracks(); // 곡 변경(step 0) 되감기 대비
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // v3.80: /character/me 조회 — 실사·가상 시트 모두 확보. 하나라도 있으면 "아티스트 포함?" 질문.
  // v3.120: 트랙 모드(곡 선택 후)·앨범 모드(마운트 직후) 공용으로 추출.
  // v3.202(H-①): 방금 고른 track을 인자로 전달 — setSelectedTrack 직후의 stale closure 때문에
  // 아티스트 없는 사용자가 가사 반영 질문(1.75)을 건너뛰던 결함 픽스(state 대신 인자 우선).
  const checkCharacterAndProceed = async (track?: MyTrack | null) => {
    try {
      const res = await api.get('/character/me');
      const ch = res.data?.character;
      const realObj: string | null = ch?.sheet_object_name || null;
      const virtualObj: string | null = ch?.virtual_sheet_object_name || null;
      setRealObjName(realObj);
      setVirtualObjName(virtualObj);
      // v3.152: 가상 화풍 보관 — 가상 슬롯 선택 시 프롬프트 분기(character_art_style)에 사용
      applyExtras({ virtualArtStyle: ch?.virtual_art_style || null });
      if (__DEV__) console.info('[Cover] 캐릭터 슬롯 확인', { hasReal: !!realObj, hasVirtual: !!virtualObj, vStyle: ch?.virtual_art_style || null });
      if (realObj || virtualObj) {
        setChatHistory((prev) => [
          ...prev,
          { type: 'director', text: '내 아티스트가 있네요! 이 아티스트가 포함된 커버 이미지로 만드시겠어요?', echoOfStep: 0 },
        ]);
        setStep(1); // 아티스트 포함 여부 단계
      } else {
        musicStore.setCoverCharacterObjectName(null);
        proceedToLyricsQ(track); // v3.151: 아티스트 없어도 가사 질문부터
      }
    } catch (err) {
      console.warn('[Cover] /character/me 조회 실패, 캐릭터 없이 진행:', err);
      musicStore.setCoverCharacterObjectName(null);
      proceedToLyricsQ(track);
    }
  };

  // ── v3.202(H-④): 비파괴 되감기 커밋 — 되감기 중 답변은 탭한 user 버블의 text만 새 값으로
  // 치환(step 태그 보존)하고 원래 진행 위치(resumeStep)로 복귀한다. 이 화면의 디렉터 버블은
  // 값을 에코하지 않는 "다음 질문"이라 버블 치환 + 값(coverExtras/store) 갱신만으로 충분.
  // true 반환 = 되감기 커밋 완료(호출부는 flow 진행 금지). ──
  const commitRewindAnswer = (text: string) => {
    const rw = rewindRef.current;
    if (!rw) return false;
    rewindRef.current = null;
    console.info('[Cover] 되감기 커밋(비파괴 치환)', { idx: rw.idx, target: rw.target, resume: rw.resumeStep });
    setChatHistory((prev) => {
      const next = [...prev];
      if (next[rw.idx]?.type === 'user') next[rw.idx] = { ...next[rw.idx], text };
      return next;
    });
    setStep(rw.resumeStep);
    return true;
  };

  // ── v3.150(대표 확정): 대화 보강 체인 — 의상 확인 → 구도 → 배경·장소 → 색감 → (가사) → 자유 서술.
  //    전부 선택사항(건너뛰기 가능). 답변은 coverExtras(모듈 스코프)에 보관돼 재진입에도 유지. ──
  const goWardrobe = (slot: 'real' | 'virtual') => {
    setChosenSlot(slot);
    applyExtras({ charKind: slot }); // v3.152: 실사/가상 프롬프트 분기용
    setChatHistory((prev) => [
      ...prev,
      { type: 'director', text: '지금 아티스트가 입고 있는 의상이에요. 이 의상 그대로 커버를 만들까요? 바꾸고 싶으면 아티스트 꾸미기로 다녀올 수 있어요!', echoOfStep: step },
    ]);
    setStep(1.7);
  };

  const handleWardrobeKeep = () => {
    if (commitRewindAnswer('이 의상 그대로')) return; // v3.202(H-④)
    setChatHistory((prev) => [...prev, { type: 'user', text: '이 의상 그대로', step: 1.7 }]);
    proceedToLyricsQ(undefined, 1.7); // v3.151(대표): 의상 다음은 가사 포함 여부
  };

  // v3.151(대표): 가사 포함 질문을 앞으로 — 포함하면 디테일(배경~색감) 질문 생략,
  // 미포함이면 디테일 질문 진행. 앨범 모드/곡 없음은 가사 개념이 없어 디테일로 직행.
  // v3.202(H-①): track 인자 우선 — handleTrackSelect 직후 stale selectedTrack 참조 픽스.
  // v3.204(③): 디테일 첫 질문 = 배경(1.85). echoOf = 직전 사용자 답변 step(진입 컨텍스트) —
  // 앨범 마운트 직행처럼 선행 답변이 없으면 미지정.
  const proceedToLyricsQ = (track?: MyTrack | null, echoOf?: number) => {
    if (albumMode || !(track?.id || selectedTrack?.id || musicStore.coverTrackId)) {
      proceedToBg(echoOf);
      return;
    }
    setChatHistory((prev) => [
      ...prev,
      { type: 'director', text: '이 곡의 가사 내용을 반영해서 만들까요? 가사를 반영하면 장면은 가사에 맡기고, 아니면 구도·배경·색감을 하나씩 여쭤볼게요. (추가 비용 없어요)' },
    ]);
    setStep(1.75);
  };

  const handleWardrobeChange = () => {
    console.info('[Cover] 의상 변경 — ArtistCody 연동 이동');
    rewindRef.current = null; // v3.202(H-④): 화면 이동 흐름은 되감기 치환 대상이 아님 — 일반 진행으로 전환
    setChatHistory((prev) => [
      ...prev,
      { type: 'user', text: '의상 바꾸러 가기', step: 1.7 },
      { type: 'director', text: '아티스트 꾸미기로 이동할게요! 꾸미기를 마치고 돌아오면 바뀐 의상으로 이어서 진행해요.' },
    ]);
    try {
      // v3.156: returnToCover — Cody의 ←(닫기)가 Map이 아니라 이 대화로 goBack하도록 표식
      if (albumMode) {
        // 앨범 모드(RootStack)는 Studio 스택 중첩 진입
        (navigation as any).navigate('MainTabs', { screen: 'Studio', params: { screen: 'ArtistCody', params: { returnToCover: true } } });
      } else {
        (navigation as any).navigate('ArtistCody', { returnToCover: true });
      }
    } catch (err) {
      console.error('[Cover] ArtistCody 이동 실패', err);
      showAlert('안내', '아티스트 꾸미기 화면으로 이동하지 못했어요. 작업실 > 아티스트 디렉터에서 꾸민 뒤 다시 와주세요.');
    }
  };

  // v3.204(③): 세부 질문 순서 재배선 — 배경(1.85)이 디테일 체인의 첫 질문.
  // 스텝 번호 값은 불변(영속 coverStep·performRewind 호환) — 배선만 교체.
  // 새 체인: 1.75 '직접' → 배경(1.85) → 구도(1.8) → [인물 시 표정(1.82)] → 색감(1.9) → 자유(2).
  // echoOf = 직전 사용자 답변 step(1.75 가사 skip / 1.7 의상 / 1 아티스트 제외 등 진입 컨텍스트별).
  const proceedToBg = (echoOf?: number) => {
    setChatHistory((prev) => [
      ...prev,
      { type: 'director', text: '배경이나 장소 생각이 있나요? 사진을 올려도 되고, 말로 설명해도 돼요. 없으면 건너뛰어요!', ...(echoOf != null ? { echoOfStep: echoOf } : {}) },
    ]);
    setStep(1.85);
  };

  const proceedToShot = () => {
    setChatHistory((prev) => [
      ...prev,
      // v3.204(③): 선행이 배경(1.85) 답변 — echoOfStep 정합(비파괴 되감기 식별 메타)
      { type: 'director', text: '어떤 구도로 담을까요? 딱히 없으면 건너뛰어도 좋아요!', echoOfStep: 1.85 },
    ]);
    setStep(1.8);
  };

  const handleShotPick = (shot: string | null) => {
    setShotText('');
    applyExtras({ shot });
    console.info('[Cover] 구도 선택', { shot });
    if (commitRewindAnswer(shot || '건너뛰기')) return; // v3.202(H-④)
    // v3.169(대표): 아티스트 포함이면 표정 질문(1.82) 경유.
    // v3.204(③): 배경은 이미 앞(1.85)에서 답함 — 미포함이면 색감(1.9)으로.
    const hasPerson = !!useMusicStore.getState().coverCharacterObjectName;
    if (hasPerson) {
      setChatHistory((prev) => [
        ...prev,
        { type: 'user', text: shot || '건너뛰기', step: 1.8 },
        { type: 'director', text: '인물의 표정은 어떻게 할까요? 딱히 없으면 건너뛰어도 좋아요!', echoOfStep: 1.8 },
      ]);
      setStep(1.82);
      return;
    }
    setChatHistory((prev) => [...prev, { type: 'user', text: shot || '건너뛰기', step: 1.8 }]);
    proceedToPalette(1.8);
  };

  // v3.169: 표정 선택/직접 입력 → (v3.204(③)) 색감 질문으로
  const handleExpressionPick = (expression: string | null) => {
    setExpressionText('');
    applyExtras({ expression });
    console.info('[Cover] 표정 선택', { expression });
    if (commitRewindAnswer(expression || '건너뛰기')) return; // v3.202(H-④)
    setChatHistory((prev) => [...prev, { type: 'user', text: expression || '건너뛰기', step: 1.82 }]);
    proceedToPalette(1.82);
  };

  // 배경 — 사진 업로드 (DocumentPicker image/* 관행)
  const handleBgPhoto = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: 'image/*' });
      if (res.canceled || !res.assets || !res.assets[0]) return;
      const a = res.assets[0];
      if (typeof a.size === 'number' && a.size > 10 * 1024 * 1024) {
        showAlert('안내', '이미지 크기는 10MB 이하여야 해요.');
        return;
      }
      setBgUploading(true);
      console.info('[Cover] 배경 사진 업로드 시작', { name: a.name, size: a.size ?? -1 });
      const data = await uploadCoverBackground({
        uri: a.uri, fileName: a.name || 'background.jpg', mimeType: a.mimeType, size: a.size,
      } as any);
      applyExtras({ bgObjectName: data.object_name, bgPrompt: null });
      console.info('[Cover] 배경 사진 업로드 완료', { object: data.object_name });
      if (commitRewindAnswer('배경 사진을 올렸어요')) return; // v3.202(H-④)
      setChatHistory((prev) => [...prev, { type: 'user', text: '배경 사진을 올렸어요', step: 1.85 }]);
      proceedToShot(); // v3.204(③): 배경 다음은 구도
    } catch (err: any) {
      console.error('[Cover] 배경 사진 업로드 실패', { status: err?.response?.status, message: err?.message });
      showAlert('오류', err?.response?.data?.error || '사진 업로드에 실패했어요. 다시 시도하거나 말로 설명해주세요.');
    } finally {
      setBgUploading(false);
    }
  };

  const handleBgText = () => {
    const v = bgText.trim().slice(0, 300);
    if (!v) return;
    applyExtras({ bgPrompt: v, bgObjectName: null });
    setBgText('');
    if (commitRewindAnswer(v)) return; // v3.202(H-④)
    setChatHistory((prev) => [...prev, { type: 'user', text: v, step: 1.85 }]);
    proceedToShot(); // v3.204(③): 배경 다음은 구도
  };

  const handleBgSkip = () => {
    applyExtras({ bgPrompt: null, bgObjectName: null });
    if (commitRewindAnswer('건너뛰기')) return; // v3.202(H-④)
    setChatHistory((prev) => [...prev, { type: 'user', text: '건너뛰기', step: 1.85 }]);
    proceedToShot(); // v3.204(③): 배경 다음은 구도
  };

  // v3.204(④): 편집 모달의 배경 자유 입력 — handleBgText와 동일 규칙(300자 제한), 값만 인자로
  const handleBgPick = (text: string) => {
    const v = text.trim().slice(0, 300);
    if (!v) return;
    applyExtras({ bgPrompt: v, bgObjectName: null });
    if (commitRewindAnswer(v)) return;
    setChatHistory((prev) => [...prev, { type: 'user', text: v, step: 1.85 }]);
    proceedToShot();
  };

  // v3.204(③): 선행 스텝이 표정(1.82) 또는 구도(1.8)로 갈라짐 — echoOfStep 파라미터화
  const proceedToPalette = (echoOf: number) => {
    setChatHistory((prev) => [
      ...prev,
      { type: 'director', text: '색감이나 톤은 어떻게 할까요? 이것도 건너뛸 수 있어요!', echoOfStep: echoOf },
    ]);
    setStep(1.9);
  };

  const handlePalettePick = (palette: string | null) => {
    setPaletteText('');
    applyExtras({ palette });
    console.info('[Cover] 색감 선택', { palette });
    if (commitRewindAnswer(palette || '건너뛰기')) return; // v3.202(H-④)
    setChatHistory((prev) => [...prev, { type: 'user', text: palette || '건너뛰기', step: 1.9 }]);
    proceedToFinal(); // v3.151: 가사 질문은 앞(1.75)으로 이동
  };

  // 가사 반영 — LLM 추가 호출 없이 가사 발췌를 이미지 프롬프트에 직접 동봉 (무비용)
  // v3.204(②): step 2의 '가사 내용 기반으로 생성' 중복 버튼 제거 — 가사 반영 여부는 트랙 모드에서
  // 항상 1.75에서 질문되므로 마지막 스텝 재노출은 중복·모순(사용자 지적). 1.75 전용으로 단순화.
  const handleLyricsUse = async () => {
    const answerText = '가사 내용 반영';
    const rewinding = !!rewindRef.current; // v3.202(H-④): 되감기 중이면 버블 치환으로 커밋
    if (!rewinding) {
      setChatHistory((prev) => [...prev, { type: 'user', text: answerText, step: 1.75 }]);
    }
    try {
      const trackId = selectedTrack?.id || musicStore.coverTrackId;
      const store = useMusicStore.getState();
      let excerpt: string | null = null;
      let lyricsId: string | null = null;
      if (!albumMode && store.coverLyricsExcerpt) {
        // v3.202(H-⑤): 같은 대화의 발췌는 재조회 없이 승계 (곡 변경 시 performRewind가 클리어)
        excerpt = store.coverLyricsExcerpt;
        lyricsId = store.coverLyricsId;
      } else {
        const trackRes = await api.get(`/tracks/${trackId}`);
        lyricsId = trackRes.data?.lyrics_id ?? null;
        if (lyricsId) {
          const items = await listLyricsAssets();
          const found = items.find((it) => it.lyrics_id === lyricsId);
          if (found?.content) excerpt = found.content.slice(0, 400);
        }
      }
      if (!excerpt) {
        console.warn('[Cover] 가사 발췌 실패 — lyrics_id/자산 없음', { lyricsId: lyricsId || null });
        setChatHistory((prev) => [
          ...prev,
          { type: 'director', text: '이 곡의 가사를 찾지 못했어요. 가사 없이 이어서 갈게요!' },
        ]);
        applyExtras({ lyricsExcerpt: null });
        if (!albumMode) { store.setCoverLyricsExcerpt(null); store.setCoverLyricsId(null); }
      } else {
        applyExtras({ lyricsExcerpt: excerpt });
        if (!albumMode) { store.setCoverLyricsExcerpt(excerpt); store.setCoverLyricsId(lyricsId); }
        console.info('[Cover] 가사 발췌 반영', { len: excerpt.length });
      }
    } catch (err: any) {
      console.error('[Cover] 가사 조회 실패', { status: err?.response?.status });
      applyExtras({ lyricsExcerpt: null });
    }
    if (rewinding) { commitRewindAnswer(answerText); return; }
    proceedToFinal();
  };

  const handleLyricsSkip = () => {
    applyExtras({ lyricsExcerpt: null });
    if (!albumMode) {
      useMusicStore.getState().setCoverLyricsExcerpt(null);
      useMusicStore.getState().setCoverLyricsId(null);
    }
    if (commitRewindAnswer('아니요, 직접 정할게요')) {
      // v3.202(H-④): '반영→직접'으로 되감은 경우 — 디테일(배경~색감)을 아직 답한 적 없으면
      // 이어서 질문 진행(마지막 setStep이 우선), 이미 답이 있으면 원위치 복귀 유지.
      if (coverExtras.shot == null && coverExtras.palette == null && coverExtras.bgPrompt == null && coverExtras.bgObjectName == null) {
        proceedToBg(1.75); // v3.204(③): 첫 디테일 질문 = 배경
      }
      return;
    }
    setChatHistory((prev) => [...prev, { type: 'user', text: '아니요, 직접 정할게요', step: 1.75 }]);
    proceedToBg(1.75); // v3.204(③): 미포함 → 디테일 질문(배경→구도→색감)
  };

  // ── v3.151: 답변 말풍선 탭 → 그 단계부터 다시 선택 (작곡 디렉터 v3.148과 동일 UX) ──
  const questionForStep = (t: number): string => {
    switch (t) {
      case 0: return '어떤 곡의 커버 이미지를 만들어볼까요?';
      case 1: return '내 아티스트가 있네요! 이 아티스트가 포함된 커버 이미지로 만드시겠어요?';
      case 1.5: return '아티스트가 두 명 있네요! 어느 아티스트로 넣을까요?';
      case 1.7: return '지금 아티스트가 입고 있는 의상이에요. 이 의상 그대로 커버를 만들까요? 바꾸고 싶으면 아티스트 꾸미기로 다녀올 수 있어요!';
      case 1.75: return '이 곡의 가사 내용을 반영해서 만들까요? 가사를 반영하면 장면은 가사에 맡기고, 아니면 구도·배경·색감을 하나씩 여쭤볼게요. (추가 비용 없어요)';
      case 1.8: return '어떤 구도로 담을까요? 딱히 없으면 건너뛰어도 좋아요!';
      case 1.82: return '인물의 표정은 어떻게 할까요? 딱히 없으면 건너뛰어도 좋아요!';
      case 1.85: return '배경이나 장소 생각이 있나요? 사진을 올려도 되고, 말로 설명해도 돼요. 없으면 건너뛰어요!';
      case 1.9: return '색감이나 톤은 어떻게 할까요? 이것도 건너뛸 수 있어요!';
      default: return '마지막이에요! 원하는 느낌이나 장면을 자유롭게 적어주세요. 지금까지 고른 것들과 합쳐서 반영돼요.';
    }
  };

  // v3.202(H-④): 비파괴 되감기 — 대화 절단·이후 답변 초기화(v3.151) 폐기.
  // 해당 버블 값 치환만 수행하고 이후 대화·상태는 보존한다(1조 MusicGeneration 패턴).
  // 예외: step 0(곡 변경)만 파괴 허용 — 곡이 바뀌면 이후 선택 전부가 무효라 처음부터 재진행.
  const performRewind = (idx: number, target: number) => {
    if (target === 0) {
      console.info('[Cover] 대화 되감기 — 곡 변경(파괴 허용)', { idx });
      rewindRef.current = null;
      resetCoverExtras(!albumMode);
      musicStore.setCoverCharacterObjectName(null);
      setChosenSlot(null);
      setSelectedTrack(null);
      if (!albumMode) {
        musicStore.setCoverTrackId(null);
        musicStore.setCoverTrackTitle(null);
        musicStore.setCoverStyle(null);
        musicStore.setCoverLyricsExcerpt(null);
        musicStore.setCoverLyricsId(null);
      }
      if (mode !== 'dialogue') setMode('dialogue');
      setChatHistory((prev) => [
        ...prev.slice(0, idx),
        { type: 'director', text: questionForStep(0) },
      ]);
      setStep(0);
      return;
    }
    // 연쇄 되감기(되감기 중 다른 버블 탭) — 복귀 지점은 최초의 원래 진행 위치 유지
    const resumeStep = rewindRef.current ? rewindRef.current.resumeStep : step;
    console.info('[Cover] 대화 되감기(비파괴)', { idx, target, resumeStep, fromMode: mode });
    rewindRef.current = { idx, target, resumeStep };
    if (mode !== 'dialogue') setMode('dialogue'); // v3.202: result 모드에서도 수정 진입 허용
    setStep(target);
  };

  // v3.204(④): step 0(곡 변경)만 기존 파괴적 확인 팝업 유지 — 이후 선택 전부 초기화되므로.
  // 나머지 선택지형은 확인 팝업 없이 즉시 AnswerEditModal(setStep 금지 — 하단 입력 영역 유지).
  const handleUserBubbleTap = (idx: number) => {
    const msg = chatHistory[idx];
    if (msg?.type !== 'user' || msg.step == null || mode === 'loading') return;
    if (msg.step === 0) {
      showAlert(
        '곡을 다시 고를까요?',
        `"${msg.text}"\n\n곡을 바꾸면 이후의 선택은 초기화되고 처음부터 다시 진행해요.`,
        [
          { text: '취소', style: 'cancel' },
          { text: '다시 선택', onPress: () => performRewind(idx, 0) },
        ]
      );
      return;
    }
    if (!COVER_EDIT_STEPS.has(msg.step)) return; // 알 수 없는 스텝 방어
    // 연쇄 되감기(편집 중 다른 버블 탭) — 복귀 지점은 최초의 원래 진행 위치 유지
    const resumeStep = rewindRef.current ? rewindRef.current.resumeStep : step;
    rewindRef.current = { idx, target: msg.step, resumeStep };
    console.info('[Cover] 답변 편집 모달 열기', { idx, target: msg.step, resumeStep });
    setEditStep(msg.step);
  };

  // v3.204(④): 편집 모달 선택지 — 각 스텝 입력 영역의 기존 선택지 재사용
  const editChoicesForStep = (s: number): string[] => {
    switch (s) {
      case 1: return ['네, 아티스트 포함', '아니요, 빼고'];
      case 1.5: return ['아티스트①로', '아티스트②로'];
      case 1.7: return ['이 의상 그대로'];
      case 1.75: return ['가사 내용 반영하기', '아니요, 직접 정할게요'];
      case 1.8:
        return [...SHOT_OPTIONS, ...(musicStore.coverCharacterObjectName ? [] : [SHOT_NO_PERSON]), EDIT_SKIP_LABEL];
      case 1.82: return [...EXPRESSION_OPTIONS, EDIT_SKIP_LABEL];
      case 1.85: return [EDIT_SKIP_LABEL];
      case 1.9: return [...PALETTE_OPTIONS, EDIT_SKIP_LABEL];
      case 2: return [...STYLE_OPTIONS, EDIT_STYLE_SKIP_LABEL];
      default: return [];
    }
  };

  // v3.204(④): 특수 버튼 — 1.85(배경) '사진 올리기', 1.7(의상) '꾸미기 가기'
  const editExtraActionsForStep = (s: number): AnswerEditExtraAction[] | undefined => {
    if (s === 1.85) {
      return [{
        label: '사진 올리기',
        onPress: async () => {
          // 업로드 성공 시 handleBgPhoto가 commitRewindAnswer로 커밋 — 그때만 모달 닫기
          // (피커 취소/실패 시 되감기 유지 — 모달에서 계속 고르거나 취소 가능)
          await handleBgPhoto();
          if (!rewindRef.current) setEditStep(null);
        },
      }];
    }
    if (s === 1.7) {
      return [{
        label: '의상 바꾸러 가기 (아티스트 꾸미기)',
        onPress: () => {
          setEditStep(null);
          handleWardrobeChange(); // 화면 이동 흐름 — 내부에서 rewindRef 해제(일반 진행 전환)
        },
      }];
    }
    return undefined;
  };

  // v3.204(④): 편집 모달 onPick — 기존 핸들러 호출 → commitRewindAnswer 치환 + 원위치 복귀.
  // 연쇄(1 '아티스트 포함'→1.5 슬롯)는 핸들러의 setStep을 아래 effect가 감지해 모달 연속 노출.
  const handleEditPick = (choice: string) => {
    const s = editStep;
    if (s == null) return;
    console.info('[Cover] 답변 편집', { step: s, choice });
    setEditStep(null); // 커밋/연쇄 여부와 무관하게 일단 닫기 — 연쇄면 effect가 다시 연다
    switch (s) {
      case 1: handleArtistChoice(choice === '네, 아티스트 포함'); break;
      case 1.5: handleSlotSelect(choice === '아티스트①로' ? 'real' : 'virtual'); break;
      case 1.7: handleWardrobeKeep(); break;
      case 1.75:
        if (choice === '가사 내용 반영하기') handleLyricsUse();
        else handleLyricsSkip();
        break;
      case 1.8: handleShotPick(choice === EDIT_SKIP_LABEL ? null : choice); break;
      case 1.82: handleExpressionPick(choice === EDIT_SKIP_LABEL ? null : choice); break;
      case 1.85:
        if (choice === EDIT_SKIP_LABEL) handleBgSkip();
        else handleBgPick(choice); // 자유 입력(말로 설명)
        break;
      case 1.9: handlePalettePick(choice === EDIT_SKIP_LABEL ? null : choice); break;
      case 2: handleStyleConfirm(choice === EDIT_STYLE_SKIP_LABEL ? '' : choice); break;
    }
  };

  const handleEditCancel = () => {
    const rw = rewindRef.current;
    rewindRef.current = null;
    setEditStep(null);
    // 연쇄 도중 취소(1→1.5 등에서 step이 이동한 상태) — 원래 진행 위치로 복귀
    if (rw && rw.resumeStep !== step) setStep(rw.resumeStep);
  };

  // v3.204(④): 편집 모달 연쇄/종료 동기화 — 되감기 중 핸들러가 setStep으로 연쇄하면
  // (1 '아티스트 포함'→1.5 슬롯) 새 스텝 선택지로 모달을 이어서 연다. 커밋 후에는 항상 닫는다.
  useEffect(() => {
    const rw = rewindRef.current;
    if (!rw) {
      if (editStep != null) setEditStep(null);
      return;
    }
    if (COVER_EDIT_STEPS.has(step)) {
      if (editStep !== step) setEditStep(step);
    } else if (editStep != null) {
      setEditStep(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const proceedToFinal = () => {
    setChatHistory((prev) => [
      ...prev,
      { type: 'director', text: '마지막이에요! 원하는 느낌이나 장면을 자유롭게 적어주세요. 지금까지 고른 것들과 합쳐서 반영돼요.\n이대로 충분하면 바로 만들어도 좋아요!' },
    ]);
    setStep(2);
  };

  // 대화: 곡 선택 → 캐릭터 시트 보유 여부 확인
  // v3.202(H-①/⑤): track을 인자로 전달(stale closure 제거) + 곡 선택 시점부터 store에 컨텍스트
  // 기록(coverTrackId/Title — 재진입 복원용. 생성 대기 판별은 coverStyle 확정까지 요구).
  const handleTrackSelect = async (track: MyTrack) => {
    setSelectedTrack(track);
    if (!albumMode) {
      musicStore.setCoverTrackId(track.id);
      musicStore.setCoverTrackTitle(track.title);
      musicStore.setCoverStyle(null);
    }
    setChatHistory((prev) => [
      ...prev,
      { type: 'user', text: `"${track.title}"`, step: 0 },
    ]);
    await checkCharacterAndProceed(track);
  };

  // 대화: 아티스트 포함 여부 선택 → (둘 다 있으면 슬롯 선택) → 스타일 단계로
  const handleArtistChoice = (include: boolean) => {
    if (!include) {
      musicStore.setCoverCharacterObjectName(null);
      applyExtras({ charKind: null });
      setChosenSlot(null);
      if (commitRewindAnswer('아티스트 빼고')) return; // v3.202(H-④): 값 치환 후 원위치 복귀
      setChatHistory((prev) => [...prev, { type: 'user', text: '아티스트 빼고', step: 1 }]);
      proceedToLyricsQ(undefined, 1); // v3.151: 미포함도 가사 질문부터
      return;
    }
    // v3.81: 아티스트 1명=슬롯 1개 모델 — 두 명 있으면 아티스트 선택(step 1.5), 한 명이면 자동 선택
    if (realObjName && virtualObjName) {
      if (rewindRef.current) {
        // v3.202(H-④): 되감기 중 '포함'+슬롯 2개 — 버블만 갱신하고 슬롯 질문(1.5)으로 연쇄 되감기
        const rw = rewindRef.current;
        setChatHistory((prev) => {
          const next = [...prev];
          if (next[rw.idx]?.type === 'user') next[rw.idx] = { ...next[rw.idx], text: '아티스트 포함' };
          return next;
        });
        rewindRef.current = { ...rw, target: 1.5 };
        setStep(1.5);
        return;
      }
      setChatHistory((prev) => [
        ...prev,
        { type: 'user', text: '아티스트 포함', step: 1 },
        { type: 'director', text: '아티스트가 두 명 있네요! 어느 아티스트로 넣을까요?', echoOfStep: 1 },
      ]);
      setStep(1.5);
      return;
    }
    const obj = realObjName || virtualObjName;
    musicStore.setCoverCharacterObjectName(obj);
    if (__DEV__) console.info('[Cover] 캐릭터 슬롯 자동 선택', { slot: realObjName ? 'real' : 'virtual', obj });
    if (rewindRef.current) {
      // v3.202(H-④): 되감기 중 자동 선택 — 슬롯 종류만 반영하고 원위치 복귀(의상 확인 재진행 없음)
      applyExtras({ charKind: realObjName ? 'real' : 'virtual' });
      setChosenSlot(realObjName ? 'real' : 'virtual');
      commitRewindAnswer('아티스트 포함');
      return;
    }
    setChatHistory((prev) => [...prev, { type: 'user', text: '아티스트 포함', step: 1 }]);
    goWardrobe(realObjName ? 'real' : 'virtual'); // v3.150: 의상 확인 단계
  };

  // v3.80: step 1.5 — 실사화/가상화 슬롯 선택
  const handleSlotSelect = (slot: 'real' | 'virtual') => {
    const obj = slot === 'real' ? realObjName : virtualObjName;
    if (!obj) return;
    musicStore.setCoverCharacterObjectName(obj);
    if (__DEV__) console.info('[Cover] 캐릭터 슬롯 선택', { slot, obj });
    if (rewindRef.current) {
      // v3.202(H-④): 되감기 중 슬롯 변경 — 값 반영 + 버블 치환 후 원위치 복귀
      applyExtras({ charKind: slot });
      setChosenSlot(slot);
      commitRewindAnswer(slot === 'real' ? '아티스트①로' : '아티스트②로');
      return;
    }
    setChatHistory((prev) => [...prev, { type: 'user', text: slot === 'real' ? '아티스트①로' : '아티스트②로', step: 1.5 }]);
    goWardrobe(slot); // v3.150: 의상 확인 단계
  };

  // v3.224: 작업실 이미지 디렉터 대화 중 상단 ← — 작사(LyricsInput)·영상(VideoDirector)과 동일하게
  // focus 시 Studio 탭 헤더 headerLeft 주입(v3.201 불변식: 클리어는 Map focus 승계, blur cleanup 없음).
  // RootStack 의 AlbumCoverGeneration(앨범 커버 모드)은 자체 헤더라 주입하지 않는다.
  useFocusEffect(
    useCallback(() => {
      if (route.name !== 'CoverGeneration') return;
      const parent = navigation.getParent();
      parent?.setOptions({
        headerLeft: () => (
          <TouchableOpacity
            onPress={() => {
              if (__DEV__) console.info('[CoverGeneration] ← 뒤로');
              if (navigation.canGoBack()) navigation.goBack();
              else (navigation as any).popTo('Map');
            }}
            style={{ marginLeft: 12 }}
            accessibilityLabel="뒤로"
          >
            <Feather name="arrow-left" size={22} color={colors.text.primary} />
          </TouchableOpacity>
        ),
      });
    }, [navigation, route.name])
  );

  // v3.150: 꾸미기 다녀온 뒤 focus 복귀 — 의상(시트) 최신화 (step 1.7 대기 중일 때만)
  useFocusEffect(
    useCallback(() => {
      if (step !== 1.7 || !chosenSlot) return;
      (async () => {
        try {
          const res = await api.get('/character/me');
          const ch = res.data?.character;
          const realObj: string | null = ch?.sheet_object_name || null;
          const virtualObj: string | null = ch?.virtual_sheet_object_name || null;
          setRealObjName(realObj);
          setVirtualObjName(virtualObj);
          const cur = chosenSlot === 'real' ? realObj : virtualObj;
          if (cur) {
            musicStore.setCoverCharacterObjectName(cur);
            if (__DEV__) console.info('[Cover] 의상 확인 — 시트 최신화', { slot: chosenSlot });
          }
        } catch (err) {
          console.warn('[Cover] 의상 최신화 실패(기존 시트 유지):', err);
        }
      })();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [step, chosenSlot])
  );

  // 대화: 스타일 확인 → 즉시 생성 (v3.107: 대기열 폐지 — 이 화면의 loading 모드로 직행)
  // v3.118: 커버(image) 디렉터 휴식(쿨다운) 사전 게이트 — 서버 429(⭐ 차감 전)와 동일 다이얼로그.
  // v3.169(대표 확정): refine도 ⭐ 과금(서버 v244) — 피로 게이트는 여전히 미적용(생성만 카운트).
  // v3.228: 진행 중 커버 요청(모듈 기록)이 있는데 추적 가드가 못 잡은 경우의 폴백 — 무반응 대신 같은 안내 팝업
  const blockForActiveCover = (reason: string) => {
    const cur = activeCoverGen;
    logCoverDupBlock(reason, { jobId: cur?.genKey });
    const buttons: Array<{ text: string; style?: 'cancel'; onPress?: () => void }> = [{ text: '닫기', style: 'cancel' }];
    if (cur) buttons.push({ text: '진행 상황 보기', onPress: () => { void openGenJob(cur.genKey, navigation); } });
    showAlert(COVER_TEXT.busyTitle, COVER_TEXT.busyBody, buttons);
  };
  const handleStyleConfirm = async (style: string) => {
    // v3.228 W2: 연타·다이얼로그 연타 재진입(피로 조회 await 사이) + 진행 중 요청 + 추적 중 job(커버·다듬기 한 슬롯)
    if (styleConfirmBusyRef.current) { logCoverDupBlock('style-confirm-reentry'); return; }
    // 추적 중 job(다른 화면의 커버 요청 포함) → 가드 팝업([진행 상황 보기]). 추적 레코드가 안 보이는 진행 중 요청도 같은 팝업
    if (guardGeneration('cover', { navigation, where: 'CoverGeneration' })) { logCoverDupBlock('tracked-job'); return; }
    if (activeCoverGen) { blockForActiveCover('in-flight'); return; }
    styleConfirmBusyRef.current = true;
    try {
      await handleStyleConfirmInner(style);
    } finally {
      styleConfirmBusyRef.current = false;
    }
  };
  const handleStyleConfirmInner = async (style: string) => {
    setStyleInput(style);
    // v3.120: 앨범 모드는 트랙 선택이 없음 — 컨텍스트는 albumMode 파라미터에서
    const trackId = albumMode ? null : (selectedTrack?.id || musicStore.coverTrackId);
    const trackTitle = albumMode ? null : (selectedTrack?.title || musicStore.coverTrackTitle);
    if (!albumMode && !trackId) {
      showAlert('오류', '곡을 먼저 선택해주세요.');
      setStep(0);
      return;
    }
    try {
      const fatigueStatus = await getFatigueStatus('image');
      const remain = Math.max(0, Math.floor(fatigueStatus?.cooldown_remaining_sec ?? 0));
      if (remain > 0) {
        console.log('[Cover] [fatigue:image] 게이트 — 남은', remain, '초');
        showFatigueCooldownDialog({
          status: fatigueStatus,
          remainingSec: remain,
          director: 'image',
          onCleared: () => handleStyleConfirm(style), // 해제 후 같은 스타일로 재시도
        });
        return;
      }
    } catch (err: any) {
      // 조회 실패는 게이트 오픈 — 서버 429가 최종 방어 (doGenerate catch에서 동일 다이얼로그)
      console.warn('[Cover] [fatigue:image] 상태 조회 실패:', err?.response?.status, err?.message);
    }
    // v3.120: 앨범 모드는 musicStore cover* 미사용 (이탈 후 재진입 이어보기 없음 — 재진입 시 새 대화)
    if (!albumMode) {
      musicStore.setCoverTrackId(trackId);
      musicStore.setCoverTrackTitle(trackTitle || '');
      musicStore.setCoverStyle(style);
    }
    // v3.80: 재생성 경로 — doGenerate 정리부에서 비워진 슬롯 선택을 복원 (재생성은 선택 유지)
    if (useMusicStore.getState().coverCharacterObjectName == null && lastCharObjRef.current) {
      if (__DEV__) console.info('[Cover] 재생성: 캐릭터 슬롯 선택 복원', { obj: lastCharObjRef.current });
      musicStore.setCoverCharacterObjectName(lastCharObjRef.current);
    }
    // v3.202(H-④): 스타일 버블 되감기 중이면 버블 치환(에코 보존) 후 바로 생성 진행
    if (!commitRewindAnswer(style || '이대로 만들어주세요')) {
      setChatHistory((prev) => [
        ...prev,
        { type: 'user', text: style || '이대로 만들어주세요', step: 2 },
        { type: 'director', text: '커버 작업을 시작할게요! 곧 결과를 보여드릴게요.', echoOfStep: 2 },
      ]);
    }
    // v3.107: 대기열 타이머 폐지 — 즉시 생성 시작. musicStore의 cover* 필드는 유지해서
    // 생성 도중 화면 이탈 후 재진입 시 hasPendingGeneration 경로로 이어보기 가능.
    console.log('[Cover] 커버 생성 시작 — 즉시 doGenerate (대기열 없음)', albumMode ? '(앨범 모드)' : '');
    doGenerate(trackId || '', albumMode ? albumMode.albumTitle : (trackTitle || ''), style);
  };

  // 결과: 확정 — 트랙 모드: PUT /tracks/{id}로 cover_image_url 업데이트.
  // v3.120 앨범 모드: PATCH /albums/{id}/cover(objectName=본인 세션 산출물, v216 계약)
  //   → 성공 시 AlbumDetail로 복귀 (useFocusEffect가 앨범을 재조회해 커버 갱신).
  const handleConfirm = async () => {
    if (albumMode) {
      if (!coverObjectName || applying) return;
      setApplying(true);
      try {
        await updateAlbumCover(albumMode.albumId, { coverObjectName });
        console.log('[Cover] 앨범 커버 적용 성공:', albumMode.albumId, coverObjectName);
        showAlert('완료', '앨범 커버가 변경되었습니다!', [
          { text: '확인', onPress: () => navigation.goBack() },
        ]);
      } catch (err: any) {
        console.error('[Cover] 앨범 커버 적용 실패:', err?.response?.status, err?.message);
        showAlert('오류', err?.response?.data?.error || '앨범 커버 적용에 실패했습니다.');
      } finally {
        setApplying(false);
      }
      return;
    }
    const trackId = selectedTrack?.id || musicStore.coverTrackId;
    if (coverObjectName && trackId) {
      try {
        await api.put(`/tracks/${trackId}`, { cover_image_url: coverObjectName });
        console.log('[Cover] 트랙에 커버 연결 성공:', trackId, coverObjectName);
      } catch (err: any) {
        console.error('[Cover] 연결 실패:', err?.message);
      }
    }
    useGemsStore.getState().earn(GEM_REWARDS.TRACK_COVER_DONE, 'track_cover_done', String(trackId ?? ''));
    showAlert('완료', '커버 이미지가 저장되었습니다!');
    navigation.popToTop();
  };

  // v3.204(⑤): refine 네트워크 단절 복구 — POST /upload/refine-cover가 서버에서 132~141초 걸려
  // 클라이언트 연결이 먼저 끊겨도(실측 ERR_NETWORK) 서버는 정상 완료 + ⭐5 차감을 마친다
  // (9/22 03:05 이중 차감 실측). 실패 확정 대신 GET /upload/cover-history/{id}를 15초×최대 12회
  // (v3.202 I-lite와 동일 리듬) 폴링해 current_version > 요청 직전 기준선이면 완성본을 회수한다
  // — 재요청 금지 = 재차감 금지. 응답 계약: {current_version, cover_object_name, cover_refine_history}.
  // v3.228 W2: 매 회차 서버 원장(GET /generate/jobs/req/{rid}) 먼저 — done 이면 cover-history 로 반영, failed 면
  // 서버 확정 실패(환불 여부는 서버 값), processing 이면 서버 상한(15분)까지 연장. 원장 없음(구서버)은 기존 폴링 그대로.
  const tryRecoverRefineFromHistory = async (
    sessionId: string, baseVersion: number, rp: string, requestId?: string | null
  ): Promise<{ kind: 'recovered'; obj: string; version: number } | { kind: 'failed'; error: string | null; refunded: boolean | null; notCharged: boolean | null } | { kind: 'none' }> => {
    const POLL_INTERVAL_MS = 15000;
    const startedAt = Date.now();
    let deadline = startedAt + 12 * POLL_INTERVAL_MS;
    let ledgerSeen = false;
    for (let attempt = 1; Date.now() <= deadline; attempt++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      if (requestId) {
        let snap: GenJobSnapshot | null | undefined;
        try {
          snap = await fetchImageJob({ kind: 'cover_refine', requestId });
        } catch {
          snap = undefined;
        }
        if (snap?.status === 'failed') {
          return { kind: 'failed', error: snap.error ?? null, refunded: snap.refunded ?? null, notCharged: snap.notCharged ?? null };
        }
        if (snap?.status === 'processing') {
          if (!ledgerSeen) {
            ledgerSeen = true;
            deadline = Math.max(deadline, startedAt + COVER_CAP_MS);
            console.info('[GenJob:cover] 다듬기 원장 진행 중 — 상한까지 추적', { attempt });
          }
          continue;
        }
        // done·원장 없음 → cover-history 로 결과 반영(기존 경로)
      }
      try {
        const res = await api.get(`/upload/cover-history/${sessionId}`);
        const currentVersionSrv: number | null =
          typeof res.data?.current_version === 'number' ? res.data.current_version : null;
        const obj: string | null = res.data?.cover_object_name ?? null;
        console.info('[Cover] refine 폴링 복구', { attempt, baseVersion, currentVersion: currentVersionSrv });
        if (currentVersionSrv !== null && currentVersionSrv > baseVersion && obj) {
          setCoverObjectName(obj);
          setCoverImageUrl(coverPreviewUrl(obj));
          setCurrentVersion(currentVersionSrv);
          setViewVersion(currentVersionSrv);
          const serverHistory = res.data?.cover_refine_history;
          if (Array.isArray(serverHistory) && serverHistory.length > 0) {
            setCoverHistory(serverHistory);
          } else {
            // 응답에 히스토리가 없으면 로컬로 push (defensive — handleRefine 성공 경로 관행)
            setCoverHistory((prev) => [
              ...prev,
              { version: currentVersionSrv, object_name: obj, refine_prompt: rp, created_at: new Date().toISOString() },
            ]);
          }
          usePointsStore.getState().fetchBalance(); // 서버는 이미 차감 완료 — 잔액 표시 동기화
          return { kind: 'recovered', obj, version: currentVersionSrv };
        }
      } catch (pollErr: any) {
        console.warn('[Cover] refine 폴링 복구 조회 실패', {
          attempt, status: pollErr?.response?.status, code: pollErr?.code,
        });
      }
    }
    return { kind: 'none' };
  };

  // v3.89: 미세조정 — 텍스트 지시로 현재 커버를 다듬어 새 버전 생성 (multi-turn i2i)
  const handleRefine = async () => {
    const rp = refineInput.trim();
    if (!rp || refining || reverting) return;
    if (refineSubmitGuardRef.current) return; // v3.204(⑤): confirm 대기 중 재진입(Enter/적용) 무시
    if (!coverSessionId) {
      showAlert('안내', '커버 세션 정보가 없어요. 다시 생성 후 시도해주세요.');
      return;
    }
    if (rp.length > REFINE_PROMPT_MAX_LEN) {
      showAlert('입력 확인', `수정 요청은 ${REFINE_PROMPT_MAX_LEN}자 이하로 입력해주세요.`);
      return;
    }
    // v3.228 W2: 추적 중 이미지 job(커버·다듬기 한 슬롯)이 있으면 [닫기]/[진행 상황 보기] — 과금 확인보다 먼저
    if (guardGeneration('cover_refine', { navigation, where: 'CoverGeneration.refine' })) {
      logCoverDupBlock('refine-tracked-job');
      return;
    }
    if (activeCoverGen) { blockForActiveCover('refine-while-cover-in-flight'); return; }
    // v3.204(⑤): 이중 제출 봉인 — confirm await 앞에서 세팅, 취소·완료·실패 전 경로 finally 해제
    refineSubmitGuardRef.current = true;
    try {
      // v3.169(대표 확정): 미세조정도 ⭐ 소모 — 실행 전 confirm (서버에 키 없으면 무고지·바로 진행)
      if (typeof refineCost === 'number') {
        const ok = await new Promise<boolean>((resolve) => {
          showAlert('미세조정', `미세조정 시 ⭐${refineCost}이 소모돼요. 진행할까요?`, [
            { text: '취소', style: 'cancel', onPress: () => resolve(false) },
            { text: '진행', onPress: () => resolve(true) },
          ]);
        });
        if (!ok) return;
      }
      setRefining(true);
      console.log('[Cover] refine-cover 요청', { cover_session_id: coverSessionId, len: rp.length });
      const t0 = Date.now();
      const baseVersion = currentVersion; // v3.204(⑤): 폴링 회수 판정 기준선 (요청 직전 버전)
      // v3.228 W2: 서버 원장 요청 ID — POST 직전 발급·추적 등록(이탈해도 도착 알림 → 회수 진입으로 결과 확인)
      const requestId = newRequestId();
      const genKey = registerGenJob({
        kind: 'cover_refine',
        requestId,
        meta: {
          cover_session_id: coverSessionId, base_version: baseVersion,
          ...(albumMode
            ? { album_id: albumMode.albumId, album_title: albumMode.albumTitle }
            : { track_id: selectedTrack?.id || musicStore.coverTrackId || null, track_title: selectedTrack?.title || null }),
        },
      });
      viewJob(genKey);
      try {
        const res = await api.post(
          '/upload/refine-cover',
          { cover_session_id: coverSessionId, refine_prompt: rp },
          { timeout: 600000, headers: genRequestHeaders(requestId) } // 이미지 모델이 느릴 수 있음 — generate와 동일하게 10분
        );
        // defensive 파싱 — 서버 응답이 예상과 다르면 기존 버전 유지
        const newObj: string | null = res.data?.cover_object_name ?? null;
        const newVer: number | null =
          typeof res.data?.current_version === 'number' ? res.data.current_version : null;
        if (!newObj || newVer === null) {
          throw new Error('서버 응답 형식이 올바르지 않습니다.');
        }
        console.log('[Cover] refine-cover OK', Date.now() - t0, 'ms', {
          cover_session_id: coverSessionId, version: newVer,
        });
        setCoverObjectName(newObj);
        setCoverImageUrl(coverPreviewUrl(newObj));
        setCurrentVersion(newVer);
        setViewVersion(newVer);
        const serverHistory = res.data?.cover_refine_history;
        if (Array.isArray(serverHistory) && serverHistory.length > 0) {
          setCoverHistory(serverHistory);
        } else {
          // 응답에 히스토리가 없으면 로컬로 push (defensive)
          setCoverHistory((prev) => [
            ...prev,
            { version: newVer, object_name: newObj, refine_prompt: rp, created_at: new Date().toISOString() },
          ]);
        }
        usePointsStore.getState().fetchBalance(); // v3.169: ⭐ 차감 반영
        setRefineInput('');
        // 화면을 벗어난 뒤 도착했으면 ack 하지 않음 → 추적기가 작업실에서 도착 알림(회수 진입으로 확인)
        markGenJobDone(genKey, {
          cover_session_id: coverSessionId, cover_object_name: newObj,
          image_url: res.data?.image_url ?? null, current_version: newVer,
        }, { acked: mountedRef.current, serverJobId: genLedgerFields(res.data).genJobId });
      } catch (err: any) {
        console.error('[Cover] refine-cover FAIL', {
          cover_session_id: coverSessionId,
          message: err?.message,
          code: err?.code,
          status: err?.response?.status,
          data: err?.response?.data,
        });
        // v3.228 W2: 409 generation_in_progress(커버·다듬기 한 슬롯) — 원장 전 거절(무과금), 진행 중 job 편입
        const inProgress = parseGenInProgress(err, 'cover_refine');
        if (inProgress) {
          logCoverDupBlock('refine-server-409', { kind: inProgress.kind, jobId: inProgress.jobId });
          const adoptedKey = adoptGenJob(inProgress, { replaceKey: genKey });
          const text = inProgress.kind === 'cover' ? COVER_TEXT : COVER_REFINE_TEXT;
          showAlert(text.busyTitle, text.busyBody, [
            { text: '닫기', style: 'cancel' },
            { text: '진행 상황 보기', onPress: () => { void openGenJob(adoptedKey, navigation); } },
          ]);
          return;
        }
        // v3.204(⑤): 네트워크 단절/타임아웃 — 실패 확정 전에 서버 완성본 폴링 회수 시도
        // (v3.228: 게이트웨이 HTML 5xx 도 서버 처리 여부 미확정 → 같은 경로)
        if (isRecoverableNetErr(err) || isGatewayErr(err)) {
          setRefinePollingNotice('연결이 불안정했어요. 서버에서 완성본을 확인하고 있어요…');
          const recovered = await tryRecoverRefineFromHistory(coverSessionId, baseVersion, rp, requestId);
          setRefinePollingNotice(null);
          if (recovered.kind === 'recovered') {
            setRefineInput(''); // 회수 = 성공 처리 (재요청 없음 = 재차감 없음)
            markGenJobDone(genKey, {
              cover_session_id: coverSessionId, cover_object_name: recovered.obj, current_version: recovered.version,
            }, { acked: mountedRef.current });
            return;
          }
          endGenRequest(genKey); // 화면 확인 종료 → 이후는 전역 추적기가 원장으로 판정
          if (recovered.kind === 'failed') {
            settleGenJob('cover_refine', genKey, 'failed', { error: recovered.error, refunded: recovered.refunded });
            usePointsStore.getState().fetchBalance();
            showAlert(
              '미세조정 실패',
              `${COVER_REFINE_TEXT.failTitle}. ${failureBody(recovered.error, recovered.refunded, recovered.notCharged)}` +
                '\n기존 버전은 그대로 유지돼요.'
            );
            return;
          }
          console.warn('[Cover] refine 폴링 복구 실패 — 오류 확정');
          showAlert(
            '미세조정 실패',
            (err?.response?.data?.error || err?.message || '커버 수정에 실패했습니다.') +
              '\n기존 버전은 그대로 유지돼요.' +
              '\n별이 이미 사용됐다면 버전 기록에 잠시 후 나타날 수 있어요.'
          );
          return;
        }
        // 서버가 명시적으로 답한 실패 — 원장 있는 5xx 는 서버 실패 확정(서버 환불 처리), 그 외는 원장 전 거절
        const st = err?.response?.status;
        if (typeof st === 'number' && st >= 500 && genLedgerFields(err?.response?.data).genJobId) {
          settleGenJob('cover_refine', genKey, 'failed', { error: err?.response?.data?.error ?? null });
        } else {
          discardGenJob(genKey, isRequestAlreadyFailed(err) ? 'refine-request-already-failed' : `refine-${st ?? 'error'}`);
        }
        showAlert(
          '미세조정 실패',
          (err?.response?.data?.error || err?.message || '커버 수정에 실패했습니다.') +
            '\n기존 버전은 그대로 유지돼요.'
        );
      } finally {
        setRefining(false);
        if (viewerKeyRef.current === genKey) viewJob(null);
      }
    } finally {
      refineSubmitGuardRef.current = false;
    }
  };

  // v3.89: 이전 버전으로 되돌리기 — 서버 세션의 current_version을 바꿔야
  // 이후 refine이 해당 버전을 기반으로 동작 (백엔드 refine은 세션의 cover_object_name을 base로 사용)
  const handleUseVersion = async (targetVersion: number) => {
    if (!coverSessionId || refining || reverting || targetVersion === currentVersion) return;
    setReverting(true);
    console.log('[Cover] revert-cover 요청', { cover_session_id: coverSessionId, target_version: targetVersion });
    try {
      const res = await api.post('/upload/revert-cover', {
        cover_session_id: coverSessionId,
        target_version: targetVersion,
      });
      const newObj: string | null = res.data?.cover_object_name ?? null;
      if (!newObj) throw new Error('서버 응답 형식이 올바르지 않습니다.');
      const newVer: number =
        typeof res.data?.current_version === 'number' ? res.data.current_version : targetVersion;
      console.log('[Cover] revert-cover OK', { cover_session_id: coverSessionId, version: newVer });
      setCoverObjectName(newObj);
      setCoverImageUrl(coverPreviewUrl(newObj));
      setCurrentVersion(newVer);
      setViewVersion(newVer);
    } catch (err: any) {
      console.warn('[Cover] revert-cover FAIL', {
        cover_session_id: coverSessionId,
        message: err?.message,
        status: err?.response?.status,
        data: err?.response?.data,
      });
      showAlert('버전 변경 실패', err?.response?.data?.error || err?.message || '버전 되돌리기에 실패했습니다.');
    } finally {
      setReverting(false);
    }
  };

  // 결과: 다시 생성 → 대화 이어서 (v3.202(H-③): 전체 와이프 제거 — 실패·429 공통)
  // 기존 대화에 디렉터 안내만 append하고, 사용자가 마지막으로 답한 스텝(없으면 트랙을 알면
  // 가사 질문 1.75, 아니면 0)으로 복귀. resetCoverExtras는 '곡 변경(step 0)' 명시 액션에만.
  const doRegenerate = () => {
    setCoverImageUrl(null);
    setErrorMsg(null);
    setStyleInput('');
    rewindRef.current = null;
    const lastAnswered = [...chatHistory].reverse().find((m) => m.type === 'user' && m.step != null);
    const target = lastAnswered?.step ?? ((selectedTrack?.id || musicStore.coverTrackId) ? 1.75 : 0);
    console.info('[Cover] 다시 생성 — 대화 보존 복귀', { target });
    setMode('dialogue');
    setChatHistory((prev) => [
      ...prev,
      { type: 'director', text: '좋아요, 이어서 바꿔볼까요? 방금 답부터 다시 고르거나, 이전 답변 말풍선을 탭해서 그 부분만 수정할 수 있어요.' },
    ]);
    setStep(target);
  };

  const handleRegenerate = () => {
    // v3.89: 수정 이력이 있으면 폐기 확인 (재생성 시 백엔드가 신규 세션 발급 → 옛 history 폐기)
    if (coverHistory.length > 1) {
      showAlert(
        '다시 생성할까요?',
        `다시 생성하면 지금까지의 수정 이력 ${coverHistory.length}개가 폐기됩니다. 이 동작은 되돌릴 수 없어요.`,
        [
          { text: '취소', style: 'cancel' },
          { text: '다시 생성', style: 'destructive', onPress: doRegenerate },
        ]
      );
      return;
    }
    doRegenerate();
  };

  // ─── 로딩 화면 (MusicLoadingScreen과 동일) ───
  if (mode === 'loading') {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContent}>
          <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
            <View style={styles.loadingPortrait}>
              <Image source={IMAGE_PORTRAIT} style={styles.loadingPortraitImage} />
            </View>
          </Animated.View>
          {/* v3.202(I-lite): 네트워크 단절 복구 폴링 중에는 디렉터 대기 안내로 대체 */}
          <AppText style={styles.loadingText}>{recoveryNotice ?? trackNotice?.text ?? LOADING_STEPS[loadingMsgIndex].message}</AppText>
          <ActivityIndicator size="large" color={colors.accent.primary} style={{ marginTop: 20 }} />

          {/* 스텝 인디케이터 */}
          <View style={styles.stepRow}>
            {LOADING_STEPS.map((s, i) => {
              const state = i < loadingMsgIndex ? 'done' : i === loadingMsgIndex ? 'active' : 'pending';
              return (
                <View key={s.label} style={styles.stepItem}>
                  <View
                    style={[
                      styles.stepDot,
                      state === 'active' && styles.stepDotActive,
                      state === 'done' && styles.stepDotDone,
                    ]}
                  >
                    <AppText style={styles.stepDotText}>
                      {state === 'done' ? '✓' : i + 1}
                    </AppText>
                  </View>
                  <AppText
                    style={[
                      styles.stepLabel,
                      state === 'active' && styles.stepLabelActive,
                      state === 'done' && styles.stepLabelDone,
                    ]}
                    numberOfLines={1}
                  >
                    {s.label}
                  </AppText>
                </View>
              );
            })}
          </View>

          <View style={styles.loadingNote}>
            <AppText style={styles.loadingNoteText}>
              {recoveryNotice
                ? '연결이 잠시 불안정했어요. 서버에서 완성된 이미지를 확인하고 있어요.\n추가 비용 없이 그대로 가져올게요.'
                : trackNotice
                  ? trackNotice.note
                  : `이미지 디렉터가 ${loadingMsgIndex + 1}/${LOADING_STEPS.length} 단계를 진행 중이에요.\n작업이 끝날 때까지 이 화면을 벗어나지 마세요.`}
            </AppText>
          </View>
        </View>
      </View>
    );
  }

  // ─── 결과 화면 (MusicResultScreen과 동일 패턴) ───
  if (mode === 'result') {
    // v3.89: 버전 히스토리 — 오름차순 정렬 후 보고 있는 버전의 엔트리로 이미지 표시
    const sortedHistory = [...coverHistory].sort((a, b) => (a.version ?? 0) - (b.version ?? 0));
    const viewIdx = sortedHistory.findIndex((e) => e.version === viewVersion);
    const viewedEntry = viewIdx >= 0 ? sortedHistory[viewIdx] : null;
    const displayedUri = viewedEntry ? coverPreviewUrl(viewedEntry.object_name) : coverImageUrl;
    const isViewingCurrent = !viewedEntry || viewVersion === currentVersion;
    const busy = refining || reverting || applying;
    const canRefine = !!coverSessionId && !errorMsg && !!coverImageUrl;

    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 40 : 0}
      >
        <ScrollView contentContainerStyle={[styles.resultContent, { paddingTop: insets.top + 16 }]}>
          {/* 디렉터 메시지 */}
          <View style={styles.directorRow}>
            <View style={styles.portraitCircle}>
              <Image source={IMAGE_PORTRAIT} style={styles.portraitCircleImage} />
            </View>
            <View style={styles.directorBubble}>
              <AppText style={styles.directorName}>이미지 디렉터</AppText>
              <AppText style={styles.directorText}>
                {errorMsg
                  ? '앗, 문제가 생겼어요. 다시 시도해볼까요?'
                  : refining
                    ? '요청하신 부분을 다듬는 중이에요. 작업이 끝날 때까지 이 화면을 벗어나지 마세요.'
                    : canRefine
                      ? '커버 이미지가 완성됐어요! 마음에 안 드는 부분이 있나요? 말해주시면 바로 다듬어 드릴게요.'
                      : '커버 이미지가 완성됐어요!'}
              </AppText>
            </View>
          </View>

          {/* 에러 */}
          {errorMsg && (
            <View style={styles.errorBox}>
              <AppText style={styles.errorText}>{errorMsg}</AppText>
            </View>
          )}

          {/* 결과 이미지 + 버전 표시 */}
          {displayedUri && !errorMsg && (
            <View style={styles.resultCard}>
              <Image source={{ uri: displayedUri }} style={styles.resultImage} />
              {refining && (
                <View style={styles.refiningOverlay}>
                  <ActivityIndicator size="large" color={colors.accent.primary} />
                </View>
              )}
              {/* v3.89: 버전 히스토리 내비게이션 (◀ 버전 N ▶) */}
              {coverSessionId && sortedHistory.length > 0 && (
                <>
                  <View style={styles.versionRow}>
                    <TouchableOpacity
                      style={[styles.versionArrow, (viewIdx <= 0 || busy) && styles.versionArrowDisabled]}
                      disabled={viewIdx <= 0 || busy}
                      onPress={() => setViewVersion(sortedHistory[viewIdx - 1].version)}
                    >
                      <AppText style={styles.versionArrowText}>◀</AppText>
                    </TouchableOpacity>
                    <AppText style={styles.versionLabel}>
                      버전 {viewVersion}
                      {viewVersion === 0 ? ' (원본)' : ''}
                      {sortedHistory.length > 1 && isViewingCurrent ? ' · 현재' : ''}
                    </AppText>
                    <TouchableOpacity
                      style={[
                        styles.versionArrow,
                        (viewIdx < 0 || viewIdx >= sortedHistory.length - 1 || busy) && styles.versionArrowDisabled,
                      ]}
                      disabled={viewIdx < 0 || viewIdx >= sortedHistory.length - 1 || busy}
                      onPress={() => setViewVersion(sortedHistory[viewIdx + 1].version)}
                    >
                      <AppText style={styles.versionArrowText}>▶</AppText>
                    </TouchableOpacity>
                  </View>
                  {!!viewedEntry?.refine_prompt && (
                    <AppText style={styles.versionPrompt} numberOfLines={1}>
                      "{viewedEntry.refine_prompt}"
                    </AppText>
                  )}
                </>
              )}
            </View>
          )}

          {/* v3.89: 미세조정 입력 — 현재 버전을 보고 있을 때만 (refine은 서버 세션의 현재 커버 기반) */}
          {canRefine && isViewingCurrent && (
            <View style={styles.refineBox}>
              <AppText style={styles.refineTitle}>미세조정</AppText>
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.textInput}
                  value={refineInput}
                  onChangeText={setRefineInput}
                  placeholder="예: 배경을 밤하늘로 바꿔줘"
                  placeholderTextColor={colors.text.muted}
                  maxLength={REFINE_PROMPT_MAX_LEN}
                  editable={!busy}
                  onSubmitEditing={handleRefine}
                />
                <TouchableOpacity
                  style={[styles.sendBtn, (busy || !refineInput.trim()) && { opacity: 0.4 }]}
                  onPress={handleRefine}
                  disabled={busy || !refineInput.trim()}
                >
                  {refining ? (
                    <ActivityIndicator size="small" color={colors.text.primary} />
                  ) : (
                    <AppText style={styles.sendBtnText}>적용</AppText>
                  )}
                </TouchableOpacity>
              </View>
              {(refining || refinePollingNotice) && (
                <AppText style={styles.refineHint}>
                  {/* v3.204(⑤): 폴링 회수 중에는 상황 안내로 대체 */}
                  {refinePollingNotice ?? '커버를 다듬고 있어요. 몇 분 정도 걸릴 수 있어요.'}
                </AppText>
              )}
            </View>
          )}

          {/* 버튼 */}
          <View style={styles.buttonContainer}>
            {/* v3.89: 이전 버전을 보는 중 → "이 버전 사용" (서버 세션 되돌리기) */}
            {canRefine && !isViewingCurrent && (
              <TouchableOpacity
                style={[styles.saveButton, busy && { opacity: 0.5 }]}
                onPress={() => handleUseVersion(viewVersion)}
                disabled={busy}
              >
                <AppText style={styles.saveButtonText}>
                  {reverting ? '되돌리는 중...' : '이 버전 사용'}
                </AppText>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[styles.regenerateButton, busy && { opacity: 0.5 }]}
              onPress={handleRegenerate}
              disabled={busy}
            >
              <AppText style={styles.regenerateButtonText}>다시 생성하기</AppText>
            </TouchableOpacity>

            {coverImageUrl && isViewingCurrent && (
              <TouchableOpacity
                style={[styles.saveButton, busy && { opacity: 0.5 }]}
                onPress={handleConfirm}
                disabled={busy}
              >
                <AppText style={styles.saveButtonText}>
                  {applying ? '적용 중...' : albumMode ? '앨범 커버로 확정' : '커버 이미지 확정'}
                </AppText>
              </TouchableOpacity>
            )}

            {/* v3.120: 앨범 모드는 RootStack 진입 — popToTop 대신 goBack으로 AlbumDetail 복귀 */}
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => (albumMode ? navigation.goBack() : navigation.popToTop())}
              disabled={busy}
            >
              <AppText style={styles.backButtonText}>{albumMode ? '앨범으로 돌아가기' : '맵으로 돌아가기'}</AppText>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ─── 대화 화면 ───
  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 140 : 80}>
      <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={[{ padding: 16 }, { paddingTop: insets.top + 16 }]} showsVerticalScrollIndicator={false}>
        {chatHistory.map((msg, idx) => (
          <View key={idx} style={[styles.messageRow, msg.type === 'user' ? styles.userRow : styles.dirRow]}>
            {msg.type === 'director' && (
              <View style={styles.smallPortrait}><Image source={IMAGE_PORTRAIT} style={styles.smallPortraitImg} /></View>
            )}
            {/* v3.151: step 태그 답변은 탭 → 그 단계부터 다시 선택 */}
            <TouchableOpacity
              style={[styles.bubble, msg.type === 'user' ? styles.userBubble : styles.dirBubble]}
              activeOpacity={msg.type === 'user' && msg.step != null ? 0.6 : 1}
              disabled={!(msg.type === 'user' && msg.step != null)}
              onPress={() => handleUserBubbleTap(idx)}
            >
              <AppText style={[styles.bubbleText, msg.type === 'user' ? { color: colors.text.primary } : { color: colors.bg.deepest }]}>{msg.text}</AppText>
              {msg.type === 'user' && msg.step != null && (
                <AppText style={styles.editHint}>탭해서 수정</AppText>
              )}
            </TouchableOpacity>
          </View>
        ))}
        {/* v3.229 [CoverDraft]: 복원 안내 버블 — 디렉터 대화 톤 + 인라인 '처음부터' 액션(다른 디렉터와 동일 UX) */}
        {showResumeNotice && (
          <View style={[styles.messageRow, styles.dirRow]}>
            <View style={styles.smallPortrait}><Image source={IMAGE_PORTRAIT} style={styles.smallPortraitImg} /></View>
            <View style={[styles.bubble, styles.dirBubble]}>
              <AppText style={[styles.bubbleText, { color: colors.bg.deepest }]}>
                진행하던 커버 작업을 이어서 할게요! 새로 시작하고 싶으면 아래 버튼을 눌러주세요.
              </AppText>
              <TouchableOpacity
                style={styles.restartInlineBtn}
                onPress={handleRestartCover}
                accessibilityLabel="처음부터"
              >
                <AppText style={styles.restartInlineBtnText}>처음부터</AppText>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>

      {/* 입력 영역 */}
      <View style={styles.inputArea}>
        {trackLoading ? (
          <ActivityIndicator size="large" color={colors.accent.primary} />
        ) : step === 0 ? (
          tracks.length === 0 ? (
            <AppText style={{ color: colors.text.secondary, textAlign: 'center', paddingVertical: 20 }}>곡이 없어요. 먼저 곡을 만들어주세요!</AppText>
          ) : (
            <ScrollView style={{ maxHeight: 200 }} showsVerticalScrollIndicator={false}>
              {tracks.map((t) => (
                <TouchableOpacity key={t.id} style={styles.trackOption} onPress={() => handleTrackSelect(t)}>
                  <AppText style={{ color: colors.text.primary, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{t.title}</AppText>
                  <AppText style={{ color: colors.text.secondary, fontSize: 12 }}>{(t.cover_image || t.cover_image_url) ? '커버 있음 (재생성 가능)' : '커버 없음'}</AppText>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )
        ) : step === 1 ? (
          // 9004: 아티스트 포함 여부 선택 (캐릭터 시트 있을 때만 보임)
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity
              style={[styles.chip, styles.choiceChip]}
              onPress={() => handleArtistChoice(true)}
            >
              <AppText style={styles.choiceChipText}>네, 아티스트 포함</AppText>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.chip, styles.choiceChip, styles.choiceChipAlt]}
              onPress={() => handleArtistChoice(false)}
            >
              <AppText style={styles.choiceChipTextAlt}>아니요, 빼고</AppText>
            </TouchableOpacity>
          </View>
        ) : step === 1.5 ? (
          // v3.81: 아티스트 선택 카드 (두 명 있을 때만 진입) — v3.82: kind 병기 제거, 썸네일로 구분
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity style={styles.slotCard} onPress={() => handleSlotSelect('real')} activeOpacity={0.8}>
              {realObjName ? (
                <Image
                  source={{ uri: `${BACKEND_BASE_URL}/api/character/preview/${realObjName}` }}
                  style={styles.slotCardImg}
                />
              ) : null}
              <AppText style={styles.slotCardLabel}>아티스트①</AppText>
            </TouchableOpacity>
            <TouchableOpacity style={styles.slotCard} onPress={() => handleSlotSelect('virtual')} activeOpacity={0.8}>
              {virtualObjName ? (
                <Image
                  source={{ uri: `${BACKEND_BASE_URL}/api/character/preview/${virtualObjName}` }}
                  style={styles.slotCardImg}
                />
              ) : null}
              <AppText style={styles.slotCardLabel}>아티스트②</AppText>
            </TouchableOpacity>
          </View>
        ) : step === 1.7 ? (
          // v3.150: 의상 확인 — 선택 슬롯 시트 미리보기 + 그대로/꾸미기 연동
          <>
            {(() => {
              const obj = chosenSlot === 'virtual' ? virtualObjName : realObjName;
              return obj ? (
                <Image
                  source={{ uri: `${BACKEND_BASE_URL}/api/character/preview/${obj}?t=${chatHistory.length}` }}
                  style={styles.wardrobePreview}
                />
              ) : null;
            })()}
            <TouchableOpacity style={styles.optionBtn} onPress={handleWardrobeKeep} activeOpacity={0.8}>
              <AppText style={styles.optionBtnText}>이 의상 그대로 갈게요</AppText>
            </TouchableOpacity>
            <TouchableOpacity style={styles.optionBtnOutline} onPress={handleWardrobeChange} activeOpacity={0.8}>
              <AppText style={styles.optionBtnOutlineText}>의상 바꾸러 가기 (아티스트 꾸미기)</AppText>
            </TouchableOpacity>
          </>
        ) : step === 1.8 ? (
          // v3.150: 구도 — 선택사항. v3.168(대표): 직접 입력창 추가
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
              {[...SHOT_OPTIONS, ...(musicStore.coverCharacterObjectName ? [] : [SHOT_NO_PERSON])].map((s) => (
                <TouchableOpacity key={s} style={styles.chip} onPress={() => handleShotPick(s)}>
                  <AppText style={styles.chipText}>{s}</AppText>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={styles.chip} onPress={() => handleShotPick(null)}>
                <AppText style={styles.chipText}>건너뛰기</AppText>
              </TouchableOpacity>
            </ScrollView>
            <View style={styles.inputRow}>
              <TextInput style={styles.textInput} value={shotText} onChangeText={setShotText} placeholder="직접 입력 (예: 로우앵글에서 올려다본 전신 샷)" placeholderTextColor={colors.text.muted} onSubmitEditing={() => shotText.trim() && handleShotPick(shotText.trim())} />
              <TouchableOpacity style={[styles.sendBtn, !shotText.trim() && { opacity: 0.4 }]} onPress={() => shotText.trim() && handleShotPick(shotText.trim())} disabled={!shotText.trim()}>
                <AppText style={styles.sendBtnText}>확인</AppText>
              </TouchableOpacity>
            </View>
          </>
        ) : step === 1.82 ? (
          // v3.169(대표): 인물 표정 — 선택사항 + 직접 입력
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
              {EXPRESSION_OPTIONS.map((ex) => (
                <TouchableOpacity key={ex} style={styles.chip} onPress={() => handleExpressionPick(ex)}>
                  <AppText style={styles.chipText}>{ex}</AppText>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={styles.chip} onPress={() => handleExpressionPick(null)}>
                <AppText style={styles.chipText}>건너뛰기</AppText>
              </TouchableOpacity>
            </ScrollView>
            <View style={styles.inputRow}>
              <TextInput style={styles.textInput} value={expressionText} onChangeText={setExpressionText} placeholder="직접 입력 (예: 장난기 가득한 윙크)" placeholderTextColor={colors.text.muted} onSubmitEditing={() => expressionText.trim() && handleExpressionPick(expressionText.trim())} />
              <TouchableOpacity style={[styles.sendBtn, !expressionText.trim() && { opacity: 0.4 }]} onPress={() => expressionText.trim() && handleExpressionPick(expressionText.trim())} disabled={!expressionText.trim()}>
                <AppText style={styles.sendBtnText}>확인</AppText>
              </TouchableOpacity>
            </View>
          </>
        ) : step === 1.85 ? (
          // v3.150: 배경·장소 — 사진 업로드 / 텍스트 설명 / 건너뛰기
          <>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
              <TouchableOpacity style={[styles.optionBtnOutline, { flex: 1, marginTop: 0 }]} onPress={handleBgPhoto} disabled={bgUploading} activeOpacity={0.8}>
                {bgUploading
                  ? <ActivityIndicator size="small" color={colors.accent.primary} />
                  : <AppText style={styles.optionBtnOutlineText}>사진 올리기</AppText>}
              </TouchableOpacity>
              <TouchableOpacity style={[styles.optionBtnOutline, { flex: 1, marginTop: 0 }]} onPress={handleBgSkip} activeOpacity={0.8}>
                <AppText style={styles.optionBtnOutlineText}>건너뛰기</AppText>
              </TouchableOpacity>
            </View>
            <View style={styles.inputRow}>
              <TextInput style={styles.textInput} value={bgText} onChangeText={setBgText} placeholder="말로 설명... (예: 노을 지는 한강 다리 위)" placeholderTextColor={colors.text.muted} onSubmitEditing={handleBgText} />
              <TouchableOpacity style={[styles.sendBtn, !bgText.trim() && { opacity: 0.4 }]} onPress={handleBgText} disabled={!bgText.trim()}>
                <AppText style={styles.sendBtnText}>확인</AppText>
              </TouchableOpacity>
            </View>
          </>
        ) : step === 1.9 ? (
          // v3.150: 색감·톤 — 선택사항. v3.168(대표): 직접 입력창 추가
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
              {PALETTE_OPTIONS.map((p) => (
                <TouchableOpacity key={p} style={styles.chip} onPress={() => handlePalettePick(p)}>
                  <AppText style={styles.chipText}>{p}</AppText>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={styles.chip} onPress={() => handlePalettePick(null)}>
                <AppText style={styles.chipText}>건너뛰기</AppText>
              </TouchableOpacity>
            </ScrollView>
            <View style={styles.inputRow}>
              <TextInput style={styles.textInput} value={paletteText} onChangeText={setPaletteText} placeholder="직접 입력 (예: 파스텔 톤, 빛바랜 필름 느낌)" placeholderTextColor={colors.text.muted} onSubmitEditing={() => paletteText.trim() && handlePalettePick(paletteText.trim())} />
              <TouchableOpacity style={[styles.sendBtn, !paletteText.trim() && { opacity: 0.4 }]} onPress={() => paletteText.trim() && handlePalettePick(paletteText.trim())} disabled={!paletteText.trim()}>
                <AppText style={styles.sendBtnText}>확인</AppText>
              </TouchableOpacity>
            </View>
          </>
        ) : step === 1.75 ? (
          // v3.151: 가사 내용 반영 여부 — 반영 시 디테일 질문(구도~색감) 생략, 미반영 시 진행
          <>
            <TouchableOpacity style={styles.optionBtn} onPress={() => handleLyricsUse()} activeOpacity={0.8}>
              <AppText style={styles.optionBtnText}>가사 내용 반영하기</AppText>
            </TouchableOpacity>
            <TouchableOpacity style={styles.optionBtnOutline} onPress={handleLyricsSkip} activeOpacity={0.8}>
              <AppText style={styles.optionBtnOutlineText}>아니요, 직접 정할게요 (구도·배경·색감)</AppText>
            </TouchableOpacity>
          </>
        ) : step === 2 ? (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
              {STYLE_OPTIONS.map((s) => (
                <TouchableOpacity key={s} style={[styles.chip, styleInput === s && styles.chipSelected]} onPress={() => handleStyleConfirm(s)}>
                  <AppText style={[styles.chipText, styleInput === s && styles.chipTextSelected]}>{s}</AppText>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={styles.inputRow}>
              <TextInput
                style={[styles.textInput, styles.freeSceneInput]}
                value={styleInput}
                onChangeText={setStyleInput}
                multiline
                placeholder={'자유롭게 적어주세요…\n예) 보라색 배경에 아티스트가 점프하는 모습'}
                placeholderTextColor={colors.text.muted}
              />
              <TouchableOpacity style={[styles.sendBtn, !styleInput.trim() && { opacity: 0.4 }]} onPress={() => styleInput.trim() && handleStyleConfirm(styleInput.trim())} disabled={!styleInput.trim()}>
                <AppText style={styles.sendBtnText}>확인</AppText>
              </TouchableOpacity>
            </View>
            {/* v3.204(②): '가사 내용 기반으로 생성' 버튼 제거 — 가사 반영 여부는 1.75에서
                항상 질문되므로 여기 재노출은 중복·모순. 변경은 1.75 버블 편집으로 일원화. */}
            {/* v3.150: 자유 서술 없이도 생성 가능 — 전 항목 선택사항 원칙 */}
            <TouchableOpacity style={styles.optionBtnOutline} onPress={() => handleStyleConfirm('')} activeOpacity={0.8}>
              <AppText style={styles.optionBtnOutlineText}>이대로 만들기 (건너뛰기)</AppText>
            </TouchableOpacity>
          </>
        ) : null}
      </View>

      {/* v3.204(④): 선택지형 답변 편집 모달 — 작사 디렉터 재선택 모달과 동일 규격(공용 컴포넌트) */}
      <AnswerEditModal
        visible={editStep != null}
        choices={editStep != null ? editChoicesForStep(editStep) : []}
        freeText={editStep != null && COVER_FREETEXT_STEPS.has(editStep)}
        extraActions={editStep != null ? editExtraActionsForStep(editStep) : undefined}
        onPick={handleEditPick}
        onCancel={handleEditCancel}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.deepest },
  // v3.150: 대화 보강 UI — 옵션 버튼(주/외곽선)·의상 미리보기
  optionBtn: {
    backgroundColor: colors.accent.primary, borderRadius: 12,
    paddingVertical: 13, alignItems: 'center', justifyContent: 'center',
  },
  optionBtnText: { color: colors.text.primary, fontSize: 14, fontWeight: '700' },
  optionBtnOutline: {
    marginTop: 8, borderWidth: 1, borderColor: colors.accent.primary, borderRadius: 12,
    paddingVertical: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.bg.surface1,
  },
  optionBtnOutlineText: { color: colors.accent.primary, fontSize: 13, fontWeight: '700' },
  wardrobePreview: {
    width: 180, height: 180, borderRadius: 12, alignSelf: 'center', marginBottom: 10,
    borderWidth: 1, borderColor: colors.border.subtle, resizeMode: 'cover',
  },
  // v3.151: 답변 수정 힌트·자유 서술 멀티라인 입력
  editHint: { fontSize: 10, color: 'rgba(255,255,255,0.55)', marginTop: 4, textAlign: 'right' },
  // v3.229 [CoverDraft]: 복원 안내 버블 인라인 '처음부터' 액션(작사·영상 restartInlineBtn 관행)
  restartInlineBtn: {
    marginTop: 8, alignSelf: 'flex-start', borderWidth: 1, borderColor: colors.accent.primary,
    borderRadius: 12, paddingVertical: 6, paddingHorizontal: 12,
  },
  restartInlineBtnText: { color: colors.accent.primary, fontSize: 12, fontWeight: '700' },
  freeSceneInput: { minHeight: 84, textAlignVertical: 'top', paddingTop: 10 },
  // 로딩
  loadingContent: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  loadingPortrait: { width: 120, height: 120, borderRadius: 60, overflow: 'hidden', borderWidth: 3, borderColor: colors.accent.primary, marginBottom: 32 },
  loadingPortraitImage: { width: 120, height: 360, resizeMode: 'cover', position: 'absolute', top: 0, left: 0 },
  loadingText: { fontSize: 20, fontWeight: 'bold', color: colors.text.primary, textAlign: 'center' },
  stepRow: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginTop: 20, marginBottom: 4, paddingHorizontal: 4 },
  stepItem: { alignItems: 'center', flex: 1 },
  stepDot: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.bg.surface1, borderWidth: 1.5, borderColor: colors.border.subtle, justifyContent: 'center', alignItems: 'center', marginBottom: 4 },
  stepDotActive: { backgroundColor: colors.accent.primary, borderColor: colors.accent.primary },
  stepDotDone: { backgroundColor: colors.bg.surface2, borderColor: colors.accent.primary },
  stepDotText: { fontSize: 11, fontWeight: '700', color: colors.text.primary },
  stepLabel: { fontSize: 10, color: colors.text.muted, textAlign: 'center' },
  stepLabelActive: { color: colors.accent.primary, fontWeight: '700' },
  stepLabelDone: { color: colors.text.secondary },
  loadingNote: { backgroundColor: colors.bg.surface1, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: colors.border.subtle, marginTop: 20 },
  loadingNoteText: { fontSize: 13, color: colors.text.secondary, textAlign: 'center', lineHeight: 20 },
  // 결과 (MusicResultScreen과 동일)
  resultContent: { padding: 16 },
  directorRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 24 },
  portraitCircle: { width: 60, height: 60, borderRadius: 30, overflow: 'hidden', borderWidth: 2, borderColor: colors.accent.primary, marginRight: 12 },
  portraitCircleImage: { width: 60, height: 180, resizeMode: 'cover', position: 'absolute', top: 0, left: 0 },
  directorBubble: { flex: 1, backgroundColor: colors.bg.surface1, borderRadius: 12, borderWidth: 1, borderColor: colors.accent.primary, padding: 12 },
  directorName: { fontSize: 13, fontWeight: 'bold', color: colors.accent.primary, marginBottom: 4 },
  directorText: { fontSize: 14, color: colors.text.primary, lineHeight: 20 },
  errorBox: { backgroundColor: colors.bg.surface2, borderWidth: 1, borderColor: colors.accent.primary, borderRadius: 12, padding: 14, marginBottom: 16 },
  errorText: { color: colors.status.error, fontSize: 13, lineHeight: 20 },
  resultCard: { alignItems: 'center', marginBottom: 24 },
  resultImage: { width: 240, height: 240, borderRadius: 16, borderWidth: 3, borderColor: colors.accent.primary },
  // v3.89: 미세조정·버전 히스토리
  refiningOverlay: {
    position: 'absolute', top: 0, alignSelf: 'center', width: 240, height: 240,
    borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center', alignItems: 'center',
  },
  versionRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 12 },
  versionArrow: {
    width: 34, height: 34, borderRadius: 17, justifyContent: 'center', alignItems: 'center',
    backgroundColor: colors.bg.surface1, borderWidth: 1, borderColor: colors.border.subtle,
  },
  versionArrowDisabled: { opacity: 0.3 },
  versionArrowText: { color: colors.text.primary, fontSize: 13 },
  versionLabel: { color: colors.text.primary, fontSize: 14, fontWeight: '700', minWidth: 110, textAlign: 'center' },
  versionPrompt: { color: colors.text.muted, fontSize: 12, marginTop: 6, maxWidth: 260, textAlign: 'center' },
  refineBox: {
    backgroundColor: colors.bg.surface1, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: colors.border.subtle, marginBottom: 24,
  },
  refineTitle: { color: colors.accent.primary, fontSize: 13, fontWeight: 'bold', marginBottom: 10 },
  refineHint: { color: colors.text.secondary, fontSize: 12, marginTop: 10, textAlign: 'center' },
  buttonContainer: { gap: 12 },
  regenerateButton: { backgroundColor: colors.bg.surface1, borderWidth: 1, borderColor: colors.accent.primary, borderRadius: 16, paddingVertical: 16, alignItems: 'center' },
  regenerateButtonText: { color: colors.accent.primary, fontSize: 16, fontWeight: 'bold' },
  saveButton: { backgroundColor: colors.accent.primary, borderRadius: 16, paddingVertical: 16, alignItems: 'center' },
  saveButtonText: { color: colors.text.primary, fontSize: 16, fontWeight: 'bold' },
  backButton: { backgroundColor: colors.bg.surface1, borderRadius: 16, paddingVertical: 16, alignItems: 'center', borderWidth: 1, borderColor: colors.border.subtle },
  backButtonText: { color: colors.text.secondary, fontSize: 16, fontWeight: '600' },
  // 대화
  messageRow: { flexDirection: 'row', marginBottom: 12, alignItems: 'flex-end' },
  dirRow: { justifyContent: 'flex-start', paddingRight: 50 },
  userRow: { justifyContent: 'flex-end', paddingLeft: 50 },
  smallPortrait: { width: 36, height: 36, borderRadius: 18, overflow: 'hidden', borderWidth: 1.5, borderColor: colors.accent.primary, marginRight: 8 },
  smallPortraitImg: { width: 36, height: 108, resizeMode: 'cover', position: 'absolute', top: 0, left: 0 },
  bubble: { borderRadius: 16, padding: 12, maxWidth: '80%' },
  dirBubble: { backgroundColor: colors.text.primary, borderBottomLeftRadius: 4 },
  userBubble: { backgroundColor: colors.accent.primary, borderBottomRightRadius: 4, alignSelf: 'flex-end' },
  bubbleText: { fontSize: 15, lineHeight: 22 },
  inputArea: { borderTopWidth: 1, borderTopColor: colors.bg.surface1, paddingBottom: 30, paddingHorizontal: 12, paddingTop: 10 },
  trackOption: { backgroundColor: colors.bg.surface1, borderRadius: 12, padding: 14, marginBottom: 6, borderWidth: 1, borderColor: colors.border.subtle },
  chip: { backgroundColor: colors.bg.surface1, borderWidth: 1, borderColor: colors.border.subtle, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8, marginRight: 8 },
  chipSelected: { backgroundColor: colors.accent.primary, borderColor: colors.accent.primary },
  chipText: { color: colors.text.secondary, fontSize: 14 },
  choiceChip: {
    flex: 1, paddingVertical: 12, paddingHorizontal: 12,
    backgroundColor: colors.accent.primary, borderColor: colors.accent.primary,
    alignItems: 'center', marginRight: 0,
  },
  choiceChipText: { color: colors.text.primary, fontSize: 14, fontWeight: '700' },
  choiceChipAlt: { backgroundColor: colors.bg.surface2, borderColor: colors.border.subtle },
  choiceChipTextAlt: { color: colors.text.secondary, fontSize: 14, fontWeight: '600' },
  // v3.80: 실사/가상 슬롯 선택 카드
  slotCard: {
    flex: 1, alignItems: 'center', padding: 10, borderRadius: 12,
    backgroundColor: colors.bg.surface1, borderWidth: 1, borderColor: colors.border.subtle,
  },
  slotCardImg: {
    width: 96, height: 120, borderRadius: 8, marginBottom: 8,
    backgroundColor: colors.bg.surface2, resizeMode: 'cover',
  },
  slotCardLabel: { color: colors.text.primary, fontSize: 13, fontWeight: '700' },
  chipTextSelected: { color: colors.text.primary, fontWeight: 'bold' },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  textInput: { flex: 1, backgroundColor: colors.bg.surface1, borderWidth: 1, borderColor: colors.border.subtle, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, color: colors.text.primary, fontSize: 14 },
  sendBtn: { backgroundColor: colors.accent.primary, borderRadius: 20, paddingHorizontal: 20, paddingVertical: 10 },
  sendBtnText: { color: colors.text.primary, fontWeight: 'bold', fontSize: 14 },
});
