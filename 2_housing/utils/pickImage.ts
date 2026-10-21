// v3.391 [PickImage] 사진 고르기 공용 함수 — 앱은 사진첩(expo-image-picker), 웹은 예전 그대로 파일 선택(DocumentPicker).
//  · 아이폰에서 DocumentPicker({type:'image/*'})는 '파일' 앱이 열리고, 사진첩 사진(HEIC)은 형식 검사에서 거부됐다.
//    → 사진첩을 열고 JPEG 로 받는다(iOS: 호환 형식 'compatible' + 품질 0.9 → HEIC 를 JPEG 로 변환,
//      Android: 시스템 사진 선택기·권한 불필요, 품질 0.9 → JPEG 재압축).
//  · 반환 모양은 DocumentPicker 결과와 같다({ canceled, assets:[{ uri, name, mimeType, size }] }) — 호출부 검사 로직 그대로.
import { Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';

export type PickedImageResult = DocumentPicker.DocumentPickerResult;

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  heic: 'image/heic', heif: 'image/heif', bmp: 'image/bmp', tiff: 'image/tiff', avif: 'image/avif',
};

/** uri·파일명 확장자로 MIME 추정(순수) */
export function mimeFromName(name: string | null | undefined): string {
  const m = String(name || '').toLowerCase().split('?')[0].match(/\.([a-z0-9]+)$/);
  return (m && EXT_MIME[m[1]]) || '';
}

/** 사진첩 결과 1장 → DocumentPicker 모양(순수). 이름이 없거나 확장자가 실제 형식과 다르면 맞춰 준다 */
export function toDocumentAsset(a: { uri: string; fileName?: string | null; mimeType?: string | null; fileSize?: number | null }, index: number) {
  const mime = a.mimeType || mimeFromName(a.uri) || 'image/jpeg';
  const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : mime === 'image/gif' ? 'gif'
    : mime === 'image/jpeg' ? 'jpg' : (mime.split('/')[1] || 'jpg');
  let name = String(a.fileName || '').trim();
  if (!name) name = `photo_${Date.now()}_${index}.${ext}`;
  else if (mimeFromName(name) !== mime) name = `${name.replace(/\.[a-z0-9]+$/i, '')}.${ext}`; // IMG_0001.HEIC → .jpg
  return { uri: a.uri, name, mimeType: mime, size: typeof a.fileSize === 'number' ? a.fileSize : undefined, lastModified: Date.now() };
}

/**
 * 사진 고르기. multiple=true 면 여러 장(limit = 최대 장수, 0/미지정 = 제한 없음).
 * 취소 = { canceled: true, assets: null }.
 */
export async function pickImages(opts: { multiple?: boolean; limit?: number } = {}): Promise<PickedImageResult> {
  const multiple = !!opts.multiple;
  if (Platform.OS === 'web') {
    return DocumentPicker.getDocumentAsync({ type: 'image/*', multiple });
  }
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: multiple,
    selectionLimit: multiple ? Math.max(0, opts.limit || 0) : 1,
    quality: 0.9,
    exif: false,
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  });
  if (res.canceled || !res.assets?.length) return { canceled: true, assets: null } as PickedImageResult;
  const assets = res.assets.map((a, i) => toDocumentAsset(a, i));
  if (__DEV__) console.info('[PickImage] 사진 선택', { count: assets.length, mimes: assets.map((a) => a.mimeType) });
  return { canceled: false, assets } as PickedImageResult;
}

/** 한 장 고르기 — pickImages({ multiple:false }) 와 같다 */
export function pickImage(): Promise<PickedImageResult> {
  return pickImages({ multiple: false });
}
