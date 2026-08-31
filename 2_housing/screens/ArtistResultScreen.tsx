import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  StyleSheet,
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Modal,
  Dimensions,
  StatusBar,
  Animated,
  PanResponder,
  Linking,
  TextInput,
} from 'react-native';
import { AppText } from '../components/ui';
import { showAlert } from '../utils/appAlert';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import api, { BACKEND_BASE_URL } from '../services/api';
import {
  getArtist,
  patchArtist,
  deleteArtist,
  artistSheetUrl,
  type ServerArtist,
} from '../services/characterService';
import { useAuthStore } from '../stores/authStore';
import { useCharacterTaskStore } from '../stores/characterTaskStore';
import { usePlayerStore } from '../stores/playerStore';
import { useOutfitStore } from '../stores/outfitStore';
import { useVoiceStore, artistVoiceLabel } from '../stores/voiceStore';
import ConfirmDialog from '../components/ConfirmDialog';
import { useArtistProfileStore } from '../stores/artistProfileStore';
import { getFatigueStatus } from '../services/fatigueService';
import { showFatigueCooldownDialog } from '../utils/fatigueGate';
import { colors } from '../theme/colors';

export default function ArtistResultScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  // v3.81: MyArtists 목록에서 카드 탭으로 진입하면 해당 슬롯만 표시(탭 UI 없음).
  // 파라미터 없이 진입(생성 완료 직후)하면 characterKind 기준.
  const slotParam: 'real' | 'virtual' | undefined = route?.params?.slot;
  // v3.103(B-1): 서버 다중 아티스트(cid) 진입 — slot 대신 /character/{cid}로 하이드레이션.
  // slot 경로는 레거시(마이그레이션 미실행) 계정 전용으로 유지.
  const characterIdParam: string | undefined = route?.params?.characterId;
  // v3.113: 생성/재생성 완료 직후 진입(ArtistLoading이 전달) — [아티스트 저장하기] 버튼 노출.
  // 목록(MyArtists)에서의 일반 열람에는 이 파라미터가 없어 버튼이 보이지 않는다.
  const justCreated: boolean = !!route?.params?.justCreated;
  const taskStore = useCharacterTaskStore();
  const apiResult = taskStore.apiResult;
  // v3.82: 로컬 프로필(이름·성별) — 서버 /me에 gender가 없어 로컬 persist에서 표시
  const profiles = useArtistProfileStore((s) => s.profiles);
  // 방금 새로 만들거나 코디/미세조정한 시트는 저장 필요. mode === null이면 이미 저장된 상태.
  const isUnsaved = taskStore.mode !== null;
  const outfitItems = useOutfitStore((s) => s.items);
  // v3.84: 아티스트 목소리 (프리셋 XOR 클론 — VoiceManage에서 설정)
  const artistVoice = useVoiceStore((s) => s.artistVoice);

  const [saving, setSaving] = useState(false);
  const [hydrating, setHydrating] = useState(!apiResult); // apiResult가 비어 있으면 서버에서 가져옴
  // v3.113: [아티스트 저장하기](생성 완료 직후 확신용 재저장) — 멱등 save 왕복 상태
  const [manualSaving, setManualSaving] = useState(false);
  const [manualSaved, setManualSaved] = useState(false);

  // ── v3.103(B-1/B-3): 서버 아티스트 모드 상태 ──────────────────────────────
  const [serverArtist, setServerArtist] = useState<ServerArtist | null>(null);
  const [serverSheetUrl, setServerSheetUrl] = useState<string | null>(null); // cache-buster URL은 state에 고정(렌더마다 재생성 금지)
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // B-3: 목소리 연결 — ready 클론 선택 팝업 + 해제 confirm
  const [voicePickerVisible, setVoicePickerVisible] = useState(false);
  const [voiceSaving, setVoiceSaving] = useState(false);
  const [unlinkConfirmVisible, setUnlinkConfirmVisible] = useState(false);
  // 프로필(이름·성별) 편집 — 서버 PATCH (로컬 artistProfileStore와 이중화 금지, 서버 우선)
  const [editVisible, setEditVisible] = useState(false);
  const [editName, setEditName] = useState('');
  const [editGender, setEditGender] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const clones = useVoiceStore((s) => s.clones);
  const clonesLoading = useVoiceStore((s) => s.clonesLoading);
  const [zoomVisible, setZoomVisible] = useState(false);
  // 9004: /me 응답의 original_photo_object_name → 미리보기 URL 캐싱
  const [originalPhotoUrl, setOriginalPhotoUrl] = useState<string | null>(null);
  const [meeName, setMeName] = useState<string>('');
  // 앱 내부 디자인 다이얼로그 (시스템 Alert 대신)
  const [resetConfirmVisible, setResetConfirmVisible] = useState(false);
  const [errorDialog, setErrorDialog] = useState<{ title: string; message: string } | null>(null);
  // v3.105: 재생성(다시 만들기)도 generate-sheet ⭐ 소모 — confirm에 실비용 표기
  const [regenConfirmVisible, setRegenConfirmVisible] = useState(false);
  const [characterCost, setCharacterCost] = useState(10);

  // v3.105: /points/costs 실값 (실패 시 10 폴백) — ArtistCody 관행
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await api.get('/points/costs');
        if (alive && res.data?.costs?.character != null) setCharacterCost(res.data.costs.character);
      } catch (err: any) {
        console.error('[ArtistResult] /points/costs 조회 실패', { status: err?.response?.status });
      }
    })();
    return () => { alive = false; };
  }, []);

  // v3.80: 실사/가상 2슬롯 — /me 하이드레이션에서 각각 보관
  const [realSheet, setRealSheet] = useState<{ objectName: string; url: string } | null>(null);
  const [virtualSheet, setVirtualSheet] = useState<{ objectName: string; url: string; artStyle: string | null } | null>(null);
  // v3.81: 탭 제거 — 표시 슬롯은 slot param(목록 진입) 또는 characterKind(생성 직후)로 결정되는 내부 값
  const [activeSlot, setActiveSlot] = useState<'real' | 'virtual'>(
    slotParam ?? (taskStore.characterKind === 'virtual' ? 'virtual' : 'real')
  );
  const slotInitRef = useRef(false);

  // v3.82: 이 화면에서는 미니플레이어 UI 숨김(오디오 재생은 유지 — playerStore 전역 소유)
  // → bottomArea(꾸미기/저장)가 탭바 바로 위에 고정된다. blur 시 반드시 복원.
  useFocusEffect(
    useCallback(() => {
      usePlayerStore.getState().setMiniHidden(true);
      if (__DEV__) console.info('[ArtistResult] 미니플레이어 숨김(focus)');
      return () => {
        usePlayerStore.getState().setMiniHidden(false);
        if (__DEV__) console.info('[ArtistResult] 미니플레이어 복원(blur)');
      };
    }, [])
  );

  // Tab 헤더 좌측에 ← 버튼 주입.
  // v3.79 UX-1: useLayoutEffect(마운트 기준)이면 VoiceManage 등 다음 화면을 push 해도
  // 주입이 남아 이중 뒤로가기 화살표(탭 헤더 ‹ + 화면 자체 ‹)가 생김 →
  // useFocusEffect 로 전환해 blur 시 정리, 복귀(focus) 시 재주입.
  useFocusEffect(
    useCallback(() => {
      const parent = navigation.getParent();
      if (!parent) return;
      parent.setOptions({
        headerLeft: () => (
          <TouchableOpacity
            // v3.81: 목록(slot param)에서 온 경우 pop으로 복귀(navigate는 목록을 새로 push해
            // 목록↔상세 핑퐁이 생김), 생성 직후는 기존대로 Map으로
            onPress={() => {
              const fromList = !!(slotParam || characterIdParam);
              if (fromList && navigation.canGoBack()) navigation.goBack();
              else navigation.navigate(fromList ? 'MyArtists' : 'Map');
            }}
            style={{ paddingHorizontal: 12, paddingVertical: 6 }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <AppText style={{ fontSize: 26, color: colors.text.primary, fontWeight: '300' }}>‹</AppText>
          </TouchableOpacity>
        ),
      });
      return () => {
        parent.setOptions({ headerLeft: undefined });
      };
    }, [navigation, slotParam, characterIdParam])
  );

  // 화면 포커스마다 /character/me로 최신화
  // 9004: 시트 + 원본 사진 + used_items 모두 백엔드 응답에서 가져옴
  // (apiResult가 이미 있어도 used_items/원본 사진은 stale일 수 있으니 매번 fetch)
  useFocusEffect(
    useCallback(() => {
      if (!user) {
        setHydrating(false);
        return;
      }
      let cancelled = false;

      // ── v3.103(B-1): 서버 아티스트(cid) 모드 — /character/{cid} 하이드레이션 ──
      if (characterIdParam) {
        // 이후 꾸미기/재생성 흐름이 이 아티스트를 갱신하도록 대상 cid 고정(신 계약)
        useCharacterTaskStore.getState().setInput({
          targetCharacterId: characterIdParam,
          legacyContract: false,
        });
        setHydrating(true);
        (async () => {
          try {
            const artist = await getArtist(characterIdParam);
            if (cancelled) return;
            setServerArtist(artist);
            const sheetUrl = artist.sheet_object_name ? artistSheetUrl(artist.sheet_object_name) : (artist.sheet_url || null);
            setServerSheetUrl(sheetUrl);
            // 꾸미기(ArtistCody) 등 하위 흐름이 현재 시트를 베이스로 쓰도록 store에도 반영
            if (sheetUrl && artist.sheet_object_name) {
              useCharacterTaskStore.getState().completeApi({
                preview_url: sheetUrl,
                object_name: artist.sheet_object_name,
              });
            }
            // used_items → outfit store 동기화 (백엔드 = 진실의 원천)
            if (Array.isArray(artist.used_items) && artist.used_items.length > 0) {
              const mapped = artist.used_items.map((it: any) => ({
                cat: it.category || '',
                name: it.name || '',
                productUrl: it.product_url || undefined,
                imageObjectName: it.image_object_name || undefined,
                appliedAt: Date.now(),
              }));
              useOutfitStore.getState().setItems(mapped);
            } else {
              useOutfitStore.getState().clear();
            }
            // B-3 표시용 클론 목록(무해 GET) — 연결 팝업에서 재사용
            useVoiceStore.getState().fetchClones();
          } catch (err: any) {
            console.warn('[ArtistResult] /character/{cid} 조회 실패:', err?.response?.status, err?.message);
            if (!cancelled && err?.response?.status === 404) {
              setErrorDialog({ title: '아티스트 없음', message: '해당 아티스트를 찾을 수 없어요. 목록에서 다시 선택해주세요.' });
            }
          } finally {
            if (!cancelled) setHydrating(false);
          }
        })();
        return () => { cancelled = true; };
      }

      // ── 레거시(slot)/생성 직후 경로 — 기존 /character/me 하이드레이션 유지 ──
      // slot 진입 = 레거시 계정 확정 → 이후 꾸미기 등은 구 계약(me/save)으로
      if (slotParam) {
        useCharacterTaskStore.getState().setInput({ targetCharacterId: null, legacyContract: true });
      }
      const hasCachedSheet = !!useCharacterTaskStore.getState().apiResult;
      setHydrating(!hasCachedSheet);
      (async () => {
        try {
          const res = await api.get('/character/me');
          if (cancelled) return;
          const ch = res.data?.character;
          // v3.116: legacyContract는 in-memory store라 JS 리로드 시 초기값(false)으로
          // 돌아간다(8/31 실사례 — 리로드 후 레거시 계정이 신 계약 save로 갈 뻔).
          // me 응답의 character_id(레거시 doc은 null)로 위험 방향만 재유도:
          // 시트는 있는데 cid가 하나도 없으면 레거시 계정 확정 → 구 계약으로 고정.
          if (!slotParam && ch) {
            const hasCid = !!(ch.character_id || ch.virtual_character_id);
            const hasSheet = !!(ch.sheet_object_name || ch.virtual_sheet_object_name);
            if (!hasCid && hasSheet && !useCharacterTaskStore.getState().legacyContract) {
              if (__DEV__) console.info('[ArtistResult] 레거시 계정 재판정(me.character_id=null) — legacyContract=true 복구');
              useCharacterTaskStore.getState().setInput({ legacyContract: true, targetCharacterId: null });
            }
          }
          // 진단 로그: 어떤 필드가 비어있는지 한눈에
          console.log('[ArtistResult] /me 응답:', {
            sheet: !!ch?.sheet_object_name,
            virtual_sheet: !!ch?.virtual_sheet_object_name,
            virtual_art_style: ch?.virtual_art_style || '(없음)',
            name: ch?.name || '(없음)',
            original_photo: ch?.original_photo_object_name || '(없음)',
            used_items_count: Array.isArray(ch?.used_items) ? ch.used_items.length : 0,
            raw: JSON.stringify(ch),
          });
          // v3.80: 실사·가상 슬롯 각각 보관
          const hasRealSheet = !!ch?.sheet_object_name;
          const hasVirtualSheet = !!ch?.virtual_sheet_object_name;
          setRealSheet(hasRealSheet
            ? {
                objectName: ch.sheet_object_name,
                url: `${BACKEND_BASE_URL}/api/character/preview/${ch.sheet_object_name}?t=${Date.now()}`,
              }
            : null);
          setVirtualSheet(hasVirtualSheet
            ? {
                objectName: ch.virtual_sheet_object_name,
                url: `${BACKEND_BASE_URL}/api/character/preview/${ch.virtual_sheet_object_name}?t=${Date.now()}`,
                artStyle: ch.virtual_art_style || null,
              }
            : null);
          if (!hasRealSheet && !hasVirtualSheet) {
            // 백엔드에 저장된 캐릭터가 없음 (자동저장 실패 또는 v46 이전 캐릭터)
            // mode === null이고 cached apiResult가 있으면 일시적 오류일 수 있어 store는 건드리지 않음
            if (!hasCachedSheet) {
              console.log('[ArtistResult] /me: 저장된 캐릭터 없음');
            }
            return;
          }
          // v3.81: 슬롯 초기 선택 — slot param(목록 진입) 우선, 없으면 방금 생성한 쪽(characterKind)
          if (!slotInitRef.current) {
            slotInitRef.current = true;
            if (slotParam) {
              // param 슬롯이 사라졌으면(레이스) 남은 슬롯으로
              setActiveSlot(
                slotParam === 'virtual'
                  ? (hasVirtualSheet ? 'virtual' : 'real')
                  : (hasRealSheet ? 'real' : 'virtual')
              );
            } else {
              const kind = useCharacterTaskStore.getState().characterKind;
              setActiveSlot(kind === 'virtual' && hasVirtualSheet ? 'virtual' : hasRealSheet ? 'real' : 'virtual');
            }
          } else {
            // 선택 중인 슬롯이 사라졌으면(삭제 등) 남은 슬롯으로 이동
            setActiveSlot((cur) =>
              cur === 'virtual' && !hasVirtualSheet ? 'real'
              : cur === 'real' && !hasRealSheet && hasVirtualSheet ? 'virtual'
              : cur);
          }
          // 시트 URL (cache-buster: RN Image가 같은 URL이면 옛 이미지 보임)
          // v3.81: slot param이 있으면 그 슬롯으로 하이드레이션, 없으면 실사 우선(v3.80 동작)
          if (!hasCachedSheet) {
            const preferVirtual = slotParam ? slotParam === 'virtual' : !hasRealSheet;
            const hydrateObj = preferVirtual && hasVirtualSheet
              ? ch.virtual_sheet_object_name
              : hasRealSheet ? ch.sheet_object_name : ch.virtual_sheet_object_name;
            const url = `${BACKEND_BASE_URL}/api/character/preview/${hydrateObj}?t=${Date.now()}`;
            useCharacterTaskStore.getState().completeApi({
              preview_url: url,
              object_name: hydrateObj,
            });
          }
          // 원본 사진 URL (있으면)
          if (ch.original_photo_object_name) {
            const photoUrl = `${BACKEND_BASE_URL}/api/character/preview/${ch.original_photo_object_name}?t=${Date.now()}`;
            setOriginalPhotoUrl(photoUrl);
            useCharacterTaskStore.getState().setInput({
              originalPhotoObjectName: ch.original_photo_object_name,
            });
          } else {
            setOriginalPhotoUrl(null);
          }
          // 이름 (있으면)
          if (ch.name) setMeName(ch.name);
          // 백엔드 used_items로 outfit store 동기화 (백엔드 = 진실의 원천)
          if (Array.isArray(ch.used_items) && ch.used_items.length > 0) {
            const mapped = ch.used_items.map((it: any) => ({
              cat: it.category || '',
              name: it.name || '',
              productUrl: it.product_url || undefined,
              imageObjectName: it.image_object_name || undefined,
              appliedAt: Date.now(),
            }));
            useOutfitStore.getState().setItems(mapped);
          }
        } catch (err: any) {
          console.warn('[ArtistResult] /me 조회 실패:', err?.response?.status, err?.message);
        } finally {
          if (!cancelled) setHydrating(false);
        }
      })();
      return () => { cancelled = true; };
    }, [user, slotParam, characterIdParam])
  );

  const handleSave = async () => {
    if (!apiResult) return;
    setSaving(true);
    try {
      // v3.80: 방금 생성분이 가상이면 variant/art_style 포함 (실사 페이로드는 불변).
      // outfit/refine은 실사 전용이므로 characterKind 잔존값에 속지 않도록 mode도 확인.
      const isVirtualSave =
        apiResult.object_name === virtualSheet?.objectName ||
        (apiResult.object_name !== realSheet?.objectName &&
          taskStore.characterKind === 'virtual' &&
          taskStore.mode !== 'outfit' && taskStore.mode !== 'refine');
      const saveBody: any = { sheet_object_name: apiResult.object_name };
      if (isVirtualSave) {
        saveBody.variant = 'virtual';
        saveBody.art_style =
          virtualSheet?.artStyle || (taskStore.styleImageUri ? 'custom' : taskStore.stylePreset) || undefined;
      }
      // v3.103(B-1): 신 계약 계정은 character_id(갱신) 또는 kind(신규) 지정 —
      // 레거시 계정은 둘 다 미전송(구버전 계약, 슬롯 면제)
      const st = useCharacterTaskStore.getState();
      if (!st.legacyContract) {
        if (st.targetCharacterId) saveBody.character_id = st.targetCharacterId;
        else saveBody.kind = isVirtualSave ? 'virtual' : 'real';
      }
      if (__DEV__) console.info('[ArtistResult] 수동 저장', {
        isVirtualSave, art_style: saveBody.art_style,
        character_id: saveBody.character_id, kind: saveBody.kind,
      });
      await api.post('/character/save', saveBody);
      showAlert('저장 완료', '아티스트 캐릭터를 저장했어요.', [
        {
          text: '확인',
          onPress: () => {
            taskStore.reset();
            if (navigation.canGoBack()) {
              navigation.popToTop();
            } else {
              navigation.navigate('Map');
            }
          },
        },
      ]);
    } catch (err: any) {
      showAlert('오류', err.response?.data?.error || '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  // ── v3.113: [아티스트 저장하기] — 생성 완료 직후 확신용 재저장(멱등) ─────────
  // 자동 저장(ArtistLoading)은 그대로 유지. 이 버튼은 같은 시트를 서버에 다시
  // save(왕복 성공 확인)해 "저장됐다"는 확신을 준다. 신 계약=character_id 재저장,
  // 레거시(me/save)=구 경로 그대로 재저장. 성공 시 버튼이 "저장 완료"로 비활성 전환.
  const handleManualSave = async () => {
    if (manualSaving || manualSaved) return;
    const st = useCharacterTaskStore.getState();
    const sheetObj = serverArtist?.sheet_object_name || apiResult?.object_name || null;
    if (!sheetObj) {
      console.warn('[ArtistResult] 수동 저장 불가 — 시트 object_name 없음');
      showAlert('저장 실패', '저장할 시트 정보를 찾지 못했어요. 잠시 후 다시 시도해주세요.');
      return;
    }
    setManualSaving(true);
    const saveBody: any = { sheet_object_name: sheetObj };
    if (serverArtist) {
      // 신 계약: cid 지정 재저장 — 서버가 해당 아티스트 문서를 갱신(멱등)
      saveBody.character_id = serverArtist.character_id;
      if (serverArtist.kind === 'virtual') {
        saveBody.variant = 'virtual';
        if (serverArtist.art_style) saveBody.art_style = serverArtist.art_style;
      }
    } else {
      // 레거시(me/save) 계약 — handleSave와 동일한 페이로드 규칙으로 재저장
      const isVirtualSave =
        apiResult?.object_name === virtualSheet?.objectName ||
        (apiResult?.object_name !== realSheet?.objectName &&
          st.characterKind === 'virtual');
      if (isVirtualSave) {
        saveBody.variant = 'virtual';
        saveBody.art_style =
          virtualSheet?.artStyle || (st.styleImageUri ? 'custom' : st.stylePreset) || undefined;
      }
      // 신 계약인데 serverArtist 하이드레이션 전(cid 미전달 케이스)이면 계약 규칙 준수
      if (!st.legacyContract) {
        if (st.targetCharacterId) saveBody.character_id = st.targetCharacterId;
        else saveBody.kind = isVirtualSave ? 'virtual' : 'real';
      }
    }
    if (__DEV__) console.info('[ArtistResult] 수동 재저장 요청', {
      character_id: saveBody.character_id, kind: saveBody.kind, variant: saveBody.variant,
    });
    try {
      await api.post('/character/save', saveBody);
      if (__DEV__) console.info('[ArtistResult] 수동 재저장 완료');
      setManualSaved(true);
    } catch (err: any) {
      console.error('[ArtistResult] 수동 재저장 실패', {
        status: err?.response?.status, data: err?.response?.data, message: err?.message,
      });
      showAlert('저장 실패', err?.response?.data?.error || '저장에 실패했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setManualSaving(false);
    }
  };

  const handleGoCody = () => {
    if (!apiResult) return;
    navigation.replace('ArtistCody');
  };

  const handleResetCharacter = () => {
    setResetConfirmVisible(true);
  };

  const performResetCharacter = async () => {
    setResetConfirmVisible(false);
    console.log('[ArtistResult] 캐릭터 삭제 요청 시작');
    try {
      const res = await api.delete('/character/me');
      console.log('[ArtistResult] 캐릭터 삭제 성공:', res.status);
      taskStore.reset();
      // v3.116.1: reset()은 legacyContract를 유지하므로(계정 속성) 전체 삭제 후엔 명시 초기화.
      // 잔존 true 상태로 빠르게 새로 만들면(판정 API 완료 전) 구 계약 save → 신 목록에 안 잡히는
      // 레이스가 성립(8/31 대표 실사례: 삭제→즉시 재생성→저장했는데 목록 빈 상태).
      useCharacterTaskStore.getState().setInput({ legacyContract: false, targetCharacterId: null });
      useOutfitStore.getState().clear();
      // v3.82: 서버 전체 삭제와 함께 로컬 프로필(이름·성별)도 정리
      useArtistProfileStore.getState().clearAll();
      // v3.116: 삭제 직후 목록의 "아직 아티스트가 없어요"를 "저장이 사라졌다"로 오인한
      // 실사례(8/31 대표 계정) — 전체 삭제 결과임을 앱 내 팝업으로 먼저 알리고 이동한다.
      showAlert('삭제 완료', '아티스트와 코디 기록이 모두 삭제되었어요.\n목록에서 새 아티스트를 만들 수 있어요.', [
        // v3.81: 삭제 후엔 목록으로 (목록이 포커스 시 재로드 → 빈 상태 + 추가 버튼)
        { text: '확인', onPress: () => navigation.navigate('MyArtists') },
      ]);
    } catch (err: any) {
      console.error('[ArtistResult] 캐릭터 삭제 실패:', err?.response?.status, err?.response?.data, err?.message);
      const msg = err.response?.data?.error || err.message || '삭제에 실패했어요.';
      setErrorDialog({ title: '삭제 실패', message: msg });
    }
  };

  // ── v3.103(B-1): 서버 아티스트 개별 삭제 — DELETE /character/{cid} ──────────
  // (DELETE /character/me는 전체 삭제라 여기서 절대 사용 금지. 레거시 계정은
  //  개별 삭제 UI 없이 기존 "캐릭터 다시 만들기"만 유지 — 전체 삭제 위험 회피)
  const performDeleteArtist = async () => {
    setDeleteConfirmVisible(false);
    if (!serverArtist || deleting) return;
    setDeleting(true);
    console.log('[ArtistResult] 아티스트 개별 삭제 요청', { characterId: serverArtist.character_id });
    try {
      await deleteArtist(serverArtist.character_id);
      taskStore.reset();
      useOutfitStore.getState().clear();
      // 목록으로 복귀 — 포커스 시 재로드 (기본 아티스트는 서버가 잔여 중 자동 승계)
      navigation.navigate('MyArtists');
    } catch (err: any) {
      console.error('[ArtistResult] 아티스트 삭제 실패:', err?.response?.status, err?.response?.data, err?.message);
      setErrorDialog({ title: '삭제 실패', message: err?.response?.data?.error || err?.message || '삭제에 실패했어요.' });
    } finally {
      setDeleting(false);
    }
  };

  // v3.103(B-1): 서버 아티스트 재생성 — character_id 지정 진입(같은 kind 강제, 409 방지)
  // v3.105: 진입 전 ⭐ 소모 confirm (재생성도 generate-sheet 과금 대상 — 대표 지적)
  const handleRegenerateServerArtist = () => {
    if (!serverArtist) return;
    setRegenConfirmVisible(true);
  };

  // v3.118: "다시 만들기" confirm 뒤 아티스트 디렉터 휴식(쿨다운) 게이트 (대표 방침:
  // 재생성 시 팝업). 해제되면 입력 화면으로 진입 — 서버 429(슬롯/⭐ 전)가 최종 방어.
  const performRegenerateServerArtist = async () => {
    setRegenConfirmVisible(false);
    if (!serverArtist) return;
    try {
      const fatigueStatus = await getFatigueStatus('artist');
      const remain = Math.max(0, Math.floor(fatigueStatus?.cooldown_remaining_sec ?? 0));
      if (remain > 0) {
        console.log('[ArtistResult] [fatigue:artist] 재생성 게이트 — 남은', remain, '초');
        showFatigueCooldownDialog({
          status: fatigueStatus,
          remainingSec: remain,
          director: 'artist',
          onCleared: () => performRegenerateServerArtist(),
        });
        return;
      }
    } catch (err: any) {
      console.warn('[ArtistResult] [fatigue:artist] 상태 조회 실패:', err?.response?.status, err?.message);
    }
    if (__DEV__) console.info('[ArtistResult] 재생성 진입', { characterId: serverArtist.character_id, kind: serverArtist.kind });
    taskStore.reset();
    navigation.replace('ArtistInput', {
      characterId: serverArtist.character_id,
      forceKind: serverArtist.kind,
    });
  };

  // ── v3.103(B-3): 목소리 연결/변경/해제 — PATCH persona_id ───────────────────
  // persona_id에는 클론의 clone_id를 넣는다(ready 클론만 — 서버 400 가드).
  // 서버가 persona_name/persona_voice_id를 조립하며, 곡 생성 주입은 persona_voice_id(기존 방식 유지).
  const applyPersonaPatch = async (personaId: string, label: string) => {
    if (!serverArtist || voiceSaving) return;
    setVoiceSaving(true);
    if (__DEV__) console.info('[ArtistResult] 목소리 PATCH', { characterId: serverArtist.character_id, personaId: personaId || '(해제)' });
    try {
      const updated = await patchArtist(serverArtist.character_id, { persona_id: personaId });
      setServerArtist(updated);
      setVoicePickerVisible(false);
      showAlert('완료', label);
    } catch (err: any) {
      const status = err?.response?.status;
      showAlert(
        '오류',
        status === 400
          ? '아직 준비되지 않은 목소리예요. 클로닝이 완료(ready)된 목소리만 연결할 수 있어요.'
          : err?.response?.data?.error || '목소리 연결에 실패했어요. 잠시 후 다시 시도해주세요.'
      );
    } finally {
      setVoiceSaving(false);
    }
  };

  const performUnlinkVoice = () => {
    setUnlinkConfirmVisible(false);
    applyPersonaPatch('', '목소리 연결을 해제했어요.');
  };

  const openVoicePicker = () => {
    useVoiceStore.getState().fetchClones();
    setVoicePickerVisible(true);
  };

  // ── v3.103: 프로필(이름·성별) 편집 — 서버 PATCH (서버 = 진실의 원천) ─────────
  const openEditProfile = () => {
    if (!serverArtist) return;
    setEditName(serverArtist.name || '');
    setEditGender(serverArtist.gender || '');
    setEditVisible(true);
  };

  const performSaveProfile = async () => {
    if (!serverArtist || profileSaving) return;
    setProfileSaving(true);
    if (__DEV__) console.info('[ArtistResult] 프로필 PATCH', { characterId: serverArtist.character_id });
    try {
      // 빈 문자열 = 서버 클리어(계약) — 입력 그대로 전송
      const updated = await patchArtist(serverArtist.character_id, {
        name: editName.trim(),
        gender: editGender.trim(),
      });
      setServerArtist(updated);
      setEditVisible(false);
    } catch (err: any) {
      showAlert('오류', err?.response?.data?.error || '프로필 저장에 실패했어요.');
    } finally {
      setProfileSaving(false);
    }
  };

  if (hydrating) {
    return (
      <View style={styles.container}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent.primary} />
        </View>
      </View>
    );
  }

  if (!apiResult && !serverArtist) {
    return (
      <View style={styles.container}>
        <View style={styles.center}>
          <AppText style={styles.emptyTitle}>아직 만든 아티스트가 없어요</AppText>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => navigation.replace('ArtistInput')}
          >
            <AppText style={styles.primaryBtnText}>아티스트 만들러 가기</AppText>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // v3.103(B-1): 서버 아티스트 모드 — cid 문서가 진실의 원천 (레거시 슬롯 상태 미사용)
  const isServerMode = !!serverArtist;
  // v3.80: 슬롯별 표시 — 선택 슬롯 시트 우선, 하이드레이션 전엔 방금 생성분(apiResult) fallback
  const activeSheet = activeSlot === 'virtual' ? virtualSheet : realSheet;
  const displayUrl = isServerMode
    ? (serverSheetUrl || apiResult?.preview_url || '')
    : (activeSheet?.url || apiResult?.preview_url || '');
  const isVirtualTab = isServerMode ? serverArtist!.kind === 'virtual' : activeSlot === 'virtual';
  const bothSlots = !!realSheet && !!virtualSheet;
  // v3.82: kind 배지 대신 이름·성별 — 서버 모드는 서버 name/gender(PATCH로 편집),
  // 레거시는 서버 name 우선 + 로컬 프로필(artistProfileStore) 폴백
  const profile = profiles[activeSlot];
  const displayName = isServerMode
    ? (serverArtist!.name || '이름 없는 아티스트')
    : (meeName || profile?.name || '이름 없는 아티스트');
  const displayGender = isServerMode ? (serverArtist!.gender || null) : (profile?.gender || null);
  // B-3 표시 상태: 연결됨 / 연결 끊김(missing — 클론 삭제됨) / 미연결
  const personaMissing = !!(serverArtist?.persona_id && serverArtist?.persona_status === 'missing');
  const personaConnected = !!(serverArtist?.persona_id && !personaMissing);
  const readyClones = clones.filter((c) => c.status === 'ready' && c.clone_id);

  return (
    <View style={styles.container}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 24 }}>
        <AppText style={styles.title}>
          {isUnsaved
            ? '완성된 아티스트 시트'
            : isServerMode && serverArtist!.name
              ? `내 아티스트 · ${serverArtist!.name}`
              : meeName ? `내 아티스트 · ${meeName}` : '내 아티스트'}
        </AppText>
        <AppText style={styles.subtitle}>
          {isUnsaved
            ? '마음에 드시면 저장하세요. 꾸미기로 옷·악세서리·헤어를 바꿀 수 있어요.'
            : '꾸미기로 옷·악세서리·헤어스타일·염색까지 모두 바꿀 수 있어요.'}
        </AppText>

        {/* v3.82: kind 배지·화풍 라벨 제거 — 이름 · 성별만 표시(성별 미상이면 이름만)
            v3.103: 서버 아티스트는 대표 배지 + [수정](PATCH 프로필 편집) 추가 — kind 라벨은 계속 금지 */}
        <View style={styles.kindRow}>
          <View style={styles.kindBadge}>
            <AppText style={styles.kindBadgeText}>
              {displayGender ? `${displayName} · ${displayGender}` : displayName}
            </AppText>
          </View>
          {isServerMode && serverArtist!.is_default && (
            <View style={styles.defaultBadge}>
              <AppText style={styles.defaultBadgeText}>대표</AppText>
            </View>
          )}
          {isServerMode && (
            <TouchableOpacity style={styles.editProfileBtn} onPress={openEditProfile} activeOpacity={0.7}>
              <AppText style={styles.editProfileBtnText}>수정</AppText>
            </TouchableOpacity>
          )}
        </View>

        {/* 9004: 캐릭터 생성 시 업로드한 원본 사진 표시 — 실사 슬롯 전용 */}
        {!isVirtualTab && originalPhotoUrl && (
          <View style={styles.originalPhotoBox}>
            <View style={{ flex: 1 }}>
              <AppText style={styles.originalPhotoLabel}>내가 올린 사진</AppText>
              <AppText style={styles.originalPhotoSub}>
                이 사진을 바탕으로 캐릭터가 생성됐어요. 꾸미기 시에도 이 사진이 다시 사용돼요.
              </AppText>
            </View>
            <Image source={{ uri: originalPhotoUrl }} style={styles.originalPhotoImg} />
          </View>
        )}

        <TouchableOpacity
          style={styles.previewBox}
          activeOpacity={0.85}
          onPress={() => setZoomVisible(true)}
        >
          <Image source={{ uri: displayUrl }} style={styles.previewImg} />
          <View style={styles.zoomHint}>
            <AppText style={styles.zoomHintText}>탭하여 확대 보기</AppText>
          </View>
        </TouchableOpacity>

        {/* 착용 중인 제품 정보 — 실사 슬롯 전용(코디는 실사만) */}
        {!isVirtualTab && outfitItems.length > 0 && (
          <View style={styles.outfitListBox}>
            <AppText style={styles.outfitListTitle}>착용 중인 제품</AppText>
            {outfitItems.map((it, i) => {
              const optStr = it.options && Object.keys(it.options).length > 0
                ? Object.entries(it.options).map(([k, v]) => `${k}:${v}`).join(' · ')
                : null;
              return (
                <View key={`${it.cat}-${i}`} style={styles.outfitRow}>
                  {it.imageObjectName ? (
                    <Image
                      source={{ uri: `${BACKEND_BASE_URL}/api/character/preview/${it.imageObjectName}` }}
                      style={styles.outfitThumb}
                    />
                  ) : (
                    <View style={[styles.outfitThumb, styles.outfitThumbPh]}>
                      <AppText style={{ fontSize: 18 }}>?</AppText>
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <AppText style={styles.outfitRowCat}>{it.cat}</AppText>
                    <AppText style={styles.outfitRowName} numberOfLines={2}>
                      {it.brand ? `${it.brand} ` : ''}{it.name}
                    </AppText>
                    {optStr ? <AppText style={styles.outfitRowOpt}>{optStr}</AppText> : null}
                  </View>
                  {it.productUrl ? (
                    <TouchableOpacity
                      style={styles.outfitLinkBtn}
                      onPress={() => Linking.openURL(it.productUrl!).catch(() => {
                        showAlert('링크 열기 실패', '브라우저로 열 수 없는 링크예요.');
                      })}
                    >
                      <AppText style={styles.outfitLinkBtnText}>보러가기</AppText>
                    </TouchableOpacity>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}

        {/* v3.103(B-3): 서버 아티스트 목소리 — PATCH persona_id로 클론 연결/변경/해제.
            서버 연결값(persona_*)을 우선 표시. 로컬 프리셋(voiceStore.artistVoice preset)은
            서버 미저장 자산(곡 생성 스타일 태그)이라 미연결일 때만 보조 안내로 노출 — 충돌 없음. */}
        {isServerMode ? (
          <View style={styles.voiceBox}>
            <AppText style={styles.voiceBoxLabel}>목소리</AppText>
            <AppText style={[styles.voiceBoxDesc, personaMissing && styles.voiceBoxDescWarn]}>
              {personaMissing
                ? '연결했던 목소리가 삭제되어 연결이 해제됐어요. 다른 목소리를 다시 연결해주세요.'
                : personaConnected
                  ? `"${serverArtist!.persona_name || '내 목소리'}" 목소리가 연결되어 있어요. 이 아티스트로 곡을 만들 때 이 목소리가 쓰여요.`
                  : artistVoice?.type === 'preset'
                    ? `아직 연결된 목소리가 없어요. (간편 목소리 ${artistVoiceLabel(artistVoice)}는 곡 생성 시 스타일로만 적용돼요)`
                    : '클로닝이 완료된 내 목소리를 이 아티스트에 연결할 수 있어요.'}
            </AppText>
            <View style={styles.voiceBtnRow}>
              <TouchableOpacity
                style={[styles.voiceBtn, { flex: 1 }, voiceSaving && { opacity: 0.5 }]}
                onPress={openVoicePicker}
                disabled={voiceSaving}
                activeOpacity={0.7}
              >
                <AppText style={styles.voiceBtnText}>
                  {personaConnected ? '목소리 변경' : personaMissing ? '다시 연결하기' : '목소리 연결'}
                </AppText>
              </TouchableOpacity>
              {(personaConnected || personaMissing) && (
                <TouchableOpacity
                  style={[styles.voiceUnlinkBtn, voiceSaving && { opacity: 0.5 }]}
                  onPress={() => setUnlinkConfirmVisible(true)}
                  disabled={voiceSaving}
                  activeOpacity={0.7}
                >
                  <AppText style={styles.voiceUnlinkBtnText}>해제</AppText>
                </TouchableOpacity>
              )}
            </View>
          </View>
        ) : (
          /* v3.84: (레거시/생성 직후) 아티스트 목소리 — 간편(프리셋)/내 목소리(클론)/미설정 3분기 표기 */
          <View style={styles.voiceBox}>
            <AppText style={styles.voiceBoxLabel}>아티스트 목소리</AppText>
            <AppText style={styles.voiceBoxDesc}>
              {artistVoice?.type === 'preset'
                ? `간편 목소리(${artistVoiceLabel(artistVoice)})가 설정되어 있어요. 곡을 만들 때 이 스타일이 적용돼요.`
                : artistVoice?.type === 'clone'
                  ? `"${artistVoice.name}" 목소리가 연결되어 있어요. 작곡 시 기본으로 제안됩니다.`
                  : '간편 목소리(스타일 프리셋)를 고르거나 내 목소리를 클로닝해 아티스트에 연결해보세요.'}
            </AppText>
            <TouchableOpacity
              style={styles.voiceBtn}
              onPress={() => navigation.navigate('VoiceManage', { select: 'artist' })}
              activeOpacity={0.7}
            >
              <AppText style={styles.voiceBtnText}>
                {artistVoice?.type === 'preset'
                  ? `간편 목소리: ${artistVoiceLabel(artistVoice)}`
                  : artistVoice?.type === 'clone'
                    ? `내 목소리: ${artistVoice.name}`
                    : '목소리 설정'}
              </AppText>
            </TouchableOpacity>
          </View>
        )}

        {isServerMode ? (
          <>
            {/* v3.103(B-1): 재생성 — character_id 지정 진입(기존 아티스트 갱신, 슬롯 미소모) */}
            <View style={styles.resetBox}>
              <AppText style={styles.resetBoxLabel}>처음부터 다시 만들고 싶나요?</AppText>
              <AppText style={styles.resetBoxDesc}>
                이 아티스트의 시트를 처음부터 다시 만듭니다. (프로필·목소리 연결은 유지돼요)
              </AppText>
              <TouchableOpacity style={styles.resetBtn} onPress={handleRegenerateServerArtist} activeOpacity={0.7}>
                <AppText style={styles.resetBtnText}>다시 만들기</AppText>
              </TouchableOpacity>
            </View>
            {/* v3.103(B-1): 개별 삭제 — DELETE /character/{cid} (기본이면 잔여 중 자동 승계) */}
            <View style={[styles.resetBox, { marginTop: 12 }]}>
              <AppText style={styles.resetBoxLabel}>아티스트 삭제</AppText>
              <AppText style={styles.resetBoxDesc}>
                이 아티스트만 삭제합니다. 다른 아티스트는 그대로 남아요.
              </AppText>
              <TouchableOpacity
                style={[styles.resetBtn, deleting && { opacity: 0.5 }]}
                onPress={() => setDeleteConfirmVisible(true)}
                disabled={deleting}
                activeOpacity={0.7}
              >
                <AppText style={styles.resetBtnText}>{deleting ? '삭제 중...' : '이 아티스트 삭제'}</AppText>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          /* v3.82: (레거시) 캐릭터 다시 만들기 — DELETE /character/me(전체 삭제) 후 재생성.
             레거시 계정은 개별 삭제 API가 없어 이 진입점만 유지 */
          <View style={styles.resetBox}>
            <AppText style={styles.resetBoxLabel}>처음부터 다시 만들고 싶나요?</AppText>
            <AppText style={styles.resetBoxDesc}>
              아티스트를 삭제하고 처음부터 다시 만듭니다. (현재 아티스트와 코디 기록은 모두 삭제돼요)
            </AppText>
            <TouchableOpacity style={styles.resetBtn} onPress={handleResetCharacter} activeOpacity={0.7}>
              <AppText style={styles.resetBtnText}>캐릭터 다시 만들기</AppText>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* v3.82: 미니플레이어를 숨기므로 bottomLift 제거 — bottomArea는 탭바 바로 위 고정.
          저장된 가상 슬롯은 남는 버튼이 없어(꾸미기=실사 전용) bottomArea 자체를 숨김.
          v3.113: 생성 완료 직후(justCreated)는 가상이라도 [아티스트 저장하기]가 있어 표시 */}
      {(isUnsaved || !isVirtualTab || justCreated) && (
      <View style={styles.bottomArea}>
        {isUnsaved ? (
          <View style={styles.btnRow}>
            {/* v3.80: 꾸미기(outfit)는 실사 전용 — 가상 슬롯에서는 숨김 */}
            {!isVirtualTab && (
              <TouchableOpacity style={styles.skipBtn} onPress={handleGoCody}>
                <AppText style={styles.skipBtnText}>꾸미기</AppText>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.applyBtn, saving && { opacity: 0.5 }]}
              onPress={handleSave}
              disabled={saving}
            >
              <AppText style={styles.applyBtnText}>{saving ? '저장 중...' : '저장'}</AppText>
            </TouchableOpacity>
          </View>
        ) : justCreated ? (
          /* v3.113: 생성 완료 직후 — 주요 버튼 [아티스트 저장하기](멱등 재저장).
             성공 시 "저장 완료" 비활성 + 확인 문구. 실패 시 showAlert 후 재시도 가능. */
          <View>
            {manualSaved && (
              <AppText style={styles.savedNotice}>아티스트가 저장되었어요</AppText>
            )}
            <View style={styles.btnRow}>
              {!isVirtualTab && (
                <TouchableOpacity style={styles.skipBtn} onPress={handleGoCody}>
                  <AppText style={styles.skipBtnText}>꾸미기</AppText>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.applyBtn, (manualSaving || manualSaved) && { opacity: 0.55 }]}
                onPress={handleManualSave}
                disabled={manualSaving || manualSaved}
              >
                <AppText style={styles.applyBtnText}>
                  {manualSaving ? '저장 중...' : manualSaved ? '저장 완료' : '아티스트 저장하기'}
                </AppText>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.btnRow}>
            {/* v3.82: [🗑 삭제] 제거 — "캐릭터 다시 만들기"(스크롤 끝)와 동일 기능(DELETE /character/me) 중복 */}
            <TouchableOpacity
              style={[styles.applyBtn, { justifyContent: 'center', minHeight: 44 }]}
              onPress={handleGoCody}
            >
              <AppText
                style={[
                  styles.applyBtnText,
                  { textAlign: 'center', lineHeight: 16, includeFontPadding: false as any },
                ]}
              >
                아티스트 꾸미기
              </AppText>
            </TouchableOpacity>
          </View>
        )}
      </View>
      )}

      {/* 시트 확대 보기 — pinch zoom + pan */}
      <ZoomModal
        visible={zoomVisible}
        uri={displayUrl}
        onClose={() => setZoomVisible(false)}
      />

      {/* v3.105: 서버 아티스트 재생성 confirm — ⭐ 소모 명시 */}
      <ConfirmDialog
        visible={regenConfirmVisible}
        title="다시 만들기"
        message={`이 아티스트의 시트를 처음부터 다시 만듭니다. (프로필·목소리 연결은 유지돼요)\n생성 시 ⭐${characterCost}이 소모돼요.`}
        confirmText="다시 만들기"
        onConfirm={performRegenerateServerArtist}
        onCancel={() => setRegenConfirmVisible(false)}
      />

      {/* 캐릭터 삭제 confirm */}
      <ConfirmDialog
        visible={resetConfirmVisible}
        title="캐릭터 다시 만들기"
        message={
          (bothSlots
            ? '서버 제약으로 현재는 모든 아티스트가 함께 삭제됩니다(개별 삭제는 준비 중이에요). 모든 코디 기록도 함께 삭제돼요.'
            : '현재 아티스트와 모든 코디 기록이 삭제됩니다. 새로운 아티스트를 처음부터 만들 수 있어요.'
          ) + `\n새로 만들 때 ⭐${characterCost}이 소모돼요. 진행할까요?`
        }
        confirmText="삭제하고 다시 만들기"
        destructive
        onConfirm={performResetCharacter}
        onCancel={() => setResetConfirmVisible(false)}
      />

      {/* v3.103(B-1): 서버 아티스트 개별 삭제 confirm */}
      <ConfirmDialog
        visible={deleteConfirmVisible}
        title="아티스트 삭제"
        message={`"${displayName}"을(를) 삭제할까요? 이 아티스트만 삭제되고 다른 아티스트는 유지돼요.`}
        confirmText="삭제하기"
        destructive
        onConfirm={performDeleteArtist}
        onCancel={() => setDeleteConfirmVisible(false)}
      />

      {/* v3.103(B-3): 목소리 연결 해제 confirm */}
      <ConfirmDialog
        visible={unlinkConfirmVisible}
        title="목소리 연결 해제"
        message="이 아티스트에서 목소리 연결을 해제할까요? 목소리 자산은 삭제되지 않아요."
        confirmText="해제하기"
        destructive
        onConfirm={performUnlinkVoice}
        onCancel={() => setUnlinkConfirmVisible(false)}
      />

      {/* v3.103(B-3): ready 클론 선택 팝업 — voiceStore.clones 재사용 (앱 내 다이얼로그) */}
      <Modal
        visible={voicePickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setVoicePickerVisible(false)}
      >
        <View style={styles.pickerBackdrop}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setVoicePickerVisible(false)}
          />
          <View style={styles.pickerBox}>
            <AppText style={styles.pickerTitle}>목소리 연결</AppText>
            <AppText style={styles.pickerDesc}>
              클로닝이 완료된 목소리만 연결할 수 있어요.
            </AppText>
            {clonesLoading ? (
              <View style={{ paddingVertical: 20, alignItems: 'center' }}>
                <ActivityIndicator size="small" color={colors.accent.primary} />
              </View>
            ) : readyClones.length === 0 ? (
              <View style={{ paddingVertical: 8 }}>
                <AppText style={styles.pickerEmptyText}>
                  아직 완료된 목소리가 없어요. 내 목소리를 먼저 클로닝해보세요.
                </AppText>
                <TouchableOpacity
                  style={styles.pickerGoBtn}
                  onPress={() => {
                    setVoicePickerVisible(false);
                    navigation.navigate('VoiceManage');
                  }}
                  activeOpacity={0.7}
                >
                  <AppText style={styles.pickerGoBtnText}>목소리 만들러 가기</AppText>
                </TouchableOpacity>
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 300 }}>
                {readyClones.map((c) => {
                  const isCurrent = serverArtist?.persona_id === c.clone_id;
                  return (
                    <TouchableOpacity
                      key={c.clone_id}
                      style={[styles.pickerRow, isCurrent && styles.pickerRowActive]}
                      disabled={voiceSaving || isCurrent}
                      onPress={() => applyPersonaPatch(c.clone_id, `"${c.voice_name || '내 목소리'}" 목소리를 연결했어요.`)}
                      activeOpacity={0.7}
                    >
                      <View style={{ flex: 1 }}>
                        <AppText style={styles.pickerRowName} numberOfLines={1}>
                          {c.voice_name || '이름 없는 목소리'}
                        </AppText>
                        {!!c.description && (
                          <AppText style={styles.pickerRowDesc} numberOfLines={1}>{c.description}</AppText>
                        )}
                      </View>
                      {isCurrent && <AppText style={styles.pickerRowCurrent}>연결됨</AppText>}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
            <TouchableOpacity
              style={styles.pickerCloseBtn}
              onPress={() => setVoicePickerVisible(false)}
              activeOpacity={0.7}
            >
              <AppText style={styles.pickerCloseBtnText}>닫기</AppText>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* v3.103: 프로필(이름·성별) 편집 — PATCH /character/{cid} (앱 내 다이얼로그) */}
      <Modal
        visible={editVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setEditVisible(false)}
      >
        <View style={styles.pickerBackdrop}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setEditVisible(false)}
          />
          <View style={styles.pickerBox}>
            <AppText style={styles.pickerTitle}>프로필 수정</AppText>
            <AppText style={styles.editFieldLabel}>이름</AppText>
            <TextInput
              style={styles.editInput}
              value={editName}
              onChangeText={setEditName}
              placeholder="아티스트 이름"
              placeholderTextColor={colors.text.muted}
            />
            <AppText style={styles.editFieldLabel}>성별</AppText>
            <View style={styles.editChipRow}>
              {['남성', '여성'].map((g) => (
                <TouchableOpacity
                  key={g}
                  style={[styles.editChip, editGender === g && styles.editChipSelected]}
                  onPress={() => setEditGender(g)}
                  activeOpacity={0.7}
                >
                  <AppText style={[styles.editChipText, editGender === g && styles.editChipTextSelected]}>
                    {g}
                  </AppText>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={styles.editInput}
              value={editGender}
              onChangeText={setEditGender}
              placeholder="직접 입력 (비우면 성별 표시 안 함)"
              placeholderTextColor={colors.text.muted}
            />
            <View style={styles.editBtnRow}>
              <TouchableOpacity
                style={styles.pickerCloseBtn}
                onPress={() => setEditVisible(false)}
                activeOpacity={0.7}
              >
                <AppText style={styles.pickerCloseBtnText}>취소</AppText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.editSaveBtn, profileSaving && { opacity: 0.5 }]}
                onPress={performSaveProfile}
                disabled={profileSaving}
                activeOpacity={0.7}
              >
                <AppText style={styles.editSaveBtnText}>{profileSaving ? '저장 중...' : '저장'}</AppText>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 에러 알림 (단일 확인 버튼) */}
      <ConfirmDialog
        visible={!!errorDialog}
        title={errorDialog?.title || ''}
        message={errorDialog?.message || ''}
        confirmText="확인"
        cancelText={null}
        onConfirm={() => setErrorDialog(null)}
      />
    </View>
  );
}

// ── 풀스크린 시트 뷰어 (+/- 버튼 + 탭으로 위치 잡기 + 드래그 이동) ──────────────
// web/native 모두 자연스럽게 작동하도록 단순화: gesture pinch 대신 버튼 기반.
function ZoomModal({
  visible,
  uri,
  onClose,
}: {
  visible: boolean;
  uri: string;
  onClose: () => void;
}) {
  const { width: screenW, height: screenH } = Dimensions.get('window');

  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;

  // 누적 값 (animation/gesture release 시 저장)
  const lastScale = useRef(1);
  const lastTx = useRef(0);
  const lastTy = useRef(0);

  // 단계별 scale (+/- 버튼)
  const SCALE_STEPS = [1, 1.5, 2, 3, 4, 5];

  const animateTo = (s: number, tx: number, ty: number) => {
    Animated.parallel([
      Animated.spring(scale, { toValue: s, useNativeDriver: true, friction: 8 }),
      Animated.spring(translateX, { toValue: tx, useNativeDriver: true, friction: 8 }),
      Animated.spring(translateY, { toValue: ty, useNativeDriver: true, friction: 8 }),
    ]).start();
    lastScale.current = s;
    lastTx.current = tx;
    lastTy.current = ty;
  };

  const reset = () => animateTo(1, 0, 0);

  const zoomIn = () => {
    const next = SCALE_STEPS.find((s) => s > lastScale.current + 0.001) ?? SCALE_STEPS[SCALE_STEPS.length - 1];
    animateTo(next, lastTx.current, lastTy.current);
  };
  const zoomOut = () => {
    const prev = [...SCALE_STEPS].reverse().find((s) => s < lastScale.current - 0.001) ?? 1;
    // scale 1로 가면 위치도 초기화
    if (prev === 1) {
      animateTo(1, 0, 0);
    } else {
      animateTo(prev, lastTx.current, lastTy.current);
    }
  };

  // 이미지 탭 → 그 위치를 화면 중앙으로 이동 (현재 scale 유지, 1배일 때는 2.5배로 확대)
  const handleImageTap = (evt: any) => {
    const { locationX, locationY } = evt.nativeEvent;
    // locationX/Y는 이미지 컨테이너 기준 (이미 transform 적용된 좌표)
    // 화면 중앙으로 이동시키려면 컨테이너 중심 기준 offset만큼 반대로 이동
    const cx = screenW / 2;
    const cy = screenH / 2;
    // 현재 transform 상태에서의 탭 위치를 "원본 좌표"로 역변환
    const origX = (locationX - lastTx.current) / lastScale.current;
    const origY = (locationY - lastTy.current) / lastScale.current;
    // 1배 상태면 2.5배로 확대하면서, 아니면 현재 scale 유지하면서 위치만 이동
    const newScale = lastScale.current < 1.1 ? 2.5 : lastScale.current;
    // 탭한 원본 좌표가 화면 중심에 오도록: tx = cx - origX * newScale
    const newTx = cx - origX * newScale;
    const newTy = cy - origY * newScale;
    animateTo(newScale, newTx, newTy);
  };

  // 드래그 이동 (확대 상태에서만 활성)
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_evt, gs) =>
        lastScale.current > 1 && (Math.abs(gs.dx) > 5 || Math.abs(gs.dy) > 5),
      onPanResponderMove: (_evt, gs) => {
        translateX.setValue(lastTx.current + gs.dx);
        translateY.setValue(lastTy.current + gs.dy);
      },
      onPanResponderRelease: () => {
        translateX.stopAnimation((v) => { lastTx.current = v; });
        translateY.stopAnimation((v) => { lastTy.current = v; });
      },
    })
  ).current;

  // 모달 닫힐 때 초기화
  useEffect(() => {
    if (!visible) {
      scale.setValue(1);
      translateX.setValue(0);
      translateY.setValue(0);
      lastScale.current = 1;
      lastTx.current = 0;
      lastTy.current = 0;
    }
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <StatusBar hidden />
      <View style={styles.zoomOverlay}>
        {/* 이미지 레이어: 탭 → 위치 잡기 + 확대 / 드래그 → 이동 */}
        <View style={StyleSheet.absoluteFill} {...panResponder.panHandlers}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={handleImageTap}
          >
            <Animated.Image
              source={{ uri }}
              style={{
                width: screenW,
                height: screenH,
                resizeMode: 'contain',
                transform: [
                  { translateX },
                  { translateY },
                  { scale },
                ],
              }}
            />
          </TouchableOpacity>
        </View>

        {/* 상단 좌측: +/- 버튼 */}
        <View style={styles.zoomCtrlGroup}>
          <TouchableOpacity style={styles.zoomCtrlBtn} onPress={zoomIn} activeOpacity={0.7}>
            <AppText style={styles.zoomCtrlText}>＋</AppText>
          </TouchableOpacity>
          <TouchableOpacity style={styles.zoomCtrlBtn} onPress={zoomOut} activeOpacity={0.7}>
            <AppText style={styles.zoomCtrlText}>－</AppText>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.zoomCtrlBtn, styles.zoomCtrlBtnWide]} onPress={reset} activeOpacity={0.7}>
            <AppText style={styles.zoomCtrlTextSmall}>↺</AppText>
          </TouchableOpacity>
        </View>

        {/* 상단 우측: 닫기 */}
        <TouchableOpacity style={styles.zoomCloseBtn} onPress={onClose} activeOpacity={0.7}>
          <AppText style={styles.zoomCloseText}>✕</AppText>
        </TouchableOpacity>

        {/* 하단 힌트 */}
        <View style={styles.zoomBottomHint}>
          <AppText style={styles.zoomBottomHintText}>
            +/− 확대·축소  ·  이미지 탭 → 그 위치 자세히 보기  ·  드래그로 이동
          </AppText>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.deepest },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  emptyTitle: { color: colors.text.primary, fontSize: 16, fontWeight: '700', marginBottom: 16, textAlign: 'center' },

  title: { color: colors.text.primary, fontSize: 18, fontWeight: '700', marginBottom: 4 },
  subtitle: { color: colors.text.secondary, fontSize: 13, marginBottom: 16, lineHeight: 19 },

  // v3.81: 카드 상단 kind 배지 (탭 대체) — v3.103: 대표 배지 + 수정 버튼 추가
  kindRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 6 },
  defaultBadge: {
    backgroundColor: colors.accent.primary, borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  defaultBadgeText: { color: colors.text.primary, fontSize: 10, fontWeight: '700' },
  editProfileBtn: {
    marginLeft: 'auto', paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 10, borderWidth: 1, borderColor: colors.border.subtle,
    backgroundColor: colors.bg.surface1,
  },
  editProfileBtnText: { color: colors.text.secondary, fontSize: 11, fontWeight: '700' },
  kindBadge: {
    backgroundColor: colors.bg.surface2, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: colors.accent.primary,
  },
  kindBadgeText: { color: colors.accent.primary, fontSize: 12, fontWeight: '700' },

  previewBox: {
    alignItems: 'center', padding: 12, marginBottom: 16,
    backgroundColor: colors.bg.surface1, borderRadius: 16,
    borderWidth: 1, borderColor: colors.accent.primary,
  },
  previewImg: { width: 280, height: 280, borderRadius: 12 },
  zoomHint: {
    position: 'absolute', bottom: 18, right: 18,
    backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 12,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  zoomHintText: { color: '#fff', fontSize: 11, fontWeight: '600' },

  zoomOverlay: { flex: 1, backgroundColor: '#000' },
  zoomCloseBtn: {
    position: 'absolute', top: 50, right: 20,
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center', alignItems: 'center',
    zIndex: 10, elevation: 10,
  },
  zoomCloseText: { color: '#fff', fontSize: 22, fontWeight: '600' },
  // +/- 컨트롤 그룹 (상단 좌측)
  zoomCtrlGroup: {
    position: 'absolute', top: 50, left: 20,
    flexDirection: 'row', gap: 8,
    zIndex: 10, elevation: 10,
  },
  zoomCtrlBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center', alignItems: 'center',
  },
  zoomCtrlBtnWide: { width: 44 },
  zoomCtrlText: { color: '#fff', fontSize: 22, fontWeight: '600', lineHeight: 24 },
  zoomCtrlTextSmall: { color: '#fff', fontSize: 18, fontWeight: '600' },
  zoomBottomHint: {
    position: 'absolute', bottom: 40, left: 0, right: 0,
    alignItems: 'center',
  },
  zoomBottomHintText: {
    color: 'rgba(255,255,255,0.8)', fontSize: 12,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16,
  },

  refineBox: { marginBottom: 16 },
  refineLabel: { color: colors.text.secondary, fontSize: 12, fontWeight: '700', marginBottom: 6 },
  textInput: {
    backgroundColor: colors.bg.surface1, borderWidth: 1, borderColor: colors.border.subtle,
    borderRadius: 12, padding: 12, color: colors.text.primary,
    fontSize: 14, minHeight: 60, maxHeight: 140, marginBottom: 8,
  },
  refineBtn: {
    paddingVertical: 12, borderRadius: 12, alignItems: 'center',
    backgroundColor: colors.bg.surface2, borderWidth: 1, borderColor: colors.accent.primary,
  },
  refineBtnText: { color: colors.accent.primary, fontSize: 13, fontWeight: '700' },

  bottomArea: {
    padding: 14, borderTopWidth: 1, borderTopColor: colors.bg.surface1,
    backgroundColor: colors.bg.deepest,
  },
  btnRow: { flexDirection: 'row', gap: 8 },
  // v3.113: 저장 완료 확인 문구 ([아티스트 저장하기] 성공 시)
  savedNotice: {
    color: colors.accent.primary, fontSize: 12, fontWeight: '700',
    textAlign: 'center', marginBottom: 8,
  },
  skipBtn: {
    flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center',
    backgroundColor: colors.bg.surface2, borderWidth: 1, borderColor: colors.border.subtle,
  },
  skipBtnText: { color: colors.text.secondary, fontSize: 13, fontWeight: '600' },
  applyBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center',
    backgroundColor: colors.accent.primary,
  },
  applyBtnText: {
    color: colors.text.primary, fontSize: 13, fontWeight: '700',
    lineHeight: 18,
  },

  primaryBtn: {
    backgroundColor: colors.accent.primary, borderRadius: 14,
    paddingVertical: 14, paddingHorizontal: 28, alignItems: 'center',
  },
  primaryBtnText: { color: colors.text.primary, fontWeight: '700', fontSize: 15 },

  originalPhotoBox: {
    flexDirection: 'row', alignItems: 'center',
    padding: 12, marginBottom: 12, borderRadius: 12,
    backgroundColor: colors.bg.surface1,
    borderWidth: 1, borderColor: colors.border.subtle,
    gap: 12,
  },
  originalPhotoLabel: {
    fontSize: 12, fontWeight: '700', color: colors.accent.primary,
    marginBottom: 4, letterSpacing: 0.3,
  },
  originalPhotoSub: {
    fontSize: 11, color: colors.text.muted, lineHeight: 15,
  },
  originalPhotoImg: {
    width: 72, height: 96, borderRadius: 8,
    backgroundColor: colors.bg.surface2,
  },

  outfitListBox: {
    marginTop: 4, padding: 12, borderRadius: 12,
    backgroundColor: colors.bg.surface1,
    borderWidth: 1, borderColor: colors.border.subtle,
  },
  outfitThumb: {
    width: 48, height: 48, borderRadius: 8,
    backgroundColor: colors.bg.surface2,
    marginRight: 10,
  },
  outfitThumbPh: {
    justifyContent: 'center', alignItems: 'center',
  },
  outfitListTitle: {
    color: colors.text.secondary, fontSize: 12, fontWeight: '700',
    marginBottom: 10, letterSpacing: 0.3,
  },
  outfitRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border.subtle,
  },
  outfitRowCat: {
    fontSize: 11, color: colors.accent.primary, fontWeight: '700',
    marginBottom: 2, letterSpacing: 0.3,
  },
  outfitRowName: { fontSize: 13, color: colors.text.primary, fontWeight: '600' },
  outfitRowOpt: { fontSize: 11, color: colors.text.muted, marginTop: 2 },
  outfitLinkBtn: {
    backgroundColor: colors.bg.surface2,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10,
    borderWidth: 1, borderColor: colors.accent.primary,
    marginLeft: 8,
  },
  outfitLinkBtnText: { fontSize: 11, color: colors.accent.primary, fontWeight: '700' },

  voiceBox: {
    marginTop: 16, padding: 14, borderRadius: 12,
    backgroundColor: colors.bg.surface1,
    borderWidth: 1, borderColor: colors.border.subtle,
  },
  voiceBoxLabel: {
    color: colors.text.primary, fontSize: 13, fontWeight: '700',
    marginBottom: 4,
  },
  voiceBoxDesc: {
    color: colors.text.muted, fontSize: 11, lineHeight: 16,
    marginBottom: 10,
  },
  voiceBtn: {
    paddingVertical: 11, borderRadius: 10, alignItems: 'center',
    backgroundColor: colors.bg.surface2,
    borderWidth: 1, borderColor: colors.accent.primary,
  },
  voiceBtnText: { color: colors.accent.primary, fontSize: 13, fontWeight: '700' },
  // v3.103(B-3): 연결/해제 버튼 행 + 경고 문구
  voiceBoxDescWarn: { color: '#cc8844' },
  voiceBtnRow: { flexDirection: 'row', gap: 8 },
  voiceUnlinkBtn: {
    paddingVertical: 11, paddingHorizontal: 16, borderRadius: 10, alignItems: 'center',
    borderWidth: 1, borderColor: '#a04444',
  },
  voiceUnlinkBtnText: { color: '#cc6868', fontSize: 13, fontWeight: '700' },

  // v3.103: 클론 선택/프로필 편집 팝업 (앱 내 다이얼로그 — ConfirmDialog 톤 준수)
  pickerBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  pickerBox: {
    alignSelf: 'stretch', backgroundColor: colors.bg.surface1, borderRadius: 16,
    borderWidth: 1, borderColor: colors.border.subtle, padding: 18,
  },
  pickerTitle: { color: colors.text.primary, fontSize: 16, fontWeight: '700', marginBottom: 6 },
  pickerDesc: { color: colors.text.muted, fontSize: 12, lineHeight: 17, marginBottom: 12 },
  pickerEmptyText: {
    color: colors.text.secondary, fontSize: 13, lineHeight: 19,
    textAlign: 'center', marginBottom: 12,
  },
  pickerGoBtn: {
    paddingVertical: 12, borderRadius: 10, alignItems: 'center',
    backgroundColor: colors.accent.primary,
  },
  pickerGoBtnText: { color: colors.text.primary, fontSize: 13, fontWeight: '700' },
  pickerRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, paddingHorizontal: 12, borderRadius: 12,
    borderWidth: 1, borderColor: colors.border.subtle,
    backgroundColor: colors.bg.surface2, marginBottom: 8, gap: 8,
  },
  pickerRowActive: { borderColor: colors.accent.primary },
  pickerRowName: { color: colors.text.primary, fontSize: 14, fontWeight: '700' },
  pickerRowDesc: { color: colors.text.muted, fontSize: 11, marginTop: 2 },
  pickerRowCurrent: { color: colors.accent.primary, fontSize: 11, fontWeight: '700' },
  pickerCloseBtn: {
    flex: 1, marginTop: 8, paddingVertical: 12, borderRadius: 10, alignItems: 'center',
    borderWidth: 1, borderColor: colors.border.subtle,
  },
  pickerCloseBtnText: { color: colors.text.secondary, fontSize: 13, fontWeight: '700' },

  editFieldLabel: {
    color: colors.text.secondary, fontSize: 12, fontWeight: '700', marginBottom: 6, marginTop: 4,
  },
  editInput: {
    backgroundColor: colors.bg.surface2, borderWidth: 1, borderColor: colors.border.subtle,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    color: colors.text.primary, fontSize: 14, marginBottom: 10,
  },
  editChipRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  editChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16,
    backgroundColor: colors.bg.surface2, borderWidth: 1, borderColor: colors.border.subtle,
  },
  editChipSelected: { backgroundColor: colors.accent.primary, borderColor: colors.accent.primary },
  editChipText: { color: colors.text.secondary, fontSize: 12, fontWeight: '600' },
  editChipTextSelected: { color: colors.text.primary },
  editBtnRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  editSaveBtn: {
    flex: 1, marginTop: 8, paddingVertical: 12, borderRadius: 10, alignItems: 'center',
    backgroundColor: colors.accent.primary,
  },
  editSaveBtnText: { color: colors.text.primary, fontSize: 13, fontWeight: '700' },

  resetBox: {
    marginTop: 32, padding: 14, borderRadius: 12,
    backgroundColor: colors.bg.surface1,
    borderWidth: 1, borderColor: '#553030',
  },
  resetBoxLabel: {
    color: colors.text.primary, fontSize: 13, fontWeight: '700',
    marginBottom: 4,
  },
  resetBoxDesc: {
    color: colors.text.muted, fontSize: 11, lineHeight: 16,
    marginBottom: 10,
  },
  resetBtn: {
    paddingVertical: 10, borderRadius: 10, alignItems: 'center',
    backgroundColor: 'transparent',
    borderWidth: 1, borderColor: '#a04444',
  },
  resetBtnText: { color: '#cc6868', fontSize: 13, fontWeight: '700' },
});
