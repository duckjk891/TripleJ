// v3.375 [CodyThumb]: 옷(광고 아이템) 목록용 썸네일 이미지 — 긴 변 320px JPEG(ads/thumb320/…)를 먼저 쓰고,
// 썸네일이 아직 없거나 실패하면 원본으로 한 번 바꿔 다시 불러온다. 원본은 170~580KB 라
// 행사장 와이파이·모바일 데이터에서 목록이 늦게 뜨던 문제(10-17 콘테스트 현장)를 줄인다.
// 크게 보기(확대)는 원본(adImageUrl)을 그대로 쓴다.
import { useEffect, useState } from 'react';
import { Image, type ImageProps } from 'react-native';
import { adImageUrl, adThumbUrl } from './codyShared';

type Props = Omit<ImageProps, 'source'> & { objectName?: string | null };

export default function AdThumbImage({ objectName, onError, ...rest }: Props) {
  const thumb = adThumbUrl(objectName || undefined);
  const full = adImageUrl(objectName || undefined);
  const [uri, setUri] = useState(thumb || full);
  useEffect(() => { setUri(thumb || full); }, [thumb, full]);
  if (!uri) return null;
  return (
    <Image
      {...rest}
      source={{ uri }}
      onError={(e) => {
        if (uri !== full && full) {
          if (__DEV__) console.info('[CodyThumb] 썸네일 없음 → 원본', { objectName });
          setUri(full);
        } else {
          console.warn('[CodyThumb] 이미지 불러오기 실패', { objectName });
        }
        onError?.(e);
      }}
    />
  );
}
