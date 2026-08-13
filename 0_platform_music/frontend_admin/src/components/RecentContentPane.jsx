import { useState, useEffect } from 'react';
import { getAdminUserRecentContent } from '../api';
import { coverSrc, adminMediaSrc } from '../utils/media';
import './RecentContentPane.css';

// v175 — AdminReportsPage(v138) 내부 컴포넌트에서 추출한 공용 "최근 생성물" 패널.
// 사용처: AdminReportsPage 양면 뷰 우측 / AdminUserDetailPage 최근 생성물 섹션.
// 클래스명은 CSS diff 최소화를 위해 기존 admin-reports__* 를 유지한다.
// coverSrc/adminMediaSrc 는 utils/media.js 로 이동 (react-refresh 규칙 — 컴포넌트 외 export 금지).
// 로그 태그: [RecentContent] — 증거/개인정보 원문은 콘솔에 출력하지 않는다.

// 게시자의 최근 생성물(트랙 커버 그리드 + 현재 캐릭터)
export default function RecentContentPane({ userId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(!!userId);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;
    // v138 원본(AdminReportsPage 내부 컴포넌트) 로직 그대로 이동 — userId 변경 시 로딩 상태 리셋.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError('');
    (async () => {
      try {
        const res = await getAdminUserRecentContent(userId);
        if (!cancelled) setData(res.data || {});
      } catch (err) {
        if (cancelled) return;
        console.error('[RecentContent] load failed', {
          status: err?.response?.status,
        });
        setError('최근 생성물을 불러오지 못했습니다.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  if (!userId) return <p className="admin-reports__pane-empty">게시자 정보를 확인할 수 없습니다.</p>;
  if (loading) return <p className="admin-reports__pane-empty">불러오는 중...</p>;
  if (error) return <p className="admin-reports__evidence-failed">{error}</p>;

  const tracks = Array.isArray(data?.tracks) ? data.tracks : [];
  const character = data?.character || {};
  // v138 BE 실필드: has_original_photo / *_path (구 명칭도 방어 유지)
  const hasOriginal = character.has_original_photo || character.has_original;
  const hasCharacter = character.has_sheet || character.has_virtual_sheet || hasOriginal;
  const originalSrc = character.original_photo_path || character.original_preview_url;
  const sheetSrc = character.sheet_path || character.sheet_preview_url;
  const virtualSheetSrc = character.virtual_sheet_path;

  return (
    <div className="admin-reports__recent">
      {tracks.length > 0 ? (
        <div className="admin-reports__recent-grid">
          {tracks.map((t) => (
            <div key={t.id} className="admin-reports__recent-card">
              {t.cover_image_url ? (
                <img className="admin-reports__recent-thumb" src={coverSrc(t.cover_image_url)} alt="" />
              ) : (
                <span className="admin-reports__recent-thumb admin-reports__recent-thumb--empty">♪</span>
              )}
              <span className="admin-reports__recent-title" title={t.title || ''}>{t.title || '-'}</span>
              <span className={`admin-reports__recent-visibility ${t.is_public ? '' : 'admin-reports__recent-visibility--private'}`}>
                {t.is_public ? '공개' : '비공개'}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="admin-reports__pane-empty">최근 트랙이 없습니다.</p>
      )}

      <div className="admin-reports__recent-character">
        <span className="admin-reports__evidence-kind">현재 캐릭터</span>
        {hasCharacter ? (
          <div className="admin-reports__recent-character-imgs">
            {originalSrc && (
              <figure className="admin-reports__recent-figure">
                <img className="admin-reports__recent-thumb" src={adminMediaSrc(originalSrc)} alt="원본 사진" />
                <figcaption>원본 사진</figcaption>
              </figure>
            )}
            {sheetSrc && (
              <figure className="admin-reports__recent-figure">
                <img className="admin-reports__recent-thumb" src={adminMediaSrc(sheetSrc)} alt="캐릭터 시트(실사)" />
                <figcaption>캐릭터 시트(실사)</figcaption>
              </figure>
            )}
            {virtualSheetSrc && (
              <figure className="admin-reports__recent-figure">
                <img className="admin-reports__recent-thumb" src={adminMediaSrc(virtualSheetSrc)} alt="캐릭터 시트(가상)" />
                <figcaption>캐릭터 시트(가상)</figcaption>
              </figure>
            )}
            {!originalSrc && !sheetSrc && !virtualSheetSrc && (
              <span className="admin-reports__pane-empty">
                {[hasOriginal ? '원본 사진 보유' : null, character.has_sheet ? '시트 보유' : null,
                  character.has_virtual_sheet ? '가상 시트 보유' : null]
                  .filter(Boolean).join(' · ')}
              </span>
            )}
          </div>
        ) : (
          <span className="admin-reports__pane-empty">등록된 캐릭터가 없습니다.</span>
        )}
      </div>
    </div>
  );
}
