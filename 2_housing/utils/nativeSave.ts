// [NativeSave] v1.3.1 — 네이티브 저장 기본경로(대표 확정 2026-09-29).
//  · Android 파일(mp3 등): SAF 로 최초 1회 폴더 권한(다운로드/MAIDOL 권장) → 이후 그 폴더에 직접 저장.
//    권한 거부·실패 시 기존 공유 시트 폴백(동작 상실 없음).
//  · iOS 파일: 시스템 제약상 임의 폴더 직접 쓰기 불가 — 공유 시트("파일에 저장" 포함) 유지.
//  · 사진/영상: MediaLibrary 'MAIDOL' 앨범 자동 생성·수집(iOS·Android 공통) — saveVideoToMaidolAlbum.
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';

const SAF_DIR_KEY = 'maidol_saf_dir_uri_v1';
export const MAIDOL_ALBUM = 'MAIDOL';

/** Android SAF 저장 폴더 확보 — 저장된 권한 재사용, 없으면 사용자에게 1회 요청. null=거부/불가 */
async function ensureAndroidDir(): Promise<string | null> {
  if (Platform.OS !== 'android') return null;
  const SAF = (FileSystem as any).StorageAccessFramework;
  if (!SAF) return null;
  try {
    const saved = await AsyncStorage.getItem(SAF_DIR_KEY);
    if (saved) {
      // 권한 잔존 확인(기기에서 회수됐을 수 있음) — 읽기 시도로 검증
      try {
        await SAF.readDirectoryAsync(saved);
        return saved;
      } catch {
        if (__DEV__) console.info('[NativeSave] SAF 권한 소실 — 재요청');
      }
    }
    const perm = await SAF.requestDirectoryPermissionsAsync();
    if (!perm.granted) {
      if (__DEV__) console.info('[NativeSave] SAF 권한 거부');
      return null;
    }
    await AsyncStorage.setItem(SAF_DIR_KEY, perm.directoryUri);
    return perm.directoryUri;
  } catch (err: any) {
    console.warn('[NativeSave] SAF 폴더 확보 실패', { message: err?.message });
    return null;
  }
}

/**
 * 캐시의 로컬 파일을 사용자의 MAIDOL 폴더(SAF)에 저장. 성공 시 true.
 * false 반환 = 호출부가 기존 공유 시트 폴백을 수행한다.
 */
export async function saveFileToMaidolFolder(
  localUri: string, filename: string, mimeType: string,
): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  const SAF = (FileSystem as any).StorageAccessFramework;
  const dir = await ensureAndroidDir();
  if (!dir || !SAF) return false;
  try {
    const target = await SAF.createFileAsync(dir, filename, mimeType);
    const data = await FileSystem.readAsStringAsync(localUri, { encoding: 'base64' as any });
    await FileSystem.writeAsStringAsync(target, data, { encoding: 'base64' as any });
    console.info('[NativeSave] SAF 저장 완료', { filename });
    return true;
  } catch (err: any) {
    console.warn('[NativeSave] SAF 저장 실패 — 공유 시트 폴백', { message: err?.message });
    return false;
  }
}

/** 사진 앱 'MAIDOL' 앨범에 영상/이미지 수집(권한은 호출부가 선확보). 앨범 실패는 저장 자체를 막지 않는다. */
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
