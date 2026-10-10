// v3.328 [PasteImage] 웹 Ctrl+V(⌘V) 이미지 붙여넣기 — 첨부 버튼과 같은 흐름으로 넘긴다(오리쟁이 10-10 요청).
// 웹 전용(네이티브 앱·모바일 웹은 붙여넣기 이벤트가 없거나 OS 첨부로 충분 — 무동작). 이미지가 아닌 붙여넣기(글자)는 건드리지 않음.
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

export interface PastedAsset {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
}

export function usePasteImages(enabled: boolean, onImages: (assets: PastedAsset[]) => void) {
  const cbRef = useRef(onImages);
  cbRef.current = onImages;
  useEffect(() => {
    if (!enabled || Platform.OS !== 'web' || typeof document === 'undefined') return;
    const onPaste = (e: ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.items || []);
      const files = items
        .filter((it) => it.kind === 'file' && (it.type || '').startsWith('image/'))
        .map((it) => it.getAsFile())
        .filter((f): f is File => !!f);
      if (!files.length) return; // 글자 붙여넣기는 그대로
      e.preventDefault();
      const assets = files.map((f, i) => ({
        uri: URL.createObjectURL(f),
        name: f.name && f.name !== 'image.png' ? f.name : `붙여넣은 이미지 ${i + 1}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`,
        mimeType: f.type || 'image/png',
        size: f.size,
      }));
      console.info('[PasteImage] 이미지 붙여넣기', { n: assets.length });
      cbRef.current(assets);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [enabled]);
}
