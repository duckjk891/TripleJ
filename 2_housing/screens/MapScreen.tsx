import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  StyleSheet,
  View,
  Text,
  Image,
  ScrollView,
  Alert,
  Platform,
  useWindowDimensions,
  Modal,
  TouchableOpacity,
  Animated,
  Easing,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import Character, { DirectorType } from '../components/Character';
import HomeHeaderActions from '../components/HomeHeaderActions';
import { useTimerStore, DIRECTOR_STAGES } from '../stores/timerStore';
import { useGemsStore } from '../stores/gemsStore';
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
import { useUiStore } from '../stores/uiStore';
import { usePointsStore } from '../stores/pointsStore';

// AdMob Rewarded Ad
let RewardedAd: any = null;
let RewardedAdEventType: any = null;

const AD_UNIT_ID = Platform.select({
  ios: 'ca-app-pub-1425041551318467/8070806176',
  android: 'ca-app-pub-1425041551318467/1283416835',
}) ?? '';

// web 플랫폼은 native-only 모듈이라 import 자체 스킵 (metro.config.js에서도 empty 처리)
if (Platform.OS !== 'web') {
  try {
    const admob = require('react-native-google-mobile-ads');
    RewardedAd = admob.RewardedAd;
    RewardedAdEventType = admob.RewardedAdEventType;
  } catch {
    console.log('[AdMob] Not available - using mock ads');
  }
}

const MAP_BG = require('../assets/map_bg.png');
const MAP_FG = require('../assets/map_fg.png');
// TMX 바닥 레이어 + 가구 제외 flood-fill로 산출된 방별 walkable delta 리스트
// (render_map.py 실행 시 자동 갱신됨)
const WALK_ZONES: Record<string, Array<[number, number]>> =
  require('../assets/director_walk_zones.json');
const MAP_WIDTH = 704;
const MAP_HEIGHT = 2208;

const PORTRAITS: Record<string, any> = {
  artist: require('../assets/portraits/artist_director.png'),
  lyricist: require('../assets/portraits/lyricist_director.png'),
  composer: require('../assets/portraits/composer_director.png'),
  image: require('../assets/portraits/image_director.png'),
  video: require('../assets/portraits/video_director.png'),
};

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

// 캐릭터 위에 뜨는 상태 티켓 — 외부 가로폭도 글자 길이에 따라 유동적
// (onLayout으로 측정 → translateX -width/2로 캐릭터 정중앙 정렬)
function DirectorTicket({
  d, task, mapScale, onPress,
}: {
  d: { type: DirectorType; x: number; y: number };
  task: any;
  mapScale: number;
  onPress?: () => void;
}) {
  const [w, setW] = useState(0);

  const tStageKey = task.modelKey && DIRECTOR_STAGES[task.modelKey]
    ? task.modelKey
    : d.type;
  const tStages = DIRECTOR_STAGES[tStageKey] || DIRECTOR_STAGES.lyricist;
  const tProgress = task.initialQueue ? 1 - task.queueNumber / task.initialQueue : 0;
  const tCurrentStageIdx = task.queueNumber <= 0
    ? tStages.length - 1
    : Math.min(tStages.length - 1, Math.max(0, Math.floor(tProgress * tStages.length)));
  const tCurrentStageName = tStages[tCurrentStageIdx]?.name || task.taskName;

  const isDone = task.queueNumber <= 0;
  const gradColors: [string, string] = isDone
    ? ['#10b981', '#059669']
    : ['#7c3aed', '#4338ca'];
  const borderColor = isDone ? '#34d399' : '#a78bfa';
  const notchColor = isDone ? '#059669' : '#4338ca';

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
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
    >
      <LinearGradient
        colors={gradColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          borderRadius: 14 * mapScale,
          paddingHorizontal: 14 * mapScale,
          paddingVertical: 8 * mapScale,
          borderWidth: 1.5,
          borderColor,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 3 },
          shadowOpacity: 0.4,
          shadowRadius: 6,
          elevation: 6,
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        {isDone ? <Text style={{ fontSize: 13, marginRight: 4 }}>✓</Text> : null}
        <Text
          style={{
            color: '#fff',
            fontSize: 12.5,
            fontWeight: '800',
            letterSpacing: 0.2,
          }}
        >
          {isDone
            ? `${task.taskName} 완료!`
            : `${tCurrentStageName} 중...`}
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
          borderTopColor: notchColor,
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
  };
  LyricsLoading: undefined;
  MusicLoading: undefined;
};

type Props = NativeStackScreenProps<StudioStackParamList, 'Map'>;

interface TimerTask {
  directorType: DirectorType;
  taskName: string;
  queueNumber: number;
  startedAt: number;
}

export default function MapScreen({ navigation }: Props) {
  const { width: screenWidth } = useWindowDimensions();
  const mapScale = screenWidth / MAP_WIDTH;
  const displayHeight = MAP_HEIGHT * mapScale;
  const { user } = useAuthStore();
  const timerStore = useTimerStore();
  const lyricsStore = useLyricsStore();
  const musicStore = useMusicStore();

  const [popupTask, setPopupTask] = useState<{ type: DirectorType; task: any } | null>(null);
  const [showLoginOverlay, setShowLoginOverlay] = useState(false);
  const [hasArtistCharacter, setHasArtistCharacter] = useState(false);

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
  const [rewardPopup, setRewardPopup] = useState<{ amount: number; remaining: number } | null>(null);
  const [showTutorial, setShowTutorial] = useState(false);
  const [showTutorialHint, setShowTutorialHint] = useState(true);
  const tutorialShownRef = useRef(false);
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

  // Studio 탭 헤더: (엔터명 + 도움말ⓘ) 좌측 / 별·출석·초대·마이페이지 우측
  useLayoutEffect(() => {
    const parent = navigation.getParent();
    if (!parent) return;
    parent.setOptions({
      headerTitleAlign: 'left',
      // 도움말(ⓘ) 아이콘을 엔터 이름 오른편에 배치 (말풍선 제거)
      headerTitle: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text.primary }} numberOfLines={1}>
            {user?.company_name || '작업실'}
          </Text>
          {user && (
            <TouchableOpacity
              onPress={() => { setShowTutorialHint(false); setShowTutorial((v) => !v); }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="도움말"
            >
              <Text style={{ fontSize: 18, color: colors.text.secondary, fontWeight: '300' }}>{'ⓘ'}</Text>
            </TouchableOpacity>
          )}
        </View>
      ),
      headerLeft: undefined,
      // v3.75: 우측 액션은 차트와 동일한 공용 컴포넌트(별·출석·초대·알림·메시지·마이페이지)로 통일
      headerRight: () => <HomeHeaderActions navigation={parent} />,
    });
  }, [navigation, user?.company_name, user, showTutorial]);

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
      Alert.alert(
        '📊 오늘의 청취 리포트',
        `${dayLabel}가상 팬덤이 너의 곡을 ${result.plays.toLocaleString()}회 재생했어요!\n인기도 EXP +${result.plays}`,
        [{ text: '확인' }]
      );
    }
  }, [user]);

  // 튜토리얼은 헤더 "❓" 버튼으로 수동 오픈 (자동 팝업 제거)

  // 디렉터별 개별 타이머 (모델별 감소 간격 적용)
  useEffect(() => {
    // 1초마다 체크하여 각 디렉터의 감소 간격에 맞춰 감소
    let tickCount = 0;
    const interval = setInterval(() => {
      tickCount++;
      const types: string[] = ['lyricist', 'composer', 'wondera', 'image', 'artist', 'video'];
      for (const t of types) {
        const config = timerStore.getConfig(t);
        if (tickCount % config.tickIntervalSec === 0) {
          timerStore.tickForType(t);
        }
      }
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const showAdAndReduceQueue = (type: DirectorType) => {
    // 한 단계 크기만큼 앞당겨서 "광고 1회 = 현재 단계 스킵"에 가깝게
    const stageSize = timerStore.getStageSize(type);
    const baseReduce = timerStore.getAdReduce(type);
    const reduceAmount = Math.max(stageSize, baseReduce);

    if (RewardedAd) {
      const rewarded = RewardedAd.createForAdRequest(AD_UNIT_ID);
      const unsubLoaded = rewarded.addAdEventListener(
        RewardedAdEventType.LOADED,
        () => rewarded.show()
      );
      const unsubEarned = rewarded.addAdEventListener(
        RewardedAdEventType.EARNED_REWARD,
        () => {
          timerStore.reduceQueue(type, reduceAmount);
          const task = timerStore.getTask(type);
          setRewardPopup({ amount: reduceAmount, remaining: task?.queueNumber ?? 0 });
          // 광고 단계 스킵 보너스
          useGemsStore.getState().earn(5, 'ad_skip_step', type);
          unsubLoaded();
          unsubEarned();
        }
      );
      rewarded.load();
      setTimeout(() => { unsubLoaded(); unsubEarned(); }, 15000);
    } else {
      // Mock ad for Expo Go
      setRewardPopup({ amount: 0, remaining: 0 }); // 로딩 표시
      setTimeout(() => {
        timerStore.reduceQueue(type, reduceAmount);
        const task = timerStore.getTask(type);
        setRewardPopup({ amount: reduceAmount, remaining: task?.queueNumber ?? 0 });
        useGemsStore.getState().earn(5, 'ad_skip_step_mock', type);
      }, 2000);
    }
  };

  const handleDirectorPress = (type: DirectorType) => {
    if (!user) {
      setShowLoginOverlay(true);
      return;
    }
    const task = timerStore.getTask(type);

    if (task) {
      // 진행 중이든 완료든 popup 모달 표시 (popup 안에서 상태별 분기)
      setPopupTask({ type, task });
      return;
    }

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

    // 비디오 디렉터: 준비 중
    if (type === 'video') {
      Alert.alert('안내', 'MV 제작 기능은 준비 중입니다.');
      return;
    }

    // 아티스트 디렉터: 이미 아티스트가 있으면 목록(MyArtists)으로, 없으면 Dialogue → ArtistInput
    if (type === 'artist') {
      if (hasArtistCharacter) {
        // v3.81: 아티스트 1명=슬롯 1개 모델 — 목록에서 카드 탭 시 상세(ArtistResult) 진입
        navigation.navigate('MyArtists' as any);
        return;
      }
      const director = DIRECTORS.find((d) => d.type === 'artist');
      navigation.navigate('Dialogue', {
        directorType: 'artist',
        directorName: DIRECTOR_NAMES.artist,
        directorRole: DIRECTOR_ROLES.artist,
        directorY: director?.y ?? 0,
      });
      return;
    }

    const director = DIRECTORS.find((d) => d.type === type);
    navigation.navigate('Dialogue', {
      directorType: type,
      directorName: DIRECTOR_NAMES[type],
      directorRole: DIRECTOR_ROLES[type],
      directorY: director?.y ?? 0,
    });
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
    <View style={styles.container}>
      {/* 튜토리얼 힌트 말풍선은 헤더 내부(headerRight)로 이동됨 */}


      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        bounces={false}
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
            const task = timerStore.getTask(d.type);
            const isNext = user && d.type === nextActionDirector && !task;
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
                {/* Queue status above director - 유동 너비 ticket (탭하면 디렉터 클릭과 동일) */}
                {task && (
                  <DirectorTicket
                    d={d}
                    task={task}
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

      {/* 단계별 진행 팝업 */}
      <Modal visible={popupTask !== null} transparent animationType="fade" onRequestClose={() => setPopupTask(null)}>
        <View style={styles.popupOverlay}>
          <View style={styles.stagePopup}>
            {/* Close */}
            <TouchableOpacity style={styles.popupClose} onPress={() => setPopupTask(null)}>
              <Text style={styles.popupCloseText}>✕</Text>
            </TouchableOpacity>

            {/* Header: 디렉터 초상 + 이름 + 상태 */}
            {popupTask && (() => {
              // modelKey 기반으로 stage 세트 선택 (artist_refine/artist_outfit 등 모드별 분기)
              const stageKey = popupTask.task.modelKey && DIRECTOR_STAGES[popupTask.task.modelKey]
                ? popupTask.task.modelKey
                : popupTask.type;
              const stages = DIRECTOR_STAGES[stageKey] || DIRECTOR_STAGES.lyricist;
              const totalStages = stages.length;
              const progress = popupTask.task.initialQueue
                ? 1 - popupTask.task.queueNumber / popupTask.task.initialQueue
                : 0;
              // queue 진행률 → stage 매핑 (stage 개수에 맞게 계산)
              const currentStage = popupTask.task.queueNumber <= 0
                ? totalStages - 1
                : Math.min(totalStages - 1, Math.max(0, Math.floor(progress * totalStages)));
              const stage = stages[currentStage];
              return (
                <>
                  <View style={styles.stageHeader}>
                    <View style={styles.stageHeaderPortrait}>
                      <Image source={PORTRAITS[popupTask.type]} style={styles.stageHeaderPortraitImg} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.stageDirectorName}>{DIRECTOR_NAMES[popupTask.type]}</Text>
                      <Text style={styles.stageStatusBadge}>
                        {popupTask.task.queueNumber <= 0
                          ? `${popupTask.task.taskName} 완료!`
                          : `${popupTask.task.taskName} 중`}
                      </Text>
                    </View>
                  </View>

                  {/* 전체 진행률 바 */}
                  <View style={styles.stageProgressBarBg}>
                    <View style={[styles.stageProgressBarFill, { width: `${Math.round(progress * 100)}%` }]} />
                  </View>
                  <Text style={styles.stageProgressText}>
                    전체 진행 {Math.round(progress * 100)}%
                  </Text>

                  {/* 6단계 스테퍼 */}
                  <View style={styles.stagesRow}>
                    {stages.map((s, i) => {
                      const state = i < currentStage ? 'done' : i === currentStage ? 'active' : 'pending';
                      return (
                        <View key={s.name} style={styles.stageCell}>
                          <View
                            style={[
                              styles.stageDot,
                              state === 'active' && styles.stageDotActive,
                              state === 'done' && styles.stageDotDone,
                            ]}
                          >
                            <Text style={styles.stageDotIcon}>{state === 'done' ? '✓' : s.icon}</Text>
                          </View>
                          <Text
                            style={[
                              styles.stageDotLabel,
                              state === 'active' && styles.stageDotLabelActive,
                              state === 'done' && styles.stageDotLabelDone,
                            ]}
                            numberOfLines={1}
                          >
                            {s.name}
                          </Text>
                        </View>
                      );
                    })}
                  </View>

                  {/* 현재 단계 상세 카드 */}
                  <View style={styles.currentStageBox}>
                    <Text style={styles.currentStageLabel}>
                      {currentStage + 1}단계 / {totalStages}  ·  {stage?.icon} {stage?.name}
                    </Text>
                    <Text style={styles.currentStageDesc}>{stage?.description}</Text>
                  </View>

                  {/* 액션 버튼 — 진행 중: 광고 / 완료: 결과 보기 */}
                  {popupTask.task.queueNumber <= 0 ? (
                    <>
                      <TouchableOpacity
                        style={styles.adButton}
                        onPress={() => {
                          if (!popupTask) return;
                          const t = popupTask.type;
                          const taskName = popupTask.task.taskName;
                          timerStore.completeTask(t);
                          setPopupTask(null);
                          // 결과 화면 분기
                          if (t === 'artist') {
                            // 아티스트: ArtistLoading에서 API 호출 후 ArtistResult로 자동 이동
                            navigation.navigate('ArtistLoading' as any);
                          } else if (taskName.includes('작사')) {
                            navigation.navigate('LyricsLoading' as any);
                          } else if (taskName.includes('커버')) {
                            navigation.navigate('CoverGeneration' as any);
                          } else {
                            navigation.navigate('MusicLoading' as any);
                          }
                        }}
                      >
                        <Text style={styles.adButtonIcon}>🎉</Text>
                        <Text style={styles.adButtonText}>결과 보기</Text>
                      </TouchableOpacity>
                      <Text style={styles.adHelperText}>
                        작업이 완료됐어요!
                      </Text>
                    </>
                  ) : (
                    <>
                      <TouchableOpacity
                        style={styles.adButton}
                        onPress={() => {
                          if (popupTask) {
                            showAdAndReduceQueue(popupTask.type);
                            setPopupTask(null);
                          }
                        }}
                      >
                        <Text style={styles.adButtonIcon}>▶</Text>
                        <Text style={styles.adButtonText}>광고 보고 이 단계 빠르게 끝내기</Text>
                      </TouchableOpacity>
                      <Text style={styles.adHelperText}>
                        광고 1회 시청 시 현재 단계의 작업 속도가 빨라져요
                      </Text>
                    </>
                  )}
                </>
              );
            })()}
          </View>
        </View>
      </Modal>

      {/* 보상 팝업 */}
      <Modal visible={rewardPopup !== null} transparent animationType="fade" onRequestClose={() => setRewardPopup(null)}>
        <View style={styles.popupOverlay}>
          <View style={styles.rewardContainer}>
            {rewardPopup && rewardPopup.amount === 0 ? (
              <>
                <Text style={styles.rewardIcon}>{'⏳'}</Text>
                <Text style={styles.rewardTitle}>광고 로딩 중...</Text>
              </>
            ) : rewardPopup ? (
              <>
                <Text style={styles.rewardIcon}>{'🎉'}</Text>
                <Text style={styles.rewardTitle}>단계가 앞당겨졌어요!</Text>
                {rewardPopup.remaining > 0 && (
                  <Text style={styles.rewardHint}>디렉터가 다음 단계를 진행 중이에요</Text>
                )}
                {rewardPopup.remaining <= 0 && (
                  <Text style={styles.rewardComplete}>완료! 디렉터를 클릭하세요!</Text>
                )}
                <TouchableOpacity style={styles.rewardButton} onPress={() => setRewardPopup(null)}>
                  <Text style={styles.rewardButtonText}>확인</Text>
                </TouchableOpacity>
              </>
            ) : null}
          </View>
        </View>
      </Modal>

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

      {/* 첫 방문 튜토리얼 */}
      <Modal visible={showTutorial} transparent animationType="fade" onRequestClose={() => setShowTutorial(false)}>
        <View style={styles.tutorialOverlay}>
          <View style={styles.tutorialBox}>
            <Text style={styles.tutorialTitle}>👋 작업실에 오신 걸 환영해요!</Text>
            <View style={styles.tutorialItem}>
              <Text style={styles.tutorialNum}>1</Text>
              <Text style={styles.tutorialText}>각 디렉터를 탭해서 작업을 맡기세요</Text>
            </View>
            <View style={styles.tutorialItem}>
              <Text style={styles.tutorialNum}>2</Text>
              <Text style={styles.tutorialText}>빛나는 디렉터가 다음 작업할 분이에요</Text>
            </View>
            <View style={styles.tutorialItem}>
              <Text style={styles.tutorialNum}>3</Text>
              <Text style={styles.tutorialText}>디렉터를 누르면 6단계 진행 상황을 볼 수 있어요</Text>
            </View>
            <View style={styles.tutorialItem}>
              <Text style={styles.tutorialNum}>4</Text>
              <Text style={styles.tutorialText}>광고를 보면 현재 단계를 빠르게 끝낼 수 있어요</Text>
            </View>
            <TouchableOpacity style={styles.tutorialBtn} onPress={() => setShowTutorial(false)}>
              <Text style={styles.tutorialBtnText}>시작하기</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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

  // 헤더 내부 튜토리얼 힌트 말풍선 (꼬리가 오른쪽 ⓘ 아이콘을 가리킴)
  headerHintBubble: {
    backgroundColor: colors.accent.primary,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
    shadowColor: colors.bg.deepest,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 5,
    elevation: 5,
  },
  headerHintText: {
    color: colors.text.primary,
    fontSize: 11,
    fontWeight: '700',
  },
  headerHintTail: {
    // 오른쪽을 향하는 삼각형 (말풍선 오른쪽 옆)
    width: 0,
    height: 0,
    borderTopWidth: 5,
    borderBottomWidth: 5,
    borderLeftWidth: 6,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: colors.accent.primary,
    marginLeft: -1,
  },

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

  // 단계별 팝업
  stagePopup: {
    width: '100%',
    maxWidth: 460,
    backgroundColor: colors.bg.surface1,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border.accent,
  },
  stageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 14,
  },
  stageHeaderPortrait: {
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 2,
    borderColor: colors.accent.primary,
    backgroundColor: colors.bg.surface2,
    overflow: 'hidden',
  },
  // 95x405 전신 → 얼굴 + 목+어깨 살짝: 1.1x zoom + top 약간 음수
  stageHeaderPortraitImg: {
    width: 54 * 1.1,
    height: (54 * 1.1) * 405 / 95,
    position: 'absolute',
    top: -54 / 15,
    left: -(54 * 1.1 - 54) / 2,
  },
  stageDirectorName: {
    fontSize: 16,
    color: colors.text.primary,
    fontWeight: '700',
    marginBottom: 4,
  },
  stageStatusBadge: {
    alignSelf: 'flex-start',
    fontSize: 11,
    color: colors.accent.primary,
    fontWeight: '700',
    backgroundColor: 'rgba(168, 85, 247, 0.15)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  stageProgressBarBg: {
    height: 6,
    backgroundColor: colors.bg.surface2,
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 6,
  },
  stageProgressBarFill: {
    height: '100%',
    backgroundColor: colors.accent.primary,
    borderRadius: 3,
  },
  stageProgressText: {
    fontSize: 11,
    color: colors.text.muted,
    marginBottom: 14,
  },
  stagesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 14,
    paddingHorizontal: 2,
  },
  stageCell: {
    flex: 1,
    alignItems: 'center',
  },
  stageDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.bg.surface2,
    borderWidth: 1.5,
    borderColor: colors.border.subtle,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  stageDotActive: {
    backgroundColor: colors.accent.primary,
    borderColor: colors.accent.primary,
  },
  stageDotDone: {
    backgroundColor: colors.bg.surface2,
    borderColor: colors.accent.primary,
  },
  stageDotIcon: {
    fontSize: 14,
  },
  stageDotLabel: {
    fontSize: 9,
    color: colors.text.muted,
    textAlign: 'center',
  },
  stageDotLabelActive: {
    color: colors.accent.primary,
    fontWeight: '700',
  },
  stageDotLabelDone: {
    color: colors.text.secondary,
  },
  currentStageBox: {
    backgroundColor: colors.bg.surface2,
    borderRadius: 12,
    padding: 14,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent.primary,
    marginBottom: 14,
  },
  currentStageLabel: {
    fontSize: 12,
    color: colors.accent.primary,
    fontWeight: '700',
    marginBottom: 6,
    letterSpacing: 0.3,
  },
  currentStageDesc: {
    fontSize: 14,
    color: colors.text.primary,
    lineHeight: 20,
  },
  adHelperText: {
    fontSize: 11,
    color: colors.text.muted,
    textAlign: 'center',
    marginTop: 8,
  },
  tutorialOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  tutorialBox: {
    backgroundColor: colors.bg.surface1,
    borderRadius: 18,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    borderWidth: 1,
    borderColor: colors.border.accent,
  },
  tutorialTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text.primary,
    marginBottom: 18,
    textAlign: 'center',
  },
  tutorialItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  tutorialNum: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.accent.primary,
    color: colors.text.primary,
    fontSize: 13,
    fontWeight: 'bold',
    textAlign: 'center',
    lineHeight: 28,
    marginRight: 12,
  },
  tutorialText: {
    flex: 1,
    color: colors.text.secondary,
    fontSize: 14,
    lineHeight: 20,
  },
  tutorialBtn: {
    marginTop: 12,
    backgroundColor: colors.accent.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  tutorialBtnText: {
    color: colors.text.primary,
    fontSize: 15,
    fontWeight: 'bold',
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
  popupContainer: {
    width: '85%',
    backgroundColor: colors.bg.surface1,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: colors.accent.primary,
    padding: 24,
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
  popupTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.text.primary,
    marginBottom: 16,
  },
  popupPortrait: {
    width: 100,
    height: 160,
    marginBottom: 16,
  },
  queueBadge: {
    backgroundColor: colors.bg.deepest,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.accent.primary,
    paddingVertical: 8,
    paddingHorizontal: 20,
    alignItems: 'center',
    marginBottom: 16,
  },
  queueLabel: {
    color: colors.text.secondary,
    fontSize: 12,
  },
  queueNumber: {
    color: colors.accent.primary,
    fontSize: 28,
    fontWeight: 'bold',
  },
  popupDesc: {
    color: colors.text.secondary,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 20,
  },
  adButton: {
    flexDirection: 'row',
    backgroundColor: colors.accent.primary,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 24,
    gap: 8,
    alignItems: 'center',
  },
  adButtonIcon: {
    color: colors.text.primary,
    fontSize: 16,
  },
  adButtonText: {
    color: colors.text.primary,
    fontSize: 16,
    fontWeight: 'bold',
  },
  rewardContainer: {
    backgroundColor: colors.bg.surface1,
    borderRadius: 20,
    padding: 32,
    alignItems: 'center',
    width: '80%',
    borderWidth: 2,
    borderColor: colors.accent.primary,
  },
  rewardIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  rewardTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.text.primary,
    marginBottom: 20,
  },
  rewardNumberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 12,
  },
  rewardAmount: {
    fontSize: 32,
    fontWeight: 'bold',
    color: colors.accent.primary,
  },
  rewardArrow: {
    fontSize: 24,
    color: colors.text.muted,
  },
  rewardRemaining: {
    fontSize: 32,
    fontWeight: 'bold',
    color: colors.status.success,
  },
  rewardHint: {
    fontSize: 14,
    color: colors.text.secondary,
    marginBottom: 20,
  },
  rewardComplete: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.status.success,
    marginBottom: 20,
  },
  rewardButton: {
    backgroundColor: colors.accent.primary,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 40,
  },
  rewardButtonText: {
    color: colors.text.primary,
    fontSize: 16,
    fontWeight: 'bold',
  },
});
