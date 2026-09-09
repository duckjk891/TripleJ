// [FaceVerify] v3.154 — 얼굴 인증(생체 대조) 화면: MAIDOL FaceVerifyFlow(v135~v137) RN 이식.
// 실사+사진 캐릭터 생성이 403 face_verification_required 로 거절되면 이 화면으로 진입한다.
//
// 상태 머신 (MAIDOL 원본 준용, Liveness(aws Amplify)는 실기기 백로그 — 셀피 파일 경로 사용):
//   loading → (status 조회)
//     ├─ need_identity   : 본인인증 미완료 안내(닫기만)
//     ├─ consent         : 성인 — 동의 전문 + 체크 + [동의하기]
//     ├─ guardian        : 미성년 — 보호자 안내 + [보호자에게 동의 문자 보내기]
//     ├─ guardian_waiting: 보호자 승인 대기(3초 폴링)
//     └─ (registered)    → verifying: 저장 얼굴 vs photo 즉시 대조 / 미등록 → capture(셀피)
//   verifying → verified(생성 자동 재개) / stored_mismatch(재촬영) / live_mismatch(blocked) / error
// 주의: 얼굴 이미지 데이터(바이트·dataURL)는 절대 콘솔에 출력하지 않는다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View, ScrollView, TouchableOpacity, ActivityIndicator, Image } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import { AppText } from '../components/ui';
import { showAlert } from '../utils/appAlert';
import { colors } from '../theme/colors';
import { useCharacterTaskStore } from '../stores/characterTaskStore';
import {
  getFaceVerifyStatus, consentFaceVerify, requestFaceGuardianConsent, verifyFace,
  FaceVerifyStatus,
} from '../services/faceVerifyService';
import { FACE_CONSENT_VERSION, FACE_CONSENT_LABEL, FACE_CONSENT_BODY, FACE_GUARDIAN_NOTICE } from '../constants/faceConsent';

type Step =
  | 'loading' | 'need_identity' | 'consent' | 'guardian' | 'guardian_waiting'
  | 'capture' | 'verifying' | 'blocked' | 'error';

type Props = NativeStackScreenProps<any, 'FaceVerify'>;

export default function FaceVerifyScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const taskStore = useCharacterTaskStore();
  const photoUri = taskStore.photoUri;
  const photoName = taskStore.photoName || (photoUri?.split('/').pop() ?? 'photo.jpg');

  const [step, setStep] = useState<Step>('loading');
  const [agreeChecked, setAgreeChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const statusRef = useRef<FaceVerifyStatus | null>(null);
  const aliveRef = useRef(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearPoll = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  // ── verify: photo(+selfie) 대조 → 결과 분기 ──────────────────────────────
  const runVerify = useCallback(async (selfie?: { uri: string; name: string; mimeType?: string | null }) => {
    if (!photoUri) {
      setErrorMsg('생성에 사용할 사진을 찾지 못했어요. 아티스트 만들기부터 다시 시도해주세요.');
      setStep('error');
      return;
    }
    setStep('verifying');
    try {
      const data = await verifyFace({ uri: photoUri, name: photoName }, selfie);
      if (!aliveRef.current) return;
      console.info('[FaceVerify] verify 결과', { verified: !!data?.verified, method: data?.method, reason: data?.reason });
      if (data?.verified) {
        showAlert('인증 완료', '얼굴 인증이 완료됐어요! 아티스트 생성을 이어서 진행할게요.', [
          { text: '확인', onPress: () => navigation.replace('ArtistLoading' as any) },
        ]);
        return;
      }
      if (data?.reason === 'stored_mismatch' || data?.need_recapture) {
        showAlert('본인 확인 필요', '저장된 얼굴 정보와 달라 본인 확인을 다시 진행해요. 셀피를 다시 찍어주세요.');
        setStep('capture');
        return;
      }
      if (data?.reason === 'live_mismatch') {
        setStep('blocked');
        return;
      }
      setErrorMsg('얼굴 인증에 실패했어요. 잠시 후 다시 시도해주세요.');
      setStep('error');
    } catch (err: any) {
      console.error('[FaceVerify] verify 실패', { status: err?.response?.status, message: err?.message });
      if (!aliveRef.current) return;
      setErrorMsg(err?.response?.data?.error || err?.response?.data?.message || '얼굴 인증 요청에 실패했어요. 잠시 후 다시 시도해주세요.');
      setStep('error');
    }
  }, [photoUri, photoName, navigation]);

  const proceedAfterConsent = useCallback((registered: boolean) => {
    if (registered) runVerify();
    else setStep('capture');
  }, [runVerify]);

  // ── status → 단계 라우팅 ─────────────────────────────────────────────────
  const routeFromStatus = useCallback((st: FaceVerifyStatus | null) => {
    statusRef.current = st;
    if (!st?.enabled) {
      console.info('[FaceVerify] flag OFF — 닫기(방어)');
      navigation.goBack();
      return;
    }
    if (!st.is_verified) { setStep('need_identity'); return; }
    if (st.consent_needed) {
      if (st.guardian_needed) {
        const pending = st.guardian_status === 'pending' || st.guardian_status === 'requested';
        setStep(pending ? 'guardian_waiting' : 'guardian');
        return;
      }
      setStep('consent');
      return;
    }
    proceedAfterConsent(!!st.registered);
  }, [navigation, proceedAfterConsent]);

  useEffect(() => {
    aliveRef.current = true;
    (async () => {
      try {
        console.info('[FaceVerify] calling getFaceVerifyStatus');
        const st = await getFaceVerifyStatus();
        if (!aliveRef.current) return;
        console.info('[FaceVerify] status', {
          enabled: st.enabled, mode: st.mode, is_verified: st.is_verified,
          consent_needed: st.consent_needed, guardian_needed: st.guardian_needed,
          guardian_status: st.guardian_status, registered: st.registered,
        });
        routeFromStatus(st);
      } catch (err: any) {
        console.error('[FaceVerify] status 조회 실패', { status: err?.response?.status, message: err?.message });
        if (!aliveRef.current) return;
        setErrorMsg('인증 상태를 확인하지 못했어요. 잠시 후 다시 시도해주세요.');
        setStep('error');
      }
    })();
    return () => { aliveRef.current = false; clearPoll(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 보호자 승인 대기: 3초 폴링 ───────────────────────────────────────────
  useEffect(() => {
    if (step !== 'guardian_waiting') return undefined;
    pollRef.current = setInterval(async () => {
      try {
        const st = await getFaceVerifyStatus();
        if (!aliveRef.current) return;
        statusRef.current = st;
        if (st.guardian_status === 'rejected' || st.guardian_status === 'denied') {
          clearPoll();
          setErrorMsg('보호자가 동의를 거절했어요. 얼굴 사진 기능을 이용할 수 없어요.');
          setStep('error');
          return;
        }
        if (st.guardian_status === 'expired') {
          clearPoll();
          setErrorMsg('동의 요청이 만료됐어요. 보호자 동의 문자를 다시 보내주세요.');
          setStep('guardian');
          return;
        }
        if (!st.consent_needed) {
          clearPoll();
          console.info('[FaceVerify] 보호자 동의 승인 확인');
          proceedAfterConsent(!!st.registered);
        }
      } catch (err: any) {
        console.error('[FaceVerify] 보호자 상태 폴링 실패', { status: err?.response?.status });
      }
    }, 3000);
    return clearPoll;
  }, [step, clearPoll, proceedAfterConsent]);

  // ── 동의/보호자 요청/셀피 ────────────────────────────────────────────────
  const handleConsentAgree = async () => {
    if (!agreeChecked || busy) return;
    setBusy(true);
    try {
      await consentFaceVerify(FACE_CONSENT_VERSION);
      if (!aliveRef.current) return;
      console.info('[FaceVerify] 동의 기록 완료');
      proceedAfterConsent(!!statusRef.current?.registered);
    } catch (err: any) {
      console.error('[FaceVerify] 동의 기록 실패', { status: err?.response?.status });
      if (aliveRef.current) showAlert('오류', '동의 처리에 실패했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setBusy(false);
    }
  };

  const handleGuardianRequest = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const data = await requestFaceGuardianConsent();
      console.info('[FaceVerify] 보호자 동의 요청 발송', { status: data?.status });
      if (__DEV__ && data?.consent_url) {
        console.info('[FaceVerify] (DEV) mock 보호자 동의 링크:', data.consent_url);
      }
      if (aliveRef.current) setStep('guardian_waiting');
    } catch (err: any) {
      console.error('[FaceVerify] 보호자 요청 실패', { status: err?.response?.status });
      if (aliveRef.current) showAlert('오류', '보호자 동의 문자 발송에 실패했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setBusy(false);
    }
  };

  const handleSelfiePick = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: 'image/*' });
      if (res.canceled || !res.assets || !res.assets[0]) return;
      const a = res.assets[0];
      console.info('[FaceVerify] 셀피 선택', { sizeBytes: a.size ?? -1 });
      runVerify({ uri: a.uri, name: a.name || 'selfie.jpg', mimeType: a.mimeType });
    } catch (err: any) {
      console.error('[FaceVerify] 셀피 선택 실패', { message: err?.message });
      showAlert('오류', '셀피를 불러오지 못했어요. 다시 시도해주세요.');
    }
  };

  const handleClose = () => {
    if (busy) return;
    console.info('[FaceVerify] 닫기', { step });
    taskStore.failApi('얼굴 인증이 필요해 생성을 중단했어요. 인증 후 "이어서 만들기"로 다시 시도해주세요. 입력한 내용은 유지돼요.');
    navigation.goBack();
  };

  // ── 렌더 ────────────────────────────────────────────────────────────────
  const renderBody = () => {
    switch (step) {
      case 'loading':
        return <ActivityIndicator size="large" color={colors.accent.primary} style={{ marginTop: 40 }} />;
      case 'need_identity':
        return (
          <View style={styles.card}>
            <AppText style={styles.title}>본인인증 후 이용할 수 있어요</AppText>
            <AppText style={styles.hint}>
              얼굴 사진을 사용한 아티스트 생성은 본인인증을 완료한 회원만 이용할 수 있어요.
            </AppText>
            <TouchableOpacity style={styles.primaryBtn} onPress={handleClose}>
              <AppText style={styles.primaryBtnText}>닫기</AppText>
            </TouchableOpacity>
          </View>
        );
      case 'consent':
        return (
          <View style={styles.card}>
            <AppText style={styles.title}>{FACE_CONSENT_LABEL}</AppText>
            <ScrollView style={styles.consentBox} nestedScrollEnabled>
              <AppText style={styles.consentBody}>{FACE_CONSENT_BODY}</AppText>
            </ScrollView>
            <TouchableOpacity style={styles.agreeRow} onPress={() => setAgreeChecked((v) => !v)} activeOpacity={0.7}>
              <View style={[styles.checkbox, agreeChecked && styles.checkboxOn]}>
                {agreeChecked && <AppText style={styles.checkboxMark}>✓</AppText>}
              </View>
              <AppText style={styles.agreeText}>위 내용을 확인했으며 동의합니다</AppText>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.primaryBtn, (!agreeChecked || busy) && { opacity: 0.4 }]}
              onPress={handleConsentAgree}
              disabled={!agreeChecked || busy}
            >
              {busy ? <ActivityIndicator size="small" color={colors.text.primary} /> : <AppText style={styles.primaryBtnText}>동의하기</AppText>}
            </TouchableOpacity>
          </View>
        );
      case 'guardian':
        return (
          <View style={styles.card}>
            <AppText style={styles.title}>보호자 동의가 필요해요</AppText>
            <AppText style={styles.hint}>
              만 19세 미만 회원의 얼굴 인증(생체정보 처리)에는 보호자(법정대리인) 동의가 필요해요.
            </AppText>
            <AppText style={styles.notice}>{FACE_GUARDIAN_NOTICE}</AppText>
            <TouchableOpacity style={[styles.primaryBtn, busy && { opacity: 0.4 }]} onPress={handleGuardianRequest} disabled={busy}>
              {busy ? <ActivityIndicator size="small" color={colors.text.primary} /> : <AppText style={styles.primaryBtnText}>보호자에게 동의 문자 보내기</AppText>}
            </TouchableOpacity>
          </View>
        );
      case 'guardian_waiting':
        return (
          <View style={styles.card}>
            <ActivityIndicator size="large" color={colors.accent.primary} style={{ marginBottom: 14 }} />
            <AppText style={styles.title}>보호자 승인을 기다리고 있어요</AppText>
            <AppText style={styles.hint}>보호자가 문자 속 링크에서 동의하면 자동으로 다음 단계로 넘어가요.</AppText>
          </View>
        );
      case 'capture':
        return (
          <View style={styles.card}>
            <AppText style={styles.title}>본인 확인 셀피</AppText>
            <AppText style={styles.hint}>
              생성에 사용할 사진이 본인인지 확인하기 위해, 지금 얼굴을 촬영하거나 방금 찍은 셀피를 올려주세요.
              촬영 원본은 대조 처리 후 즉시 파기돼요.
            </AppText>
            {photoUri ? <Image source={{ uri: photoUri }} style={styles.photoPreview} /> : null}
            <TouchableOpacity style={styles.primaryBtn} onPress={handleSelfiePick}>
              <AppText style={styles.primaryBtnText}>📷 셀피 촬영/선택</AppText>
            </TouchableOpacity>
          </View>
        );
      case 'verifying':
        return (
          <View style={styles.card}>
            <ActivityIndicator size="large" color={colors.accent.primary} style={{ marginBottom: 14 }} />
            <AppText style={styles.title}>얼굴을 대조하는 중...</AppText>
          </View>
        );
      case 'blocked':
        return (
          <View style={styles.card}>
            <AppText style={styles.title}>본인 확인에 실패했어요</AppText>
            <AppText style={styles.hint}>
              업로드한 사진과 촬영한 얼굴이 일치하지 않아요. 본인 사진으로만 아티스트를 만들 수 있어요.
            </AppText>
            <TouchableOpacity style={styles.primaryBtn} onPress={handleClose}>
              <AppText style={styles.primaryBtnText}>닫기</AppText>
            </TouchableOpacity>
          </View>
        );
      case 'error':
      default:
        return (
          <View style={styles.card}>
            <AppText style={styles.title}>문제가 생겼어요</AppText>
            <AppText style={styles.hint}>{errorMsg || '잠시 후 다시 시도해주세요.'}</AppText>
            <TouchableOpacity style={styles.primaryBtn} onPress={handleClose}>
              <AppText style={styles.primaryBtnText}>닫기</AppText>
            </TouchableOpacity>
          </View>
        );
    }
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={handleClose} style={styles.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <AppText style={styles.backBtnText}>‹</AppText>
        </TouchableOpacity>
        <AppText style={styles.headerTitle}>얼굴 인증</AppText>
        <View style={styles.backBtn} />
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        {renderBody()}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.deepest },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: colors.bg.surface1,
  },
  backBtn: { width: 44, paddingHorizontal: 12, paddingVertical: 4 },
  backBtnText: { fontSize: 26, color: colors.text.primary, fontWeight: '300' },
  headerTitle: { fontSize: 16, fontWeight: '700', color: colors.text.primary },
  card: {
    backgroundColor: colors.bg.surface1, borderWidth: 1, borderColor: colors.border.subtle,
    borderRadius: 14, padding: 16,
  },
  title: { color: colors.text.primary, fontSize: 16, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  hint: { color: colors.text.secondary, fontSize: 13, lineHeight: 19, marginBottom: 12, textAlign: 'center' },
  notice: { color: colors.accent.primary, fontSize: 12, lineHeight: 18, marginBottom: 12 },
  consentBox: {
    maxHeight: 300, backgroundColor: colors.bg.deepest, borderWidth: 1, borderColor: colors.border.subtle,
    borderRadius: 10, padding: 12, marginBottom: 12,
  },
  consentBody: { color: colors.text.secondary, fontSize: 12, lineHeight: 19 },
  agreeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  checkbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: colors.border.subtle,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg.deepest,
  },
  checkboxOn: { backgroundColor: colors.accent.primary, borderColor: colors.accent.primary },
  checkboxMark: { color: colors.text.primary, fontSize: 14, fontWeight: '700' },
  agreeText: { color: colors.text.primary, fontSize: 13, fontWeight: '600', flex: 1 },
  primaryBtn: {
    backgroundColor: colors.accent.primary, borderRadius: 12, paddingVertical: 13,
    alignItems: 'center', justifyContent: 'center',
  },
  primaryBtnText: { color: colors.text.primary, fontSize: 14, fontWeight: '700' },
  photoPreview: {
    width: 140, height: 140, borderRadius: 12, alignSelf: 'center', marginBottom: 12,
    borderWidth: 1, borderColor: colors.border.subtle, resizeMode: 'cover',
  },
});
