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

/** a[download] 트리거 — 브라우저 다운로드로 저장(활성화 불요) */
export function downloadWebFile(media: WebMediaFile): void {
  const a = document.createElement('a');
  a.href = media.objectUrl;
  a.download = media.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** objectURL 해제 — 화면 이탈/교체 시 호출(누수 방지) */
export function releaseWebMedia(media: WebMediaFile | null | undefined): void {
  if (!media) return;
  try {
    URL.revokeObjectURL(media.objectUrl);
  } catch {}
}
