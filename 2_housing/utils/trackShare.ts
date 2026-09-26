// v3.235 B1 [TrackShare] 곡 공유 — 공용 ⋯ 메뉴(TrackActionSheet) '공유하기'의 단일 구현.
//  · 링크 = `${BACKEND_BASE_URL}/track/{id}` (D8) — 서버 공유 랜딩(OG 카드 → 웹앱 `?track=` 즉시 이동).
//    과거 마이페이지 공유 링크(`/track/{id}`)와 형식이 같아 이미 퍼진 링크도 랜딩 배포 후 살아난다.
//  · 전달 = 네이티브 공유 창(Share.share) 우선. 웹은 navigator.share 가 있으면 그것(RN-web Share 가 위임),
//    없거나 거부되면 클립보드 복사 + 앱 내 안내(PlayerScreen 가사 공유 :950-965 관행). 복사도 실패하면
//    링크를 보여주는 다이얼로그 + '링크 복사' 버튼(새 사용자 제스처로 재시도 — 웹 활성화 요건).
//  · 비공개 내 곡 = "차트에 공개하고 공유할까요?" 확인 → 기존 공개 전환 API(PUT /tracks/{id} {is_public:true},
//    MyMusic '차트에 업로드' 동일) 성공 시 공유(D7). 남의 비공개 곡(정상 경로 도달 불가)은 안내만.
//  · 웹은 Share 호출 전에 await 를 두지 않는다 — navigator.share·clipboard 는 탭 직후(사용자 활성화) 안에서만 허용.
// v3.237 A조: 고정 문구(buildTrackShareText 등) 제거 → 공유 문구 화면(ShareCompose)이 문구를 만든다.
//  · shareTrack = 진입 게이트(24hex·비공개 확인) → onCompose(track, isOwn) 로 화면 이동(공개 전환 후에도 동일 —
//    웹 '한 번 더 탭' 단계 불필요: 화면의 [공유하기] 가 새 사용자 제스처).
//  · deliverShareText({trackId, text, url}) = v3.235 전달부 일반화(네이티브 Share / 웹 navigator.share / 클립보드 폴백).
import { Platform, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import api, { BACKEND_BASE_URL } from '../services/api';
import { showAlert } from './appAlert';
import { TRACK_ID_RE } from './trackLink';

export interface ShareableTrack {
  id: string | number;
  title?: string;
  artist_name?: string;
  is_public?: boolean;
  uploader_id?: string | number;
  cover_image?: string;
  cover_image_url?: string;
  /** v3.237 버그 1: 공유 문구 아티스트 판정용(실제 캐릭터 정보) — utils/shareMessage.verifiedArtistName */
  character_id?: string;
  user_character_snapshot?: { name?: string };
}

/** shared=공유 창 완료 · copied=클립보드 복사 · manual=복사 실패→링크 다이얼로그 · cancelled=사용자가 닫음 ·
 *  failed=오류 · aborted=공유하지 않음(비공개 남의 곡·공개 확인 취소) · pending=공개 확인 대기(결과는 onDone) ·
 *  compose=공유 문구 화면으로 이동(v3.237 — 최종 결과는 화면이 기록) */
export type ShareOutcome = 'shared' | 'copied' | 'manual' | 'cancelled' | 'failed' | 'aborted' | 'pending' | 'compose';

export interface ShareTrackOptions {
  /** 내 곡 여부 — 모르면 생략(비공개 곡 공개 전환 가능 여부·문구에 사용) */
  isOwn?: boolean;
  /** 비공개 → 공개 전환 성공 직후(공유 전) — 목록 갱신('차트 스트리밍 중' 표시)용 */
  onPublished?: (trackId: string) => void;
  /** 공유 흐름 종료(결과 포함) — v3.237: 화면 이동 전 단계의 결과(compose·aborted·failed)만 */
  onDone?: (trackId: string, outcome: ShareOutcome) => void;
  /** v3.237: 공유 문구 화면 열기(공개 곡 즉시·비공개 내 곡은 공개 전환 성공 후) */
  onCompose: (track: ShareableTrack, isOwn: boolean) => void;
  /** 로그용 진입 화면 */
  src?: string;
}

/** 공유 링크 — 서버 공유 랜딩(S7) 주소 */
export function trackShareUrl(id: string | number): string {
  return `${BACKEND_BASE_URL}/track/${encodeURIComponent(String(id))}`;
}

/** 플랫폼별 Share.share 인자(순수).
 *  · 안드로이드: url 필드를 무시하므로 message 에 링크 포함(v3.235).
 *  · iOS(v3.237 오케스트레이터 판정 6 — D12 안전책 선적용): message + url 분리 시 받는 앱에 따라 문구나 링크 한쪽만
 *    전달될 수 있어 message 에 링크 포함·url 필드 생략(링크 1회·순서 본문→혜택→링크 보장, 미리보기는 본문 속 URL 로 생성).
 *  · 웹(navigator.share): text + url 분리 유지(v3.235) — 실기기(P-5)에서 링크 누락 시 같은 방식으로 전환. */
export function buildShareTextPayload(text: string, url: string, os: string): { message: string; url?: string } {
  if (os === 'android' || os === 'ios') return { message: `${text}\n${url}` };
  return { message: text, url };
}

/** 공유 창 오류 분류(순수) — 사용자가 닫은 것(AbortError)은 조용히 종료, 그 외는 복사 폴백 */
export function isShareCancelError(err: any): boolean {
  const name = String(err?.name || '');
  return name === 'AbortError';
}

/** 웹 공유 API 보유 여부(웹 전용 — 네이티브는 항상 false) */
function hasWebShare(): boolean {
  try {
    return Platform.OS === 'web' && typeof navigator !== 'undefined' && typeof (navigator as any).share === 'function';
  } catch {
    return false;
  }
}

const log = (event: string, extra?: Record<string, any>) => console.info(`[TrackShare] ${event}`, extra || {});

/** 클립보드 복사 — 성공 여부(웹은 실패 시 false 반환·네이티브는 throw 가능 → false) */
async function copyText(text: string): Promise<boolean> {
  try {
    const ok = await Clipboard.setStringAsync(text);
    return ok !== false;
  } catch (err: any) {
    console.error('[TrackShare] fail — clipboard', { message: err?.message });
    return false;
  }
}

/** 복사 실패 시 마지막 수단 — 링크를 보여주고 버튼 탭(새 제스처)으로 다시 복사 */
function showManualCopy(message: string, url: string, trackId: string) {
  showAlert('링크 복사', `아래 링크를 복사해서 공유해 주세요.\n${url}`, [
    { text: '닫기', style: 'cancel' },
    {
      text: '링크 복사',
      onPress: () => {
        copyText(message).then((ok) => {
          log(ok ? 'copied' : 'fail', { id: trackId, via: 'manual-retry' });
          if (ok) showAlert('링크 복사 완료', '공유 문구와 링크를 복사했어요. 원하는 곳에 붙여넣어 공유하세요!');
          else showAlert('알림', `링크를 길게 눌러 복사해 주세요.\n${url}`);
        });
      },
    },
  ]);
}

async function copyWithNotice(message: string, url: string, trackId: string): Promise<ShareOutcome> {
  const ok = await copyText(message);
  if (ok) {
    log('copied', { id: trackId });
    showAlert('링크 복사 완료', '공유 문구와 링크를 복사했어요. 원하는 곳에 붙여넣어 공유하세요!');
    return 'copied';
  }
  log('fail', { id: trackId, reason: 'copy-failed' });
  showManualCopy(message, url, trackId);
  return 'manual';
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface DeliverShareInput {
  trackId: string;
  /** 본문 + 혜택(링크 제외) */
  text: string;
  /** 링크(?s= 포함) */
  url: string;
  /** iOS 네이티브: 직전에 닫힌 Modal 과 공유 창 표시가 겹칠 때만 대기(ms, 기본 0) */
  iosSettleMs?: number;
}

/**
 * 공유 전달(공개 곡 전제) — v3.235 deliverTrackShare 일반화.
 * 웹: 첫 await 전에 navigator.share(또는 복사)를 호출해 사용자 활성화를 지킨다(탭 핸들러에서 동기 호출할 것).
 */
export async function deliverShareText(input: DeliverShareInput): Promise<ShareOutcome> {
  const { trackId, text, url } = input;
  const message = `${text}\n${url}`;
  const canNativeShare = Platform.OS !== 'web' || hasWebShare();
  if (!canNativeShare) {
    // 웹 + 공유 API 없음(PC 브라우저·일부 인앱) → 곧바로 복사(활성화 유지 구간)
    return copyWithNotice(message, url, trackId);
  }
  try {
    if (Platform.OS === 'ios' && input.iosSettleMs) await wait(input.iosSettleMs);
    const res: any = await Share.share(buildShareTextPayload(text, url, Platform.OS));
    const action = res?.action;
    if (action === (Share as any).dismissedAction) {
      log('cancel', { id: trackId });
      return 'cancelled';
    }
    log('shared', { id: trackId, action: action || 'web' });
    return 'shared';
  } catch (err: any) {
    if (isShareCancelError(err)) {
      log('cancel', { id: trackId });
      return 'cancelled';
    }
    // 웹 NotAllowedError(활성화 만료)·미지원 등 → 복사 폴백
    console.warn('[TrackShare] share 실패 → 복사 폴백', { name: err?.name, message: err?.message });
    return copyWithNotice(message, url, trackId);
  }
}

/** 공개 전환 진행 중인 곡 — 확인 버튼 연타 시 PUT 1회 보장 */
const publishing = new Set<string>();

function openCompose(track: ShareableTrack, isOwn: boolean, opts: ShareTrackOptions): boolean {
  try {
    opts.onCompose(track, isOwn);
    return true;
  } catch (err: any) {
    console.error('[TrackShare] fail — 공유 화면 열기', { id: String(track.id), message: err?.message });
    return false;
  }
}

/** 비공개 내 곡 → 공개 전환 후 공유 문구 화면(D7·v3.237). 기존 공개 전환 API 재사용. */
function confirmPublishThenShare(track: ShareableTrack, opts: ShareTrackOptions) {
  const trackId = String(track.id);
  showAlert(
    '차트에 공개하고 공유할까요?',
    '비공개 곡은 링크를 받은 사람이 들을 수 없어요. 차트에 공개하고 공유할까요?',
    [
      {
        text: '취소',
        style: 'cancel',
        onPress: () => {
          log('cancel', { id: trackId, step: 'publish-confirm' });
          opts.onDone?.(trackId, 'aborted');
        },
      },
      {
        text: '공개하고 공유',
        onPress: async () => {
          if (publishing.has(trackId)) {
            if (__DEV__) console.info('[TrackShare] 공개 전환 진행 중 — 중복 탭 무시', { id: trackId });
            return;
          }
          publishing.add(trackId);
          try {
            await api.put(`/tracks/${trackId}`, { is_public: true });
          } catch (err: any) {
            // 블라인드(report_blinded) 곡 재공개 400 등 — 서버 메시지 그대로(MyMusic 관행)
            console.error('[TrackShare] fail — publish', { id: trackId, status: err?.response?.status });
            showAlert('오류', err?.response?.data?.error || '차트에 공개하지 못했어요. 잠시 후 다시 시도해 주세요.');
            opts.onDone?.(trackId, 'failed');
            return;
          } finally {
            publishing.delete(trackId);
          }
          log('publish-then-share', { id: trackId });
          try {
            opts.onPublished?.(trackId);
          } catch (err: any) {
            console.error('[TrackShare] fail — onPublished 콜백', { message: err?.message });
          }
          const published: ShareableTrack = { ...track, is_public: true };
          const ok = openCompose(published, true, opts);
          opts.onDone?.(trackId, ok ? 'compose' : 'failed');
        },
      },
    ]
  );
}

/**
 * 공유하기 진입점 — 비로그인·어린이 포함(D10). 반환 = 흐름 시작 결과.
 * 공개 곡 = 곧장 onCompose(공유 문구 화면), 비공개 내 곡 = 공개 확인 → PUT 성공 → onCompose.
 */
export function shareTrack(track: ShareableTrack | null | undefined, opts: ShareTrackOptions): Promise<ShareOutcome> {
  if (!track?.id) {
    console.error('[TrackShare] fail — track id 없음', { src: opts.src });
    return Promise.resolve('failed');
  }
  const trackId = String(track.id);
  if (!TRACK_ID_RE.test(trackId)) {
    // 샘플·임시 곡 등 서버 트랙이 아닌 id — 랜딩이 열 수 없는 링크는 만들지 않는다
    console.error('[TrackShare] fail — 공유할 수 없는 id', { id: trackId, src: opts.src });
    showAlert('알림', '이 곡은 공유할 수 없어요.');
    opts.onDone?.(trackId, 'failed');
    return Promise.resolve('failed');
  }
  const isOwn = !!opts.isOwn;
  log('open', { id: trackId, src: opts.src, own: isOwn, isPublic: track.is_public !== false });
  if (track.is_public === false) {
    if (!isOwn) {
      showAlert('알림', '비공개 곡은 공유할 수 없어요.');
      opts.onDone?.(trackId, 'aborted');
      return Promise.resolve('aborted');
    }
    confirmPublishThenShare(track, opts);
    return Promise.resolve('pending'); // 이후 결과는 onDone 으로
  }
  const outcome: ShareOutcome = openCompose(track, isOwn, opts) ? 'compose' : 'failed';
  opts.onDone?.(trackId, outcome);
  return Promise.resolve(outcome);
}
