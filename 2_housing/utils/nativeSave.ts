// [NativeSave] v1.3.1 — 네이티브 저장 기본경로(대표 확정 2026-09-29).
// v3.391 (10-21 갤럭시 실기기): 폴더 고르기(SAF) 폐지 → 안드로이드 MediaStore 공용 폴더에 바로 저장.
//  · 원인: 폴더 선택 창에서 구글 드라이브 폴더를 고르면 쓰기가 막혀(`isn't writable`) 공유 시트로 빠졌고,
//    그 주소가 저장돼 있어 읽기 검사만 통과하면 매번 공유 시트가 떴다. → 저장해 둔 SAF 주소는 지운다.
//  · Android 10+: 음원 Music/MAIDOL, 영상 Movies/MAIDOL(갤러리 'MAIDOL' 앨범), 사진 Pictures/MAIDOL — 권한 불필요.
//    Android 9 이하·모듈 없는 빌드: 사진 보관함 저장(MediaLibrary, 저장 권한) → 그래도 안 되면 공유 시트.
//  · iOS 파일(mp3): 시스템 제약상 임의 폴더 직접 쓰기 불가 — 공유 시트("파일에 저장" 포함) 유지.
//    iOS 영상·사진: 사진 앱 'MAIDOL' 앨범.
//  · 받기: HTTP 상태·형식 확인(만료 링크의 오류 페이지를 .mp3 로 저장하고 "완료"라 하던 문제), 파일은 스트림 복사만
//    (base64 로 통째로 메모리에 올리지 않음 — 큰 영상에서 멈춤·꺼짐 방지).
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { isMediaStoreSaveAvailable, saveToMediaStore } from '../modules/maidol-media-save';

const LEGACY_SAF_DIR_KEY = 'maidol_saf_dir_uri_v1';
export const MAIDOL_ALBUM = 'MAIDOL';

export type MediaKind = 'audio' | 'video' | 'image';

const ANDROID_DIRS: Record<MediaKind, string> = {
  audio: 'Music/MAIDOL',
  video: 'Movies/MAIDOL',
  image: 'Pictures/MAIDOL',
};

/** 사용자에게 보여 줄 위치 문구 */
export const SAVED_PLACE_LABEL: Record<MediaKind, string> = {
  audio: "내 파일 > 음악 > MAIDOL 폴더",
  video: "갤러리의 'MAIDOL' 앨범(동영상 > MAIDOL)",
  image: "갤러리의 'MAIDOL' 앨범",
};

// 예전 SAF 폴더 주소는 더 쓰지 않는다(드라이브 폴더가 저장돼 매번 공유 시트가 뜨던 원인) — 한 번 지움
void AsyncStorage.removeItem(LEGACY_SAF_DIR_KEY).catch(() => {});

/**
 * 저장용 파일 이름(순수) — 파일 시스템 금지 문자(/ \ : * ? " < > |)·제어 문자 제거, 공백 정리, 길이 상한.
 * 확장자는 ext 로 붙인다(제목에 같은 확장자가 이미 있으면 한 번만). 빈 제목은 'MAIDOL'.
 */
export function safeFileName(title: string | null | undefined, ext: string, maxLen = 60): string {
  const e = String(ext || '').replace(/^\./, '').toLowerCase();
  let base = String(title || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  if (e && base.toLowerCase().endsWith(`.${e}`)) base = base.slice(0, -(e.length + 1)).trim();
  base = base.replace(/^[.\s_]+|[.\s]+$/g, '');
  if (base.length > maxLen) base = base.slice(0, maxLen).trim();
  if (!base) base = 'MAIDOL';
  return e ? `${base}.${e}` : base;
}

/** 캐시 파일 이름(순수) — 공유 시트에 보이는 이름이라 한글은 살리되 기호·공백은 _ 로(v3.214 VideoDirector 규칙) */
export function cacheFileName(title: string | null | undefined, ext: string): string {
  const e = String(ext || '').replace(/^\./, '').toLowerCase();
  const base = String(title || '').replace(/\.[a-z0-9]{2,4}$/i, '')
    .replace(/[^\w가-힣.-]+/g, '_').replace(/^[._]+|[._]+$/g, '').slice(0, 40) || 'maidol';
  return e ? `${base}.${e}` : base;
}

export class DownloadError extends Error {
  code: 'http' | 'not_media' | 'empty' | 'network';
  status?: number;
  constructor(code: DownloadError['code'], message: string, status?: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** 받은 응답이 기대한 파일인지(순수) — 2xx 이고, 오류 페이지(HTML·XML·JSON)가 아닌지 */
export function checkDownloadResponse(status: number, contentType: string | null | undefined): DownloadError | null {
  if (!(status >= 200 && status < 300)) return new DownloadError('http', `HTTP ${status}`, status);
  const ct = String(contentType || '').toLowerCase();
  if (/text\/html|application\/xml|text\/xml|application\/json/.test(ct)) {
    return new DownloadError('not_media', `unexpected content-type ${ct}`, status);
  }
  return null;
}

function headerValue(headers: Record<string, string> | undefined, name: string): string {
  if (!headers) return '';
  const k = Object.keys(headers).find((h) => h.toLowerCase() === name);
  return k ? String(headers[k]) : '';
}

/**
 * url 을 캐시에 받는다(스트림 저장). HTTP 오류·오류 페이지·빈 파일이면 DownloadError 를 던지고 받은 파일은 지운다.
 * 반환: 캐시 파일 uri(file://…)
 */
export async function downloadToCache(url: string, cacheName: string): Promise<string> {
  const dest = `${FileSystem.cacheDirectory}${cacheName}`;
  let res: FileSystem.FileSystemDownloadResult;
  try {
    res = await FileSystem.downloadAsync(url, dest);
  } catch (err: any) {
    throw new DownloadError('network', err?.message || 'download failed');
  }
  const bad = checkDownloadResponse(res.status, headerValue(res.headers, 'content-type'));
  let size = 0;
  if (!bad) {
    try {
      const info: any = await FileSystem.getInfoAsync(res.uri);
      size = Number(info?.size || 0);
    } catch {}
  }
  if (bad || size <= 0) {
    await FileSystem.deleteAsync(res.uri, { idempotent: true }).catch(() => {});
    const e = bad || new DownloadError('empty', 'empty file', res.status);
    console.warn('[NativeSave] 받기 실패', { code: e.code, status: res.status });
    throw e;
  }
  return res.uri;
}

/** 사진 보관함 'MAIDOL' 앨범에 수집(권한은 호출부가 선확보). 앨범 실패는 저장 자체를 막지 않는다. */
export async function saveMediaToMaidolAlbum(localUri: string): Promise<'album' | 'library'> {
  const asset = await MediaLibrary.createAssetAsync(localUri);
  try {
    const album = await MediaLibrary.getAlbumAsync(MAIDOL_ALBUM);
    if (album) {
      await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
    } else {
      await MediaLibrary.createAlbumAsync(MAIDOL_ALBUM, asset, false);
    }
    console.info('[NativeSave] MAIDOL 앨범 수집 완료');
    return 'album';
  } catch (err: any) {
    // 일부 기기/권한 조합에서 앨범 조작 실패 — 라이브러리 저장은 이미 성공(사진 앱에는 있음)
    console.warn('[NativeSave] MAIDOL 앨범 수집 실패(라이브러리엔 저장됨)', { message: err?.message });
    return 'library';
  }
}

export type SaveResult =
  | { ok: true; where: 'folder' | 'album' | 'library'; place: string }
  | { ok: false; reason: 'permission' | 'unsupported' | 'failed' };

const MIME: Record<MediaKind, string> = { audio: 'audio/mpeg', video: 'video/mp4', image: 'image/jpeg' };

/**
 * 캐시 파일을 기기에 저장. displayName = 사용자에게 보일 파일 이름(safeFileName 결과).
 *  · Android 10+: MediaStore 공용 폴더(권한 불필요) — 'folder'
 *  · 그 밖(Android 9 이하·iOS 영상/사진): 사진 보관함(권한 요청) — 'album' | 'library'
 *  · iOS 음원: 'unsupported' → 호출부가 공유 시트("파일에 저장")
 */
export async function saveToDevice(localUri: string, kind: MediaKind, displayName: string, mimeType?: string): Promise<SaveResult> {
  const mime = mimeType || MIME[kind];
  if (Platform.OS === 'android' && isMediaStoreSaveAvailable()) {
    try {
      await saveToMediaStore(localUri, displayName, mime, ANDROID_DIRS[kind]);
      console.info('[NativeSave] 공용 폴더 저장 완료', { kind, dir: ANDROID_DIRS[kind] });
      return { ok: true, where: 'folder', place: SAVED_PLACE_LABEL[kind] };
    } catch (err: any) {
      console.warn('[NativeSave] 공용 폴더 저장 실패 — 사진 보관함 방식 시도', { code: err?.code, message: err?.message });
    }
  }
  if (kind === 'audio' && Platform.OS === 'ios') return { ok: false, reason: 'unsupported' };
  try {
    const { status } = await MediaLibrary.requestPermissionsAsync(Platform.OS === 'android');
    if (status !== 'granted') return { ok: false, reason: 'permission' };
    const where = await saveMediaToMaidolAlbum(localUri);
    const place = Platform.OS === 'ios'
      ? (where === 'album' ? "사진 앱의 'MAIDOL' 앨범" : '사진 앱')
      : (kind === 'audio' ? '내 파일 > 음악 폴더' : '갤러리');
    return { ok: true, where, place };
  } catch (err: any) {
    console.warn('[NativeSave] 사진 보관함 저장 실패', { kind, message: err?.message });
    return { ok: false, reason: 'failed' };
  }
}
