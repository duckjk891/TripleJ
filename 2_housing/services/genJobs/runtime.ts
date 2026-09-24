import {
  useGenerationJobStore,
  listUserGenJobs,
  GEN_KIND_DIRECTOR,
  GEN_NEUTRAL_ARTIST_FIELDS,
  type TrackedJob,
  type TrackedJobKind,
} from '../../stores/generationJobStore';
import { useAuthStore } from '../../stores/authStore';
import { usePointsStore } from '../../stores/pointsStore';
import { showAlert } from '../../utils/appAlert';
import {
  getKindAdapter,
  listKindAdapters,
  genJobKey,
  newRequestId,
  chargeNotice,
  CHARGE_UNCONFIRMED_BODY,
  SYNC_GEN_KINDS,
  GEN_KIND_GROUP,
  type GenKind,
  type GenKindAdapter,
  type GenJobSnapshot,
} from './index';
import { listGenRecoverable, getGenJobByRequest, ackGenJobOnServer } from '../genJobsService';

// ── v3.228 D4 [GenTracker] 비아티스트 kind 런타임 ──────────────────────────────────
// 전역 추적기(services/generationTracker.ts) 본체에서 분리한 비아티스트 부분:
//   - 레지스트리 GenKindAdapter → 추적기 어댑터 래퍼(공용 스냅샷 반영·404 유예·도착 알림)
//   - 회수 목록(GET /api/generate/jobs/recoverable) 병합 — 등록된 kind만 요청(등록 0이면 호출 0)
//   - 화면·어댑터용 공개 API(registerGenJob·adoptGenJob·markGenJobDone·ackGenJob·openGenJob·guardGeneration)
// 추적기 본체와의 연결은 bindGenTrackerHooks(단방향 import — 순환 없음).
// 로그 prefix는 추적기와 같은 [GenTracker](kind= 포함).

/** 추적기 내부 kind 어댑터 — tick·부팅 확인·알림이 kind별 동작을 여기로 위임 */
export interface TrackerKindAdapter {
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

export interface GenTrackerHooks {
  /** 다음 폴링 예약(POLL_MS) */
  schedulePoll(): void;
  /** 곧 폴링(RESUME_DELAY_MS) */
  scheduleSoon(): void;
  /** 뷰어 밖 알림 1회 시도 */
  notify(): void;
  /** 추적 뷰어가 보고 있는 레코드 키 */
  viewerJob(): string | null;
}

/** 동기 kind 요청 후 이 시간 안의 404는 "아직 서버 도착 전"으로 보고 processing 유지 */
const NOT_ARRIVED_GRACE_MS = 120 * 1000;
/** 구서버 판정 후 재확인 간격(배포 직후 재시작 없이 신서버 인식) */
const CAPABILITY_RECHECK_MS = 10 * 60 * 1000;

let _hooks: GenTrackerHooks = {
  schedulePoll: () => {},
  scheduleSoon: () => {},
  notify: () => {},
  viewerJob: () => null,
};

/** 추적기 본체가 모듈 로드 시 1회 호출 */
export function bindGenTrackerHooks(hooks: GenTrackerHooks): void {
  _hooks = hooks;
}

function store() {
  return useGenerationJobStore.getState();
}

// ── 살아 있는 요청(이 JS 세션에서 응답을 기다리는 화면 요청) ─────────────────────
// 동기 kind 404가 유예를 넘겼을 때: 살아 있는 요청이 있으면 결과 판정을 화면에 맡기고(킬스위치·구서버 대비),
// 없으면(= resume 뷰어·재시작 후) 레코드를 정리한다. 표식은 kind 상한이 지나면 무효(무한 대기 방지).
const _liveRequests = new Map<string, number>(); // key → 요청 시작 시각

function isLiveRequest(job: TrackedJob): boolean {
  const at = _liveRequests.get(job.jobId);
  if (at === undefined) return false;
  const cap = getKindAdapter(job.kind)?.capMs ?? NOT_ARRIVED_GRACE_MS;
  if (Date.now() - at >= cap) {
    _liveRequests.delete(job.jobId);
    return false;
  }
  return true;
}

/**
 * 화면의 요청이 응답 없이 끝남(ERR_NETWORK·timeout·5xx·화면 이탈) → 이후 결과는 추적기가 원장으로 판정.
 * (markGenJobDone·discardGenJob·ackGenJob은 자동으로 표식을 지운다)
 */
export function endGenRequest(key: string): void {
  if (_liveRequests.delete(key)) console.info('[GenTracker] 화면 요청 종료 → 원장 추적', { jobId: key });
}

function currentUserId(): string | null {
  const id = useAuthStore.getState().user?.id;
  return id ? String(id) : null;
}

// ── 서버 기능 판정(구서버·킬스위치 폴백) ───────────────────────────────────

export type GenJobsCapability = 'unknown' | 'yes' | 'no';
let _genCap: GenJobsCapability = 'unknown';
let _genCapCheckedAt = 0;

/** 원장 API(recoverable) 지원 여부 — 'no'면 화면은 기존 폴백(I-lite·cover-history 등)을 쓴다 */
export function getGenJobsCapability(): GenJobsCapability {
  return _genCap;
}

// ── 추적기 어댑터 래퍼 ────────────────────────────────────────────────────

const _wrapped = new WeakMap<GenKindAdapter, TrackerKindAdapter>();

function wrapAdapter(gen: GenKindAdapter): TrackerKindAdapter {
  const cached = _wrapped.get(gen);
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
        // 서버가 쓴 과금 문장(재시작 정리 "…환불됐어요" 등)은 그대로, 아니면 chargeNotice(X-K1)
        const e = (job.error || '').trim();
        const body = e && /별|⭐|환불|차감/.test(e) ? e : chargeNotice(job.refunded, job.notCharged);
        showAlert(gen.text.failTitle, body, [
          { text: '확인', onPress: () => { ackGenJob(job.jobId); } },
        ]);
        return;
      }
      showAlert(gen.text.doneTitle, gen.text.doneBody, [
        { text: '나중에', style: 'cancel' },
        { text: '지금 보기', onPress: () => { void openGenJob(job.jobId); } },
      ]);
    },
  };
  _wrapped.set(gen, a);
  return a;
}

/** 등록된 비아티스트 kind의 추적기 어댑터(등록 순서) */
export function genTrackerAdapters(): TrackerKindAdapter[] {
  return listKindAdapters().map(wrapAdapter);
}

export function genTrackerAdapterFor(kind: TrackedJobKind): TrackerKindAdapter | null {
  if (kind === 'artist') return null;
  const gen = getKindAdapter(kind);
  return gen ? wrapAdapter(gen) : null;
}

export function hasGenKinds(): boolean {
  return listKindAdapters().length > 0;
}

// ── 스냅샷 반영 ───────────────────────────────────────────────────────────

/** 비아티스트 서버 스냅샷 반영(null = 404). 실패 표시는 서버 failed일 때만 */
export function applyGenSnapshot(key: string, snap: GenJobSnapshot | null): void {
  const cur = store().jobs[key];
  if (!cur || cur.kind === 'artist') return;
  const now = Date.now();
  if (snap && snap.status === 'unknown') {
    // 알 수 없는 서버 상태 — 실패·삭제로 단정하지 않고 유지(상한 경과 시 서버 sweep이 확정)
    console.warn('[GenTracker] 알 수 없는 서버 상태 — 유지', { kind: cur.kind, jobId: key });
    store().patchJob(key, { lastCheckedAt: now });
    return;
  }
  if (!snap) {
    // 동기 kind, 또는 서버 id 없이 requestId로만 찾는 레코드(작곡 201 응답 유실 등) → 도착 유예 대상
    const isSync = SYNC_GEN_KINDS.has(cur.kind as GenKind) || (!cur.serverJobId && !!cur.requestId);
    if (cur.lastStatus === 'processing' && isSync) {
      if (now - cur.startedAt < NOT_ARRIVED_GRACE_MS) {
        // 요청이 아직 서버 원장에 닿기 전 — 유예
        store().patchJob(key, { lastCheckedAt: now });
        return;
      }
      if (isLiveRequest(cur)) {
        // X-K1: 404는 킬스위치·구서버일 수도 있다 — 화면이 자기 요청의 응답을 기다리는 중이면
        // 결과는 화면이 판정한다(markGenJobDone / discardGenJob / endGenRequest). 과금 여부 단정 안내 금지.
        store().patchJob(key, { lastCheckedAt: now });
        return;
      }
      // resume 뷰어(자기 요청 없음)·재시작 후: 정리 + 뷰어가 보고 있으면 중립 안내(X-K1 — 과금 단정 금지)
      console.info('[GenTracker] job 없음(404, 유예 경과) — 정리', {
        kind: cur.kind, jobId: key, viewer: _hooks.viewerJob() === key,
      });
      store().removeJob(key);
      if (_hooks.viewerJob() === key) showAlert('결과를 확인하지 못했어요', CHARGE_UNCONFIRMED_BODY);
      return;
    }
    console.info('[GenTracker] job 없음(404) — 조용히 정리', { kind: cur.kind, jobId: key });
    store().removeJob(key);
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
      console.info('[GenTracker] 완성 수신', { kind: cur.kind, jobId: key, viewer: _hooks.viewerJob() === key });
      _hooks.notify();
    }
    return;
  }
  // failed — 서버 확정일 때만
  if (cur.lastStatus !== 'failed') {
    console.info('[GenTracker] 서버 실패 확정', { kind: cur.kind, jobId: key, refunded: snap.refunded ?? null });
    store().patchJob(key, {
      ...base, lastStatus: 'failed', error: snap.error ?? null,
      refunded: snap.refunded ?? null, notCharged: snap.notCharged ?? null,
    });
    usePointsStore.getState().fetchBalance(); // 환불 반영
    _hooks.notify();
  }
}

// ── 회수 목록 병합 ────────────────────────────────────────────────────────

function isDismissed(kind: GenKind, snap: GenJobSnapshot, dismissed: Set<string>): boolean {
  if (dismissed.has(genJobKey(kind, snap.jobId))) return true;
  return !!snap.requestId && dismissed.has(genJobKey(kind, snap.requestId));
}

/**
 * GET /api/generate/jobs/recoverable 병합 — 추적기 refreshRecoverable 안에서 호출. never-throw.
 * 등록된 kind가 없으면 호출하지 않는다. 404·405 = 구서버 → 조용히(10분 뒤 재확인).
 */
export async function mergeGenRecoverable(reason: string): Promise<void> {
  const kinds = listKindAdapters().map((a) => a.kind);
  if (kinds.length === 0 || !currentUserId()) return;
  if (_genCap === 'no' && Date.now() - _genCapCheckedAt < CAPABILITY_RECHECK_MS) return;
  try {
    const { supported, jobs } = await listGenRecoverable(kinds);
    _genCapCheckedAt = Date.now();
    if (!supported) {
      if (_genCap !== 'no') console.info('[GenTracker] recoverable(gen) 미지원(구서버) — 로컬 추적만 사용');
      _genCap = 'no';
      return;
    }
    _genCap = 'yes';
    const allow = new Set<GenKind>(kinds);
    const dismissed = new Set(store().dismissedIds);
    let added = 0;
    for (const snap of jobs) {
      if (!allow.has(snap.kind) || snap.status === 'unknown') continue;
      if (isDismissed(snap.kind, snap, dismissed)) {
        // 로컬에선 확인했는데 서버 ack가 유실됨 — 재전송(best-effort)
        if (snap.status !== 'processing') void ackGenJobOnServer(snap.kind, snap.jobId);
        continue;
      }
      const local = findGenJob(snap.kind, snap.requestId) ?? findGenJob(snap.kind, snap.jobId);
      if (local) {
        if (local.lastStatus === 'processing' && snap.status !== 'processing') applyGenSnapshot(local.jobId, snap);
        else if (!local.serverJobId) store().patchJob(local.jobId, { serverJobId: snap.jobId });
        continue;
      }
      const key = insertGenRecord({
        kind: snap.kind,
        requestId: snap.requestId ?? null,
        serverJobId: snap.jobId,
        meta: snap.meta ?? null,
        source: 'recovered',
        startedAt: snap.createdAtMs ?? null,
      });
      if (snap.status !== 'processing') applyGenSnapshot(key, snap);
      added++;
    }
    console.info('[GenTracker] recoverable 병합(gen)', { reason, kinds, server: jobs.length, added });
    if (listUserGenJobs().some((j) => j.lastStatus === 'processing')) _hooks.scheduleSoon();
    _hooks.notify();
  } catch (err: any) {
    // 오류는 무시(다음 트리거에서 재시도) — 실패 표시 없음
    console.warn('[GenTracker] recoverable(gen) 조회 오류', { status: err?.response?.status ?? null });
  }
}

// ── 공개 API(화면·어댑터용) ────────────────────────────────────────────────

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

/** kind + (레코드 키 · requestId · 서버 job id)로 레코드 찾기 */
export function findGenJob(kind: GenKind, id: string | null | undefined): TrackedJob | null {
  if (!id) return null;
  const direct = store().jobs[genJobKey(kind, id)] ?? store().jobs[id];
  if (direct && direct.kind === kind) return direct;
  return (
    Object.values(store().jobs).find(
      (j) => j.kind === kind && (j.requestId === id || j.serverJobId === id)
    ) ?? null
  );
}

function insertGenRecord(input: RegisterGenJobInput): string {
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
    kind: input.kind, jobId: key, requestId: input.requestId ?? null,
    serverJobId: input.serverJobId ?? null, source: input.source ?? 'local',
  });
  return key;
}

/**
 * 생성 접수 기록 → 폴링 개시. 반환 = 스토어 키(markGenJobDone·ackGenJob·setViewerJob·openGenJob에 사용).
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
    _hooks.schedulePoll();
    return existing.jobId;
  }
  const key = insertGenRecord(input);
  if (input.requestId && (input.source ?? 'local') === 'local' && SYNC_GEN_KINDS.has(input.kind)) {
    _liveRequests.set(key, Date.now());
  }
  _hooks.schedulePoll();
  return key;
}

/**
 * 원장 생성 전 거절(400·403·429·402 등 — 서버에 원장이 없음) → "만드는 중" 레코드 즉시 폐기.
 * 402 → 충전 → 재시도가 "이미 만드는 중"에 막히지 않게 한다. 서버 ack 전송 없음.
 */
export function discardGenJob(key: string, reason?: string): void {
  _liveRequests.delete(key);
  const cur = store().jobs[key];
  if (!cur || cur.kind === 'artist') return;
  store().removeJob(key);
  console.info('[GenTracker] 접수 폐기(원장 전 거절)', { kind: cur.kind, jobId: key, reason: reason ?? '-' });
}

/**
 * 서버 409 generation_in_progress(비아티스트, genJobsService.parseGenInProgress 결과) → 그 job 편입.
 * replaceKey = 방금 이 요청으로 등록한 레코드 키: 서버 job이 다른 요청이면 그 레코드를 폐기(원장 없음),
 * 같은 request_id(재전송)면 같은 레코드를 유지·갱신한다. 반환 = 추적할 키.
 */
export function adoptGenJob(snap: GenJobSnapshot, opts: { replaceKey?: string | null } = {}): string {
  const local = opts.replaceKey ? store().jobs[opts.replaceKey] : null;
  if (local && !(snap.requestId && local.requestId === snap.requestId)) {
    discardGenJob(local.jobId, 'conflict-other-job');
  } else if (local) {
    _liveRequests.delete(local.jobId); // 같은 요청의 재전송 — 이 요청의 응답은 409로 끝남 → 원장 추적
  }
  const key = registerGenJob({
    kind: snap.kind,
    requestId: snap.requestId ?? null,
    serverJobId: snap.jobId,
    meta: snap.meta ?? null,
    source: 'conflict',
    startedAt: snap.createdAtMs ?? null,
  });
  console.info('[GenTracker] 409 generation_in_progress → job 편입', { kind: snap.kind, jobId: key });
  _hooks.scheduleSoon();
  return key;
}

/** 화면이 결과를 직접 받음 → done 기록. acked=true면 즉시 확인 처리(레코드 정리 + 서버 ack) */
export function markGenJobDone(key: string, result: any, opts: { acked?: boolean; serverJobId?: string | null } = {}): void {
  _liveRequests.delete(key);
  const cur = store().jobs[key];
  if (!cur || cur.kind === 'artist') return;
  store().patchJob(key, {
    lastStatus: 'done',
    lastCheckedAt: Date.now(),
    genResult: result ?? cur.genResult ?? null,
    serverJobId: opts.serverJobId ?? cur.serverJobId ?? null,
  });
  console.info('[GenTracker] 완성 기록(화면 수신)', { kind: cur.kind, jobId: key, acked: !!opts.acked });
  if (opts.acked) ackGenJob(key);
  else _hooks.notify();
}

/**
 * 화면이 최종 결과(서버 완료·서버 확정 실패)를 직접 보여줬음 → 확인 처리.
 * 로컬 레코드가 있으면(키·requestId·서버 id로 찾음) 상태를 확정하고 ack(로컬 정리 + 서버 ack),
 * 없으면(이력·다른 기기·편입 전) 서버 ack만 보낸다(재배달 방지). id = 서버 job id 권장.
 */
export function settleGenJob(
  kind: GenKind,
  id: string | null | undefined,
  outcome: 'done' | 'failed',
  info: { result?: any; error?: string | null; refunded?: boolean | null } = {}
): void {
  if (!id) return;
  const local = findGenJob(kind, id);
  if (local) {
    _liveRequests.delete(local.jobId);
    const isServerId = id !== local.jobId && id !== local.requestId;
    store().patchJob(local.jobId, {
      lastStatus: outcome,
      lastCheckedAt: Date.now(),
      serverJobId: local.serverJobId ?? (isServerId ? id : null),
      ...(outcome === 'done'
        ? { genResult: info.result ?? local.genResult ?? null }
        : { error: info.error ?? null, refunded: info.refunded ?? null }),
    });
    ackGenJob(local.jobId);
    return;
  }
  console.info('[GenTracker] 결과 확인(로컬 레코드 없음) — 서버 ack만', { kind, id, outcome });
  void ackGenJobOnServer(kind, id);
}

async function sendServerAck(job: TrackedJob): Promise<void> {
  const kind = job.kind as GenKind;
  let serverJobId = job.serverJobId ?? null;
  if (!serverJobId && job.requestId) {
    try {
      serverJobId = (await getGenJobByRequest(job.requestId, kind))?.jobId ?? null;
    } catch {
      serverJobId = null;
    }
  }
  if (!serverJobId) {
    console.info('[GenTracker] 서버 ack 생략(서버 job 없음)', { kind, jobId: job.jobId });
    return;
  }
  const outcome = await ackGenJobOnServer(kind, serverJobId);
  console.info('[GenTracker] 서버 ack', { kind, jobId: job.jobId, outcome });
}

/**
 * 결과 확인(ack) — 로컬 정리(회수 재편입 방지 dismissedIds) + 서버 ack(best-effort, 유실 시 다음 회수 병합에서 재전송).
 * processing은 확인 대상이 아님(false).
 */
export function ackGenJob(key: string): boolean {
  const cur = store().jobs[key];
  if (!cur || cur.kind === 'artist') return false;
  if (cur.lastStatus === 'processing') return false;
  _liveRequests.delete(key);
  store().patchJob(key, { ackedAt: Date.now() });
  store().removeJob(key, { dismissed: true });
  console.info('[GenTracker] 결과 확인(ack)', { kind: cur.kind, jobId: key, status: cur.lastStatus });
  void sendServerAck(cur);
  return true;
}

/** 결과 화면·진행 뷰어 열기(어댑터 위임). 레코드·어댑터가 없으면 false */
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
