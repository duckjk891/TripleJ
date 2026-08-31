// [FeedCompose] 피드 작성 — v3.61 신설(기존엔 작성 UI 부재, 읽기·댓글만 가능했음).
// 제목(선택)·내용 입력 + 음악 첨부(내 곡 목록 — 차트와 동일한 공용 TrackRow 디자인) → POST /feeds/.
// 계약: POST /api/feeds/ { title?, blocks:[{type:'text',text}|{type:'track',track_id}|{type:'image',object_name}], is_public, kind:'feed' }
// v3.111: 사진 첨부 — DocumentPicker image/* → POST /upload/feed-image(서버 재인코딩·15MB) → image 블록, 최대 4장.
import { useState, useEffect, useLayoutEffect } from 'react';
import {
  View, ScrollView, TextInput, TouchableOpacity, Modal, FlatList, Image,
  ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { showAlert } from '../utils/appAlert';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import api, { BACKEND_BASE_URL } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { AppText, Button } from '../components/ui';
import TrackRow, { RowTrack } from '../components/TrackRow';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';

// v3.111: 사진 첨부 클라 선검증 — 백엔드 /upload/feed-image 계약(jpg/png/webp ≤15MB)과 짝
const FEED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const FEED_IMAGE_MAX_BYTES = 15 * 1024 * 1024;
const MAX_FEED_IMAGES = 4;

interface AttachedImage {
  key: string;
  localUri: string;
  name: string;
  mime: string;
  status: 'uploading' | 'done' | 'failed';
  objectName?: string;
}

export default function FeedComposeScreen({ navigation, route }: any) {
  const user = useAuthStore((s) => s.user);
  // v3.115: kind 지원 — 마이페이지 커뮤니티 탭 [새 공지 작성] 진입 시 kind='community'.
  // 계약(백엔드 feeds.py v133 실측): community는 텍스트 블록만 허용(track 400·image 400·bgm 400, title은 무시·null 저장)
  // → 커뮤니티 모드에선 제목·음악 첨부·사진 첨부 UI를 숨긴다. 가사 복사(클립보드)와 [item] 마커(텍스트 블록)는 계약상 허용이라 유지.
  const kind: 'feed' | 'community' = route?.params?.kind === 'community' ? 'community' : 'feed';
  const isCommunity = kind === 'community';
  // v3.73: 상단 공백 제거 — 고정 50 대신 기기 상태바 높이만큼만(웹 0)
  const insets = useSafeAreaInsets();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [attached, setAttached] = useState<RowTrack | null>(null);
  const [posting, setPosting] = useState(false);
  // v3.111: 첨부 사진 — 선택 즉시 업로드(진행 표시), 실패분은 재시도/제거 가능
  const [images, setImages] = useState<AttachedImage[]>([]);

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
      if (!lyrics) { showAlert('알림', '이 곡에는 저장된 가사가 없어요.'); return; }
      await Clipboard.setStringAsync(lyrics);
      setPickerOpen(false);
      showAlert('복사 완료', `"${track.title}" 가사가 복사되었어요.\n원하는 위치에 붙여넣기 하세요.`);
    } catch (err: any) {
      console.error('[FeedCompose] 가사 복사 실패', { id: track.id, status: err?.response?.status });
      showAlert('오류', '가사를 복사하지 못했어요.');
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
      if (!items.length) { showAlert('알림', '이 곡에는 착장 아이템이 없어요.'); return; }
      setItemChoices(items);
    } catch (err: any) {
      console.error('[FeedCompose] 아이템 조회 실패', { id: track.id, status: err?.response?.status });
      showAlert('오류', '아이템을 불러오지 못했어요.');
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

  // v3.111: 사진 업로드 — SettingsScreen 프로필 업로드와 동일한 web/native FormData 분기 관행
  const uploadImage = async (entry: AttachedImage) => {
    if (__DEV__) console.info('[FeedCompose] 사진 업로드 시작', { name: entry.name, mime: entry.mime });
    try {
      const formData = new FormData();
      if (Platform.OS === 'web') {
        const blob = await (await fetch(entry.localUri)).blob();
        formData.append('file', blob, entry.name);
      } else {
        formData.append('file', { uri: entry.localUri, name: entry.name, type: entry.mime } as any);
      }
      const res = await api.post('/upload/feed-image', formData, {
        headers: Platform.OS === 'web' ? undefined : { 'Content-Type': 'multipart/form-data' },
        timeout: 120000,
      });
      const objectName = res.data?.object_name;
      if (!objectName) throw new Error('object_name 누락');
      console.info('[FeedCompose] 사진 업로드 성공', { objectName });
      setImages((prev) => prev.map((i) => (i.key === entry.key ? { ...i, status: 'done', objectName } : i)));
    } catch (err: any) {
      console.error('[FeedCompose] 사진 업로드 실패', { status: err?.response?.status, message: err?.message });
      setImages((prev) => prev.map((i) => (i.key === entry.key ? { ...i, status: 'failed' } : i)));
      showAlert('오류', err?.response?.data?.error || '사진 업로드에 실패했습니다. 사진을 눌러 다시 시도하거나 X로 제거해주세요.');
    }
  };

  const pickImage = async () => {
    if (images.length >= MAX_FEED_IMAGES) {
      showAlert('안내', `사진은 최대 ${MAX_FEED_IMAGES}장까지 첨부할 수 있어요.`);
      return;
    }
    // expo-image-picker 미설치 — 기존 이미지 선택 관행(SettingsScreen DocumentPicker image/*) 재사용
    const res = await DocumentPicker.getDocumentAsync({ type: 'image/*' });
    if (res.canceled || !res.assets || !res.assets[0]) return;
    const f = res.assets[0];
    const mime = f.mimeType || '';
    if (mime && !FEED_IMAGE_TYPES.includes(mime)) {
      showAlert('안내', '지원하지 않는 이미지 형식입니다. (jpg/png/webp)');
      return;
    }
    if (typeof f.size === 'number' && f.size > FEED_IMAGE_MAX_BYTES) {
      showAlert('안내', '이미지 크기는 15MB 이하여야 합니다.');
      return;
    }
    const entry: AttachedImage = {
      key: `${Date.now()}-${images.length}`,
      localUri: f.uri, name: f.name || 'image.jpg', mime: mime || 'image/jpeg',
      status: 'uploading',
    };
    setImages((prev) => [...prev, entry]);
    uploadImage(entry);
  };

  const retryImage = (entry: AttachedImage) => {
    if (entry.status !== 'failed') return;
    if (__DEV__) console.info('[FeedCompose] 사진 업로드 재시도', { name: entry.name });
    setImages((prev) => prev.map((i) => (i.key === entry.key ? { ...i, status: 'uploading' } : i)));
    uploadImage({ ...entry, status: 'uploading' });
  };

  const submit = async () => {
    // v3.111: 업로드 미완료(진행 중/실패) 사진이 있으면 사용자 선택 — 제외하고 발행 / 취소
    const notReady = images.filter((i) => i.status !== 'done');
    if (notReady.length) {
      showAlert('안내', `업로드가 끝나지 않았거나 실패한 사진이 ${notReady.length}장 있어요.`, [
        { text: '사진 제외하고 등록', onPress: () => doSubmit(images.filter((i) => i.status === 'done')) },
        { text: '취소', style: 'cancel' },
      ]);
      return;
    }
    doSubmit(images);
  };

  const doSubmit = async (readyImages: AttachedImage[]) => {
    const text = body.trim();
    if (!text && !attached && !attachedItems.length && !readyImages.length) {
      showAlert('알림', isCommunity ? '공지 내용을 입력해주세요.' : '내용을 입력하거나 음악·사진·아이템을 첨부해주세요.');
      return;
    }
    if (posting) return;
    setPosting(true);
    const blocks: any[] = [];
    if (text) blocks.push({ type: 'text', text });
    if (attached) blocks.push({ type: 'track', track_id: String(attached.id) });
    // v3.111: 업로드 완료된 사진 → image 블록
    for (const img of readyImages) {
      if (img.objectName) blocks.push({ type: 'image', object_name: img.objectName });
    }
    // v3.70: 아이템은 서버 블록 화이트리스트 제약으로 [item]{JSON} 마커 텍스트 블록으로 저장
    for (const it of attachedItems) blocks.push({ type: 'text', text: `[item]${JSON.stringify(it)}` });
    if (__DEV__) console.info('[FeedCompose] 등록', { kind, blocks: blocks.length, hasTrack: !!attached, images: readyImages.length });
    try {
      await api.post('/feeds/', {
        // v3.115: community는 서버가 title 무시(null 저장) — 입력 UI도 숨겼으니 null 고정
        title: isCommunity ? null : (title.trim() || null),
        blocks,
        is_public: true,
        kind,
      });
      navigation.goBack();
    } catch (err: any) {
      console.error('[FeedCompose] 등록 실패', { kind, status: err?.response?.status });
      showAlert('오류', `${isCommunity ? '공지' : '피드'} 등록에 실패했습니다. 잠시 후 다시 시도해주세요.`);
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
        {/* v3.115: community는 서버가 제목을 무시(null 저장)하므로 입력 자체를 숨김 */}
        {!isCommunity ? (
          <TextInput
            style={styles.titleInput}
            placeholder="제목 (선택)"
            placeholderTextColor={colors.text.muted}
            value={title}
            onChangeText={setTitle}
            maxLength={80}
          />
        ) : null}
        <TextInput
          style={styles.bodyInput}
          placeholder={isCommunity ? '구독자에게 알릴 소식을 적어주세요.' : '지금 어떤 음악 이야기를 나누고 싶나요?'}
          placeholderTextColor={colors.text.muted}
          value={body}
          onChangeText={setBody}
          maxLength={2000}
          multiline
          textAlignVertical="top"
        />

        {/* 첨부된 곡 — 차트와 동일한 TrackRow. v3.115: community는 track 블록 400 → 첨부 UI 숨김 */}
        {isCommunity ? null : attached ? (
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

        {/* v3.111: 사진 첨부 — 서버 재인코딩(긴 변 1600·q85)으로 용량 관리, 최대 4장.
            v3.115: community는 image 블록 400(텍스트만 허용) → 첨부 UI 숨김 */}
        {!isCommunity ? (
          <TouchableOpacity style={styles.attachBtn} onPress={pickImage} accessibilityLabel="사진 첨부">
            <Feather name="image" size={18} color={colors.accent.primary} />
            <AppText variant="body" tone="accent">사진 첨부{images.length ? ` (${images.length}/${MAX_FEED_IMAGES})` : ''}</AppText>
          </TouchableOpacity>
        ) : null}

        {/* 첨부된 사진 미리보기 — 업로드 중 스피너 / 실패 시 탭하여 재시도, X로 제거 */}
        {images.length ? (
          <View style={styles.imageRow}>
            {images.map((img) => (
              <View key={img.key} style={styles.imageThumbWrap}>
                <TouchableOpacity
                  disabled={img.status !== 'failed'}
                  onPress={() => retryImage(img)}
                  accessibilityLabel={img.status === 'failed' ? '사진 업로드 재시도' : '첨부된 사진'}
                >
                  <Image source={{ uri: img.localUri }} style={[styles.imageThumb, img.status !== 'done' && { opacity: 0.4 }]} />
                </TouchableOpacity>
                {img.status === 'uploading' ? (
                  <View style={styles.imageThumbOverlay} pointerEvents="none">
                    <ActivityIndicator size="small" color={colors.accent.primary} />
                  </View>
                ) : null}
                {img.status === 'failed' ? (
                  <View style={styles.imageThumbOverlay} pointerEvents="none">
                    <Feather name="alert-circle" size={18} color={colors.status.error} />
                  </View>
                ) : null}
                <TouchableOpacity
                  style={styles.imageRemove}
                  onPress={() => setImages((prev) => prev.filter((i) => i.key !== img.key))}
                  accessibilityLabel="사진 제거"
                >
                  <Feather name="x" size={12} color={colors.text.primary} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        ) : null}

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
  // v3.111: 첨부 사진 미리보기 (썸네일 + 업로드 상태 오버레이 + 제거 버튼)
  imageRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.md },
  imageThumbWrap: { width: 72, height: 72 },
  imageThumb: { width: 72, height: 72, borderRadius: radius.md, backgroundColor: colors.bg.surface2 },
  imageThumbOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  imageRemove: {
    position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center',
  },
});
