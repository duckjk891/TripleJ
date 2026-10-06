// v3.283 [ArtistPhoto]: 얼굴 사진 용량 줄이기(웹 전용) — 얼굴 인증(AWS Rekognition CompareFaces)은
// 이미지 바이트 5MB(5,242,880) 초과를 ValidationException 으로 거절한다. 서버가 이를 500 으로 흘려
// (CORS 헤더 없는 500 → 브라우저 "Network Error") 앱에는 "얼굴 인증 요청에 실패했어요"만 반복됐다
// (10-05 DDui, iPhone Safari — 같은 사진으로 4회 실패, 다른 사진으로 성공).
// 앱 업로드 한도(10MB)와 인증 한도(5MB) 사이의 사진을 고를 때 여기서 긴 변 2048px JPEG 로 줄인다.
// 생성 요청·얼굴 인증·원본 보관이 모두 같은 (줄인) 파일을 쓰므로 서버 사진 SHA 게이트도 일치한다.
// 네이티브는 이미지 처리 모듈이 없어 원본 그대로(서버 축소 패치가 후방 방어 — 스테이징 v3283).
import { Platform } from 'react-native';

/** 이 크기를 넘으면 줄인다(인증 한도 5MB 에 여유) */
export const FACE_PHOTO_MAX_BYTES = 4 * 1024 * 1024;
export const FACE_PHOTO_MAX_EDGE = 2048;

export interface PickedPhoto {
  uri: string;
  name: string;
  size?: number | null;
  file?: Blob | null;
}

/** 순수 판정 — 줄일지와 목표 크기(테스트 가능) */
export function planPhotoResize(
  bytes: number | null | undefined,
  width: number,
  height: number,
  maxEdge: number = FACE_PHOTO_MAX_EDGE,
): { resize: boolean; width: number; height: number } {
  const big = typeof bytes === 'number' && bytes > FACE_PHOTO_MAX_BYTES;
  const longEdge = Math.max(width, height);
  if (!big || !width || !height) return { resize: false, width, height };
  const scale = longEdge > maxEdge ? maxEdge / longEdge : 1;
  return { resize: true, width: Math.round(width * scale), height: Math.round(height * scale) };
}

function jpgName(name: string): string {
  const base = (name || 'photo').replace(/\.[A-Za-z0-9]+$/, '');
  return `${base || 'photo'}.jpg`;
}

/**
 * 웹에서 큰 사진이면 줄여 새 blob URL 을 돌려준다. 실패·네이티브·작은 사진은 원본 그대로.
 * (어떤 경우에도 throw 하지 않는다 — 사진 선택 흐름을 막지 않음)
 */
export async function shrinkFacePhotoIfNeeded(p: PickedPhoto): Promise<PickedPhoto & { resized: boolean }> {
  if (Platform.OS !== 'web') return { ...p, resized: false };
  try {
    let blob: Blob | null = p.file ?? null;
    if (!blob) blob = await (await fetch(p.uri)).blob();
    const bytes = typeof p.size === 'number' && p.size > 0 ? p.size : blob.size;
    if (bytes <= FACE_PHOTO_MAX_BYTES) return { ...p, resized: false };
    const g: any = globalThis as any;
    const bitmap: any = typeof g.createImageBitmap === 'function'
      ? await g.createImageBitmap(blob)
      : await new Promise((resolve, reject) => {
          const img = new g.Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = p.uri;
        });
    const plan = planPhotoResize(bytes, bitmap.width, bitmap.height);
    const canvas = g.document.createElement('canvas');
    canvas.width = plan.width;
    canvas.height = plan.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, plan.width, plan.height);
    let quality = 0.88;
    let out: Blob | null = null;
    for (let i = 0; i < 3; i++) {
      out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (out && out.size <= FACE_PHOTO_MAX_BYTES) break;
      quality -= 0.15;
    }
    if (!out || out.size > FACE_PHOTO_MAX_BYTES) {
      console.warn('[ArtistPhoto] 사진 줄이기 실패 — 원본 사용', { bytes, out: out?.size ?? null });
      return { ...p, resized: false };
    }
    const uri = g.URL.createObjectURL(out);
    console.info('[ArtistPhoto] 큰 사진 줄임(얼굴 인증 5MB 한도)', {
      from: bytes, to: out.size, w: plan.width, h: plan.height,
    });
    return { uri, name: jpgName(p.name), size: out.size, file: out, resized: true };
  } catch (err: any) {
    console.warn('[ArtistPhoto] 사진 줄이기 오류 — 원본 사용', { message: err?.message });
    return { ...p, resized: false };
  }
}
