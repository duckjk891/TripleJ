// [PlaylistPickerSheet] 곡(들)을 플레이리스트에 담는 바텀시트 — 기존 목록 선택 또는 새로 만들어 담기.
// 단일 곡·여러 곡(검색 결과 전체 담기) 모두 지원. trackIds 길이에 따라 문구만 달라진다.
import { useEffect, useState } from 'react';
import { Modal, View, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAndroidKeyboardLift } from '../hooks/useAndroidKeyboardLift';
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
  const insets = useSafeAreaInsets(); // v3.196: Modal은 별도 window라 루트 안전영역 패딩 미상속 → 시트에 직접 보강
  const { height: winH } = useWindowDimensions();
  const [playlists, setPlaylists] = useState<any[]>([]);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  // v3.198→v3.201(A): Android 키보드 수동 리프트 — 로직은 공용 훅 useAndroidKeyboardLift로 추출
  // (show: kbHeight - insets.bottom, hide: 0 리셋, visible 게이트·리스너 쌍 해제 그대로).
  // v3.201(A) 근본 수정: kbPad를 paddingBottom 합산 → 시트 marginBottom(시트 전체 리프트)으로 이동.
  // paddingBottom 합산은 maxHeight 60% 클램프에 걸려(키보드 ~35-40% + 콘텐츠) 시트 높이가 고정되고
  // 맨 아래 자식인 입력행(createRow)이 시트 경계 밖 = 키보드 뒤에 남았다. marginBottom은 콘텐츠
  // 높이를 바꾸지 않아 클램프와 무관하게 입력행이 항상 키보드 위. hide 시 0 리셋 → 잔존 간격
  // 구조적 불가(v3.198 보장) 유지. iOS는 KAV padding 경로 무변경(kbPad 항상 0).
  const kbPad = useAndroidKeyboardLift(visible);
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
      {/* v3.196→v3.198: KAV는 iOS 전용으로 복귀 — Android는 위 keyboardDidShow/Hide 수동 패딩(kbPad)이 담당
          (Android KAV padding이 키보드 닫힘 후 잔존 간격을 남기는 문제 해소, 키보드 가림 해소 목적은 유지) */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} pointerEvents="box-none">
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose}>
        {/* v3.196: Modal은 루트 인셋 미상속 → 하단 제스처 바만큼 paddingBottom 보강(v3.191 queueSheet 패턴)
            v3.201(A): kbPad는 marginBottom(시트 전체 리프트)로 — paddingBottom 합산은 maxHeight 클램프에
            걸려 입력행이 키보드 뒤에 남는다(§1). 키보드 열림 중에는 maxHeight를 남는 화면(winH - 키보드)
            안으로 동적 클램프해 '키보드 + 시트 60%'가 화면 상한을 넘는 극단도 방지. */}
        <TouchableOpacity
          style={[
            styles.sheet,
            { paddingBottom: insets.bottom + spacing.xl, marginBottom: kbPad },
            kbPad > 0 && { maxHeight: Math.min(winH * 0.6, winH - (kbPad + insets.bottom) - 24) },
          ]}
          activeOpacity={1}
          onPress={() => {}}
        >
          <AppText variant="title3" style={styles.title}>
            {many ? `${trackIds.length}곡을 플레이리스트에 담기` : '플레이리스트에 담기'}
          </AppText>
          {busy ? <ActivityIndicator color={colors.accent.primary} style={{ marginBottom: spacing.lg }} /> : null}
          {playlists.length > 0 && (
            /* v3.201(A): 목록 ScrollView 전환 — 비스크롤 View는 목록이 길면 맨 아래 입력행을
               시트 밖으로 밀어내는 잠재 결함(키보드와 무관)이 있었다. maxHeight로 입력행 상시 노출 보장. */
            <ScrollView style={[styles.list, { maxHeight: 240 }]} keyboardShouldPersistTaps="handled">
              {playlists.map((pl: any) => (
                <TouchableOpacity key={pl.id} style={styles.item} disabled={busy} onPress={() => handlePick(pl.id)}>
                  <AppText variant="body">{pl.title || pl.name}</AppText>
                  <AppText variant="caption" tone="muted">{pl.track_count ?? 0}곡</AppText>
                </TouchableOpacity>
              ))}
            </ScrollView>
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
    
      </KeyboardAvoidingView></Modal>
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
