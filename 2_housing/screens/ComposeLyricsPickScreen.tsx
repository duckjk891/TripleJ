// [ComposeLyricsPick] v3.131 — 작곡 디렉터의 첫 질문 "어떤 가사로 곡을 만들까요?"를
// 디렉터 대화 형식으로 진행하는 가사 선택 화면 (대표 지시 2026-09-07).
//
// 가사 출처 3곳을 합쳐 최신순 섹션으로 보여준다:
//   ① 방금 작사한 세션 작업본(lyricsStore) — 최상단 고정
//   ② 서버 가사 보관함(/api/lyrics, created_at desc — B-2 자산)
//   ③ 발매곡 가사(GET /tracks/my — 보관함 도입 전에 작사한 기존 곡들, 대표 실사고:
//      "기존에 작사했던 내용들이 안 보인다" — 구 가사는 자산 DB가 아니라 트랙에만 존재)
// (레거시 로컬 보관함 항목도 ② 뒤에 병합)
import { useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  View,
  Image,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { AppText } from '../components/ui';
import { colors } from '../theme/colors';
import { useLyricsStore } from '../stores/lyricsStore';
import { useMusicStore } from '../stores/musicStore';
import { useAuthStore } from '../stores/authStore';
import { useLyricsBookStore } from '../stores/lyricsBookStore';
import { listLyricsAssets } from '../services/lyricsService';
import api from '../services/api';

const COMPOSER_PORTRAIT = require('../assets/portraits/composer_director.png');

type Props = NativeStackScreenProps<any, 'ComposeLyricsPick'>;

interface PickEntry {
  id: string;
  title: string;
  lyrics: string;
  genre?: string;
  mood?: string;
  source: 'draft' | 'asset' | 'track' | 'local';
  createdAt: number;
}

const SOURCE_LABEL: Record<PickEntry['source'], string> = {
  draft: '방금 작사',
  asset: '보관함',
  track: '발매곡',
  local: '보관함(기기)',
};

export default function ComposeLyricsPickScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const isLoggedIn = !!useAuthStore((s) => s.token);
  const localEntries = useLyricsBookStore((s) => s.entries);
  const [entries, setEntries] = useState<PickEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [pickedTitle, setPickedTitle] = useState<string | null>(null);
  // v3.132(대표): 카드 탭=바로 작곡 유지 + [가사 보기] 버튼으로 전체 가사 펼치기
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string) => {
    if (__DEV__) console.info('[ComposeLyricsPick] 가사 보기 토글', { id });
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const composingRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const out: PickEntry[] = [];
      // ① 방금 작사한 세션 작업본
      const ls = useLyricsStore.getState();
      if (ls.generatedLyrics) {
        out.push({
          id: '__draft__',
          title: ls.generatedTitle || '방금 작사한 가사',
          lyrics: ls.generatedLyrics,
          genre: ls.genre || undefined,
          mood: ls.mood || undefined,
          source: 'draft',
          createdAt: Date.now(),
        });
      }
      // ② 서버 가사 자산 (최신순)
      if (isLoggedIn) {
        try {
          console.info('[ComposeLyricsPick] calling listLyricsAssets');
          const items = await listLyricsAssets();
          items.forEach((it) => out.push({
            id: it.lyrics_id,
            title: it.title,
            lyrics: it.content,
            genre: it.genre || undefined,
            mood: it.mood || undefined,
            source: 'asset',
            createdAt: Date.parse(it.created_at) || 0,
          }));
        } catch (err: any) {
          console.error('[ComposeLyricsPick] listLyricsAssets failed', { status: err?.response?.status });
        }
        // ③ 발매곡 가사 — 보관함 도입 전 기존 작사물의 유일한 서버 흔적
        try {
          console.info('[ComposeLyricsPick] calling GET /tracks/my');
          const res = await api.get('/tracks/my', { params: { page: 1, limit: 100, sort: 'created_at' } });
          const tracks: any[] = res.data?.tracks ?? res.data?.items ?? [];
          tracks.filter((t) => (t.lyrics || '').trim()).forEach((t) => out.push({
            id: `track_${t.id}`,
            title: t.title || '무제',
            lyrics: t.lyrics,
            genre: Array.isArray(t.genre) ? t.genre[0] : t.genre || undefined,
            source: 'track',
            createdAt: Date.parse(t.created_at) || 0,
          }));
        } catch (err: any) {
          console.error('[ComposeLyricsPick] tracks/my failed', { status: err?.response?.status });
        }
      }
      // 레거시 로컬 보관함 (구버전 저장분)
      localEntries.forEach((e) => out.push({
        id: e.id, title: e.title, lyrics: e.lyrics,
        genre: e.genre, mood: e.mood, source: 'local', createdAt: e.createdAt,
      }));
      if (!mounted) return;
      // 정렬: 방금 작사 최상단 고정 → 나머지 최신순 (가사 내용 기준 중복 제거)
      const draft = out.filter((e) => e.source === 'draft');
      const rest = out.filter((e) => e.source !== 'draft').sort((a, b) => b.createdAt - a.createdAt);
      const seen = new Set(draft.map((e) => e.lyrics.trim()));
      const dedup = rest.filter((e) => {
        const key = e.lyrics.trim();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (__DEV__) console.info('[ComposeLyricsPick] entries', { draft: draft.length, rest: dedup.length });
      setEntries([...draft, ...dedup]);
      setLoading(false);
    })();
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn]);

  const handlePick = (entry: PickEntry) => {
    if (composingRef.current) return;
    composingRef.current = true;
    setPickedTitle(entry.title);
    console.info('[ComposeLyricsPick] 가사 선택', { id: entry.id, source: entry.source });
    const music = useMusicStore.getState();
    music.setLyrics(entry.lyrics);
    music.setGenre(entry.genre || '');
    music.setMood(entry.mood || '');
    if (entry.source === 'asset') {
      music.setLyricsSource({ lyrics_id: entry.id, title: entry.title || undefined, is_mine: true });
    } else {
      music.setLyricsSource(null);
    }
    const lyrics = useLyricsStore.getState();
    if (entry.source !== 'draft') {
      lyrics.setGeneratedTitle(entry.title);
      lyrics.setGeneratedLyrics(entry.lyrics);
    }
    // 디렉터 확인 말풍선 잠깐 보여주고 작곡 흐름으로 (ComposerSelect → suno 자동 확정)
    setTimeout(() => navigation.replace('ComposerSelect'), 900);
  };

  return (
    <View style={styles.container}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 16, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* 디렉터 말풍선 */}
        <View style={styles.directorRow}>
          <View style={styles.portraitContainer}>
            <Image source={COMPOSER_PORTRAIT} style={styles.portraitImage} />
          </View>
          <View style={styles.directorBubble}>
            <AppText style={styles.directorName}>작곡 디렉터</AppText>
            <AppText style={styles.directorText}>
              {pickedTitle
                ? `『${pickedTitle}』(으)로 가볼게요! 멋진 곡을 만들어봐요.`
                : entries.length === 0 && !loading
                  ? '아직 작사한 가사가 없네요. 작사 디렉터에게 먼저 다녀와주세요!'
                  : '어떤 가사로 곡을 만들까요? 최근에 작사한 가사부터 보여드릴게요.'}
            </AppText>
          </View>
        </View>

        {loading && (
          <ActivityIndicator size="small" color={colors.accent.primary} style={{ marginTop: 24 }} />
        )}

        {/* 가사 카드 선택지 — 카드 탭=바로 작곡, [가사 보기]=전체 가사 펼치기 */}
        {!pickedTitle && entries.map((entry) => {
          const expanded = expandedIds.has(entry.id);
          return (
            <TouchableOpacity
              key={entry.id}
              style={[styles.card, entry.source === 'draft' && styles.cardDraft]}
              activeOpacity={0.8}
              onPress={() => handlePick(entry)}
            >
              <View style={styles.cardTopRow}>
                <AppText style={styles.cardTitle} numberOfLines={1}>{entry.title || '제목 없음'}</AppText>
                <View style={[styles.badge, entry.source === 'draft' && styles.badgeDraft]}>
                  <AppText style={styles.badgeText}>{SOURCE_LABEL[entry.source]}</AppText>
                </View>
              </View>
              {(entry.genre || entry.mood) && (
                <AppText style={styles.cardMeta} numberOfLines={1}>
                  {[entry.genre, entry.mood].filter(Boolean).join(' · ')}
                </AppText>
              )}
              <AppText style={styles.cardPreview} numberOfLines={expanded ? undefined : 2}>{entry.lyrics}</AppText>
              <View style={styles.cardBtnRow}>
                <TouchableOpacity
                  style={styles.viewBtn}
                  onPress={() => toggleExpand(entry.id)}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Feather name={expanded ? 'chevron-up' : 'eye'} size={12} color={colors.accent.primary} />
                  <AppText style={styles.viewBtnText}>{expanded ? '접기' : '가사 보기'}</AppText>
                </TouchableOpacity>
                {expanded && (
                  <TouchableOpacity style={styles.composeBtn} onPress={() => handlePick(entry)}>
                    <AppText style={styles.composeBtnText}>이 가사로 작곡하기</AppText>
                  </TouchableOpacity>
                )}
              </View>
            </TouchableOpacity>
          );
        })}

        {/* 빈 상태 — 작사 유도 */}
        {!loading && entries.length === 0 && (
          <TouchableOpacity style={styles.emptyBtn} onPress={() => navigation.goBack()}>
            <AppText style={styles.emptyBtnText}>작업실로 돌아가기</AppText>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.deepest },
  directorRow: { flexDirection: 'row', marginBottom: 20 },
  portraitContainer: {
    width: 56, height: 56, borderRadius: 28, overflow: 'hidden',
    borderWidth: 2, borderColor: colors.accent.primary, marginRight: 10,
  },
  portraitImage: {
    width: 56, height: 168, resizeMode: 'cover', position: 'absolute', top: 0, left: 0,
  },
  directorBubble: {
    flex: 1, backgroundColor: colors.bg.surface1, borderRadius: 14,
    borderTopLeftRadius: 4, padding: 12,
    borderWidth: 1, borderColor: colors.border.subtle,
  },
  directorName: { fontSize: 12, fontWeight: '700', color: colors.accent.primary, marginBottom: 4 },
  directorText: { fontSize: 14, color: colors.text.primary, lineHeight: 20 },
  card: {
    backgroundColor: colors.bg.surface1, borderRadius: 12, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: colors.border.subtle,
  },
  cardDraft: { borderColor: colors.accent.primary, borderWidth: 1.5 },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.text.primary, marginRight: 8 },
  badge: {
    backgroundColor: colors.bg.surface2, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6,
    borderWidth: 1, borderColor: colors.border.subtle,
  },
  badgeDraft: { backgroundColor: colors.accent.primary, borderColor: colors.accent.primary },
  badgeText: { fontSize: 10, fontWeight: '800', color: colors.text.primary },
  cardMeta: { fontSize: 11, color: colors.accent.primary, marginTop: 4 },
  cardPreview: { fontSize: 12, color: colors.text.secondary, marginTop: 6, lineHeight: 17 },
  cardBtnRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  viewBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8,
    backgroundColor: colors.bg.surface2, borderWidth: 1, borderColor: colors.border.subtle,
  },
  viewBtnText: { fontSize: 11, fontWeight: '700', color: colors.accent.primary },
  composeBtn: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
    backgroundColor: colors.accent.primary,
  },
  composeBtnText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  emptyBtn: {
    marginTop: 16, alignSelf: 'center', paddingHorizontal: 20, paddingVertical: 12,
    backgroundColor: colors.accent.primary, borderRadius: 10,
  },
  emptyBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
