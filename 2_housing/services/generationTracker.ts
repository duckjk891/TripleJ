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
  GEN_KIND_DIRECTOR,
  GEN_NEUTRAL_ARTIST_FIELDS,
  type TrackedJob,
  type TrackedJobKind,
  type TrackedJobMode,
  type TrackedUsedItem,
} from '../stores/generationJobStore';
import {
  getKindAdapter,
  listKindAdapters,
  genJobKey,
  newRequestId,
  SYNC_GEN_KINDS,
  GEN_KIND_GROUP,
  type GenKind,
  type GenKindAdapter,
  type GenJobSnapshot,
} from './genJobs';
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
//   - lyrics·music·inst·cover·cover_refine·video: services/genJobs 레지스트리에 등록된 GenKindAdapter를
//     genTrackerAdapter()로 감싼다. 등록되지 않은 kind의 레코드는 폴링하지 않는다.
//   - 동기 kind(작사·커버·다듬기·영상) 404 유예: 요청 후 120초 안의 404는 "아직 도착 전"(원장은 과금 전 생성).

const POLL_MS = 5000;
const BACKOFF_MS = [5000, 10000, 20000, 40000, 60000];
const RESUME_DELAY_MS = 1500;
const STALE_MS = 30 * 60 * 1000; // 서버 stale 기준(main.py 기동 정리·recoverable lazy 정리와 동일)
const RECOVERABLE_THROTTLE_MS = 30000;
/** v3.228: 동기 kind 요청 후 이 시간 안의 404는 "아직 서버 도착 전"으로 보고 processing 유지 */
const NOT_ARRIVED_GRACE_MS = 120 * 1000;
/** v3.228 X-K1: 과금 여부를 확인할 수 없을 때(404·킬스위치·구서버) 중립 안내 */
const GEN_UNCONFIRMED_BODY = '잠시 후 다시 확인하거나 별 사용 내역을 확인해 주세요.';
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
    } catch (err: any) {
      // 오류는 무시(다음 트리거에서 재시도) — 실패 표시 없음
      console.warn('[GenTracker] recoverable 조회 오류', { status: err?.response?.status ?? null });
      _lastRecoverableAt = 0;
    } finally {
      _recoverableInflight = null;
    }
  })();
  return _recoverableInflight;
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
    showAlert('이미 아티스트를 만드는 중이에요', '완성된 뒤에 새로 만들 수 있어요. 나가 있어도 계속 만들어져요.', [
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

/** 추적기 내부 kind 어댑터 — tick·부팅 확인·알림이 kind별 동작을 여기로 위임 */
interface TrackerKindAdapter {
  kind: TrackedJobKind;
  /** 이 시간 경과 시 recoverable 1회(서버 lazy 정리 유도) */
  capMs: number;
  /** 현재 사용자의 이 kind 레코드(최신순) */
  list(): TrackedJob[];
  /** 로그 공통 필드 */
  logTag(job: TrackedJob): Record<string, any>;
  logCapProbe(job: TrackedJob): void;
  /** 서버 조회 → 레코드 반영. 네트워크 오류·5xx·timeout은 throw(상태 유지·백오프) */
  poll(job: TrackedJob): Promise<void>;
  /** 부팅 시 done 레코드가 다른 곳에서 소비됐는지 확인(오류는 삼킴 — 유지) */
  verifyDone(job: TrackedJob): Promise<void>;
  /** 뷰어 밖 알림 대상 상태인가 */
  canNotify(job: TrackedJob): boolean;
  notify(job: TrackedJob, route: string): void;
}

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

const _genTrackerAdapters = new WeakMap<GenKindAdapter, TrackerKindAdapter>();

/** 레지스트리 GenKindAdapter → 추적기 어댑터(공용 반영·404 유예·알림) */
function genTrackerAdapter(gen: GenKindAdapter): TrackerKindAdapter {
  const cached = _genTrackerAdapters.get(gen);
  if (cached) return cached;
  const a: TrackerKindAdapter = {
    kind: gen.kind,
    capMs: gen.capMs,
    list: () => listUserGenJobs([gen.kind]),
    logTag: (job) => ({ kind: gen.kind, jobId: job.jobId }),
    logCapProbe: (job) => {
      console.info('[GenTracker] 상한 경과 — recoverable 1회 호출', {
        kind: gen.kind, jobId: job.jobId, capMin: Math.round(gen.capMs / 60000),
      });
    },
    poll: async (job) => {
      const snap = await gen.fetch(job);
      applyGenSnapshot(job.jobId, snap);
    },
    verifyDone: async (j) => {
      try {
        const snap = await gen.fetch(j);
        if (!snap || snap.acked) applyGenSnapshot(j.jobId, snap);
      } catch {
        /* 네트워크 오류 — 유지 */
      }
    },
    canNotify: (j) => j.lastStatus === 'done' || j.lastStatus === 'failed',
    notify: (job, route) => {
      console.info('[GenTracker] 도착 알림 1회', { kind: gen.kind, jobId: job.jobId, status: job.lastStatus, route });
      if (job.lastStatus === 'failed') {
        // X-K1: 서버가 환불·미차감을 명시한 경우에만 단정, 그 외는 중립 문구
        showAlert(
          gen.text.failTitle,
          job.refunded === true
            ? '사용된 별은 자동으로 환불됐어요.'
            : job.notCharged === true
              ? '별은 차감되지 않았어요.'
              : GEN_UNCONFIRMED_BODY,
          [{ text: '확인', onPress: () => { ackGenJob(job.jobId); } }]
        );
        return;
      }
      showAlert(gen.text.doneTitle, gen.text.doneBody, [
        { text: '나중에', style: 'cancel' },
        { text: '지금 보기', onPress: () => { void openGenJob(job.jobId); } },
      ]);
    },
  };
  _genTrackerAdapters.set(gen, a);
  return a;
}

/** 활성 어댑터(artist 먼저, 이후 레지스트리 등록 순서) */
function trackerAdapters(): TrackerKindAdapter[] {
  const gens = listKindAdapters();
  if (gens.length === 0) return [ARTIST_ADAPTER];
  return [ARTIST_ADAPTER, ...gens.map(genTrackerAdapter)];
}

function trackerAdapterFor(kind: TrackedJobKind): TrackerKindAdapter | null {
  if (kind === 'artist') return ARTIST_ADAPTER;
  const gen = getKindAdapter(kind);
  return gen ? genTrackerAdapter(gen) : null;
}

/** 비아티스트 서버 스냅샷 반영(null = 404) */
function applyGenSnapshot(key: string, snap: GenJobSnapshot | null): void {
  const cur = store().jobs[key];
  if (!cur || cur.kind === 'artist') return;
  const now = Date.now();
  if (!snap || snap.status === 'unknown') {
    const isSync = SYNC_GEN_KINDS.has(cur.kind as GenKind);
    if (cur.lastStatus === 'processing' && isSync && now - cur.startedAt < NOT_ARRIVED_GRACE_MS) {
      // 요청이 아직 서버 원장에 닿기 전 — 유예
      store().patchJob(key, { lastCheckedAt: now });
      return;
    }
    console.info('[GenTracker] job 없음(404) — 조용히 정리', { kind: cur.kind, jobId: key });
    store().removeJob(key);
    if (cur.lastStatus === 'processing' && isSync && _viewerJobId === key) {
      // X-K1: 404는 킬스위치·구서버일 수도 있어 과금 여부를 단정하지 않는다
      showAlert('결과를 확인하지 못했어요', GEN_UNCONFIRMED_BODY);
    }
    return;
  }
  if (snap.acked) {
    console.info('[GenTracker] 이미 확인된 job — 정리', { kind: cur.kind, jobId: key });
    store().removeJob(key, { dismissed: true });
    return;
  }
  const base: Partial<TrackedJob> = {
    lastCheckedAt: now,
    serverJobId: snap.jobId || cur.serverJobId || null,
    requestId: cur.requestId ?? snap.requestId ?? null,
  };
  if (snap.status === 'processing') {
    store().patchJob(key, base);
    return;
  }
  if (snap.status === 'done') {
    const wasDone = cur.lastStatus === 'done';
    store().patchJob(key, { ...base, lastStatus: 'done', genResult: snap.result ?? cur.genResult ?? null });
    if (!wasDone) {
      console.info('[GenTracker] 완성 수신', { kind: cur.kind, jobId: key, viewer: _viewerJobId === key });
      maybeNotifyDone();
    }
    return;
  }
  // failed — 서버 확정일 때만
  if (cur.lastStatus !== 'failed') {
    console.info('[GenTracker] 서버 실패 확정', { kind: cur.kind, jobId: key, refunded: snap.refunded });
    store().patchJob(key, {
      ...base, lastStatus: 'failed', error: snap.error ?? null,
      refunded: snap.refunded ?? null, notCharged: snap.notCharged ?? null,
    });
    usePointsStore.getState().fetchBalance(); // 환불 반영
    maybeNotifyDone();
  }
}

// ── v3.228 비아티스트 kind 공개 API(화면·어댑터용) ─────────────────────────

export { newRequestId };

export interface RegisterGenJobInput {
  kind: GenKind;
  /** 동기 kind: POST 직전 발급한 X-Gen-Request-Id */
  requestId?: string | null;
  /** 작곡 generation_id · 연주곡 job_id 등 서버 id(알면) */
  serverJobId?: string | null;
  meta?: Record<string, any> | null;
  source?: TrackedJob['source'];
  /** 서버 created_at(회수·409 편입 시) */
  startedAt?: number | null;
}

/** kind + (requestId 또는 서버 job id)로 레코드 찾기 */
export function findGenJob(kind: GenKind, id: string | null | undefined): TrackedJob | null {
  if (!id) return null;
  const direct = store().jobs[genJobKey(kind, id)];
  if (direct) return direct;
  return (
    Object.values(store().jobs).find(
      (j) => j.kind === kind && (j.requestId === id || j.serverJobId === id)
    ) ?? null
  );
}

/**
 * 생성 접수 기록 → 폴링 개시. 반환 = 스토어 키(markGenJobDone·ackGenJob·setViewerJob에 사용).
 * 동기 kind는 POST **직전**(requestId), 작곡·연주곡은 201·202 수신 직후(serverJobId) 호출.
 */
export function registerGenJob(input: RegisterGenJobInput): string {
  const existing = findGenJob(input.kind, input.requestId) ?? findGenJob(input.kind, input.serverJobId);
  if (existing) {
    store().patchJob(existing.jobId, {
      serverJobId: input.serverJobId ?? existing.serverJobId ?? null,
      requestId: existing.requestId ?? input.requestId ?? null,
      meta: input.meta ? { ...(existing.meta || {}), ...input.meta } : existing.meta ?? null,
    });
    scheduleTick(POLL_MS);
    return existing.jobId;
  }
  const id = input.requestId || input.serverJobId || newRequestId();
  const key = genJobKey(input.kind, id);
  store().upsertJob({
    ...GEN_NEUTRAL_ARTIST_FIELDS,
    usedItems: [],
    jobId: key,
    kind: input.kind,
    startedAt: input.startedAt ?? Date.now(),
    lastStatus: 'processing',
    lastCheckedAt: null,
    ownerUserId: currentUserId() || 'unknown',
    source: input.source ?? 'local',
    notifiedAt: null,
    staleProbeAt: null,
    requestId: input.requestId ?? null,
    serverJobId: input.serverJobId ?? null,
    meta: input.meta ?? null,
    director: GEN_KIND_DIRECTOR[input.kind],
    ackedAt: null,
  });
  console.info('[GenJobStore] 접수 기록', {
    kind: input.kind, jobId: key, requestId: input.requestId ?? null, serverJobId: input.serverJobId ?? null,
  });
  scheduleTick(POLL_MS);
  return key;
}

/** 서버 409 generation_in_progress(비아티스트) → 그 job 편입(다른 기기·창 포함) */
export function adoptGenJob(snap: GenJobSnapshot): string {
  const key = registerGenJob({
    kind: snap.kind,
    requestId: snap.requestId ?? null,
    serverJobId: snap.jobId,
    meta: snap.meta ?? null,
    source: 'conflict',
    startedAt: snap.createdAtMs ?? null,
  });
  console.info('[GenTracker] 409 generation_in_progress → job 편입', { kind: snap.kind, jobId: key });
  scheduleTick(RESUME_DELAY_MS);
  return key;
}

/** 화면이 결과를 직접 받음 → done 기록. acked=true면 즉시 확인 처리(레코드 정리) */
export function markGenJobDone(key: string, result: any, opts: { acked?: boolean } = {}): void {
  const cur = store().jobs[key];
  if (!cur || cur.kind === 'artist') return;
  store().patchJob(key, { lastStatus: 'done', lastCheckedAt: Date.now(), genResult: result ?? cur.genResult ?? null });
  console.info('[GenTracker] 완성 기록(화면 수신)', { kind: cur.kind, jobId: key, acked: !!opts.acked });
  if (opts.acked) ackGenJob(key);
  else maybeNotifyDone();
}

/**
 * 결과 확인(ack) — 레코드 정리 + 회수 재편입 방지(dismissedIds).
 * processing은 확인 대상이 아님(false). 서버 ack(POST /api/generate/jobs/{kind}/{id}/ack)는 genJobsService 연결 지점.
 */
export function ackGenJob(key: string): boolean {
  const cur = store().jobs[key];
  if (!cur || cur.kind === 'artist') return false;
  if (cur.lastStatus === 'processing') return false;
  store().patchJob(key, { ackedAt: Date.now() });
  store().removeJob(key, { dismissed: true });
  console.info('[GenTracker] 결과 확인(ack)', { kind: cur.kind, jobId: key, status: cur.lastStatus });
  return true;
}

/** 결과 화면·진행 뷰어 열기(어댑터 위임). 어댑터 미등록이면 false */
export async function openGenJob(key: string, navigation?: any): Promise<boolean> {
  const job = store().jobs[key];
  if (!job || job.kind === 'artist') return false;
  const adapter = getKindAdapter(job.kind);
  if (!adapter) {
    console.warn('[GenTracker] 어댑터 미등록 — 열기 불가', { kind: job.kind, jobId: key });
    return false;
  }
  console.info('[GenTracker] 열기', { kind: job.kind, jobId: key, status: job.lastStatus });
  await adapter.open(job, navigation);
  return true;
}

/**
 * 중복 생성 가드(비아티스트) — 같은 그룹(GEN_KIND_GROUP)의 진행 중 job이 있으면 앱 내 팝업 + true.
 * 과금 게이트(피로·잔액)보다 **먼저**, 새 요청을 만들기 전에 호출:
 *   `if (guardGeneration('video', { navigation, where: 'VideoDirector' })) return;`
 * 완성됐지만 미확인 결과는 막지 않는다(사용자 결정 4). match로 대상 한정 가능(예: inst 곡별).
 */
export function guardGeneration(
  kind: GenKind,
  opts: { navigation?: any; where?: string; onDismiss?: () => void; match?: (job: TrackedJob) => boolean } = {}
): boolean {
  const group = GEN_KIND_GROUP[kind];
  const kinds = (Object.keys(GEN_KIND_GROUP) as GenKind[]).filter((k) => GEN_KIND_GROUP[k] === group);
  const job = listUserGenJobs(kinds).find(
    (j) => j.lastStatus === 'processing' && (!opts.match || opts.match(j))
  );
  if (!job) return false;
  const adapter = getKindAdapter(job.kind) ?? getKindAdapter(kind);
  console.info('[GenTracker] 중복 생성 차단', { kind, where: opts.where ?? '-', jobId: job.jobId, status: job.lastStatus });
  const title = adapter?.text.busyTitle ?? '이미 만드는 중이에요';
  const body = adapter?.text.busyBody ?? '완성된 뒤에 새로 만들 수 있어요.';
  const buttons: Array<{ text: string; style?: 'cancel'; onPress?: () => void }> = [
    { text: '닫기', style: 'cancel', onPress: opts.onDismiss },
  ];
  if (adapter) buttons.push({ text: '진행 상황 보기', onPress: () => { void openGenJob(job.jobId, opts.navigation); } });
  showAlert(title, body, buttons);
  return true;
}

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
