// [ClubAlbumCreateModal] v3.305 크루장 — 크루 플레이리스트로 테마 앨범 만들기(제목·테마·대표곡 필수).
// 플레이리스트 곡이 그대로 앨범 곡이 된다(비공개곡 제외). 대표곡 = 링크로 온 비회원이 들을 수 있는 유일한 곡.
import { useEffect, useState } from 'react';
import { View, TouchableOpacity, StyleSheet, Modal, TextInput, ScrollView, KeyboardAvoidingView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { spacing, radius } from '../../theme/spacing';
import { AppText, Button } from '../ui';
import { showAlert } from '../../utils/appAlert';
import { createClubAlbum, clubAlbumErrorMessage, type ClubAlbum } from '../../services/clubAlbumService';

interface Props {
  visible: boolean;
  clubId: string;
  playlist: { id: string; title?: string; name?: string } | null;
  tracks: any[];
  onClose: () => void;
  onCreated: (album: ClubAlbum) => void;
}

const TITLE_MAX = 40;
const THEME_MAX = 200;

export default function ClubAlbumCreateModal({ visible, clubId, playlist, tracks, onClose, onCreated }: Props) {
  const [title, setTitle] = useState('');
  const [theme, setTheme] = useState('');
  const [rep, setRep] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const usable = tracks.filter((t) => t && t.is_public !== false);

  useEffect(() => {
    if (!visible) return;
    setTitle(playlist?.title || playlist?.name || '');
    setTheme('');
    setRep(usable[0] ? String(usable[0].id || usable[0].track_id) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, playlist?.id]);

  const create = async () => {
    if (busy || !playlist) return;
    if (!title.trim()) { showAlert('알림', '앨범 이름을 입력해 주세요.'); return; }
    if (!rep) { showAlert('알림', '대표곡을 골라 주세요.'); return; }
    setBusy(true);
    try {
      const album = await createClubAlbum(clubId, { playlistId: String(playlist.id), title: title.trim(), theme: theme.trim(), representativeTrackId: rep });
      console.info('[ClubAlbum] 생성 완료', { clubId, albumId: album.id });
      onCreated(album);
    } catch (err: any) {
      showAlert('알림', clubAlbumErrorMessage(err, '앨범을 만들지 못했어요. 잠시 후 다시 시도해 주세요.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" pointerEvents="box-none">
        <View style={styles.backdrop}>
          <TouchableOpacity style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.6)' }]} activeOpacity={1} onPress={onClose} accessibilityLabel="앨범 만들기 닫기" />
          <View style={styles.card}>
            <AppText variant="title3">크루 앨범 만들기</AppText>
            <AppText variant="caption" tone="secondary">
              {`「${playlist?.title || playlist?.name || '플레이리스트'}」의 곡으로 앨범을 만들어요. 멤버들이 테마에 맞춰 새 곡을 내면 참여 미션 ⭐5를 받아요.`}
            </AppText>
            <TextInput style={styles.input} value={title} onChangeText={(v) => setTitle(v.slice(0, TITLE_MAX))}
              placeholder="앨범 이름 (예: 비 올 때 듣기 좋은 힙합)" placeholderTextColor={colors.text.muted} editable={!busy} />
            <TextInput style={[styles.input, { minHeight: 64 }]} value={theme} onChangeText={(v) => setTheme(v.slice(0, THEME_MAX))} multiline
              placeholder="테마 설명 (멤버들이 어떤 곡을 만들면 좋을지)" placeholderTextColor={colors.text.muted} editable={!busy} />
            <AppText variant="callout" style={{ marginTop: spacing.xs }}>대표곡 고르기</AppText>
            <AppText variant="caption" tone="muted">링크로 들어온 비회원은 대표곡만 들을 수 있어요.</AppText>
            <ScrollView style={{ maxHeight: 220 }}>
              {usable.length === 0 ? (
                <AppText variant="footnote" tone="secondary" style={{ marginVertical: spacing.md }}>공개된 곡이 있어야 앨범을 만들 수 있어요.</AppText>
              ) : usable.map((t) => {
                const id = String(t.id || t.track_id);
                const on = rep === id;
                return (
                  <TouchableOpacity key={id} style={[styles.repRow, on && styles.repRowOn]} onPress={() => setRep(id)} accessibilityLabel={`대표곡 ${t.title}`}>
                    <Feather name={on ? 'check-circle' : 'circle'} size={16} color={on ? colors.accent.primary : colors.text.muted} />
                    <View style={{ flex: 1 }}>
                      <AppText variant="footnote" numberOfLines={1}>{t.title || '제목 없음'}</AppText>
                      <AppText variant="caption" tone="muted" numberOfLines={1}>{t.artist_name || t.uploader_nickname || ''}</AppText>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
              <View style={{ flex: 1 }}><Button label="취소" variant="tonal" fullWidth onPress={onClose} /></View>
              <View style={{ flex: 1 }}><Button label="만들기" fullWidth loading={busy} disabled={!usable.length} onPress={create} /></View>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', padding: spacing.lg },
  card: { backgroundColor: colors.bg.surface1, borderRadius: radius.xl, padding: spacing.lg, gap: spacing.sm, maxWidth: 480, width: '100%', alignSelf: 'center' },
  input: {
    borderWidth: 1, borderColor: colors.border.subtle, borderRadius: radius.md, color: colors.text.primary,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: 15,
  },
  repRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm, borderRadius: radius.md },
  repRowOn: { backgroundColor: colors.bg.surface2 },
});
