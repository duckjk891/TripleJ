// v3.391 [FaceCam] 웹·기타: 앱 안 카메라 없음(얼굴 인증 웹은 <input capture="user"> 사용) — 빈 컴포넌트.
export type FrontCameraModalProps = {
  visible: boolean;
  onCapture: (photo: { uri: string; width?: number; height?: number }) => void;
  onClose: () => void;
};

export function isInAppCameraAvailable(): boolean {
  return false;
}

export default function FrontCameraModal(_props: FrontCameraModalProps) {
  return null;
}
