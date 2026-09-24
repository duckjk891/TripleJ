// [VideoDirector] v3.171→v3.187(대표) — 영상 디렉터 대화: 공유영상 생성·내보내기.
// v3.182: ①말풍선 UI를 작곡 디렉터(첨부 이미지) 스타일로 — 보라 링 아바타 + 버블 안 이름 라벨
//   ②내 답변(user 버블) 탭 → 그 단계로 되돌아가 다시 선택 ③배경 3모드(원본/블러 강도/색+투명도,
//   커버 실사 미리보기) ④폰트 5종+볼드/기울임 ⑤글자색 컬러 팔레트(+hex 표시) ⑥기기 저장(MediaLibrary)과
//   공유(OS 시트) 분리. v3.187: 보관함 제거(대표 확정 — 서버 API 는 존치). 추적자 [VideoDirector].
// v3.209: ①배경 4번째 카드 「단색 배경」(center 전용) — 내부 solid 모드, API 는 bg=color&bgalpha=100 매핑,
//   진하기 질문 생략 ②자막 테두리 신규 2단계 — 유무(기본 있음) → 테두리 색(팔레트 12색, 기본 검정).
//   기본 조합(있음·검정)은 outlinecolor "" 정규화 — 레거시 캐시 적중.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  StyleSheet, View, ScrollView, TouchableOpacity, Image, ActivityIndicator, Platform, Linking,
} from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
import { Feather } from '@expo/vector-icons';
import { AppText } from '../components/ui';
import { showAlert } from '../utils/appAlert';
import { colors } from '../theme/colors';
import api, { BACKEND_BASE_URL } from '../services/api';
import { usePointsStore } from '../stores/pointsStore';
// v3.214 ⑨: 영상 디렉터 피로도 게이트 — MusicGenerationScreen 패턴 이식(진입/포커스 status,
// 생성 직전 게이트 + 서버 429 동일 다이얼로그). 스킵비 ⭐2(share_video 5의 1/3 반올림).
import { getFatigueStatus } from '../services/fatigueService';
import { showFatigueCooldownDialog } from '../utils/fatigueGate';
import { FatigueStatus } from '../types';
// v3.219 [VideoDraft]: 대화 draft(선곡·진행·대화) 미러링 + 스타일 sticky — musicStore 보존
import { useMusicStore, type VideoDraft, type VideoStylePrefs } from '../stores/musicStore';

const VIDEO_PORTRAIT = require('../assets/portraits/video_director.png');

interface MyTrack {
  id: string; title: string; cover_image?: string | null; cover_image_url?: string | null;
  is_public?: boolean;
}

type Step =
  | 'pick' | 'format' | 'layout' | 'shape' | 'bg' | 'bgBlurLevel' | 'bgColor' | 'bgAlpha'
  | 'font' | 'fontStyle' | 'fontColor' | 'fontOutline' | 'outlineColor'
  | 'lyricsMode' | 'subPos' | 'making' | 'done';

// user 버블에 step 을 기록 — 탭하면 그 단계로 되돌아가 수정(v3.182)
interface ChatMessage { type: 'director' | 'user'; text: string; step?: Step }

const FORMATS: { key: 'sns' | 'wide' | 'kakao'; label: string; desc: string; ratioW: number; ratioH: number }[] = [
  { key: 'sns', label: 'SNS용 세로', desc: '9:16 · 릴스/쇼츠/틱톡', ratioW: 36, ratioH: 64 },
  { key: 'wide', label: '와이드 가로', desc: '16:9 · 유튜브/PC', ratioW: 64, ratioH: 36 },
  { key: 'kakao', label: '카톡 프로필 배경', desc: '15초 · 프로필 배경용', ratioW: 42, ratioH: 64 },
];

const FONTS: { key: string; label: string }[] = [
  { key: 'basic', label: '기본 고딕' },
  { key: 'round', label: '둥근 고딕' },
  { key: 'serif', label: '명조체' },
  { key: 'dohyeon', label: '도현체' },
  { key: 'jua', label: '주아체' },
];

// 글자·배경 색 공용 팔레트 (hex — 선택 시 코드 표시)
const PALETTE = [
  'FFFFFF', 'FFD700', 'FF6FA5', '7FD7FF',
  'A855F7', 'FF5C5C', '7CFF9B', 'FFA94D',
  '9BA8FF', 'F5E6C8', '1B1035', '000000',
];

const BG_ALPHAS = ['25', '45', '70'];
const BLUR_LEVELS: { key: string; label: string; radius: number }[] = [
  { key: 'light', label: '살짝 흐림', radius: 2 },
  { key: 'mid', label: '중간 흐림', radius: 6 },
  { key: 'strong', label: '많이 흐림', radius: 12 },
];

const coverUriOf = (t: MyTrack | null): string | null => {
  const img = t && (t.cover_image || t.cover_image_url);
  return img ? `${BACKEND_BASE_URL}/api/upload/cover-preview/${encodeURIComponent(img)}` : null;
};

const INITIAL_VIDEO_GREETING: ChatMessage = {
  type: 'director',
  text: '안녕하세요! 영상 디렉터예요.\n곡을 고르면 커버와 가사가 어우러진 영상을 만들어 드릴게요. 어떤 곡으로 만들까요?\n\n선택한 답변을 탭하면 그 단계부터 다시 고를 수 있어요.',
};

export default function VideoDirectorScreen({ navigation, route }: any) {
  // v3.219 [VideoDraft]: 마운트 시점 draft/스타일 sticky 스냅샷 — 커버(v3.202 H-⑤) 패턴.
  // draft(선곡·step·대화)는 재진입 이어가기용(저장/공유 완료·'처음부터'에 클리어),
  // stylePrefs는 완주 후에도 유지(다음 영상에 이전 취향 승계 — creationMode sticky 관행).
  const initialStore = useRef(useMusicStore.getState()).current;
  const resumeDraft: VideoDraft | null =
    initialStore.videoDraft &&
    initialStore.videoDraft.chat.some((m) => m.type === 'user') &&
    initialStore.videoDraft.step !== 'making' &&
    initialStore.videoDraft.step !== 'done'
      ? initialStore.videoDraft
      : null;
  const stylePrefs: VideoStylePrefs | null = initialStore.videoStylePrefs;

  const [chat, setChat] = useState<ChatMessage[]>(
    resumeDraft ? (resumeDraft.chat as ChatMessage[]) : [INITIAL_VIDEO_GREETING]
  );
  const [tracks, setTracks] = useState<MyTrack[]>([]);
  const [loadingTracks, setLoadingTracks] = useState(true);
  const [selected, setSelected] = useState<MyTrack | null>(
    // v3.219 [VideoDraft]: 곡 선택 복원(최소 스냅샷) — 목록 로드 후 실측 검증·보강(트랙 소멸 시 폐기)
    resumeDraft && resumeDraft.selectedTrackId
      ? ({ id: resumeDraft.selectedTrackId, title: resumeDraft.selectedTrackTitle || '' } as MyTrack)
      : null
  );
  const [step, setStep] = useState<Step>(resumeDraft ? (resumeDraft.step as Step) : 'pick');
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [madeFormat, setMadeFormat] = useState<'sns' | 'wide' | 'kakao' | null>(null);
  // v3.219 [VideoDraft]: 복원 안내 버블(인라인 '처음부터' 액션) 노출 여부
  const [showResumeNotice, setShowResumeNotice] = useState(!!resumeDraft);
  // 스타일 선택값 — v3.219 [VideoDraft]: sticky 스타일이 있으면 기본값으로 복원
  const [pickedFormat, setPickedFormat] = useState<'sns' | 'wide' | 'kakao' | null>(stylePrefs?.pickedFormat ?? null);
  const [pickedLayout, setPickedLayout] = useState<'full' | 'center'>(stylePrefs?.pickedLayout ?? 'full');
  const [pickedShape, setPickedShape] = useState<'square' | 'circle'>(stylePrefs?.pickedShape ?? 'square');
  // v3.209: 'solid' = 단색 배경(앱 내부 모드 — API 로는 bg=color&bgalpha=100 매핑)
  const [pickedBg, setPickedBg] = useState<'blur' | 'clean' | 'color' | 'solid'>(stylePrefs?.pickedBg ?? 'blur');
  const [pickedBgBlur, setPickedBgBlur] = useState<'light' | 'mid' | 'strong'>(stylePrefs?.pickedBgBlur ?? 'mid');
  const [pickedBgColor, setPickedBgColor] = useState<string>(stylePrefs?.pickedBgColor ?? '1B1035');
  const [pickedBgAlpha, setPickedBgAlpha] = useState<string>(stylePrefs?.pickedBgAlpha ?? '45');
  const [pickedFont, setPickedFont] = useState<string>(stylePrefs?.pickedFont ?? 'basic');
  const [pickedBold, setPickedBold] = useState(stylePrefs?.pickedBold ?? false);
  const [pickedItalic, setPickedItalic] = useState(stylePrefs?.pickedItalic ?? false);
  const [pickedColor, setPickedColor] = useState<string>(stylePrefs?.pickedColor ?? 'FFFFFF');
  // v3.209: 자막 테두리 — 유무(기본 있음)·색(기본 검정 = 현행 서버 하드코딩과 동일)
  const [pickedOutline, setPickedOutline] = useState(stylePrefs?.pickedOutline ?? true);
  const [pickedOutlineColor, setPickedOutlineColor] = useState<string>(stylePrefs?.pickedOutlineColor ?? '000000');
  // v3.183(대표): 자막 위치 — near(이미지 가까이)/mid/low. 플레이어 스타일 기본=near
  const [pickedLyricsMode, setPickedLyricsMode] = useState<'scroll' | 'line'>(stylePrefs?.pickedLyricsMode ?? 'scroll');
  const [saving, setSaving] = useState(false);
  const [sharing, setSharing] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  // v3.214 tester U-5④: 이 세션에서 생성 성공한 조합(트랙+스타일) 시그니처 —
  // 재요청은 서버 캐시 히트(무과금·무피로)이므로 쿨다운 선게이트를 건너뛴다.
  // 캐시 미스로 판명되면 서버 429가 동일 다이얼로그로 최종 방어한다.
  const succeededSigsRef = useRef<Set<string>>(new Set());
  const [videoCost, setVideoCost] = useState<number | null>(null);

  // v3.214 ⑨: 영상 디렉터 피로/쿨다운 — GET /fatigue/status?director=video (MusicGeneration 패턴)
  const [fatigue, setFatigue] = useState<FatigueStatus | null>(null);
  const [fatigueRemainSec, setFatigueRemainSec] = useState(0);

  const applyFatigueStatus = useCallback((data: FatigueStatus) => {
    setFatigue(data);
    setFatigueRemainSec(Math.max(0, Math.floor(data?.cooldown_remaining_sec ?? 0)));
  }, []);

  const refreshFatigue = useCallback(async () => {
    try {
      const data = await getFatigueStatus('video');
      applyFatigueStatus(data);
    } catch (err: any) {
      // 조회 실패는 게이트 오픈 — 서버 게이트(429)가 최종 방어 (구 서버는 video 미지원 → 무게이트 자연 호환)
      console.warn('[VideoDirector] [fatigue] 상태 조회 실패:', err?.response?.status, err?.message);
    }
  }, [applyFatigueStatus]);

  useFocusEffect(
    useCallback(() => {
      refreshFatigue();
    }, [refreshFatigue])
  );

  // v3.222 ①: focus 시 Tab 헤더 headerLeft ← 주입 — Dialogue :105-120 관행 1:1(아이콘·마진 동일,
  // 클리어는 Map focus 승계 — v3.201 불변식). 목적지는 정상 진입([Map,Dialogue,VD])·프리셋 진입
  // ([Map,VD] — MyMusic 다운로드 영상) 모두 Map(작업실) 복귀로 일원화(헤더 문맥=엔터명과 일치).
  // 정상 진입 시 Dialogue가 심은 화살표와 중복 주입되지만 마지막 focus가 이기고 목적지 동일 — 무해.
  useFocusEffect(
    useCallback(() => {
      if (__DEV__) console.info('[VideoDirector] 헤더 ← 주입(→Map)');
      const parent = navigation.getParent();
      parent?.setOptions({
        headerLeft: () => (
          <TouchableOpacity
            onPress={() => {
              // v3.223 C-9: RN7 navigate('Map')는 기존 Map으로 pop하지 않고 새 Map을 push → popTo로 스택 되감기
              if (__DEV__) console.info('[VideoDirector] ← popTo(Map)');
              navigation.popTo('Map');
            }}
            style={{ marginLeft: 12 }}
            accessibilityLabel="작업실로 돌아가기"
          >
            <Feather name="arrow-left" size={22} color={colors.text.primary} />
          </TouchableOpacity>
        ),
      });
    }, [navigation])
  );

  // 쿨다운 카운트다운 — 0 도달 직전 서버 재확인 (MusicGeneration 동일)
  useEffect(() => {
    if (fatigueRemainSec <= 0) return undefined;
    const timer = setInterval(() => {
      setFatigueRemainSec((s) => Math.max(0, s - 1));
      if (fatigueRemainSec === 1) refreshFatigue();
    }, 1000);
    return () => clearInterval(timer);
  }, [fatigueRemainSec, refreshFatigue]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await api.get('/points/costs');
        const c = res.data?.costs?.share_video;
        if (alive && typeof c === 'number') setVideoCost(c);
      } catch (err: any) {
        console.error('[VideoDirector] /points/costs 조회 실패', { status: err?.response?.status });
      }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120);
  }, [chat, step]);

  useEffect(() => {
    (async () => {
      try {
        console.info('[VideoDirector] calling /tracks/my');
        const res = await api.get('/tracks/my');
        const list: MyTrack[] = (res.data?.tracks || res.data || []).map((t: any) => ({
          id: String(t.id), title: t.title, cover_image: t.cover_image,
          cover_image_url: t.cover_image_url, is_public: t.is_public !== false,
        }));
        setTracks(list);
        // v3.221: 마이페이지 다운로드(영상) 진입 — initialTrackId 프리셋(명시 진입 의도가
        // draft 복원보다 우선). 목록에 있으면 해당 곡으로 선곡 단계 통과, 비공개면 안내 후 pick 유지.
        const presetId = route?.params?.initialTrackId ? String(route.params.initialTrackId) : null;
        if (presetId) {
          const preset = list.find((t) => t.id === presetId);
          if (__DEV__) console.info('[VideoDirector] initialTrackId 프리셋', { presetId, found: !!preset });
          if (preset) {
            useMusicStore.getState().clearVideoDraft();
            setShowResumeNotice(false);
            if (preset.is_public === false) {
              showAlert('공개 곡만 가능해요', '공유 영상은 차트에 공개된 곡으로만 만들 수 있어요.\n마이페이지에서 곡을 공개로 전환한 뒤 다시 시도해주세요.');
            } else {
              setSelected(preset);
              setChat([INITIAL_VIDEO_GREETING, { type: 'user', text: preset.title, step: 'pick' },
                { type: 'director', text: '좋아요! 어떤 형태의 영상으로 만들까요?' }]);
              setStep('format');
            }
            setLoadingTracks(false);
            return;
          }
        }
        // v3.219 [VideoDraft]: 복원한 선곡을 실측 목록으로 검증·보강 — 트랙 소멸(삭제 등)이면
        // draft 폐기 후 처음부터(오표시·404 방지). 존재하면 커버 포함 전체 스냅샷으로 교체.
        if (resumeDraft?.selectedTrackId) {
          const full = list.find((t) => t.id === resumeDraft.selectedTrackId);
          if (full) {
            setSelected(full);
          } else {
            console.warn('[VideoDraft] 복원 트랙이 목록에 없음 — draft 폐기', { trackId: resumeDraft.selectedTrackId });
            useMusicStore.getState().clearVideoDraft();
            setSelected(null);
            setChat([INITIAL_VIDEO_GREETING]);
            setStep('pick');
            setShowResumeNotice(false);
          }
        }
      } catch (err: any) {
        console.error('[VideoDirector] 내 곡 로드 실패', { status: err?.response?.status });
      } finally {
        setLoadingTracks(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // v3.219 [VideoDraft]: 대화 미러링(커버 v3.202 H-⑤ 패턴) — 사용자 진행이 있을 때만 기록.
  // 생성 중(making)·완료(done)는 미러링 제외 — 재진입 시 마지막 선택 지점(생성 직전)으로 복원.
  useEffect(() => {
    if (step === 'making' || step === 'done') return;
    if (!chat.some((m) => m.type === 'user')) return;
    useMusicStore.getState().setVideoDraft({
      selectedTrackId: selected?.id ?? null,
      selectedTrackTitle: selected?.title ?? null,
      step,
      chat,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat, step, selected]);

  // v3.219 [VideoDraft]: 스타일 sticky 미러링 — 완주 후에도 유지(다음 영상 기본값)
  useEffect(() => {
    useMusicStore.getState().setVideoStylePrefs({
      pickedFormat, pickedLayout, pickedShape, pickedBg, pickedBgBlur, pickedBgColor,
      pickedBgAlpha, pickedFont, pickedBold, pickedItalic, pickedColor,
      pickedOutline, pickedOutlineColor, pickedLyricsMode,
    });
  }, [
    pickedFormat, pickedLayout, pickedShape, pickedBg, pickedBgBlur, pickedBgColor,
    pickedBgAlpha, pickedFont, pickedBold, pickedItalic, pickedColor,
    pickedOutline, pickedOutlineColor, pickedLyricsMode,
  ]);

  // v3.219 [VideoDraft]: '처음부터' — draft 폐기 후 선곡부터(스타일 sticky는 유지)
  const handleRestartFromScratch = () => {
    if (__DEV__) console.info('[VideoDraft] 처음부터 — draft 폐기·선곡부터');
    useMusicStore.getState().clearVideoDraft();
    setSelected(null);
    setVideoUrl(null);
    setChat([INITIAL_VIDEO_GREETING]);
    setStep('pick');
    setShowResumeNotice(false);
  };

  const pushDirector = (text: string) => setChat((p) => [...p, { type: 'director', text }]);
  // user 답변엔 되돌아갈 step 을 기록
  const pushUser = (text: string, fromStep: Step) => {
    // v3.219 [VideoDraft]: 이어서 답변 시작 — 복원 안내 버블 접기
    setShowResumeNotice(false);
    setChat((p) => [...p, { type: 'user', text, step: fromStep }]);
  };

  // v3.182: 내 답변 탭 → 그 단계로 롤백 (해당 답변 포함 이후 대화 제거)
  const handleEditChoice = (msgIndex: number) => {
    const msg = chat[msgIndex];
    if (!msg || msg.type !== 'user' || !msg.step || step === 'making') return;
    if (__DEV__) console.info('[VideoDirector] 답변 수정 — 롤백', { toStep: msg.step });
    setShowResumeNotice(false); // v3.219 [VideoDraft]: 수정 시작도 "이어서" — 안내 버블 접기
    setChat(chat.slice(0, msgIndex));
    setVideoUrl(null);
    setStep(msg.step);
  };

  const handlePickTrack = (t: MyTrack) => {
    if (t.is_public === false) {
      showAlert('공개 곡만 가능해요', '공유 영상은 차트에 공개된 곡으로만 만들 수 있어요.\n마이페이지에서 곡을 공개로 전환한 뒤 다시 시도해주세요.');
      return;
    }
    setSelected(t);
    pushUser(t.title, 'pick');
    pushDirector('좋아요! 어떤 형태의 영상으로 만들까요?');
    setStep('format');
  };

  const handlePickFormat = (fmt: 'sns' | 'wide' | 'kakao') => {
    if (!selected || step === 'making') return;
    setPickedFormat(fmt);
    pushUser(FORMATS.find((x) => x.key === fmt)!.label, 'format');
    pushDirector('커버 이미지를 화면에 어떻게 넣을까요?');
    setStep('layout');
  };

  const handlePickLayout = (layout: 'full' | 'center') => {
    setPickedLayout(layout);
    pushUser(layout === 'full' ? '화면 꽉 채우기' : '플레이어 스타일 (중앙 이미지)', 'layout');
    if (layout === 'center') {
      pushDirector('중앙 이미지는 어떤 모양으로 할까요?');
      setStep('shape');
    } else {
      pushDirector('가사 폰트는 어떤 걸로 할까요?');
      setStep('font');
    }
  };

  const handlePickShape = (shape: 'square' | 'circle') => {
    setPickedShape(shape);
    pushUser(shape === 'square' ? '둥근 네모' : '동그라미', 'shape');
    pushDirector('배경은 어떻게 할까요?\n원본 그대로, 흐리게(정도 선택), 색으로 덮기(색·투명도 선택), 단색 배경(이미지 없이 색만) 중에 골라주세요.');
    setStep('bg');
  };

  const handlePickBg = (bg: 'clean' | 'blur' | 'color' | 'solid') => {
    setPickedBg(bg);
    pushUser(bg === 'clean' ? '원본 배경' : bg === 'blur' ? '흐린 배경' : bg === 'color' ? '색으로 덮기' : '단색 배경', 'bg');
    if (bg === 'blur') {
      pushDirector('얼마나 흐리게 할까요? 미리보기를 참고해 골라주세요.');
      setStep('bgBlurLevel');
    } else if (bg === 'color' || bg === 'solid') {
      // v3.209: 단색도 색 팔레트는 공용 — 이후 분기(진하기 skip)는 handlePickBgColor 에서
      pushDirector(
        bg === 'solid'
          ? '어떤 색의 단색 배경으로 할까요? 색을 고르면 색상 코드도 보여드릴게요.'
          : '어떤 색으로 덮을까요? 색을 고르면 색상 코드도 보여드릴게요.'
      );
      setStep('bgColor');
    } else {
      pushDirector('가사 폰트는 어떤 걸로 할까요?');
      setStep('font');
    }
  };

  const handlePickBgBlur = (level: 'light' | 'mid' | 'strong') => {
    setPickedBgBlur(level);
    pushUser(BLUR_LEVELS.find((b) => b.key === level)!.label, 'bgBlurLevel');
    pushDirector('가사 폰트는 어떤 걸로 할까요?');
    setStep('font');
  };

  const handlePickBgColor = (hex: string) => {
    setPickedBgColor(hex);
    pushUser(`배경색 #${hex}`, 'bgColor');
    if (pickedBg === 'solid') {
      // v3.209: 단색 배경은 완전 불투명(100%) 고정 — 진하기 질문 생략
      if (__DEV__) console.info('[VideoDirector] 단색 배경 — 진하기 단계 생략', { hex });
      pushDirector('가사 폰트는 어떤 걸로 할까요?');
      setStep('font');
    } else {
      pushDirector('색을 얼마나 진하게 덮을까요?');
      setStep('bgAlpha');
    }
  };

  const handlePickBgAlpha = (alpha: string) => {
    setPickedBgAlpha(alpha);
    pushUser(`진하기 ${alpha}%`, 'bgAlpha');
    pushDirector('가사 폰트는 어떤 걸로 할까요?');
    setStep('font');
  };

  const handlePickFont = (font: string) => {
    setPickedFont(font);
    pushUser(FONTS.find((f) => f.key === font)!.label, 'font');
    pushDirector('굵게/기울임 효과도 넣을까요?');
    setStep('fontStyle');
  };

  const handlePickFontStyle = (bold: boolean, italic: boolean) => {
    setPickedBold(bold); setPickedItalic(italic);
    const label = bold && italic ? '굵게 + 기울임' : bold ? '굵게' : italic ? '기울임' : '기본';
    pushUser(label, 'fontStyle');
    pushDirector('가사 글자 색은요? 팔레트에서 골라주세요.');
    setStep('fontColor');
  };

  const handlePickColor = (hex: string) => {
    setPickedColor(hex);
    pushUser(`글자색 #${hex}`, 'fontColor');
    pushDirector('자막 글자에 테두리를 둘까요? 테두리가 있으면 배경 위에서 글자가 더 또렷해요.');
    setStep('fontOutline');
  };

  // v3.209: 다음 질문(가사 표시 방식) — 테두리 단계 2곳에서 공용
  const askLyricsMode = () => {
    pushDirector('가사는 어떻게 보여드릴까요?\n여러 줄이 흘러가는 방식과 한 줄씩 나오는 방식이 있어요.');
    setStep('lyricsMode');
  };

  // v3.209: 자막 테두리 유무 → 있음이면 테두리 색 선택으로
  const handlePickFontOutline = (on: boolean) => {
    setPickedOutline(on);
    pushUser(on ? '테두리 있음' : '테두리 없음', 'fontOutline');
    if (on) {
      pushDirector('테두리 색은 어떤 걸로 할까요? 기본은 검정이에요.');
      setStep('outlineColor');
    } else {
      askLyricsMode();
    }
  };

  // v3.209: 테두리 색 선택
  const handlePickOutlineColor = (hex: string) => {
    setPickedOutlineColor(hex);
    pushUser(`테두리색 #${hex}`, 'outlineColor');
    askLyricsMode();
  };

  const handlePickLyrics = (lyricsMode: 'scroll' | 'line') => {
    setPickedLyricsMode(lyricsMode);
    pushUser(lyricsMode === 'scroll' ? '흐르는 가사' : '한 줄씩', 'lyricsMode');
    pushDirector(
      pickedLayout === 'center'
        ? '자막(가사)은 어디에 둘까요? 기본은 중앙 이미지 바로 아래예요.'
        : '자막(가사)은 어디에 둘까요?'
    );
    setStep('subPos');
  };

  // v3.183: 자막 위치 선택 → 생성
  const handlePickSubPos = (subpos: 'near' | 'mid' | 'low') => {
    const label = subpos === 'near'
      ? (pickedLayout === 'center' ? '이미지 가까이' : '위쪽')
      : subpos === 'mid' ? '중간' : '아래쪽';
    pushUser(label, 'subPos');
    startGeneration(pickedLyricsMode, subpos);
  };

  const styleParams = (lyricsMode: 'scroll' | 'line', subpos: 'near' | 'mid' | 'low') => ({
    format: pickedFormat!, layout: pickedLayout, shape: pickedShape, lyrics: lyricsMode,
    font: pickedFont, fontcolor: pickedColor === 'FFFFFF' ? 'white' : pickedColor,
    // v3.209: 단색(solid)은 기존 color 모드 + 완전 불투명 100 으로 매핑 — API 계약 신설 0
    bg: pickedLayout === 'center' ? (pickedBg === 'solid' ? 'color' : pickedBg) : 'blur',
    bgblur: pickedBgBlur, bgcolor: pickedBg === 'color' || pickedBg === 'solid' ? pickedBgColor : '',
    bgalpha: pickedLayout === 'center' && pickedBg === 'solid' ? '100' : pickedBgAlpha,
    fontbold: pickedBold ? '1' : '0', fontitalic: pickedItalic ? '1' : '0',
    // v3.209: 자막 테두리 — 기본 조합(있음·검정)은 outlinecolor "" 정규화 → 레거시 캐시 적중
    fontoutline: pickedOutline ? '1' : '0',
    outlinecolor: pickedOutline && pickedOutlineColor !== '000000' ? pickedOutlineColor : '',
    subpos,
  });

  // v3.214 ⑤ 부수: 확인 팝업/게이트 취소 시 subPos 답변 버블 잔존 정리 — 마지막 user 버블 1개 제거
  const rollbackToSubPos = () => {
    setChat((p) => (p[p.length - 1]?.type === 'user' ? p.slice(0, -1) : p));
    setStep('subPos');
  };

  // v3.214 ⑨: 생성/다시 만들기 진입 게이트 — 쿨다운 중이면 과금 확인 전에 쿨다운 다이얼로그
  // (12곳 관행 showFatigueCooldownDialog 재사용, director='video'). 해제 시 proceedGeneration 직행.
  const startGeneration = (lyricsMode: 'scroll' | 'line', subpos: 'near' | 'mid' | 'low') => {
    if (!selected) return;
    const sig = `${selected.id}:${JSON.stringify(styleParams(lyricsMode, subpos))}`;
    if (fatigueRemainSec > 0 && !succeededSigsRef.current.has(sig)) {
      console.info('[VideoDirector] [fatigue] 게이트 — 남은', fatigueRemainSec, '초');
      showFatigueCooldownDialog({
        status: fatigue,
        remainingSec: fatigueRemainSec,
        director: 'video',
        onStatusUpdate: applyFatigueStatus,
        onCleared: () => proceedGeneration(lyricsMode, subpos),
        onCancel: rollbackToSubPos,
      });
      return;
    }
    proceedGeneration(lyricsMode, subpos);
  };

  const proceedGeneration = async (lyricsMode: 'scroll' | 'line', subpos: 'near' | 'mid' | 'low') => {
    if (!selected) return;
    if (typeof videoCost === 'number') {
      const ok = await new Promise<boolean>((resolve) => {
        showAlert('영상 만들기', `새 영상 생성 시 ⭐${videoCost}이 소모돼요.
(같은 곡·형식·스타일을 이미 만들었다면 무료로 다시 받아요)`, [
          { text: '취소', style: 'cancel', onPress: () => resolve(false) },
          { text: '진행', onPress: () => resolve(true) },
        ]);
      });
      if (!ok) { rollbackToSubPos(); return; }
    }
    pushDirector('영상을 만들고 있어요. 커버와 가사를 엮는 중… 작업이 끝날 때까지 이 화면을 벗어나지 마세요.');
    setStep('making');
    const params = styleParams(lyricsMode, subpos);
    console.info('[VideoDirector] share-video 생성', { trackId: selected.id, ...params });
    try {
      const res = await api.post(`/tracks/${selected.id}/share-video`, null, { params, timeout: 300000 });
      const path = res.data?.video_url;
      if (!path) throw new Error('video_url 없음');
      setVideoUrl(path.startsWith('http') ? path : `${BACKEND_BASE_URL}${path}`);
      setMadeFormat(params.format);
      succeededSigsRef.current.add(`${selected.id}:${JSON.stringify(params)}`);
      pushDirector('완성됐어요! 아래에서 미리 보고, 저장하거나 공유해보세요.');
      usePointsStore.getState().fetchBalance();
      refreshFatigue(); // v3.214 ⑨: 생성 완료 = 피로 적립(on_generation_completed) — 상태 재동기화
      setStep('done');
    } catch (err: any) {
      const status = err?.response?.status;
      console.error('[VideoDirector] share-video 실패', { trackId: selected.id, status });
      // v3.214 ⑨: 서버 check_gate 429(과금 전 무비용) — 게이트와 동일 쿨다운 다이얼로그로 대응
      if (status === 429) {
        const remain = Math.max(0, Math.floor(err?.response?.data?.cooldown_remaining_sec ?? 0));
        setFatigueRemainSec(remain);
        pushDirector('영상 디렉터가 잠시 쉬는 중이에요. 휴식을 단축하거나 잠시 후 다시 시도해주세요.');
        setStep('subPos');
        showFatigueCooldownDialog({
          status: fatigue,
          remainingSec: remain > 0 ? remain : 1,
          director: 'video',
          onStatusUpdate: applyFatigueStatus,
          onCleared: () => proceedGeneration(lyricsMode, subpos),
        });
        return;
      }
      pushDirector(
        status === 402 ? '스타(⭐)가 부족해요. 스타를 모은 뒤 다시 시도해주세요.'
        : status === 404 ? '이 곡은 공개 상태가 아니라 영상을 만들 수 없었어요. 공개로 전환 후 다시 시도해주세요.'
        : status === 400 ? '커버 이미지가 없어 영상을 만들 수 없었어요. 이미지 디렉터에게 커버를 먼저 부탁해보세요!'
        : '영상 생성에 실패했어요. 잠시 후 다시 시도해주세요.'
      );
      setStep('format');
    }
  };

  // v3.182: 기기 저장(사진 앨범) — 공유와 분리
  // v3.214 ⑥-a: 캐시 파일명 새니타이즈 강화 — 한글·공백·특수문자 연속을 _ 1개로, 40자 상한
  // (한글 긴 제목에서 downloadAsync 실패 → "다운로드만 되고 공유 시트 안 뜸" 증상 봉합 후보 a)
  const downloadToCache = async (): Promise<string | null> => {
    if (!videoUrl) return null;
    const base = (selected?.title || 'maidol').replace(/[^\w가-힣.-]+/g, '_').slice(0, 40) || 'maidol';
    const dest = `${FileSystem.cacheDirectory}${base}_${madeFormat || 'video'}.mp4`;
    if (__DEV__) console.info('[VideoDirector] 캐시 다운로드', { dest });
    const res = await FileSystem.downloadAsync(videoUrl, dest);
    return res.uri;
  };

  const handleSaveToDevice = async () => {
    if (!videoUrl || saving) return;
    setSaving(true);
    try {
      if (Platform.OS === 'web') {
        await Linking.openURL(videoUrl); // 웹: 브라우저 다운로드
      } else {
        const { status } = await MediaLibrary.requestPermissionsAsync();
        if (status !== 'granted') {
          showAlert('권한 필요', '사진 보관함 접근 권한을 허용해야 영상을 저장할 수 있어요.');
          return;
        }
        const uri = await downloadToCache();
        if (!uri) throw new Error('download failed');
        await MediaLibrary.saveToLibraryAsync(uri);
        showAlert('저장 완료', '영상이 사진 앨범에 저장됐어요.');
      }
      // v3.219 [VideoDraft]: 저장 완료 = 완주 — 선곡/step/대화 draft 클리어(스타일 sticky는 유지)
      useMusicStore.getState().clearVideoDraft();
      if (__DEV__) console.info('[VideoDraft] 저장 완료 — draft 클리어(스타일 sticky 유지)');
    } catch (err: any) {
      console.error('[VideoDirector] 기기 저장 실패', { message: err?.message });
      showAlert('오류', '영상을 저장하지 못했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setSaving(false);
    }
  };

  const handleShare = async () => {
    if (!videoUrl || sharing) return;
    setSharing(true);
    try {
      if (Platform.OS === 'web') {
        await Linking.openURL(videoUrl);
      } else {
        const uri = await downloadToCache();
        // v3.214 ⑥-b: mimeType(Android 공유 대상 확장)·UTI(iOS) 명시 — 미지정 시 일부 기기에서
        // 공유 시트가 축소/실패하던 증상 봉합 후보 b. 실패는 catch 의 showAlert 로 무피드백 금지(후보 c).
        if (uri && (await Sharing.isAvailableAsync())) {
          await Sharing.shareAsync(uri, {
            mimeType: 'video/mp4',
            UTI: 'public.mpeg-4',
            dialogTitle: '영상 공유',
          });
          // v3.219 [VideoDraft]: 공유 완료 = 완주 — draft 클리어(스타일 sticky는 유지)
          useMusicStore.getState().clearVideoDraft();
          if (__DEV__) console.info('[VideoDraft] 공유 완료 — draft 클리어(스타일 sticky 유지)');
        } else {
          showAlert('안내', '이 기기에서는 공유 시트를 열 수 없어요.');
        }
      }
    } catch (err: any) {
      console.error('[VideoDirector] 공유 실패', { message: err?.message });
      showAlert('오류', '공유에 실패했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setSharing(false);
    }
  };

  const handleAnotherFormat = () => {
    setVideoUrl(null);
    pushDirector('다른 형태로도 만들어 볼까요? 형식을 골라주세요!');
    setStep('format');
  };

  const handleAnotherTrack = () => {
    setSelected(null);
    setVideoUrl(null);
    pushDirector('다른 곡으로 만들어 볼까요? 곡을 골라주세요!');
    setStep('pick');
  };

  const coverUri = coverUriOf(selected);

  const Card = ({ onPress, children, label, desc }: any) => (
    <TouchableOpacity style={styles.formatCard} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.ratioBoxWrap}>{children}</View>
      <AppText style={styles.formatLabel}>{label}</AppText>
      {desc ? <AppText style={styles.formatDesc}>{desc}</AppText> : null}
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <ScrollView ref={scrollRef} style={styles.chatArea} contentContainerStyle={{ paddingBottom: 16 }}>
        {chat.map((m, i) => (
          m.type === 'director' ? (
            // v3.182(대표 첨부): 작곡 디렉터와 동일 — 보라 링 아바타(얼굴) + 버블 안 이름 라벨
            <View key={i} style={styles.directorRow}>
              <View style={styles.portraitContainer}>
                <Image source={VIDEO_PORTRAIT} style={styles.portraitImage} />
              </View>
              <View style={styles.directorBubble}>
                <AppText style={styles.directorName}>영상 디렉터</AppText>
                <AppText style={styles.directorText}>{m.text}</AppText>
              </View>
            </View>
          ) : (
            <TouchableOpacity
              key={i}
              style={[styles.msgRow, styles.msgRowUser]}
              activeOpacity={m.step ? 0.7 : 1}
              onPress={() => handleEditChoice(i)}
              accessibilityLabel={`선택 수정 ${m.text}`}
            >
              <View style={[styles.bubble, styles.bubbleUser]}>
                <AppText style={styles.bubbleUserText}>{m.text}</AppText>
                {m.step ? <Feather name="edit-2" size={11} color="rgba(255,255,255,0.7)" style={{ marginLeft: 6 }} /> : null}
              </View>
            </TouchableOpacity>
          )
        ))}
        {/* v3.219 [VideoDraft]: 복원 안내 버블 — 디렉터 대화 톤 + 인라인 '처음부터' 액션 */}
        {showResumeNotice && (
          <View style={styles.directorRow}>
            <View style={styles.portraitContainer}>
              <Image source={VIDEO_PORTRAIT} style={styles.portraitImage} />
            </View>
            <View style={styles.directorBubble}>
              <AppText style={styles.directorName}>영상 디렉터</AppText>
              <AppText style={styles.directorText}>
                진행하던 영상 만들기를 이어서 할게요! 새로 시작하고 싶으면 아래 버튼을 눌러주세요.
              </AppText>
              <TouchableOpacity style={styles.restartInlineBtn} onPress={handleRestartFromScratch}>
                <AppText style={styles.restartInlineBtnText}>처음부터</AppText>
              </TouchableOpacity>
            </View>
          </View>
        )}
        {step === 'making' && (
          <View style={styles.makingRow}>
            <ActivityIndicator size="small" color={colors.accent.primary} />
            <AppText variant="caption" tone="muted">영상 합성 중… (최대 몇 분 걸릴 수 있어요)</AppText>
          </View>
        )}
        {step === 'done' && videoUrl ? (
          <View style={styles.resultBox}>
            <Video
              source={{ uri: videoUrl }}
              style={[
                styles.previewBase,
                madeFormat === 'wide'
                  ? { width: 300, aspectRatio: 16 / 9 }
                  : madeFormat === 'kakao'
                    ? { width: 200, aspectRatio: 1080 / 2340 }
                    : { width: 200, aspectRatio: 9 / 16 },
              ]}
              useNativeControls
              resizeMode={ResizeMode.CONTAIN}
              videoStyle={Platform.OS === 'web' ? ({ width: '100%', height: '100%', objectFit: 'contain' } as any) : undefined}
              onError={(e: any) => console.error('[VideoDirector] 미리보기 실패', { message: e?.message || String(e) })}
            />
            {/* v3.182(대표): 기기 저장(사진 앨범) / 공유 — 서로 다른 기능이라 분리 */}
            <View style={{ flexDirection: 'row', gap: 8, width: 300, maxWidth: '100%' }}>
              <TouchableOpacity style={[styles.primaryBtn, { flex: 1 }]} onPress={handleSaveToDevice} disabled={saving} activeOpacity={0.8}>
                {saving ? <ActivityIndicator size="small" color="#fff" />
                  : <AppText style={styles.primaryBtnText}>기기에 저장</AppText>}
              </TouchableOpacity>
              <TouchableOpacity style={[styles.primaryBtn, { flex: 1, backgroundColor: colors.bg.surface2, borderWidth: 1, borderColor: colors.accent.primary }]} onPress={handleShare} disabled={sharing} activeOpacity={0.8}>
                {sharing ? <ActivityIndicator size="small" color={colors.accent.primary} />
                  : <AppText style={[styles.primaryBtnText, { color: colors.accent.primary }]}>공유하기</AppText>}
              </TouchableOpacity>
            </View>
            {/* v3.214 ⑤: 2행도 1행과 동일 규격(width 300·padV 12·fs14) — 4버튼 통일 */}
            <View style={{ flexDirection: 'row', gap: 8, width: 300, maxWidth: '100%' }}>
              <TouchableOpacity style={[styles.outlineBtn, { flex: 1 }]} onPress={handleAnotherFormat} activeOpacity={0.8}>
                <AppText style={styles.outlineBtnText}>다른 형식으로</AppText>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.outlineBtn, { flex: 1 }]} onPress={handleAnotherTrack} activeOpacity={0.8}>
                <AppText style={styles.outlineBtnText}>다른 곡으로</AppText>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
      </ScrollView>

      {/* 입력 영역 — 단계별 선택지 */}
      <View style={styles.inputArea}>
        {step === 'pick' && (
          loadingTracks ? <ActivityIndicator size="small" color={colors.accent.primary} />
          : (
            <View>
              {tracks.length === 0 ? (
                <AppText variant="footnote" tone="muted" center>아직 발매한 곡이 없어요. 작곡 디렉터에게 먼저 곡을 부탁해보세요!</AppText>
              ) : (
                <ScrollView style={{ maxHeight: 220 }}>
                  {tracks.map((t) => (
                    <TouchableOpacity key={t.id} style={styles.trackRow} onPress={() => handlePickTrack(t)} activeOpacity={0.75}>
                      {coverUriOf(t)
                        ? <Image source={{ uri: coverUriOf(t)! }} style={styles.trackCover} />
                        : <View style={[styles.trackCover, styles.trackCoverPh]}><AppText tone="muted">♪</AppText></View>}
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        <AppText style={styles.trackTitle} numberOfLines={1}>{t.title}</AppText>
                        {t.is_public === false ? <AppText variant="caption" tone="muted">비공개 — 공유 영상 불가</AppText> : null}
                      </View>
                      <Feather name="chevron-right" size={16} color={colors.text.muted} />
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
            </View>
          )
        )}
        {step === 'format' && (
          <View style={styles.formatRow}>
            {FORMATS.map((f) => (
              <Card key={f.key} onPress={() => handlePickFormat(f.key)} label={f.label} desc={f.desc}>
                <View style={[styles.ratioBox, { width: f.ratioW, height: f.ratioH }]}>
                  <Feather name="music" size={12} color={colors.accent.primary} />
                </View>
              </Card>
            ))}
          </View>
        )}
        {step === 'layout' && (
          <View style={styles.formatRow}>
            <Card onPress={() => handlePickLayout('full')} label="화면 꽉 채우기" desc="커버가 배경 전체를 채워요">
              <View style={[styles.ratioBox, styles.layoutFullDemo]} />
            </Card>
            <Card onPress={() => handlePickLayout('center')} label="플레이어 스타일" desc="배경 위 중앙 이미지">
              <View style={[styles.ratioBox, styles.layoutCenterDemo]}>
                <View style={styles.layoutCenterInner} />
              </View>
            </Card>
          </View>
        )}
        {step === 'shape' && (
          <View style={styles.formatRow}>
            <Card onPress={() => handlePickShape('square')} label="둥근 네모">
              {coverUri ? <Image source={{ uri: coverUri }} style={styles.shapeSquarePreview} /> : <View style={styles.shapeSquareDemo} />}
            </Card>
            <Card onPress={() => handlePickShape('circle')} label="동그라미">
              {coverUri ? <Image source={{ uri: coverUri }} style={styles.shapeCirclePreview} /> : <View style={styles.shapeCircleDemo} />}
            </Card>
          </View>
        )}
        {/* v3.182: 배경 3모드 — 커버 실사 미리보기(대표: "직접 보면서 고르게" — 서버 실렌더 전 근사 미리보기) */}
        {step === 'bg' && (
          <View style={styles.formatRow}>
            <Card onPress={() => handlePickBg('clean')} label="원본 배경">
              {coverUri ? <Image source={{ uri: coverUri }} style={styles.bgPreview} /> : <View style={styles.bgPreviewPh} />}
            </Card>
            <Card onPress={() => handlePickBg('blur')} label="흐린 배경" desc="정도 선택 가능">
              {coverUri ? <Image source={{ uri: coverUri }} style={styles.bgPreview} blurRadius={6} /> : <View style={styles.bgPreviewPh} />}
            </Card>
            <Card onPress={() => handlePickBg('color')} label="색으로 덮기" desc="색·투명도 선택">
              <View>
                {coverUri ? <Image source={{ uri: coverUri }} style={styles.bgPreview} /> : <View style={styles.bgPreviewPh} />}
                <View style={[styles.bgColorOverlay, { backgroundColor: '#1B1035', opacity: 0.6 }]} />
              </View>
            </Card>
            {/* v3.209: 단색 배경 — 원본 이미지 없이 색만 (미리보기도 이미지 없는 순수 색 스와치) */}
            <Card onPress={() => handlePickBg('solid')} label="단색 배경" desc="이미지 없이 색만">
              <View style={styles.bgSolidDemo} />
            </Card>
          </View>
        )}
        {step === 'bgBlurLevel' && (
          <View style={styles.formatRow}>
            {BLUR_LEVELS.map((b) => (
              <Card key={b.key} onPress={() => handlePickBgBlur(b.key as any)} label={b.label}>
                {coverUri ? <Image source={{ uri: coverUri }} style={styles.bgPreview} blurRadius={b.radius} /> : <View style={styles.bgPreviewPh} />}
              </Card>
            ))}
          </View>
        )}
        {step === 'bgColor' && (
          <View style={styles.paletteWrap}>
            {PALETTE.map((hex) => (
              <TouchableOpacity key={hex} style={styles.paletteItem} onPress={() => handlePickBgColor(hex)} activeOpacity={0.8} accessibilityLabel={`배경색 ${hex}`}>
                <View style={[styles.paletteSwatch, { backgroundColor: `#${hex}` }]} />
                <AppText style={styles.paletteHex}>#{hex}</AppText>
              </TouchableOpacity>
            ))}
          </View>
        )}
        {step === 'bgAlpha' && (
          <View style={styles.formatRow}>
            {BG_ALPHAS.map((a) => (
              <Card key={a} onPress={() => handlePickBgAlpha(a)} label={`${a}%`} desc={a === '25' ? '은은하게' : a === '45' ? '중간' : '진하게'}>
                <View>
                  {coverUri ? <Image source={{ uri: coverUri }} style={styles.bgPreview} /> : <View style={styles.bgPreviewPh} />}
                  <View style={[styles.bgColorOverlay, { backgroundColor: `#${pickedBgColor}`, opacity: Number(a) / 100 }]} />
                </View>
              </Card>
            ))}
          </View>
        )}
        {step === 'font' && (
          <View style={styles.paletteWrap}>
            {FONTS.map((f) => (
              <TouchableOpacity key={f.key} style={styles.fontCard} onPress={() => handlePickFont(f.key)} activeOpacity={0.8}>
                <AppText style={{ fontSize: 20, color: colors.text.primary }}>가나다</AppText>
                <AppText style={styles.formatLabel}>{f.label}</AppText>
              </TouchableOpacity>
            ))}
          </View>
        )}
        {step === 'fontStyle' && (
          <View style={styles.paletteWrap}>
            {[
              { b: false, i: false, label: '기본', style: {} },
              { b: true, i: false, label: '굵게', style: { fontWeight: '800' as const } },
              { b: false, i: true, label: '기울임', style: { fontStyle: 'italic' as const } },
              { b: true, i: true, label: '굵게+기울임', style: { fontWeight: '800' as const, fontStyle: 'italic' as const } },
            ].map((o) => (
              <TouchableOpacity key={o.label} style={styles.fontCard} onPress={() => handlePickFontStyle(o.b, o.i)} activeOpacity={0.8}>
                <AppText style={[{ fontSize: 18, color: colors.text.primary }, o.style]}>가사 Aa</AppText>
                <AppText style={styles.formatLabel}>{o.label}</AppText>
              </TouchableOpacity>
            ))}
          </View>
        )}
        {step === 'fontColor' && (
          <View style={styles.paletteWrap}>
            {PALETTE.map((hex) => (
              <TouchableOpacity key={hex} style={styles.paletteItem} onPress={() => handlePickColor(hex)} activeOpacity={0.8} accessibilityLabel={`글자색 ${hex}`}>
                <View style={[styles.paletteSwatch, { backgroundColor: `#${hex}` }]} />
                <AppText style={styles.paletteHex}>#{hex}</AppText>
              </TouchableOpacity>
            ))}
          </View>
        )}
        {/* v3.209: 자막 테두리 유무 — textShadow 근사 미리보기 */}
        {step === 'fontOutline' && (
          <View style={styles.formatRow}>
            <Card onPress={() => handlePickFontOutline(true)} label="테두리 있음" desc="기본 추천">
              <AppText style={styles.outlineDemoOn}>가나다</AppText>
            </Card>
            <Card onPress={() => handlePickFontOutline(false)} label="테두리 없음" desc="글자만 깔끔하게">
              <AppText style={styles.outlineDemoOff}>가나다</AppText>
            </Card>
          </View>
        )}
        {/* v3.209: 테두리 색 — 글자색과 동일 팔레트 재사용, 기본=검정 강조 표시 */}
        {step === 'outlineColor' && (
          <View style={styles.paletteWrap}>
            {PALETTE.map((hex) => (
              <TouchableOpacity key={hex} style={styles.paletteItem} onPress={() => handlePickOutlineColor(hex)} activeOpacity={0.8} accessibilityLabel={`테두리색 ${hex}`}>
                <View style={[styles.paletteSwatch, { backgroundColor: `#${hex}` }, hex === '000000' ? styles.paletteSwatchDefault : null]} />
                <AppText style={styles.paletteHex}>#{hex}{hex === '000000' ? ' (기본)' : ''}</AppText>
              </TouchableOpacity>
            ))}
          </View>
        )}
        {step === 'subPos' && (
          <View style={styles.formatRow}>
            {(['near', 'mid', 'low'] as const).map((sp) => (
              <Card
                key={sp}
                onPress={() => handlePickSubPos(sp)}
                label={sp === 'near' ? (pickedLayout === 'center' ? '이미지 가까이' : '위쪽') : sp === 'mid' ? '중간' : '아래쪽'}
                desc={sp === 'near' && pickedLayout === 'center' ? '기본 추천' : undefined}
              >
                <View style={styles.subPosFrame}>
                  {pickedLayout === 'center' ? <View style={styles.subPosImg} /> : null}
                  <View style={[styles.subPosLine, sp === 'near' ? { top: 30 } : sp === 'mid' ? { top: 42 } : { top: 54 }]} />
                </View>
              </Card>
            ))}
          </View>
        )}
        {step === 'lyricsMode' && (
          <View style={styles.formatRow}>
            <Card onPress={() => handlePickLyrics('scroll')} label="흐르는 가사" desc="여러 줄이 흘러가며 강조">
              <View style={styles.lyricsDemoCol}>
                <View style={[styles.lyricsDemoLine, { width: 34, opacity: 0.4 }]} />
                <View style={[styles.lyricsDemoLine, { width: 46 }]} />
                <View style={[styles.lyricsDemoLine, { width: 34, opacity: 0.4 }]} />
              </View>
            </Card>
            <Card onPress={() => handlePickLyrics('line')} label="한 줄씩" desc="지금 부르는 한 줄만">
              <View style={styles.lyricsDemoCol}>
                <View style={[styles.lyricsDemoLine, { width: 46 }]} />
              </View>
            </Card>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.deepest },
  chatArea: { flex: 1, paddingHorizontal: 14, paddingTop: 12 },
  // v3.182(대표 첨부 스타일): 디렉터 행 — 보라 링 원형 아바타(얼굴 크롭) + 이름 라벨 버블
  directorRow: { flexDirection: 'row', marginBottom: 12, alignItems: 'flex-start' },
  portraitContainer: {
    width: 56, height: 56, borderRadius: 28, overflow: 'hidden',
    borderWidth: 2, borderColor: colors.accent.primary, marginRight: 10,
    backgroundColor: colors.bg.surface1,
  },
  portraitImage: { width: 56, height: 140, resizeMode: 'cover', position: 'absolute', top: 0, left: 0 },
  directorBubble: {
    flex: 1, backgroundColor: colors.bg.surface1, borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  directorName: { fontSize: 12, fontWeight: '700', color: colors.accent.primary, marginBottom: 4 },
  directorText: { fontSize: 14, color: colors.text.primary, lineHeight: 20 },
  // v3.219 [VideoDraft]: 복원 안내 버블 인라인 '처음부터' 액션
  restartInlineBtn: {
    marginTop: 8, alignSelf: 'flex-start', borderWidth: 1, borderColor: colors.accent.primary,
    borderRadius: 12, paddingVertical: 6, paddingHorizontal: 12,
  },
  restartInlineBtnText: { color: colors.accent.primary, fontSize: 12, fontWeight: '700' },
  msgRow: { flexDirection: 'row', marginBottom: 10, alignItems: 'flex-end' },
  msgRowUser: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '78%', borderRadius: 14, paddingHorizontal: 13, paddingVertical: 9 },
  bubbleUser: { backgroundColor: colors.accent.primary, flexDirection: 'row', alignItems: 'center' },
  bubbleUserText: { color: '#fff', fontSize: 14, lineHeight: 20 },
  makingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 66, marginBottom: 10 },
  resultBox: { paddingLeft: 66, gap: 10, marginBottom: 12 },
  previewBase: { borderRadius: 12, backgroundColor: colors.bg.surface1, overflow: 'hidden' },
  primaryBtn: {
    backgroundColor: colors.accent.primary, borderRadius: 12, paddingVertical: 12,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  // v3.214 ⑤: 결과 4버튼 규격 통일 — primaryBtn(padV 12·fs14)과 동일
  outlineBtn: {
    borderWidth: 1, borderColor: colors.accent.primary, borderRadius: 12,
    paddingVertical: 12, alignItems: 'center',
  },
  outlineBtnText: { color: colors.accent.primary, fontWeight: '700', fontSize: 14 },
  inputArea: { borderTopWidth: 1, borderTopColor: colors.border.subtle, padding: 12, paddingBottom: 20 },
  trackRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: colors.border.subtle,
  },
  trackCover: { width: 40, height: 40, borderRadius: 8 },
  trackCoverPh: { backgroundColor: colors.bg.surface2, alignItems: 'center', justifyContent: 'center' },
  trackTitle: { color: colors.text.primary, fontSize: 14, fontWeight: '600' },
  formatRow: { flexDirection: 'row', gap: 8 },
  formatCard: {
    flex: 1, backgroundColor: colors.bg.surface1, borderRadius: 12, padding: 10,
    alignItems: 'center', borderWidth: 1, borderColor: colors.border.subtle,
  },
  ratioBoxWrap: { height: 74, justifyContent: 'center', alignItems: 'center', marginBottom: 6 },
  ratioBox: {
    borderWidth: 1.5, borderColor: colors.accent.primary, borderRadius: 6,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg.surface2,
  },
  formatLabel: { color: colors.text.primary, fontSize: 12, fontWeight: '700', textAlign: 'center', marginTop: 4 },
  formatDesc: { color: colors.text.muted, fontSize: 10, marginTop: 2, textAlign: 'center' },
  layoutFullDemo: { width: 36, height: 64, backgroundColor: colors.accent.primary + '55' },
  layoutCenterDemo: { width: 36, height: 64, justifyContent: 'center', alignItems: 'center' },
  layoutCenterInner: { width: 20, height: 20, borderRadius: 4, backgroundColor: colors.accent.primary + '88' },
  shapeSquareDemo: { width: 44, height: 44, borderRadius: 9, backgroundColor: colors.accent.primary + '66', borderWidth: 1.5, borderColor: colors.accent.primary },
  shapeCircleDemo: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.accent.primary + '66', borderWidth: 1.5, borderColor: colors.accent.primary },
  // v3.182: 커버 실사 미리보기
  shapeSquarePreview: { width: 52, height: 52, borderRadius: 10 },
  shapeCirclePreview: { width: 52, height: 52, borderRadius: 26 },
  bgPreview: { width: 44, height: 70, borderRadius: 8 },
  bgPreviewPh: { width: 44, height: 70, borderRadius: 8, backgroundColor: colors.bg.surface2 },
  bgColorOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 8 },
  // v3.209: 단색 배경 카드 — 이미지 없는 순수 색 스와치
  bgSolidDemo: { width: 44, height: 70, borderRadius: 8, backgroundColor: '#1B1035', borderWidth: 1, borderColor: colors.border.subtle },
  // v3.209: 자막 테두리 미리보기(textShadow 근사) 및 기본색 강조
  outlineDemoOn: {
    fontSize: 20, fontWeight: '700', color: '#FFFFFF',
    textShadowColor: '#000000', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 3,
  },
  outlineDemoOff: { fontSize: 20, fontWeight: '700', color: '#FFFFFF' },
  paletteSwatchDefault: { borderWidth: 2, borderColor: colors.accent.primary },
  // 컬러 팔레트 그리드
  paletteWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  paletteItem: { alignItems: 'center', width: 64, paddingVertical: 4 },
  paletteSwatch: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: colors.border.subtle },
  paletteHex: { fontSize: 9, color: colors.text.muted, marginTop: 3 },
  fontCard: {
    width: 84, alignItems: 'center', backgroundColor: colors.bg.surface1,
    borderRadius: 10, paddingVertical: 10, borderWidth: 1, borderColor: colors.border.subtle,
  },
  // v3.183: 자막 위치 도식 — 세로 프레임 + 이미지 사각 + 자막 막대
  subPosFrame: { width: 36, height: 64, borderRadius: 6, borderWidth: 1.5, borderColor: colors.accent.primary, backgroundColor: colors.bg.surface2, alignItems: 'center' },
  subPosImg: { width: 20, height: 20, borderRadius: 4, backgroundColor: colors.accent.primary + '88', marginTop: 6 },
  subPosLine: { position: 'absolute', width: 24, height: 4, borderRadius: 2, backgroundColor: colors.accent.primary },
  lyricsDemoCol: { gap: 5, alignItems: 'center' },
  lyricsDemoLine: { height: 5, borderRadius: 2, backgroundColor: colors.accent.primary },
});
