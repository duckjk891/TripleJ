// v3.154 — 얼굴 인증(FaceGuardSquad) API 클라이언트: backend /api/face-verify/* (v135/v136 계약).
// verify는 aws 모드에서도 session_id 없이 selfie 파일 경로가 유효(서버 face_verify.py 실측) —
// AWS Face Liveness(Amplify)는 실기기 백로그로 이 서비스에서 다루지 않는다.
// 주의: 얼굴 이미지 바이트·dataURL은 절대 로그에 남기지 않는다(크기만).
import { Platform } from 'react-native';
import api from './api';

export interface FaceVerifyStatus {
  enabled: boolean;
  mode: 'aws' | 'mock' | string;
  is_verified: boolean;
  minor: boolean;
  consent_needed: boolean;
  guardian_needed: boolean;
  guardian_status: string | null; // 'pending' | 'requested' | 'approved' | 'rejected' | 'denied' | 'expired' | null
  registered: boolean;
}

export interface FaceVerifyResult {
  verified: boolean;
  method?: 'stored' | 'live';
  reason?: 'stored_mismatch' | 'live_mismatch' | 'liveness_failed' | string;
  need_recapture?: boolean;
  message?: string;
}

export interface PickedImage {
  uri: string;
  name: string;
  mimeType?: string | null;
}

export const getFaceVerifyStatus = async (): Promise<FaceVerifyStatus> => {
  const res = await api.get('/face-verify/status');
  return res.data;
};

export const consentFaceVerify = async (version: string): Promise<void> => {
  console.info('[faceVerifyService] consent 기록', { version });
  await api.post('/face-verify/consent', { version });
};

export const requestFaceGuardianConsent = async (): Promise<{ status?: string; consent_url?: string }> => {
  console.info('[faceVerifyService] 보호자 동의 요청');
  const res = await api.post('/face-verify/guardian/request', {});
  return res.data;
};

// RN(web/native) 공용 multipart 파일 첨부 — trackService appendFile 관행 축약
async function appendImage(form: FormData, field: string, img: PickedImage) {
  const mime = img.mimeType || 'image/jpeg';
  if (Platform.OS === 'web') {
    const blob = await (await fetch(img.uri)).blob();
    form.append(field, new File([blob], img.name, { type: mime }));
  } else {
    form.append(field, { uri: img.uri, name: img.name, type: mime } as any);
  }
}

/** POST /face-verify/verify — photo(캐릭터 생성용 얼굴 사진) + selfie(본인 확인 촬영본) 대조 */
export const verifyFace = async (photo: PickedImage, selfie?: PickedImage): Promise<FaceVerifyResult> => {
  const form = new FormData();
  await appendImage(form, 'photo', photo);
  if (selfie) await appendImage(form, 'selfie', selfie);
  console.info('[faceVerifyService] verify 요청', { hasSelfie: !!selfie });
  const res = await api.post('/face-verify/verify', form, {
    headers: Platform.OS === 'web' ? {} : { 'Content-Type': 'multipart/form-data' },
    timeout: 60000,
  });
  return res.data;
};
