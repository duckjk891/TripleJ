import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  StyleSheet,
  View,
  Text,
  Image,
  ScrollView,
  useWindowDimensions,
  Modal,
  TouchableOpacity,
  Animated,
  Easing,
} from 'react-native';
import { showAlert } from '../utils/appAlert';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import Character, { DirectorType } from '../components/Character';
import HomeHeaderActions from '../components/HomeHeaderActions';
import Marquee from '../components/Marquee';
import { useDirectorsStore } from '../stores/directorsStore';
import { useArtistStore } from '../stores/artistStore';
import { useCompanyStore } from '../stores/companyStore';
import { useFanSimulationStore } from '../stores/fanSimulationStore';
import { getArtistRank, getCompanyTier } from '../data/levels';
import { DIRECTOR_CATALOG, getDirectorById } from '../data/directors';
import { useLyricsStore } from '../stores/lyricsStore';
import { useMusicStore } from '../stores/musicStore';
import { useAuthStore } from '../stores/authStore';
import api from '../services/api';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { AppText } from '../components/ui';
import LoginPrompt from '../components/LoginPrompt';
import TutorialOverlay, { TutorialStep } from '../components/TutorialOverlay';
// v3.213: 작업실 튜토리얼 anchor — 디렉터 5종(맵 좌표 계산)+생성 이력(고정 버튼 측정)
import {
  TutorialAnchorKey,
  measureAndRegister,
  registerAnchor,
  unregisterAnchor,
} from '../utils/tutorialAnchors';
import { useUiStore } from '../stores/uiStore';
import { usePointsStore } from '../stores/pointsStore';
import { getFatigueStatusAll, formatCooldown } from '../services/fatigueService';
import { showFatigueCooldownDialog } from '../utils/fatigueGate';
import { FatigueDirector, FatigueStatus } from '../types';

// v3.107: 대기열 타이머(timerStore)·광고 단축 배선 폐지 — 작업은 요청 즉시 로딩 화면으로
// 직행하고, 재요청 제한은 피로도(작곡만 서버 /fatigue/* 게이트)로 표현한다.
// AdMob SDK 자체는 유지(광고권 등 다른 용도 계획) — 이 화면의 큐 단축 배선만 제거됨.

const MAP_BG = require('../assets/map_bg.png');
const MAP_FG = require('../assets/map_fg.png');
// TMX 바닥 레이어 + 가구 제외 flood-fill로 산출된 방별 walkable delta 리스트
// (render_map.py 실행 시 자동 갱신됨)
const WALK_ZONES: Record<string, Array<[number, number]>> =
  require('../assets/director_walk_zones.json');
const MAP_WIDTH = 704;
const MAP_HEIGHT = 2208;

// v3.204 ⑥ → v3.213: 사용자 확정 문안 6스텝 — 디렉터 5(맵 좌표 anchor·자동 스크롤) + 생성 이력.
// 스텝 0~4는 DIRECTORS 배열 순서와 1:1 (onStepChange 자동 스크롤이 이 정렬에 의존).
const TUTORIAL_STEPS: TutorialStep[] = [
  { title: '아티스트 디렉터', desc: '클릭하여 나만의 아티스트를 만들고 의상을 입힐 수 있어요.', anchorKey: 'map-artist' },
  { title: '작사 디렉터', desc: '클릭하여 가사를 작사할 수 있어요.', anchorKey: 'map-lyricist' },
  { title: '작곡 디렉터', desc: '클릭하여 나만의 음악을 만들어요.', anchorKey: 'map-composer' },
  { title: '이미지 디렉터', desc: '클릭하여 내 곡의 커버 이미지를 만들어요.', anchorKey: 'map-image' },
  { title: '영상 디렉터', desc: '클릭하여 SNS, Youtube, 카카오톡에 게시할 영상을 만들어요.', anchorKey: 'map-video' },
  { title: '생성이력', desc: '작업실에서 작업했던 과정을 확인할 수 있어요.', anchorKey: 'map-history' },
];

// v3.213: 디렉터 타입 → anchor 키. 박스는 isNext 펄스와 동일한 (x±70, y±70)*mapScale 140×140 좌표계
const DIRECTOR_ANCHOR_BY_TYPE: Partial<Record<DirectorType, TutorialAnchorKey>> = {
  artist: 'map-artist',
  lyricist: 'map-lyricist',
  composer: 'map-composer',
  image: 'map-image',
  video: 'map-video',
};
const DIRECTOR_ANCHOR_HALF = 70; // 맵 좌표계 반경(= isNext 펄스 140×140 박스와 동일)
const MAP_ANCHOR_KEYS: TutorialAnchorKey[] = [
  'map-artist', 'map-lyricist', 'map-composer', 'map-image', 'map-video', 'map-history',
];

const DIRECTOR_NAMES: Record<DirectorType, string> = {
  artist: '아티스트 디렉터',
  lyricist: '작사 디렉터',
  composer: '작곡 디렉터',
  wondera: '작곡 디렉터',
  image: '이미지 디렉터',
  video: '영상 디렉터',
};

const DIRECTOR_ROLE_EN: Record<DirectorType, string> = {
  artist: 'ARTIST',
  lyricist: 'LYRICIST',
  composer: 'COMPOSER',
  wondera: 'COMPOSER',
  image: 'DESIGNER',
  video: 'FILM DIR.',
};

const DIRECTOR_ROLES: Record<DirectorType, string> = {
  artist: '아티스트 캐릭터를 생성하고 관리합니다',
  lyricist: 'AI로 가사를 작성합니다',
  composer: 'AI로 음악을 제작합니다',
  wondera: 'AI로 음악을 제작합니다',
  image: '앨범 자켓과 MV 씬 이미지를 디자인합니다',
  video: '뮤직비디오를 제작합니다',
};

// 각 디렉터 위치. walk 가능 영역은 WALK_ZONES(JSON)에서 delta 리스트로 제공됨
// (wondera는 v40에서 제거 — 작곡 디렉터는 composer 한 명 표시)
const DIRECTORS = [
  { type: 'artist' as DirectorType,   x: 208, y: 340 },
  { type: 'lyricist' as DirectorType, x: 208, y: 660 },
  { type: 'composer' as DirectorType, x: 208, y: 980 },
  { type: 'image' as DirectorType,    x: 208, y: 1300 },
  { type: 'video' as DirectorType,    x: 208, y: 1620 },
];

// v3.118: 맵 디렉터 타입 → 피로 디렉터 키 (video는 미대상, wondera는 composer 표기 호환)
const FATIGUE_DIRECTOR_BY_TYPE: Partial<Record<DirectorType, FatigueDirector>> = {
  composer: 'composer',
  wondera: 'composer',
  lyricist: 'lyricist',
  image: 'image',
  artist: 'artist',
};
const FATIGUE_DIRECTORS: FatigueDirector[] = ['composer', 'lyricist', 'image', 'artist'];
const ZERO_REMAIN: Record<FatigueDirector, number> = { composer: 0, lyricist: 0, image: 0, artist: 0 };

// v3.107→v3.118: 캐릭터 위에 뜨는 휴식(쿨다운) 티켓 — 전 디렉터(작곡·작사·커버·아티스트)로
// 확장 (서버 /fatigue/status?all=1 기반, 쿨다운 활성 디렉터에만 표시).
// 외부 가로폭은 글자 길이에 따라 유동적 (onLayout으로 측정 → translateX -width/2로 정중앙 정렬)
function DirectorRestTicket({
  d, remainingSec, mapScale, onPress,
}: {
  d: { type: DirectorType; x: number; y: number };
  remainingSec: number;
  mapScale: number;
  onPress?: () => void;
}) {
  const [w, setW] = useState(0);

  return (
    <TouchableOpacity
      activeOpacity={onPress ? 0.7 : 1}
      onPress={onPress}
      disabled={!onPress}
      style={{
        position: 'absolute',
        left: d.x * mapScale,
        top: (d.y - 100) * mapScale,
        zIndex: 20,
        alignItems: 'center',
        transform: [{ translateX: -w / 2 }],
        opacity: w > 0 ? 1 : 0,
      }}
      // v3.105: onLayout→setW→재렌더→onLayout 피드백 방지 — 실제로 변했을 때만 갱신
      // (매초 남은 시간이 바뀌므로 update-depth 경고 방어)
      onLayout={(e) => {
        const nw = e.nativeEvent.layout.width;
        setW((prev) => (Math.abs(prev - nw) < 0.5 ? prev : nw));
      }}
    >
      <LinearGradient
        colors={['#64748b', '#475569']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          borderRadius: 14 * mapScale,
          paddingHorizontal: 14 * mapScale,
          paddingVertical: 8 * mapScale,
          borderWidth: 1.5,
          borderColor: '#94a3b8',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 3 },
          shadowOpacity: 0.4,
          shadowRadius: 6,
          elevation: 6,
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        <Text
          style={{
            color: '#fff',
            fontSize: 12.5,
            fontWeight: '800',
            letterSpacing: 0.2,
          }}
        >
          {`휴식 중 ${formatCooldown(remainingSec)}`}
        </Text>
      </LinearGradient>
      <View
        style={{
          width: 0,
          height: 0,
          borderLeftWidth: 8 * mapScale,
          borderRightWidth: 8 * mapScale,
          borderTopWidth: 8 * mapScale,
          borderLeftColor: 'transparent',
          borderRightColor: 'transparent',
          borderTopColor: '#475569',
        }}
      />
    </TouchableOpacity>
  );
}

type StudioStackParamList = {
  Map: undefined;
  Dialogue: {
    directorType: DirectorType;
    directorName: string;
    directorRole: string;
    directorY: number;
    hasArtist?: boolean; // v3.182: 아티스트 디렉터 분기
  };
  LyricsLoading: undefined;
  MusicLoading: undefined;
};

type Props = NativeStackScreenProps<StudioStackParamList, 'Map'>;

export default function MapScreen({ navigation }: Props) {
  const { width: screenWidth, height: winHeight } = useWindowDimensions();
  const mapScale = screenWidth / MAP_WIDTH;
  const displayHeight = MAP_HEIGHT * mapScale;
  const { user } = useAuthStore();
  const lyricsStore = useLyricsStore();
  const musicStore = useMusicStore();

  const [showLoginOverlay, setShowLoginOverlay] = useState(false);
  const [hasArtistCharacter, setHasArtistCharacter] = useState(false);

  // ── v3.213: 작업실 튜토리얼 anchor — 맵 좌표 기지라 measure 대신 스크롤 오프셋 기반 직접 계산 ──
  // winY = 대상맵y*scale − scrollY + ScrollView 창 오프셋(컨테이너 top = 뷰포트 top).
  const scrollRef = useRef<ScrollView>(null);
  const containerRef = useRef<View>(null);
  const historyBtnRef = useRef<any>(null);
  const scrollYRef = useRef(0);

  const registerDirectorAnchors = useCallback(() => {
    const node = containerRef.current as any;
    node?.measureInWindow?.((sx: number, sy: number) => {
      DIRECTORS.forEach((d) => {
        const key = DIRECTOR_ANCHOR_BY_TYPE[d.type];
        if (!key) return;
        // 화면 밖 rect도 등록 — 오버레이 validAnchor 검사로 카드 fallback되고,
        // onStepChange 자동 스크롤 후 재등록되면 스포트라이트로 승격된다.
        registerAnchor(key, {
          x: sx + (d.x - DIRECTOR_ANCHOR_HALF) * mapScale,
          y: sy + (d.y - DIRECTOR_ANCHOR_HALF) * mapScale - scrollYRef.current,
          width: DIRECTOR_ANCHOR_HALF * 2 * mapScale,
          height: DIRECTOR_ANCHOR_HALF * 2 * mapScale,
        });
      });
    });
  }, [mapScale]);

  // 스텝 전환 시 대상 디렉터로 자동 스크롤 → 정착 후 새 오프셋으로 anchor 재계산.
  // 스텝 0~4 = DIRECTORS[0~4], 스텝 5 = 생성 이력(고정 오버레이 버튼 — 스크롤 무관 재측정만).
  const handleTutorialStepChange = useCallback(
    (index: number) => {
      const d = DIRECTORS[index];
      if (!d) {
        if (historyBtnRef.current) measureAndRegister('map-history', historyBtnRef.current);
        return;
      }
      const targetY = Math.max(
        0,
        Math.min(d.y * mapScale - winHeight * 0.45, displayHeight - 1)
      );
      if (__DEV__) console.info('[Tutorial] map 스텝 자동 스크롤', { index, targetY });
      scrollRef.current?.scrollTo({ y: targetY, animated: true });
      // 애니메이션 정착 대기 후 재등록(onMomentumScrollEnd 미발화 플랫폼 폴백 겸용)
      setTimeout(registerDirectorAnchors, 450);
    },
    [mapScale, winHeight, displayHeight, registerDirectorAnchors]
  );

  // 언마운트 시 작업실 anchor 전체 해제 + 로그아웃 시 생성 이력 버튼 anchor 해제(버튼 언마운트)
  useEffect(() => () => MAP_ANCHOR_KEYS.forEach(unregisterAnchor), []);
  useEffect(() => {
    if (!user) unregisterAnchor('map-history');
  }, [user]);

  // 화면 포커스 시 내 아티스트 존재 여부 확인 (관리/생성 분기용)
  useFocusEffect(
    useCallback(() => {
      if (!user) {
        setHasArtistCharacter(false);
        return;
      }
      let cancelled = false;
      (async () => {
        try {
          const res = await api.get('/character/me');
          if (!cancelled) {
            // v3.81: 실사 또는 가상 시트가 하나라도 있으면 "아티스트 보유" (가상만 있는 계정 포함)
            const ch = res.data?.character;
            setHasArtistCharacter(!!(ch?.sheet_object_name || ch?.virtual_sheet_object_name));
          }
        } catch {
          if (!cancelled) setHasArtistCharacter(false);
        }
      })();
      return () => { cancelled = true; };
    }, [user])
  );
  // v3.207 ⑫: 헤더 ⓘ 재보기 버튼 제거 — tutorialRef도 함께 정리(재보기 수단 소멸은 ⑪과 정합, 의도된 동작)
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // 영입 시스템
  const artistLevel = useArtistStore((s) => s.level);
  const artistSongs = useArtistStore((s) => s.songsReleased);
  const companyLevel = useCompanyStore((s) => s.level);
  const artistRank = getArtistRank(artistLevel);
  const companyTier = getCompanyTier(companyLevel);
  const { hiredIds, selectedByCategory, selectForCategory, initIfEmpty: initDirectors } =
    useDirectorsStore();
  const [directorPickerFor, setDirectorPickerFor] = useState<DirectorType | null>(null);

  // 별(⭐) 잔액 + 전역 모달 액션 (작업실 상단바용)
  const starBalance = usePointsStore((s) => s.balance);
  const fetchStarBalance = usePointsStore((s) => s.fetchBalance);
  const openStarGuide = useUiStore((s) => s.openStarGuide);
  const openAttendance = useUiStore((s) => s.openAttendance);
  const openInvite = useUiStore((s) => s.openInvite);

  // 로그인 시 최초 1회 지급 + 별 잔액 로드
  useEffect(() => {
    if (user) {
      initDirectors();
      fetchStarBalance();
    }
  }, [user]);

  // Studio 탭 헤더: 엔터명 좌측(도움말ⓘ는 v3.207 ⑫ 제거) / 별·출석·초대·마이페이지 우측
  // v3.199(C): 긴 기획사명이 우측 HomeHeaderActions(로그인 시 대략 220~260px)를 침범하지 않게
  // winW 기반 명시 폭 안에 Marquee(넘칠 때만 흐름·짧으면 정적). Marquee container가 width:'100%'라
  // 부모가 명시 폭을 줘야 동작 — bottom-tabs headerTitle 컨테이너는 폭 제약이 느슨해 필수.
  // 360dp 소형 기기에서도 최소 90px 확보. ⓘ는 마퀴 밖 고정(흐르는 텍스트와 분리, 항상 같은 자리에서 탭 가능).
  // v3.202(D안1): 예약폭 260→300 — v3.199 산식이 3화면 headerLeft 화살표(≈38px) 미반영 +
  // HomeHeaderActions 실측 208~229px로 여유가 −1~+20px에 불과해 화살표 6px 순증으로 임계 초과,
  // 타이틀이 우측 액션 위로 넘치던 실기기 결함. 비로그인도 화살표 몫 포함 90 유지.
  const nameMaxWidth = Math.max(90, screenWidth - (user ? 300 : 90));
  useLayoutEffect(() => {
    const parent = navigation.getParent();
    if (!parent) return;
    parent.setOptions({
      headerTitleAlign: 'left',
      // v3.207 ⑫: 헤더는 엔터명 마퀴만 (도움말 ⓘ 제거)
      headerTitle: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: nameMaxWidth }}>
            <Marquee
              text={user?.company_name || '작업실'}
              style={{ fontSize: 17, fontWeight: '700', color: colors.text.primary }}
            />
          </View>
          {/* v3.207 ⑫: 도움말 ⓘ 제거 — 튜토리얼은 ⑪ first-run 게이트 하 최초 1회만 노출 */}
        </View>
      ),
      // v3.201(C): headerLeft: undefined 작성 제거 — Dialogue는 transparentModal이라 Map이 아래에
      // 마운트 유지되는데, user 객체 갱신 등으로 이 이펙트가 재실행되면 대화 도중 3화면이 주입한
      // 화살표를 와이프했다(부 원인). headerLeft 클리어는 아래 useFocusEffect(Map 포커스 시)로 일원화.
      // v3.75: 우측 액션은 차트와 동일한 공용 컴포넌트(별·출석·초대·알림·메시지·마이페이지)로 통일
      headerRight: () => <HomeHeaderActions navigation={parent} />,
      // v3.202(D안4 안전망): 산식이 어긋나도 우측 액션은 절대 줄지 않고(0) 타이틀 컨테이너가
      // 양보(1) — end 컨테이너 flexShrink:0 기본값으로 타이틀이 위로 넘치는 겹침을 차단.
      headerRightContainerStyle: { flexShrink: 0 },
      headerTitleContainerStyle: { flexShrink: 1 },
    });
    // v3.201(C): deps의 user 객체 identity 제거(→ !!user) — 클로저는 user truthiness와 company_name만
    // 사용하므로 충분. identity 유지 시 setUser류 갱신마다 불필요 재실행(와이프 트리거)됐다.
  }, [navigation, user?.company_name, !!user, nameMaxWidth]); // v3.199(C): 회전/폭 변화 반영 · v3.204: 튜토리얼은 ref 기반이라 deps 불필요

  // v3.201(C): "포커스 화면만 헤더에 쓴다" 불변식의 clear 담당 — Map으로 돌아왔을 때만 화살표 제거.
  // 3화면(Dialogue/LyricsInput/ComposerInput)의 blur cleanup을 제거한 대신(경합 주 원인),
  // Map 복귀 후 화살표 잔존 방지(v3.199 우려)를 focus 기반으로 승계한다.
  useFocusEffect(
    useCallback(() => {
      navigation.getParent()?.setOptions({ headerLeft: undefined });
    }, [navigation])
  );

  // 다음 액션 디렉터 펄스 애니메이션
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.15, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    ).start();
  }, []);

  // 가상 팬덤 재생 시뮬레이션 — 24h 갭일 때만 1회 실행
  useEffect(() => {
    if (!user) return;
    const result = useFanSimulationStore.getState().runIfDue();
    if (result && result.plays > 0) {
      const dayLabel = result.daysApplied > 1 ? `${result.daysApplied}일치 ` : '';
      showAlert(
        '오늘의 청취 리포트',
        `${dayLabel}가상 팬덤이 너의 곡을 ${result.plays.toLocaleString()}회 재생했어요!\n인기도 EXP +${result.plays}`,
        [{ text: '확인' }]
      );
    }
  }, [user]);

  // 튜토리얼은 헤더 "❓" 버튼으로 수동 오픈 (자동 팝업 제거)

  // ── v3.107→v3.118: 전 디렉터 피로/쿨다운 (서버 v220 /fatigue/status?all=1 — 1회 조회) ──
  // 서버 게이트: 작곡·작사·커버·아티스트 4종 (각 생성 엔드포인트 ⭐/슬롯 차감 전 429).
  const [fatigueAll, setFatigueAll] = useState<Partial<Record<FatigueDirector, FatigueStatus>>>({});
  const [fatigueRemain, setFatigueRemain] = useState<Record<FatigueDirector, number>>({ ...ZERO_REMAIN });

  const applyFatigueStatus = useCallback((director: FatigueDirector, data: FatigueStatus) => {
    setFatigueAll((prev) => ({ ...prev, [director]: data }));
    setFatigueRemain((prev) => ({
      ...prev,
      [director]: Math.max(0, Math.floor(data?.cooldown_remaining_sec ?? 0)),
    }));
  }, []);

  const refreshFatigue = useCallback(async () => {
    if (!useAuthStore.getState().user) return;
    try {
      const data = await getFatigueStatusAll();
      const dirs = data?.directors || ({} as Record<FatigueDirector, FatigueStatus>);
      setFatigueAll(dirs);
      const remain = { ...ZERO_REMAIN };
      for (const d of FATIGUE_DIRECTORS) {
        remain[d] = Math.max(0, Math.floor(dirs[d]?.cooldown_remaining_sec ?? 0));
      }
      setFatigueRemain(remain);
      const resting = FATIGUE_DIRECTORS.filter((d) => remain[d] > 0);
      if (resting.length > 0) console.log('[Map] [fatigue] 휴식 중 디렉터:', resting.join(','));
    } catch (err: any) {
      // 조회 실패는 게이트 오픈 — 서버 게이트(429)가 최종 방어 (MusicGeneration과 동일 정책)
      console.warn('[Map] [fatigue] 상태(all) 조회 실패:', err?.response?.status, err?.message);
    }
  }, []);

  // 화면 포커스마다 갱신 (생성 완료 후 Map 복귀 시 휴식 티켓 즉시 반영)
  useFocusEffect(
    useCallback(() => {
      if (user) refreshFatigue();
      else {
        setFatigueAll({});
        setFatigueRemain({ ...ZERO_REMAIN });
      }
    }, [user, refreshFatigue])
  );

  // 1초 카운트다운(전 디렉터 공용) — 어떤 디렉터든 0 도달 직전에 서버 재확인 (MusicGeneration 패턴)
  const anyFatigueActive = FATIGUE_DIRECTORS.some((d) => fatigueRemain[d] > 0);
  useEffect(() => {
    if (!anyFatigueActive) return undefined;
    const t = setInterval(() => {
      setFatigueRemain((prev) => {
        const next = { ...prev };
        for (const d of FATIGUE_DIRECTORS) next[d] = Math.max(0, prev[d] - 1);
        return next;
      });
      if (FATIGUE_DIRECTORS.some((d) => fatigueRemain[d] === 1)) refreshFatigue();
    }, 1000);
    return () => clearInterval(t);
  }, [anyFatigueActive, fatigueRemain, refreshFatigue]);

  const openDirectorDialogue = (type: DirectorType) => {
    const director = DIRECTORS.find((d) => d.type === type);
    navigation.navigate('Dialogue', {
      directorType: type,
      directorName: DIRECTOR_NAMES[type],
      directorRole: DIRECTOR_ROLES[type],
      directorY: director?.y ?? 0,
    });
  };

  const handleDirectorPress = (type: DirectorType) => {
    if (!user) {
      setShowLoginOverlay(true);
      return;
    }

    // v3.107→v3.118: 디렉터 휴식(쿨다운) 게이트 — 탭 시 단축 다이얼로그(⭐/광고권).
    // v3.122.1: 아티스트 디렉터는 탭 게이트 제외 — 탭이 내 아티스트 열람·관리(무과금)
    // 진입 경로를 겸하므로 차단이 과함(실테스트 발견). 생성/재생성/꾸미기 시작 지점의
    // 게이트(ArtistInput·Cody·Loading 429)가 과금 방어를 이미 담당한다.
    const fatigueKey = FATIGUE_DIRECTOR_BY_TYPE[type];
    if (fatigueKey && fatigueKey !== 'artist' && fatigueRemain[fatigueKey] > 0) {
      console.log(`[Map] [fatigue:${fatigueKey}] 디렉터 휴식 중 — 남은`, fatigueRemain[fatigueKey], '초');
      showFatigueCooldownDialog({
        status: fatigueAll[fatigueKey] ?? null,
        remainingSec: fatigueRemain[fatigueKey],
        director: fatigueKey,
        onStatusUpdate: (s) => applyFatigueStatus(fatigueKey, s),
        onCleared: () => {
          refreshFatigue();
          proceedDirectorPress(type);
        },
      });
      return;
    }

    proceedDirectorPress(type);
  };

  // v3.118: 휴식 게이트 통과 후의 원래 디렉터 탭 흐름 (기존 handleDirectorPress 본문 분리)
  const proceedDirectorPress = (type: DirectorType) => {

    // 작사 디렉터: 영입한 사람 2명 이상이면 먼저 선택 모달
    if (type === 'lyricist') {
      const hiredLyricists = hiredIds.filter((id) => {
        const d = getDirectorById(id);
        return d?.category === 'lyricist';
      });
      if (hiredLyricists.length > 1) {
        setDirectorPickerFor('lyricist');
        return;
      }
      // 1명이면 자동 선택
      if (hiredLyricists.length === 1 && !selectedByCategory.lyricist) {
        selectForCategory('lyricist', hiredLyricists[0]);
      }
      // 이미 프롬프트가 있으면 리뷰 화면으로
      if (lyricsStore.generatedPrompt) {
        navigation.navigate('LyricsPromptReview' as any);
        return;
      }
    }

    // (Wondera 분기 제거 — v40)

    // 이미지 디렉터: 커버 생성 화면으로 이동
    if (type === 'image') {
      navigation.navigate('CoverGeneration' as any);
      return;
    }

    // v3.179(대표): 영상 디렉터도 다른 디렉터처럼 Dialogue(캐릭터+하단 대화창) 경유 →
    // DialogueScreen video 노드의 action 이 VideoDirector 상세 대화로 넘긴다 (직행 분기 제거)

    // v3.182(대표): 아티스트 디렉터도 항상 Dialogue(캐릭터+대화) 경유 — 기보유면 대화에서
    // 내 아티스트 목록으로 안내(직행 분기 제거). hasArtist는 Dialogue 노드 분기용으로 전달.
    if (type === 'artist') {
      const director = DIRECTORS.find((d) => d.type === 'artist');
      navigation.navigate('Dialogue', {
        directorType: 'artist',
        directorName: DIRECTOR_NAMES.artist,
        directorRole: DIRECTOR_ROLES.artist,
        directorY: director?.y ?? 0,
        hasArtist: hasArtistCharacter,
      });
      return;
    }

    openDirectorDialogue(type);
  };

  // 다음 액션 디렉터 계산 (펄스 강조용)
  const lyricsDone = !!lyricsStore.generatedLyrics;
  const musicDone = !!musicStore.savedTrackId;
  const nextActionDirector: DirectorType = !lyricsDone
    ? 'lyricist'
    : !musicDone
      ? 'composer'
      : 'image';

  return (
    <View style={styles.container} ref={containerRef} collapsable={false}>
      {/* 튜토리얼 힌트 말풍선은 헤더 내부(headerRight)로 이동됨 */}


      <ScrollView
        ref={scrollRef}
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        bounces={false}
        // v3.213: 튜토리얼 anchor용 스크롤 오프셋 추적 + 초기/정착 시 등록
        onLayout={registerDirectorAnchors}
        onScroll={(e) => { scrollYRef.current = e.nativeEvent.contentOffset.y; }}
        onMomentumScrollEnd={registerDirectorAnchors}
        onScrollEndDrag={registerDirectorAnchors}
        scrollEventThrottle={16}
      >
        <View style={{ width: screenWidth, height: displayHeight }}>
          {/* 배경 레이어 — 바닥/벽/가구1까지 (캐릭터 뒤) */}
          <Image
            source={MAP_BG}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: screenWidth,
              height: displayHeight,
            }}
            resizeMode="contain"
          />
          {DIRECTORS.map((d) => {
            // v3.107→v3.118: 휴식(쿨다운) 티켓 — 전 디렉터(쿨다운 활성인 디렉터에만 표시)
            const fatigueKey = FATIGUE_DIRECTOR_BY_TYPE[d.type];
            const restRemain = fatigueKey ? fatigueRemain[fatigueKey] : 0;
            const isResting = !!user && restRemain > 0;
            const isNext = user && d.type === nextActionDirector && !isResting;
            return (
              // wrapper에 zIndex 20 → 캐릭터 + 티켓이 전경 가구(zIndex 15) 위로 올라옴
              <View key={d.type} style={{ zIndex: 20 }}>
                {/* 디렉터 헤드 네임은 Character 컴포넌트 내부에서 이동과 함께 렌더 */}
                {/* 다음 액션 스포트라이트 (캐릭터 뒤 레이어, 테두리 없는 발광) */}
                {isNext && (
                  <Animated.View
                    pointerEvents="none"
                    style={{
                      position: 'absolute',
                      left: (d.x - 70) * mapScale,
                      top: (d.y - 70) * mapScale,
                      width: 140 * mapScale,
                      height: 140 * mapScale,
                      borderRadius: 70 * mapScale,
                      backgroundColor: 'rgba(168, 85, 247, 0.28)',
                      transform: [{ scale: pulseAnim }],
                      shadowColor: colors.accent.primary,
                      shadowOffset: { width: 0, height: 0 },
                      shadowOpacity: 1,
                      shadowRadius: 22,
                      zIndex: 1, // 캐릭터(10) 아래로 → 캐릭터가 펄스 위에 떠 보임
                    }}
                  />
                )}
                {/* "클릭해서 작업 시작!" 배지 — 펄스 위쪽 (클릭 가능) */}
                {isNext && (
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => handleDirectorPress(d.type)}
                    style={{
                      position: 'absolute',
                      left: d.x * mapScale - 140,
                      top: (d.y - 70) * mapScale - 40,
                      width: 280,
                      alignItems: 'center',
                      zIndex: 26,
                    }}
                  >
                    <View style={styles.mapBubble}>
                      <Text style={styles.mapBubbleText} numberOfLines={1}>
                        ▸ 클릭해서 작업 시작!
                      </Text>
                    </View>
                  </TouchableOpacity>
                )}
                <Character
                  type={d.type}
                  x={d.x}
                  y={d.y}
                  mapScale={mapScale}
                  onPress={() => handleDirectorPress(d.type)}
                  name={user ? DIRECTOR_NAMES[d.type] : undefined}
                />
                {/* 휴식(쿨다운) 티켓 — 탭하면 디렉터 클릭과 동일(해당 디렉터 단축 다이얼로그) */}
                {isResting && (
                  <DirectorRestTicket
                    d={d}
                    remainingSec={restRemain}
                    mapScale={mapScale}
                    onPress={() => handleDirectorPress(d.type)}
                  />
                )}
              </View>
            );
          })}
          {/* 전경 레이어 — 가구2~가구5 (캐릭터 앞, 터치 투과) */}
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: screenWidth,
              height: displayHeight,
              zIndex: 15, // 캐릭터(10) 위 / UI 라벨(25~)보다는 아래
            }}
          >
            <Image
              source={MAP_FG}
              style={{ width: screenWidth, height: displayHeight }}
              resizeMode="contain"
            />
          </View>
        </View>
      </ScrollView>

      {/* v3.93: 생성 이력 진입 — 앱 이탈 후에도 진행 중 생성 이어보기/완료 결과 확인 */}
      {user && (
        <TouchableOpacity
          ref={historyBtnRef}
          onLayout={() => measureAndRegister('map-history', historyBtnRef.current)}
          style={styles.historyEntryBtn}
          activeOpacity={0.8}
          onPress={() => {
            console.log('[Map] 생성 이력 진입');
            navigation.navigate('GenerationHistory' as any);
          }}
        >
          <Text style={styles.historyEntryText}>생성 이력</Text>
        </TouchableOpacity>
      )}

      {/* Non-logged-in touch overlay */}
      {!user && !showLoginOverlay && (
        <TouchableOpacity
          style={styles.guestTouchOverlay}
          activeOpacity={1}
          onPress={() => setShowLoginOverlay(true)}
        />
      )}

      {/* Login overlay modal */}
      {!user && showLoginOverlay && (
        <TouchableOpacity
          style={styles.loginOverlay}
          activeOpacity={1}
          onPress={() => setShowLoginOverlay(false)}
        >
          <LoginPrompt
            title="AI 음악 작업실"
            desc={'나만의 음악을 만들어서\n차트에 올려보세요!'}
            onPress={() => navigation.getParent()?.navigate('Settings')}
          />
        </TouchableOpacity>
      )}

      {/* v3.107: 대기열 단계 팝업·광고 보상 팝업 제거 — 결과는 각 로딩 화면이 즉시 보여줌 */}

      {/* 디렉터 선택 모달 (작사 2명 이상 영입 시) */}
      <Modal
        visible={directorPickerFor !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setDirectorPickerFor(null)}
      >
        <View style={styles.popupOverlay}>
          <View style={styles.stagePopup}>
            <TouchableOpacity
              style={styles.popupClose}
              onPress={() => setDirectorPickerFor(null)}
            >
              <Text style={styles.popupCloseText}>✕</Text>
            </TouchableOpacity>
            <Text style={styles.stageDirectorName}>어느 분께 맡기시겠어요?</Text>
            <Text style={[styles.stageProgressText, { marginBottom: 12 }]}>
              영입하신 디렉터 중 한 명을 선택해주세요
            </Text>
            {directorPickerFor &&
              DIRECTOR_CATALOG.filter(
                (d) => d.category === directorPickerFor && hiredIds.includes(d.id)
              ).map((d) => {
                const selected = selectedByCategory[d.category] === d.id;
                return (
                  <TouchableOpacity
                    key={d.id}
                    style={[
                      styles.pickerRow,
                      selected && { borderColor: colors.accent.secondary },
                    ]}
                    onPress={() => {
                      selectForCategory(d.category, d.id);
                      setDirectorPickerFor(null);
                      // 작사의 경우 이미 프롬프트 있으면 리뷰 이동, 없으면 대화 시작
                      if (d.category === 'lyricist') {
                        if (lyricsStore.generatedPrompt) {
                          navigation.navigate('LyricsPromptReview' as any);
                        } else {
                          const director = DIRECTORS.find((x) => x.type === 'lyricist');
                          navigation.navigate('Dialogue', {
                            directorType: 'lyricist',
                            directorName: DIRECTOR_NAMES.lyricist,
                            directorRole: DIRECTOR_ROLES.lyricist,
                            directorY: director?.y ?? 0,
                          });
                        }
                      }
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.pickerName}>{d.name}</Text>
                      <Text style={styles.pickerConcept} numberOfLines={1}>
                        {d.concept}
                      </Text>
                    </View>
                    {selected ? (
                      <Text style={styles.pickerSelBadge}>선택됨</Text>
                    ) : (
                      <Text style={styles.pickerArrow}>→</Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            <TouchableOpacity
              style={[styles.skipBtn, { marginTop: 10 }]}
              onPress={() => {
                setDirectorPickerFor(null);
                navigation.getParent()?.navigate('DirectorLineup' as never);
              }}
            >
              <Text style={styles.skipBtnText}>다른 디렉터 영입하러 가기</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* v3.213: 작업실 튜토리얼 6스텝 — 로그인 시에만(게스트는 guestTouchOverlay 잠금과 정합).
          onStepChange: 화면 밖 디렉터(이미지·영상) 스텝에서 자동 스크롤 후 anchor 재계산 */}
      <TutorialOverlay
        screenKey="map"
        steps={TUTORIAL_STEPS}
        enabled={!!user}
        onStepChange={handleTutorialStepChange}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg.deepest,
  },
  scrollView: {
    flex: 1,
  },
  // v3.93: 생성 이력 진입 버튼 (맵 우상단 오버레이)
  historyEntryBtn: {
    position: 'absolute',
    top: 10,
    right: 12,
    zIndex: 30,
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  historyEntryText: {
    color: colors.text.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  // 디렉터 헤드 네임 (박스 없는 텍스트 전용, 굵은 그림자로 가독성 확보)
  nametagRole: {
    fontSize: 10,
    color: colors.accent.primaryGlow, // 밝은 보라
    fontWeight: '700',
    letterSpacing: 1.5,
    textShadowColor: 'rgba(13, 8, 32, 0.95)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
    marginBottom: 1,
  },
  nametagName: {
    fontSize: 13,
    color: colors.text.primary,
    fontWeight: '800',
    letterSpacing: 0.2,
    textShadowColor: 'rgba(13, 8, 32, 1)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },

  // 맵 위 라벨 공통 스타일 (튜토리얼 힌트와 동일 사이즈, 콘텐츠 기반 폭)
  mapBubble: {
    alignSelf: 'center',
    backgroundColor: colors.accent.primary,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 7,
    shadowColor: colors.bg.deepest,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 5,
  },
  mapBubbleText: {
    color: colors.text.primary,
    fontSize: 12,
    fontWeight: '700',
  },

  // v3.207 ⑫: 헤더 힌트 말풍선 스타일 3종(headerHintBubble/Text/Tail) 삭제 — ⓘ 제거로 참조 0인 죽은 코드 정리

  // 헤더 별 배지 Pill
  starPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.bg.surface2,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginLeft: 2,
    marginRight: 2,
  },

  // 헤더 잔액 Pill
  gemPill: {
    backgroundColor: 'rgba(168, 85, 247, 0.18)',
    borderWidth: 1,
    borderColor: colors.accent.primary,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 4,
  },
  gemPillText: {
    fontSize: 12,
    color: colors.accent.primaryGlow,
    fontWeight: '700',
  },
  // 헤더 레벨 칩 (기획사·아티스트)
  levelPill: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  levelPillText: {
    fontSize: 11,
    color: colors.text.primary,
    fontWeight: '700',
  },
  // 디렉터 선택 모달 행
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg.surface2,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1.5,
    borderColor: colors.border.subtle,
  },
  pickerName: { color: colors.text.primary, fontSize: 15, fontWeight: '700', marginBottom: 4 },
  pickerConcept: { color: colors.text.muted, fontSize: 12 },
  pickerArrow: { color: colors.accent.primary, fontSize: 18, fontWeight: '700', marginLeft: 8 },
  pickerSelBadge: {
    color: colors.accent.secondary,
    fontSize: 11,
    fontWeight: '700',
    backgroundColor: 'rgba(251, 191, 36, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    marginLeft: 8,
  },
  skipBtn: {
    paddingVertical: 11,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: colors.bg.surface2,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  skipBtnText: { color: colors.text.secondary, fontSize: 13, fontWeight: '600' },

  // 디렉터 선택 모달 (구 단계별 팝업 스타일 중 재사용분만 유지 — v3.107)
  stagePopup: {
    width: '100%',
    maxWidth: 460,
    backgroundColor: colors.bg.surface1,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border.accent,
  },
  stageDirectorName: {
    fontSize: 16,
    color: colors.text.primary,
    fontWeight: '700',
    marginBottom: 4,
  },
  stageProgressText: {
    fontSize: 11,
    color: colors.text.muted,
    marginBottom: 14,
  },
  guestTouchOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
  loginOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loginOverlayContent: {
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  loginOverlayIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  loginOverlayTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.text.primary,
    marginBottom: 12,
  },
  loginOverlayDesc: {
    fontSize: 15,
    color: colors.text.secondary,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 28,
  },
  loginOverlayButton: {
    backgroundColor: colors.accent.primary,
    borderRadius: 24,
    paddingVertical: 14,
    paddingHorizontal: 40,
  },
  loginOverlayButtonText: {
    color: colors.text.primary,
    fontSize: 16,
    fontWeight: 'bold',
  },
  // Popup Modal styles
  popupOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  popupClose: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.accent.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  popupCloseText: {
    color: colors.text.primary,
    fontSize: 16,
    fontWeight: 'bold',
  },
});
