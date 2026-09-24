import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
// expo-file-system v19+ : 신 API에서는 cacheDirectory/downloadAsync가 빠짐 → legacy 사용(ArtistLoading 관행)
import * as FileSystem from 'expo-file-system/legacy';
import { BACKEND_BASE_URL } from '../services/api';
import { useAuthStore } from '../stores/authStore';

// ── v3.227 H-3 [authImage]: 원본 얼굴 사진(characters/[temp/]{uid}/original*) 인증 로드 ──────
// 서버 preview 프록시는 원본 경로에 한해 **Authorization 헤더**(소유자·관리자)만 200, 그 외 404.
// - 네이티브: Image source에 { uri, headers: { Authorization } } — RN Image가 헤더를 실어 요청.
// - 웹: <img>는 헤더를 못 싣는다 → fetch(Authorization) → blob → URL.createObjectURL (언마운트 시 revoke).
// - **URL·쿼리에 토큰을 절대 넣지 않는다**(nginx access log 노출 방지 — 쿼리 토큰 방식 금지).
// - 로그에 토큰·원본 경로를 남기지 않는다(파일명 길이·상태 코드만).
// 시트·아이템·커버 등 공개 경로는 기존대로 일반 URL 사용(이 유틸 불필요).

const ORIGINAL_RE = /^characters\/(?:temp\/)?[^/]+\/original[^/]*$/;

/** 원본 얼굴 사진 경로인가(서버 H-3 게이트 대상) */
export function isProtectedOriginal(objectName: string | null | undefined): boolean {
  return !!objectName && ORIGINAL_RE.test(objectName);
}

/** preview 프록시 URL — 토큰 없음. 캐시 방지(cache-buster)는 호출 측 선택 */
export function previewUrlOf(objectName: string, bust = false): string {
  const base = `${BACKEND_BASE_URL}/api/character/preview/${objectName}`;
  return bust ? `${base}?t=${Date.now()}` : base;
}

function authHeader(): Record<string, string> | null {
  const token = useAuthStore.getState().token;
  return token ? { Authorization: `Bearer ${token}` } : null;
}

export interface AuthImageSource {
  uri: string;
  headers?: Record<string, string>;
}

export interface AuthImageState {
  /** 렌더 가능한 소스(null = 로딩 중·실패·대상 없음) */
  source: AuthImageSource | null;
  /** 로드 실패(404 등) — 호출 측은 영역을 숨긴다(깨진 이미지 표시 금지) */
  failed: boolean;
  /** 네이티브 Image onError에서 호출 → failed 전환 */
  markFailed: () => void;
}

/**
 * 원본 사진 인증 이미지 훅. objectName이 null이면 아무것도 하지 않는다.
 * 웹 blob URL은 objectName 변경·언마운트 시 revoke.
 */
export function useAuthImage(objectName: string | null | undefined): AuthImageState {
  const token = useAuthStore((s) => s.token);
  const [source, setSource] = useState<AuthImageSource | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setSource(null);
    setFailed(false);
    if (!objectName) return undefined;
    if (!token) {
      // 로그아웃 상태 — 원본은 표시하지 않는다
      setFailed(true);
      return undefined;
    }
    const headers = { Authorization: `Bearer ${token}` };
    const url = previewUrlOf(objectName, true);
    if (Platform.OS !== 'web') {
      setSource({ uri: url, headers });
      return undefined;
    }
    let cancelled = false;
    let blobUrl: string | null = null;
    (async () => {
      try {
        const r = await fetch(url, { headers });
        if (!r.ok) {
          console.warn('[authImage] 원본 로드 실패', { status: r.status });
          if (!cancelled) setFailed(true);
          return;
        }
        const blob = await r.blob();
        if (cancelled) return;
        blobUrl = URL.createObjectURL(blob);
        setSource({ uri: blobUrl });
      } catch (err: any) {
        console.warn('[authImage] 원본 로드 오류', { message: err?.message });
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      if (blobUrl) {
        try { URL.revokeObjectURL(blobUrl); } catch { /* noop */ }
      }
    };
  }, [objectName, token]);

  return { source: failed ? null : source, failed, markFailed: () => setFailed(true) };
}

function inferMime(name: string): string {
  const ext = (name.split('.').pop() || 'jpg').toLowerCase();
  return `image/${ext === 'jpg' ? 'jpeg' : ext}`;
}

/**
 * [구서버 폴백 전용] 원본 사진을 인증 요청으로 내려받아 FormData에 파일로 첨부.
 * 신서버(v3.227)는 original_object_name Form으로 서버가 직접 읽으므로 이 경로를 쓰지 않는다.
 * 헤더 인증만 사용(URL 토큰 금지).
 */
export async function appendAuthImageToForm(form: FormData, field: string, objectName: string): Promise<void> {
  const headers = authHeader();
  if (!headers) throw new Error('로그인이 필요해요.');
  const url = previewUrlOf(objectName);
  const ext = (objectName.split('.').pop() || 'jpg').toLowerCase();
  const name = `${field}.${ext}`;
  const mime = inferMime(name);
  if (Platform.OS === 'web') {
    const r = await fetch(url, { headers });
    if (!r.ok) {
      console.warn('[authImage] 원본 첨부 실패', { status: r.status });
      throw new Error('원본 사진을 불러오지 못했어요.');
    }
    const blob = await r.blob();
    form.append(field, new File([blob], name, { type: blob.type || mime }));
    return;
  }
  const localPath = `${FileSystem.cacheDirectory}${field}-${Date.now()}.${ext}`;
  const dl = await FileSystem.downloadAsync(url, localPath, { headers });
  if (dl.status && dl.status >= 400) {
    console.warn('[authImage] 원본 첨부 실패(native)', { status: dl.status });
    throw new Error('원본 사진을 불러오지 못했어요.');
  }
  form.append(field, { uri: dl.uri, name, type: mime } as any);
}
