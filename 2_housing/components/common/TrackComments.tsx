// [TrackComments] v3.177 — 곡 댓글 (플레이어 상세시트 '댓글' 탭).
//   백엔드: GET/POST /api/tracks/{id}/comments, DELETE /api/tracks/comments/{cid}
//   피드 댓글(FeedCard) 패턴과 동일: 최상위 댓글 + 1단 대댓글(parent_id) 스레드,
//   작성자 또는 곡 주인만 삭제, 미로그인은 작성 게이트.
import { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { AppText, Avatar } from '../ui';
import { colors } from '../../theme/colors';
import api from '../../services/api';
import { showAlert } from '../../utils/appAlert';
import { useAuthStore } from '../../stores/authStore';
import { profileImageUrl } from '../../services/authService';

export interface TrackComment {
  id: string;
  author_id: string;
  author_nickname?: string;
  author_profile_image?: string | null; // v3.180: 서버 목록 조회 시 PG join 첨부
  text: string;
  parent_id?: string | null;
  created_at?: string;
}

// v3.181: 자체 아바타 제거 → 공용 ui/Avatar(seed 팔레트 폴백·ring) 사용

interface Props {
  trackId?: string;
  trackOwnerId?: string;   // 곡 주인(삭제 권한) — 있으면 내 곡 댓글도 삭제 가능
  onCountChange?: (n: number) => void;
}

const parseUtc = (iso?: string) => (iso ? new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + 'Z') : null);
const fmtTime = (iso?: string): string => {
  const d = parseUtc(iso);
  if (!d) return '';
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return '방금 전';
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  return `${Math.floor(diff / 86400)}일 전`;
};

export default function TrackComments({ trackId, trackOwnerId, onCountChange }: Props) {
  const user = useAuthStore((s) => s.user);
  const [comments, setComments] = useState<TrackComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [replyTo, setReplyTo] = useState<TrackComment | null>(null);
  // v3.182(대표): 입력창 auto-grow — 초기 38(아바타·보내기와 동일), 개행 시 위로 늘어남(최대 120)
  const [inputHeight, setInputHeight] = useState(38);

  const load = useCallback(async () => {
    if (!trackId) { setLoading(false); return; } // v3.179(검증픽스): 영구 스피너 방지
    if (__DEV__) console.info('[TrackComments] load', { trackId });
    setLoading(true);
    try {
      const res = await api.get(`/tracks/${trackId}/comments`, { params: { page: 1, limit: 100 } });
      const list: TrackComment[] = res.data?.comments || [];
      setComments(list);
      onCountChange?.(res.data?.pagination?.total ?? list.length);
    } catch (err: any) {
      console.error('[TrackComments] load failed', { trackId, status: err?.response?.status });
    } finally {
      setLoading(false);
    }
  }, [trackId, onCountChange]);

  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    const body = text.trim();
    if (!body || submitting) return;
    if (!user) { showAlert('알림', '로그인 후 댓글을 남길 수 있어요.'); return; }
    setSubmitting(true);
    if (__DEV__) console.info('[TrackComments] submit', { trackId, reply: !!replyTo });
    try {
      await api.post(`/tracks/${trackId}/comments`, {
        text: body,
        parent_id: replyTo?.id || undefined,
      });
      setText('');
      setReplyTo(null);
      await load();
    } catch (err: any) {
      console.error('[TrackComments] submit failed', { trackId, status: err?.response?.status });
      showAlert('알림', err?.response?.data?.error || '댓글 등록에 실패했어요.');
    } finally {
      setSubmitting(false);
    }
  };

  const remove = (c: TrackComment) => {
    showAlert('댓글 삭제', '이 댓글을 삭제할까요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제', style: 'destructive', onPress: async () => {
          if (__DEV__) console.info('[TrackComments] delete', { id: c.id });
          try {
            await api.delete(`/tracks/comments/${c.id}`);
            await load();
          } catch (err: any) {
            console.error('[TrackComments] delete failed', { id: c.id, status: err?.response?.status });
            showAlert('알림', '댓글 삭제에 실패했어요.');
          }
        },
      },
    ]);
  };

  const canDelete = (c: TrackComment) =>
    !!user && (String(c.author_id) === String(user.id) || (!!trackOwnerId && String(trackOwnerId) === String(user.id)));

  // 최상위 + 대댓글 스레드 구성 (parent_id 기준, 1단 평탄화 계약)
  const roots = comments.filter((c) => !c.parent_id);
  const childrenOf = (pid: string) => comments.filter((c) => c.parent_id === pid);

  // v3.180: 곡 주인(아티스트) 댓글은 UI로 구분 — 강조 배경 + '아티스트' 배지
  const isOwnerComment = (c: TrackComment) =>
    !!trackOwnerId && String(c.author_id) === String(trackOwnerId);

  // v3.181(대표): 글 주인 표시 = 이름 굵게+액센트 + 아바타 테두리만 — 댓글 창 자체 UI 변경 금지
  const renderComment = (c: TrackComment, isReply = false) => (
    <View key={c.id} style={[styles.comment, isReply && styles.replyComment]}>
      <View style={styles.commentHead}>
        <Avatar
          uri={profileImageUrl(c.author_profile_image)}
          name={c.author_nickname}
          seed={c.author_id}
          size={32}
          ring={isOwnerComment(c)}
        />
        <AppText style={[styles.author, isOwnerComment(c) && styles.ownerAuthor]} numberOfLines={1}>
          {c.author_nickname || '익명'}
        </AppText>
        <View style={{ flex: 1 }} />
        <AppText style={styles.time}>{fmtTime(c.created_at)}</AppText>
      </View>
      <AppText style={styles.commentText}>{c.text}</AppText>
      <View style={styles.commentActions}>
        {!isReply && (
          <TouchableOpacity onPress={() => { setReplyTo(c); }} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
            <AppText style={styles.actionText}>답글</AppText>
          </TouchableOpacity>
        )}
        {canDelete(c) && (
          <TouchableOpacity onPress={() => remove(c)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
            <AppText style={[styles.actionText, styles.deleteText]}>삭제</AppText>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  // v3.182(대표): 입력창을 목록 아래(하단)로 이동
  const inputBlock = (
      <View style={styles.inputWrap}>
        {replyTo ? (
          <View style={styles.replyBanner}>
            <AppText style={styles.replyBannerText} numberOfLines={1}>
              {replyTo.author_nickname || '익명'}님에게 답글
            </AppText>
            <TouchableOpacity onPress={() => setReplyTo(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Feather name="x" size={14} color={colors.text.muted} />
            </TouchableOpacity>
          </View>
        ) : null}
        <View style={styles.inputRow}>
          {/* v3.180→v3.181: 작성자(나) 프로필 아바타 — 공용 Avatar, 조금 키움 */}
          {user ? <Avatar uri={profileImageUrl(user.profile_image)} name={user.nickname} seed={user.id} size={38} /> : null}
          <TextInput
            style={[styles.input, { height: inputHeight }]}
            value={text}
            onChangeText={(v) => { setText(v); if (!v) setInputHeight(38); }}
            onContentSizeChange={(e) => {
              // RN-web은 마운트 직후 기본 rows 기준 큰 값을 보고 → 텍스트 없으면 38 고정
              if (!text) { setInputHeight(38); return; }
              const h = Math.ceil(e.nativeEvent.contentSize.height) + 18; // 패딩 보정
              setInputHeight(Math.min(120, Math.max(38, h)));
            }}
            placeholder={user ? '댓글을 남겨보세요' : '로그인 후 댓글을 남길 수 있어요'}
            placeholderTextColor={colors.text.muted}
            multiline
            maxLength={1000}
            editable={!!user}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!text.trim() || submitting) && styles.sendBtnDisabled]}
            onPress={submit}
            disabled={!text.trim() || submitting}
            accessibilityLabel="댓글 등록"
          >
            {submitting ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="send" size={16} color="#fff" />}
          </TouchableOpacity>
        </View>
      </View>
  );

  return (
    <View>
      {/* 목록 */}
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent.primary} /></View>
      ) : roots.length === 0 ? (
        <AppText style={styles.empty}>첫 댓글을 남겨보세요.</AppText>
      ) : (
        <View style={styles.list}>
          {roots.map((c) => (
            <View key={c.id}>
              {renderComment(c)}
              {childrenOf(c.id).map((child) => renderComment(child, true))}
            </View>
          ))}
        </View>
      )}
      {/* 작성 입력 — 하단 배치 */}
      {inputBlock}
    </View>
  );
}

const styles = StyleSheet.create({
  inputWrap: { marginTop: 14 },
  replyBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.bg.surface2, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 6,
  },
  replyBannerText: { flex: 1, fontSize: 12, color: colors.accent.primary, marginRight: 8 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: {
    flex: 1, minHeight: 38, maxHeight: 120,
    backgroundColor: colors.bg.surface1, borderRadius: 10,
    borderWidth: 1, borderColor: colors.border.subtle,
    paddingHorizontal: 12, paddingVertical: 8,
    color: colors.text.primary, fontSize: 14,
  },
  sendBtn: {
    width: 38, height: 38, borderRadius: 10,
    backgroundColor: colors.accent.primary,
    justifyContent: 'center', alignItems: 'center',
  },
  sendBtnDisabled: { backgroundColor: colors.bg.surface2 },
  center: { paddingVertical: 24, alignItems: 'center' },
  empty: { color: colors.text.muted, fontSize: 13, textAlign: 'center', paddingVertical: 24 },
  list: { gap: 4 },
  // v3.181(대표): 댓글 사이 구분선·답글 연결선 제거 — 아래로 쭉 이어지는 흐름
  comment: { paddingVertical: 10 },
  replyComment: { marginLeft: 26 },
  commentHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 4, gap: 7 },
  author: { fontSize: 13, fontWeight: '700', color: colors.text.primary, flexShrink: 1 },
  time: { fontSize: 11, color: colors.text.muted },
  commentText: { fontSize: 14, color: colors.text.primary, lineHeight: 19 },
  // v3.181(대표): 글 주인 표시 — 이름 굵게+액센트 (박스·배지 스타일은 롤백)
  ownerAuthor: { color: colors.accent.primary, fontWeight: '800' },
  commentActions: { flexDirection: 'row', gap: 16, marginTop: 6 },
  actionText: { fontSize: 12, color: colors.text.secondary, fontWeight: '600' },
  deleteText: { color: colors.text.muted },
});
