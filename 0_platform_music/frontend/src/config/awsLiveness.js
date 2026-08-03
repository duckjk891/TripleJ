// v136 — AWS Face Liveness(고개 돌리기 실물 검사) 설정 모듈.
// 이 모듈은 FaceVerifyFlow 에서 dynamic import 로만 로드한다(다른 화면 번들 오염 방지).
// 정적 import 로 Amplify/FaceLivenessDetector 를 끌어와도 모듈 자체가 lazy chunk 로
// 분리되므로 초기 번들에는 포함되지 않는다.
import { Amplify } from 'aws-amplify';
import { FaceLivenessDetector } from '@aws-amplify/ui-react-liveness';
import '@aws-amplify/ui-react/styles.css';

// 공개 가능 값 — 시크릿 아님.
// Cognito 자격 증명 풀(도쿄, 게스트 전용): 게스트 역할에는
// rekognition:StartFaceLivenessSession 만 허용되어 있다.
export const FACE_LIVENESS_IDENTITY_POOL_ID =
  'ap-northeast-1:3495607e-1914-4e2e-9c14-ebf396557002';
export const FACE_LIVENESS_REGION = 'ap-northeast-1';

// FaceLivenessDetector(v3.6.7)가 검사 시작 시 내부에서 받아오는 얼굴감지 모델 CDN.
// (dist/esm/.../service/utils/blazefaceFaceDetection.mjs 의 DEFAULT_BLAZEFACE_URL 과 동일 —
//  패키지 루트에서 export 되지 않아 진단용으로 상수 복제)
const FACE_MODEL_CDN_URL =
  'https://cdn.liveness.rekognition.amazonaws.com/face-detection/tensorflow-models/blazeface/1.0.2/model/model.json';

// 진단용 — 얼굴감지 모델 CDN 도달 가능 여부를 원격 로그로 남긴다(비차단, 실패해도 흐름 영향 없음).
// 모델 로드 실패 시 컴포넌트가 10초 타임아웃 후 onError 를 내지만, 기기별 네트워크(사내망·
// 통신사 차단 등) 원인 분리를 위해 선제 확인 로그를 남긴다. 이미지 데이터 아님 — 로그 안전.
export function preflightFaceModelCdn() {
  fetch(FACE_MODEL_CDN_URL, { method: 'GET', cache: 'force-cache' })
    .then((res) => {
      console.info('[FaceVerifyFlow] liveness model CDN preflight', {
        ok: res.ok,
        status: res.status,
      });
    })
    .catch((err) => {
      console.error('[FaceVerifyFlow] liveness model CDN preflight failed', {
        message: err?.message,
      });
    });
}

let initialized = false;

// Amplify 게스트 자격 초기화(1회 가드) — 얼굴 인증 플로우 진입 시 지연 호출.
export function initFaceLiveness() {
  if (initialized) return;
  Amplify.configure({
    Auth: {
      Cognito: {
        identityPoolId: FACE_LIVENESS_IDENTITY_POOL_ID,
        allowGuestAccess: true,
      },
    },
  });
  initialized = true;
}

// FaceLivenessDetector 한국어 문구(컴포넌트 displayText prop 지원 키 범위 내 —
// 미지정 키는 컴포넌트 기본값(영문) 사용).
export const LIVENESS_DISPLAY_TEXT = {
  photosensitivityWarningHeadingText: '광과민성 주의',
  photosensitivityWarningBodyText:
    '이 검사는 화면이 여러 색상으로 깜박입니다. 광과민성이 있으신 분은 주의해주세요.',
  photosensitivityWarningInfoText:
    '일부 사용자는 깜박이는 빛에 의해 발작을 일으킬 수 있습니다. 위험이 느껴지면 검사를 중단하세요.',
  photosensitivityWarningLabelText: '자세히 보기',
  // (v137) 시작 화면은 disableStartScreen 으로 건너뛰므로 아래 시작 화면 문구들은
  //        평소 노출되지 않는다 — 되돌릴 경우를 대비해 유지.
  startScreenBeginCheckText: '검사 시작',
  waitingCameraPermissionText: '카메라 권한 허용을 기다리는 중...',
  cameraMinSpecificationsHeadingText: '카메라가 최소 사양을 지원하지 않습니다',
  cameraMinSpecificationsMessageText:
    '카메라는 최소 320x240 해상도, 15fps 이상을 지원해야 합니다.',
  cameraNotFoundHeadingText: '카메라를 찾을 수 없습니다',
  cameraNotFoundMessageText:
    '카메라가 연결되어 있고 브라우저의 카메라 권한이 허용되어 있는지 확인한 뒤 다시 시도해주세요.',
  retryCameraPermissionsText: '다시 시도',
  connectionTimeoutHeaderText: '연결 시간 초과',
  connectionTimeoutMessageText: '연결이 지연되고 있습니다. 잠시 후 다시 시도해주세요.',
  timeoutHeaderText: '시간 초과',
  timeoutMessageText: '제한 시간 안에 얼굴을 타원에 맞추지 못했습니다. 다시 시도해주세요.',
  faceDistanceHeaderText: '움직임이 감지되었습니다',
  faceDistanceMessageText: '검사 시작 전에는 카메라에 더 가까이 오지 마세요.',
  multipleFacesHeaderText: '여러 얼굴이 감지되었습니다',
  multipleFacesMessageText: '검사 중에는 카메라에 한 명만 보이도록 해주세요.',
  clientHeaderText: '오류가 발생했습니다',
  clientMessageText: '검사 중 문제가 발생했습니다. 다시 시도해주세요.',
  serverHeaderText: '서버 오류',
  serverMessageText: '요청을 처리하지 못했습니다. 다시 시도해주세요.',
  landscapeHeaderText: '가로 모드는 지원되지 않습니다',
  landscapeMessageText: '기기를 세로 방향으로 돌린 뒤 다시 시도해주세요.',
  portraitMessageText: '검사 중에는 기기를 세로 방향으로 유지해주세요.',
  tryAgainText: '다시 시도',
  cancelLivenessCheckText: '실물 확인 취소',
  recordingIndicatorText: '녹화 중',
  hintCenterFaceText: '얼굴을 화면 중앙에 맞춰주세요',
  hintCenterFaceInstructionText: '안내: 얼굴을 화면 중앙에 맞추면 검사가 자동으로 시작됩니다.',
  hintFaceOffCenterText: '얼굴이 타원 중앙에 오도록 위치를 조정해주세요',
  hintMoveFaceFrontOfCameraText: '얼굴을 카메라 앞에 위치시켜 주세요',
  hintTooManyFacesText: '카메라에 한 명만 보이도록 해주세요',
  hintFaceDetectedText: '얼굴이 인식되었습니다',
  hintCanNotIdentifyText: '얼굴을 카메라 앞에 위치시켜 주세요',
  hintTooCloseText: '뒤로 조금 물러나 주세요',
  hintTooFarText: '조금 더 가까이 와주세요',
  hintConnectingText: '연결 중...',
  hintVerifyingText: '확인 중...',
  hintCheckCompleteText: '확인이 완료되었습니다',
  hintHoldFaceForFreshnessText: '잠시 그대로 있어주세요',
  hintIlluminationTooBrightText: '더 어두운 곳으로 이동해주세요',
  hintIlluminationTooDarkText: '더 밝은 곳으로 이동해주세요',
  hintIlluminationNormalText: '조명이 적당합니다',
  // (v137) hintHoldFaceCenterText 는 v3.6.7 displayText 스키마에 없는 키라 제거
  //        (dist/esm/.../displayText.mjs 기본값 56키와 대조 — 오타 키는 무시될 뿐 무해하지만 정리).
  hintMatchIndicatorText: '50% 완료. 계속 가까이 와주세요.',
  goodFitCaptionText: '좋습니다',
  goodFitAltText: '타원 안에 얼굴이 꼭 맞게 위치한 예시',
  tooFarCaptionText: '너무 멀어요',
  tooFarAltText: '타원 안에서 얼굴이 너무 멀리 있는 예시',
};

export { FaceLivenessDetector };
