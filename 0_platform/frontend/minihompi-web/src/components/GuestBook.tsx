import { useEffect, useState } from 'react';
import { getGuestbook, writeGuestbook } from '../api';
import './GuestBook.css';

interface GuestEntry {
  id: number;
  nickname: string;
  content: string;
  created_at: string;
}

interface GuestBookProps {
  userId: string;
}

function GuestBook({ userId }: GuestBookProps) {
  const [entries, setEntries] = useState<GuestEntry[]>([]);
  const [nickname, setNickname] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchEntries = async () => {
    try {
      const res = await getGuestbook(userId);
      setEntries(res.data.guestbook || res.data || []);
    } catch {
      // API not ready yet
    }
  };

  useEffect(() => {
    fetchEntries();
  }, [userId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nickname.trim() || !content.trim()) return;
    setSubmitting(true);
    try {
      await writeGuestbook(userId, nickname, content);
      setNickname('');
      setContent('');
      await fetchEntries();
    } catch {
      alert('방명록 작성에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  };

  return (
    <div className="guestbook">
      <div className="guestbook-header">
        <h3>Guest Book</h3>
      </div>

      <form className="guestbook-form" onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="닉네임"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          className="guestbook-nickname"
          required
        />
        <div className="guestbook-input-row">
          <textarea
            placeholder="방명록을 남겨주세요..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="guestbook-content"
            rows={3}
            required
          />
          <button type="submit" className="guestbook-submit" disabled={submitting}>
            {submitting ? '...' : '등록'}
          </button>
        </div>
      </form>

      <div className="guestbook-entries">
        {entries.length === 0 ? (
          <div className="guestbook-empty">
            <p>아직 방명록이 없습니다.</p>
            <p className="guestbook-empty-sub">첫 번째 방문 인사를 남겨주세요 &#x1F44B;</p>
          </div>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className="guestbook-entry">
              <div className="guestbook-entry-top">
                <span className="guestbook-author">{entry.nickname}</span>
                <span className="guestbook-date">{formatDate(entry.created_at)}</span>
              </div>
              <p className="guestbook-text">{entry.content}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default GuestBook;
