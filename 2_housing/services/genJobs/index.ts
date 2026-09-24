import {
  GEN_KIND_DIRECTOR,
  type GenJobKind,
  type GenJobDirector,
  type TrackedJob,
} from '../../stores/generationJobStore';

// ── v3.228 D4 [GenJob]: 비아티스트 생성 kind 어댑터 레지스트리 ───────────────────────
// 전역 추적기(services/generationTracker.ts)가 kind별 서버 조회·결과 화면 열기·문구를 여기 등록된
// 어댑터에 위임한다. 아티스트는 추적기 내부 어댑터(기존 경로 그대로)로 처리하므로 여기 등록하지 않는다.
// 파일 소유: index·lyrics·music·inst = 1조, cover(cover·cover_refine)·video = 2조.
// 이 파일은 순수 레지스트리(추적기·화면 import 금지 — 순환 방지).

export type GenKind = GenJobKind;
export type GenDirector = GenJobDirector;
export { GEN_KIND_DIRECTOR };

/** 서버 스냅샷(어댑터가 서버 계약을 이 형태로 정규화) */
export interface GenJobSnapshot {
  jobId: string;
  requestId?: string | null;
  kind: GenKind;
  status: 'processing' | 'done' | 'failed' | 'unknown';
  createdAtMs?: number;
  result?: any;
  error?: string | null;
  refunded?: boolean | null;
  /** 서버가 미차감을 명시(not_charged)한 경우만 true — 그 외 과금 여부 단정 금지(X-K1) */
  notCharged?: boolean | null;
  acked?: boolean;
  meta?: any;
}

export interface GenKindText {
  /** 중복 가드 팝업 제목 — "이미 ○○ 중이에요" */
  busyTitle: string;
  busyBody: string;
  doneTitle: string;
  doneBody: string;
  /** 서버 실패 확정 — "○○을 끝내지 못했어요" */
  failTitle: string;
}

export interface GenKindAdapter {
  kind: GenKind;
  director: GenDirector;
  /** 이 시간이 지나도 processing이면 recoverable 1회(서버 lazy sweep 유도) */
  capMs: number;
  /** "평소보다 오래 걸리고 있어요" 기준 */
  slowMs: number;
  /**
   * 서버 조회. null = 404(없음). 네트워크 오류·5xx·timeout은 throw(추적기가 상태 유지·백오프 —
   * 실패로 표시하지 않는다).
   */
  fetch(job: TrackedJob): Promise<GenJobSnapshot | null>;
  /** done → 결과 화면(+ack) / processing → 진행 뷰어(POST 없음) */
  open(job: TrackedJob, navigation?: any): Promise<void>;
  text: GenKindText;
}

/** 동기 요청형(원장 기반) kind — 요청 직후 404는 "아직 도착 전" 유예 대상 */
export const SYNC_GEN_KINDS: ReadonlySet<GenKind> = new Set<GenKind>(['lyrics', 'cover', 'cover_refine', 'video']);

/** 중복 차단 그룹(D3) — 같은 그룹의 processing 1건이 새 생성을 막는다. inst는 곡별 서버 claim(앱 그룹 가드 없음) */
export const GEN_KIND_GROUP: Record<GenKind, string> = {
  lyrics: 'lyrics',
  music: 'music',
  inst: 'inst',
  cover: 'image',
  cover_refine: 'image',
  video: 'video',
};

const _registry = new Map<GenKind, GenKindAdapter>();

/** 어댑터 등록(멱등 — 같은 kind 재등록은 교체) */
export function registerKind(adapter: GenKindAdapter): void {
  const had = _registry.has(adapter.kind);
  _registry.set(adapter.kind, adapter);
  console.info('[GenJob] registerKind', { kind: adapter.kind, director: adapter.director, replaced: had });
}

export function getKindAdapter(kind: string): GenKindAdapter | null {
  return _registry.get(kind as GenKind) ?? null;
}

/** 등록 순서대로 */
export function listKindAdapters(): GenKindAdapter[] {
  return Array.from(_registry.values());
}

/** 스토어 레코드 키 — `${kind}:${id}`(id = requestId 우선, 없으면 서버 job id) */
export function genJobKey(kind: GenKind, id: string): string {
  return `${kind}:${id}`;
}

/** X-Gen-Request-Id — 32자리 소문자 hex(서버 `^[0-9a-f]{32}$`) */
export function newRequestId(): string {
  const bytes = new Uint8Array(16);
  const c: any = (globalThis as any).crypto;
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

// ── v3.228 X-K1: 과금 안내 문구 — 서버가 명시한 경우에만 환불·미차감을 단정 ─────────────

/** 과금 여부를 확인할 수 없을 때(404·킬스위치·구서버·네트워크) 중립 안내 */
export const CHARGE_UNCONFIRMED_BODY = '잠시 후 다시 확인하거나 별 사용 내역을 확인해 주세요.';

/** 실패 확정 시 과금 안내 한 줄 — refunded===true / notCharged===true일 때만 단정 */
export function chargeNotice(refunded?: boolean | null, notCharged?: boolean | null): string {
  if (refunded === true) return '사용된 별은 자동으로 환불됐어요.';
  if (notCharged === true) return '별은 차감되지 않았어요.';
  return '별 사용 내역을 확인해 주세요.';
}
