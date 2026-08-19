// [FeedCard] 인스타/페북식 피드 카드 — MAIDOL FeedPostCard 이식(RN).
// 헤더(아바타·이름·시간·⋯메뉴) / 제목·본문 블록 / 액션바(♥ 좋아요 토글 · 💬 댓글 · 공유) / 인라인 댓글.
// 댓글: 목록·작성·삭제 + '답글'(@멘션 프리필 — 백엔드 parent_id 미지원이라 인스타식 멘션 관례로 표현,
//        @멘션으로 시작하는 댓글은 들여쓰기 렌더).
import { useState } from 'react';
import { View, TouchableOpacity, TextInput, Alert, ActivityIndicator, Share, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import api, { BACKEND_BASE_URL } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import { AppText, Avatar } from '../ui';
import ReportModal from '../ReportModal';
import { colors } from '../../theme/colors';
import { spacing, radius } from '../../theme/spacing';

export interface FeedComment {
  id: string;
  author_id: string;
  author_nickname: string;
  text: string;
  created_at?: string;
}

interface Props {
  feed: any;                       // timeline 응답 항목 (is_liked/like_count/comment_count 포함)
  onPressAuthor?: () => void;
  onDeleted?: () => void;          // 내 피드 삭제 후 목록 갱신
  renderBlocks: () => any;         // 본문 블록(텍스트/트랙) 렌더는 화면쪽 기존 로직 재사용
  requireLogin: () => boolean;     // 비로그인 시 CTA 처리(true=로그인됨)
}

// 서버 created_at은 타임존 표기 없는 UTC — 'Z'를 붙여 파싱(KST 9시간 오차 방지)
const parseUtc = (iso: string) => new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + 'Z');

const fmtTime = (iso?: string): string => {
  if (!iso) return '';
  const d = parseUtc(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return '방금 전';
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}일 전`;
  return d.toLocaleDateString('ko-KR');
};

export default function FeedCard({ feed, onPressAuthor, onDeleted, renderBlocks, requireLogin }: Props) {
  const user = useAuthStore((s) => s.user);
  const isMine = !!user && String(feed.author_id) === String(user.id);

  const [liked, setLiked] = useState(!!feed.is_liked);
  const [likeCount, setLikeCount] = useState(feed.like_count ?? 0);
  const [commentCount, setCommentCount] = useState(feed.comment_count ?? 0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  // 댓글
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState<FeedComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [posting, setPosting] = useState(false);
  const [commentReport, setCommentReport] = useState<string | null>(null); // 신고 대상 댓글 id

  const toggleLike = async () => {
    if (!requireLogin()) return;
    const next = !liked;
    setLiked(next); setLikeCount((c: number) => Math.max(0, c + (next ? 1 : -1))); // 낙관적
    if (__DEV__) console.info('[FeedCard] like 토글', { feedId: feed.id, next });
    try {
      if (next) await api.post(`/feeds/${feed.id}/like`);
      else await api.delete(`/feeds/${feed.id}/like`);
    } catch (err: any) {
      setLiked(!next); setLikeCount((c: number) => Math.max(0, c + (next ? -1 : 1))); // 롤백
      console.error('[FeedCard] like 실패', { feedId: feed.id, status: err?.response?.status });
    }
  };

  const loadComments = async () => {
    setCommentsLoading(true);
    if (__DEV__) console.info('[FeedCard] 댓글 조회', { feedId: feed.id });
    try {
      const res = await api.get(`/feeds/${feed.id}/comments`, { params: { page: 1, limit: 100 } });
      setComments(res.data?.comments || []);
    } catch (err: any) {
      console.error('[FeedCard] 댓글 조회 실패', { feedId: feed.id, status: err?.response?.status });
    } finally {
      setCommentsLoading(false);
    }
  };

  const openComments = () => {
    const next = !commentsOpen;
    setCommentsOpen(next);
    if (next && !comments.length) loadComments();
  };

  const submitComment = async () => {
    if (!requireLogin()) return;
    const text = commentText.trim();
    if (!text || posting) return;
    setPosting(true);
    if (__DEV__) console.info('[FeedCard] 댓글 등록', { feedId: feed.id, len: text.length });
    try {
      const res = await api.post(`/feeds/${feed.id}/comments`, { text });
      const c = res.data?.comment;
      if (c) setComments((prev) => [...prev, c]);
      setCommentCount((n: number) => n + 1);
      setCommentText('');
    } catch (err: any) {
      console.error('[FeedCard] 댓글 등록 실패', { feedId: feed.id, status: err?.response?.status });
      Alert.alert('오류', '댓글 등록에 실패했습니다.');
    } finally {
      setPosting(false);
    }
  };

  const deleteComment = (commentId: string) => {
    Alert.alert('댓글 삭제', '댓글을 삭제할까요?', [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: async () => {
        try {
          await api.delete(`/feeds/comments/${commentId}`);
          setComments((prev) => prev.filter((c) => c.id !== commentId));
          setCommentCount((n: number) => Math.max(0, n - 1));
        } catch (err: any) {
          console.error('[FeedCard] 댓글 삭제 실패', { commentId, status: err?.response?.status });
          Alert.alert('오류', '댓글 삭제에 실패했습니다.');
        }
      } },
    ]);
  };

  // 답글 — 백엔드가 parent_id를 지원하지 않아 인스타식 @멘션 관례로 표현
  const replyTo = (nickname: string) => {
    if (!requireLogin()) return;
    setCommentText((t) => (t.startsWith(`@${nickname} `) ? t : `@${nickname} ${t}`));
  };

  const deleteFeed = () => {
    Alert.alert('피드 삭제', '이 피드를 삭제할까요?', [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: async () => {
        try {
          await api.delete(`/feeds/${feed.id}`);
          onDeleted?.();
        } catch (err: any) {
          console.error('[FeedCard] 피드 삭제 실패', { feedId: feed.id, status: err?.response?.status });
          Alert.alert('오류', '삭제에 실패했습니다.');
        }
      } },
    ]);
  };

  const shareFeed = async () => {
    try {
      await Share.share({ message: `AIDOL 피드 "${feed.title || '게시물'}"\n${BACKEND_BASE_URL}/feed/${feed.id}` });
    } catch (err: any) {
      console.error('[FeedCard] 공유 실패', { message: err?.message });
    }
  };

  const profileUri = feed.author_profile_image
    ? `${BACKEND_BASE_URL}/api/auth/profile-image/${feed.author_profile_image}`
    : null;

  // @멘션으로 시작하면 답글로 간주해 들여쓰기
  const isReply = (text: string) => /^@\S+\s/.test(text);

  return (
    <View style={styles.card}>
      {/* 헤더 — 아바타 · 이름 · 시간 · ⋯ */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerMain} onPress={onPressAuthor} activeOpacity={0.7}>
          <Avatar name={feed.author_nickname || '?'} uri={profileUri} size={36} />
          <View style={{ marginLeft: spacing.sm, flex: 1 }}>
            <AppText variant="bodyStrong" numberOfLines={1}>{feed.author_nickname || '알 수 없음'}</AppText>
            <AppText variant="caption" tone="muted">{fmtTime(feed.created_at)}</AppText>
          </View>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setMenuOpen((v) => !v)} style={styles.moreBtn} accessibilityLabel="피드 더보기">
          <Feather name="more-horizontal" size={20} color={colors.text.muted} />
        </TouchableOpacity>
      </View>

      {/* ⋯ 메뉴 — 내 피드: 삭제 / 남의 피드: 신고 */}
      {menuOpen ? (
        <View style={styles.menu}>
          {isMine ? (
            <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuOpen(false); deleteFeed(); }}>
              <Feather name="trash-2" size={16} color={colors.status.error} />
              <AppText variant="footnote" style={{ color: colors.status.error }}>삭제</AppText>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuOpen(false); setReportOpen(true); }}>
              <Feather name="flag" size={16} color={colors.text.secondary} />
              <AppText variant="footnote" tone="secondary">신고</AppText>
            </TouchableOpacity>
          )}
        </View>
      ) : null}

      {/* 제목 + 본문 블록 */}
      {feed.title ? <AppText variant="bodyStrong" style={styles.title}>{feed.title}</AppText> : null}
      {renderBlocks()}

      {/* 액션바 — ♥ / 💬 / 공유 */}
      <View style={styles.actionBar}>
        <TouchableOpacity style={styles.action} onPress={toggleLike} accessibilityLabel="좋아요">
          <Feather name="heart" size={20} color={liked ? colors.accent.primary : colors.text.secondary} />
          <AppText variant="footnote" tone={liked ? 'accent' : 'secondary'}>{likeCount}</AppText>
        </TouchableOpacity>
        <TouchableOpacity style={styles.action} onPress={openComments} accessibilityLabel="댓글">
          <Feather name="message-circle" size={20} color={commentsOpen ? colors.accent.primary : colors.text.secondary} />
          <AppText variant="footnote" tone={commentsOpen ? 'accent' : 'secondary'}>{commentCount}</AppText>
        </TouchableOpacity>
        <TouchableOpacity style={styles.action} onPress={shareFeed} accessibilityLabel="피드 공유">
          <Feather name="share-2" size={19} color={colors.text.secondary} />
        </TouchableOpacity>
      </View>

      {/* 인라인 댓글 */}
      {commentsOpen ? (
        <View style={styles.comments}>
          {commentsLoading ? (
            <ActivityIndicator size="small" color={colors.accent.primary} style={{ marginVertical: spacing.md }} />
          ) : comments.length === 0 ? (
            <AppText variant="footnote" tone="muted" style={{ marginVertical: spacing.sm }}>첫 댓글을 남겨보세요.</AppText>
          ) : (
            comments.map((c) => {
              const canDelete = !!user && (String(c.author_id) === String(user.id) || isMine);
              return (
                <View key={c.id} style={[styles.commentRow, isReply(c.text) && styles.commentReply]}>
                  <Avatar name={c.author_nickname || '?'} size={26} />
                  <View style={{ flex: 1, marginLeft: spacing.sm }}>
                    <View style={styles.commentHead}>
                      <AppText variant="caption" tone="primary" style={{ fontWeight: '600' }}>{c.author_nickname}</AppText>
                      <AppText variant="caption" tone="muted"> · {fmtTime(c.created_at)}</AppText>
                    </View>
                    <AppText variant="footnote" tone="secondary">{c.text}</AppText>
                    <View style={styles.commentActions}>
                      <TouchableOpacity onPress={() => replyTo(c.author_nickname)} accessibilityLabel="답글">
                        <AppText variant="caption" tone="muted">답글</AppText>
                      </TouchableOpacity>
                      {!canDelete && user ? (
                        <TouchableOpacity onPress={() => setCommentReport(c.id)} accessibilityLabel="댓글 신고">
                          <AppText variant="caption" tone="muted">신고</AppText>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  </View>
                  {canDelete ? (
                    <TouchableOpacity onPress={() => deleteComment(c.id)} style={{ padding: 4 }} accessibilityLabel="댓글 삭제">
                      <Feather name="x" size={14} color={colors.text.muted} />
                    </TouchableOpacity>
                  ) : null}
                </View>
              );
            })
          )}

          {/* 입력 */}
          {user ? (
            <View style={styles.commentInputRow}>
              <TextInput
                style={styles.commentInput}
                placeholder="댓글을 입력하세요"
                placeholderTextColor={colors.text.muted}
                value={commentText}
                onChangeText={setCommentText}
                maxLength={1000}
                multiline
              />
              <TouchableOpacity onPress={submitComment} disabled={posting || !commentText.trim()} accessibilityLabel="댓글 등록">
                <AppText variant="footnote" tone={commentText.trim() ? 'accent' : 'muted'}>{posting ? '...' : '등록'}</AppText>
              </TouchableOpacity>
            </View>
          ) : (
            <AppText variant="caption" tone="muted" style={{ marginTop: spacing.sm }}>로그인 후 댓글을 남길 수 있습니다.</AppText>
          )}
        </View>
      ) : null}

      {/* 신고 — 피드 / 댓글 */}
      <ReportModal visible={reportOpen} targetType="feed" targetId={String(feed.id)} onClose={() => setReportOpen(false)} />
      <ReportModal visible={!!commentReport} targetType="comment" targetId={String(commentReport || '')} onClose={() => setCommentReport(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bg.surface1, borderRadius: radius.lg,
    padding: spacing.lg, marginHorizontal: spacing.lg, marginBottom: spacing.md,
  },
  header: { flexDirection: 'row', alignItems: 'center' },
  headerMain: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  moreBtn: { padding: 6 },
  menu: {
    alignSelf: 'flex-end', backgroundColor: colors.bg.surface2, borderRadius: radius.md,
    paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, marginTop: 4,
  },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 4 },
  title: { marginTop: spacing.md },
  actionBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xl,
    marginTop: spacing.md, paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border.subtle,
  },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  comments: { marginTop: spacing.md },
  commentRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: spacing.md },
  commentReply: { marginLeft: spacing.xl }, // @멘션 답글 들여쓰기
  commentHead: { flexDirection: 'row', alignItems: 'center' },
  commentActions: { flexDirection: 'row', gap: spacing.md, marginTop: 3 },
  commentInputRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, marginTop: spacing.xs,
    backgroundColor: colors.bg.deepest, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderWidth: 1, borderColor: colors.border.subtle,
  },
  commentInput: { flex: 1, color: colors.text.primary, maxHeight: 90, padding: 0 },
});
