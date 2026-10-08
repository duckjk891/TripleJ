// [Notifications] 인앱 알림함 — v192 백엔드(/api/notifications) 연동.
// 팔로우/댓글/답글/좋아요/피드 업로드 알림 목록, 진입 시 read-all, 탭하면 관련 화면 이동.
import { useState, useCallback } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { View, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import api from '../services/api';
import PushBanner from '../components/PushBanner';
import { AppText, Avatar, EmptyState } from '../components/ui';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';

interface Notification {
  id: string;
  type: 'follow' | 'comment' | 'reply' | 'like' | 'feed' | 'star' | 'club_promo' | 'club_album';
  actor_id: string;
  actor_nickname?: string;
  target_id?: string | null;
  target_type?: string | null; // v3.177: 'track' 이면 곡 관련 알림(→플레이어), null=피드
  preview?: string | null;
  amount?: number; // star: 관리자 지급/차감 수량 (target_type 'star_grant' | 'star_deduct')
  read: boolean;
  created_at?: string;
}

const TYPE_META: Record<string, { icon: any; label: (n: Notification) => string }> = {
  follow: { icon: 'user-plus', label: (n) => `${n.actor_nickname}님이 나를 팔로우했어요` },
  // v3.177: target_type='track' 이면 곡 댓글, 아니면 기존 피드 댓글
  comment: { icon: 'message-circle', label: (n) => `${n.actor_nickname}님이 내 ${n.target_type === 'track' ? '곡' : '피드'}에 댓글을 남겼어요` },
  reply: { icon: 'corner-down-right', label: (n) => `${n.actor_nickname}님이 내 댓글에 답글을 남겼어요` },
  like: { icon: 'heart', label: (n) => `${n.actor_nickname}님이 내 피드를 좋아해요` },
  feed: { icon: 'edit-3', label: (n) => `${n.actor_nickname}님이 새 피드를 올렸어요` },
  // 관리자 스타 지급/차감 — 관리자 웹 '별 관리'에서 발송. preview = 운영자가 적은 메시지(선택)
  star: {
    icon: 'star',
    label: (n) => (n.target_type === 'star_deduct'
      ? `스타 ${(n.amount ?? 0).toLocaleString()}개가 차감되었어요`
      : `스타 ${(n.amount ?? 0).toLocaleString()}개를 받았어요`),
  },
  // v3.305 [ClubAlbum] 크루 앨범 참여곡 제출(→크루장)·수록/미수록(→멤버) — 상세는 preview 줄
  club_album: { icon: 'disc', label: (n) => `크루 앨범 소식 · ${n.actor_nickname ?? ''}님` },
};

const parseUtc = (iso: string) => new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + 'Z');
const fmtTime = (iso?: string): string => {
  if (!iso) return '';
  const diff = (Date.now() - parseUtc(iso).getTime()) / 1000;
  if (diff < 60) return '방금 전';
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  return `${Math.floor(diff / 86400)}일 전`;
};

export default function NotificationsScreen() {
  const navigation = useNavigation<any>();
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // v3.56: 팔로우 알림 인라인 맞팔 — actor별 팔로우 상태(undefined=조회 중)와 요청 중 표시
  const [following, setFollowing] = useState<Record<string, boolean>>({});
  const [followBusy, setFollowBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (__DEV__) console.info('[Notifications] 목록 조회');
    try {
      const res = await api.get('/notifications/', { params: { limit: 50 } });
      const list: Notification[] = res.data?.notifications || [];
      setItems(list);
      // 진입 시 전체 읽음 처리(뱃지 해소)
      if ((res.data?.unread ?? 0) > 0) api.post('/notifications/read-all').catch(() => {});
      // v3.56: follow 알림의 고유 actor들 팔로우 상태 일괄 조회 → 맞팔 버튼 표시용
      const actorIds = [...new Set(list.filter((n) => n.type === 'follow' && n.actor_id).map((n) => n.actor_id))];
      if (actorIds.length) {
        if (__DEV__) console.info('[Notifications] 맞팔 상태 조회', { actors: actorIds.length });
        const results = await Promise.allSettled(actorIds.map((id) => api.get(`/follows/summary/${id}`)));
        const next: Record<string, boolean> = {};
        results.forEach((r, i) => {
          if (r.status === 'fulfilled') next[actorIds[i]] = !!r.value.data?.is_following;
        });
        setFollowing((prev) => ({ ...prev, ...next }));
      }
    } catch (err: any) {
      console.error('[Notifications] 조회 실패', { status: err?.response?.status });
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, []);

  // 맞팔하기 — 팔로우는 승인 절차가 없어 1탭으로 완결(낙관적 갱신, 실패 시 롤백)
  const followBack = async (actorId: string) => {
    if (followBusy === actorId || following[actorId]) return;
    setFollowBusy(actorId);
    setFollowing((prev) => ({ ...prev, [actorId]: true }));
    if (__DEV__) console.info('[Notifications] 맞팔하기', { actorId });
    try {
      await api.post(`/follows/${actorId}`);
    } catch (err: any) {
      const status = err?.response?.status;
      // 이미 팔로우 중(중복) 응답은 성공으로 간주, 그 외엔 롤백
      if (status !== 400 && status !== 409) {
        setFollowing((prev) => ({ ...prev, [actorId]: false }));
        console.error('[Notifications] 맞팔 실패', { actorId, status });
      }
    } finally {
      setFollowBusy(null);
    }
  };

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const open = (n: Notification) => {
    if (n.type === 'follow') {
      navigation.navigate('UserChannel', { authorId: n.actor_id, name: n.actor_nickname });
    } else if (n.type === 'star') {
      navigation.navigate('StarHistory');
    } else if ((n.target_type === 'club_promo' || n.target_type === 'club_album') && n.target_id) {
      // v3.261→v3.274 [39]②: ClubHome 은 MainTabs 숨김 탭 — RN7 은 중첩 네비게이션이 기본 꺼져 있어
      // 최상위 'ClubHome' 직접 navigate 가 조용히 무시됐다(알림 탭 무반응). 탭 경유로 명시.
      if (__DEV__) console.info('[Notifications] open club', { clubId: n.target_id, kind: n.target_type });
      navigation.navigate('MainTabs', { screen: 'ClubHome', params: { clubId: n.target_id, ...(n.target_type === 'club_album' ? { initialTab: 'playlists' } : {}) } });
    } else if (n.target_type === 'track' && n.target_id) {
      // v3.177→v3.274 [39]③: 곡 댓글 알림 — 플레이어만 열리고 댓글이 안 보이던 결함.
      // openComments 파라미터로 플레이어가 댓글 탭을 바로 연다.
      if (__DEV__) console.info('[Notifications] open track', { trackId: n.target_id });
      navigation.navigate('Player', { track: { id: n.target_id }, openComments: true });
    } else if (n.target_id) {
      // v3.274 [39]①: 피드 댓글·답글·좋아요·새 피드 알림 → 해당 피드 상세(종전: 피드 탭 목록
      // — 피드 탭에서 열면 "전환 안 됨"으로 보였다). 서버가 target_id 에 피드 id 를 담아 보낸다.
      if (__DEV__) console.info('[Notifications] open feed', { feedId: n.target_id });
      navigation.navigate('FeedDetail', { feedId: n.target_id });
    } else {
      navigation.navigate('MainTabs', { screen: 'Feed' }); // id 없는 일반 알림 → 피드 탭
    }
  };

  const renderItem = ({ item }: { item: Notification }) => {
    const meta = TYPE_META[item.type] || TYPE_META.feed;
    const isFollow = item.type === 'follow' && !!item.actor_id;
    const followed = following[item.actor_id];
    return (
      <TouchableOpacity style={[styles.row, !item.read && styles.rowUnread]} onPress={() => open(item)} activeOpacity={0.7}>
        <View style={styles.iconWrap}>
          <Feather name={meta.icon} size={16} color={colors.accent.primary} />
        </View>
        <View style={{ flex: 1, marginLeft: spacing.md }}>
          <AppText variant="footnote">{meta.label(item)}</AppText>
          {item.preview ? <AppText variant="caption" tone="muted" numberOfLines={1}>{item.preview}</AppText> : null}
        </View>
        {isFollow ? (
          // v3.56: 인라인 맞팔 버튼 — 행 탭(채널 이동)과 분리
          <TouchableOpacity
            style={[styles.followBtn, followed && styles.followBtnDone]}
            disabled={!!followed || followBusy === item.actor_id}
            onPress={(e) => { e.stopPropagation?.(); followBack(item.actor_id); }}
            accessibilityLabel={followed ? '팔로잉' : '맞팔하기'}
          >
            <AppText variant="caption" style={{ color: followed ? colors.text.muted : '#fff', fontWeight: '700' }}>
              {followBusy === item.actor_id ? '...' : followed ? '팔로잉 ✓' : '맞팔하기'}
            </AppText>
          </TouchableOpacity>
        ) : (
          <AppText variant="caption" tone="muted">{fmtTime(item.created_at)}</AppText>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* v3.71: 타이틀·뒤로가기는 네이티브 헤더(App.tsx stackHeader)로 이동 — 본문 헤더 제거 */}
      {/* v3.298 [WebPush] 푸시 켜기 배너(웹·미구독일 때만) */}
      <PushBanner />
      {loading ? (
        <ActivityIndicator size="large" color={colors.accent.primary} style={{ marginTop: 60 }} />
      ) : items.length === 0 ? (
        <EmptyState title="아직 알림이 없어요" hint="팔로우·댓글·좋아요 소식이 여기에 표시됩니다" />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(n) => n.id}
          renderItem={renderItem}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accent.primary} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.deepest },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.subtle,
  },
  rowUnread: { backgroundColor: colors.bg.surface1 },
  iconWrap: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: colors.bg.surface2,
    justifyContent: 'center', alignItems: 'center',
  },
  // v3.56: 맞팔 버튼 — 미팔로우는 액센트 채움, 팔로우 완료는 무채 아웃라인
  followBtn: {
    paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: 14,
    backgroundColor: colors.accent.primary, marginLeft: spacing.sm,
  },
  followBtnDone: {
    backgroundColor: 'transparent',
    borderWidth: 1, borderColor: colors.border.subtle,
  },
});
