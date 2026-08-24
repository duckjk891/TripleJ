// [FeedCompose] 피드 작성 — v3.61 신설(기존엔 작성 UI 부재, 읽기·댓글만 가능했음).
// 제목(선택)·내용 입력 + 음악 첨부(내 곡 목록 — 차트와 동일한 공용 TrackRow 디자인) → POST /feeds/.
// 계약: POST /api/feeds/ { title?, blocks:[{type:'text',text}|{type:'track',track_id}], is_public, kind:'feed' }
import { useState, useEffect } from 'react';
import {
  View, ScrollView, TextInput, TouchableOpacity, Modal, FlatList,
  ActivityIndicator, Alert, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import api from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { AppText, Button } from '../components/ui';
import TrackRow, { RowTrack } from '../components/TrackRow';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';

export default function FeedComposeScreen({ navigation }: any) {
  const user = useAuthStore((s) => s.user);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [attached, setAttached] = useState<RowTrack | null>(null);
  const [posting, setPosting] = useState(false);

  // 음악 첨부/가사 불러오기 — 내 곡 목록(공용 TrackRow, 차트와 동일 디자인) 피커 공유
  // v3.69: pickerMode 'attach'=곡 첨부, 'lyrics'=선택 곡의 가사를 본문에 삽입
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<'attach' | 'lyrics'>('attach');
  const [myTracks, setMyTracks] = useState<RowTrack[]>([]);
  const [tracksLoading, setTracksLoading] = useState(false);
  const [lyricsLoading, setLyricsLoading] = useState(false);

  // 선택 곡의 가사를 본문에 삽입
  const insertLyrics = async (track: RowTrack) => {
    setLyricsLoading(true);
    if (__DEV__) console.info('[FeedCompose] 가사 불러오기', { id: track.id });
    try {
      const res = await api.get(`/tracks/${track.id}`);
      const lyrics = (res.data?.lyrics || '').trim();
      if (!lyrics) { Alert.alert('알림', '이 곡에는 저장된 가사가 없어요.'); return; }
      setBody((prev) => (prev.trim() ? `${prev}\n\n` : '') + `🎤 ${track.title}\n${lyrics}`);
      setPickerOpen(false);
    } catch (err: any) {
      console.error('[FeedCompose] 가사 조회 실패', { id: track.id, status: err?.response?.status });
      Alert.alert('오류', '가사를 불러오지 못했어요.');
    } finally {
      setLyricsLoading(false);
    }
  };

  useEffect(() => {
    if (!pickerOpen || myTracks.length) return;
    let alive = true;
    (async () => {
      setTracksLoading(true);
      if (__DEV__) console.info('[FeedCompose] 내 곡 목록 조회');
      try {
        const res = await api.get('/tracks/my', { params: { page: 1, limit: 50 } });
        if (!alive) return;
        setMyTracks(res.data?.tracks || res.data || []);
      } catch (err: any) {
        console.error('[FeedCompose] 내 곡 조회 실패', { status: err?.response?.status });
      } finally {
        if (alive) setTracksLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [pickerOpen, myTracks.length]);

  const submit = async () => {
    const text = body.trim();
    if (!text && !attached) { Alert.alert('알림', '내용을 입력하거나 음악을 첨부해주세요.'); return; }
    if (posting) return;
    setPosting(true);
    const blocks: any[] = [];
    if (text) blocks.push({ type: 'text', text });
    if (attached) blocks.push({ type: 'track', track_id: String(attached.id) });
    if (__DEV__) console.info('[FeedCompose] 피드 등록', { blocks: blocks.length, hasTrack: !!attached });
    try {
      await api.post('/feeds/', {
        title: title.trim() || null,
        blocks,
        is_public: true,
        kind: 'feed',
      });
      navigation.goBack();
    } catch (err: any) {
      console.error('[FeedCompose] 등록 실패', { status: err?.response?.status });
      Alert.alert('오류', '피드 등록에 실패했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setPosting(false);
    }
  };

  if (!user) {
    return (
      <View style={styles.container}>
        <AppText tone="secondary" center style={{ marginTop: 80 }}>로그인 후 피드를 작성할 수 있어요.</AppText>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* 헤더 */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} accessibilityLabel="작성 취소" style={{ padding: 4 }}>
          <Feather name="x" size={22} color={colors.text.primary} />
        </TouchableOpacity>
        <AppText variant="title3">피드 작성</AppText>
        <TouchableOpacity onPress={submit} disabled={posting} accessibilityLabel="피드 등록">
          <AppText variant="bodyStrong" tone={posting ? 'muted' : 'accent'}>{posting ? '등록 중…' : '등록'}</AppText>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
        <TextInput
          style={styles.titleInput}
          placeholder="제목 (선택)"
          placeholderTextColor={colors.text.muted}
          value={title}
          onChangeText={setTitle}
          maxLength={80}
        />
        <TextInput
          style={styles.bodyInput}
          placeholder="지금 어떤 음악 이야기를 나누고 싶나요?"
          placeholderTextColor={colors.text.muted}
          value={body}
          onChangeText={setBody}
          maxLength={2000}
          multiline
          textAlignVertical="top"
        />

        {/* 첨부된 곡 — 차트와 동일한 TrackRow */}
        {attached ? (
          <View style={styles.attachedBox}>
            <View style={styles.attachedHead}>
              <AppText variant="footnote" tone="secondary">첨부된 음악</AppText>
              <TouchableOpacity onPress={() => setAttached(null)} accessibilityLabel="첨부 제거">
                <Feather name="x" size={16} color={colors.text.muted} />
              </TouchableOpacity>
            </View>
            <TrackRow track={attached} onPress={() => {}} />
          </View>
        ) : (
          <TouchableOpacity style={styles.attachBtn} onPress={() => { setPickerMode('attach'); setPickerOpen(true); }} accessibilityLabel="음악 첨부">
            <Feather name="music" size={18} color={colors.accent.primary} />
            <AppText variant="body" tone="accent">음악 첨부</AppText>
          </TouchableOpacity>
        )}

        {/* v3.69: 내가 만든 곡의 가사를 본문에 삽입 */}
        <TouchableOpacity style={styles.attachBtn} onPress={() => { setPickerMode('lyrics'); setPickerOpen(true); }} accessibilityLabel="가사 불러오기">
          <Feather name="file-text" size={18} color={colors.accent.primary} />
          <AppText variant="body" tone="accent">내 가사 불러오기</AppText>
        </TouchableOpacity>
      </ScrollView>

      {/* 곡 선택 — 내 곡 목록(차트와 동일 디자인) */}
      <Modal visible={pickerOpen} animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <View style={styles.pickerContainer}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => setPickerOpen(false)} accessibilityLabel="곡 선택 닫기" style={{ padding: 4 }}>
              <Feather name="arrow-left" size={22} color={colors.text.primary} />
            </TouchableOpacity>
            <AppText variant="title3">{pickerMode === 'lyrics' ? '가사 가져올 곡 선택' : '내 곡에서 선택'}</AppText>
            <View style={{ width: 30 }}>{lyricsLoading ? <ActivityIndicator size="small" color={colors.accent.primary} /> : null}</View>
          </View>
          {tracksLoading ? (
            <ActivityIndicator size="large" color={colors.accent.primary} style={{ marginTop: 60 }} />
          ) : myTracks.length === 0 ? (
            <View style={{ marginTop: 60, alignItems: 'center', gap: spacing.md }}>
              <AppText tone="secondary">아직 발매한 곡이 없어요</AppText>
              <Button label="작업실에서 만들기" variant="tonal" onPress={() => { setPickerOpen(false); navigation.goBack(); }} />
            </View>
          ) : (
            <FlatList
              data={myTracks}
              keyExtractor={(t) => String(t.id)}
              renderItem={({ item }) => (
                <TrackRow
                  track={item}
                  onPress={() => {
                    if (pickerMode === 'lyrics') { insertLyrics(item); return; }
                    if (__DEV__) console.info('[FeedCompose] 곡 첨부', { id: item.id });
                    setAttached(item);
                    setPickerOpen(false);
                  }}
                />
              )}
              contentContainerStyle={{ paddingBottom: 40 }}
            />
          )}
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.deepest, paddingTop: 50 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.subtle,
  },
  titleInput: {
    color: colors.text.primary, fontSize: 17, fontWeight: '700',
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.subtle,
  },
  bodyInput: {
    color: colors.text.primary, fontSize: 15, lineHeight: 22,
    minHeight: 140, paddingVertical: spacing.md,
  },
  attachBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    borderWidth: 1, borderColor: colors.accent.primary, borderRadius: radius.lg,
    paddingVertical: spacing.md, marginTop: spacing.md,
  },
  attachedBox: {
    marginTop: spacing.md, backgroundColor: colors.bg.surface1, borderRadius: radius.lg,
    paddingTop: spacing.sm,
  },
  attachedHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  pickerContainer: { flex: 1, backgroundColor: colors.bg.deepest, paddingTop: 50 },
});
