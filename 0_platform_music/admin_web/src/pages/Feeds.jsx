import { useState, useEffect, useCallback } from 'react';
import {
  getAdminFeeds, getPendingComments, createOfficialFeed, deleteOfficialFeed,
  getFeedComments, addOfficialComment, deleteOfficialComment,
} from '../api';
import AuthImage from '../components/AuthImage';
import { appAlert, appConfirm } from '../components/dialog';
import { formatDate } from './Dashboard';

const MAX_IMAGES = 10;
const MAX_TEXT = 10000;
const MAX_COMMENT = 1000;
const errMsg = (err, fallback) => err.response?.data?.error || err.response?.data?.detail || fallback;

function Compose({ onPosted }) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  const pick = async (e) => {
    const chosen = Array.from(e.target.files || []);
    e.target.value = '';
    const next = [...files, ...chosen].slice(0, MAX_IMAGES);
    if (files.length + chosen.length > MAX_IMAGES) await appAlert(`사진은 최대 ${MAX_IMAGES}장까지 올릴 수 있습니다.`);
    setFiles(next);
  };

  const post = async () => {
    if (!text.trim() && files.length === 0) { await appAlert('내용이나 사진을 넣어주세요.'); return; }
    if (!(await appConfirm(`MAIDOL 공식 계정으로 피드에 올립니다.\n팔로워에게 새 글 알림이 갑니다.${files.length ? `\n사진 ${files.length}장 포함` : ''}`))) return;
    setBusy(true);
    try {
      await createOfficialFeed({ title, text, images: files });
      setTitle(''); setText(''); setFiles([]);
      await appAlert('피드에 올렸습니다.');
      onPosted?.();
    } catch (err) {
      await appAlert(errMsg(err, '글을 올리지 못했습니다.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h3 className="section-title">MAIDOL 공식 계정으로 글쓰기</h3>
      <input className="input" style={{ width: '100%', marginBottom: 8 }} maxLength={100} placeholder="제목 (선택)"
        value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea className="input" rows={6} maxLength={MAX_TEXT} style={{ width: '100%' }} placeholder="내용"
        value={text} onChange={(e) => setText(e.target.value)} />
      {previews.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '10px 0' }}>
          {previews.map((u, i) => (
            <div key={u} style={{ position: 'relative' }}>
              <img src={u} alt="" className="thumb" style={{ width: 72, height: 72 }} />
              <button className="btn btn--sm" style={{ position: 'absolute', top: -6, right: -6, padding: '0 6px' }}
                onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, gap: 8, flexWrap: 'wrap' }}>
        <label className="btn" style={{ cursor: 'pointer' }}>
          사진 추가 ({files.length}/{MAX_IMAGES})
          <input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={pick} />
        </label>
        <button className="btn btn--primary" onClick={post} disabled={busy}>{busy ? '올리는 중…' : '피드에 올리기'}</button>
      </div>
    </div>
  );
}

function CommentThread({ feedId, onChanged }) {
  const [data, setData] = useState(null);
  const [replyTo, setReplyTo] = useState(null); // 댓글 id (null = 최상위 댓글)
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await getFeedComments(feedId);
      setData(res.data);
    } catch (err) {
      setData({ error: errMsg(err, '불러오지 못했습니다.') });
    }
  }, [feedId]);
  useEffect(() => { load(); }, [load]);

  const submit = async (e) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    try {
      await addOfficialComment(feedId, t, replyTo);
      setText(''); setReplyTo(null);
      await load();
      onChanged?.();
    } catch (err) {
      await appAlert(errMsg(err, '댓글을 달지 못했습니다.'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c) => {
    if (!(await appConfirm(`"${c.text.slice(0, 40)}" 댓글을 삭제할까요?`))) return;
    try {
      await deleteOfficialComment(c.id);
      await load();
      onChanged?.();
    } catch (err) {
      await appAlert(errMsg(err, '삭제하지 못했습니다.'));
    }
  };

  if (!data) return <p className="loading">로딩 중…</p>;
  if (data.error) return <p className="error-msg">{data.error}</p>;

  const top = data.comments.filter((c) => !c.parent_id);
  const replies = (id) => data.comments.filter((c) => c.parent_id === id);
  const canDelete = (c) => c.is_official || data.feed.is_official;
  const replyTarget = replyTo && data.comments.find((c) => c.id === replyTo);

  const Row = ({ c, nested }) => (
    <div className={`comment ${nested ? 'comment--reply' : ''} ${c.is_official ? 'comment--official' : ''}`}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span className="cell-main">{c.author_nickname}</span>
        {c.is_official && <span className="badge badge--purple">공식</span>}
        <span className="cell-sub">{formatDate(c.created_at)}</span>
      </div>
      <div style={{ whiteSpace: 'pre-wrap', margin: '4px 0' }}>{c.text}</div>
      <div className="actions">
        <button className="btn btn--sm" onClick={() => setReplyTo(c.id)}>답글</button>
        {canDelete(c) && <button className="btn btn--sm btn--danger" onClick={() => remove(c)}>삭제</button>}
      </div>
    </div>
  );

  return (
    <div>
      <div className="feed-body">
        {data.feed.title && <h4 style={{ marginBottom: 6 }}>{data.feed.title}</h4>}
        {data.feed.images.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {data.feed.images.map((o) => <AuthImage key={o} objectName={o} className="thumb feed-img" />)}
          </div>
        )}
        <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{data.feed.text}</div>
      </div>
      <h4 className="section-title" style={{ marginTop: 14 }}>댓글 {data.comments.length}</h4>
      {top.length === 0 && <p className="cell-sub">아직 댓글이 없습니다.</p>}
      {top.map((c) => (
        <div key={c.id}>
          <Row c={c} />
          {replies(c.id).map((r) => <Row key={r.id} c={r} nested />)}
        </div>
      ))}
      <form onSubmit={submit} className="thread-input" style={{ marginTop: 12 }}>
        <div style={{ flex: 1 }}>
          {replyTarget && (
            <div className="cell-sub" style={{ marginBottom: 4 }}>
              ↳ {replyTarget.author_nickname} 님에게 답글 <button type="button" className="btn btn--sm" onClick={() => setReplyTo(null)}>취소</button>
            </div>
          )}
          <textarea className="input" rows={2} maxLength={MAX_COMMENT} style={{ width: '100%' }}
            placeholder={replyTarget ? 'MAIDOL 공식 계정으로 답글' : 'MAIDOL 공식 계정으로 댓글'}
            value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <button className="btn btn--primary" type="submit" disabled={busy || !text.trim()}>{replyTarget ? '답글 달기' : '댓글 달기'}</button>
      </form>
    </div>
  );
}

function FeedList({ scope, reloadKey }) {
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await getAdminFeeds({ scope, page, limit: 20 });
      setData(res.data);
    } catch (err) {
      setData({ error: errMsg(err, '피드를 불러오지 못했습니다.') });
    }
  }, [scope, page]);
  useEffect(() => { load(); }, [load, reloadKey]);

  const remove = async (f) => {
    if (!(await appConfirm('이 공식 계정 글을 삭제할까요? 댓글·좋아요도 함께 삭제됩니다.'))) return;
    try {
      await deleteOfficialFeed(f.id);
      setOpen(null);
      load();
    } catch (err) {
      await appAlert(errMsg(err, '삭제하지 못했습니다.'));
    }
  };

  if (!data) return <p className="loading">로딩 중…</p>;
  if (data.error) return <p className="error-msg">{data.error}</p>;

  return (
    <>
      <div className="table-wrap">
        <table>
          <thead><tr><th>사진</th><th>내용</th><th>작성자</th><th>좋아요</th><th>댓글</th><th>작성일</th><th></th></tr></thead>
          <tbody>
            {data.feeds.map((f) => (
              <tr key={f.id} style={{ cursor: 'pointer' }} onClick={() => setOpen(f)}>
                <td>{f.first_image ? <AuthImage objectName={f.first_image} /> : <div className="thumb thumb--placeholder">글</div>}</td>
                <td style={{ maxWidth: 380 }}>
                  {f.title && <div className="cell-main">{f.title}</div>}
                  <div className="inbox-preview">{f.excerpt || (f.image_count ? `사진 ${f.image_count}장` : '-')}</div>
                  {f.report_blinded && <span className="badge badge--red">신고 블라인드</span>}
                </td>
                <td>{f.author_nickname}{f.is_official && <span className="badge badge--purple" style={{ marginLeft: 4 }}>공식</span>}</td>
                <td>{f.like_count}</td>
                <td>{f.comment_count}</td>
                <td className="nowrap">{formatDate(f.created_at)}</td>
                <td>{f.is_official && (
                  <button className="btn btn--sm btn--danger" onClick={(e) => { e.stopPropagation(); remove(f); }}>삭제</button>
                )}</td>
              </tr>
            ))}
            {data.feeds.length === 0 && <tr><td colSpan={7} className="td-empty">글이 없습니다</td></tr>}
          </tbody>
        </table>
      </div>
      {data.pagination.totalPages > 1 && (
        <div className="pagination">
          <button className="btn btn--sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>이전</button>
          <span className="pagination__info">{page} / {data.pagination.totalPages}</span>
          <button className="btn btn--sm" disabled={page >= data.pagination.totalPages} onClick={() => setPage((p) => p + 1)}>다음</button>
        </div>
      )}
      {open && (
        <div className="modal-overlay" onClick={() => setOpen(null)}>
          <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal__title">{open.author_nickname} · {formatDate(open.created_at)}</h3>
            <CommentThread feedId={open.id} onChanged={load} />
            <div className="modal__footer"><button className="btn" onClick={() => setOpen(null)}>닫기</button></div>
          </div>
        </div>
      )}
    </>
  );
}

function Pending({ onChanged }) {
  const [list, setList] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await getPendingComments();
      setList(res.data.comments || []);
    } catch (err) {
      setList([]);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const reply = async (c) => {
    const t = (drafts[c.id] || '').trim();
    if (!t) return;
    setBusy(c.id);
    try {
      await addOfficialComment(c.feed_id, t, c.id);
      setDrafts((d) => ({ ...d, [c.id]: '' }));
      await load();
      onChanged?.();
    } catch (err) {
      await appAlert(errMsg(err, '답글을 달지 못했습니다.'));
    } finally {
      setBusy(null);
    }
  };

  if (!list) return <p className="loading">로딩 중…</p>;
  return (
    <div className="card">
      <h3 className="section-title">답글 대기 ({list.length})</h3>
      <p className="cell-sub" style={{ marginBottom: 10 }}>공식 계정 글에 달린 댓글 중 아직 공식 답글이 없는 것입니다. 답글을 달면 목록에서 빠지고 작성자에게 답글 알림이 갑니다.</p>
      {list.length === 0 && <p className="cell-sub">모든 댓글에 답했습니다.</p>}
      {list.map((c) => (
        <div key={c.id} className="comment">
          <div className="cell-sub">글: {c.feed_title || '(제목 없음)'} · {formatDate(c.created_at)}</div>
          <div><span className="cell-main">{c.author_nickname}</span> <span style={{ whiteSpace: 'pre-wrap' }}>{c.text}</span></div>
          <div className="thread-input" style={{ marginTop: 6 }}>
            <input className="input" style={{ flex: 1 }} maxLength={MAX_COMMENT} placeholder="공식 계정으로 답글"
              value={drafts[c.id] || ''} onChange={(e) => setDrafts((d) => ({ ...d, [c.id]: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter') reply(c); }} />
            <button className="btn btn--primary btn--sm" disabled={busy === c.id || !(drafts[c.id] || '').trim()} onClick={() => reply(c)}>답글</button>
          </div>
        </div>
      ))}
    </div>
  );
}

const TABS = [
  { key: 'official', label: '공식 계정 글' },
  { key: 'pending', label: '답글 대기' },
  { key: 'all', label: '전체 피드' },
];

export default function FeedsPage() {
  const [tab, setTab] = useState('official');
  const [reloadKey, setReloadKey] = useState(0);
  const bump = () => setReloadKey((k) => k + 1);
  return (
    <div>
      <h2 className="page-title">피드</h2>
      <div className="filters">
        <div className="filter-group">
          {TABS.map((t) => (
            <button key={t.key} className={`filter-btn ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>{t.label}</button>
          ))}
        </div>
      </div>
      {tab === 'official' && (<><Compose onPosted={bump} /><FeedList scope="official" reloadKey={reloadKey} /></>)}
      {tab === 'pending' && <Pending onChanged={bump} />}
      {tab === 'all' && <FeedList scope="all" reloadKey={reloadKey} />}
    </div>
  );
}
