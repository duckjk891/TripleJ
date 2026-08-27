import { useState } from 'react';
import {
  StyleSheet,
  View,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '../components/ui';
import { showAlert } from '../utils/appAlert';
import { colors } from '../theme/colors';
import { useLyricsBookStore, LyricsBookEntry } from '../stores/lyricsBookStore';
import { useLyricsStore } from '../stores/lyricsStore';
import { useMusicStore } from '../stores/musicStore';

// ── 가사 보관함 화면 ──────────────────────────────────────────────────────────
// 작사 결과 화면에서 저장한 가사를 목록으로 보고, 전체 가사 확인·삭제하거나
// "이 가사로 작곡하기"로 작곡 흐름(ComposerSelect)에 바로 태운다.

type Props = NativeStackScreenProps<any, 'LyricsBook'>;

function formatDate(ts: number): string {
  const d = new Date(ts);
  const mm = (d.getMonth() + 1).toString().padStart(2, '0');
  const dd = d.getDate().toString().padStart(2, '0');
  const hh = d.getHours().toString().padStart(2, '0');
  const mi = d.getMinutes().toString().padStart(2, '0');
  return `${d.getFullYear()}.${mm}.${dd} ${hh}:${mi}`;
}

export default function LyricsBookScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const entries = useLyricsBookStore((s) => s.entries);
  const remove = useLyricsBookStore((s) => s.remove);
  // 탭 → 전체 가사 확장 (한 번에 하나만)
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleToggle = (entry: LyricsBookEntry) => {
    setExpandedId((cur) => (cur === entry.id ? null : entry.id));
  };

  const handleDelete = (entry: LyricsBookEntry) => {
    showAlert('가사 삭제', `"${entry.title || '제목 없음'}" 가사를 보관함에서 삭제할까요?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: () => {
          if (__DEV__) console.log('[LyricsBook] 삭제:', entry.id, entry.title);
          remove(entry.id);
          setExpandedId((cur) => (cur === entry.id ? null : cur));
        },
      },
    ]);
  };

  const handleCompose = (entry: LyricsBookEntry) => {
    if (__DEV__) console.log('[LyricsBook] 이 가사로 작곡하기:', entry.id, entry.title);
    // 작곡 흐름이 참조하는 두 store 모두에 주입:
    // - musicStore: 생성 요청 파라미터(lyrics/genre/mood)
    // - lyricsStore: MusicLoading·MusicResult 가 제목/가사를 lyricsStore 에서 직접 읽음
    const music = useMusicStore.getState();
    music.setLyrics(entry.lyrics);
    music.setGenre(entry.genre || '');
    music.setMood(entry.mood || '');
    const lyrics = useLyricsStore.getState();
    lyrics.setGeneratedTitle(entry.title);
    lyrics.setGeneratedLyrics(entry.lyrics);
    navigation.navigate('ComposerSelect');
  };

  return (
    <View style={styles.container}>
      {/* 헤더 (StudioStack headerShown:false → 화면 내부 헤더, VoiceManage 관행) */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <AppText style={styles.backBtnText}>‹</AppText>
        </TouchableOpacity>
        <AppText style={styles.headerTitle}>가사 보관함</AppText>
        <View style={styles.backBtn} />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        {entries.length === 0 ? (
          <View style={styles.emptyBox}>
            <AppText style={styles.emptyTitle}>아직 저장한 가사가 없어요</AppText>
            <AppText style={styles.emptyText}>
              작사 디렉터와 가사를 만든 뒤, 결과 화면에서{'\n'}
              "보관함에 저장"을 누르면 여기에 쌓여요.
            </AppText>
          </View>
        ) : (
          entries.map((entry) => {
            const expanded = expandedId === entry.id;
            return (
              <View key={entry.id} style={[styles.entryCard, expanded && styles.entryCardExpanded]}>
                <TouchableOpacity activeOpacity={0.7} onPress={() => handleToggle(entry)}>
                  <View style={styles.entryTopRow}>
                    <AppText style={styles.entryTitle} numberOfLines={1}>
                      {entry.title || '제목 없음'}
                    </AppText>
                    <TouchableOpacity
                      style={styles.deleteBtn}
                      onPress={() => handleDelete(entry)}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    >
                      <Feather name="trash-2" size={13} color={colors.text.primary} />
                    </TouchableOpacity>
                  </View>
                  {(entry.genre || entry.mood) && (
                    <AppText style={styles.entryMeta} numberOfLines={1}>
                      {[entry.genre, entry.mood].filter(Boolean).join(' · ')}
                    </AppText>
                  )}
                  <AppText
                    style={expanded ? styles.entryLyricsFull : styles.entryPreview}
                    numberOfLines={expanded ? undefined : 2}
                  >
                    {entry.lyrics}
                  </AppText>
                  <AppText style={styles.entryDate}>{formatDate(entry.createdAt)}</AppText>
                </TouchableOpacity>

                {expanded && (
                  <TouchableOpacity
                    style={styles.composeBtn}
                    onPress={() => handleCompose(entry)}
                  >
                    <AppText style={styles.composeBtnText}>이 가사로 작곡하기</AppText>
                  </TouchableOpacity>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.deepest },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.bg.surface1,
  },
  backBtn: { width: 44, paddingHorizontal: 12, paddingVertical: 4 },
  backBtnText: { fontSize: 26, color: colors.text.primary, fontWeight: '300' },
  headerTitle: { fontSize: 16, fontWeight: '700', color: colors.text.primary },

  emptyBox: {
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: 14,
    padding: 24,
    alignItems: 'center',
    marginTop: 24,
  },
  emptyTitle: { color: colors.text.primary, fontSize: 15, fontWeight: '700', marginBottom: 8 },
  emptyText: { color: colors.text.muted, fontSize: 12, lineHeight: 18, textAlign: 'center' },

  entryCard: {
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  entryCardExpanded: { borderColor: colors.accent.primary },
  entryTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  entryTitle: { flex: 1, color: colors.text.primary, fontSize: 15, fontWeight: '700' },
  deleteBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.bg.surface2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteBtnText: { color: colors.text.primary, fontSize: 13 },
  entryMeta: { color: colors.accent.primary, fontSize: 11, fontWeight: '600', marginTop: 4 },
  entryPreview: { color: colors.text.secondary, fontSize: 13, lineHeight: 19, marginTop: 6 },
  entryLyricsFull: { color: colors.text.secondary, fontSize: 14, lineHeight: 24, marginTop: 8 },
  entryDate: { color: colors.text.muted, fontSize: 11, marginTop: 8 },
  composeBtn: {
    marginTop: 12,
    backgroundColor: colors.accent.primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  composeBtnText: { color: colors.text.primary, fontSize: 14, fontWeight: '700' },
});
