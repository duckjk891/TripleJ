import { StyleSheet, View, Text, TouchableOpacity, Image } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { usePlayerStore } from '../stores/playerStore';
import { BACKEND_BASE_URL } from '../services/api';
import { loadAndPlayTrack } from '../services/playback'; // v3.61: 로드 로직 공용화
import { colors } from '../theme/colors';

function getCoverUrl(img: string): string {
  return `${BACKEND_BASE_URL}/api/upload/cover-preview/${encodeURIComponent(img)}`;
}

export default function MiniPlayer() {
  const navigation = useNavigation<any>();
  const { track, sound, isPlaying, setIsPlaying, position, duration, cleanup, queue, currentIndex, playTrackAtIndex, isPlayerScreenOpen } = usePlayerStore();

  // Player 화면이 열려있으면 숨김
  if (isPlayerScreenOpen) return null;

  if (!track || !sound) return null;

  const togglePlay = async () => {
    if (!sound) return;
    if (isPlaying) {
      await sound.pauseAsync();
      setIsPlaying(false);
    } else {
      await sound.playAsync();
      setIsPlaying(true);
    }
  };

  const handlePress = () => {
    navigation.navigate('Player', { track, fromMiniPlayer: true });
  };

  const handlePrev = async () => {
    const idx = usePlayerStore.getState().getPrevIndex();
    if (idx >= 0 && queue[idx]) {
      playTrackAtIndex(idx);
      await loadAndPlayTrack(queue[idx]);
    }
  };

  const handleNext = async () => {
    const idx = usePlayerStore.getState().getNextIndex();
    if (idx >= 0 && queue[idx]) {
      playTrackAtIndex(idx);
      await loadAndPlayTrack(queue[idx]);
    }
  };

  const handleClose = async () => {
    await cleanup();
  };

  // 셔플/반복 모드면 항상 prev/next 가능 (큐만 있으면)
  const store = usePlayerStore.getState();
  const hasPrev = queue.length > 0 && (store.shuffle || store.repeat !== 'off' || currentIndex > 0);
  const hasNext = queue.length > 0 && (store.shuffle || store.repeat !== 'off' || currentIndex < queue.length - 1);
  const coverImg = track.cover_image || track.cover_image_url;
  const progress = duration > 0 ? (position / duration) * 100 : 0;

  return (
    <View style={styles.container}>
      {/* 프로그레스 바 */}
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: `${progress}%` }]} />
      </View>

      <TouchableOpacity style={styles.content} onPress={handlePress} activeOpacity={0.8}>
        {/* 커버 이미지 */}
        {coverImg ? (
          <Image source={{ uri: getCoverUrl(coverImg) }} style={styles.cover} />
        ) : (
          <View style={[styles.cover, styles.coverPlaceholder]}>
            <Text style={{ fontSize: 16, color: colors.text.muted }}>{'♪'}</Text>
          </View>
        )}

        {/* 곡 정보 */}
        <View style={styles.info}>
          <Text style={styles.title} numberOfLines={1}>{track.title}</Text>
          <Text style={styles.artist} numberOfLines={1}>{track.artist_name || track.uploader_nickname || 'AI'}</Text>
        </View>

        {/* 이전곡 */}
        <TouchableOpacity onPress={handlePrev} style={styles.skipButton} disabled={!hasPrev}>
          <Text style={[styles.skipIcon, !hasPrev && { opacity: 0.3 }]}>{'⏮'}</Text>
        </TouchableOpacity>

        {/* 재생/정지 */}
        <TouchableOpacity onPress={togglePlay} style={styles.playButton}>
          <Text style={styles.playIcon}>{isPlaying ? '❚❚' : '▶'}</Text>
        </TouchableOpacity>

        {/* 다음곡 */}
        <TouchableOpacity onPress={handleNext} style={styles.skipButton} disabled={!hasNext}>
          <Text style={[styles.skipIcon, !hasNext && { opacity: 0.3 }]}>{'⏭'}</Text>
        </TouchableOpacity>

        {/* 재생목록 바로가기 — 곡 클릭 없이 큐를 한 번에 열기 */}
        <TouchableOpacity
          onPress={(e) => { e.stopPropagation?.(); navigation.navigate('Player', { track, fromMiniPlayer: true, openQueue: true }); }}
          style={styles.skipButton}
          accessibilityLabel="재생목록"
        >
          <Feather name="list" size={18} color={colors.text.secondary} />
        </TouchableOpacity>

        {/* 닫기 */}
        <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
          <Text style={styles.closeIcon}>{'✕'}</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.bg.surface1,
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
  },
  progressBar: {
    height: 2,
    backgroundColor: colors.border.subtle,
  },
  progressFill: {
    height: 2,
    backgroundColor: colors.accent.primary,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  cover: {
    width: 40,
    height: 40,
    borderRadius: 6,
  },
  coverPlaceholder: {
    backgroundColor: colors.bg.deepest,
    justifyContent: 'center',
    alignItems: 'center',
  },
  info: {
    flex: 1,
    marginHorizontal: 12,
  },
  title: {
    color: colors.text.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  artist: {
    color: colors.text.secondary,
    fontSize: 12,
    marginTop: 1,
  },
  skipButton: {
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  skipIcon: {
    color: colors.text.primary,
    fontSize: 14,
  },
  playButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.accent.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 4,
  },
  playIcon: {
    color: colors.text.primary,
    fontSize: 12,
  },
  closeButton: {
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeIcon: {
    color: colors.text.muted,
    fontSize: 16,
  },
});
