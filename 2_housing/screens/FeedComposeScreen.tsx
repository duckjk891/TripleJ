// [FeedCompose] 피드 작성 — v3.61 신설(기존엔 작성 UI 부재, 읽기·댓글만 가능했음).
// 제목(선택)·내용 입력 + 음악 첨부(내 곡 목록 — 차트와 동일한 공용 TrackRow 디자인) → POST /feeds/.
// 계약: POST /api/feeds/ { title?, blocks:[{type:'text',text}|{type:'track',track_id}], is_public, kind:'feed' }
import { useState, useEffect, useLayoutEffect } from 'react';
import {
  View, ScrollView, TextInput, TouchableOpacity, Modal, FlatList, Image,
  ActivityIndicator, Alert, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import api, { BACKEND_BASE_URL } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { AppText, Button } from '../components/ui';
import TrackRow, { RowTrack } from '../components/TrackRow';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';

export default function FeedComposeScreen({ navigation }: any) {
  const user = useAuthStore((s) => s.user);
  // v3.73: 상단 공백 제거 — 고정 50 대신 기기 상태바 높이만큼만(웹 0)
  const insets = useSafeAreaInsets();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [attached, setAttached] = useState<RowTrack | null>(null);
  const [posting, setPosting] = useState(false);

  // 음악 첨부/가사 복사/아이템 첨부 — 내 곡 목록(공용 TrackRow, 차트와 동일 디자인) 피커 공유
  // v3.70: pickerMode 'attach'=곡 첨부, 'lyrics'=선택 곡 가사를 클립보드에 복사, 'item'=곡의 착장 아이템 첨부(공구)
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<'attach' | 'lyrics' | 'item'>('attach');
  const [myTracks, setMyTracks] = useState<RowTrack[]>([]);
  const [tracksLoading, setTracksLoading] = useState(false);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  // 아이템 선택 2단계(곡 → 그 곡의 착장 아이템)와 첨부된 아이템(마커 블록으로 저장)
  const [itemChoices, setItemChoices] = useState<any[] | null>(null);
  const [attachedItems, setAttachedItems] = useState<{ name: string; category?: string; url?: string; img?: string }[]>([]);
  // v3.71: 착장 유무는 곡 상세에만 있어 병렬 조회로 판별 — trackId → used_items 캐시(null=미조회)
  const [itemTrackMap, setItemTrackMap] = useState<Record<string, any[]> | null>(null);
  const [itemFilterLoading, setItemFilterLoading] = useState(false);

  // v3.70: 선택 곡의 가사를 클립보드에 복사(본문 삽입 아님 — 원하는 위치에 붙여넣기)
  const copyLyrics = async (track: RowTrack) => {
    setLyricsLoading(true);
    if (__DEV__) console.info('[FeedCompose] 가사 복사', { id: track.id });
    try {
      const res = await api.get(`/tracks/${track.id}`);
      const lyrics = (res.data?.lyrics || '').trim();
      if (!lyrics) { Alert.alert('알림', '이 곡에는 저장된 가사가 없어요.'); return; }
      await Clipboard.setStringAsync(lyrics);
      setPickerOpen(false);
      Alert.alert('복사 완료', `"${track.title}" 가사가 복사되었어요.\n원하는 위치에 붙여넣기 하세요.`);
    } catch (err: any) {
      console.error('[FeedCompose] 가사 복사 실패', { id: track.id, status: err?.response?.status });
      Alert.alert('오류', '가사를 복사하지 못했어요.');
    } finally {
      setLyricsLoading(false);
    }
  };

  // v3.70: 곡 선택 → 그 곡의 착장 아이템 목록 로드(2단계). v3.71: 필터 단계 캐시를 우선 사용.
  const loadItemsOf = async (track: RowTrack) => {
    const cached = itemTrackMap?.[String(track.id)];
    if (cached?.length) { setItemChoices(cached); return; }
    setLyricsLoading(true);
    if (__DEV__) console.info('[FeedCompose] 착장 아이템 조회', { id: track.id });
    try {
      const res = await api.get(`/tracks/${track.id}`);
      const items = res.data?.cover_character?.used_items || [];
      if (!items.length) { Alert.alert('알림', '이 곡에는 착장 아이템이 없어요.'); return; }
      setItemChoices(items);
    } catch (err: any) {
      console.error('[FeedCompose] 아이템 조회 실패', { id: track.id, status: err?.response?.status });
      Alert.alert('오류', '아이템을 불러오지 못했어요.');
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

  // v3.71: 아이템 모드 — 착장 아이템이 있는 곡만 보이도록 곡 상세를 병렬 조회해 필터(1회 캐시)
  useEffect(() => {
    if (!pickerOpen || pickerMode !== 'item' || itemTrackMap || !myTracks.length) return;
    let alive = true;
    (async () => {
      setItemFilterLoading(true);
      if (__DEV__) console.info('[FeedCompose] 착장 보유 곡 필터 조회', { count: myTracks.length });
      try {
        const results = await Promise.allSettled(myTracks.map((t) => api.get(`/tracks/${t.id}`)));
        if (!alive) return;
        const map: Record<string, any[]> = {};
        results.forEach((r, i) => {
          if (r.status !== 'fulfilled') return;
          const items = r.value.data?.cover_character?.used_items || [];
          if (items.length) map[String(myTracks[i].id)] = items;
        });
        if (__DEV__) console.info('[FeedCompose] 착장 보유 곡', { count: Object.keys(map).length });
        setItemTrackMap(map);
      } finally {
        if (alive) setItemFilterLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [pickerOpen, pickerMode, myTracks.length, itemTrackMap]);

  const submit = async () => {
    const text = body.trim();
    if (!text && !attached && !attachedItems.length) { Alert.alert('알림', '내용을 입력하거나 음악·아이템을 첨부해주세요.'); return; }
    if (posting) return;
    setPosting(true);
    const blocks: any[] = [];
    if (text) blocks.push({ type: 'text', text });
    if (attached) blocks.push({ type: 'track', track_id: String(attached.id) });
    // v3.70: 아이템은 서버 블록 화이트리스트(text|track) 제약으로 [item]{JSON} 마커 텍스트 블록으로 저장
    for (const it of attachedItems) blocks.push({ type: 'text', text: `[item]${JSON.stringify(it)}` });
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

  // v3.73: 타이틀·취소는 네이티브 상단바(App.tsx)로 이동, 등록 버튼은 headerRight로 주입
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity onPress={submit} disabled={posting} accessibilityLabel="피드 등록" style={{ marginRight: 12 }}>
          <AppText variant="bodyStrong" tone={posting ? 'muted' : 'accent'}>{posting ? '등록 중…' : '등록'}</AppText>
        </TouchableOpacity>
      ),
    });
  });

  if (!user) {
    return (
      <View style={styles.container}>
        <AppText tone="secondary" center style={{ marginTop: 80 }}>로그인 후 피드를 작성할 수 있어요.</AppText>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
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

        {/* v3.70: 내가 만든 곡의 가사를 클립보드로 복사 */}
        <TouchableOpacity style={styles.attachBtn} onPress={() => { setPickerMode('lyrics'); setPickerOpen(true); }} accessibilityLabel="내 가사 복사">
          <Feather name="copy" size={18} color={colors.accent.primary} />
          <AppText variant="body" tone="accent">내 가사 복사</AppText>
        </TouchableOpacity>

        {/* v3.70: 아티스트 착장 아이템 첨부(공구/광고) — 내 곡 선택 → 그 곡의 착장에서 선택 */}
        <TouchableOpacity style={styles.attachBtn} onPress={() => { setPickerMode('item'); setItemChoices(null); setPickerOpen(true); }} accessibilityLabel="아이템 첨부">
          <Feather name="shopping-bag" size={18} color={colors.accent.primary} />
          <AppText variant="body" tone="accent">착장 아이템 첨부</AppText>
        </TouchableOpacity>

        {/* 첨부된 아이템 미리보기 */}
        {attachedItems.map((it, i) => (
          <View key={`it${i}`} style={styles.itemPreview}>
            {it.img ? <Image source={{ uri: `${BACKEND_BASE_URL}/api/character/preview/${it.img}` }} style={styles.itemPreviewImg} /> : <View style={styles.itemPreviewImg} />}
            <View style={{ flex: 1 }}>
              <AppText variant="caption" tone="accent">{it.category || '아이템'}</AppText>
              <AppText variant="footnote" numberOfLines={1}>{it.name}</AppText>
            </View>
            <TouchableOpacity onPress={() => setAttachedItems((prev) => prev.filter((_, j) => j !== i))} accessibilityLabel="아이템 제거">
              <Feather name="x" size={16} color={colors.text.muted} />
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>

      {/* 곡 선택 — 내 곡 목록(차트와 동일 디자인) */}
      <Modal visible={pickerOpen} animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <View style={[styles.pickerContainer, { paddingTop: insets.top }]}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => setPickerOpen(false)} accessibilityLabel="곡 선택 닫기" style={{ padding: 4 }}>
              <Feather name="arrow-left" size={22} color={colors.text.primary} />
            </TouchableOpacity>
            <AppText variant="title3">
              {itemChoices ? '아이템 선택'
                : pickerMode === 'lyrics' ? '가사 복사할 곡 선택'
                : pickerMode === 'item' ? '착장이 있는 곡 선택'
                : '내 곡에서 선택'}
            </AppText>
            <View style={{ width: 30 }}>{lyricsLoading ? <ActivityIndicator size="small" color={colors.accent.primary} /> : null}</View>
          </View>
          {itemChoices ? (
            // v3.70: 2단계 — 선택 곡의 착장 아이템 목록
            <FlatList
              data={itemChoices}
              keyExtractor={(it, i) => String(it.id || i)}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.itemPreview}
                  accessibilityLabel={`아이템 ${item.name || ''}`}
                  onPress={() => {
                    if (__DEV__) console.info('[FeedCompose] 아이템 첨부', { name: item.name });
                    setAttachedItems((prev) => [...prev, {
                      name: item.name || '아이템', category: item.category,
                      url: item.product_url, img: item.image_object_name,
                    }]);
                    setItemChoices(null); setPickerOpen(false);
                  }}
                >
                  {item.image_object_name
                    ? <Image source={{ uri: `${BACKEND_BASE_URL}/api/character/preview/${item.image_object_name}` }} style={styles.itemPreviewImg} />
                    : <View style={styles.itemPreviewImg} />}
                  <View style={{ flex: 1 }}>
                    <AppText variant="caption" tone="accent">{item.category || '아이템'}</AppText>
                    <AppText variant="footnote" numberOfLines={2}>{item.name || ''}</AppText>
                  </View>
                  <Feather name="plus-circle" size={18} color={colors.accent.primary} />
                </TouchableOpacity>
              )}
              contentContainerStyle={{ padding: spacing.lg, paddingBottom: 40 }}
            />
          ) : tracksLoading || (pickerMode === 'item' && itemFilterLoading) ? (
            <ActivityIndicator size="large" color={colors.accent.primary} style={{ marginTop: 60 }} />
          ) : myTracks.length === 0 ? (
            <View style={{ marginTop: 60, alignItems: 'center', gap: spacing.md }}>
              <AppText tone="secondary">아직 발매한 곡이 없어요</AppText>
              <Button label="작업실에서 만들기" variant="tonal" onPress={() => { setPickerOpen(false); navigation.goBack(); }} />
            </View>
          ) : pickerMode === 'item' && itemTrackMap && Object.keys(itemTrackMap).length === 0 ? (
            <View style={{ marginTop: 60, alignItems: 'center', gap: spacing.md }}>
              <AppText tone="secondary">착장 아이템이 있는 곡이 없어요</AppText>
            </View>
          ) : (
            <FlatList
              data={pickerMode === 'item' && itemTrackMap ? myTracks.filter((t) => itemTrackMap[String(t.id)]) : myTracks}
              keyExtractor={(t) => String(t.id)}
              renderItem={({ item }) => (
                <TrackRow
                  track={item}
                  onPress={() => {
                    if (pickerMode === 'lyrics') { copyLyrics(item); return; }
                    if (pickerMode === 'item') { loadItemsOf(item); return; }
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
  container: { flex: 1, backgroundColor: colors.bg.deepest },
  // v3.73: (곡 선택 모달 전용) 네이티브 상단바와 동일 규격 — 높이 56, 최상단 배치
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    height: 56, paddingHorizontal: spacing.lg,
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
  pickerContainer: { flex: 1, backgroundColor: colors.bg.deepest },
  // v3.70: 착장 아이템 행(선택 목록·첨부 미리보기 공용)
  itemPreview: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.bg.surface1, borderRadius: radius.lg,
    padding: spacing.sm, marginTop: spacing.sm,
  },
  itemPreviewImg: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.bg.surface2 },
});
