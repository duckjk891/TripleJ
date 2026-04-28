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
} from 'react-native';
import { Audio } from 'expo-av';
import Slider from '@react-native-community/slider';
import api, { BACKEND_BASE_URL } from '../services/api';
import { usePlayerStore } from '../stores/playerStore';
import { useArtistStore } from '../stores/artistStore';
import { useAuthStore } from '../stores/authStore';
import PurchaseModal from '../components/PurchaseModal';
import { TRACK_PRICE_KRW, formatKrw } from '../data/pricing';
import { colors } from '../theme/colors';

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
}

function formatTime(millis: number): string {
  const totalSec = Math.floor(millis / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

export default function PlayerScreen({ route, navigation }: any) {
  const routeTrack: TrackData = route.params?.track;
  const playerStore = usePlayerStore();
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showPurchase, setShowPurchase] = useState(false);
  const currentUser = useAuthStore((s) => s.user);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isLiked, setIsLiked] = useState(false);
  const [isSeeking, setIsSeeking] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [detailTab, setDetailTab] = useState<'lyrics' | 'prompt' | 'info'>('lyrics');
  const [fullTrack, setFullTrack] = useState<TrackData | null>(null);
  const [ads, setAds] = useState<AdItem[]>([]);
  const impressionLoggedRef = useRef<Set<string>>(new Set());
  const soundRef = useRef<Audio.Sound | null>(null);

  // route 전달 track은 차트/리스트의 축약 객체라 prompt/lyrics/bpm 등이 비어있을 수 있음
  // → full track을 따로 가져와 상세 화면에서 사용
  const track: TrackData = fullTrack || routeTrack;

  const getCoverUri = (): string | null => {
    const img = track?.cover_image || track?.cover_image_url;
    if (!img) return null;
    return `${BACKEND_BASE_URL}/api/upload/cover-preview/${encodeURIComponent(img)}`;
  };

  const onPlaybackStatusUpdate = (status: any) => {
    if (status.isLoaded) {
      if (!isSeeking) {
        setPosition(status.positionMillis);
        playerStore.setPosition(status.positionMillis);
      }
      setDuration(status.durationMillis || 0);
      playerStore.setDuration(status.durationMillis || 0);
      setIsPlaying(status.isPlaying);
      playerStore.setIsPlaying(status.isPlaying);
      if (status.didJustFinish) {
        // 재생 완료 EXP — 내 아티스트 +1
        useArtistStore.getState().addExp(1, 'play');
        // 자동 다음곡: queue에 다음이 있으면 새 곡으로 전환
        const store = usePlayerStore.getState();
        if (store.queue.length > 0 && store.currentIndex >= 0 && store.currentIndex < store.queue.length - 1) {
          const nextIdx = store.currentIndex + 1;
          const nextTrack = store.queue[nextIdx];
          store.playTrackAtIndex(nextIdx);
          // PlayerScreen을 다음 곡으로 교체 (unmount→mount 사이클로 sound 새로 로드)
          navigation.replace('Player', { track: nextTrack });
        } else {
          setIsPlaying(false);
          setPosition(0);
          playerStore.setIsPlaying(false);
        }
      }
    }
  };

  const loadAndPlay = async () => {
    if (!track?.id) return;
    try {
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
      }

      // Use proxy endpoint that streams audio directly through the backend
      // This avoids MinIO presigned URL host mismatch (localhost vs IP)
      const audioUrl = `${BACKEND_BASE_URL}/api/tracks/stream-proxy/${track.id}`;

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
      playerStore.setTrack(track);
      playerStore.setIsPlaying(true);
      setIsPlaying(true);
    } catch (err) {
      console.error('Audio load error:', err);
    }
  };

  // 풀 트랙 정보 조회 (prompt/lyrics/bpm 등 상세 필드 포함)
  useEffect(() => {
    if (!routeTrack?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get(`/tracks/${routeTrack.id}`);
        if (!cancelled && res.data) setFullTrack(res.data);
      } catch (err) {
        console.warn('[Player] 풀 트랙 조회 실패, route track 사용:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [routeTrack?.id]);

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
    // 미니 플레이어에서 같은 곡이 재생 중이면 기존 사운드 재사용
    if (playerStore.track?.id === track?.id && playerStore.sound) {
      soundRef.current = playerStore.sound;
      setSound(playerStore.sound);
      setIsPlaying(playerStore.isPlaying);
      setPosition(playerStore.position);
      setDuration(playerStore.duration);
      // 🔑 콜백 재설정 — 미니에서 넘어올 때 기존 콜백은 MiniPlayer 클로저라
      // PlayerScreen의 local position/duration state가 업데이트되지 않아 재생바가 멈춘 것처럼 보임
      playerStore.sound.setOnPlaybackStatusUpdate(onPlaybackStatusUpdate);
    } else {
      // 다른 곡이면 기존 사운드 정리 후 새로 로드
      if (playerStore.sound) {
        playerStore.sound.unloadAsync().catch(() => {});
      }
      loadAndPlay();
    }
    // Player 화면 열림 표시
    playerStore.setPlayerScreenOpen(true);
    return () => { playerStore.setPlayerScreenOpen(false); };
  }, []);

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

  const handleSeek = async (value: number) => {
    setIsSeeking(false);
    if (!soundRef.current) return;
    await soundRef.current.setPositionAsync(value);
  };

  const handleSlidingStart = () => {
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
          <Text style={styles.backText}>{'✕'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>Now Playing</Text>
        <View style={styles.backButton} />
      </View>

      {/* Cover Art */}
      <View style={styles.coverWrapper}>
        {coverUri ? (
          <Image source={{ uri: coverUri }} style={styles.coverArt} />
        ) : (
          <View style={[styles.coverArt, styles.coverPlaceholder]}>
            <Text style={styles.coverPlaceholderIcon}>{'♪'}</Text>
          </View>
        )}
      </View>

      {/* Track Info */}
      <View style={styles.trackInfoContainer}>
        <Text style={styles.trackTitle} numberOfLines={1}>
          {track?.title || '알 수 없는 곡'}
        </Text>
        <Text style={styles.trackArtist} numberOfLines={1}>
          {track?.artist_name || '알 수 없는 아티스트'}
        </Text>
      </View>

      {/* Progress Bar */}
      <View style={styles.progressContainer}>
        <Slider
          style={styles.slider}
          minimumValue={0}
          maximumValue={duration || 1}
          value={isSeeking ? undefined : position}
          onSlidingStart={handleSlidingStart}
          onSlidingComplete={handleSeek}
          minimumTrackTintColor={colors.accent.primary}
          maximumTrackTintColor={colors.border.subtle}
          thumbTintColor={colors.accent.primary}
        />
        <View style={styles.timeRow}>
          <Text style={styles.timeText}>{formatTime(position)}</Text>
          <Text style={styles.timeText}>{formatTime(duration)}</Text>
        </View>
      </View>

      {/* Controls */}
      <View style={styles.controlsRow}>
        <TouchableOpacity style={styles.controlButton}>
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

        <TouchableOpacity style={styles.controlButton}>
          <View style={styles.prevNextIcon}>
            <View style={styles.triangleRight} />
            <View style={styles.triangleRight} />
          </View>
        </TouchableOpacity>
      </View>

      {/* Action Buttons */}
      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => setIsLiked(!isLiked)}
        >
          <Text style={[styles.actionIcon, isLiked && styles.actionIconActive]}>
            {isLiked ? '♥' : '♡'}
          </Text>
          <Text style={styles.actionLabel}>좋아요</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionBtn} onPress={handleAddToPlaylist}>
          <Text style={styles.actionIcon}>+</Text>
          <Text style={styles.actionLabel}>담기</Text>
        </TouchableOpacity>

        {/* 다운로드 (구매) */}
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => {
            const isOwn = currentUser?.id && track?.uploader_id && currentUser.id === track.uploader_id;
            if (isOwn) {
              Alert.alert('내 곡', '본인 곡은 결제 없이 다운로드할 수 있어요. (백엔드 반영 후 활성화)');
              return;
            }
            setShowPurchase(true);
          }}
        >
          <Text style={styles.actionIcon}>💿</Text>
          <Text style={styles.actionLabel}>{formatKrw(TRACK_PRICE_KRW)}</Text>
        </TouchableOpacity>
      </View>

      <PurchaseModal
        visible={showPurchase}
        trackTitle={track?.title || '제목 없음'}
        trackArtist={track?.artist_name || track?.uploader_nickname}
        onClose={() => setShowPurchase(false)}
        onPurchase={() => setShowPurchase(false)}
      />

      {/* 아티스트 착용/협찬 아이템 (있을 때만) */}
      {ads.length > 0 && (
        <View style={styles.adsSection}>
          <Text style={styles.adsSectionTitle}>💼 이 아티스트의 아이템</Text>
          <FlatList
            horizontal
            data={ads}
            keyExtractor={(item) => item.id}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 12 }}
            renderItem={({ item }) => {
              const img = getAdImage(item);
              const icon = AD_CATEGORY_ICON[item.category || ''] || '🛍';
              return (
                <TouchableOpacity style={styles.adChip} onPress={() => handleAdClick(item)}>
                  {img ? (
                    <Image source={{ uri: img }} style={styles.adChipImg} />
                  ) : (
                    <View style={[styles.adChipImg, styles.adChipImgPlaceholder]}>
                      <Text style={{ fontSize: 22 }}>{icon}</Text>
                    </View>
                  )}
                  <Text style={styles.adChipText} numberOfLines={1}>
                    {icon} {item.title || '아이템'}
                  </Text>
                </TouchableOpacity>
              );
            }}
          />
        </View>
      )}

      {/* Bottom swipe-up indicator */}
      <TouchableOpacity
        style={styles.swipeUpButton}
        onPress={() => setShowDetails(true)}
      >
        <View style={styles.swipeUpHandle} />
        <Text style={styles.swipeUpText}>가사 · 상세정보</Text>
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
              {(['lyrics', 'prompt', 'info'] as const).map((tab) => {
                const labels = { lyrics: '가사', prompt: '프롬프트', info: '상세 정보' };
                return (
                  <TouchableOpacity
                    key={tab}
                    style={[styles.sheetTab, detailTab === tab && styles.sheetTabActive]}
                    onPress={() => setDetailTab(tab)}
                  >
                    <Text style={[styles.sheetTabText, detailTab === tab && styles.sheetTabTextActive]}>
                      {labels[tab]}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Content */}
            <ScrollView style={styles.sheetContent} showsVerticalScrollIndicator={false}>
              {detailTab === 'lyrics' && (
                track?.lyrics ? (
                  <Text style={styles.sheetText}>{track.lyrics}</Text>
                ) : fullTrack === null ? (
                  <Text style={styles.sheetEmptyText}>불러오는 중...</Text>
                ) : (
                  <Text style={styles.sheetEmptyText}>가사 정보가 없습니다</Text>
                )
              )}
              {detailTab === 'prompt' && (
                track?.prompt ? (
                  <View>
                    <Text style={styles.detailSectionTitle}>작곡 프롬프트</Text>
                    <Text style={styles.detailHelperText}>AI 작곡 시 전달된 스타일·분위기·악곡 정보입니다.</Text>
                    <Text style={styles.sheetText}>{track.prompt}</Text>

                    {/* 프롬프트에 묶여 있는 주요 파라미터를 분해해서 한 번 더 정리 */}
                    {(track?.genre || track?.mood || track?.bpm || track?.key || track?.tags?.length) ? (
                      <View style={styles.promptChipsBox}>
                        <Text style={styles.promptChipsLabel}>핵심 파라미터</Text>
                        <View style={styles.promptChipsRow}>
                          {track?.genre ? (
                            <View style={styles.promptChip}>
                              <Text style={styles.promptChipLabel}>장르</Text>
                              <Text style={styles.promptChipValue}>{Array.isArray(track.genre) ? track.genre.join(', ') : track.genre}</Text>
                            </View>
                          ) : null}
                          {track?.mood ? (
                            <View style={styles.promptChip}>
                              <Text style={styles.promptChipLabel}>분위기</Text>
                              <Text style={styles.promptChipValue}>{Array.isArray(track.mood) ? track.mood.join(', ') : track.mood}</Text>
                            </View>
                          ) : null}
                          {track?.bpm ? (
                            <View style={styles.promptChip}>
                              <Text style={styles.promptChipLabel}>BPM</Text>
                              <Text style={styles.promptChipValue}>{track.bpm}</Text>
                            </View>
                          ) : null}
                          {track?.key ? (
                            <View style={styles.promptChip}>
                              <Text style={styles.promptChipLabel}>키</Text>
                              <Text style={styles.promptChipValue}>{track.key}</Text>
                            </View>
                          ) : null}
                          {track?.ai_model ? (
                            <View style={styles.promptChip}>
                              <Text style={styles.promptChipLabel}>AI 모델</Text>
                              <Text style={styles.promptChipValue}>{track.ai_model}</Text>
                            </View>
                          ) : null}
                          {track?.tags && track.tags.length > 0 ? (
                            <View style={styles.promptChip}>
                              <Text style={styles.promptChipLabel}>태그</Text>
                              <Text style={styles.promptChipValue}>{track.tags.join(', ')}</Text>
                            </View>
                          ) : null}
                        </View>
                      </View>
                    ) : null}
                  </View>
                ) : fullTrack === null ? (
                  <Text style={styles.sheetEmptyText}>불러오는 중...</Text>
                ) : (
                  <View>
                    <Text style={styles.sheetEmptyText}>이 곡은 작곡 프롬프트가 없습니다</Text>
                    <Text style={[styles.sheetEmptyText, { fontSize: 12, marginTop: 8 }]}>
                      AI가 자동으로 생성했거나, 외부 업로드 곡일 수 있어요.
                    </Text>
                  </View>
                )
              )}
              {detailTab === 'info' && (
                <View>
                  {track?.title ? <Text style={styles.detailText}>제목: {track.title}</Text> : null}
                  {(track?.artist_name || track?.uploader_nickname) ? (
                    <Text style={styles.detailText}>아티스트: {track.artist_name || track.uploader_nickname}</Text>
                  ) : null}
                  {track?.genre ? (
                    <Text style={styles.detailText}>장르: {Array.isArray(track.genre) ? track.genre.join(', ') : track.genre}</Text>
                  ) : null}
                  {track?.mood ? (
                    <Text style={styles.detailText}>분위기: {Array.isArray(track.mood) ? track.mood.join(', ') : track.mood}</Text>
                  ) : null}
                  {track?.tags && track.tags.length > 0 ? (
                    <Text style={styles.detailText}>태그: {track.tags.join(', ')}</Text>
                  ) : null}
                  {track?.bpm ? <Text style={styles.detailText}>BPM: {track.bpm}</Text> : null}
                  {track?.key ? <Text style={styles.detailText}>키: {track.key}</Text> : null}
                  {track?.ai_model ? <Text style={styles.detailText}>AI 모델: {track.ai_model}</Text> : null}
                  {track?.duration_sec ? (
                    <Text style={styles.detailText}>길이: {Math.floor(track.duration_sec / 60)}분 {track.duration_sec % 60}초</Text>
                  ) : null}
                  {track?.play_count != null ? <Text style={styles.detailText}>재생수: {track.play_count.toLocaleString()}</Text> : null}
                  {track?.like_count != null ? <Text style={styles.detailText}>좋아요: {track.like_count.toLocaleString()}</Text> : null}
                  {track?.created_at ? (
                    <Text style={styles.detailText}>생성일: {new Date(track.created_at).toLocaleDateString('ko-KR')}</Text>
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
    paddingTop: 56,
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
  coverWrapper: {
    marginTop: 24,
    shadowColor: colors.bg.deepest,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.6,
    shadowRadius: 16,
    elevation: 12,
  },
  coverArt: {
    width: 250,
    height: 250,
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
    gap: 32,
  },
  controlButton: {
    width: 48,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
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
    marginTop: 32,
  },
  actionBtn: {
    alignItems: 'center',
  },
  actionIcon: {
    fontSize: 24,
    color: colors.text.muted,
    marginBottom: 4,
  },
  actionIconActive: {
    color: colors.accent.primary,
  },
  actionLabel: {
    fontSize: 12,
    color: colors.text.muted,
  },
  swipeUpButton: {
    width: '100%',
    alignItems: 'center',
    paddingVertical: 12,
    paddingBottom: 16,
    marginTop: 20,
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
