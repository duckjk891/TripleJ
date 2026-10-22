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

// ── v3.400 [Camera] 낙서장 카메라(대표 10-22 "카메라를 자유롭게") ─────────────────────────────
//  · 앱: expo-image-picker launchCameraAsync(후면 우선 — 삼성 등 일부 기기는 무시될 수 있음), JPEG 0.85.
//    아이폰 카메라 결과는 JPEG 로 오므로 HEIC 변환 불필요. 권한 거절 = { canceled: true, denied: true }.
//  · 웹: <input type=file accept="image/*" capture="environment"> — 폰 브라우저는 카메라, PC 는 파일 선택.
//  · 안드로이드에서 카메라 중 앱이 정리되면 결과가 사라짐 → 화면 진입 때 recoverPendingCameraPhotos() 로 복구.
export type TakePhotoResult = PickedImageResult & { denied?: boolean };

function webCapture(): Promise<TakePhotoResult> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') { resolve({ canceled: true, assets: null } as TakePhotoResult); return; }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.setAttribute('capture', 'environment');
    input.style.display = 'none';
    let done = false;
    const finish = (r: TakePhotoResult) => { if (done) return; done = true; input.remove(); resolve(r); };
    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      if (!f) { finish({ canceled: true, assets: null } as TakePhotoResult); return; }
      const mime = f.type || mimeFromName(f.name) || 'image/jpeg';
      finish({
        canceled: false,
        assets: [{ uri: URL.createObjectURL(f), name: f.name || `camera_${Date.now()}.jpg`, mimeType: mime, size: f.size, lastModified: Date.now(), file: f } as any],
      } as TakePhotoResult);
    });
    input.addEventListener('cancel', () => finish({ canceled: true, assets: null } as TakePhotoResult));
    document.body.appendChild(input);
    input.click();
  });
}

/** 사진 찍기 1장 — 반환 모양은 pickImages 와 같음(호출부 검사·업로드 로직 공용) */
export async function takePhoto(): Promise<TakePhotoResult> {
  if (Platform.OS === 'web') return webCapture();
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    console.info('[Camera] 권한 거절', { canAskAgain: perm.canAskAgain });
    return { canceled: true, assets: null, denied: true } as TakePhotoResult;
  }
  const res = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    quality: 0.85,
    exif: false,
    cameraType: ImagePicker.CameraType.back,
  });
  if (res.canceled || !res.assets?.length) return { canceled: true, assets: null } as TakePhotoResult;
  const assets = res.assets.map((a, i) => toDocumentAsset({ ...a, fileName: a.fileName || `camera_${Date.now()}_${i}.jpg` }, i));
  if (__DEV__) console.info('[Camera] 촬영', { count: assets.length, mimes: assets.map((a) => a.mimeType) });
  return { canceled: false, assets } as TakePhotoResult;
}

/** 안드로이드 — 카메라 중 앱이 정리됐다가 돌아온 경우 남은 촬영 결과(없으면 []) */
export async function recoverPendingCameraPhotos() {
  if (Platform.OS !== 'android') return [];
  try {
    const pending: any = await ImagePicker.getPendingResultAsync();
    const list = Array.isArray(pending) ? pending : pending ? [pending] : [];
    const out = list.flatMap((r: any) => (r && !r.canceled && Array.isArray(r.assets) ? r.assets : []))
      .map((a: any, i: number) => toDocumentAsset(a, i));
    if (out.length) console.info('[Camera] 촬영 결과 복구', { count: out.length });
    return out;
  } catch (err: any) {
    console.error('[Camera] 촬영 결과 복구 실패', { message: err?.message });
    return [];
  }
}
