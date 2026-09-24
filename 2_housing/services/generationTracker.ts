import { AppState, Platform } from 'react-native';
import api, { BACKEND_BASE_URL } from './api';
import { navigationRef, navigateGlobal } from './navigationRef';
import {
  getCharacterJob,
  listRecoverableJobs,
  dismissCharacterJob,
  spendExtraSlot,
  type CharacterJobSnapshot,
} from './characterService';
import {
  useGenerationJobStore,
  listUserArtistJobs,
  getBlockingArtistJob,
  listUserGenJobs,
  type TrackedJob,
  type TrackedJobKind,
  type TrackedJobMode,
  type TrackedUsedItem,
} from '../stores/generationJobStore';
import {
  bindGenTrackerHooks,
  genTrackerAdapters,
  genTrackerAdapterFor,
  hasGenKinds,
  mergeGenRecoverable,
  type TrackerKindAdapter,
} from './genJobs/runtime';
import { useAuthStore } from '../stores/authStore';
import { useCharacterTaskStore } from '../stores/characterTaskStore';
import { useArtistProfileStore } from '../stores/artistProfileStore';
import { usePointsStore } from '../stores/pointsStore';
import { showAlert } from '../utils/appAlert';

// ── v3.227 A-보완 [GenTracker]: 전역 생성 job 추적기 (화면 수명과 분리) ───────────────
// 상태 전이(레코드 lastStatus):
//   접수(POST 202 → registerArtistJob) ─▶ processing ─(GET /job = done)──▶ done(=done-unsaved) ─finalize(save 1회)─▶ 레코드 삭제
//                                            │                                 └─(사용자 닫기 → dismiss)──────────▶ 레코드 삭제
//                                            ├─(GET /job = failed)──▶ failed ─(사용자 확인)─▶ 레코드 삭제
//                                            ├─(404)──▶ unknown → 조용히 삭제
//                                            └─(Network Error·5xx·timeout·401) → 상태 유지 + 백오프 5→10→20→40→60초
//   startedAt+30분 경과 → recoverable 1회 호출(서버 lazy stale 정리: failed+환불) 후 서버 status를 따른다.
//   재개 트리거: 웹 visibilitychange(visible)·online / 네이티브 AppState active / 로그인 완료 → 1.5초 뒤 즉시 조회.
//   숨김(웹 hidden·네이티브 background) 동안은 폴링 정지.
//   부팅: generationJobStore 하이드레이션 완료 + 로그인 세션 복원 후에만 스캔 → recoverable 병합.
// 실패 판정은 서버 status=failed일 때만(일시 네트워크 오류로 '실패' 표시 금지).
//
// v3.228 D4: kind 어댑터(registry) 구조. tick·부팅 확인·완성 알림은 kind별 TrackerKindAdapter에 위임한다.
//   - artist: 내부 어댑터 ARTIST_ADAPTER — v3.227 경로(조회·반영·문구·로그) 그대로 이전.
//   - lyrics·music·inst·cover·cover_refine·video: services/genJobs/runtime.ts가 레지스트리 GenKindAdapter를
//     감싼 어댑터·회수 병합·공개 API를 담당(본체와는 bindGenTrackerHooks로 연결). 미등록 kind는 폴링·회수 0.

const POLL_MS = 5000;
const BACKOFF_MS = [5000, 10000, 20000, 40000, 60000];
const RESUME_DELAY_MS = 1500;
const STALE_MS = 30 * 60 * 1000; // 서버 stale 기준(main.py 기동 정리·recoverable lazy 정리와 동일)
const RECOVERABLE_THROTTLE_MS = 30000;
/** 뷰어 밖 done 앱 내 알림을 띄워도 되는 화면(작업실·마이페이지 계열) — 작곡·영상 등 생성 화면에선 배지만 */
const NOTIFY_ROUTES = new Set(['Map', 'MyArtists', 'MyMusic', 'ArtistResult', 'VoiceManage', 'Settings']);

export type ServerCapability = 'unknown' | 'yes' | 'no';

let _started = false;
let _hydrated = false;
let _bootedUser: string | null = null;
let _timer: ReturnType<typeof setTimeout> | null = null;
let _ticking = false;
let _rerun = false;
let _errorStreak = 0;
let _hidden = false;
let _viewerJobId: string | null = null;
let _capability: ServerCapability = 'unknown';
let _lastRecoverableAt = 0;
let _recoverableInflight: Promise<void> | null = null;
const _finalizing = new Set<string>();
/** 이 세션에서 접수한 job의 사진 파일(메모리 전용 — 영속 금지). finalize의 upload-original-photo용 */
const _jobPhotos = new Map<string, { uri: string; name: string; mime: string }>();

function currentUserId(): string | null {
  const id = useAuthStore.getState().user?.id;
  return id ? String(id) : null;
}

function store() {
  return useGenerationJobStore.getState();
}

// ── 서버 기능 판정(구서버 폴백) ─────────────────────────────────────────────

/** v3.227 서버 여부: recoverable 200 = 'yes', 404 = 'no'(구서버), 미확인 = 'unknown' */
export function getServerCapability(): ServerCapability {
  return _capability;
}

/** 미확인이면 recoverable 1회로 판정(로그인 필요). 이후 캐시 */
export async function ensureServerCapability(): Promise<ServerCapability> {
  if (_capability !== 'unknown') return _capability;
  await refreshRecoverable({ force: true, reason: 'capability' });
  return _capability;
}

// ── 레코드 등록 ─────────────────────────────────────────────────────────────

export interface RegisterArtistJobInput {
  jobId: string;
  mode: TrackedJobMode;
  characterKind: 'real' | 'virtual';
  targetCharacterId: string | null;
  legacyContract: boolean;
  photoIntent: 'photo' | 'text' | null;
  pendingName: string | null;
  pendingGender: string | null;
  pendingAge: string | null;
  usedItems: TrackedUsedItem[];
  artStyleHint: string | null;
  /** 이 세션의 사진 파일(메모리만) — 없으면 finalize가 job.original_object_name을 연결 */
  photo?: { uri: string; name: string; mime: string } | null;
}

/** POST 202 job_id 수신 직후(화면 전환 전) 호출 — 영속 기록 + 폴링 개시 */
export function registerArtistJob(input: RegisterArtistJobInput): void {
  const owner = currentUserId() || 'unknown';
  const now = Date.now();
  const { photo, ...rest } = input;
  store().upsertJob({
    ...rest,
    kind: 'artist',
    startedAt: now,
    lastStatus: 'processing',
    lastCheckedAt: null,
    ownerUserId: owner,
    source: 'local',
    notifiedAt: null,
    staleProbeAt: null,
  });
  if (photo?.uri) _jobPhotos.set(input.jobId, photo);
  console.info('[GenJobStore] 접수 기록', {
    jobId: input.jobId, mode: input.mode, kind: input.characterKind,
    target: input.targetCharacterId, photo: input.photoIntent,
  });
  scheduleTick(POLL_MS);
}

function snapshotToRecord(snap: CharacterJobSnapshot, source: TrackedJob['source']): TrackedJob {
  const photoIntent: TrackedJob['photoIntent'] =
    snap.originalObjectName || snap.hasPhoto ? 'photo' : snap.hasPhoto === false ? 'text' : null;
  return {
    jobId: snap.jobId,
    kind: 'artist',
    mode: 'sheet',
    characterKind: snap.characterKind ?? 'real',
    targetCharacterId: snap.characterId,
    legacyContract: false,
    photoIntent,
    pendingName: null,
    pendingGender: null,
    pendingAge: null,
    usedItems: [],
    artStyleHint: null,
    startedAt: snap.createdAtMs ?? Date.now(),
    lastStatus: snap.status === 'unknown' ? 'processing' : snap.status,
    lastCheckedAt: Date.now(),
    result: snap.objectName
      ? {
          object_name: snap.objectName,
          preview_url: snap.previewUrl || `/api/character/preview/${snap.objectName}`,
          original_object_name: snap.originalObjectName,
          character_id: snap.characterId,
          art_style: snap.artStyle,
        }
      : undefined,
    error: snap.error,
    refunded: snap.refunded,
    ownerUserId: currentUserId() || 'unknown',
    source,
    notifiedAt: null,
    staleProbeAt: null,
  };
}

/** 서버 409 generation_in_progress 수신 → 그 job을 추적기에 편입(다른 기기·창에서 시작한 생성 포함) */
export function adoptInProgressJob(snap: CharacterJobSnapshot): void {
  const existing = store().jobs[snap.jobId];
  if (!existing) {
    store().upsertJob(snapshotToRecord({ ...snap, status: 'processing' }, 'conflict'));
    console.info('[GenTracker] 409 generation_in_progress → job 편입', { jobId: snap.jobId });
  }
  scheduleTick(RESUME_DELAY_MS);
}

// ── 폴링 ─────────────────────────────────────────────────────────────────────

function clearTimer() {
  if (_timer) {
    clearTimeout(_timer);
    _timer = null;
  }
}

function scheduleTick(delay: number) {
  if (!_started) return;
  if (_ticking) {
    _rerun = true;
    return;
  }
  clearTimer();
  _timer = setTimeout(() => { void tick(); }, delay);
}

/** 추적 대상 전체(어댑터가 있는 kind만, 최신순) — 아티스트만 있으면 listUserArtistJobs()와 동일 순서 */
function listTrackedJobs(): TrackedJob[] {
  const adapters = trackerAdapters();
  if (adapters.length === 1) return adapters[0].list();
  return adapters.flatMap((a) => a.list()).sort((a, b) => b.startedAt - a.startedAt);
}

function processingJobs(): TrackedJob[] {
  return listTrackedJobs().filter((j) => j.lastStatus === 'processing');
}

async function tick(): Promise<void> {
  _timer = null;
  if (_ticking) return;
  if (_hidden) {
    console.info('[GenTracker] 숨김 상태 — 폴링 정지');
    return;
  }
  if (!_hydrated || !currentUserId()) return;
  const targets = processingJobs();
  if (targets.length === 0) return;
  _ticking = true;
  _rerun = false;
  let hadError = false;
  try {
    for (const job of targets) {
      if (_hidden) break;
      const adapter = trackerAdapterFor(job.kind);
      if (!adapter) continue;
      // startedAt+상한(아티스트 30분): 서버 lazy stale 정리(failed+환불 1회)를 recoverable로 유도 → 아래 조회가 결과를 따른다
      if (Date.now() - job.startedAt >= adapter.capMs && !job.staleProbeAt) {
        store().patchJob(job.jobId, { staleProbeAt: Date.now() });
        adapter.logCapProbe(job);
        await refreshRecoverable({ force: true, reason: 'stale-probe' });
      }
      try {
        await adapter.poll(job);
      } catch (err: any) {
        hadError = true;
        console.warn('[GenTracker] 조회 오류 — 상태 유지·백오프', {
          ...adapter.logTag(job), status: err?.response?.status ?? null, message: err?.message,
        });
      }
    }
  } finally {
    _ticking = false;
  }
  _errorStreak = hadError ? _errorStreak + 1 : 0;
  const delay = hadError ? BACKOFF_MS[Math.min(_errorStreak - 1, BACKOFF_MS.length - 1)] : POLL_MS;
  const remaining = processingJobs().length;
  console.info('[GenTracker] poll', { jobs: targets.length, remaining, backoff: hadError ? delay : 0 });
  if (remaining > 0) {
    if (_rerun) {
      _rerun = false;
      scheduleTick(RESUME_DELAY_MS);
    } else {
      scheduleTick(delay);
    }
  }
}

/** 서버 스냅샷을 레코드에 반영(null = 404) */
function applySnapshot(jobId: string, snap: CharacterJobSnapshot | null): void {
  const cur = store().jobs[jobId];
  if (!cur) return;
  if (!snap || snap.status === 'unknown') {
    console.info('[GenTracker] job 없음(404) — 조용히 정리', { jobId });
    store().removeJob(jobId);
    return;
  }
  if (snap.consumed || snap.dismissed) {
    // 다른 기기·창에서 이미 저장했거나 버림 — 여기서 다시 저장하지 않는다
    if (!_finalizing.has(jobId)) {
      console.info('[GenTracker] 이미 소비된 job — 정리', { jobId, consumed: snap.consumed, dismissed: snap.dismissed });
      store().removeJob(jobId);
    }
    return;
  }
  const now = Date.now();
  if (snap.status === 'processing') {
    store().patchJob(jobId, { lastCheckedAt: now });
    return;
  }
  if (snap.status === 'done') {
    if (!snap.objectName) {
      store().patchJob(jobId, { lastCheckedAt: now });
      return;
    }
    const wasDone = cur.lastStatus === 'done';
    store().patchJob(jobId, {
      lastStatus: 'done',
      lastCheckedAt: now,
      characterKind: snap.characterKind ?? cur.characterKind,
      result: {
        object_name: snap.objectName,
        preview_url: snap.previewUrl || `/api/character/preview/${snap.objectName}`,
        original_object_name: snap.originalObjectName,
        character_id: snap.characterId,
        art_style: snap.artStyle,
      },
    });
    if (!wasDone) {
      console.info('[GenTracker] 완성 수신', { jobId, viewer: _viewerJobId === jobId });
      usePointsStore.getState().fetchBalance();
      maybeNotifyDone();
    }
    return;
  }
  // failed — 서버가 실패를 확정한 경우에만 실패 표시(+자동 환불 안내)
  if (cur.lastStatus !== 'failed') {
    console.info('[GenTracker] 서버 실패 확정', { jobId, refunded: snap.refunded });
    store().patchJob(jobId, {
      lastStatus: 'failed',
      lastCheckedAt: now,
      error: snap.error,
      refunded: snap.refunded,
    });
    usePointsStore.getState().fetchBalance(); // 환불 반영
  }
}

// ── 회수 목록(recoverable) ────────────────────────────────────────────────

export async function refreshRecoverable(opts: { force?: boolean; reason?: string } = {}): Promise<void> {
  if (!currentUserId() || !_hydrated) return;
  if (_recoverableInflight) return _recoverableInflight;
  const now = Date.now();
  if (!opts.force && now - _lastRecoverableAt < RECOVERABLE_THROTTLE_MS) return;
  _lastRecoverableAt = now;
  _recoverableInflight = (async () => {
    try {
      try {
        await mergeArtistRecoverable(opts);
      } catch (err: any) {
        // 오류는 무시(다음 트리거에서 재시도) — 실패 표시 없음
        console.warn('[GenTracker] recoverable 조회 오류', { status: err?.response?.status ?? null });
        _lastRecoverableAt = 0;
      }
      // v3.228: 비아티스트 원장 회수(등록 kind가 있을 때만 — never-throw)
      if (hasGenKinds()) await mergeGenRecoverable(opts.reason ?? 'refresh');
    } finally {
      _recoverableInflight = null;
    }
  })();
  return _recoverableInflight;
}

/** 아티스트 회수 목록 병합(v3.227 경로 그대로) — 오류는 throw(호출부가 로그·재시도 처리) */
async function mergeArtistRecoverable(opts: { reason?: string }): Promise<void> {
  const { supported, jobs } = await listRecoverableJobs();
  if (!supported) {
    if (_capability !== 'no') console.info('[GenTracker] recoverable 미지원(구서버) — 로컬 추적만 사용');
    _capability = 'no';
    return;
  }
  _capability = 'yes';
  const dismissed = new Set(store().dismissedIds);
  let added = 0;
  for (const snap of jobs) {
    if (dismissed.has(snap.jobId)) continue;
    const local = store().jobs[snap.jobId];
    if (local) {
      if (local.lastStatus === 'processing' && snap.status !== 'processing') applySnapshot(snap.jobId, snap);
      continue;
    }
    if (snap.status === 'unknown') continue;
    store().upsertJob(snapshotToRecord(snap, 'recovered'));
    added++;
  }
  console.info('[GenTracker] recoverable 병합', { reason: opts.reason ?? 'refresh', server: jobs.length, added });
  if (processingJobs().length > 0 && !_timer && !_ticking) scheduleTick(RESUME_DELAY_MS);
  maybeNotifyDone();
}

/** 부팅 시 로컬 done 레코드가 다른 곳에서 이미 저장·버려졌는지 1회 확인 */
async function verifyDoneJobs(): Promise<void> {
  for (const adapter of trackerAdapters()) {
    const done = adapter.list().filter((j) => j.lastStatus === 'done');
    for (const j of done) await adapter.verifyDone(j);
  }
}

// ── 앱 내 알림(뷰어 밖 done 1회) ─────────────────────────────────────────

function currentRouteName(): string | undefined {
  try {
    return navigationRef.isReady() ? navigationRef.getCurrentRoute()?.name : undefined;
  } catch {
    return undefined;
  }
}

/** 뷰어 밖 알림 1회 — 한 번에 1개(어댑터 등록 순서: artist 먼저) */
function maybeNotifyDone(): void {
  const route = currentRouteName();
  if (!route || !NOTIFY_ROUTES.has(route)) return;
  for (const adapter of trackerAdapters()) {
    const job = adapter.list().find(
      (j) => adapter.canNotify(j) && !j.notifiedAt && j.jobId !== _viewerJobId
    );
    if (!job) continue;
    store().patchJob(job.jobId, { notifiedAt: Date.now() });
    adapter.notify(job, route);
    return;
  }
}

// ── 뷰어·네비게이션 ─────────────────────────────────────────────────────

/** ArtistLoading(추적 뷰어)이 보고 있는 job — 뷰어가 열려 있으면 완성 알림 대신 뷰어가 finalize */
export function setViewerJob(jobId: string | null): void {
  _viewerJobId = jobId;
}

/** v3.228: 뷰어 해제 — 지금 보고 있는 job이 이 job일 때만(화면 교체 순서 경합 방지) */
export function releaseViewerJob(jobId: string | null | undefined): void {
  if (jobId && _viewerJobId === jobId) _viewerJobId = null;
}

/** 추적 뷰어 열기 — StudioStack 화면이면 그 navigation, 아니면 전역 */
export function openJobViewer(jobId: string, navigation?: any): void {
  console.info('[GenTracker] 뷰어 열기', { jobId });
  if (navigation?.navigate) navigation.navigate('ArtistLoading', { jobId });
  else navigateGlobal('Studio', { screen: 'ArtistLoading', params: { jobId } });
}

function goArtistResult(params: Record<string, any>, navigation?: any, replace?: boolean) {
  if (navigation) {
    if (replace && navigation.replace) navigation.replace('ArtistResult', params);
    else navigation.navigate('ArtistResult', params);
  } else {
    navigateGlobal('Studio', { screen: 'ArtistResult', params });
  }
}

// ── 완성 처리(단일 경로 + 1회 락) ─────────────────────────────────────────

export type FinalizeOutcome = 'saved' | 'busy' | 'not-ready' | 'failed';

function characterPreviewUrl(previewPath: string): string {
  // cache-buster: RN Image가 같은 URL이면 옛 이미지 캐시 사용 → 새 시트로 갱신 안 됨
  const sep = previewPath.includes('?') ? '&' : '?';
  return `${BACKEND_BASE_URL}${previewPath}${sep}t=${Date.now()}`;
}

async function appendPhotoFile(form: FormData, photo: { uri: string; name: string; mime: string }) {
  if (Platform.OS === 'web') {
    const res = await fetch(photo.uri);
    const blob = await res.blob();
    form.append('file', new File([blob], photo.name, { type: photo.mime }));
  } else {
    form.append('file', { uri: photo.uri, name: photo.name, type: photo.mime } as any);
  }
}

function showSlotDialog(err: any) {
  const used = err?.response?.data?.used;
  const max = err?.response?.data?.max;
  const slotMsg = `아티스트 슬롯이 가득 찼어요${typeof used === 'number' && typeof max === 'number' ? ` (${used}/${max})` : ''}. ⭐15로 슬롯을 영구 확장한 뒤 완성된 아티스트를 저장할 수 있어요.`;
  showAlert('슬롯이 가득 찼어요', slotMsg, [
    { text: '다음에', style: 'cancel' },
    {
      text: '⭐15로 확장',
      onPress: async () => {
        try {
          await spendExtraSlot();
          usePointsStore.getState().fetchBalance();
          showAlert('확장 완료', '슬롯이 추가됐어요. 내 아티스트의 "도착" 카드에서 다시 저장해주세요.');
        } catch (spendErr: any) {
          if (spendErr?.response?.status === 402) {
            showAlert('스타(⭐)가 부족해요', '슬롯 확장에는 ⭐15가 필요해요. 출석체크·앱 추천으로 스타를 모아보세요.');
          } else {
            showAlert('오류', spendErr?.response?.data?.error || '슬롯 확장에 실패했어요. 잠시 후 다시 시도해주세요.');
          }
        }
      },
    },
  ]);
}

/**
 * 완성된 job을 아티스트로 저장(save 정확히 1회) → ArtistResult.
 * 신규 생성 뷰어·재개 뷰어·회수 카드·작업실 말풍선·알림이 모두 이 경로를 쓴다.
 * 동시 호출(연타·경합)은 _finalizing 락으로 1회만 진행. 저장 실패 시 레코드는 done 유지(재시도 가능).
 */
export async function finalizeArtistJob(
  jobId: string,
  opts: { navigation?: any; replace?: boolean } = {}
): Promise<FinalizeOutcome> {
  if (_finalizing.has(jobId)) {
    console.info('[GenTracker] finalize 진행 중 — 중복 호출 무시', { jobId });
    return 'busy';
  }
  const job = store().jobs[jobId];
  if (!job) return 'not-ready';
  if (job.lastStatus === 'processing') {
    openJobViewer(jobId, opts.navigation);
    return 'not-ready';
  }
  if (job.lastStatus !== 'done' || !job.result?.object_name) return 'not-ready';
  _finalizing.add(jobId);
  const r = job.result;
  const isVirtual = job.characterKind === 'virtual';
  try {
    // 사진: 이 세션 파일이 있으면 영구 원본 업로드(기존 관행), 없으면(이탈·재시작·회수) job 원본 연결
    let originalObjectName: string | null = null;
    if (job.mode === 'sheet') {
      const photo = _jobPhotos.get(jobId);
      if (photo) {
        try {
          const photoForm = new FormData();
          await appendPhotoFile(photoForm, photo);
          const upRes = await api.post('/character/upload-original-photo', photoForm, {
            headers: Platform.OS === 'web' ? {} : { 'Content-Type': 'multipart/form-data' },
            timeout: 60000,
          });
          originalObjectName = upRes.data?.object_name || null;
        } catch (uploadErr: any) {
          console.warn('[GenTracker] upload-original-photo 실패 — job 원본으로 연결', { status: uploadErr?.response?.status ?? null });
        }
      }
      if (!originalObjectName && r.original_object_name) originalObjectName = r.original_object_name;
    }

    const cid: string | null = job.legacyContract ? null : job.targetCharacterId || r.character_id || null;
    const body: any = { sheet_object_name: r.object_name, used_items: job.usedItems || [] };
    if (job.mode === 'sheet') {
      if (originalObjectName) body.original_photo_object_name = originalObjectName;
      // 가상 슬롯 저장 — 서버가 virtual_* 필드만 갱신(실사 페이로드에는 variant 금지)
      if (isVirtual) {
        body.variant = 'virtual';
        body.art_style = r.art_style || job.artStyleHint || undefined;
      }
      if (!job.legacyContract) {
        if (cid) body.character_id = cid;
        else body.kind = isVirtual ? 'virtual' : 'real';
        if (job.pendingGender) body.gender = job.pendingGender;
        if (job.pendingAge) body.age = job.pendingAge;
        if (job.pendingName) body.name = job.pendingName;
      }
    } else if (cid) {
      body.character_id = cid;
    }
    console.info('[GenTracker] finalize save', {
      jobId, mode: job.mode, kind: job.characterKind, cid, hasOriginal: !!originalObjectName, source: job.source,
    });
    const saveRes = await api.post('/character/save', body);
    const savedCid: string | null = saveRes.data?.character_id ? String(saveRes.data.character_id) : cid;
    if (saveRes.data?.already_saved) console.info('[GenTracker] 이미 저장된 결과 — 기존 아티스트로 이동', { jobId });

    // 성공 — 레코드 완료 처리 + 기존 ArtistLoading 완료 부수효과 이관
    store().removeJob(jobId);
    _jobPhotos.delete(jobId);
    const task = useCharacterTaskStore.getState();
    if (job.pendingGender && job.legacyContract) {
      useArtistProfileStore.getState().setProfile(isVirtual ? 'virtual' : 'real', { gender: job.pendingGender });
    }
    task.completeApi({ preview_url: characterPreviewUrl(r.preview_url), object_name: r.object_name });
    task.setInput({ characterKind: job.characterKind, ...(originalObjectName ? { originalPhotoObjectName: originalObjectName } : {}) });
    task.clearMode();
    usePointsStore.getState().fetchBalance();
    const params: Record<string, any> =
      job.mode === 'sheet'
        ? savedCid ? { characterId: savedCid, justCreated: true } : { justCreated: true }
        : savedCid ? { characterId: savedCid } : {};
    goArtistResult(params, opts.navigation, opts.replace);
    return 'saved';
  } catch (err: any) {
    const status = err?.response?.status;
    const code = err?.response?.data?.error;
    console.warn('[GenTracker] finalize 저장 실패 — done 유지(재시도 가능)', { jobId, status, code });
    if (status === 409 && code === 'slot_limit_exceeded') {
      showSlotDialog(err);
    } else if (status === 409 && code === 'save_in_progress') {
      showAlert('저장 중이에요', '잠시 후 다시 시도해주세요.');
    } else {
      showAlert('저장하지 못했어요', '완성된 아티스트는 그대로 남아 있어요. 잠시 후 다시 시도해주세요.');
    }
    return 'failed';
  } finally {
    _finalizing.delete(jobId);
  }
}

/** 완성본 닫기(서버 dismiss — 결과 버리기). 성공 시 레코드 삭제 */
export async function discardDoneJob(jobId: string): Promise<boolean> {
  const ok = await dismissCharacterJob(jobId);
  if (ok) {
    store().removeJob(jobId, { dismissed: true });
    console.info('[GenTracker] 완성본 닫기', { jobId });
  } else {
    showAlert('오류', '닫지 못했어요. 잠시 후 다시 시도해주세요.');
  }
  return ok;
}

/** 실패 안내 확인 — 서버 dismiss(best-effort) 후 레코드 삭제 */
export function acknowledgeFailedJob(jobId: string): void {
  void dismissCharacterJob(jobId);
  store().removeJob(jobId, { dismissed: true });
  console.info('[GenTracker] 실패 확인', { jobId });
}

// ── 중복 생성 가드(3지점 공용) ──────────────────────────────────────────

/**
 * [2조 전달용] 추적 중(processing·done-unsaved)인 아티스트 job이 있으면 앱 내 팝업을 띄우고 true.
 * 과금 게이트(피로·잔액)보다 **먼저**, 새 생성 요청을 만들기 전에 호출:
 *   `if (guardArtistGeneration({ navigation, where: 'ArtistCody' })) return;`
 * 옷 입히기(outfit)도 같은 규칙(사용자당 artist job 1개). 서버 409가 최종 방어.
 */
export function guardArtistGeneration(opts: { navigation?: any; where?: string; onDismiss?: () => void } = {}): boolean {
  const job = getBlockingArtistJob();
  if (!job) return false;
  console.info('[GenTracker] 중복 생성 차단', { where: opts.where ?? '-', jobId: job.jobId, status: job.lastStatus });
  if (job.lastStatus === 'processing') {
    showAlert('이미 아티스트를 만드는 중이에요', '완성된 뒤에 새로 만들 수 있어요.', [
      { text: '닫기', style: 'cancel', onPress: opts.onDismiss },
      { text: '진행 상황 보기', onPress: () => openJobViewer(job.jobId, opts.navigation) },
    ]);
  } else {
    showAlert('완성된 아티스트가 있어요', '완성된 아티스트를 먼저 확인해주세요.', [
      { text: '닫기', style: 'cancel', onPress: opts.onDismiss },
      { text: '확인하기', onPress: () => { void finalizeArtistJob(job.jobId, { navigation: opts.navigation }); } },
    ]);
  }
  return true;
}

/** 비팝업 판정 — 차단 대상 job(없으면 null) */
export { getBlockingArtistJob };

// ── v3.228 D4: kind 어댑터(registry) ─────────────────────────────────────

/** artist — v3.227 경로 그대로(GET /character/job → applySnapshot, 30분 stale probe, 완성 알림 문구) */
const ARTIST_ADAPTER: TrackerKindAdapter = {
  kind: 'artist',
  capMs: STALE_MS,
  list: () => listUserArtistJobs(),
  logTag: (job) => ({ jobId: job.jobId }),
  logCapProbe: (job) => {
    console.info('[GenTracker] 30분 경과 — recoverable 1회 호출', { jobId: job.jobId });
  },
  poll: async (job) => {
    const snap = await getCharacterJob(job.jobId);
    applySnapshot(job.jobId, snap);
  },
  verifyDone: async (j) => {
    try {
      const snap = await getCharacterJob(j.jobId);
      if (!snap || snap.consumed || snap.dismissed) applySnapshot(j.jobId, snap);
    } catch {
      /* 네트워크 오류 — 유지 */
    }
  },
  canNotify: (j) => j.lastStatus === 'done',
  notify: (job, route) => {
    console.info('[GenTracker] 완성 알림 1회', { jobId: job.jobId, route });
    showAlert('아티스트가 완성됐어요', '완성된 아티스트를 확인하고 저장해 주세요.', [
      { text: '나중에', style: 'cancel' },
      { text: '지금 보기', onPress: () => { void finalizeArtistJob(job.jobId); } },
    ]);
  },
};

/** 활성 어댑터(artist 먼저, 이후 레지스트리 등록 순서) */
function trackerAdapters(): TrackerKindAdapter[] {
  if (!hasGenKinds()) return [ARTIST_ADAPTER];
  return [ARTIST_ADAPTER, ...genTrackerAdapters()];
}

function trackerAdapterFor(kind: TrackedJobKind): TrackerKindAdapter | null {
  return kind === 'artist' ? ARTIST_ADAPTER : genTrackerAdapterFor(kind);
}

// 비아티스트 런타임(services/genJobs/runtime.ts) ↔ 본체 연결(단방향 import)
bindGenTrackerHooks({
  schedulePoll: () => scheduleTick(POLL_MS),
  scheduleSoon: () => scheduleTick(RESUME_DELAY_MS),
  notify: () => maybeNotifyDone(),
  viewerJob: () => _viewerJobId,
});

// v3.228 비아티스트 공개 API — 구현은 services/genJobs/runtime.ts(2조는 여기 또는 runtime에서 import)
export {
  newRequestId,
  findGenJob,
  registerGenJob,
  adoptGenJob,
  markGenJobDone,
  ackGenJob,
  openGenJob,
  guardGeneration,
  discardGenJob,
  endGenRequest,
  settleGenJob,
  getGenJobsCapability,
  type RegisterGenJobInput,
} from './genJobs/runtime';

// ── 재개 트리거·부팅 ────────────────────────────────────────────────────

function onResume(reason: string) {
  _hidden = false;
  _errorStreak = 0;
  if (!currentUserId() || !_hydrated) return;
  console.info('[GenTracker] visible → refresh', { reason });
  clearTimer();
  _timer = setTimeout(() => {
    _timer = null;
    void refreshRecoverable({ reason });
    void tick();
  }, RESUME_DELAY_MS);
}

function onHide(reason: string) {
  _hidden = true;
  clearTimer();
  console.info('[GenTracker] 숨김 — 폴링 정지', { reason });
}

async function boot(userId: string) {
  if (_bootedUser === userId) return;
  _bootedUser = userId;
  store().pruneOld();
  const mine = listUserArtistJobs();
  console.info('[GenTracker] boot resume', {
    n: mine.length,
    processing: mine.filter((j) => j.lastStatus === 'processing').length,
    done: mine.filter((j) => j.lastStatus === 'done').length,
  });
  const gens = listUserGenJobs();
  if (gens.length > 0) {
    console.info('[GenTracker] boot resume(gen)', {
      n: gens.length,
      kinds: Array.from(new Set(gens.map((j) => j.kind))),
      processing: gens.filter((j) => j.lastStatus === 'processing').length,
    });
  }
  _errorStreak = 0;
  clearTimer();
  _timer = setTimeout(() => {
    _timer = null;
    void (async () => {
      await tick();
      await verifyDoneJobs();
      await refreshRecoverable({ force: true, reason: 'boot' });
      maybeNotifyDone();
    })();
  }, RESUME_DELAY_MS);
}

function onAuthChanged() {
  const uid = currentUserId();
  if (!_hydrated) return;
  if (uid) {
    void boot(uid);
  } else {
    _bootedUser = null;
    clearTimer();
  }
}

/** 앱 루트에서 1회 호출(멱등). 하이드레이션·세션 복원을 기다린 뒤 스캔한다 */
export function startGenerationTracker(): void {
  if (_started) return;
  _started = true;

  const onHydrated = () => {
    if (_hydrated) return;
    _hydrated = true;
    onAuthChanged();
  };
  const persistApi = useGenerationJobStore.persist;
  if (persistApi.hasHydrated()) onHydrated();
  else persistApi.onFinishHydration(() => onHydrated());

  // 로그인 완료(세션 복원 포함)·로그아웃
  useAuthStore.subscribe((s, prev) => {
    if ((s.user?.id ?? null) !== (prev.user?.id ?? null)) onAuthChanged();
  });

  // 복귀 트리거
  if (Platform.OS === 'web') {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') onResume('visibilitychange');
        else onHide('visibilitychange');
      });
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => onResume('online'));
    }
  } else {
    AppState.addEventListener('change', (state) => {
      if (state === 'active') onResume('appstate');
      else if (state === 'background') onHide('appstate');
    });
  }

  // 화면 전환 시 미표시 완성 알림(작업실·마이페이지 계열 진입 때 1회)
  try {
    navigationRef.addListener('state', () => maybeNotifyDone());
  } catch {
    /* 컨테이너 준비 전 — 다음 트리거에서 알림 */
  }
  console.info('[GenTracker] 시작');
}
