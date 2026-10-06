// v3.294 [Block] 차단한 사용자 — 설정에서 진입. 목록·차단 해제(서버 /api/dm/blocks).
// 차단 = 서로 메시지 불가 + 그 사람의 글·댓글(피드·크루 게시판) 숨김.
import { useCallback, useState } from 'react';
import { View, FlatList, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { AppText, Avatar, EmptyState } from '../components/ui';
import { BACKEND_BASE_URL } from '../services/api';
import { listBlockedUsers, unblockUser, BlockedUser } from '../services/blockService';
import { showAlert } from '../utils/appAlert';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';

const profileUri = (img?: string | null) =>
  img ? `${BACKEND_BASE_URL}/api/auth/profile-image/${img}` : null;

export default function BlockedUsersScreen() {
  const [items, setItems] = useState<BlockedUser[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setFailed(false);
      setItems(await listBlockedUsers());
    } catch {
      setFailed(true);
      setItems([]);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const confirmUnblock = (u: BlockedUser) => {
    const nick = u.nickname || '이 사용자';
    showAlert('차단 해제', `${nick}님의 차단을 해제할까요?\n다시 메시지를 주고받을 수 있고, 글과 댓글도 보여요.`, [
      { text: '취소', style: 'cancel' },
      { text: '해제', onPress: async () => {
        setBusyId(u.id);
        try {
          await unblockUser(u.id);
          setItems((prev) => (prev || []).filter((x) => x.id !== u.id));
        } catch {
          showAlert('오류', '차단을 해제하지 못했어요. 잠시 후 다시 시도해주세요.');
        } finally {
          setBusyId(null);
        }
      } },
    ]);
  };

  if (items === null) {
    return <View style={styles.center}><ActivityIndicator color={colors.accent.primary} /></View>;
  }
  return (
    <View style={styles.container}>
      <FlatList
        data={items}
        keyExtractor={(u) => u.id}
        contentContainerStyle={items.length === 0 ? { flexGrow: 1 } : { paddingVertical: spacing.sm }}
        ListHeaderComponent={items.length > 0 ? (
          <AppText variant="caption" tone="muted" style={styles.hint}>
            차단한 사람과는 메시지를 주고받을 수 없고, 그 사람의 글과 댓글이 보이지 않아요.
          </AppText>
        ) : null}
        ListEmptyComponent={
          <EmptyState
            title={failed ? '목록을 불러오지 못했어요' : '차단한 사용자가 없어요'}
            hint={failed ? '잠시 후 다시 시도해주세요' : '글이나 메시지의 ⋯ 메뉴에서 차단할 수 있어요'}
          />
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Avatar name={item.nickname || '?'} uri={profileUri(item.profile_image)} size={40} seed={item.id} />
            <View style={{ flex: 1 }}>
              <AppText variant="body" numberOfLines={1}>{item.nickname || '알 수 없는 사용자'}</AppText>
              {item.code ? <AppText variant="caption" tone="muted">#{item.code}</AppText> : null}
            </View>
            <TouchableOpacity
              style={[styles.unblockBtn, busyId === item.id && { opacity: 0.5 }]}
              disabled={busyId === item.id}
              onPress={() => confirmUnblock(item)}
              accessibilityLabel={`${item.nickname || '사용자'} 차단 해제`}
            >
              <AppText variant="footnote" tone="accent">해제</AppText>
            </TouchableOpacity>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.deepest },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg.deepest },
  hint: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.subtle,
  },
  unblockBtn: {
    paddingHorizontal: spacing.md, paddingVertical: 6,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.accent.primary,
  },
});
