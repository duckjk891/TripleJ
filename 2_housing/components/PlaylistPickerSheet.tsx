// [PlaylistPickerSheet] 곡(들)을 플레이리스트에 담는 바텀시트 — 기존 목록 선택 또는 새로 만들어 담기.
// 단일 곡·여러 곡(검색 결과 전체 담기) 모두 지원. trackIds 길이에 따라 문구만 달라진다.
import { useEffect, useState } from 'react';
import { Modal, View, TouchableOpacity, TextInput, ActivityIndicator, StyleSheet } from 'react-native';
import { showAlert } from '../utils/appAlert';
import api from '../services/api';
import { AppText, Button } from './ui';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';

interface Props {
  visible: boolean;
  trackIds: string[];      // 담을 곡 id 목록(1개 이상)
  onClose: () => void;
}

export default function PlaylistPickerSheet({ visible, trackIds, onClose }: Props) {
  const [playlists, setPlaylists] = useState<any[]>([]);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const many = trackIds.length > 1;

  useEffect(() => {
    if (!visible) return;
    (async () => {
      if (__DEV__) console.info('[PlaylistPickerSheet] 플레이리스트 조회', { count: trackIds.length });
      try {
        const res = await api.get('/playlists/');
        setPlaylists(res.data.playlists || res.data || []);
      } catch (err: any) {
        console.error('[PlaylistPickerSheet] 플레이리스트 조회 실패', { status: err?.response?.status });
        setPlaylists([]);
      }
    })();
  }, [visible]);

  // 여러 곡을 순차 추가 — 이미 담긴 곡(중복 오류)은 건너뛰고 계속 진행
  const addAll = async (playlistId: string): Promise<{ added: number; failed: number }> => {
    let added = 0, failed = 0;
    for (const id of trackIds) {
      try {
        await api.post(`/playlists/${playlistId}/tracks`, { track_id: id });
        added += 1;
      } catch (err: any) {
        failed += 1;
        console.error('[PlaylistPickerSheet] 곡 추가 실패', { playlistId, trackId: id, status: err?.response?.status });
      }
    }
    return { added, failed };
  };

  const handlePick = async (playlistId: string) => {
    setBusy(true);
    const { added, failed } = await addAll(playlistId);
    setBusy(false);
    onClose();
    showAlert(added > 0 ? '완료' : '알림',
      added > 0
        ? (many ? `${added}곡을 담았어요.${failed ? ` (${failed}곡은 이미 있거나 실패)` : ''}` : '플레이리스트에 추가되었습니다!')
        : '담지 못했어요. 이미 담긴 곡일 수 있어요.');
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) { showAlert('알림', '플레이리스트 이름을 입력해주세요.'); return; }
    setBusy(true);
    try {
      const createRes = await api.post('/playlists/', { title: name });
      const { added, failed } = await addAll(createRes.data.id);
      setBusy(false);
      setNewName('');
      onClose();
      showAlert('완료', many
        ? `"${name}"에 ${added}곡을 담았어요.${failed ? ` (${failed}곡 실패)` : ''}`
        : `"${name}"에 추가되었습니다!`);
    } catch (err: any) {
      setBusy(false);
      console.error('[PlaylistPickerSheet] 플레이리스트 생성 실패', { status: err?.response?.status });
      showAlert('오류', err?.response?.data?.error || '생성에 실패했습니다.');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity style={styles.sheet} activeOpacity={1} onPress={() => {}}>
          <AppText variant="title3" style={styles.title}>
            {many ? `${trackIds.length}곡을 플레이리스트에 담기` : '플레이리스트에 담기'}
          </AppText>
          {busy ? <ActivityIndicator color={colors.accent.primary} style={{ marginBottom: spacing.lg }} /> : null}
          {playlists.length > 0 && (
            <View style={styles.list}>
              {playlists.map((pl: any) => (
                <TouchableOpacity key={pl.id} style={styles.item} disabled={busy} onPress={() => handlePick(pl.id)}>
                  <AppText variant="body">{pl.title || pl.name}</AppText>
                  <AppText variant="caption" tone="muted">{pl.track_count ?? 0}곡</AppText>
                </TouchableOpacity>
              ))}
            </View>
          )}
          <AppText variant="footnote" tone="secondary" style={styles.label}>새 플레이리스트 만들기</AppText>
          <View style={styles.createRow}>
            <TextInput
              style={styles.input}
              placeholder="플레이리스트 이름"
              placeholderTextColor={colors.text.muted}
              value={newName}
              onChangeText={setNewName}
            />
            <Button label="만들기" size="md" onPress={handleCreate} />
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.bg.surface1, borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl, padding: spacing.xl, maxHeight: '60%' },
  title: { marginBottom: spacing.lg },
  list: { marginBottom: spacing.lg },
  item: { paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.subtle },
  label: { marginBottom: spacing.sm },
  createRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'stretch' },
  input: {
    flex: 1, backgroundColor: colors.bg.deepest, borderRadius: radius.md, padding: spacing.md,
    color: colors.text.primary, borderWidth: 1, borderColor: colors.border.subtle,
  },
});
