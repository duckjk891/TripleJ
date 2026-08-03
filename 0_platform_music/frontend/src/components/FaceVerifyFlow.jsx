import { useState, useEffect, useRef, useCallback } from 'react';
import { CONSENTS, CONSENT_VERSION, FACE_GUARDIAN_NOTICE } from '../constants/consentTexts';
import * as api from '../api';
import './FaceVerifyFlow.css';

// v135 — 얼굴 인증(생체 대조) 플로우 모달.
// v136 — capture 단계 mode 분기: status.mode==='aws' 면 AWS Face Liveness
//        (Amplify FaceLivenessDetector, "고개 돌리기" 실물 검사), 'mock' 이면
//        기존 getUserMedia 셀피 촬영(개발 폴백 — 유지).
// v137 — 실기기 "타원에서 멈춤" 버그 수정: FaceLivenessDetector(v3.6.7)는 기본적으로
//        시작 화면(start view)에서 카메라 프리뷰+정적 타원을 그려두고 "검사 시작" 버튼의
//        BEGIN 이벤트를 기다린다(자동 시작 아님). 웹소켓은 그 전에 이미 연결되므로
//        버튼을 못 찾고 대기하면 정확히 3분 뒤 AWS 가 세션 만료(SERVER_ERROR)를 푸시
//        — 실측 증상과 일치. 세로 3:4 비디오가 모달 폭(최대 480px)만큼 차지해 버튼이
//        모달 스크롤 아래로 밀려 보이지 않았음. disableStartScreen(설치 버전 3.6.7
//        types 의 공식 prop, 신규 문서의 disableInstructionScreen 에 해당)으로 시작
//        화면을 건너뛰어 얼굴 인식 즉시 검사가 자동 시작되도록 변경. 광과민성 경고는
//        시작 화면 생략 시 노출되지 않으므로 모달 안내 문구로 대체 유지.
// 상태 머신:
//   loading → (status 조회)
//     ├─ need_identity   : 본인인증 미완료 안내(닫기만)
//     ├─ consent         : 성인 — 동의 전문 + 체크 + [동의하기]
//     ├─ guardian        : 미성년 — 보호자 안내 + [보호자에게 동의 문자 보내기]
//     ├─ guardian_waiting: 보호자 승인 대기(status 3초 폴링)
//     ├─ capture         : mode==='aws' → 세션 생성+FaceLivenessDetector(dynamic import)
//     │                    mode==='mock' → getUserMedia 셀피 촬영(미등록/재촬영)
//     └─ (registered)    → verifying : 저장 얼굴 vs photo 즉시 대조
//   verifying → verified: onVerified() 콜백
//             → stored_mismatch : 알럿 후 capture 재진입(재촬영)
//             → live_mismatch   : blocked(이용불가)
//             → liveness_failed : 알럿 후 새 세션으로 capture 재진입(aws)
//   camera_error / error : 안내 후 닫기
// props:
//   photoFile  : 캐릭터 생성에 사용할 얼굴 사진 File (verify 의 photo 파트)
//   onVerified : 검증 통과 시 호출(원래 생성 흐름 재개)
//   onClose    : 취소/닫기(생성 중단)
// 주의: 얼굴 이미지 데이터(바이트·dataURL)는 절대 콘솔에 출력하지 않는다.

export default function FaceVerifyFlow({ photoFile, onVerified, onClose }) {
  const [step, setStep] = useState('loading');
  const [agreeChecked, setAgreeChecked] = useState(false);
  const [busy, setBusy] = useState(false); // 동의 기록/문자 발송 진행 중
  const [errorMsg, setErrorMsg] = useState('');
  // v136 — 라이브니스(aws 모드) 상태
  const [mode, setMode] = useState(null); // status.mode: 'aws' | 'mock'
  const [LivenessDetector, setLivenessDetector] = useState(null); // dynamic import 결과 컴포넌트
  const [livenessSessionId, setLivenessSessionId] = useState(null);
  const [livenessAttempt, setLivenessAttempt] = useState(0); // 증가 시 새 세션으로 재검사
  const livenessMetaRef = useRef(null); // {region, displayText} — awsLiveness 모듈 로드 시 채움
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const pollRef = useRef(null);
  const aliveRef = useRef(true);
  const statusRef = useRef(null); // 마지막 status 응답(registered 판단용)

  const consentItem = CONSENTS.face_biometric;

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const clearPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // capture 재진입(aws: 새 라이브니스 세션으로 재검사)
  const restartCapture = useCallback(() => {
    setLivenessSessionId(null);
    setLivenessAttempt((n) => n + 1);
    setStep('capture');
  }, []);

  // ── verify 호출: photo(+selfie 또는 session_id) 대조 → 결과 분기 ─────
  const runVerify = useCallback(
    async ({ selfieFile, sessionId } = {}) => {
      setStep('verifying');
      try {
        const { data } = await api.verifyFace(photoFile, { selfieFile, sessionId });
        if (!aliveRef.current) return;
        if (import.meta.env.DEV) {
          console.info('[FaceVerifyFlow] verify result', {
            verified: !!data?.verified,
            method: data?.method,
            reason: data?.reason,
          });
        }
        if (data?.verified) {
          onVerified();
          return;
        }
        if (data?.reason === 'liveness_failed') {
          // 실물 확인(라이브니스) 실패 — 새 세션으로 재검사
          alert('실물 확인에 실패했습니다. 다시 시도해주세요.');
          restartCapture();
          return;
        }
        if (data?.reason === 'stored_mismatch' || data?.need_recapture) {
          alert('저장된 얼굴 정보와 달라 본인 확인을 다시 진행합니다');
          restartCapture();
          return;
        }
        if (data?.reason === 'live_mismatch') {
          setStep('blocked');
          return;
        }
        setErrorMsg('얼굴 인증에 실패했습니다. 잠시 후 다시 시도해주세요.');
        setStep('error');
      } catch (err) {
        console.error('[FaceVerifyFlow] verify failed', {
          status: err?.response?.status,
          message: err?.message,
        });
        if (!aliveRef.current) return;
        if (sessionId && err?.response?.status === 400) {
          // 라이브니스 세션 만료/무효(400) — 새 세션으로 재검사
          alert(err?.response?.data?.error || '실물 확인 세션이 만료되었습니다. 다시 시도해주세요.');
          restartCapture();
          return;
        }
        setErrorMsg(err?.response?.data?.error || '얼굴 인증 요청에 실패했습니다. 잠시 후 다시 시도해주세요.');
        setStep('error');
      }
    },
    [photoFile, onVerified, restartCapture]
  );

  // 동의 확보 후 분기 — 저장 얼굴 있으면 즉시 대조, 없으면 최초 촬영
  const proceedAfterConsent = useCallback(
    (registered) => {
      if (registered) runVerify();
      else setStep('capture');
    },
    [runVerify]
  );

  // status → 단계 라우팅
  const routeFromStatus = useCallback(
    (st) => {
      statusRef.current = st || null;
      setMode(st?.mode === 'aws' ? 'aws' : 'mock');
      if (!st?.enabled) {
        // flag OFF — 게이트가 없으므로 모달을 닫고 원래 흐름에 맡긴다(방어 코드)
        if (import.meta.env.DEV) console.info('[FaceVerifyFlow] flag OFF, closing');
        onClose();
        return;
      }
      if (!st.is_verified) {
        setStep('need_identity');
        return;
      }
      if (st.consent_needed) {
        if (st.guardian_needed) {
          // 이미 발송된 보호자 요청이 대기 중이면 곧장 대기 화면으로
          const pending = st.guardian_status === 'pending' || st.guardian_status === 'requested';
          setStep(pending ? 'guardian_waiting' : 'guardian');
          return;
        }
        setStep('consent');
        return;
      }
      proceedAfterConsent(!!st.registered);
    },
    [onClose, proceedAfterConsent]
  );

  // 최초 status 조회 + 언마운트 정리
  useEffect(() => {
    aliveRef.current = true;
    api
      .getFaceVerifyStatus()
      .then(({ data }) => {
        if (!aliveRef.current) return;
        if (import.meta.env.DEV) {
          console.info('[FaceVerifyFlow] status', {
            enabled: !!data?.enabled,
            mode: data?.mode ?? null,
            is_verified: !!data?.is_verified,
            consent_needed: !!data?.consent_needed,
            guardian_needed: !!data?.guardian_needed,
            guardian_status: data?.guardian_status ?? null,
            registered: !!data?.registered,
          });
        }
        routeFromStatus(data);
      })
      .catch((err) => {
        console.error('[FaceVerifyFlow] status load failed', {
          status: err?.response?.status,
          message: err?.message,
        });
        if (!aliveRef.current) return;
        setErrorMsg('인증 상태를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.');
        setStep('error');
      });
    return () => {
      aliveRef.current = false;
    };
    // 마운트 시 1회만 조회 (routeFromStatus 는 ref/props 만 사용)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 언마운트 시 카메라/폴링 정리
  useEffect(
    () => () => {
      stopCamera();
      clearPoll();
    },
    [stopCamera, clearPoll]
  );

  // ── 보호자 승인 대기: status 3초 폴링 ────────────────────────────────
  useEffect(() => {
    if (step !== 'guardian_waiting') return undefined;
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await api.getFaceVerifyStatus();
        if (!aliveRef.current) return;
        statusRef.current = data || null;
        if (data?.guardian_status === 'rejected' || data?.guardian_status === 'denied') {
          clearPoll();
          setErrorMsg('보호자가 동의를 거절했습니다. 얼굴 사진 기능을 이용할 수 없습니다.');
          setStep('error');
          return;
        }
        if (data?.guardian_status === 'expired') {
          clearPoll();
          setErrorMsg('동의 요청이 만료되었습니다. 보호자 동의 문자를 다시 보내주세요.');
          setStep('guardian');
          return;
        }
        if (!data?.consent_needed) {
          clearPoll();
          if (import.meta.env.DEV) console.info('[FaceVerifyFlow] guardian consent approved');
          proceedAfterConsent(!!data?.registered);
        }
      } catch (err) {
        // 일시 오류는 다음 tick 에 재시도 — 폴링 유지
        console.error('[FaceVerifyFlow] guardian status poll failed', {
          status: err?.response?.status,
        });
      }
    }, 3000);
    return clearPoll;
  }, [step, clearPoll, proceedAfterConsent]);

  // ── 촬영 단계(aws): 라이브니스 모듈 dynamic import + 세션 생성 ────────
  // Amplify 번들은 이 시점에만 로드된다(초기 번들 미포함). livenessAttempt 증가 시
  // 새 세션으로 재검사(FaceLivenessDetector 는 세션당 1회용).
  useEffect(() => {
    if (step !== 'capture' || mode !== 'aws') return undefined;
    let cancelled = false;
    setLivenessSessionId(null);
    (async () => {
      try {
        const mod = await import('../config/awsLiveness');
        mod.initFaceLiveness(); // Cognito 게스트 자격 초기화(모듈 내 1회 가드)
        mod.preflightFaceModelCdn(); // 진단 — 얼굴감지 모델 CDN 도달 여부 원격 로그(비차단)
        livenessMetaRef.current = {
          region: mod.FACE_LIVENESS_REGION,
          displayText: mod.LIVENESS_DISPLAY_TEXT,
        };
        if (cancelled || !aliveRef.current) return;
        setLivenessDetector(() => mod.FaceLivenessDetector);
        const { data } = await api.createFaceSession();
        if (cancelled || !aliveRef.current) return;
        if (!data?.session_id) throw new Error('session_id missing in response');
        if (import.meta.env.DEV) {
          // 주의: 세션 ID 는 앞 8자만 로그
          console.info('[FaceVerifyFlow] liveness session created', {
            session: String(data.session_id).slice(0, 8),
          });
        }
        setLivenessSessionId(data.session_id);
      } catch (err) {
        console.error('[FaceVerifyFlow] liveness init failed', {
          status: err?.response?.status,
          message: err?.message,
        });
        if (cancelled || !aliveRef.current) return;
        setErrorMsg(
          err?.response?.data?.error || '실물 확인 준비에 실패했습니다. 잠시 후 다시 시도해주세요.'
        );
        setStep('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [step, mode, livenessAttempt]);

  // ── 촬영 단계(mock): 전면 카메라 오픈 — 개발 폴백 경로(유지) ──────────
  // aws 모드에서는 위 FaceLivenessDetector 경로가 대신 동작한다.
  useEffect(() => {
    if (step !== 'capture' || mode === 'aws') return undefined;
    let cancelled = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      console.error('[FaceVerifyFlow] getUserMedia unsupported');
      setStep('camera_error');
      return undefined;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user' }, audio: false })
      .then((stream) => {
        if (cancelled || !aliveRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        if (import.meta.env.DEV) console.info('[FaceVerifyFlow] camera started');
      })
      .catch((err) => {
        // 권한 거부(NotAllowedError)/장치 없음(NotFoundError) 등
        console.error('[FaceVerifyFlow] camera open failed', {
          name: err?.name,
          message: err?.message,
        });
        if (!cancelled && aliveRef.current) setStep('camera_error');
      });
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [step, mode, stopCamera]);

  // [촬영] — video 프레임을 canvas 로 캡처 → File 화 → verify
  const handleCapture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      alert('카메라 준비 중입니다. 잠시 후 다시 시도해주세요.');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!aliveRef.current) return;
        if (!blob) {
          console.error('[FaceVerifyFlow] canvas capture failed');
          setStep('camera_error');
          return;
        }
        const selfie = new File([blob], 'selfie.jpg', { type: 'image/jpeg' });
        // 주의: 이미지 데이터 자체는 로그 금지 — 크기만
        if (import.meta.env.DEV) console.info('[FaceVerifyFlow] selfie captured', { sizeBytes: selfie.size });
        stopCamera();
        runVerify({ selfieFile: selfie });
      },
      'image/jpeg',
      0.92
    );
  };

  // ── 라이브니스 콜백(aws) ─────────────────────────────────────────────
  // 검사 완료 — BE 가 세션 결과(참조 이미지)를 조회해 대조하도록 session_id 로 verify
  const handleLivenessComplete = async () => {
    if (!aliveRef.current || !livenessSessionId) return;
    if (import.meta.env.DEV) {
      console.info('[FaceVerifyFlow] liveness analysis complete', {
        session: String(livenessSessionId).slice(0, 8),
      });
    }
    await runVerify({ sessionId: livenessSessionId });
  };

  // 검사 오류 — 카메라 계열은 camera_error, 그 외(세션 만료 포함)는 새 세션 재시도
  // (v137) 원격 진단을 위해 오류 전체 필드 로그(이미지 데이터 없음 — 안전).
  const handleLivenessError = (livenessError, deviceInfo) => {
    console.error('[FaceVerifyFlow] liveness error', {
      state: livenessError?.state,
      name: livenessError?.error?.name,
      message: livenessError?.error?.message,
      session: livenessSessionId ? String(livenessSessionId).slice(0, 8) : null,
      deviceInfo: deviceInfo ?? null,
    });
    if (!aliveRef.current) return;
    if (
      livenessError?.state === 'CAMERA_ACCESS_ERROR' ||
      livenessError?.state === 'CAMERA_FRAMERATE_ERROR'
    ) {
      setStep('camera_error');
      return;
    }
    alert('실물 확인 중 오류가 발생했습니다. 다시 시도해주세요.');
    restartCapture();
  };

  // 컴포넌트 내 취소 버튼 — 세션은 1회용이라 새 세션으로 재시작(모달 닫기는 하단 취소)
  const handleLivenessUserCancel = () => {
    if (!aliveRef.current) return;
    if (import.meta.env.DEV) console.info('[FaceVerifyFlow] liveness user cancel — restart');
    restartCapture();
  };

  // [동의하기] — 성인 본인 동의 기록
  const handleConsentAgree = async () => {
    if (!agreeChecked || busy) return;
    setBusy(true);
    setErrorMsg('');
    try {
      await api.consentFaceVerify(CONSENT_VERSION);
      if (import.meta.env.DEV) console.info('[FaceVerifyFlow] consent recorded', { key: 'face_biometric' });
      if (!aliveRef.current) return;
      setBusy(false);
      proceedAfterConsent(!!statusRef.current?.registered);
    } catch (err) {
      console.error('[FaceVerifyFlow] consent record failed', {
        status: err?.response?.status,
        message: err?.message,
      });
      if (!aliveRef.current) return;
      setBusy(false);
      setErrorMsg('동의 처리에 실패했습니다. 잠시 후 다시 시도해주세요.');
    }
  };

  // [보호자에게 동의 문자 보내기] — mock 발송 후 대기 화면 진입
  const handleGuardianRequest = async () => {
    if (busy) return;
    setBusy(true);
    setErrorMsg('');
    try {
      const { data } = await api.requestFaceGuardianConsent();
      if (import.meta.env.DEV) {
        console.info('[FaceVerifyFlow] guardian request sent', { status: data?.status });
        // mock 모드: 실제 문자 대신 동의 링크가 응답으로 내려온다 — DEV 콘솔 안내
        if (data?.consent_url) {
          console.info('[FaceVerifyFlow] (DEV) mock 보호자 동의 링크 — 브라우저에서 열어 승인 테스트:', data.consent_url);
        }
      }
      if (!aliveRef.current) return;
      setBusy(false);
      setStep('guardian_waiting');
    } catch (err) {
      console.error('[FaceVerifyFlow] guardian request failed', {
        status: err?.response?.status,
        message: err?.message,
      });
      if (!aliveRef.current) return;
      setBusy(false);
      setErrorMsg('보호자 동의 문자 발송에 실패했습니다. 잠시 후 다시 시도해주세요.');
    }
  };

  const handleClose = () => {
    if (busy) return;
    if (import.meta.env.DEV) console.info('[FaceVerifyFlow] closed', { step });
    onClose();
  };

  // ── 렌더 ─────────────────────────────────────────────────────────────
  const renderBody = () => {
    switch (step) {
      case 'loading':
        return <p className="face-verify__message">인증 상태를 확인하는 중...</p>;

      case 'need_identity':
        return (
          <>
            <p className="face-verify__message">본인인증 후 이용할 수 있습니다</p>
            <p className="face-verify__hint">
              얼굴 사진을 사용한 캐릭터 생성은 본인인증을 완료한 회원만 이용할 수 있습니다.
            </p>
            <div className="face-verify__actions">
              <button type="button" className="face-verify__btn" onClick={handleClose}>
                닫기
              </button>
            </div>
          </>
        );

      case 'consent':
        return (
          <>
            <p className="face-verify__consent-label">{consentItem.label}</p>
            <div className="face-verify__consent-body">{consentItem.body}</div>
            <label className="face-verify__agree-label">
              <input
                type="checkbox"
                checked={agreeChecked}
                disabled={busy}
                onChange={(e) => setAgreeChecked(e.target.checked)}
              />
              <span>위 내용을 확인했으며 동의합니다.</span>
            </label>
            {errorMsg && <p className="face-verify__error">{errorMsg}</p>}
            <div className="face-verify__actions">
              <button type="button" className="face-verify__btn" onClick={handleClose} disabled={busy}>
                취소
              </button>
              <button
                type="button"
                className="face-verify__btn face-verify__btn--primary"
                onClick={handleConsentAgree}
                disabled={!agreeChecked || busy}
              >
                {busy ? '처리 중...' : '동의하기'}
              </button>
            </div>
          </>
        );

      case 'guardian':
        return (
          <>
            <p className="face-verify__consent-label">{consentItem.label}</p>
            <div className="face-verify__consent-body">{consentItem.body}</div>
            <p className="face-verify__guardian-notice">{FACE_GUARDIAN_NOTICE}</p>
            {errorMsg && <p className="face-verify__error">{errorMsg}</p>}
            <div className="face-verify__actions">
              <button type="button" className="face-verify__btn" onClick={handleClose} disabled={busy}>
                취소
              </button>
              <button
                type="button"
                className="face-verify__btn face-verify__btn--primary"
                onClick={handleGuardianRequest}
                disabled={busy}
              >
                {busy ? '발송 중...' : '보호자에게 동의 문자 보내기'}
              </button>
            </div>
          </>
        );

      case 'guardian_waiting':
        return (
          <>
            <span className="face-verify__spinner" />
            <p className="face-verify__message">보호자의 동의를 기다리고 있습니다...</p>
            <p className="face-verify__hint">
              보호자님께 동의 문자가 발송되었습니다. 동의가 완료되면 자동으로 다음 단계로 진행됩니다.
            </p>
            <p className="face-verify__guardian-notice">{FACE_GUARDIAN_NOTICE}</p>
            <div className="face-verify__actions">
              <button type="button" className="face-verify__btn" onClick={handleClose}>
                닫기
              </button>
            </div>
          </>
        );

      case 'capture':
        // aws 모드 — AWS Face Liveness("고개 돌리기" 실물 검사)
        if (mode === 'aws') {
          const ready = !!(LivenessDetector && livenessSessionId);
          return (
            <>
              <p className="face-verify__message">본인 확인을 위해 실물 검사를 진행합니다</p>
              {/* (v137) 시작 화면 생략(disableStartScreen)으로 컴포넌트 내장 광과민성
                  경고가 노출되지 않으므로 이 안내 문구가 그 역할을 대신한다 — 유지 필수. */}
              <p className="face-verify__hint">
                얼굴을 타원 안에 맞추면 검사가 자동으로 시작됩니다. 검사 중 화면이 여러 색상으로
                깜박입니다. 광과민성(깜박이는 빛에 민감)이 있으신 분은 주의해주세요.
              </p>
              {ready ? (
                <div className="face-verify__liveness">
                  <LivenessDetector
                    key={livenessSessionId}
                    sessionId={livenessSessionId}
                    region={livenessMetaRef.current?.region || 'ap-northeast-1'}
                    onAnalysisComplete={handleLivenessComplete}
                    onError={handleLivenessError}
                    onUserCancel={handleLivenessUserCancel}
                    displayText={livenessMetaRef.current?.displayText}
                    // (v137) 핵심 수정 — 시작 화면("검사 시작" 버튼 대기)을 건너뛰고
                    // 얼굴 인식 즉시 검사 자동 시작. 기본값(false)에서는 버튼의 BEGIN
                    // 이벤트 전까지 상태 머신이 start 상태에 머물고(웹소켓은 이미 연결),
                    // 버튼이 모달 스크롤 아래로 밀려 안 보이면 3분 뒤 세션 만료 — 실기기
                    // 증상의 원인. prop 명칭은 설치 버전(3.6.7) types 기준.
                    disableStartScreen
                  />
                </div>
              ) : (
                <>
                  <span className="face-verify__spinner" />
                  <p className="face-verify__hint">실물 확인 모듈을 준비하는 중...</p>
                </>
              )}
              <div className="face-verify__actions">
                <button type="button" className="face-verify__btn" onClick={handleClose}>
                  취소
                </button>
              </div>
            </>
          );
        }
        // mock 모드 — getUserMedia 셀피 촬영(개발 폴백, 유지)
        return (
          <>
            <p className="face-verify__message">본인 확인을 위해 얼굴을 촬영합니다</p>
            <p className="face-verify__hint">얼굴이 화면 중앙에 오도록 정면을 바라봐 주세요.</p>
            <video ref={videoRef} className="face-verify__video" autoPlay playsInline muted />
            <div className="face-verify__actions">
              <button type="button" className="face-verify__btn" onClick={handleClose}>
                취소
              </button>
              <button
                type="button"
                className="face-verify__btn face-verify__btn--primary"
                onClick={handleCapture}
              >
                촬영
              </button>
            </div>
          </>
        );

      case 'verifying':
        return (
          <>
            <span className="face-verify__spinner" />
            <p className="face-verify__message">얼굴을 대조하는 중...</p>
          </>
        );

      case 'blocked':
        return (
          <>
            <p className="face-verify__message">본인 얼굴 사진만 사용할 수 있습니다</p>
            <p className="face-verify__hint">
              촬영한 얼굴과 업로드한 사진이 일치하지 않아 이 사진으로는 캐릭터를 생성할 수 없습니다.
              본인 얼굴이 나온 사진으로 다시 시도해주세요.
            </p>
            <div className="face-verify__actions">
              <button type="button" className="face-verify__btn" onClick={handleClose}>
                닫기
              </button>
            </div>
          </>
        );

      case 'camera_error':
        return (
          <>
            <p className="face-verify__message">카메라를 사용할 수 없습니다</p>
            <p className="face-verify__hint">
              브라우저의 카메라 권한을 허용했는지 확인해주세요. 카메라가 없는 기기에서는 얼굴 인증을
              진행할 수 없습니다.
            </p>
            <div className="face-verify__actions">
              <button type="button" className="face-verify__btn" onClick={handleClose}>
                닫기
              </button>
            </div>
          </>
        );

      case 'error':
      default:
        return (
          <>
            <p className="face-verify__message">{errorMsg || '오류가 발생했습니다.'}</p>
            <div className="face-verify__actions">
              <button type="button" className="face-verify__btn" onClick={handleClose}>
                닫기
              </button>
            </div>
          </>
        );
    }
  };

  return (
    <div className="face-verify__overlay" onClick={handleClose}>
      <div className="face-verify__modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="face-verify__title">얼굴 인증</h2>
        {renderBody()}
      </div>
    </div>
  );
}
