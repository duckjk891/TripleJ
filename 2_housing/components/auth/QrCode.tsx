// v3.350 [QrCode] 링크 QR(보호자 동의 링크를 보호자 휴대폰으로 바로 찍게) — 순수 JS 생성(qrcode-generator) + react-native-svg.
// 네이티브 모듈 추가 없음(웹·기존 빌드 OTA 그대로 동작).
import { useMemo } from 'react';
import Svg, { Path, Rect } from 'react-native-svg';
import qrcode from 'qrcode-generator';

/** 값 → 어두운 칸 경로(순수). 모듈 1칸 = 1 단위, 여백 margin 칸 */
export function qrPath(value: string, margin = 2): { size: number; d: string } {
  const qr = qrcode(0, 'M');
  qr.addData(value);
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) d += `M${c + margin} ${r + margin}h1v1h-1z`;
    }
  }
  return { size: n + margin * 2, d };
}

export default function QrCode({ value, size = 180 }: { value: string; size?: number }) {
  const { size: units, d } = useMemo(() => qrPath(value), [value]);
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${units} ${units}`} accessibilityLabel="보호자 동의 링크 QR 코드">
      <Rect x={0} y={0} width={units} height={units} fill="#FFFFFF" />
      <Path d={d} fill="#000000" />
    </Svg>
  );
}
