// v3.248 B5(A-12): 웹(특히 iOS Safari) 영상·음원 저장/공유 공용 유틸.
// 기존 window.open(Linking.openURL) 방식은 iOS Safari에서 [보기]/[다운로드] 확인창으로 끝나거나
// (수 분 빌드 뒤 열면) 팝업 차단에 걸렸다(피드백 [22]). Blob을 받아
// navigator.share({files})(기기 공유 시트) 우선, 미지원이면 a[download]로 대체한다.
//
// 사용자 활성화 주의(utils/trackShare 관행과 동일):
//  · navigator.share는 사용자 제스처(transient activation) 안에서만 허용 — 긴 fetch/빌드 뒤에는
//    바로 부르지 말고, showAlert 버튼 onPress(새 제스처)에서 호출하는 2단계 구조를 쓴다(호출부 책임).
//  · a[download]는 활성화 없이도 동작하므로 fetch 완료 직후 호출해도 된다.
// 웹 전용: Platform.OS === 'web' 분기 안에서만 import 함수를 호출할 것(문서/navigator 접근).

export interface WebMediaFile {
  file: File;
  objectUrl: string;
  filename: string;
}

/** 미디어를 Blob으로 받아 File + objectURL로 준비. 실패는 throw(호출부 폴백). */
export async function fetchWebMediaFile(
  url: string,
  filename: string,
  fallbackMime = 'video/mp4',
): Promise<WebMediaFile> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`media fetch failed: ${res.status}`);
  const blob = await res.blob();
  const file = new File([blob], filename, { type: blob.type || fallbackMime });
  return { file, objectUrl: URL.createObjectURL(file), filename };
}

/** 이 브라우저가 파일 공유 시트(navigator.share files)를 지원하는지 */
export function canShareWebFile(media: WebMediaFile): boolean {
  const nav: any = typeof navigator !== 'undefined' ? navigator : null;
  try {
    return !!nav?.share && !!nav?.canShare?.({ files: [media.file] });
  } catch {
    return false;
  }
}

/** 기기 공유 시트 열기 — 사용자가 취소(AbortError)한 것은 정상 종료(true). 실패만 false. */
export async function shareWebFile(media: WebMediaFile, title?: string): Promise<boolean> {
  try {
    await (navigator as any).share({ files: [media.file], title: title || media.filename });
    return true;
  } catch (err: any) {
    if (err?.name === 'AbortError') return true;
    console.warn('[webMediaSave] share 실패', { name: err?.name, message: err?.message });
    return false;
  }
}

// v3.270(대표 확정 2026-09-29): 저장 위치.
//  · 데스크톱 크롬·엣지: showSaveFilePicker — 사용자가 원하는 위치·파일명으로 저장.
//  · 모바일 사파리·크롬: 브라우저 보안상 위치 지정 불가(다운로드 폴더 고정, 서브폴더 생성도 불가)
//    → "MAIDOL_" 접두어로 다운로드 폴더에서 모아보기. 완료 안내도 여기서 일원화(호출부 중복 알림 금지).
//  · 네이티브 앱: MediaLibrary 'MAIDOL' 앨범 / Android SAF Downloads/MAIDOL — v1.3.1 빌드 과제.
import { showAlert } from './appAlert';

const MAIDOL_PREFIX = 'MAIDOL_';
function brandedFilename(name: string): string {
  const n = (name || 'media').replace(/^maidol[_-]/i, '');
  return n.startsWith(MAIDOL_PREFIX) ? n : MAIDOL_PREFIX + n;
}

/** 저장 트리거 — 위치 선택(지원 브라우저) 또는 브라우저 다운로드. 완료/취소 안내 포함(fire-and-forget 안전). */
export function downloadWebFile(media: WebMediaFile): void {
  const name = brandedFilename(media.filename);
  const picker: any = (typeof window !== 'undefined' && (window as any).showSaveFilePicker) || null;
  if (typeof picker === 'function') {
    (async () => {
      try {
        const handle = await picker.call(window, { suggestedName: name });
        const writable = await handle.createWritable();
        await writable.write(media.file);
        await writable.close();
        console.info('[webMediaSave] 위치 선택 저장 완료', { name });
        showAlert('저장 완료', '선택한 위치에 저장했어요.');
        return;
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          if (__DEV__) console.info('[webMediaSave] 위치 선택 취소');
          return; // 사용자 취소 — 강제 다운로드 폴백 금지
        }
        // 활성화 만료(SecurityError)·미지원 인자 등 — 기존 a[download] 폴백
        console.warn('[webMediaSave] picker 실패 — a[download] 폴백', { name: err?.name, message: err?.message });
        legacyDownload(media, name);
      }
    })();
    return;
  }
  legacyDownload(media, name);
}

/** a[download] 트리거 — 브라우저 다운로드로 저장(활성화 불요) */
function legacyDownload(media: WebMediaFile, name: string): void {
  const a = document.createElement('a');
  a.href = media.objectUrl;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  showAlert(
    '저장 완료',
    `"${name}"으로 저장을 시작했어요.\n아이폰은 파일 앱 > 다운로드, 안드로이드·PC는 다운로드 폴더에서 확인할 수 있어요.`,
  );
}

/** objectURL 해제 — 화면 이탈/교체 시 호출(누수 방지) */
export function releaseWebMedia(media: WebMediaFile | null | undefined): void {
  if (!media) return;
  try {
    URL.revokeObjectURL(media.objectUrl);
  } catch {}
}
