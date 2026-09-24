import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  StyleSheet,
  View,
  Text,
  Image,
  Animated,
  Easing,
  ActivityIndicator,
  Platform,
  TouchableOpacity,
} from 'react-native';
import { AppText } from '../components/ui';
import { showAlert } from '../utils/appAlert';
import api, { BACKEND_BASE_URL } from '../services/api';
import { spendExtraSlot, parseGenerationInProgress } from '../services/characterService';
import { useCharacterTaskStore, type CharacterTaskMode } from '../stores/characterTaskStore';
import { useOutfitStore, type AppliedItem } from '../stores/outfitStore';
import { usePointsStore } from '../stores/pointsStore';
import { usePlayerStore } from '../stores/playerStore';
import { useTrackedJob, getBlockingArtistJob, type TrackedUsedItem } from '../stores/generationJobStore';
import {
  registerArtistJob,
  adoptInProgressJob,
  finalizeArtistJob,
  acknowledgeFailedJob,
  guardArtistGeneration,
  setViewerJob,
  refreshRecoverable,
  ensureServerCapability,
} from '../services/generationTracker';
import { appendAuthImageToForm } from '../utils/authImage';
import { getFatigueStatus } from '../services/fatigueService';
import { showFatigueCooldownDialog } from '../utils/fatigueGate';
import { FatigueStatus } from '../types';
import AppScreenLayout from '../components/AppScreenLayout';
import { colors } from '../theme/colors';

const ARTIST_PORTRAIT = require('../assets/portraits/artist_director.png');

function characterPreviewUrl(previewPath: string): string {
  // cache-buster: RN Image가 같은 URL이면 옛 이미지 캐시 사용 → 새 시트로 갱신 안 됨
  const sep = previewPath.includes('?') ? '&' : '?';
  return `${BACKEND_BASE_URL}${previewPath}${sep}t=${Date.now()}`;
}

// platform별 FormData file append — web은 File/Blob 필요, RN은 { uri, name, type } 객체
async function appendFileToForm(form: FormData, field: string, uri: string, name: string, mimeType: string) {
  if (Platform.OS === 'web') {
    const res = await fetch(uri);
    const blob = await res.blob();
    // blob.type이 비어있거나 다른 mime일 수 있으니 명시적으로 File 객체로 wrap
    const file = new File([blob], name, { type: mimeType });
    console.log('[appendFileToForm/web]', field, 'size:', file.size, 'type:', file.type, 'name:', file.name);
    form.append(field, file);
  } else {
    form.append(field, { uri, name, type: mimeType } as any);
  }
}

function inferMimeType(filename: string): string {
  const ext = (filename.split('.').pop() || 'jpg').toLowerCase();
  return `image/${ext === 'jpg' ? 'jpeg' : ext}`;
}

// v3.227 A-보완: 화면 내부 폴링(pollCharacterJob — 오류 3회 포기·15분 상한) 삭제 →
// 전역 추적기(services/generationTracker.ts)가 화면과 무관하게 job을 추적한다.
// 이 화면은 POST(접수)까지만 담당하고, 이후엔 추적 뷰어로 상태를 보여줄 뿐이다.

// v3.76: 코디 선택분(상의/하의/신발)을 서버 정식 계약(object_name 필드)으로 전송.
// 기존 방식(이미지 재다운로드 후 top_image 첨부)보다 단순하고 서버가 원본 화질로 처리.
function appendOutfitObjectNames(form: FormData, items: AppliedItem[]) {
  const fieldByCat: Record<string, string> = { 상의: 'top_object_name', 하의: 'bottom_object_name', 신발: 'shoes_object_name' };
  for (const [cat, field] of Object.entries(fieldByCat)) {
    const item = items.find((it) => it.cat === cat && it.imageObjectName);
    if (item?.imageObjectName) form.append(field, item.imageObjectName);
  }
}

// v3.227 H-3: appendMinioImageToForm(원본 사진을 무인증으로 내려받아 다시 올리던 경로) 제거 →
// 실사 옷 입히기는 서버 원본 경로를 Form `original_object_name`으로 보낸다(서버가 소유권 검증 후 직접 읽음).

/** save used_items 원천 — 추적 레코드에 텍스트로 보존(앱 재시작 후 finalize에서도 코디 기록 유지) */
function toUsedItems(items: AppliedItem[]): TrackedUsedItem[] {
  return items
    .filter((it) => it.imageObjectName)
    .map((it) => ({
      name: it.name,
      image_object_name: it.imageObjectName as string,
      product_url: it.productUrl,
      category: it.cat,
    }));
}

// API 처리 중 표시되는 로딩 단계 (맵 팝업의 컨셉 단계와 의도적으로 다름)
const LOADING_STEPS_BY_MODE: Record<NonNullable<CharacterTaskMode>, { label: string; message: string }[]> = {
  sheet: [
    { label: '인식', message: '얼굴을 인식하고 있어요...' },
    { label: '스타일', message: '스타일을 적용하고 있어요...' },
    { label: '렌더링', message: '시트를 렌더링하고 있어요...' },
    { label: '완성', message: '마무리 중이에요...' },
  ],
  refine: [
    { label: '분석', message: '요청을 분석하고 있어요...' },
    { label: '재작업', message: '캐릭터를 다듬고 있어요...' },
    { label: '완성', message: '마무리 중이에요...' },
  ],
  outfit: [
    { label: '매칭', message: '의상을 캐릭터와 맞추고 있어요...' },
    { label: '입히기', message: '시트에 입혀보고 있어요...' },
    { label: '완성', message: '마무리 중이에요...' },
  ],
};

function modeMeta(mode: CharacterTaskMode | null) {
  if (mode === 'refine') return { taskName: '미세조정' };
  if (mode === 'outfit') return { taskName: '코디' };
  return { taskName: '아티스트' };
}

export default function ArtistLoadingScreen({ navigation, route }: any) {
  const taskStore = useCharacterTaskStore();
  // v3.227 A-보완: 라우트 {jobId} = 추적 뷰어(재진입 — POST 없음). 없으면 POST(접수) 후 뷰어로 전환.
  const routeJobId: string | null = route?.params?.jobId ? String(route.params.jobId) : null;
  const [jobId, setJobId] = useState<string | null>(routeJobId);
  const tracked = useTrackedJob(jobId);
  const isViewer = !!jobId;
  const mode: CharacterTaskMode | null = isViewer ? (tracked?.mode ?? 'sheet') : taskStore.mode;
  const meta = modeMeta(mode);
  const stages = LOADING_STEPS_BY_MODE[mode ?? 'sheet'];

  const [messageIndex, setMessageIndex] = useState(0);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  // 뷰어 상태: finalize 진행(레코드 삭제 → 화면 전환 경합 방지)·저장 실패(재시도 버튼)·실패 처리 1회
  const finalizingRef = useRef(false);
  const failHandledRef = useRef(false);
  const missingHandledRef = useRef(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());

  // v3.105: 작업실 화면은 미니플레이어 숨김 + 백그라운드 재생 유지(대표 방침). blur 시 복원.
  useFocusEffect(
    useCallback(() => {
      usePlayerStore.getState().setMiniHidden(true);
      return () => {
        usePlayerStore.getState().setMiniHidden(false);
      };
    }, [])
  );

  // v3.227: 추적기에 "뷰어가 이 job을 보고 있음"을 알림 — 완성 시 알림 팝업 대신 뷰어가 finalize
  useFocusEffect(
    useCallback(() => {
      if (!jobId) return undefined;
      setViewerJob(jobId);
      return () => setViewerJob(null);
    }, [jobId])
  );

  const leaveToMap = useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('Map');
  }, [navigation]);

  // ── v3.227 추적 뷰어: 완성 → finalize(단일 경로) / 실패 → 환불 안내 / 레코드 소멸 → 복귀 ──
  useEffect(() => {
    if (!jobId) return;
    if (!tracked) {
      if (finalizingRef.current || missingHandledRef.current) return;
      missingHandledRef.current = true;
      console.info('[ArtistLoading] 추적 레코드 없음 — 복귀', { jobId });
      leaveToMap();
      setTimeout(() => {
        showAlert('안내', '이 작업은 이미 저장됐거나 더 이상 확인할 수 없어요. 내 아티스트에서 확인해주세요.');
      }, 100);
      return;
    }
    if (tracked.lastStatus === 'done' && !finalizingRef.current && !saveFailed) {
      finalizingRef.current = true;
      console.info('[ArtistLoading] 완성 — finalize', { jobId });
      finalizeArtistJob(jobId, { navigation, replace: true }).then((out) => {
        // saved = ArtistResult로 전환됨 / busy = 다른 경로(카드·말풍선)가 저장 중 — 레코드 소멸을 '없음'으로 오인하지 않게 유지
        if (out === 'failed' || out === 'not-ready') {
          finalizingRef.current = false;
          if (out === 'failed') setSaveFailed(true);
        }
      });
      return;
    }
    if (tracked.lastStatus === 'failed' && !failHandledRef.current) {
      failHandledRef.current = true;
      missingHandledRef.current = true; // 아래 레코드 정리 후 '없음' 경로 재진입 방지
      // 서버가 실패를 확정한 경우에만 여기 도달 — 서버가 ⭐ 자동 환불(refund_character_job_points)
      const msg = `${tracked.error || '아티스트를 만들지 못했어요.'}\n사용된 별은 자동으로 환불돼요.`;
      console.info('[ArtistLoading] 서버 실패 확정', { jobId, refunded: tracked.refunded });
      acknowledgeFailedJob(jobId);
      taskStore.failApi(msg); // 입력 보존 — 아티스트 만들기의 "이어서 만들기"로 재개
      usePointsStore.getState().fetchBalance();
      leaveToMap();
      setTimeout(() => showAlert('만들지 못했어요', msg), 100);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, tracked?.lastStatus, saveFailed]);

  // 경과 시간 표시(30초마다)
  useEffect(() => {
    if (!isViewer) return undefined;
    const t = setInterval(() => setNowTick(Date.now()), 30000);
    return () => clearInterval(t);
  }, [isViewer]);

  // ── API 호출 (mount 직후 한 번 — 뷰어 재진입이면 POST 없음) ──
  useEffect(() => {
    if (routeJobId) return;
    if (!mode) {
      // store에 작업 정보 없음 — 잘못 진입
      navigation.goBack();
      return;
    }
    let cancelled = false;
    const callApi = async () => {
      try {
        const photoUri = taskStore.photoUri;
        const photoName = taskStore.photoName;

        // v3.227 중복 생성 가드(최종 방어 — POST 직전, 과금 전): 추적 중 job이 있으면 요청 0
        if ((mode === 'sheet' || mode === 'outfit') && getBlockingArtistJob()) {
          console.info('[ArtistLoading] 중복 생성 차단 — POST 없음');
          navigation.goBack();
          setTimeout(() => { guardArtistGeneration({ where: 'ArtistLoading' }); }, 100);
          return;
        }

        if (mode === 'sheet') {
          // ── 신규 캐릭터 시트 생성 — v3.76: 비동기(job) + 텍스트-only 허용(MAIDOL v161) ──
          // v3.80: 가상화(그림) 모드 — cartoon 엔드포인트 + style_preset XOR style_image
          const isVirtual = taskStore.characterKind === 'virtual';
          const hasPhoto = !!photoUri;
          // v3.227 H-1(W1): [이전 사진 사용] — 사진 파일 대신 서버 원본 경로(실사 전용 — cartoon은 미지원)
          const reuseOriginal = !hasPhoto && !isVirtual ? taskStore.reuseOriginalObjectName || null : null;
          // v3.227 H-1: 생성 직전 가드(API 호출·⭐ 차감 전) — 실사인데 사진으로 만들기로 했던(의도='photo')
          // 흐름에서 사진이 사라졌으면 텍스트 전용으로 조용히 생성하지 않고 중단 → 사진 재업로드로 안내.
          // 사진 없이 만들기(의도='text')를 명시 선택한 텍스트 경로는 그대로 통과한다.
          const photoIntent = taskStore.photoIntent ?? taskStore.draft?.photoIntent ?? null;
          if (!isVirtual && photoIntent === 'photo' && !hasPhoto && !reuseOriginal) {
            console.warn('[ArtistLoading] 사진 누락 차단', { intent: photoIntent, kind: taskStore.characterKind });
            const blockedMsg = '얼굴 사진이 확인되지 않아 만들지 않았어요. 사진을 다시 올려주세요. (별은 사용되지 않았어요)';
            taskStore.failApi(blockedMsg);
            // 사진 단계로 — draft가 있으면 그 키(재생성 cid·kind)로 진입해야 복원(사진 재요구)이 적용된다
            const d = taskStore.draft;
            const inputParams = d
              ? { ...(d.targetCharacterId ? { characterId: d.targetCharacterId } : {}), ...(d.forceKind ? { forceKind: d.forceKind } : {}) }
              : taskStore.targetCharacterId && !taskStore.legacyContract
                ? { characterId: taskStore.targetCharacterId, forceKind: taskStore.characterKind }
                : undefined;
            navigation.replace('ArtistInput', inputParams);
            setTimeout(() => {
              showAlert('사진을 다시 올려주세요', blockedMsg);
            }, 100);
            return;
          }
          if (!hasPhoto && !reuseOriginal && !(taskStore.userText || '').trim()) throw new Error('사진 또는 컨셉 설명이 필요해요.');
          const form = new FormData();
          const nameFromUri = photoName || (photoUri?.split('/').pop() ?? 'photo.jpg');
          const mime = inferMimeType(nameFromUri);
          if (hasPhoto) {
            await appendFileToForm(form, 'file', photoUri!, nameFromUri, mime);
            // v3.76(MAIDOL v137): 사진 확약 — ArtistInput에서 확인받은 값
            if (taskStore.portraitConfirmed) form.append('portrait_confirmed', 'true');
          } else if (reuseOriginal) {
            // 서버가 소유권 검증(타인 403) 후 같은 바이트로 얼굴 인증 게이트 수행 — 인증 우회 없음
            form.append('original_object_name', reuseOriginal);
            if (taskStore.portraitConfirmed) form.append('portrait_confirmed', 'true');
          }

          // v3.76: 코디 선택분은 서버 정식 계약(object_name)으로 전송
          const items: AppliedItem[] = useOutfitStore.getState().items;
          appendOutfitObjectNames(form, items);

          form.append('user_text', taskStore.userText || '');
          // v217: image_model 미전송 — 서버가 generate-sheet(-async)=gpt_image_2 /
          // -cartoon=nb_pro 로 고정하고 요청값은 무시(400 소멸). 보낼 이유 없음.
          // v3.103(B-1): 재생성이면 character_id 지정(기존 아티스트 갱신 — kind 불일치 400),
          // 미지정=신규(슬롯 검사 → used>=max면 409 slot_limit_exceeded, ⭐ 차감 전).
          // 레거시(구 계약) 계정은 character_id 미전송(구버전 경로 유지).
          const targetCid = taskStore.legacyContract ? null : taskStore.targetCharacterId;
          if (targetCid) form.append('character_id', targetCid);
          if (isVirtual) {
            // style_image XOR style_preset — 둘 중 하나만
            if (taskStore.styleImageUri) {
              const styleName = taskStore.styleImageName || (taskStore.styleImageUri.split('/').pop() ?? 'style.jpg');
              await appendFileToForm(form, 'style_image', taskStore.styleImageUri, styleName, inferMimeType(styleName));
            } else if (taskStore.stylePreset) {
              form.append('style_preset', taskStore.stylePreset);
            } else {
              throw new Error('화풍 정보가 없어요. 아티스트 만들기부터 다시 시도해주세요.');
            }
          }
          const endpoint = isVirtual ? '/character/generate-sheet-cartoon-async' : '/character/generate-sheet-async';
          console.info('[ArtistLoading] generate-sheet 요청', {
            endpoint, hasPhoto, reuse: !!reuseOriginal, items: items.length, isVirtual,
            stylePreset: taskStore.stylePreset, hasStyleImage: !!taskStore.styleImageUri,
            characterId: targetCid, legacyContract: taskStore.legacyContract,
          });
          const startRes = await api.post(endpoint, form, {
            // web: 브라우저가 FormData boundary 자동 설정 / RN: 명시 필요
            headers: Platform.OS === 'web' ? {} : { 'Content-Type': 'multipart/form-data' },
            timeout: 120000,
          });
          const newJobId = startRes.data?.job_id ? String(startRes.data.job_id) : '';
          if (!newJobId) throw new Error('생성 접수 응답을 확인하지 못했어요. 잠시 후 내 아티스트에서 확인해주세요.');
          // v3.227: job_id 수신 직후·화면 전환 전 영속 기록(이탈해도 추적 지속) — cancelled 여부와 무관
          registerArtistJob({
            jobId: newJobId,
            mode: 'sheet',
            characterKind: isVirtual ? 'virtual' : 'real',
            targetCharacterId: targetCid,
            legacyContract: taskStore.legacyContract,
            photoIntent: hasPhoto || reuseOriginal ? 'photo' : photoIntent ?? 'text',
            pendingName: useCharacterTaskStore.getState().pendingName,
            pendingGender: useCharacterTaskStore.getState().pendingGender,
            pendingAge: useCharacterTaskStore.getState().pendingAge,
            usedItems: toUsedItems(items),
            artStyleHint: isVirtual ? (taskStore.styleImageUri ? 'custom' : taskStore.stylePreset) : null,
            photo: hasPhoto ? { uri: photoUri!, name: nameFromUri, mime } : null,
          });
          usePointsStore.getState().fetchBalance(); // 접수 즉시 서버가 ⭐ 차감 → 로딩 중에도 배지 반영
          if (cancelled) return;
          setJobId(newJobId); // → 추적 뷰어(완성 시 finalize가 save → ArtistResult)
          return;
        } else if (mode === 'outfit') {
          // ── 9004 옷 입히기 = refine 폐기, generate-sheet 재호출 ──
          // 실사: 서버 원본(original_object_name Form — v3.227 H-1/H-3) + 옷 이미지(object_name) → generate-sheet-async
          // v3.122 가상: 원본 사진 대신 서버가 저장된 시트를 기준으로 로드(v223
          // use_saved_sheet) → generate-sheet-cartoon-async(nb_pro) — 화풍은 서버가
          // doc.art_style로 복원(화풍 붕괴 금지). character_id 지정 재생성이라 슬롯 미소모.
          const isVirtualOutfit = taskStore.characterKind === 'virtual';
          const outfitCid = taskStore.legacyContract ? null : taskStore.targetCharacterId;

          // 코디 선택분 — v3.76: 서버 정식 계약(object_name 필드)으로 전송
          const items: AppliedItem[] = useOutfitStore.getState().items;
          const form = new FormData();
          let endpoint: string;

          if (isVirtualOutfit) {
            // 가상: cid 재생성 계약 필수 (레거시 가상은 ArtistResult에서 사전 차단)
            if (!outfitCid) {
              throw new Error('캐릭터 아티스트 정보를 찾지 못했어요. 목록에서 다시 진입해주세요.');
            }
            form.append('use_saved_sheet', 'true');
            endpoint = '/character/generate-sheet-cartoon-async';
          } else {
            // 실사: originalPhotoObjectName 확보 (store 캐시 우선, 없으면 /me)
            let origObjectName = taskStore.originalPhotoObjectName;
            if (!origObjectName) {
              try {
                const meRes = await api.get('/character/me');
                origObjectName = meRes.data?.character?.original_photo_object_name || null;
                if (origObjectName) {
                  taskStore.setInput({ originalPhotoObjectName: origObjectName });
                }
              } catch (meErr: any) {
                console.warn('[Artist] /me 조회 실패:', meErr?.response?.status);
              }
            }
            if (!origObjectName) {
              throw new Error('원본 사진이 없어요. 캐릭터를 다시 만들어주세요.');
            }
            // v3.227 H-3: 원본을 앱이 내려받아 다시 올리지 않고 서버 경로로 전달(서버가 소유권 검증 후 직접 읽음).
            // 구서버(v3.227 미배포 — recoverable 404)만 인증 헤더 다운로드 폴백(URL 토큰 없음).
            const cap = await ensureServerCapability();
            if (cap === 'no') {
              console.info('[ArtistLoading] 구서버 — 원본 인증 다운로드 폴백');
              await appendAuthImageToForm(form, 'file', origObjectName);
            } else {
              form.append('original_object_name', origObjectName);
            }
            endpoint = '/character/generate-sheet-async';
          }

          appendOutfitObjectNames(form, items);
          form.append('user_text', taskStore.outfitDesc || '');
          // v217: image_model 미전송 — 서버가 real=gpt_image_2 / cartoon=nb_pro 고정(요청값 무시)
          // v3.103(B-1): 코디도 대상 아티스트(cid) 재생성으로 — 미지정이면 신규 생성돼
          // 슬롯을 소모하므로 서버 아티스트에서 진입 시 반드시 character_id 지정.
          if (outfitCid) form.append('character_id', outfitCid);

          console.log('[ArtistLoading] outfit 요청', {
            endpoint, virtual: isVirtualOutfit, items: items.length,
            characterId: outfitCid, legacyContract: taskStore.legacyContract,
          });
          const startRes = await api.post(endpoint, form, {
            // web: 브라우저가 FormData boundary 자동 설정 / RN: 명시 필요
            headers: Platform.OS === 'web' ? {} : { 'Content-Type': 'multipart/form-data' },
            timeout: 120000,
          });
          const newJobId = startRes.data?.job_id ? String(startRes.data.job_id) : '';
          if (!newJobId) throw new Error('생성 접수 응답을 확인하지 못했어요. 잠시 후 내 아티스트에서 확인해주세요.');
          registerArtistJob({
            jobId: newJobId,
            mode: 'outfit',
            characterKind: isVirtualOutfit ? 'virtual' : 'real',
            targetCharacterId: outfitCid,
            legacyContract: taskStore.legacyContract,
            photoIntent: null,
            pendingName: null,
            pendingGender: null,
            pendingAge: null,
            usedItems: toUsedItems(items),
            artStyleHint: null,
            photo: null,
          });
          usePointsStore.getState().fetchBalance(); // 접수 즉시 서버가 ⭐ 차감 → 로딩 중에도 배지 반영
          if (cancelled) return;
          setJobId(newJobId);
          return;
        } else {
          // ── refine: 얼굴/체형 미세조정 (옷 입히기 아님). 기존 /character/refine 흐름 유지 ──
          const currentSheetUrl = taskStore.apiResult?.preview_url || null;
          if (!currentSheetUrl) {
            throw new Error('현재 캐릭터 시트를 찾을 수 없어요. 다시 시도해주세요.');
          }
          const reqText = taskStore.refineRequest || '';
          if (!reqText) throw new Error('요청 내용이 비어있습니다.');

          const effectivePhotoUri = photoUri || currentSheetUrl;
          const effectivePhotoName = photoName || 'sheet.png';

          const form = new FormData();
          await appendFileToForm(form, 'sheet_image', currentSheetUrl, 'sheet.png', 'image/png');
          const photoNameOut = effectivePhotoName || (effectivePhotoUri.split('/').pop() ?? 'photo.jpg');
          await appendFileToForm(form, 'photo', effectivePhotoUri, photoNameOut, inferMimeType(photoNameOut));
          form.append('refine_request', reqText);
          // v217: refine은 character_id(신규 optional Form) 전송이 사실상 필수 —
          // 미전송+image_model 미전송이면 서버가 nb_pro로 폴백해 실사 화풍이 붕괴한다.
          // 신 계약 계정은 대상 cid를 지정하고, 레거시(me) 계정은 cid가 없으므로
          // 기존 image_model echo(gpt_image_2 — refine은 실사 전용)를 안전망으로 유지.
          const refineCid = taskStore.legacyContract ? null : taskStore.targetCharacterId;
          if (refineCid) form.append('character_id', refineCid);
          form.append('image_model', 'gpt_image_2');
          if (__DEV__) console.info('[ArtistLoading] refine 요청', {
            characterId: refineCid, legacyContract: taskStore.legacyContract,
          });

          const res = await api.post('/character/refine', form, {
            // web: 브라우저가 FormData boundary 자동 설정 / RN: 명시 필요
            headers: Platform.OS === 'web' ? {} : { 'Content-Type': 'multipart/form-data' },
            timeout: 600000,
          });
          if (cancelled) return;
          taskStore.completeApi({
            preview_url: characterPreviewUrl(res.data.preview_url),
            object_name: res.data.object_name,
          });
          navigation.replace('ArtistResult');
        }
      } catch (err: any) {
        // v3.227: 서버 409 generation_in_progress(과금 전 차단) — 진행 중 job을 추적기에 편입하고
        // 뷰어로 전환(오류 다이얼로그 없음). 다른 기기·창에서 시작한 생성도 이어서 본다.
        const inProgress = parseGenerationInProgress(err);
        if (inProgress) {
          adoptInProgressJob(inProgress);
          if (cancelled) return;
          console.info('[ArtistLoading] 409 generation_in_progress → 진행 중 job 뷰어', { jobId: inProgress.jobId });
          taskStore.clearMode();
          setJobId(inProgress.jobId);
          return;
        }
        // 응답 없는 실패(네트워크·타임아웃)는 서버가 접수했을 수도 있다 → 회수 목록으로 즉시 확인(무과금 조회)
        if (!err?.response && (mode === 'sheet' || mode === 'outfit')) {
          void refreshRecoverable({ force: true, reason: 'post-error' });
        }
        if (cancelled) return;
        // 백엔드 상세 에러 출력 (422의 경우 detail에 어떤 field가 missing인지 들어있음)
        console.warn('[ArtistLoading] API error:', {
          mode,
          status: err?.response?.status,
          data: err?.response?.data,
          message: err?.message,
        });
        const detail = err.response?.data?.detail;
        // 422 detail은 보통 [{loc, msg, type}] 배열. 펼쳐서 명시적으로 stringify.
        if (Array.isArray(detail)) {
          console.warn('[ArtistLoading] 422 detail (펼침):', JSON.stringify(detail, null, 2));
        }
        const detailStr = Array.isArray(detail)
          ? detail.map((d: any) => `${d.loc?.join('.')}: ${d.msg}`).join('; ')
          : typeof detail === 'string' ? detail : null;
        // v3.76(MAIDOL v158/v139): 별 부족(402)·생성 제한(403) 전용 안내
        const status = err?.response?.status;
        // v3.118: 아티스트 디렉터 피로 429(director_fatigue — 슬롯/⭐ 차감 전 거절, 무과금)
        // → 실패 화면 미진입, Map 복귀 후 동일 휴식 다이얼로그(⭐/광고권 스킵). 입력은
        // store에 보존 — 해제 후 "이어서 만들기"로 재개 (409 슬롯 패턴과 동일 흐름).
        if (status === 429 && err.response?.data?.error === 'director_fatigue') {
          const gateRemain = Math.max(0, Math.floor(err.response?.data?.cooldown_remaining_sec ?? 0));
          console.log('[ArtistLoading] [fatigue:artist] 429 게이트 — 남은', gateRemain, '초 (과금 없음)');
          let fatigueStatus: FatigueStatus | null = null;
          try {
            fatigueStatus = await getFatigueStatus('artist'); // 스킵 비용·광고권 잔량 표시용
          } catch (statusErr: any) {
            console.warn('[ArtistLoading] [fatigue:artist] 상태 조회 실패:', statusErr?.response?.status);
          }
          if (cancelled) return;
          taskStore.failApi('아티스트 디렉터가 쉬는 중이에요. 휴식이 끝나면 "이어서 만들기"로 다시 시도해주세요. 입력한 내용은 유지돼요.');
          navigation.goBack();
          setTimeout(() => {
            showFatigueCooldownDialog({
              status: fatigueStatus,
              remainingSec: Math.max(gateRemain, Math.floor(fatigueStatus?.cooldown_remaining_sec ?? 0)),
              director: 'artist',
              onCleared: () => {
                // 스킵으로 해제 — 아티스트 만들기의 "이어서 만들기"로 재개 안내 (409 확장 흐름과 동일 관행)
                showAlert('휴식 종료', '아티스트 만들기에서 "이어서 만들기"로 다시 시도해주세요. 입력한 내용은 유지돼요.');
              },
            });
          }, 100);
          return;
        }
        // v3.154: 얼굴 인증 필요(403 face_verification_required — ⭐ 차감 전 거절)
        // → 얼굴 인증 화면으로 진입. 인증 완료 시 FaceVerify가 ArtistLoading을 replace해
        // 같은 taskStore 입력으로 생성을 자동 재개한다.
        if (status === 403 && err.response?.data?.error === 'face_verification_required') {
          console.info('[ArtistLoading] 얼굴 인증 필요 — FaceVerify 진입 (무과금)');
          navigation.replace('FaceVerify' as any);
          return;
        }
        // v3.103(B-1): 슬롯 초과(409 slot_limit_exceeded — ⭐ 차감 전 거절) → 확장 제안 다이얼로그
        if (status === 409 && err.response?.data?.error === 'slot_limit_exceeded') {
          const used = err.response?.data?.used;
          const max = err.response?.data?.max;
          const slotMsg = `아티스트 슬롯이 가득 찼어요${typeof used === 'number' && typeof max === 'number' ? ` (${used}/${max})` : ''}. ⭐15로 슬롯을 영구 확장할 수 있어요.`;
          if (__DEV__) console.info('[ArtistLoading] 409 slot_limit_exceeded', { used, max });
          taskStore.failApi(slotMsg);
          navigation.goBack();
          setTimeout(() => {
            showAlert('슬롯이 가득 찼어요', slotMsg, [
              { text: '다음에', style: 'cancel' },
              {
                text: '⭐15로 확장',
                onPress: async () => {
                  try {
                    await spendExtraSlot();
                    usePointsStore.getState().fetchBalance();
                    // v3.105: 입력은 store에 보존됨 — 아티스트 만들기 화면의 "이어서 만들기"로 재개 가능
                    showAlert('확장 완료', '슬롯이 추가됐어요. 아티스트 만들기에서 "이어서 만들기"로 다시 시도해주세요. 입력한 내용은 유지돼요.');
                  } catch (spendErr: any) {
                    if (spendErr?.response?.status === 402) {
                      showAlert('스타(⭐)가 부족해요', '슬롯 확장에는 ⭐15가 필요해요. 출석체크·앱 추천으로 스타를 모아보세요.');
                    } else {
                      showAlert('오류', spendErr?.response?.data?.error || '슬롯 확장에 실패했어요. 잠시 후 다시 시도해주세요.');
                    }
                  }
                },
              },
            ]);
          }, 100);
          return;
        }
        let msg: string;
        if (status === 402) {
          msg = '별이 부족해요. 캐릭터 시트 생성에는 ⭐10개가 필요합니다.';
        } else if (status === 403 && err.response?.data?.error === 'generation_restricted') {
          msg = '신고 누적으로 생성 기능이 일시 제한되었어요. 잠시 후 다시 시도해주세요.';
        } else {
          msg = !err?.response && (mode === 'sheet' || mode === 'outfit')
            ? '연결이 불안정해 요청 결과를 확인하지 못했어요. 이미 접수됐다면 작업실과 내 아티스트에서 이어서 확인할 수 있어요.'
            : err.response?.data?.error || detailStr || err.message || '실패했어요.';
          // v3.227: 접수(POST) 단계 실패에는 환불 문구를 붙이지 않는다 — 접수된 생성은 서버가 끝까지
          // 만들고(성공=환불 없음), 실패 확정 시에만 추적기가 "자동 환불" 안내를 띄운다.
        }
        usePointsStore.getState().fetchBalance(); // 잔액 재확인
        taskStore.failApi(msg);
        navigation.goBack();
        setTimeout(() => {
          showAlert('오류', msg);
        }, 100);
      }
    };
    callApi();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 단계 메시지 3초마다 교체 (LyricsLoading 패턴) ─────────
  useEffect(() => {
    const interval = setInterval(() => {
      setMessageIndex((i) => Math.min(i + 1, stages.length - 1));
    }, 3000);
    return () => clearInterval(interval);
  }, [stages.length]);

  // ── Pulse animation ────────────────────────────────────────
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.1, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, []);

  const currentStage = stages[messageIndex] || stages[0];
  const elapsedMin = tracked ? Math.max(0, Math.floor((nowTick - tracked.startedAt) / 60000)) : 0;

  return (
    <AppScreenLayout scroll={false} insideTab avoidMiniPlayer={false}>
      <View style={styles.content}>
        <Animated.View style={[styles.portraitContainer, { transform: [{ scale: pulseAnim }] }]}>
          <Image source={ARTIST_PORTRAIT} style={styles.portraitImage} />
        </Animated.View>

        <AppText style={styles.loadingText}>{currentStage.message}</AppText>

        <ActivityIndicator size="large" color={colors.accent.primary} style={styles.spinner} />

        {/* 스텝 인디케이터 */}
        <View style={styles.stepRow}>
          {stages.map((s, i) => {
            const state = i < messageIndex ? 'done' : i === messageIndex ? 'active' : 'pending';
            return (
              <View key={s.label} style={styles.stepItem}>
                <View
                  style={[
                    styles.stepDot,
                    state === 'active' && styles.stepDotActive,
                    state === 'done' && styles.stepDotDone,
                  ]}
                >
                  <AppText style={styles.stepDotText}>
                    {state === 'done' ? '✓' : i + 1}
                  </AppText>
                </View>
                <AppText
                  style={[
                    styles.stepLabel,
                    state === 'active' && styles.stepLabelActive,
                    state === 'done' && styles.stepLabelDone,
                  ]}
                  numberOfLines={1}
                >
                  {s.label}
                </AppText>
              </View>
            );
          })}
        </View>

        {isViewer && tracked ? (
          <>
            <View style={styles.noteContainer}>
              <AppText style={styles.noteText}>
                {saveFailed
                  ? '아티스트가 완성됐어요. 저장을 다시 시도해주세요.'
                  : tracked.lastStatus === 'done'
                    ? '아티스트가 완성됐어요. 저장하고 있어요...'
                    : `${elapsedMin >= 5 ? '아직 만드는 중이에요' : `아티스트 디렉터가 ${meta.taskName} 만드는 중이에요`} · 경과 ${elapsedMin}분\n나가도 계속 만들어져요. 완성되면 작업실에서 알려드릴게요.`}
              </AppText>
            </View>
            {saveFailed && (
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={() => {
                  setSaveFailed(false); // 뷰어 effect가 finalize 재시도
                }}
              >
                <AppText style={styles.primaryBtnText}>다시 저장하기</AppText>
              </TouchableOpacity>
            )}
            {(tracked.lastStatus === 'processing' || saveFailed) && (
              <TouchableOpacity
                style={styles.leaveBtn}
                onPress={() => {
                  console.info('[ArtistLoading] 나가서 다른 작업 하기', { jobId });
                  navigation.popTo('Map');
                }}
              >
                <AppText style={styles.leaveBtnText}>나가서 다른 작업 하기</AppText>
              </TouchableOpacity>
            )}
          </>
        ) : (
          <View style={styles.noteContainer}>
            <AppText style={styles.noteText}>
              아티스트 디렉터가 {meta.taskName} 마무리 중이에요.{'\n'}잠시만 기다려주세요...
            </AppText>
          </View>
        )}
      </View>
    </AppScreenLayout>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.deepest },
  content: {
    flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32,
  },
  portraitContainer: {
    width: 120, height: 120, borderRadius: 60, overflow: 'hidden',
    borderWidth: 3, borderColor: colors.accent.primary, marginBottom: 32,
    backgroundColor: colors.bg.surface2,
  },
  // 95x405 전신 → 얼굴 + 목+어깨 살짝 보이게: 1.1x zoom + top 약간 음수
  portraitImage: {
    width: 120 * 1.1,
    height: (120 * 1.1) * 405 / 95,
    position: 'absolute',
    top: -120 / 15,                 // -8: 얼굴 살짝 가운데로
    left: -(120 * 1.1 - 120) / 2,
  },
  loadingText: {
    fontSize: 20, fontWeight: 'bold', color: colors.text.primary,
    marginBottom: 24, textAlign: 'center',
  },
  spinner: { marginBottom: 24 },
  stepRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    width: '100%', marginBottom: 24, paddingHorizontal: 4,
  },
  stepItem: { alignItems: 'center', flex: 1 },
  stepDot: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: colors.bg.surface1, borderWidth: 1.5, borderColor: colors.border.subtle,
    justifyContent: 'center', alignItems: 'center', marginBottom: 4,
  },
  stepDotActive: { backgroundColor: colors.accent.primary, borderColor: colors.accent.primary },
  stepDotDone: { backgroundColor: colors.bg.surface2, borderColor: colors.accent.primary },
  stepDotText: { fontSize: 12, fontWeight: '700', color: colors.text.primary },
  stepLabel: { fontSize: 10, color: colors.text.muted, textAlign: 'center' },
  stepLabelActive: { color: colors.accent.primary, fontWeight: '700' },
  stepLabelDone: { color: colors.text.secondary },
  noteContainer: {
    backgroundColor: colors.bg.surface1, borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: colors.border.subtle,
  },
  noteText: { fontSize: 13, color: colors.text.secondary, textAlign: 'center', lineHeight: 19 },
  // v3.227: 추적 뷰어 — 자유 이탈·저장 재시도
  primaryBtn: {
    marginTop: 16, alignSelf: 'stretch', backgroundColor: colors.accent.primary, borderRadius: 14,
    paddingVertical: 13, alignItems: 'center',
  },
  primaryBtnText: { color: colors.text.primary, fontWeight: '700', fontSize: 14 },
  leaveBtn: {
    marginTop: 12, alignSelf: 'stretch', borderWidth: 1, borderColor: colors.accent.primary, borderRadius: 14,
    paddingVertical: 12, alignItems: 'center',
  },
  leaveBtnText: { color: colors.accent.primary, fontWeight: '700', fontSize: 14 },
});
