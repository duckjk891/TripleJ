import { StyleSheet, View, Text, TouchableOpacity, Image } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { usePlayerStore } from '../stores/playerStore';
import { BACKEND_BASE_URL } from '../services/api';
import { loadAndPlayTrack, invalidatePlayback } from '../services/playback'; // v3.61 공용화, v3.70 유령재생 방지
import { colors } from '../theme/colors';

function getCoverUrl(img: string): string {
  return `${BACKEND_BASE_URL}/api/upload/cover-preview/${encodeURIComponent(img)}`;
}

export default function MiniPlayer() {
  const navigation = useNavigation<any>();
  // v3.197: sound/setIsPlaying 직접 사용 제거 — togglePlay가 getState()로 라이브 참조를 검사하고,
  // 재생 상태는 상태 콜백이 store에 반영한다(낙관적 토글 제거).
  const { track, isPlaying, position, duration, cleanup, queue, currentIndex, playTrackAtIndex, isPlayerScreenOpen } = usePlayerStore();

  // Player 화면이 열려있으면 숨김
  if (isPlayerScreenOpen) return null;

  // v3.197: sound 조건 제거 — 전환 실패로 사운드가 정리(null)돼도 미니플레이어를 유지해
  // "재생버튼 1탭" 복구 경로를 남긴다(track까지 없으면 숨김 — cleanup 후와 동일).
  if (!track) return null;

  // v3.197: 재생버튼 견고화 — getStatusAsync로 isLoaded 확인, 죽은/부재 객체면 현재 곡
  // 재로드(loadAndPlayTrack 내부에서 applyPlaybackAudioMode 재호출)로 복구.
  // 낙관적 setIsPlaying 제거 — 성공 후 상태 콜백이 store에 반영한다.
  const togglePlay = async () => {
    const s = usePlayerStore.getState();
    const snd = s.sound;
    const curTrack = s.track;
    try {
      if (snd) {
        const st: any = await snd.getStatusAsync().catch(() => null);
        if (st?.isLoaded) {
          if (st.isPlaying) {
            await snd.pauseAsync();
          } else {
            await snd.playAsync();
          }
          return;
        }
      }
      if (!curTrack?.id) return;
      console.warn('[BTDebug] play button recover', { src: 'Mini', trackId: curTrack.id, hadSound: !!snd });
      await loadAndPlayTrack(curTrack);
    } catch (err: any) {
      console.warn('[BTDebug] toggle fail → reload', { src: 'Mini', trackId: curTrack?.id, message: err?.message });
      if (curTrack?.id) {
        try { await loadAndPlayTrack(curTrack); } catch {}
      }
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
    // v3.70: 로딩 중 닫기 race 방지 — 진행 중 로드를 무효화한 뒤 정리
    invalidatePlayback();
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
            <Feather name="music" size={16} color={colors.text.muted} />
          </View>
        )}

        {/* 곡 정보 */}
        <View style={styles.info}>
          <Text style={styles.title} numberOfLines={1}>{track.title}</Text>
          <Text style={styles.artist} numberOfLines={1}>{track.artist_name || track.uploader_nickname || 'AI'}</Text>
        </View>

        {/* 이전곡 — v3.194: 텍스트 글리프 → Feather 벡터 */}
        <TouchableOpacity onPress={handlePrev} style={styles.skipButton} disabled={!hasPrev}>
          <Feather name="skip-back" size={16} color={colors.text.primary} style={!hasPrev ? { opacity: 0.3 } : undefined} />
        </TouchableOpacity>

        {/* 재생/정지 — v3.196: 플레이어 대형 버튼(채움 도형) 기준으로 채움형 MCI play/pause로 통일.
            MCI play 글리프(bbox x8~19, 중심 13.5)는 em 중앙보다 이미 우측 배치 = 자체 광학 보정 → marginLeft 불요.
            MCI 채움 글리프가 Feather 대비 작게 보여 16→20으로 상향(36px 원 기준 시각 균형). */}
        <TouchableOpacity onPress={togglePlay} style={styles.playButton}>
          <MaterialCommunityIcons name={isPlaying ? 'pause' : 'play'} size={20} color={colors.text.primary} />
        </TouchableOpacity>

        {/* 다음곡 */}
        <TouchableOpacity onPress={handleNext} style={styles.skipButton} disabled={!hasNext}>
          <Feather name="skip-forward" size={16} color={colors.text.primary} style={!hasNext ? { opacity: 0.3 } : undefined} />
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
          <Feather name="x" size={18} color={colors.text.muted} />
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
  playButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.accent.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 4,
  },
  closeButton: {
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
