// v3.360 [Prebuffer] 웹 다음 곡 미리 받기 — 화면 꺼짐 상태 곡 전환 끊김 대책.
// 실측(10-13~14, frontend.log + 서버 접근 로그): 끊김은 전부 vis=hidden·online=true 에서 곡이 바뀌는 순간의
// MediaError code 4. 서버 로그엔 그 순간의 stream-proxy 요청이 아예 없고, 화면을 켠 뒤 재시도 1건만 도착했다
// → 곡 사이 재생이 멈춘 찰나에 안드로이드 크롬이 숨은 페이지의 네트워크를 막는다(웹 레벨에서 못 피함).
// 종전 웹은 다음 곡의 '주소'만 알고 오디오는 곡 경계에서야 받기 시작했다(maybePreloadNext 는 네이티브 전용).
// 이제 현재 곡이 재생 중일 때(페이지가 소리를 내는 동안 = 네트워크 허용) 다음 곡 전체를 Blob 으로 받아 두고,
// 곡이 끝나면 blob: 주소로 교체해 경계에서 네트워크가 필요 없게 한다. 실패하면 종전처럼 proxy 주소(무해 폴백).
// blob 재생 중 오류는 webAudioElement 재시도가 errorRecoveryUrlProvider(proxy 주소)로 복구한다.
import { streamProxyUrl } from './api';
import { webCurrentSrc } from './webAudioElement';

const MAX_BYTES = 30 * 1024 * 1024; // 곡당 상한(정상 곡 4~10MB) — 넘으면 받지 않음
const TIMEOUT_MS = 90_000;

type Entry = { id: string; blobUrl: string; bytes: number };
let ready: Entry | null = null; // 다음 곡으로 받아 둔 것(1개)
let playing: Entry | null = null; // 지금 재생 중인 blob
let retired: Entry[] = []; // 재생에서 물러난 blob — 오디오 src 가 아니게 되는 즉시 해제
let inflight: { id: string; ctrl: AbortController } | null = null;

function revoke(e: Entry | null) {
  if (!e) return;
  try { URL.revokeObjectURL(e.blobUrl); } catch {}
}

function sweepRetired() {
  const src = webCurrentSrc();
  retired = retired.filter((e) => {
    if (e.blobUrl === src) return true;
    revoke(e);
    return false;
  });
}

/** 받아 둔 다음 곡이 이 곡이면 blob 주소(소유권은 재생 쪽으로 넘어감), 아니면 null */
export function takePrebuffered(trackId: string): string | null {
  if (!ready || ready.id !== String(trackId)) return null;
  const e = ready;
  ready = null;
  if (playing) retired.push(playing); // 직전 blob — 교체가 끝나 src 가 아니게 되면 해제
  playing = e;
  sweepRetired();
  return e.blobUrl;
}

/** 다음 곡 미리 받기 — 같은 곡이 이미 준비/진행 중이면 무시. 다른 곡이 진행 중이면 취소 후 새로. */
export function prebufferTrack(track: any): void {
  if (typeof window === 'undefined' || typeof fetch !== 'function' || !track?.id) return;
  const id = String(track.id);
  if (ready?.id === id || inflight?.id === id) return;
  if (inflight) { try { inflight.ctrl.abort(); } catch {} inflight = null; }
  if (ready) { revoke(ready); ready = null; }
  const ctrl = new AbortController();
  inflight = { id, ctrl };
  const timer = setTimeout(() => { try { ctrl.abort(); } catch {} }, TIMEOUT_MS);
  const started = Date.now();
  (async () => {
    try {
      const res = await fetch(streamProxyUrl(track), { signal: ctrl.signal, credentials: 'omit' });
      const len = Number(res.headers.get('content-length') || 0);
      const type = res.headers.get('content-type') || '';
      if (!res.ok || (len && len > MAX_BYTES) || /json|html|text/i.test(type)) {
        console.warn('[Prebuffer] 건너뜀', { id, status: res.status, len, type: type.slice(0, 30) });
        return;
      }
      const blob = await res.blob();
      if (inflight?.id !== id) return; // 그 사이 다른 곡으로 바뀜
      if (blob.size === 0 || blob.size > MAX_BYTES) return;
      ready = { id, blobUrl: URL.createObjectURL(blob), bytes: blob.size };
      if (__DEV__) console.info('[Prebuffer] 준비 완료', { id, bytes: blob.size, ms: Date.now() - started });
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        console.warn('[Prebuffer] 실패(경계에서 종전 방식으로 받음)', { id, message: String(err?.message || '').slice(0, 80) });
      }
    } finally {
      clearTimeout(timer);
      if (inflight?.id === id) inflight = null;
    }
  })();
}

/** 지금 재생 src 가 blob 이 아니게 되면(직접 재생 등) 재생용 blob 해제 — 메모리 회수 */
export function releaseStalePlaying(): void {
  if (playing && playing.blobUrl !== webCurrentSrc()) {
    retired.push(playing);
    playing = null;
  }
  sweepRetired();
}
