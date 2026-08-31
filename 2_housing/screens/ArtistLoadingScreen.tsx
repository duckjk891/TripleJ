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
} from 'react-native';
import { AppText } from '../components/ui';
import { showAlert } from '../utils/appAlert';
// expo-file-system v19+ : 신 API에서는 cacheDirectory/downloadAsync가 빠짐 → legacy 사용
import * as FileSystem from 'expo-file-system/legacy';
import api, { BACKEND_BASE_URL } from '../services/api';
import { spendExtraSlot } from '../services/characterService';
import { useCharacterTaskStore, type CharacterTaskMode } from '../stores/characterTaskStore';
import { useArtistProfileStore } from '../stores/artistProfileStore';
import { useOutfitStore, type AppliedItem } from '../stores/outfitStore';
import { usePointsStore } from '../stores/pointsStore';
import { usePlayerStore } from '../stores/playerStore';
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

// v3.76(MAIDOL 이식): 비동기 생성 잡 폴링 — 5초 간격, 최대 180틱(15분), 연속 오류 3회 허용.
// done → job 데이터 반환, failed/타임아웃 → throw. isCancelled()로 언마운트 시 중단.
async function pollCharacterJob(jobId: string, isCancelled: () => boolean): Promise<any> {
  let consecutiveErrors = 0;
  for (let tick = 0; tick < 180; tick++) {
    await new Promise((r) => setTimeout(r, 5000));
    if (isCancelled()) throw new Error('cancelled');
    try {
      const res = await api.get(`/character/job/${jobId}`);
      consecutiveErrors = 0;
      const status = res.data?.status;
      if (__DEV__ && tick % 6 === 0) console.info('[ArtistLoading] job poll', { jobId, tick, status });
      if (status === 'done') return res.data;
      if (status === 'failed') {
        throw new Error(res.data?.error || '캐릭터 시트 생성에 실패했습니다. 사용된 별은 자동으로 환불됩니다.');
      }
    } catch (err: any) {
      if (err?.message === 'cancelled' || err?.message?.includes('환불')) throw err;
      consecutiveErrors++;
      console.error('[ArtistLoading] job poll 오류', { jobId, tick, consecutiveErrors, message: err?.message });
      if (consecutiveErrors >= 3) throw new Error('생성 상태 확인에 실패했어요. 잠시 후 내 아티스트에서 확인해주세요.');
    }
  }
  throw new Error('생성이 너무 오래 걸려요. 잠시 후 다시 확인해주세요. 실패 시 별은 자동 환불됩니다.');
}

// v3.76: 코디 선택분(상의/하의/신발)을 서버 정식 계약(object_name 필드)으로 전송.
// 기존 방식(이미지 재다운로드 후 top_image 첨부)보다 단순하고 서버가 원본 화질로 처리.
function appendOutfitObjectNames(form: FormData, items: AppliedItem[]) {
  const fieldByCat: Record<string, string> = { 상의: 'top_object_name', 하의: 'bottom_object_name', 신발: 'shoes_object_name' };
  for (const [cat, field] of Object.entries(fieldByCat)) {
    const item = items.find((it) => it.cat === cat && it.imageObjectName);
    if (item?.imageObjectName) form.append(field, item.imageObjectName);
  }
}

// 9004: 백엔드 MinIO에 영구 저장된 이미지(object_name)를 fetch해서 form에 첨부.
// web은 Blob/File, RN은 expo-file-system으로 로컬 캐시에 다운로드 후 file:// uri 첨부.
async function appendMinioImageToForm(
  form: FormData,
  field: string,
  objectName: string,
) {
  const url = `${BACKEND_BASE_URL}/api/character/preview/${objectName}`;
  const ext = (objectName.split('.').pop() || 'jpg').toLowerCase();
  const name = `${field}.${ext}`;
  const mime = inferMimeType(name);

  if (Platform.OS === 'web') {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`fetch ${objectName} 실패: ${r.status}`);
    const blob = await r.blob();
    const file = new File([blob], name, { type: blob.type || mime });
    form.append(field, file);
  } else {
    const localPath = `${FileSystem.cacheDirectory}${field}-${Date.now()}.${ext}`;
    const dl = await FileSystem.downloadAsync(url, localPath);
    form.append(field, { uri: dl.uri, name, type: mime } as any);
  }
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

export default function ArtistLoadingScreen({ navigation }: any) {
  const taskStore = useCharacterTaskStore();
  const mode = taskStore.mode;
  const meta = modeMeta(mode);
  const stages = LOADING_STEPS_BY_MODE[mode ?? 'sheet'];

  const [messageIndex, setMessageIndex] = useState(0);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // v3.105: 작업실 화면은 미니플레이어 숨김 + 백그라운드 재생 유지(대표 방침). blur 시 복원.
  useFocusEffect(
    useCallback(() => {
      usePlayerStore.getState().setMiniHidden(true);
      return () => {
        usePlayerStore.getState().setMiniHidden(false);
      };
    }, [])
  );

  // ── API 호출 (mount 직후 한 번) ──
  useEffect(() => {
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

        if (mode === 'sheet') {
          // ── 신규 캐릭터 시트 생성 — v3.76: 비동기(job) + 텍스트-only 허용(MAIDOL v161) ──
          // v3.80: 가상화(그림) 모드 — cartoon 엔드포인트 + style_preset XOR style_image
          const isVirtual = taskStore.characterKind === 'virtual';
          const hasPhoto = !!photoUri;
          if (!hasPhoto && !(taskStore.userText || '').trim()) throw new Error('사진 또는 컨셉 설명이 필요해요.');
          const form = new FormData();
          const nameFromUri = photoName || (photoUri?.split('/').pop() ?? 'photo.jpg');
          const mime = inferMimeType(nameFromUri);
          if (hasPhoto) {
            await appendFileToForm(form, 'file', photoUri!, nameFromUri, mime);
            // v3.76(MAIDOL v137): 사진 확약 — ArtistInput에서 확인받은 값
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
          if (__DEV__) console.info('[ArtistLoading] generate-sheet 요청', {
            endpoint, hasPhoto, items: items.length, isVirtual,
            stylePreset: taskStore.stylePreset, hasStyleImage: !!taskStore.styleImageUri,
            characterId: targetCid, legacyContract: taskStore.legacyContract,
          });
          const startRes = await api.post(endpoint, form, {
            // web: 브라우저가 FormData boundary 자동 설정 / RN: 명시 필요
            headers: Platform.OS === 'web' ? {} : { 'Content-Type': 'multipart/form-data' },
            timeout: 120000,
          });
          if (cancelled) return;
          usePointsStore.getState().fetchBalance(); // 접수 즉시 서버가 ⭐ 차감 → 로딩 중에도 배지 반영
          const job = await pollCharacterJob(startRes.data?.job_id, () => cancelled);
          if (cancelled) return;
          const res = { data: job } as any;

          // 9004: 원본 사진을 영구 위치에 업로드 (이후 옷 갈아입기 시 재사용) — 사진 경로에서만
          let originalObjectName: string | null = null;
          if (hasPhoto) {
            try {
              const photoForm = new FormData();
              await appendFileToForm(photoForm, 'file', photoUri!, nameFromUri, mime);
              const upRes = await api.post('/character/upload-original-photo', photoForm, {
                // web: 브라우저가 FormData boundary 자동 설정 / RN: 명시 필요
                headers: Platform.OS === 'web' ? {} : { 'Content-Type': 'multipart/form-data' },
                timeout: 60000,
              });
              originalObjectName = upRes.data?.object_name || null;
            } catch (uploadErr) {
              console.warn('[Artist] upload-original-photo 실패:', uploadErr);
            }
          }
          if (cancelled) return;

          // 첫 시트 자동 저장 + used_items + original_photo_object_name 영속화
          const usedItems = items
            .filter((it) => it.imageObjectName)
            .map((it) => ({
              name: it.name,
              image_object_name: it.imageObjectName,
              product_url: it.productUrl,
              category: it.cat,
            }));
          // v3.103(B-1): 신규 생성 시 잡 결과에 character_id가 실려오면 그 cid로 save(갱신).
          // 없으면 kind로 신규 save(구 관행 — 서버 슬롯 검사 409 동일 적용).
          const jobCid: string | null = targetCid || (res.data?.character_id ? String(res.data.character_id) : null);
          let savedCharacterId: string | null = jobCid;
          const pendingGender = useCharacterTaskStore.getState().pendingGender;
          // v3.109: 질문 흐름에서 지은 이름 — save의 name 필드로 서버 영속(v216 계약: save·PATCH 수용)
          const pendingName = useCharacterTaskStore.getState().pendingName;
          try {
            const saveBody: any = {
              sheet_object_name: res.data.object_name,
              used_items: usedItems,
            };
            if (originalObjectName) saveBody.original_photo_object_name = originalObjectName;
            // v3.80: 가상 슬롯 저장 — 서버가 virtual_* 필드만 갱신(실사 무손상).
            // 실사 경로에는 variant를 절대 넣지 않음(기존 페이로드 불변).
            if (isVirtual) {
              saveBody.variant = 'virtual';
              saveBody.art_style = res.data.art_style || (taskStore.styleImageUri ? 'custom' : taskStore.stylePreset);
            }
            if (!taskStore.legacyContract) {
              // 신 계약: character_id=갱신 / kind=신규. 성별도 서버에 영속(서버 우선 — v3.103)
              if (jobCid) saveBody.character_id = jobCid;
              else saveBody.kind = isVirtual ? 'virtual' : 'real';
              if (pendingGender) saveBody.gender = pendingGender;
              // v3.109: 이름 서버 영속 — 스킵(null)이면 미전송 = 서버 기본 명명 로직 유지
              if (pendingName) {
                saveBody.name = pendingName;
                if (__DEV__) console.info('[ArtistLoading] 이름 영속', { name: pendingName });
              }
            }
            // 레거시 계정: character_id·kind 둘 다 미전송 = 구버전 계약(슬롯 면제)
            const saveRes = await api.post('/character/save', saveBody);
            if (saveRes.data?.character_id) savedCharacterId = String(saveRes.data.character_id);
            if (__DEV__) console.info('[ArtistLoading] save 완료', {
              legacyContract: taskStore.legacyContract, jobCid, savedCharacterId,
            });
          } catch (saveErr) {
            console.warn('[Artist] auto-save sheet failed:', saveErr);
          }
          if (cancelled) return;

          // v3.82: 생성 확정 — 성별을 슬롯별 로컬 프로필에 기록.
          // v3.103: 신 계약 계정은 서버 gender가 진실의 원천 → 로컬 기록은 레거시 계정만.
          if (pendingGender && taskStore.legacyContract) {
            if (__DEV__) console.info('[ArtistLoading] 성별 기록(레거시)', { slot: isVirtual ? 'virtual' : 'real', gender: pendingGender });
            useArtistProfileStore.getState().setProfile(isVirtual ? 'virtual' : 'real', { gender: pendingGender });
          }

          taskStore.completeApi({
            preview_url: characterPreviewUrl(res.data.preview_url),
            object_name: res.data.object_name,
          });
          if (originalObjectName) {
            taskStore.setInput({ originalPhotoObjectName: originalObjectName });
          }
          taskStore.clearMode();
          usePointsStore.getState().fetchBalance(); // v3.76: ⭐10 차감 반영
          // v3.103: 저장된 cid를 알면 서버 아티스트 상세로 진입(목소리 연결·삭제 UI 노출)
          // v3.113: 생성/재생성 완료 컨텍스트 표시 — ArtistResult가 [아티스트 저장하기] 버튼 노출
          navigation.replace(
            'ArtistResult',
            savedCharacterId ? { characterId: savedCharacterId, justCreated: true } : { justCreated: true }
          );
        } else if (mode === 'outfit') {
          // ── 9004 옷 입히기 = refine 폐기, generate-sheet 재호출 ──
          // photo는 백엔드 영구 저장본 + 옷 이미지는 코디 선택분(MinIO object_name)에서 fetch
          //  → 텍스트로만 묘사하지 않고 실제 이미지를 모델에 첨부 → 옷 정확도 ↑

          // 1) originalPhotoObjectName 확보 (store 캐시 우선, 없으면 /me)
          let origObjectName = taskStore.originalPhotoObjectName;
          if (!origObjectName) {
            try {
              const meRes = await api.get('/character/me');
              origObjectName = meRes.data?.character?.original_photo_object_name || null;
              if (origObjectName) {
                taskStore.setInput({ originalPhotoObjectName: origObjectName });
              }
            } catch (meErr) {
              console.warn('[Artist] /me 조회 실패:', meErr);
            }
          }
          if (!origObjectName) {
            throw new Error('원본 사진이 없어요. 캐릭터를 다시 만들어주세요.');
          }

          // 2) 코디 선택분 — v3.76: 서버 정식 계약(object_name 필드)으로 전송
          const items: AppliedItem[] = useOutfitStore.getState().items;

          // 3) FormData 구성: photo(원본 영구본) + 옷 object_name
          const form = new FormData();
          await appendMinioImageToForm(form, 'file', origObjectName);
          appendOutfitObjectNames(form, items);
          form.append('user_text', taskStore.outfitDesc || '');
          // v217: image_model 미전송 — generate-sheet-async는 서버가 gpt_image_2 고정(요청값 무시)
          // v3.103(B-1): 코디도 대상 아티스트(cid) 재생성으로 — 미지정이면 신규 생성돼
          // 슬롯을 소모하므로 서버 아티스트에서 진입 시 반드시 character_id 지정.
          const outfitCid = taskStore.legacyContract ? null : taskStore.targetCharacterId;
          if (outfitCid) form.append('character_id', outfitCid);

          if (__DEV__) console.info('[ArtistLoading] outfit generate-sheet-async 요청', {
            items: items.length, characterId: outfitCid, legacyContract: taskStore.legacyContract,
          });
          const startRes = await api.post('/character/generate-sheet-async', form, {
            // web: 브라우저가 FormData boundary 자동 설정 / RN: 명시 필요
            headers: Platform.OS === 'web' ? {} : { 'Content-Type': 'multipart/form-data' },
            timeout: 120000,
          });
          if (cancelled) return;
          usePointsStore.getState().fetchBalance(); // 접수 즉시 서버가 ⭐ 차감 → 로딩 중에도 배지 반영
          const job = await pollCharacterJob(startRes.data?.job_id, () => cancelled);
          if (cancelled) return;
          const res = { data: job } as any;

          // 4) used_items 영구 저장 (UsedItemPayload 형식)
          const usedItems = items
            .filter((it) => it.imageObjectName)
            .map((it) => ({
              name: it.name,
              image_object_name: it.imageObjectName,
              product_url: it.productUrl,
              category: it.cat,
            }));
          // v3.103(B-1): 신 계약이면 대상 cid로 save(갱신) — 잡 결과 cid 폴백
          const outfitSaveCid: string | null =
            outfitCid || (!taskStore.legacyContract && res.data?.character_id ? String(res.data.character_id) : null);
          try {
            const outfitSaveBody: any = {
              sheet_object_name: res.data.object_name,
              used_items: usedItems,
            };
            if (outfitSaveCid) outfitSaveBody.character_id = outfitSaveCid;
            await api.post('/character/save', outfitSaveBody);
          } catch (saveErr) {
            console.warn('[Artist] auto-save outfit failed:', saveErr);
          }
          if (cancelled) return;

          taskStore.completeApi({
            preview_url: characterPreviewUrl(res.data.preview_url),
            object_name: res.data.object_name,
          });
          taskStore.clearMode();
          usePointsStore.getState().fetchBalance(); // v3.76: ⭐ 차감 반영
          navigation.replace('ArtistResult', outfitSaveCid ? { characterId: outfitSaveCid } : undefined);
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
                      showAlert('스타가 부족해요', '슬롯 확장에는 ⭐15가 필요해요. 출석체크·앱 추천으로 스타를 모아보세요.');
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
          msg = err.response?.data?.error || detailStr || err.message || '실패했어요.';
          // 생성 도중 실패는 서버가 별을 자동 환불(비동기 잡 실패 경로)
          if (!msg.includes('환불') && (mode === 'sheet' || mode === 'outfit')) {
            msg += '\n사용된 별은 자동으로 환불됩니다.';
          }
        }
        usePointsStore.getState().fetchBalance(); // 차감/환불 반영
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

        <View style={styles.noteContainer}>
          <AppText style={styles.noteText}>
            아티스트 디렉터가 {meta.taskName} 마무리 중이에요.{'\n'}잠시만 기다려주세요...
          </AppText>
        </View>
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
});
