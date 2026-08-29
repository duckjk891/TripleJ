// [AlbumCreateModal] v3.96(파리티 Wave 6, A-2): 앨범 생성 모달 — MAIDOL AlbumCreateModal.jsx 이식(RN).
// 서버 계약(albums.py POST /albums/): title 필수, track_ids(JSON) 1개 이상 + "본인이 업로드한 트랙만",
//   cover_source=auto면 첫 곡 커버 자동 차용. 커버 업로드/AI 생성은 생성 후 앨범 상세 '관리 > 커버 변경'에서.
// 순서는 선택 순서 + 위/아래 버튼(드래그 라이브러리 신규 도입 금지 — dnd-kit 대체).
import { useState, useEffect } from 'react';
import {
  View, Modal, ScrollView, TouchableOpacity, TextInput, Switch,
  ActivityIndicator, StyleSheet,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { showAlert } from '../utils/appAlert';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { AppText, Button } from './ui';
import { Album, createAlbum, getMyTracksForAlbum } from '../services/albumService';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** 생성 성공 시(서버가 반환한 앨범 전달) — 목록 갱신/상세 이동은 호출부 책임 */
  onCreated: (album: Album) => void;
}

export default function AlbumCreateModal({ visible, onClose, onCreated }: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [myTracks, setMyTracks] = useState<any[]>([]);
  const [tracksLoading, setTracksLoading] = useState(false);
  const [orderedIds, setOrderedIds] = useState<string[]>([]); // 선택 순서 = 앨범 트랙 순서
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    // 열릴 때마다 초기화 + 내 발매 트랙 로드(서버 규칙: 본인 트랙만 담기 가능)
    setTitle(''); setDescription(''); setIsPublic(true); setOrderedIds([]);
    if (__DEV__) console.info('[AlbumCreateModal] open');
    setTracksLoading(true);
    getMyTracksForAlbum(100)
      .then(setMyTracks)
      .catch((err: any) => {
        console.error('[AlbumCreateModal] 내 트랙 조회 실패', { status: err?.response?.status });
        setMyTracks([]);
      })
      .finally(() => setTracksLoading(false));
  }, [visible]);

  const toggleTrack = (trackId: string) => {
    setOrderedIds((prev) =>
      prev.includes(trackId) ? prev.filter((id) => id !== trackId) : [...prev, trackId]
    );
  };

  const moveTrack = (index: number, dir: -1 | 1) => {
    setOrderedIds((prev) => {
      const next = index + dir;
      if (next < 0 || next >= prev.length) return prev;
      const arr = [...prev];
      [arr[index], arr[next]] = [arr[next], arr[index]];
      return arr;
    });
  };

  const trackTitle = (id: string) =>
    myTracks.find((t) => String(t.id) === id)?.title || '(제목 없음)';

  const canSubmit = title.trim().length > 0 && orderedIds.length >= 1 && !saving;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      console.info('[AlbumCreateModal] 생성 요청', { trackCount: orderedIds.length, isPublic });
      const created = await createAlbum({
        title, description, isPublic,
        trackIds: orderedIds,
        coverSource: 'auto', // 첫 곡 커버 자동 — 업로드/AI는 상세 '커버 변경'에서
      });
      console.info('[AlbumCreateModal] 생성 완료', { albumId: created.id });
      onCreated(created);
      onClose();
    } catch (err: any) {
      console.error('[AlbumCreateModal] 생성 실패', { status: err?.response?.status });
      showAlert('오류', err?.response?.data?.error || '앨범 생성에 실패했어요.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.headRow}>
            <AppText variant="subtitle">새 앨범 만들기</AppText>
            <TouchableOpacity onPress={onClose} accessibilityLabel="닫기" style={styles.closeBtn}>
              <Feather name="x" size={20} color={colors.text.muted} />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ flexGrow: 0 }} keyboardShouldPersistTaps="handled">
            <AppText variant="caption" tone="secondary">제목 (필수)</AppText>
            <TextInput
              style={styles.input} value={title} onChangeText={setTitle}
              placeholder="앨범 제목" placeholderTextColor={colors.text.muted} maxLength={200}
            />
            <AppText variant="caption" tone="secondary" style={{ marginTop: spacing.sm }}>설명</AppText>
            <TextInput
              style={[styles.input, styles.inputMulti]} value={description} onChangeText={setDescription}
              placeholder="앨범 설명 (선택)" placeholderTextColor={colors.text.muted} multiline
            />
            <View style={styles.switchRow}>
              <AppText variant="callout">공개 앨범으로 게시</AppText>
              <Switch
                value={isPublic} onValueChange={setIsPublic}
                trackColor={{ false: colors.bg.surface2, true: colors.accent.primary }}
                thumbColor="#fff"
              />
            </View>

            {/* 트랙 선택 — 내 발매 트랙만(서버 규칙) */}
            <AppText variant="caption" tone="secondary" style={{ marginTop: spacing.md }}>
              트랙 선택 ({orderedIds.length}곡 선택됨 · 1곡 이상 필수)
            </AppText>
            {tracksLoading ? (
              <ActivityIndicator size="small" color={colors.accent.primary} style={{ marginVertical: spacing.lg }} />
            ) : myTracks.length === 0 ? (
              <AppText variant="footnote" tone="muted" style={{ marginVertical: spacing.md }}>
                담을 수 있는 곡이 없어요. 작업실에서 곡을 먼저 만들어보세요.
              </AppText>
            ) : (
              <ScrollView style={styles.pickBox} nestedScrollEnabled>
                {myTracks.map((t) => {
                  const id = String(t.id);
                  const checked = orderedIds.includes(id);
                  return (
                    <TouchableOpacity key={id} style={styles.pickRow} onPress={() => toggleTrack(id)}
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

            {/* 트랙 순서 — 위/아래 버튼 */}
            {orderedIds.length > 0 ? (
              <>
                <AppText variant="caption" tone="secondary" style={{ marginTop: spacing.md }}>
                  트랙 순서
                </AppText>
                {orderedIds.map((id, i) => (
                  <View key={id} style={styles.orderRow}>
                    <AppText variant="caption" tone="muted" style={styles.orderIndex}>{i + 1}</AppText>
                    <AppText variant="callout" numberOfLines={1} style={{ flex: 1 }}>{trackTitle(id)}</AppText>
                    <TouchableOpacity style={styles.orderBtn} disabled={i === 0}
                      onPress={() => moveTrack(i, -1)} accessibilityLabel="위로 이동">
                      <Feather name="arrow-up" size={14} color={i === 0 ? colors.text.muted : colors.text.secondary} />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.orderBtn} disabled={i === orderedIds.length - 1}
                      onPress={() => moveTrack(i, 1)} accessibilityLabel="아래로 이동">
                      <Feather name="arrow-down" size={14}
                        color={i === orderedIds.length - 1 ? colors.text.muted : colors.text.secondary} />
                    </TouchableOpacity>
                  </View>
                ))}
              </>
            ) : null}

            <AppText variant="caption" tone="muted" style={{ marginTop: spacing.md }}>
              커버는 첫 곡 커버가 자동 적용돼요. 생성 후 앨범 관리에서 업로드하거나 AI로 만들 수 있어요.
            </AppText>
          </ScrollView>

          <View style={styles.actions}>
            <Button label="취소" size="sm" variant="tonal" onPress={onClose} />
            <Button label={saving ? '생성 중...' : '앨범 생성'} size="sm" loading={saving}
              disabled={!canSubmit} onPress={handleSubmit} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', paddingHorizontal: spacing.xl },
  card: {
    backgroundColor: colors.bg.surface1, borderRadius: radius.xl, padding: spacing.xl,
    borderWidth: 1, borderColor: colors.border.subtle, maxHeight: '85%',
  },
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  closeBtn: { width: 32, height: 32, justifyContent: 'center', alignItems: 'center' },
  input: {
    backgroundColor: colors.bg.deepest, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border.subtle,
    color: colors.text.primary, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    fontSize: 14, marginTop: spacing.xs,
  },
  inputMulti: { minHeight: 64, textAlignVertical: 'top' },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.md },
  pickBox: {
    borderWidth: 1, borderColor: colors.border.subtle, borderRadius: radius.md,
    marginTop: spacing.xs, maxHeight: 180, overflow: 'hidden',
  },
  pickRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.subtle,
  },
  orderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  orderIndex: { width: 18, textAlign: 'center' },
  orderBtn: {
    width: 28, height: 24, borderRadius: radius.sm, backgroundColor: colors.bg.surface2,
    justifyContent: 'center', alignItems: 'center',
  },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.lg },
});
