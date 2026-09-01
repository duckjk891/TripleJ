// [AlbumDetailScreen] v3.96(파리티 Wave 6, A-2): 앨범 상세 열람 + 내 앨범 관리.
// 열람: 커버·제목·아티스트·설명·트랙 목록·전체 재생 (비회원 포함 공개 앨범 누구나).
// 관리(소유자만): 정보 수정(제목/설명/공개) · 트랙 추가(내 발매 트랙만 — 서버 규칙) · 제거 ·
//   순서 위/아래 이동 · 커버 변경(업로드/AI 생성/첫 곡 자동) · 앨범 삭제.
// v3.120: AI 커버 = 작업실 자켓 커버와 동일한 이미지 디렉터 대화 흐름(AlbumCoverGeneration 진입).
//   직접 호출(POST /albums/cover/generate, v3.119 runAiCover)은 제거 — 생성·⭐과금·피로 게이트·
//   refine/버전은 CoverGenerationScreen(/upload/generate-cover v220)이 수행, 확정 시 PATCH /{id}/cover.
// 계약: services/albumService.ts 주석 참조(backend albums.py v69). 팝업은 전부 앱 내(showAlert/Modal).
import { useState, useCallback, useMemo, useEffect } from 'react';
import { useRoute, useNavigation, useFocusEffect } from '@react-navigation/native';
import {
  View, ScrollView, Image, TouchableOpacity, ActivityIndicator,
  Modal, TextInput, Switch, StyleSheet,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { showAlert } from '../utils/appAlert';
import { useAuthStore } from '../stores/authStore';
import { usePlayerStore } from '../stores/playerStore';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { AppText, Button, EmptyState } from '../components/ui';
import TrackRow, { trackRowStyles } from '../components/TrackRow';
import {
  Album, getAlbum, updateAlbum, deleteAlbum, addAlbumTracks, removeAlbumTrack,
  reorderAlbumTracks, updateAlbumCover, getMyTracksForAlbum, albumCoverUri,
} from '../services/albumService';
// v3.120: /points/costs 조회(메뉴의 ⭐cover 라벨)용 — 생성 자체는 AlbumCoverGeneration에서
import api from '../services/api';

// 서버 제약(albums.py): 커버 png/jpg/jpeg/webp ≤10MB
const COVER_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const COVER_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

function formatDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

// 앨범 상세 트랙은 cover_image가 presigned 풀 URL — TrackRow는 object명 기반 프록시를 쓰므로
// cover_image_url(object명)만 남겨 채널/차트와 동일하게 렌더한다.
function toRowTrack(t: any) {
  return { ...t, id: String(t.id), cover_image: undefined };
}

export default function AlbumDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { albumId } = route.params || {};
  const { user } = useAuthStore();
  const playerStore = usePlayerStore();

  const [album, setAlbum] = useState<Album | null>(null);
  const [loading, setLoading] = useState(true);
  const [manageMode, setManageMode] = useState(false);
  const [busy, setBusy] = useState(false); // 관리 API 진행 중(순서/제거/커버 등) — 중복 탭 방지

  // 정보 수정 모달
  const [editVisible, setEditVisible] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editPublic, setEditPublic] = useState(true);
  const [editSaving, setEditSaving] = useState(false);

  // 트랙 추가 모달
  const [addVisible, setAddVisible] = useState(false);
  const [myTracks, setMyTracks] = useState<any[]>([]);
  const [myTracksLoading, setMyTracksLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [addSaving, setAddSaving] = useState(false);

  const isOwner = !!user && !!album && String(album.owner_id) === String(user.id);
  const tracks = album?.tracks || [];

  // v3.119: AI 커버 ⭐ 비용 — /points/costs의 cover 실값 (기존 화면별 직조회 관행, 실패 시 5 폴백)
  const [coverCost, setCoverCost] = useState(5);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await api.get('/points/costs');
        if (alive && res.data?.costs?.cover != null) setCoverCost(res.data.costs.cover);
      } catch (err: any) {
        console.error('[AlbumDetail] /points/costs 조회 실패', { status: err?.response?.status });
      }
    })();
    return () => { alive = false; };
  }, []);

  const fetchAlbum = useCallback(async () => {
    try {
      const data = await getAlbum(String(albumId));
      setAlbum(data);
    } catch (err: any) {
      console.error('[AlbumDetail] 앨범 조회 실패', { albumId, status: err?.response?.status });
      showAlert('오류', err?.response?.data?.error || '앨범을 불러오지 못했어요.', [
        { text: '확인', onPress: () => navigation.goBack() },
      ]);
    } finally {
      setLoading(false);
    }
  }, [albumId, navigation]);

  useFocusEffect(useCallback(() => { fetchAlbum(); }, [fetchAlbum]));

  const playFrom = (track: any) => {
    if (!tracks.length) return;
    if (__DEV__) console.info('[AlbumDetail] 재생', { albumId, trackId: track?.id });
    playerStore.setQueue(tracks);
    const idx = tracks.findIndex((t: any) => String(t.id) === String(track.id));
    playerStore.setCurrentIndex(idx >= 0 ? idx : 0);
    navigation.navigate('Player', { track });
  };

  // ── 관리: 정보 수정 ──────────────────────────────────────────────────────
  const openEdit = () => {
    if (!album) return;
    setEditTitle(album.title || '');
    setEditDesc(album.description || '');
    setEditPublic(album.is_public !== false);
    setEditVisible(true);
  };

  const saveEdit = async () => {
    if (!album || editSaving) return;
    const title = editTitle.trim();
    if (!title) { showAlert('안내', '앨범 제목을 입력해주세요.'); return; }
    setEditSaving(true);
    try {
      const updated = await updateAlbum(album.id, {
        title, description: editDesc, is_public: editPublic,
      });
      setAlbum(updated);
      setEditVisible(false);
      console.info('[AlbumDetail] 정보 수정 완료', { albumId: album.id });
    } catch (err: any) {
      console.error('[AlbumDetail] 정보 수정 실패', { albumId: album.id, status: err?.response?.status });
      showAlert('오류', err?.response?.data?.error || '수정에 실패했어요.');
    } finally {
      setEditSaving(false);
    }
  };

  // ── 관리: 앨범 삭제 ──────────────────────────────────────────────────────
  const confirmDelete = () => {
    if (!album) return;
    showAlert('앨범 삭제', `"${album.title}" 앨범을 삭제하시겠어요?\n(트랙 자체는 삭제되지 않아요)`, [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제', style: 'destructive',
        onPress: async () => {
          try {
            await deleteAlbum(album.id);
            console.info('[AlbumDetail] 앨범 삭제 완료', { albumId: album.id });
            navigation.goBack();
          } catch (err: any) {
            console.error('[AlbumDetail] 앨범 삭제 실패', { albumId: album.id, status: err?.response?.status });
            showAlert('오류', err?.response?.data?.error || '삭제에 실패했어요.');
          }
        },
      },
    ]);
  };

  // ── 관리: 트랙 추가/제거/순서 ────────────────────────────────────────────
  const openAddTracks = async () => {
    setSelectedIds(new Set());
    setAddVisible(true);
    setMyTracksLoading(true);
    try {
      const list = await getMyTracksForAlbum(100);
      const inAlbum = new Set(tracks.map((t: any) => String(t.id)));
      setMyTracks(list.filter((t: any) => !inAlbum.has(String(t.id))));
    } catch (err: any) {
      console.error('[AlbumDetail] 내 트랙 조회 실패', { status: err?.response?.status });
      setMyTracks([]);
    } finally {
      setMyTracksLoading(false);
    }
  };

  const toggleSelect = (trackId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(trackId) ? next.delete(trackId) : next.add(trackId);
      return next;
    });
  };

  const saveAddTracks = async () => {
    if (!album || addSaving || selectedIds.size === 0) return;
    setAddSaving(true);
    try {
      const updated = await addAlbumTracks(album.id, [...selectedIds]);
      setAlbum(updated);
      setAddVisible(false);
      console.info('[AlbumDetail] 트랙 추가 완료', { albumId: album.id, added: selectedIds.size });
    } catch (err: any) {
      console.error('[AlbumDetail] 트랙 추가 실패', { albumId: album.id, status: err?.response?.status });
      showAlert('오류', err?.response?.data?.error || '트랙 추가에 실패했어요.');
    } finally {
      setAddSaving(false);
    }
  };

  const confirmRemoveTrack = (track: any) => {
    if (!album) return;
    const isLast = tracks.length <= 1;
    showAlert(
      '트랙 제거',
      isLast
        ? `"${track.title}"은(는) 마지막 트랙이에요. 제거하면 앨범도 함께 삭제됩니다.`
        : `"${track.title}"을(를) 앨범에서 제거하시겠어요?`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '제거', style: 'destructive',
          onPress: async () => {
            if (busy) return;
            setBusy(true);
            try {
              const res = await removeAlbumTrack(album.id, String(track.id));
              if (res.albumDeleted) {
                console.info('[AlbumDetail] 마지막 트랙 제거 → 앨범 삭제', { albumId: album.id });
                showAlert('안내', '마지막 트랙이 제거되어 앨범이 삭제되었어요.', [
                  { text: '확인', onPress: () => navigation.goBack() },
                ]);
              } else if (res.album) {
                setAlbum(res.album);
              }
            } catch (err: any) {
              console.error('[AlbumDetail] 트랙 제거 실패', { albumId: album.id, status: err?.response?.status });
              showAlert('오류', err?.response?.data?.error || '트랙 제거에 실패했어요.');
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  // 위/아래 이동 버튼 방식(드래그 라이브러리 미도입) — 서버엔 전체 순서 리스트로 반영
  const moveTrack = async (index: number, dir: -1 | 1) => {
    if (!album || busy) return;
    const next = index + dir;
    if (next < 0 || next >= tracks.length) return;
    const ids = tracks.map((t: any) => String(t.id));
    [ids[index], ids[next]] = [ids[next], ids[index]];
    setBusy(true);
    try {
      const updated = await reorderAlbumTracks(album.id, ids);
      setAlbum(updated);
    } catch (err: any) {
      console.error('[AlbumDetail] 순서 변경 실패', { albumId: album.id, status: err?.response?.status });
      showAlert('오류', err?.response?.data?.error || '순서 변경에 실패했어요.');
    } finally {
      setBusy(false);
    }
  };

  // ── 관리: 커버 변경 ──────────────────────────────────────────────────────
  const pickAndUploadCover = async () => {
    if (!album) return;
    try {
      // expo-image-picker 미설치 — 기존 이미지 선택 관행(DocumentPicker image/*) 재사용
      const res = await DocumentPicker.getDocumentAsync({ type: 'image/*' });
      if (res.canceled || !res.assets || !res.assets[0]) return;
      const file = res.assets[0];
      const mime = file.mimeType || '';
      if (mime && !COVER_IMAGE_TYPES.includes(mime)) {
        showAlert('안내', '지원하지 않는 이미지 형식입니다. (png/jpg/webp)');
        return;
      }
      if (typeof file.size === 'number' && file.size > COVER_IMAGE_MAX_BYTES) {
        showAlert('안내', '이미지 크기는 10MB 이하여야 합니다.');
        return;
      }
      setBusy(true);
      const updated = await updateAlbumCover(album.id, {
        file: { fileUri: file.uri, fileName: file.name || 'cover.png', mimeType: mime || 'image/png' },
      });
      setAlbum(updated);
      console.info('[AlbumDetail] 커버 업로드 완료', { albumId: album.id });
    } catch (err: any) {
      console.error('[AlbumDetail] 커버 업로드 실패', { albumId: album.id, status: err?.response?.status });
      showAlert('오류', err?.response?.data?.error || '커버 업로드에 실패했어요.');
    } finally {
      setBusy(false);
    }
  };

  // v3.120: AI 커버 — 버튼 한 번 자동 생성(v3.119 runAiCover) 대신 이미지 디렉터와
  // 대화(스타일·요청·아티스트 포함)로 만드는 CoverGenerationScreen 앨범 모드로 진입.
  // 컨텍스트(앨범 제목·수록곡 제목)는 파라미터로 전달 — musicStore cover* 미사용.
  // ⭐과금·피로 게이트·refine/버전은 해당 화면(/upload/generate-cover v220)이 수행하고,
  // "앨범 커버로 확정" 시 PATCH /albums/{id}/cover(objectName) 후 이 화면으로 복귀(focus 재조회).
  const openAiCoverDirector = () => {
    if (!album) return;
    console.info('[AlbumDetail] AI 커버 — 이미지 디렉터(앨범 모드) 진입', { albumId: album.id });
    navigation.navigate('AlbumCoverGeneration', {
      albumMode: {
        albumId: String(album.id),
        albumTitle: album.title,
        trackTitles: tracks.map((t: any) => String(t.title || '')).filter(Boolean),
      },
    });
  };

  const resetCoverAuto = async () => {
    if (!album || busy) return;
    setBusy(true);
    try {
      const updated = await updateAlbumCover(album.id, {});
      setAlbum(updated);
      console.info('[AlbumDetail] 커버 자동(첫 곡) 적용', { albumId: album.id });
    } catch (err: any) {
      console.error('[AlbumDetail] 커버 자동 적용 실패', { albumId: album.id, status: err?.response?.status });
      showAlert('오류', err?.response?.data?.error || '커버 변경에 실패했어요.');
    } finally {
      setBusy(false);
    }
  };

  const openCoverMenu = () => {
    showAlert('앨범 커버 변경', '커버를 어떻게 바꿀까요?', [
      { text: '이미지 업로드', onPress: pickAndUploadCover },
      { text: `AI 커버 생성 (⭐${coverCost})`, onPress: openAiCoverDirector },
      { text: '첫 곡 커버로 자동', onPress: resetCoverAuto },
      { text: '취소', style: 'cancel' },
    ]);
  };

  const coverUri = useMemo(() => albumCoverUri(album?.cover_image), [album?.cover_image]);

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={colors.accent.primary} />
      </View>
    );
  }
  if (!album) {
    return (
      <View style={[styles.container, styles.center]}>
        <EmptyState title="앨범을 찾을 수 없어요" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: playerStore.track ? 140 : 80 }}>
        {/* 헤더: 커버 + 메타 */}
        <View style={styles.head}>
          <View style={styles.coverWrap}>
            {coverUri
              ? <Image source={{ uri: coverUri }} style={styles.coverImg} />
              : <AppText variant="title1" tone="muted">♪</AppText>}
            {busy ? (
              <View style={styles.coverLoading}><ActivityIndicator size="small" color={colors.accent.primary} /></View>
            ) : null}
          </View>
          <AppText variant="title2" center style={{ marginTop: spacing.md }}>{album.title}</AppText>
          <TouchableOpacity
            onPress={() => navigation.navigate('UserChannel', { authorId: String(album.owner_id), name: album.artist_name })}
            accessibilityLabel={`${album.artist_name} 채널`}
          >
            <AppText variant="callout" tone="accent" center style={{ marginTop: spacing.xs }}>
              {album.artist_name || '알 수 없는 아티스트'}
            </AppText>
          </TouchableOpacity>
          <AppText variant="caption" tone="muted" center style={{ marginTop: spacing.xs }}>
            {[`${album.track_count ?? tracks.length}곡`, formatDate(album.release_date), album.is_public === false ? '비공개' : null]
              .filter(Boolean).join(' · ')}
          </AppText>
          {album.description ? (
            <AppText variant="footnote" tone="secondary" center style={{ marginTop: spacing.sm, paddingHorizontal: spacing.lg }}>
              {album.description}
            </AppText>
          ) : null}

          <View style={styles.headActions}>
            <Button label="전체 재생" size="sm" onPress={() => tracks.length && playFrom(tracks[0])} />
            {isOwner ? (
              <Button
                label={manageMode ? '관리 완료' : '앨범 관리'}
                size="sm" variant="tonal"
                onPress={() => setManageMode((v) => !v)}
              />
            ) : null}
          </View>
        </View>

        {/* 관리 액션 바 (소유자 + 관리 모드) */}
        {isOwner && manageMode ? (
          <View style={styles.manageBar}>
            {[
              { icon: 'edit-2' as const, label: '정보 수정', onPress: openEdit },
              { icon: 'plus' as const, label: '트랙 추가', onPress: openAddTracks },
              { icon: 'image' as const, label: '커버 변경', onPress: openCoverMenu },
              { icon: 'trash-2' as const, label: '앨범 삭제', onPress: confirmDelete, danger: true },
            ].map((a) => (
              <TouchableOpacity key={a.label} style={styles.manageBtn} onPress={a.onPress} accessibilityLabel={a.label}>
                <Feather name={a.icon} size={16} color={a.danger ? colors.status.error : colors.text.secondary} />
                <AppText variant="caption" tone={a.danger ? undefined : 'secondary'}
                  style={a.danger ? { color: colors.status.error } : undefined}>
                  {a.label}
                </AppText>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        {/* 트랙 목록 */}
        {tracks.length === 0 ? (
          <EmptyState title="앨범에 트랙이 없어요" />
        ) : tracks.map((t: any, i: number) => (
          <TrackRow
            key={String(t.id)}
            track={toRowTrack(t)}
            left={<AppText variant="bodyStrong" center style={trackRowStyles.rank} tone="muted">{i + 1}</AppText>}
            onPress={() => playFrom(t)}
            footer={isOwner && manageMode ? (
              <View style={styles.rowManage}>
                <TouchableOpacity style={styles.rowManageBtn} disabled={busy || i === 0}
                  onPress={() => moveTrack(i, -1)} accessibilityLabel="위로 이동">
                  <Feather name="arrow-up" size={14} color={i === 0 ? colors.text.muted : colors.text.secondary} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.rowManageBtn} disabled={busy || i === tracks.length - 1}
                  onPress={() => moveTrack(i, 1)} accessibilityLabel="아래로 이동">
                  <Feather name="arrow-down" size={14} color={i === tracks.length - 1 ? colors.text.muted : colors.text.secondary} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.rowManageBtn} disabled={busy}
                  onPress={() => confirmRemoveTrack(t)} accessibilityLabel="앨범에서 제거">
                  <Feather name="x" size={14} color={colors.status.error} />
                </TouchableOpacity>
              </View>
            ) : undefined}
          />
        ))}
      </ScrollView>

      {/* 정보 수정 모달 (앱 내 Modal — 시스템 팝업 금지) */}
      <Modal visible={editVisible} transparent animationType="fade" onRequestClose={() => setEditVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <AppText variant="subtitle" style={{ marginBottom: spacing.md }}>앨범 정보 수정</AppText>
            <AppText variant="caption" tone="secondary">제목</AppText>
            <TextInput
              style={styles.input} value={editTitle} onChangeText={setEditTitle}
              placeholder="앨범 제목" placeholderTextColor={colors.text.muted} maxLength={200}
            />
            <AppText variant="caption" tone="secondary" style={{ marginTop: spacing.sm }}>설명</AppText>
            <TextInput
              style={[styles.input, styles.inputMulti]} value={editDesc} onChangeText={setEditDesc}
              placeholder="앨범 설명 (선택)" placeholderTextColor={colors.text.muted} multiline
            />
            <View style={styles.switchRow}>
              <AppText variant="callout">공개 앨범</AppText>
              <Switch
                value={editPublic} onValueChange={setEditPublic}
                trackColor={{ false: colors.bg.surface2, true: colors.accent.primary }}
                thumbColor="#fff"
              />
            </View>
            <View style={styles.modalActions}>
              <Button label="취소" size="sm" variant="tonal" onPress={() => setEditVisible(false)} />
              <Button label={editSaving ? '저장 중...' : '저장'} size="sm" loading={editSaving} onPress={saveEdit} />
            </View>
          </View>
        </View>
      </Modal>

      {/* 트랙 추가 모달 — 내 발매 트랙 중 앨범에 없는 곡만 (서버: 본인 트랙만 허용) */}
      <Modal visible={addVisible} transparent animationType="fade" onRequestClose={() => setAddVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { maxHeight: '75%' }]}>
            <AppText variant="subtitle" style={{ marginBottom: spacing.xs }}>트랙 추가</AppText>
            <AppText variant="caption" tone="muted" style={{ marginBottom: spacing.md }}>
              내가 만든 곡만 앨범에 담을 수 있어요. ({selectedIds.size}곡 선택됨)
            </AppText>
            {myTracksLoading ? (
              <ActivityIndicator size="small" color={colors.accent.primary} style={{ marginVertical: spacing.xl }} />
            ) : myTracks.length === 0 ? (
              <AppText variant="footnote" tone="muted" center style={{ marginVertical: spacing.xl }}>
                추가할 수 있는 곡이 없어요.
              </AppText>
            ) : (
              <ScrollView style={{ flexGrow: 0 }}>
                {myTracks.map((t: any) => {
                  const id = String(t.id);
                  const checked = selectedIds.has(id);
                  return (
                    <TouchableOpacity key={id} style={styles.pickRow} onPress={() => toggleSelect(id)}
                      accessibilityLabel={`트랙 선택 ${t.title}`}>
                      <Feather name={checked ? 'check-square' : 'square'} size={18}
                        color={checked ? colors.accent.primary : colors.text.muted} />
                      <AppText variant="callout" numberOfLines={1} style={{ flex: 1, marginLeft: spacing.sm }}>
                        {t.title}
                      </AppText>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
            <View style={styles.modalActions}>
              <Button label="취소" size="sm" variant="tonal" onPress={() => setAddVisible(false)} />
              <Button
                label={addSaving ? '추가 중...' : `${selectedIds.size}곡 추가`}
                size="sm" loading={addSaving}
                disabled={selectedIds.size === 0}
                onPress={saveAddTracks}
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.deepest },
  center: { justifyContent: 'center', alignItems: 'center' },
  head: { alignItems: 'center', paddingTop: spacing.xl, paddingBottom: spacing.lg, paddingHorizontal: spacing.lg },
  coverWrap: {
    width: 160, height: 160, borderRadius: radius.lg, overflow: 'hidden',
    backgroundColor: colors.bg.surface1, justifyContent: 'center', alignItems: 'center',
  },
  coverImg: { width: 160, height: 160 },
  coverLoading: {
    ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center', alignItems: 'center',
  },
  headActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  manageBar: {
    flexDirection: 'row', justifyContent: 'space-around',
    paddingVertical: spacing.sm, marginHorizontal: spacing.lg, marginBottom: spacing.sm,
    backgroundColor: colors.bg.surface1, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border.subtle,
  },
  manageBtn: { alignItems: 'center', gap: 3, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  rowManage: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs },
  rowManageBtn: {
    width: 28, height: 24, borderRadius: radius.sm, backgroundColor: colors.bg.surface2,
    justifyContent: 'center', alignItems: 'center',
  },
  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', paddingHorizontal: spacing.xl,
  },
  modalCard: {
    backgroundColor: colors.bg.surface1, borderRadius: radius.xl, padding: spacing.xl,
    borderWidth: 1, borderColor: colors.border.subtle,
  },
  input: {
    backgroundColor: colors.bg.deepest, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border.subtle,
    color: colors.text.primary, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    fontSize: 14, marginTop: spacing.xs,
  },
  inputMulti: { minHeight: 72, textAlignVertical: 'top' },
  switchRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.md,
  },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.lg },
  pickRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.subtle,
  },
});
