import { useState, useRef, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  FiHeart, FiMessageCircle, FiShare2, FiMoreHorizontal,
  FiMusic, FiPlay, FiPause, FiX, FiEdit2, FiTrash2, FiFlag,
} from 'react-icons/fi';
import { useAuth } from '../../contexts/AuthContext';
import * as api from '../../api';
import Avatar from '../Avatar';
import ReportModal from '../ReportModal';
import AppealModal from '../AppealModal';
import FeedTrackCard from './FeedTrackCard';
import './FeedPostCard.css';

const COMMENT_PAGE_LIMIT = 20;

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
}

// 클립보드 복사 (useTrackShare.copyLink 패턴 — clipboard API → execCommand 폴백)
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/**
 * v131 — 피드 글 카드.
 * 제목·작성자·날짜 / blocks(텍스트 문단·FeedTrackCard) / BGM 배너 /
 * ♥ 낙관적 토글 · 💬 펼침 댓글 · 📤 링크 복사 / 소유자 ⋯ 메뉴(수정/삭제).
 */
export default function FeedPostCard({ feed, feedAudio, onEdit, onDeleted, showAuthor = true }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isOwner = !!user && String(user.id) === String(feed.author_id);

  // ♥ 낙관적 상태
  const [likeCount, setLikeCount] = useState(feed.like_count || 0);
  const [isLiked, setIsLiked] = useState(!!feed.is_liked);
  const [likeBusy, setLikeBusy] = useState(false);

  // 💬 댓글
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState([]);
  const [commentTotal, setCommentTotal] = useState(feed.comment_count || 0);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentPage, setCommentPage] = useState(1);
  const [commentText, setCommentText] = useState('');
  const [commentBusy, setCommentBusy] = useState(false);

  // 📤 공유 / ⋯ 메뉴
  const [shareMsg, setShareMsg] = useState('');
  const shareMsgTimerRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const [deleting, setDeleting] = useState(false);

  // v137 — 신고 모달 대상 ({ type: 'feed'|'comment', id }) | null
  const [reportTarget, setReportTarget] = useState(null);

  // v139 — 소명(소유자 blinded): my-affected 매칭 항목(has_appeal 판단) + 소명 모달 열림
  const [affected, setAffected] = useState(null);
  const [appealOpen, setAppealOpen] = useState(false);

  useEffect(() => {
    if (!feed.report_blinded || !isOwner) return undefined;
    let alive = true;
    api.getMyAffectedReports()
      .then(({ data }) => {
        if (!alive) return;
        const items = Array.isArray(data?.reports) ? data.reports : (Array.isArray(data?.items) ? data.items : []);
        const found = items.find(
          (it) => it.target_type === 'feed' && String(it.target_id ?? '') === String(feed.id),
        );
        setAffected(found || null);
        if (import.meta.env.DEV) {
          console.info('[AppealModal] my-affected feed matched', {
            feed_id: feed.id,
            matched: !!found,
            has_appeal: !!found?.has_appeal,
          });
        }
      })
      .catch((err) => {
        console.error('[AppealModal] my-affected load failed', {
          status: err?.response?.status,
        });
      });
    return () => { alive = false; };
  }, [feed.report_blinded, feed.id, isOwner]);

  useEffect(() => () => {
    if (shareMsgTimerRef.current) clearTimeout(shareMsgTimerRef.current);
  }, []);

  // ⋯ 메뉴 외부 클릭/ESC 닫힘
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e) => {
      if (menuRef.current?.contains(e.target)) return;
      setMenuOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  // ── BGM 배너 ──────────────────────────────────────────────
  const bgm = feed.bgm_track;
  const isActiveBgm = !!feedAudio && feedAudio.bgmOwnerId === feed.id;
  const bgmPlaying = isActiveBgm && feedAudio.bgmStatus === 'playing';
  const bgmBlocked = isActiveBgm && feedAudio.bgmStatus === 'blocked';
  const bgmLoading = isActiveBgm && feedAudio.bgmStatus === 'loading';

  const handleBgmToggle = () => {
    if (!feedAudio || !bgm || bgm.deleted) return;
    if (import.meta.env.DEV) {
      console.info('[FeedPostCard] bgm toggle', { feed_id: feed.id, playing: bgmPlaying });
    }
    if (bgmPlaying) {
      feedAudio.pauseBgm();
    } else {
      feedAudio.playBgm(bgm, feed.id, { resume: isActiveBgm });
    }
  };

  const handleBgmOff = () => {
    if (!feedAudio) return;
    if (import.meta.env.DEV) console.info('[FeedPostCard] bgm off', { feed_id: feed.id });
    feedAudio.stopBgm();
  };

  // ── ♥ 낙관적 토글 ─────────────────────────────────────────
  const handleToggleLike = async () => {
    if (!user) {
      // 비로그인 → 로그인 유도
      navigate('/login');
      return;
    }
    if (likeBusy) return;
    const prev = { isLiked, likeCount };
    const nextLiked = !isLiked;
    setIsLiked(nextLiked);
    setLikeCount((c) => Math.max(0, c + (nextLiked ? 1 : -1)));
    setLikeBusy(true);
    if (import.meta.env.DEV) {
      console.info('[FeedPostCard] toggleLike start', { feed_id: feed.id, to: nextLiked });
    }
    try {
      const { data } = nextLiked
        ? await api.likeFeed(feed.id)
        : await api.unlikeFeed(feed.id);
      // 서버 확정값이 있으면 반영
      if (data && typeof data.like_count === 'number') setLikeCount(data.like_count);
      if (data && typeof data.is_liked === 'boolean') setIsLiked(data.is_liked);
    } catch (err) {
      console.error('[FeedPostCard] toggleLike failed', { err, feed_id: feed.id });
      setIsLiked(prev.isLiked);
      setLikeCount(prev.likeCount);
    } finally {
      setLikeBusy(false);
    }
  };

  // ── 💬 댓글 ───────────────────────────────────────────────
  const loadComments = useCallback(async (page) => {
    setCommentsLoading(true);
    if (import.meta.env.DEV) {
      console.info('[FeedPostCard] loadComments start', { feed_id: feed.id, page });
    }
    try {
      const { data } = await api.getFeedComments(feed.id, page, COMMENT_PAGE_LIMIT);
      const list = data?.comments || [];
      setComments((prevList) => (page === 1 ? list : [...prevList, ...list]));
      const commentsTotal = data?.pagination?.total ?? data?.total;
      if (typeof commentsTotal === 'number') setCommentTotal(commentsTotal);
      setCommentPage(page);
    } catch (err) {
      console.error('[FeedPostCard] loadComments failed', { err, feed_id: feed.id });
    } finally {
      setCommentsLoading(false);
    }
  }, [feed.id]);

  const handleToggleComments = () => {
    const next = !commentsOpen;
    setCommentsOpen(next);
    if (next && comments.length === 0) loadComments(1);
  };

  const handleAddComment = async (e) => {
    e.preventDefault();
    if (!user) { navigate('/login'); return; }
    const text = commentText.trim();
    if (!text || commentBusy) return;
    setCommentBusy(true);
    try {
      const { data } = await api.addFeedComment(feed.id, text);
      const createdComment = data?.comment ?? data;
      const created = createdComment && createdComment.id
        ? createdComment
        : {
            id: `tmp_${Date.now()}`,
            author_id: user.id,
            author_nickname: user.nickname,
            author_profile_image: user.profile_image,
            text,
            created_at: new Date().toISOString(),
          };
      setComments((prevList) => [...prevList, created]);
      setCommentTotal((t) => t + 1);
      setCommentText('');
      if (import.meta.env.DEV) console.info('[FeedPostCard] comment added', { feed_id: feed.id });
    } catch (err) {
      console.error('[FeedPostCard] addComment failed', { err, feed_id: feed.id });
      alert('댓글 등록에 실패했습니다.');
    } finally {
      setCommentBusy(false);
    }
  };

  const handleDeleteComment = async (comment) => {
    if (!window.confirm('댓글을 삭제할까요?')) return;
    try {
      await api.deleteFeedComment(comment.id);
      setComments((prevList) => prevList.filter((c) => c.id !== comment.id));
      setCommentTotal((t) => Math.max(0, t - 1));
      if (import.meta.env.DEV) console.info('[FeedPostCard] comment deleted', { feed_id: feed.id });
    } catch (err) {
      console.error('[FeedPostCard] deleteComment failed', { err, feed_id: feed.id });
      alert('댓글 삭제에 실패했습니다.');
    }
  };

  // ── 📤 링크 복사 ──────────────────────────────────────────
  const handleShare = async () => {
    const link = `${window.location.origin}/feed/${feed.id}`;
    const copied = await copyText(link);
    if (import.meta.env.DEV) console.info('[FeedPostCard] copy link', { feed_id: feed.id, copied });
    setShareMsg(copied ? '링크가 복사되었습니다' : '링크 복사에 실패했습니다.');
    if (shareMsgTimerRef.current) clearTimeout(shareMsgTimerRef.current);
    shareMsgTimerRef.current = setTimeout(() => setShareMsg(''), 3000);
  };

  // ── 소유자 삭제 ───────────────────────────────────────────
  const handleDelete = async () => {
    setMenuOpen(false);
    if (!window.confirm('피드를 삭제할까요? 댓글과 좋아요도 함께 삭제됩니다.')) return;
    setDeleting(true);
    try {
      await api.deleteFeed(feed.id);
      if (import.meta.env.DEV) console.info('[FeedPostCard] feed deleted', { feed_id: feed.id });
      onDeleted?.(feed.id);
    } catch (err) {
      console.error('[FeedPostCard] deleteFeed failed', { err, feed_id: feed.id });
      alert('피드 삭제에 실패했습니다.');
      setDeleting(false);
    }
  };

  const canDeleteComment = (comment) =>
    !!user && (String(user.id) === String(comment.author_id) || isOwner);

  return (
    <article className={`feed-post ${deleting ? 'feed-post--deleting' : ''}`}>
      <header className="feed-post__header">
        {showAuthor && (
          <Link to={`/artist/${feed.author_id}`} className="feed-post__author" title="채널 보기">
            <Avatar src={feed.author_profile_image} name={feed.author_nickname} size={36} />
            <span className="feed-post__author-name">{feed.author_nickname}</span>
          </Link>
        )}
        <span className="feed-post__date">{fmtDate(feed.created_at)}</span>
        {feed.kind === 'community' && (
          <span className="feed-post__kind-badge">📢 공지</span>
        )}
        <div className="feed-post__menu-wrap" ref={menuRef}>
          <button
            type="button"
            className="feed-post__menu-btn"
            onClick={() => setMenuOpen((v) => !v)}
            title="더보기"
            aria-haspopup="true"
            aria-expanded={menuOpen}
          >
            <FiMoreHorizontal />
          </button>
          {menuOpen && (
            <div className="feed-post__menu">
              {isOwner ? (
                <>
                  <button
                    type="button"
                    className="feed-post__menu-item"
                    onClick={() => { setMenuOpen(false); onEdit?.(feed); }}
                  >
                    <FiEdit2 /> 수정
                  </button>
                  <button
                    type="button"
                    className="feed-post__menu-item feed-post__menu-item--danger"
                    onClick={handleDelete}
                  >
                    <FiTrash2 /> 삭제
                  </button>
                </>
              ) : (
                /* v137 — 비소유자: 피드 신고 (비로그인은 모달에서 로그인 유도) */
                <button
                  type="button"
                  className="feed-post__menu-item feed-post__menu-item--danger"
                  onClick={() => { setMenuOpen(false); setReportTarget({ type: 'feed', id: feed.id }); }}
                >
                  <FiFlag /> 신고
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      {/* v137 — 신고 처리 블라인드 표시 (소유자 조회 시 report_blinded 필드 — 없으면 미표시) */}
      {feed.report_blinded && (
        <div className="feed-post__blinded">
          🚫 신고 처리로 비공개되었습니다
          {/* v139 — 소명하기 (제출됨이면 비활성) */}
          {isOwner && (
            affected?.has_appeal ? (
              <button type="button" className="feed-post__appeal-btn" disabled>
                소명 제출됨
              </button>
            ) : (
              <button
                type="button"
                className="feed-post__appeal-btn"
                onClick={() => setAppealOpen(true)}
              >
                소명하기
              </button>
            )
          )}
        </div>
      )}

      {feed.title && <h3 className="feed-post__title">{feed.title}</h3>}

      {bgm && (
        bgm.deleted ? (
          <div className="feed-post__bgm feed-post__bgm--deleted">
            <FiMusic /> BGM · 삭제된 곡
          </div>
        ) : (
          <div className={`feed-post__bgm ${isActiveBgm ? 'feed-post__bgm--active' : ''}`}>
            <FiMusic className="feed-post__bgm-icon" />
            <div className="feed-post__bgm-info">
              <span className="feed-post__bgm-label">BGM</span>
              <span className="feed-post__bgm-title">
                {bgm.title} — {bgm.artist_name || 'AI'}
              </span>
              {bgm.is_public === false && <span className="feed-post__bgm-badge">비공개</span>}
              {bgmBlocked && <span className="feed-post__bgm-wait">재생 대기</span>}
            </div>
            <button
              type="button"
              className="feed-post__bgm-btn"
              onClick={handleBgmToggle}
              disabled={bgmLoading}
              title={bgmPlaying ? '일시정지' : '재생'}
            >
              {bgmPlaying ? <FiPause /> : <FiPlay />}
            </button>
            {isActiveBgm && (
              <button
                type="button"
                className="feed-post__bgm-btn feed-post__bgm-btn--off"
                onClick={handleBgmOff}
                title="BGM 끄기"
              >
                <FiX />
              </button>
            )}
          </div>
        )
      )}

      <div className="feed-post__body">
        {(feed.blocks || []).map((block, idx) => (
          block.type === 'text' ? (
            <p key={`${feed.id}_b${idx}`} className="feed-post__text">{block.text}</p>
          ) : (
            <FeedTrackCard
              key={`${feed.id}_b${idx}`}
              track={block.track}
              feedAudio={feedAudio}
              playKey={`${feed.id}:${idx}`}
            />
          )
        ))}
      </div>

      <div className="feed-post__actions">
        <button
          type="button"
          className={`feed-post__action ${isLiked ? 'feed-post__action--liked' : ''}`}
          onClick={handleToggleLike}
          title="좋아요"
        >
          <FiHeart style={isLiked ? { color: '#e74c3c', fill: '#e74c3c' } : {}} />
          <span>{likeCount}</span>
        </button>
        <button
          type="button"
          className="feed-post__action"
          onClick={handleToggleComments}
          title="댓글"
        >
          <FiMessageCircle />
          <span>{commentTotal}</span>
        </button>
        <button type="button" className="feed-post__action" onClick={handleShare} title="링크 복사">
          <FiShare2 />
        </button>
        {shareMsg && <span className="feed-post__share-msg">{shareMsg}</span>}
      </div>

      {commentsOpen && (
        <div className="feed-post__comments">
          {commentsLoading && comments.length === 0 ? (
            <div className="feed-post__comments-empty">댓글을 불러오는 중...</div>
          ) : comments.length === 0 ? (
            <div className="feed-post__comments-empty">첫 댓글을 남겨보세요.</div>
          ) : (
            <ul className="feed-post__comment-list">
              {comments.map((c) => (
                <li key={c.id} className="feed-post__comment">
                  <Avatar src={c.author_profile_image} name={c.author_nickname} size={28} />
                  <div className="feed-post__comment-body">
                    <div className="feed-post__comment-meta">
                      <Link to={`/artist/${c.author_id}`} className="feed-post__comment-author">
                        {c.author_nickname}
                      </Link>
                      <span className="feed-post__comment-date">{fmtDate(c.created_at)}</span>
                    </div>
                    <div className="feed-post__comment-text">{c.text}</div>
                  </div>
                  {/* v137 — 비소유자(내가 쓴 댓글 아님) 소형 신고 버튼 */}
                  {(!user || String(user.id) !== String(c.author_id)) && !String(c.id).startsWith('tmp_') && (
                    <button
                      type="button"
                      className="feed-post__comment-report"
                      onClick={() => setReportTarget({ type: 'comment', id: c.id })}
                      title="댓글 신고"
                    >
                      <FiFlag /> 신고
                    </button>
                  )}
                  {canDeleteComment(c) && (
                    <button
                      type="button"
                      className="feed-post__comment-del"
                      onClick={() => handleDeleteComment(c)}
                      title="댓글 삭제"
                    >
                      <FiX />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {comments.length < commentTotal && !commentsLoading && (
            <button
              type="button"
              className="feed-post__comments-more"
              onClick={() => loadComments(commentPage + 1)}
            >
              댓글 더 보기 ({comments.length}/{commentTotal})
            </button>
          )}

          {user ? (
            <form className="feed-post__comment-form" onSubmit={handleAddComment}>
              <input
                type="text"
                className="feed-post__comment-input"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="댓글을 입력하세요"
                maxLength={1000}
              />
              <button
                type="submit"
                className="feed-post__comment-submit"
                disabled={commentBusy || !commentText.trim()}
              >
                등록
              </button>
            </form>
          ) : (
            <div className="feed-post__comments-login">
              <Link to="/login">로그인</Link> 후 댓글을 남길 수 있습니다.
            </div>
          )}
        </div>
      )}

      {/* v137 — 공용 신고 모달 (피드/댓글) */}
      {reportTarget && (
        <ReportModal
          targetType={reportTarget.type}
          targetId={reportTarget.id}
          onClose={() => setReportTarget(null)}
        />
      )}

      {/* v139 — 소명 제출 모달 (blinded 피드 소유자) */}
      {appealOpen && (
        <AppealModal
          targetType="feed"
          targetId={feed.id}
          onClose={() => setAppealOpen(false)}
          onSubmitted={() => {
            setAffected((prev) => ({ ...(prev || {}), has_appeal: true }));
          }}
        />
      )}
    </article>
  );
}
