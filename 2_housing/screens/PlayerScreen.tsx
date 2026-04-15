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
} from 'react-native';
import { Audio } from 'expo-av';
import Slider from '@react-native-community/slider';
import api from '../services/api';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface TrackData {
  id: string;
  title: string;
  artist_name?: string;
  cover_image?: string;
  cover_image_url?: string;
  play_count?: number;
  like_count?: number;
  genre?: string | string[];
  mood?: string | string[];
  audio_url?: string;
  duration_sec?: number;
  lyrics?: string;
  prompt?: string;
  ai_model?: string;
}

function formatTime(millis: number): string {
  const totalSec = Math.floor(millis / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

export default function PlayerScreen({ route, navigation }: any) {
  const track: TrackData = route.params?.track;
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isLiked, setIsLiked] = useState(false);
  const [isSeeking, setIsSeeking] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [detailTab, setDetailTab] = useState<'lyrics' | 'prompt' | 'info'>('lyrics');
  const soundRef = useRef<Audio.Sound | null>(null);

  const getCoverUri = (): string | null => {
    const img = track?.cover_image || track?.cover_image_url;
    if (!img) return null;
    return `http://192.168.219.106:9001/api/upload/cover-preview/${encodeURIComponent(img)}`;
  };

  const onPlaybackStatusUpdate = (status: any) => {
    if (status.isLoaded) {
      if (!isSeeking) {
        setPosition(status.positionMillis);
      }
      setDuration(status.durationMillis || 0);
      setIsPlaying(status.isPlaying);
      if (status.didJustFinish) {
        setIsPlaying(false);
        setPosition(0);
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
      const audioUrl = `http://192.168.219.106:9001/api/tracks/stream-proxy/${track.id}`;

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
      setIsPlaying(true);
    } catch (err) {
      console.error('Audio load error:', err);
    }
  };

  useEffect(() => {
    loadAndPlay();

    return () => {
      if (soundRef.current) {
        soundRef.current.unloadAsync();
      }
    };
  }, []);

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
          minimumTrackTintColor="#e94560"
          maximumTrackTintColor="#333"
          thumbTintColor="#e94560"
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
      </View>

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
                ) : (
                  <Text style={styles.sheetEmptyText}>가사 정보가 없습니다</Text>
                )
              )}
              {detailTab === 'prompt' && (
                track?.prompt ? (
                  <Text style={styles.sheetText}>{track.prompt}</Text>
                ) : (
                  <Text style={styles.sheetEmptyText}>프롬프트 정보가 없습니다</Text>
                )
              )}
              {detailTab === 'info' && (
                <View>
                  {track?.genre ? <Text style={styles.detailText}>장르: {Array.isArray(track.genre) ? track.genre.join(', ') : track.genre}</Text> : null}
                  {track?.mood ? <Text style={styles.detailText}>분위기: {Array.isArray(track.mood) ? track.mood.join(', ') : track.mood}</Text> : null}
                  {track?.ai_model ? <Text style={styles.detailText}>AI 모델: {track.ai_model}</Text> : null}
                  {track?.duration_sec ? <Text style={styles.detailText}>길이: {Math.floor(track.duration_sec / 60)}분 {track.duration_sec % 60}초</Text> : null}
                  {track?.play_count != null ? <Text style={styles.detailText}>재생수: {track.play_count.toLocaleString()}</Text> : null}
                  {track?.like_count != null ? <Text style={styles.detailText}>좋아요: {track.like_count.toLocaleString()}</Text> : null}
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
    backgroundColor: '#0a0a1a',
    alignItems: 'center',
  },
  bgOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0a0a1a',
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
    color: '#fff',
  },
  headerTitle: {
    fontSize: 14,
    color: '#888',
    fontWeight: '600',
  },
  coverWrapper: {
    marginTop: 24,
    shadowColor: '#000',
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
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  coverPlaceholderIcon: {
    fontSize: 64,
    color: '#333',
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
    color: '#fff',
    marginBottom: 6,
    textAlign: 'center',
  },
  trackArtist: {
    fontSize: 15,
    color: '#888',
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
    color: '#666',
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
    borderRightColor: '#fff',
  },
  triangleRight: {
    width: 0,
    height: 0,
    borderTopWidth: 10,
    borderBottomWidth: 10,
    borderLeftWidth: 14,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: '#fff',
  },
  playButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#e94560',
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
    backgroundColor: '#fff',
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
    borderLeftColor: '#fff',
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
    color: '#666',
    marginBottom: 4,
  },
  actionIconActive: {
    color: '#e94560',
  },
  actionLabel: {
    fontSize: 12,
    color: '#666',
  },
  swipeUpButton: {
    width: '100%',
    alignItems: 'center',
    paddingVertical: 12,
    paddingBottom: 16,
    marginTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#1a1a2e',
  },
  swipeUpHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#444',
    marginBottom: 6,
  },
  swipeUpText: {
    fontSize: 13,
    color: '#888',
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
    backgroundColor: '#1a1a2e',
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
    backgroundColor: '#444',
  },
  sheetTabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#333',
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
    borderBottomColor: '#e94560',
  },
  sheetTabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  sheetTabTextActive: {
    color: '#e94560',
  },
  sheetContent: {
    padding: 20,
  },
  sheetText: {
    fontSize: 15,
    color: '#ccc',
    lineHeight: 24,
  },
  sheetEmptyText: {
    fontSize: 14,
    color: '#555',
    textAlign: 'center',
    marginTop: 40,
  },
  detailText: {
    fontSize: 14,
    color: '#aaa',
    marginBottom: 10,
    lineHeight: 20,
  },
});
