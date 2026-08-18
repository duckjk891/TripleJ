import { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Image,
  Alert,
  Dimensions,
  ScrollView,
  Modal,
  Animated,
  SafeAreaView,
  Linking,
  FlatList,
  Platform,
} from 'react-native';
import { Audio } from 'expo-av';
import Slider from '@react-native-community/slider';
import Svg, { Path } from 'react-native-svg';
import { Feather } from '@expo/vector-icons';
import api, { BACKEND_BASE_URL } from '../services/api';
import { usePlayerStore } from '../stores/playerStore';
import { usePointsStore } from '../stores/pointsStore';
import LyricSyncView, { LyricSegment } from '../components/LyricSyncView';
import DraggableQueue from '../components/DraggableQueue';
import { useArtistStore } from '../stores/artistStore';
import { useAuthStore } from '../stores/authStore';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { AppText, Tag } from '../components/ui';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface AdItem {
  id: string;
  user_id?: string;
  title?: string;
  category?: string;
  image_url?: string;
  link_url?: string;
  brand?: string;
  advertiser_nickname?: string;
}

const AD_CATEGORY_ICON: Record<string, string> = {
  '상의': '👕', '하의': '👖', '신발': '👟', '장소': '📍',
};

interface UsedItem {
  id?: string;
  name?: string;
  image_object_name?: string;
  product_url?: string;
  category?: string;
}

interface CoverCharacter {
  name?: string;
  age?: string;
  personality_tags?: string[];
  personality_text?: string;
  sheet_preview_path?: string;
  used_items?: UsedItem[];
}

interface TrackData {
  id: string;
  title: string;
  artist_name?: string;
  uploader_id?: string;
  uploader_nickname?: string;
  cover_image?: string;
  cover_image_url?: string;
  play_count?: number;
  like_count?: number;
  genre?: string | string[];
  mood?: string | string[];
  tags?: string[];
  bpm?: number | string;
  key?: string;
  audio_url?: string;
  duration_sec?: number;
  lyrics?: string;
  prompt?: string;
  ai_model?: string;
  created_at?: string;
  // 9004: 곡 만들 때 아티스트가 착용한 의상 스냅샷
  cover_character?: CoverCharacter | null;
}

function formatTime(millis: number): string {
  const totalSec = Math.floor(millis / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

// 셔플 아이콘 (Material Design 표준 path)
function ShuffleIcon({ active }: { active: boolean }) {
  const color = active ? colors.accent.primary : colors.text.muted;
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24">
      <Path
        d="M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"
        fill={color}
      />
    </Svg>
  );
}

// 반복 아이콘 (Material Design 표준 path)
//  off  → repeat (회색)
//  all  → repeat (보라)
//  one  → repeat_one (보라 + 가운데 "1")
function RepeatIcon({ mode }: { mode: 'off' | 'all' | 'one' }) {
  const color = mode !== 'off' ? colors.accent.primary : colors.text.muted;
  if (mode === 'one') {
    return (
      <Svg width={24} height={24} viewBox="0 0 24 24">
        <Path
          d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z"
          fill={color}
        />
      </Svg>
    );
  }
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24">
      <Path
        d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"
        fill={color}
      />
    </Svg>
  );
}

export default function PlayerScreen({ route, navigation }: any) {
  const routeTrack: TrackData = route.params?.track;
  const playerStore = usePlayerStore();
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showQueue, setShowQueue] = useState(!!route.params?.openQueue); // 미니플레이어에서 재생목록 바로열기
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isLiked, setIsLiked] = useState(false);
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekValue, setSeekValue] = useState(0);       // 드래그 중 슬라이더 위치(웹 리셋 방지)
  const isSeekingRef = useRef(false);                  // 콜백 클로저 stale 방지(라이브 값)
  const recordedTrackRef = useRef<string | null>(null); // 70% 재생 기록 완료한 트랙(중복 방지)
  const [mediaTab, setMediaTab] = useState<'song' | 'video'>('song');   // 노래/동영상 전환
  const [lyricsTimeline, setLyricsTimeline] = useState<LyricSegment[]>([]);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const lyricsFetchedRef = useRef<string | null>(null);                 // timeline 조회한 트랙
  const [showDetails, setShowDetails] = useState(false);
  const [detailTab, setDetailTab] = useState<'lyrics' | 'prompt' | 'outfit' | 'info'>('lyrics');
  const [fullTrack, setFullTrack] = useState<TrackData | null>(null);
  const [ads, setAds] = useState<AdItem[]>([]);
  const impressionLoggedRef = useRef<Set<string>>(new Set());
  const soundRef = useRef<Audio.Sound | null>(null);
  // 🔑 [PlayerScreen] routeTrack 효과의 "최초 mount 실행"을 건너뛰기 위한 플래그.
  // 초기 로드는 아래 [] 효과의 loadAndPlay가 전담한다. 둘 다 createAsync({shouldPlay:true})
  // 하면 사운드가 2개 동시에 재생되어 하나가 고아가 되고, pause/미니플레이어 닫기가 안 먹힌다.
  const routeTrackInitRef = useRef(true);

  // route 전달 track은 차트/리스트의 축약 객체라 prompt/lyrics/bpm 등이 비어있을 수 있음
  // → full track을 따로 가져와 상세 화면에서 사용
  // store.track 구독 → prev/next로 곡 바뀌면 화면도 즉시 갱신 (navigation.replace 없이)
  const storeTrack = usePlayerStore((s) => s.track);
  const track: TrackData = fullTrack || storeTrack || routeTrack;

  const getCoverUri = (): string | null => {
    const img = track?.cover_image || track?.cover_image_url;
    if (!img) return null;
    return `${BACKEND_BASE_URL}/api/upload/cover-preview/${encodeURIComponent(img)}`;
  };

  // 70% 위치 도달 시 재생 기록(별 +1) — MAIDOL과 동일하게 위치 기반(seek 허용). 트랙당 1회.
  const PLAY_RECORD_RATIO = 0.7;
  const recordPlayIfNeeded = (positionMillis: number, durationMillis: number) => {
    if (!durationMillis || durationMillis <= 0) return;
    const tid = usePlayerStore.getState().track?.id;
    if (!tid || recordedTrackRef.current === tid) return;
    if (positionMillis >= durationMillis * PLAY_RECORD_RATIO) {
      recordedTrackRef.current = tid;
      if (__DEV__) console.info('[PlayerScreen] 70% 재생 기록', { tid });
      api.post('/charts/record-play', { track_id: tid })
        .then(() => { usePointsStore.getState().fetchBalance(); }) // 별 배지 갱신
        .catch((err: any) => console.error('[PlayerScreen] record-play 실패', { status: err?.response?.status }));
    }
  };

  const onPlaybackStatusUpdate = (status: any) => {
    if (status.isLoaded) {
      // isSeekingRef(live) — 드래그 중엔 재생바를 status로 덮어쓰지 않음
      if (!isSeekingRef.current) {
        setPosition(status.positionMillis);
        playerStore.setPosition(status.positionMillis);
      }
      setDuration(status.durationMillis || 0);
      playerStore.setDuration(status.durationMillis || 0);
      setIsPlaying(status.isPlaying);
      playerStore.setIsPlaying(status.isPlaying);
      // 70% 도달(또는 seek로 넘김) 시 재생 기록 — 위치 기반
      recordPlayIfNeeded(status.positionMillis, status.durationMillis || 0);
      if (status.didJustFinish) {
        // 재생 완료 EXP — 내 아티스트 +1
        useArtistStore.getState().addExp(1, 'play');
        // 셔플/반복 모드 반영한 다음 인덱스
        const store = usePlayerStore.getState();
        const nextIdx = store.getNextIndex();
        if (nextIdx >= 0 && store.queue[nextIdx]) {
          const nextTrack = store.queue[nextIdx];
          store.playTrackAtIndex(nextIdx);
          // 큰 화면이든 미니든 sound 직접 교체 → 슬라이드 애니메이션 없이 곡만 전환
          (async () => {
            try {
              if (soundRef.current) {
                await soundRef.current.unloadAsync().catch(() => {});
              }
              const audioUrl = await getAudioUri(nextTrack.id);
              const { sound: newSound } = await Audio.Sound.createAsync(
                { uri: audioUrl },
                { shouldPlay: true },
                onPlaybackStatusUpdate,
              );
              soundRef.current = newSound;
              store.setSound(newSound);
              store.setTrack(nextTrack);
              store.setIsPlaying(true);
              if (store.isPlayerScreenOpen) {
                setSound(newSound);
                setIsPlaying(true);
                setPosition(0);
              }
            } catch (err) {
              console.warn('[Player] 자동재생 실패:', err);
            }
          })();
        } else {
          setIsPlaying(false);
          setPosition(0);
          playerStore.setIsPlaying(false);
        }
      }
    }
  };

  // 오디오 소스 결정. 웹: Range(206) 지원 presigned URL(/tracks/stream) → 실제 seek 가능.
  //            네이티브: stream-proxy(버퍼링으로 seek 정상, presigned 호스트 도달성 회피).
  const getAudioUri = async (id: string): Promise<string> => {
    const proxy = `${BACKEND_BASE_URL}/api/tracks/stream-proxy/${id}`;
    if (Platform.OS !== 'web') return proxy;
    try {
      const res = await api.get(`/tracks/stream/${id}`);
      const url = res.data?.stream_url;
      if (__DEV__) console.info('[PlayerScreen] web audio = presigned(stream)', { ok: !!url });
      return url || proxy;
    } catch (err: any) {
      console.error('[PlayerScreen] stream presigned 실패 → proxy 폴백', { status: err?.response?.status });
      return proxy;
    }
  };

  const loadAndPlay = async (target: TrackData = track) => {
    if (!target?.id) return;
    try {
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
      }

      // Use proxy endpoint that streams audio directly through the backend
      // This avoids MinIO presigned URL host mismatch (localhost vs IP)
      const audioUrl = await getAudioUri(target.id);
      if (__DEV__) console.info('[PlayerScreen] loadAndPlay', { id: target.id });

      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
      });

      const { sound: newSound } = await Audio.Sound.createAsync(
        { uri: audioUrl },
        { shouldPlay: true },
        onPlaybackStatusUpdate
      );
      soundRef.current = newSound;
      setSound(newSound);
      // 전역 playerStore에 저장 (미니 플레이어용)
      playerStore.setSound(newSound);
      playerStore.setTrack(target);
      playerStore.setIsPlaying(true);
      setIsPlaying(true);
      setPosition(0);
    } catch (err) {
      console.error('Audio load error:', err);
    }
  };

  // 풀 트랙 정보 조회 (prompt/lyrics/bpm 등 상세 필드 포함)
  // currentId 우선: 곡 전환 시 storeTrack.id로 fetch
  const currentId = storeTrack?.id || routeTrack?.id;
  useEffect(() => {
    if (!currentId) return;
    let cancelled = false;
    // 이전 곡의 fullTrack은 일단 비우고 다시 fetch
    setFullTrack(null);
    // 곡 전환 시 미디어탭/가사싱크 초기화
    setMediaTab('song');
    setLyricsTimeline([]);
    lyricsFetchedRef.current = null;
    (async () => {
      try {
        const res = await api.get(`/tracks/${currentId}`);
        if (!cancelled && res.data) setFullTrack(res.data);
      } catch (err) {
        console.warn('[Player] 풀 트랙 조회 실패:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [currentId]);

  // 동영상 탭 열기 — 가사 싱크(lyrics-timeline) 로드(트랙당 1회)
  const openVideoTab = async () => {
    setMediaTab('video');
    const tid = usePlayerStore.getState().track?.id || currentId;
    if (!tid || lyricsFetchedRef.current === tid) return;
    lyricsFetchedRef.current = tid;
    setLyricsLoading(true);
    if (__DEV__) console.info('[PlayerScreen] 동영상탭 — lyrics-timeline 로드', { tid });
    try {
      const res = await api.get(`/tracks/${tid}/lyrics-timeline`);
      const segs = res.data?.has_timestamps ? (res.data?.segments || []) : [];
      setLyricsTimeline(segs);
    } catch (err: any) {
      console.error('[PlayerScreen] lyrics-timeline 실패', { status: err?.response?.status });
      setLyricsTimeline([]);
    } finally {
      setLyricsLoading(false);
    }
  };

  // 아티스트 광고 아이템 로드 + impression 기록
  useEffect(() => {
    const uploaderId = fullTrack?.uploader_id;
    if (!uploaderId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/business/ads/active');
        const all: AdItem[] = res.data?.items || [];
        const filtered = all.filter((a) => a.user_id === uploaderId);
        if (cancelled) return;
        setAds(filtered);
        // impression 기록 (중복 방지용 ref)
        for (const item of filtered) {
          if (!impressionLoggedRef.current.has(item.id)) {
            impressionLoggedRef.current.add(item.id);
            api.post(`/business/ads/${item.id}/impression`).catch(() => {});
          }
        }
      } catch (err) {
        console.warn('[Player] 광고 조회 실패:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [fullTrack?.uploader_id]);

  const handleAdClick = async (item: AdItem) => {
    api.post(`/business/ads/${item.id}/click`).catch(() => {});
    if (item.link_url) {
      const url = item.link_url.startsWith('http') ? item.link_url : `https://${item.link_url}`;
      Linking.openURL(url).catch(() => Alert.alert('알림', '링크를 열 수 없어요'));
    }
  };

  const getAdImage = (item: AdItem): string | null => {
    if (!item.image_url) return null;
    if (item.image_url.startsWith('http')) return item.image_url;
    return `${BACKEND_BASE_URL}/api/business/items/image/${item.image_url.replace(/^\//, '')}`;
  };

  useEffect(() => {
    // 🔑 재생 대상 = 명시적으로 넘어온 routeTrack 우선(다른 곡이 재생 중이어도 클릭한 곡을 재생)
    const target: TrackData = routeTrack || storeTrack;
    // 미니 플레이어에서 "그 곡"이 이미 재생 중이면 기존 사운드 재사용
    if (playerStore.track?.id === target?.id && playerStore.sound) {
      soundRef.current = playerStore.sound;
      setSound(playerStore.sound);
      setIsPlaying(playerStore.isPlaying);
      setPosition(playerStore.position);
      setDuration(playerStore.duration);
      // 🔑 콜백 재설정 — 미니에서 넘어올 때 기존 콜백은 MiniPlayer 클로저라
      // PlayerScreen의 local position/duration state가 업데이트되지 않아 재생바가 멈춘 것처럼 보임
      playerStore.sound.setOnPlaybackStatusUpdate(onPlaybackStatusUpdate);
    } else {
      // 다른 곡(=클릭한 곡)이면 기존 사운드 정리 후 그 곡을 새로 로드+재생
      if (playerStore.sound) {
        playerStore.sound.unloadAsync().catch(() => {});
      }
      loadAndPlay(target);
    }
    // Player 화면 열림 표시
    playerStore.setPlayerScreenOpen(true);
    return () => { playerStore.setPlayerScreenOpen(false); };
  }, []);

  // 🔑 PlayerScreen이 이미 mount 상태에서 다른 곡으로 navigate된 경우 (차트→Player 재진입)
  // routeTrack.id가 바뀌면 새 곡으로 sound 교체
  useEffect(() => {
    if (!routeTrack?.id) return;
    // 🔑 최초 mount 실행은 스킵 — 초기 로드는 위 [] 효과의 loadAndPlay가 담당.
    // (둘 다 createAsync 하면 사운드 2개 동시 재생 → 고아 사운드로 pause/닫기 불능)
    if (routeTrackInitRef.current) {
      routeTrackInitRef.current = false;
      if (__DEV__) console.info('[PlayerScreen] routeTrack effect 최초 실행 스킵(중복 사운드 방지)');
      return;
    }
    // routeTrack.id가 store.track.id와 다를 때만 교체
    const storeTrackId = usePlayerStore.getState().track?.id;
    if (routeTrack.id === storeTrackId) return;
    (async () => {
      try {
        if (soundRef.current) {
          await soundRef.current.unloadAsync().catch(() => {});
          soundRef.current = null;
        }
        const audioUrl = await getAudioUri(routeTrack.id);
        const { sound: newSound } = await Audio.Sound.createAsync(
          { uri: audioUrl },
          { shouldPlay: true },
          onPlaybackStatusUpdate,
        );
        soundRef.current = newSound;
        setSound(newSound);
        const store = usePlayerStore.getState();
        store.setSound(newSound);
        store.setTrack(routeTrack);
        store.setIsPlaying(true);
        setIsPlaying(true);
        setPosition(0);
      } catch (err) {
        console.warn('[Player] routeTrack 변경 시 재로드 실패:', err);
      }
    })();
  }, [routeTrack?.id]);

  // PlayerScreen 언마운트 시에도 콜백이 계속 store.position/isPlaying을 업데이트하도록
  // setOnPlaybackStatusUpdate는 위에서 설정된 상태를 유지 (MiniPlayer가 store 구독하므로 OK)

  const togglePlayPause = async () => {
    if (!soundRef.current) return;
    if (isPlaying) {
      await soundRef.current.pauseAsync();
    } else {
      await soundRef.current.playAsync();
    }
  };

  // 이전/다음 — 셔플/반복 모드 고려
  // navigation.replace 대신 sound만 직접 교체 → 슬라이드 애니메이션 없이 곡만 전환
  const switchToTrack = async (idx: number) => {
    const store = usePlayerStore.getState();
    const target = store.queue[idx];
    if (!target?.id) return;
    store.playTrackAtIndex(idx);
    try {
      if (soundRef.current) {
        await soundRef.current.unloadAsync().catch(() => {});
        soundRef.current = null;
      }
      const audioUrl = await getAudioUri(target.id);
      const { sound: newSound } = await Audio.Sound.createAsync(
        { uri: audioUrl },
        { shouldPlay: true },
        onPlaybackStatusUpdate,
      );
      soundRef.current = newSound;
      setSound(newSound);
      store.setSound(newSound);
      store.setTrack(target);
      store.setIsPlaying(true);
      setIsPlaying(true);
      setPosition(0);
    } catch (err) {
      console.warn('[Player] switchToTrack 실패:', err);
    }
  };

  const handlePrev = async () => {
    const idx = usePlayerStore.getState().getPrevIndex();
    if (idx >= 0) await switchToTrack(idx);
  };

  const handleNext = async () => {
    const idx = usePlayerStore.getState().getNextIndex();
    if (idx >= 0) await switchToTrack(idx);
  };

  const handleSeek = async (value: number) => {
    // 드래그 완료 지점부터 재생 — 낙관적으로 position 반영 후 실제 seek
    setPosition(value);
    playerStore.setPosition(value);
    isSeekingRef.current = false;
    setIsSeeking(false);
    if (__DEV__) console.info('[PlayerScreen] seek', { ms: Math.round(value) });
    try {
      if (soundRef.current) await soundRef.current.setPositionAsync(value);
    } catch (err: any) {
      console.error('[PlayerScreen] seek 실패', { message: err?.message });
    }
  };

  const handleSlidingStart = () => {
    isSeekingRef.current = true;
    setSeekValue(position);
    setIsSeeking(true);
  };

  const handleAddToPlaylist = () => {
    Alert.alert('플레이리스트', '플레이리스트에 추가되었습니다');
  };

  const coverUri = getCoverUri();

  return (
    <SafeAreaView style={styles.container}>
      {/* Background gradient simulation */}
      <View style={styles.bgOverlay} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <AppText variant="title2">{'✕'}</AppText>
        </TouchableOpacity>
        <AppText variant="callout" tone="accent" center numberOfLines={1} style={styles.headerTitleFlex}>Now Playing</AppText>
        <View style={styles.backButton} />
      </View>

      {/* 노래 / 동영상 미디어 전환 (MAIDOL media-tabs) */}
      <View style={styles.mediaTabs}>
        <TouchableOpacity style={[styles.mediaTab, mediaTab === 'song' && styles.mediaTabActive]} onPress={() => setMediaTab('song')} accessibilityLabel="노래">
          <Feather name="music" size={14} color={mediaTab === 'song' ? colors.text.primary : colors.text.muted} />
          <AppText variant="caption" tone={mediaTab === 'song' ? 'primary' : 'muted'}>노래</AppText>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.mediaTab, mediaTab === 'video' && styles.mediaTabActive]} onPress={openVideoTab} accessibilityLabel="동영상">
          <Feather name="film" size={14} color={mediaTab === 'video' ? colors.text.primary : colors.text.muted} />
          <AppText variant="caption" tone={mediaTab === 'video' ? 'primary' : 'muted'}>동영상</AppText>
        </TouchableOpacity>
      </View>

      {/* Cover Art / 동영상(가사 싱크) */}
      <View style={styles.coverWrapper}>
        {mediaTab === 'video' ? (
          lyricsTimeline.length > 0 ? (
            <LyricSyncView segments={lyricsTimeline} positionMillis={position} coverUri={coverUri} height={210} />
          ) : (
            <View style={[styles.coverArt, styles.coverPlaceholder]}>
              <AppText tone="muted" center>{lyricsLoading ? '불러오는 중…' : 'MV·가사 싱크가\n준비되면 제공돼요'}</AppText>
            </View>
          )
        ) : coverUri ? (
          <Image source={{ uri: coverUri }} style={styles.coverArt} />
        ) : (
          <View style={[styles.coverArt, styles.coverPlaceholder]}>
            <AppText style={styles.coverPlaceholderIcon}>{'♪'}</AppText>
          </View>
        )}
      </View>

      {/* Track Info */}
      <View style={styles.trackInfoContainer}>
        <AppText variant="title1" center numberOfLines={1}>
          {track?.title || '알 수 없는 곡'}
        </AppText>
        <TouchableOpacity
          onPress={() => {
            const nickname = track?.uploader_nickname || track?.artist_name;
            const uploaderId = track?.uploader_id;
            if (!nickname) return;
            navigation.navigate('AgencyProfile', {
              uploaderNickname: nickname,
              uploaderId,
            });
          }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <AppText variant="callout" tone="accent" center numberOfLines={1} style={styles.trackArtistSpacing}>
            {track?.artist_name || '알 수 없는 아티스트'} {'›'}
          </AppText>
        </TouchableOpacity>
      </View>

      {/* Progress Bar */}
      <View style={styles.progressContainer}>
        <Slider
          style={styles.slider}
          minimumValue={0}
          maximumValue={duration || 1}
          value={isSeeking ? seekValue : position}
          onValueChange={(v) => { if (isSeekingRef.current) setSeekValue(v); }}
          onSlidingStart={handleSlidingStart}
          onSlidingComplete={handleSeek}
          minimumTrackTintColor={colors.accent.primary}
          maximumTrackTintColor={colors.border.subtle}
          thumbTintColor={colors.accent.primary}
        />
        <View style={styles.timeRow}>
          <AppText variant="caption" tone="muted">{formatTime(isSeeking ? seekValue : position)}</AppText>
          <AppText variant="caption" tone="muted">{formatTime(duration)}</AppText>
        </View>
      </View>

      {/* Controls — 유튜브 뮤직 패턴: 셔플 | 이전 | 재생 | 다음 | 반복 */}
      <View style={styles.controlsRow}>
        <TouchableOpacity style={styles.controlButtonSmall} onPress={() => playerStore.toggleShuffle()}>
          <ShuffleIcon active={playerStore.shuffle} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.controlButton} onPress={handlePrev}>
          <View style={styles.prevNextIcon}>
            <View style={styles.triangleLeft} />
            <View style={styles.triangleLeft} />
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={styles.playButton} onPress={togglePlayPause}>
          {isPlaying ? (
            <View style={styles.pauseIcon}>
              <View style={styles.pauseBar} />
              <View style={styles.pauseBar} />
            </View>
          ) : (
            <View style={styles.playTriangle} />
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.controlButton} onPress={handleNext}>
          <View style={styles.prevNextIcon}>
            <View style={styles.triangleRight} />
            <View style={styles.triangleRight} />
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={styles.controlButtonSmall} onPress={() => playerStore.cycleRepeat()}>
          <RepeatIcon mode={playerStore.repeat} />
        </TouchableOpacity>
      </View>

      {/* Action Buttons */}
      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => setIsLiked(!isLiked)}
        >
          <AppText variant="title2" tone={isLiked ? 'accent' : 'muted'}>
            {isLiked ? '♥' : '♡'}
          </AppText>
          <AppText variant="caption" tone="muted" style={styles.actionLabelSpacing}>좋아요</AppText>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionBtn} onPress={handleAddToPlaylist}>
          <AppText variant="title2" tone="muted">+</AppText>
          <AppText variant="caption" tone="muted" style={styles.actionLabelSpacing}>담기</AppText>
        </TouchableOpacity>

        {/* 재생목록(큐) */}
        <TouchableOpacity style={styles.actionBtn} onPress={() => setShowQueue(true)} accessibilityLabel="재생목록">
          <Feather name="list" size={24} color={colors.text.muted} />
          <AppText variant="caption" tone="muted" style={styles.actionLabelSpacing}>재생목록</AppText>
        </TouchableOpacity>
      </View>

      {/* 재생목록(큐) 모달 — 현재 재생 큐를 보고 곡 선택/삭제 */}
      <Modal visible={showQueue} transparent animationType="slide" onRequestClose={() => setShowQueue(false)}>
        <TouchableOpacity style={styles.queueOverlay} activeOpacity={1} onPress={() => setShowQueue(false)}>
          <TouchableOpacity style={styles.queueSheet} activeOpacity={1} onPress={() => {}}>
            <View style={styles.queueHead}>
              <AppText variant="title3">재생목록 {playerStore.queue.length}</AppText>
              <TouchableOpacity onPress={() => setShowQueue(false)} accessibilityLabel="닫기">
                <Feather name="x" size={22} color={colors.text.muted} />
              </TouchableOpacity>
            </View>
            {playerStore.queue.length === 0 ? (
              <AppText tone="muted" center style={{ paddingVertical: 40 }}>재생목록이 비어있어요</AppText>
            ) : (
              <>
                <AppText variant="caption" tone="muted" style={{ marginBottom: spacing.sm }}>≡ 손잡이를 잡고 끌어 순서를 바꿀 수 있어요</AppText>
                <ScrollView style={{ maxHeight: 420 }}>
                  <DraggableQueue
                    data={playerStore.queue}
                    currentIndex={playerStore.currentIndex}
                    onReorder={(from, to) => playerStore.reorderQueue(from, to)}
                    onPress={(i) => { setShowQueue(false); switchToTrack(i); }}
                    onRemove={(i) => playerStore.removeFromQueue(i)}
                  />
                </ScrollView>
              </>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>


      {/* 남는 세로 공간 흡수(콘텐츠가 짧을 때) — 토글은 아래 절대배치로 항상 노출 */}
      <View style={{ flex: 1 }} />

      {/* Bottom swipe-up indicator (가사·상세정보 토글) — 하단 절대배치로 기기·오버플로 무관 항상 노출 */}
      <TouchableOpacity
        style={styles.swipeUpButton}
        onPress={() => setShowDetails(true)}
        accessibilityLabel="가사 상세정보"
      >
        <View style={styles.swipeUpHandle} />
        <AppText variant="footnote" tone="secondary">가사 · 상세정보</AppText>
      </TouchableOpacity>

      {/* Bottom Sheet Modal (YouTube Music style) */}
      <Modal
        visible={showDetails}
        transparent
        animationType="slide"
        onRequestClose={() => setShowDetails(false)}
      >
        <View style={styles.sheetOverlay}>
          <TouchableOpacity
            style={styles.sheetDismissArea}
            activeOpacity={1}
            onPress={() => setShowDetails(false)}
          />
          <View style={styles.sheetContainer}>
            {/* Handle bar */}
            <TouchableOpacity
              style={styles.sheetHandleArea}
              onPress={() => setShowDetails(false)}
            >
              <View style={styles.sheetHandle} />
            </TouchableOpacity>

            {/* Tab bar */}
            <View style={styles.sheetTabBar}>
              {(['lyrics', 'prompt', 'outfit', 'info'] as const).map((tab) => {
                const labels = { lyrics: '가사', prompt: '프롬프트', outfit: '착장', info: '상세 정보' };
                return (
                  <Tag key={tab} label={labels[tab]} selected={detailTab === tab} onPress={() => setDetailTab(tab)} />
                );
              })}
            </View>

            {/* Content */}
            <ScrollView style={styles.sheetContent} showsVerticalScrollIndicator={false}>
              {detailTab === 'lyrics' && (
                track?.lyrics ? (
                  <AppText style={styles.sheetText}>{track.lyrics}</AppText>
                ) : fullTrack === null ? (
                  <AppText style={styles.sheetEmptyText}>불러오는 중...</AppText>
                ) : (
                  <AppText style={styles.sheetEmptyText}>가사 정보가 없습니다</AppText>
                )
              )}
              {detailTab === 'prompt' && (
                track?.prompt ? (
                  <View>
                    <AppText style={styles.detailSectionTitle}>작곡 프롬프트</AppText>
                    <AppText style={styles.detailHelperText}>작곡 디렉터와 대화하며 설정한 장르·분위기·보컬·레퍼런스·BPM 등 작곡 파라미터입니다.</AppText>
                    <AppText style={styles.sheetText}>{track.prompt}</AppText>

                    {/* 프롬프트에 묶여 있는 주요 파라미터를 분해해서 한 번 더 정리 */}
                    {(track?.genre || track?.mood || track?.bpm || track?.key || track?.tags?.length) ? (
                      <View style={styles.promptChipsBox}>
                        <AppText style={styles.promptChipsLabel}>핵심 파라미터</AppText>
                        <View style={styles.promptChipsRow}>
                          {track?.genre ? (
                            <View style={styles.promptChip}>
                              <AppText style={styles.promptChipLabel}>장르</AppText>
                              <AppText style={styles.promptChipValue}>{Array.isArray(track.genre) ? track.genre.join(', ') : track.genre}</AppText>
                            </View>
                          ) : null}
                          {track?.mood ? (
                            <View style={styles.promptChip}>
                              <AppText style={styles.promptChipLabel}>분위기</AppText>
                              <AppText style={styles.promptChipValue}>{Array.isArray(track.mood) ? track.mood.join(', ') : track.mood}</AppText>
                            </View>
                          ) : null}
                          {track?.bpm ? (
                            <View style={styles.promptChip}>
                              <AppText style={styles.promptChipLabel}>BPM</AppText>
                              <AppText style={styles.promptChipValue}>{track.bpm}</AppText>
                            </View>
                          ) : null}
                          {track?.key ? (
                            <View style={styles.promptChip}>
                              <AppText style={styles.promptChipLabel}>키</AppText>
                              <AppText style={styles.promptChipValue}>{track.key}</AppText>
                            </View>
                          ) : null}
                          {track?.ai_model ? (
                            <View style={styles.promptChip}>
                              <AppText style={styles.promptChipLabel}>AI 모델</AppText>
                              <AppText style={styles.promptChipValue}>{track.ai_model}</AppText>
                            </View>
                          ) : null}
                          {track?.tags && track.tags.length > 0 ? (
                            <View style={styles.promptChip}>
                              <AppText style={styles.promptChipLabel}>태그</AppText>
                              <AppText style={styles.promptChipValue}>{track.tags.join(', ')}</AppText>
                            </View>
                          ) : null}
                        </View>
                      </View>
                    ) : null}
                  </View>
                ) : fullTrack === null ? (
                  <AppText style={styles.sheetEmptyText}>불러오는 중...</AppText>
                ) : (
                  <View>
                    <AppText style={styles.sheetEmptyText}>이 곡은 작곡 프롬프트가 없습니다</AppText>
                    <AppText style={[styles.sheetEmptyText, { fontSize: 12, marginTop: 8 }]}>
                      AI가 자동으로 생성했거나, 외부 업로드 곡일 수 있어요.
                    </AppText>
                  </View>
                )
              )}
              {detailTab === 'outfit' && (
                track?.cover_character?.used_items && track.cover_character.used_items.length > 0 ? (
                  <View>
                    <AppText style={styles.detailSectionTitle}>이 곡 아티스트의 착장</AppText>
                    <AppText style={styles.detailHelperText}>곡 발매 시점에 아티스트가 입었던 의상입니다.</AppText>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
                      {track.cover_character.used_items.map((item, i) => {
                        const img = item.image_object_name
                          ? `${BACKEND_BASE_URL}/api/character/preview/${item.image_object_name}`
                          : null;
                        const hasUrl = !!item.product_url;
                        return (
                          <View key={item.id || i} style={styles.outfitItem}>
                            {img ? (
                              <Image source={{ uri: img }} style={styles.outfitItemImg} />
                            ) : (
                              <View style={[styles.outfitItemImg, styles.outfitItemImgPh]} />
                            )}
                            <AppText style={styles.outfitItemCat}>{item.category || '아이템'}</AppText>
                            <AppText style={styles.outfitItemName} numberOfLines={2}>{item.name || ''}</AppText>
                            {hasUrl ? (
                              <TouchableOpacity
                                style={styles.outfitDetailBtn}
                                onPress={() => {
                                  const url = item.product_url!.startsWith('http')
                                    ? item.product_url!
                                    : `https://${item.product_url}`;
                                  Linking.openURL(url).catch(() => Alert.alert('알림', '링크를 열 수 없어요'));
                                }}
                              >
                                <AppText style={styles.outfitDetailBtnText}>자세히 보기</AppText>
                              </TouchableOpacity>
                            ) : (
                              <View style={[styles.outfitDetailBtn, styles.outfitDetailBtnDisabled]}>
                                <AppText style={styles.outfitDetailBtnTextDisabled}>링크 없음</AppText>
                              </View>
                            )}
                          </View>
                        );
                      })}
                    </View>
                  </View>
                ) : fullTrack === null ? (
                  <AppText style={styles.sheetEmptyText}>불러오는 중...</AppText>
                ) : (
                  <AppText style={styles.sheetEmptyText}>이 곡은 착장 정보가 없습니다</AppText>
                )
              )}
              {detailTab === 'info' && (
                <View>
                  {track?.title ? <AppText style={styles.detailText}>제목: {track.title}</AppText> : null}
                  {(track?.artist_name || track?.uploader_nickname) ? (
                    <AppText style={styles.detailText}>아티스트: {track.artist_name || track.uploader_nickname}</AppText>
                  ) : null}
                  {track?.genre ? (
                    <AppText style={styles.detailText}>장르: {Array.isArray(track.genre) ? track.genre.join(', ') : track.genre}</AppText>
                  ) : null}
                  {track?.mood ? (
                    <AppText style={styles.detailText}>분위기: {Array.isArray(track.mood) ? track.mood.join(', ') : track.mood}</AppText>
                  ) : null}
                  {track?.tags && track.tags.length > 0 ? (
                    <AppText style={styles.detailText}>태그: {track.tags.join(', ')}</AppText>
                  ) : null}
                  {track?.bpm ? <AppText style={styles.detailText}>BPM: {track.bpm}</AppText> : null}
                  {track?.key ? <AppText style={styles.detailText}>키: {track.key}</AppText> : null}
                  {track?.ai_model ? <AppText style={styles.detailText}>AI 모델: {track.ai_model}</AppText> : null}
                  {track?.duration_sec ? (
                    <AppText style={styles.detailText}>길이: {Math.floor(track.duration_sec / 60)}분 {track.duration_sec % 60}초</AppText>
                  ) : null}
                  {track?.play_count != null ? <AppText style={styles.detailText}>재생수: {track.play_count.toLocaleString()}</AppText> : null}
                  {track?.like_count != null ? <AppText style={styles.detailText}>좋아요: {track.like_count.toLocaleString()}</AppText> : null}
                  {track?.created_at ? (
                    <AppText style={styles.detailText}>생성일: {new Date(track.created_at).toLocaleDateString('ko-KR')}</AppText>
                  ) : null}
                </View>
              )}
              <View style={{ height: 40 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg.deepest,
    alignItems: 'center',
  },
  headerTitleFlex: { flex: 1 },
  trackArtistSpacing: { marginTop: spacing.xs },
  actionLabelSpacing: { marginTop: spacing.xxs },
  bgOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.bg.deepest,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backText: {
    fontSize: 24,
    color: colors.text.primary,
  },
  headerTitle: {
    fontSize: 14,
    color: colors.text.secondary,
    fontWeight: '600',
  },
  mediaTabs: {
    flexDirection: 'row', gap: 8, marginTop: 8,
    backgroundColor: colors.bg.surface1, borderRadius: radius.pill, padding: 3,
  },
  mediaTab: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 16, borderRadius: radius.pill },
  mediaTabActive: { backgroundColor: colors.bg.surface3 },
  coverWrapper: {
    marginTop: 16,
    shadowColor: colors.bg.deepest,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.6,
    shadowRadius: 16,
    elevation: 12,
  },
  coverArt: {
    width: 210,
    height: 210,
    borderRadius: 16,
  },
  coverPlaceholder: {
    backgroundColor: colors.bg.surface1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  coverPlaceholderIcon: {
    fontSize: 64,
    color: colors.border.subtle,
  },
  trackInfoContainer: {
    marginTop: 32,
    alignItems: 'center',
    paddingHorizontal: 32,
    width: '100%',
  },
  trackTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: colors.text.primary,
    marginBottom: 6,
    textAlign: 'center',
  },
  trackArtist: {
    fontSize: 15,
    color: colors.text.secondary,
    textAlign: 'center',
  },
  trackArtistArrow: {
    color: colors.accent.primary, fontSize: 16, fontWeight: '700',
  },
  progressContainer: {
    width: '100%',
    paddingHorizontal: 24,
    marginTop: 32,
  },
  slider: {
    width: '100%',
    height: 40,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginTop: -4,
  },
  timeText: {
    fontSize: 12,
    color: colors.text.muted,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    gap: 18,
  },
  controlButton: {
    width: 48,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  controlButtonSmall: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modeIcon: {
    fontSize: 20,
    color: colors.text.muted,
  },
  modeIconActive: {
    color: colors.accent.primary,
  },
  prevNextIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  triangleLeft: {
    width: 0,
    height: 0,
    borderTopWidth: 10,
    borderBottomWidth: 10,
    borderRightWidth: 14,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderRightColor: colors.text.primary,
  },
  triangleRight: {
    width: 0,
    height: 0,
    borderTopWidth: 10,
    borderBottomWidth: 10,
    borderLeftWidth: 14,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: colors.text.primary,
  },
  playButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.accent.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pauseIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pauseBar: {
    width: 6,
    height: 24,
    backgroundColor: colors.text.primary,
    borderRadius: 2,
  },
  playTriangle: {
    width: 0,
    height: 0,
    borderTopWidth: 16,
    borderBottomWidth: 16,
    borderLeftWidth: 26,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: colors.text.primary,
    marginLeft: 4,
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 48,
    marginTop: 20,
    marginBottom: 8,
  },
  // 재생목록(큐) 모달
  queueOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  queueSheet: {
    backgroundColor: colors.bg.surface1,
    borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl,
    padding: spacing.xl, paddingBottom: spacing.xxl,
  },
  queueHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  queueRow: {
    flexDirection: 'row', alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.subtle,
  },
  queueRowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  actionBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 60,
  },
  actionIcon: {
    fontSize: 24,
    lineHeight: 28,
    color: colors.text.muted,
    marginBottom: 6,
    textAlign: 'center',
    width: 32,
    includeFontPadding: false as any,
  },
  actionIconActive: {
    color: colors.accent.primary,
  },
  actionLabel: {
    fontSize: 12,
    lineHeight: 16,
    color: colors.text.muted,
    textAlign: 'center',
  },
  swipeUpButton: {
    width: '100%',
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 18,
    borderTopWidth: 1,
    borderTopColor: colors.bg.surface1,
  },
  swipeUpHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border.default,
    marginBottom: 6,
  },
  swipeUpText: {
    fontSize: 13,
    color: colors.text.secondary,
  },
  sheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheetDismissArea: {
    flex: 1,
  },
  sheetContainer: {
    backgroundColor: colors.bg.surface1,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    height: '70%',
  },
  sheetHandleArea: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 8,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border.default,
  },
  sheetTabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
    paddingHorizontal: 16,
  },
  sheetTab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  sheetTabActive: {
    borderBottomColor: colors.accent.primary,
  },
  sheetTabText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text.muted,
  },
  sheetTabTextActive: {
    color: colors.accent.primary,
  },
  sheetContent: {
    padding: 20,
  },
  sheetText: {
    fontSize: 15,
    color: colors.text.secondary,
    lineHeight: 24,
  },
  sheetEmptyText: {
    fontSize: 14,
    color: colors.text.muted,
    textAlign: 'center',
    marginTop: 40,
  },
  detailText: {
    fontSize: 14,
    color: colors.text.secondary,
    marginBottom: 10,
    lineHeight: 20,
  },
  detailSectionTitle: {
    fontSize: 13,
    color: colors.accent.primary,
    fontWeight: '700',
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  detailHelperText: {
    fontSize: 12,
    color: colors.text.muted,
    marginBottom: 12,
    lineHeight: 18,
  },
  outfitItem: {
    width: 108, alignItems: 'center',
    padding: 8, borderRadius: 10,
    backgroundColor: colors.bg.surface1,
    borderWidth: 1, borderColor: colors.border.subtle,
  },
  outfitItemImg: { width: 88, height: 88, borderRadius: 8, backgroundColor: colors.bg.surface2 },
  outfitItemImgPh: { justifyContent: 'center', alignItems: 'center' },
  outfitItemCat: { fontSize: 10, color: colors.accent.primary, fontWeight: '700', marginTop: 6, letterSpacing: 0.3 },
  outfitItemName: { fontSize: 11, color: colors.text.primary, textAlign: 'center', marginTop: 2, marginBottom: 8 },
  outfitDetailBtn: {
    alignSelf: 'stretch',
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: colors.accent.primary,
    alignItems: 'center',
  },
  outfitDetailBtnText: { color: colors.text.primary, fontSize: 11, fontWeight: '700' },
  outfitDetailBtnDisabled: {
    backgroundColor: 'transparent',
    borderWidth: 1, borderColor: colors.border.subtle,
  },
  outfitDetailBtnTextDisabled: { color: colors.text.muted, fontSize: 11, fontWeight: '600' },
  promptChipsBox: {
    marginTop: 16,
    padding: 12,
    backgroundColor: colors.bg.surface1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  promptChipsLabel: {
    fontSize: 11,
    color: colors.accent.primary,
    fontWeight: '700',
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  promptChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  promptChip: {
    backgroundColor: colors.bg.surface2,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 80,
  },
  promptChipLabel: {
    fontSize: 10,
    color: colors.text.muted,
    marginBottom: 2,
  },
  promptChipValue: {
    fontSize: 13,
    color: colors.text.primary,
    fontWeight: '600',
  },
  adsSection: {
    width: '100%',
    paddingTop: 8,
    paddingBottom: 4,
  },
  adsSectionTitle: {
    fontSize: 12,
    color: colors.text.secondary,
    fontWeight: '600',
    marginLeft: 16,
    marginBottom: 8,
  },
  adChip: {
    width: 100,
    marginRight: 10,
    backgroundColor: colors.bg.surface1,
    borderRadius: 10,
    padding: 6,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  adChipImg: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 6,
    marginBottom: 4,
  },
  adChipImgPlaceholder: {
    backgroundColor: colors.bg.surface2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  adChipText: {
    fontSize: 11,
    color: colors.text.primary,
    fontWeight: '500',
  },
});
