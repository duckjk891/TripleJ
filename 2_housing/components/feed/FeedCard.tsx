// [FeedCard] 인스타/페북식 피드 카드 — MAIDOL FeedPostCard 이식(RN).
// 헤더(아바타·이름·시간·⋯메뉴) / 제목·본문 블록 / 액션바(♥ 좋아요 토글 · 💬 댓글 · 공유) / 인라인 댓글.
// 댓글: 목록·작성·삭제 + 중첩 답글 스레드 (백엔드 v191 parent_id 정식 지원).
//   신규 답글은 parent_id 필드로 저장. 구버전(마커 `[reply:{id}] `) 댓글은 레거시 폴백으로 계속 파싱해
//   동일하게 중첩 렌더(하위호환). 부모가 삭제되면 최상위로 폴백.
import { useState } from 'react';
import { View, TouchableOpacity, TextInput, Alert, ActivityIndicator, Share, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import api, { BACKEND_BASE_URL } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import { AppText, Avatar } from '../ui';
import ReportModal from '../ReportModal';
import { colors } from '../../theme/colors';
import { spacing, radius } from '../../theme/spacing';

// v3.49: 피드 카드 라이트 팔레트 — 어두운 앱 배경 위에 밝은 카드가 나열되는 인스타 무드.
// FeedScreen의 본문 블록 렌더에서도 같은 팔레트를 쓰도록 export.
export const feedCardLight = {
  bg: '#FFFFFF',
  text: '#1B1B22',      // 제목·닉네임
  sub: '#4A4A55',       // 본문·아이콘
  muted: '#8B8B96',     // 시간·보조
  line: '#E8E8EF',      // 구분선·테두리
  field: '#F2F2F7',     // 입력창·칩 배경
};

export interface FeedComment {
  id: string;
  author_id: string;
  author_nickname: string;
  text: string;
  parent_id?: string | null; // v191+ 대댓글 부모
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
  const [isFollowing, setIsFollowing] = useState<boolean | null>(null); // ⋯ 메뉴용(열 때 조회)
  const [followBusy, setFollowBusy] = useState(false);

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
    if (__DEV__) console.info('[FeedCard] 댓글 등록', { feedId: feed.id, len: text.length, reply: !!replyTarget });
    try {
      const res = await api.post(`/feeds/${feed.id}/comments`, {
        text,
        ...(replyTarget ? { parent_id: replyTarget.id } : {}),
      });
      const c = res.data?.comment;
      if (c) setComments((prev) => [...prev, c]);
      setCommentCount((n: number) => n + 1);
      setCommentText('');
      setReplyTarget(null);
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

  // 답글 대상 — 제출 시 [reply:{부모id}] 마커를 붙여 저장(중첩 스레드)
  const [replyTarget, setReplyTarget] = useState<FeedComment | null>(null);
  const replyTo = (c: FeedComment) => {
    if (!requireLogin()) return;
    setReplyTarget(c);
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

  // ⋯ 메뉴 열기 — 남의 피드면 팔로우 상태를 함께 조회
  const openMenu = async () => {
    const next = !menuOpen;
    setMenuOpen(next);
    if (next && !isMine && feed.author_id && isFollowing === null && user) {
      try {
        const res = await api.get(`/follows/summary/${feed.author_id}`);
        setIsFollowing(!!res.data?.is_following);
      } catch (err: any) {
        console.error('[FeedCard] 팔로우 상태 조회 실패', { authorId: feed.author_id, status: err?.response?.status });
      }
    }
  };

  const toggleFollow = async () => {
    if (!requireLogin() || followBusy || !feed.author_id) return;
    const next = !isFollowing;
    setFollowBusy(true);
    if (__DEV__) console.info('[FeedCard] follow 토글', { authorId: feed.author_id, next });
    try {
      if (next) await api.post(`/follows/${feed.author_id}`);
      else await api.delete(`/follows/${feed.author_id}`);
      setIsFollowing(next);
    } catch (err: any) {
      console.error('[FeedCard] follow 실패', { authorId: feed.author_id, status: err?.response?.status });
    } finally {
      setFollowBusy(false);
    }
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

  // 중첩 스레드 구성 — parent_id 필드 우선(v191+), 구버전 마커 [reply:{id}]는 레거시 폴백 파싱
  const REPLY_RE = /^\[reply:([A-Za-z0-9]+)\]\s?/;
  const parseReply = (c: FeedComment) => {
    if (c.parent_id) return { parentId: String(c.parent_id), body: c.text };
    const m = c.text.match(REPLY_RE);
    return { parentId: m ? m[1] : null, body: m ? c.text.slice(m[0].length) : c.text };
  };
  const thread = (() => {
    const roots: { c: FeedComment; body: string; replies: { c: FeedComment; body: string }[] }[] = [];
    const byId: Record<string, number> = {};
    const orphans: { c: FeedComment; body: string; parentId: string }[] = [];
    comments.forEach((c) => {
      const { parentId, body } = parseReply(c);
      if (!parentId) {
        byId[c.id] = roots.length;
        roots.push({ c, body, replies: [] });
      } else if (byId[parentId] !== undefined) {
        roots[byId[parentId]].replies.push({ c, body });
      } else {
        orphans.push({ c, body, parentId });
      }
    });
    // 부모보다 먼저 온/삭제된 답글: 부모가 있으면 붙이고, 없으면 최상위로
    orphans.forEach((o) => {
      if (byId[o.parentId] !== undefined) roots[byId[o.parentId]].replies.push({ c: o.c, body: o.body });
      else { byId[o.c.id] = roots.length; roots.push({ c: o.c, body: o.body, replies: [] }); }
    });
    return roots;
  })();

  return (
    <View style={styles.card}>
      {/* 헤더 — 아바타 · 이름 · 시간 · ⋯ */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerMain} onPress={onPressAuthor} activeOpacity={0.7}>
          <Avatar name={feed.author_nickname || '?'} uri={profileUri} size={36} />
          <View style={{ marginLeft: spacing.sm, flex: 1 }}>
            <AppText variant="bodyStrong" numberOfLines={1} style={{ color: feedCardLight.text }}>{feed.author_nickname || '알 수 없음'}</AppText>
            <AppText variant="caption" style={{ color: feedCardLight.muted }}>{fmtTime(feed.created_at)}</AppText>
          </View>
        </TouchableOpacity>
        <TouchableOpacity onPress={openMenu} style={styles.moreBtn} accessibilityLabel="피드 더보기">
          <Feather name="more-horizontal" size={20} color={feedCardLight.muted} />
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
            <>
              {user && feed.author_id ? (
                <TouchableOpacity style={styles.menuItem} disabled={followBusy || isFollowing === null} onPress={toggleFollow}>
                  <Feather name={isFollowing ? 'user-check' : 'user-plus'} size={16}
                    color={isFollowing ? colors.accent.primary : feedCardLight.sub} />
                  <AppText variant="footnote" style={{ color: isFollowing ? colors.accent.primary : feedCardLight.sub }}>
                    {isFollowing === null ? '확인 중...' : isFollowing ? '팔로우 중' : '팔로우'}
                  </AppText>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuOpen(false); setReportOpen(true); }}>
                <Feather name="flag" size={16} color={feedCardLight.sub} />
                <AppText variant="footnote" style={{ color: feedCardLight.sub }}>신고</AppText>
              </TouchableOpacity>
            </>
          )}
        </View>
      ) : null}

      {/* 제목 + 본문 블록 */}
      {feed.title ? <AppText variant="bodyStrong" style={[styles.title, { color: feedCardLight.text }]}>{feed.title}</AppText> : null}
      {renderBlocks()}

      {/* 액션바 — ♥ / 💬 / 공유 */}
      <View style={styles.actionBar}>
        <TouchableOpacity style={styles.action} onPress={toggleLike} accessibilityLabel="좋아요">
          <Feather name="heart" size={20} color={liked ? colors.accent.primary : feedCardLight.sub} />
          <AppText variant="footnote" style={{ color: liked ? colors.accent.primary : feedCardLight.sub }}>{likeCount}</AppText>
        </TouchableOpacity>
        <TouchableOpacity style={styles.action} onPress={openComments} accessibilityLabel="댓글">
          <Feather name="message-circle" size={20} color={commentsOpen ? colors.accent.primary : feedCardLight.sub} />
          <AppText variant="footnote" style={{ color: commentsOpen ? colors.accent.primary : feedCardLight.sub }}>{commentCount}</AppText>
        </TouchableOpacity>
        <TouchableOpacity style={styles.action} onPress={shareFeed} accessibilityLabel="피드 공유">
          <Feather name="share-2" size={19} color={feedCardLight.sub} />
        </TouchableOpacity>
      </View>

      {/* 인라인 댓글 */}
      {commentsOpen ? (
        <View style={styles.comments}>
          {commentsLoading ? (
            <ActivityIndicator size="small" color={colors.accent.primary} style={{ marginVertical: spacing.md }} />
          ) : comments.length === 0 ? (
            <AppText variant="footnote" style={{ marginVertical: spacing.sm, color: feedCardLight.muted }}>첫 댓글을 남겨보세요.</AppText>
          ) : (
            thread.map(({ c, body, replies }) => {
              const renderOne = (cc: FeedComment, cbody: string, nested: boolean) => {
                const canDelete = !!user && (String(cc.author_id) === String(user.id) || isMine);
                return (
                  <View key={cc.id} style={[styles.commentRow, nested && styles.commentReply]}>
                    <Avatar name={cc.author_nickname || '?'} size={nested ? 22 : 26} />
                    <View style={{ flex: 1, marginLeft: spacing.sm }}>
                      <View style={styles.commentHead}>
                        <AppText variant="caption" style={{ fontWeight: '600', color: feedCardLight.text }}>{cc.author_nickname}</AppText>
                        <AppText variant="caption" style={{ color: feedCardLight.muted }}> · {fmtTime(cc.created_at)}</AppText>
                      </View>
                      <AppText variant="footnote" style={{ color: feedCardLight.sub }}>{cbody}</AppText>
                      <View style={styles.commentActions}>
                        <TouchableOpacity onPress={() => replyTo(cc)} accessibilityLabel="답글">
                          <AppText variant="caption" style={{ color: feedCardLight.muted }}>답글</AppText>
                        </TouchableOpacity>
                        {!canDelete && user ? (
                          <TouchableOpacity onPress={() => setCommentReport(cc.id)} accessibilityLabel="댓글 신고">
                            <AppText variant="caption" style={{ color: feedCardLight.muted }}>신고</AppText>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    </View>
                    {canDelete ? (
                      <TouchableOpacity onPress={() => deleteComment(cc.id)} style={{ padding: 4 }} accessibilityLabel="댓글 삭제">
                        <Feather name="x" size={14} color={feedCardLight.muted} />
                      </TouchableOpacity>
                    ) : null}
                  </View>
                );
              };
              return (
                <View key={c.id}>
                  {renderOne(c, body, false)}
                  {replies.map((r) => renderOne(r.c, r.body, true))}
                </View>
              );
            })
          )}

          {/* 답글 대상 배너 */}
          {replyTarget ? (
            <View style={styles.replyBanner}>
              <AppText variant="caption" style={{ flex: 1, color: feedCardLight.sub }}>
                {replyTarget.author_nickname}님에게 답글 남기는 중
              </AppText>
              <TouchableOpacity onPress={() => setReplyTarget(null)} accessibilityLabel="답글 취소">
                <Feather name="x" size={14} color={feedCardLight.muted} />
              </TouchableOpacity>
            </View>
          ) : null}

          {/* 입력 */}
          {user ? (
            <View style={styles.commentInputRow}>
              <TextInput
                style={styles.commentInput}
                placeholder={replyTarget ? "답글을 입력하세요" : "댓글을 입력하세요"}
                placeholderTextColor={feedCardLight.muted}
                value={commentText}
                onChangeText={setCommentText}
                maxLength={1000}
                multiline
              />
              <TouchableOpacity onPress={submitComment} disabled={posting || !commentText.trim()} accessibilityLabel="댓글 등록">
                <AppText variant="footnote" style={{ color: commentText.trim() ? colors.accent.primary : feedCardLight.muted }}>{posting ? '...' : '등록'}</AppText>
              </TouchableOpacity>
            </View>
          ) : (
            <AppText variant="caption" style={{ marginTop: spacing.sm, color: feedCardLight.muted }}>로그인 후 댓글을 남길 수 있습니다.</AppText>
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
    backgroundColor: feedCardLight.bg, borderRadius: radius.lg,
    padding: spacing.lg, marginBottom: spacing.md,
    // v3.49: 좌우 여백은 FeedScreen 리스트 패딩(12)만 사용 — 카드 자체 margin 제거로 이중 여백(36px/쪽) 해소
  },
  header: { flexDirection: 'row', alignItems: 'center' },
  headerMain: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  moreBtn: { padding: 6 },
  menu: {
    alignSelf: 'flex-end', backgroundColor: feedCardLight.field, borderRadius: radius.md,
    paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, marginTop: 4,
    borderWidth: 1, borderColor: feedCardLight.line,
  },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 4 },
  title: { marginTop: spacing.md },
  actionBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xl,
    marginTop: spacing.md, paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: feedCardLight.line,
  },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  comments: { marginTop: spacing.md },
  commentRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: spacing.md },
  commentReply: {
    marginLeft: spacing.xl, paddingLeft: spacing.md,
    borderLeftWidth: 2, borderLeftColor: feedCardLight.line, // 스레드 연결선
  },
  replyBanner: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: feedCardLight.field, borderRadius: radius.sm,
    paddingHorizontal: spacing.md, paddingVertical: 6, marginBottom: spacing.xs,
  },
  commentHead: { flexDirection: 'row', alignItems: 'center' },
  commentActions: { flexDirection: 'row', gap: spacing.md, marginTop: 3 },
  commentInputRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, marginTop: spacing.xs,
    backgroundColor: feedCardLight.field, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderWidth: 1, borderColor: feedCardLight.line,
  },
  commentInput: { flex: 1, color: feedCardLight.text, maxHeight: 90, padding: 0 },
});
