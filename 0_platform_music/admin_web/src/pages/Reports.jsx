import { useState, useEffect, useCallback } from 'react';
import {
  getReports, actOnReport, fetchEvidenceBlob, getUserRecentContent, faceSearch, purgeTargets, errMsg,
} from '../api';
import { formatDate } from './Dashboard';
import { appAlert, appConfirm } from '../components/dialog';
import AuthImage from '../components/AuthImage';

const STATUS_TABS = [
  { value: 'pending', label: '대기' },
  { value: 'actioned', label: '처리됨' },
  { value: 'dismissed', label: '기각' },
  { value: 'all', label: '전체' },
];

// 서버 routes/reports.py REASON_CODES 와 동일(+ 과거 코드 호환)
const REASON_LABELS = {
  portrait: '초상권 침해', copyright: '저작권 침해', sexual: '성적 콘텐츠', abuse: '욕설·괴롭힘', other: '기타',
  hate: '혐오/차별', violence: '폭력', spam: '스팸', privacy: '개인정보', etc: '기타',
};

// 서버 routes/reports.py TARGET_TYPES 와 동일
const TYPE_LABELS = {
  track: '곡', feed: '피드', comment: '피드 댓글', track_comment: '곡 댓글', dm_message: 'DM 메시지',
  club_post: '크루 글', club: '크루', club_member: '크루 멤버', club_message: '크루 채팅',
};

const ACTION_LABELS = { blind: '블라인드', delete: '삭제', confirm_delete: '확정 삭제', restore: '복원', dismiss: '기각' };
const RESOLUTION_LABELS = { deleted: '파기 완료', removed_by_user: '위반 확정 · 대상 없음', restored: '복원됨' };

// 유형별 처리 버튼 — 서버 handle_report 의 화이트리스트와 맞춘다.
//  · 곡·피드·크루 글: 블라인드 / 확정 삭제(완전 파기+위반 기록)
//  · 크루: 블라인드만(삭제 계열 미지원)
//  · 댓글·곡 댓글·크루 채팅: 삭제
//  · DM 메시지·크루 멤버: 콘텐츠 조치 없음 → 위반 확정(작성자에게 위반 1회 기록)
const DELETE_ONLY = ['comment', 'track_comment', 'club_message'];
const STRIKE_ONLY = ['dm_message', 'club_member'];

function pendingActions(type) {
  if (DELETE_ONLY.includes(type)) {
    return [{ action: 'delete', label: '삭제', danger: true, confirm: '이 내용을 삭제합니다. 되돌릴 수 없습니다.' }];
  }
  if (STRIKE_ONLY.includes(type)) {
    return [{
      action: 'confirm_delete', label: '위반 확정', danger: true,
      confirm: '위반으로 확정합니다.\n대상 사용자에게 위반 1회가 기록되고, 누적되면 이용 제한이 자동 적용됩니다.\n(메시지·계정 자체는 삭제되지 않습니다)',
    }];
  }
  if (type === 'club') {
    return [{ action: 'blind', label: '블라인드', confirm: '이 크루를 블라인드(비노출) 처리합니다. 나중에 복원할 수 있습니다.' }];
  }
  return [
    { action: 'blind', label: '블라인드', confirm: '블라인드(비공개 잠금) 처리합니다. 나중에 복원할 수 있습니다.' },
    {
      action: 'confirm_delete', label: '확정 삭제', danger: true,
      confirm: '확정 삭제합니다.\n대상이 완전히 파기되고 작성자에게 위반 1회가 기록됩니다. 되돌릴 수 없습니다.',
    },
  ];
}

const isImageItem = (it) => !/\.json$/i.test(it?.object_name || '');
const toObjectName = (path) => {
  const s = String(path || '');
  const i = s.indexOf('/admin/media/');
  return i >= 0 ? s.slice(i + '/admin/media/'.length) : s;
};

function TargetSummary({ r, onZoom }) {
  const t = r.target || {};
  if (t.deleted) return <span className="badge badge--gray">삭제된 대상 (스냅샷 없음)</span>;
  const by = t.uploader_nickname || t.author_nickname || t.nickname;
  let main = '-';
  switch (r.target_type) {
    case 'track': main = t.title || '(제목 없음)'; break;
    case 'feed':
    case 'club_post': main = t.text_excerpt || `(${t.kind || '글'} · 본문 없음)`; break;
    case 'club': main = t.name ? `${t.name}${t.text_excerpt ? ` — ${t.text_excerpt}` : ''}` : (t.text_excerpt || '-'); break;
    case 'club_member': main = t.nickname || '(닉네임 없음)'; break;
    case 'dm_message': main = t.text || (t.image_count ? `(사진 ${t.image_count}장)` : '(본문 없음)'); break;
    default: main = t.text || '-';
  }
  const liveImages = r.target_type === 'dm_message' ? (t.image_object_names || []) : [];
  return (
    <>
      <p>{main}</p>
      {r.target_type !== 'club_member' && by && <div className="cell-sub">작성자 {by}</div>}
      <div className="cell-sub">
        {t.from_snapshot && <span className="badge badge--gray">접수 시점 스냅샷</span>}{' '}
        {t.report_blinded && <span className="badge badge--amber">블라인드 중</span>}{' '}
        {t.deleted === true && r.target_type === 'club_message' && <span className="badge badge--gray">삭제됨</span>}
        {r.target_type === 'dm_message' && t.image_count > 0 && t.text ? <span className="badge badge--purple">사진 {t.image_count}장</span> : null}
      </div>
      {liveImages.length > 0 && (
        <div className="thumb-row">
          {liveImages.map((n) => (
            <span key={n} onClick={() => onZoom({ objectName: n })}>
              <AuthImage objectName={n} className="thumb thumb--md" />
            </span>
          ))}
        </div>
      )}
    </>
  );
}

function EvidenceItems({ report, onZoom }) {
  const items = report.evidence?.items || [];
  const [blobs, setBlobs] = useState({}); // idx -> {url} | {json} | {error}

  useEffect(() => {
    let cancelled = false;
    const created = [];
    items.forEach((it, idx) => {
      fetchEvidenceBlob(report.id, idx)
        .then(async (res) => {
          if (cancelled) return;
          if (isImageItem(it)) {
            const u = URL.createObjectURL(res.data);
            created.push(u);
            setBlobs((p) => ({ ...p, [idx]: { url: u } }));
          } else {
            const text = await res.data.text();
            let json = text;
            try { json = JSON.stringify(JSON.parse(text), null, 2); } catch { /* 원문 그대로 */ }
            if (!cancelled) setBlobs((p) => ({ ...p, [idx]: { json } }));
          }
        })
        .catch(() => { if (!cancelled) setBlobs((p) => ({ ...p, [idx]: { error: true } })); });
    });
    return () => { cancelled = true; created.forEach((u) => URL.revokeObjectURL(u)); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report.id]);

  if (items.length === 0) return <p className="cell-sub">접수 시점에 저장된 증거 파일이 없습니다.</p>;
  const images = items.map((it, idx) => ({ it, idx })).filter((x) => isImageItem(x.it));
  const docs = items.map((it, idx) => ({ it, idx })).filter((x) => !isImageItem(x.it));

  return (
    <>
      {images.length > 0 && (
        <div className="evidence-grid" style={{ marginBottom: 12 }}>
          {images.map(({ it, idx }) => (
            <div key={idx}>
              {blobs[idx]?.url
                ? <img src={blobs[idx].url} alt={it.kind} onClick={() => onZoom({ url: blobs[idx].url })} />
                : <div className="thumb thumb--placeholder" style={{ width: 120, height: 120 }}>{blobs[idx]?.error ? '불러오기 실패' : '로딩…'}</div>}
              <div className="cell-sub">{it.kind || `항목 ${idx + 1}`}</div>
            </div>
          ))}
        </div>
      )}
      {docs.map(({ it, idx }) => (
        <div key={idx} style={{ marginBottom: 10 }}>
          <div className="cell-sub" style={{ marginBottom: 4 }}>{it.kind === 'meta' ? '대상 정보 (접수 시점)' : '대상 원문 (접수 시점)'}</div>
          <div className="pre">{blobs[idx]?.json ?? (blobs[idx]?.error ? '불러오기 실패' : '로딩…')}</div>
        </div>
      ))}
    </>
  );
}

function OwnerContent({ ownerId, onZoom }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    getUserRecentContent(ownerId).then((r) => setData(r.data)).catch((e) => setErr(errMsg(e, '불러오지 못했습니다.')));
  }, [ownerId]);
  if (err) return <p className="cell-sub">{err}</p>;
  if (!data) return <p className="cell-sub">로딩…</p>;
  const sheets = [
    data.character?.original_photo_path && ['원본 사진', data.character.original_photo_path],
    ...(data.artists || []).map((a) => a.sheet_path && [`${a.name || '아티스트'} (${a.kind === 'virtual' ? '가상' : '실사'})`, a.sheet_path]),
  ].filter(Boolean);
  return (
    <>
      {sheets.length > 0 && (
        <div className="thumb-row" style={{ marginBottom: 10 }}>
          {sheets.map(([label, path]) => (
            <div key={path} style={{ textAlign: 'center' }} onClick={() => onZoom({ objectName: toObjectName(path) })}>
              <AuthImage objectName={toObjectName(path)} className="thumb thumb--md" />
              <div className="cell-sub" style={{ maxWidth: 80 }}>{label}</div>
            </div>
          ))}
        </div>
      )}
      {(data.tracks || []).length === 0 ? <p className="cell-sub">등록한 곡이 없습니다.</p> : (
        <div className="table-wrap">
          <table>
            <tbody>
              {data.tracks.map((t) => (
                <tr key={t.id}>
                  <td className="cell-main">{t.title || '(제목 없음)'}</td>
                  <td>
                    {t.report_blinded ? <span className="badge badge--amber">블라인드</span>
                      : <span className={`badge ${t.is_public ? 'badge--green' : 'badge--gray'}`}>{t.is_public ? '공개' : '비공개'}</span>}
                  </td>
                  <td className="nowrap cell-sub">{formatDate(t.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function FaceSearch({ report, onZoom, onPurged }) {
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState({});

  const run = async () => {
    setBusy(true);
    try {
      const res = await faceSearch(report.id);
      setResult(res.data);
      setPicked({});
    } catch (e) {
      await appAlert(errMsg(e, '수색에 실패했습니다.'));
    } finally {
      setBusy(false);
    }
  };

  const keyOf = (m) => `${m.type}:${m.id}`;
  const chosen = (result?.matches || []).filter((m) => picked[keyOf(m)]);

  const purge = async () => {
    if (!(await appConfirm(`선택한 ${chosen.length}건을 몰수(완전 파기)합니다.\n파일·기록이 모두 삭제되고 위반이 기록됩니다. 되돌릴 수 없습니다.`))) return;
    setBusy(true);
    try {
      const res = await purgeTargets(report.id, chosen.map((m) => ({ type: m.type, id: m.id })));
      const d = res.data;
      await appAlert(`몰수 완료 — 곡 ${d.purged?.tracks ?? 0}건 · 캐릭터 ${d.purged?.characters ?? 0}건${(d.failed || []).length ? ` · 실패 ${d.failed.length}건` : ''}`);
      setResult(null);
      onPurged();
    } catch (e) {
      await appAlert(errMsg(e, '몰수에 실패했습니다.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="cell-sub" style={{ marginBottom: 8 }}>
        증거의 원본 사진 얼굴을 기준으로, 신고 대상 사용자의 다른 곡 커버·캐릭터에서 같은 얼굴을 찾습니다. 시간이 걸릴 수 있습니다.
      </p>
      <button className="btn btn--sm" disabled={busy} onClick={run}>{busy ? '처리 중…' : '같은 얼굴 수색'}</button>
      {result && (
        <div style={{ marginTop: 12 }}>
          <div className="cell-sub" style={{ marginBottom: 8 }}>
            일치 {result.matches.length}건 · 검사 {result.scanned ?? '-'}건{result.skipped ? ` · 건너뜀 ${result.skipped}건` : ''}
          </div>
          <div className="match-grid">
            {result.matches.map((m) => {
              const obj = m.object_name || '';
              const k = keyOf(m);
              return (
                <div key={k} className={`match ${picked[k] ? 'selected' : ''}`} onClick={() => setPicked((p) => ({ ...p, [k]: !p[k] }))}>
                  {obj.startsWith('http')
                    ? <img src={obj} alt="" className="thumb" />
                    : <AuthImage objectName={obj} className="thumb" />}
                  <div className="cell-main">{m.title || '-'}</div>
                  <div className="cell-sub">{m.type === 'track' ? '곡 커버' : '캐릭터'} · 유사도 {m.similarity}</div>
                  <div className="cell-sub">
                    <a onClick={(e) => { e.stopPropagation(); onZoom(obj.startsWith('http') ? { url: obj } : { objectName: obj }); }} style={{ textDecoration: 'underline' }}>크게 보기</a>
                  </div>
                </div>
              );
            })}
          </div>
          {result.matches.length > 0 && (
            <button className="btn btn--sm btn--danger" style={{ marginTop: 10 }} disabled={busy || chosen.length === 0} onClick={purge}>
              선택 {chosen.length}건 몰수
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function DetailModal({ report, onClose, onZoom, onChanged }) {
  const [tab, setTab] = useState('evidence');
  const ownerId = report.evidence?.owner_id || report.target?.sender_id;
  const hasFaceBase = (report.evidence?.items || []).some((it) => it.kind === 'original_photo');
  const tabs = [
    ['evidence', '증거 자료'],
    ownerId && ['owner', '대상 사용자 콘텐츠'],
    hasFaceBase && ['face', '얼굴 수색'],
  ].filter(Boolean);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal__title">
          {TYPE_LABELS[report.target_type] || report.target_type} 신고 — {REASON_LABELS[report.reason_code] || report.reason_code}
        </h3>
        <dl className="kv" style={{ marginBottom: 14 }}>
          <dt>접수</dt><dd>{formatDate(report.created_at)} · 신고자 {report.reporter_nickname || '-'}</dd>
          <dt>신고 내용</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{report.reason_text || '(입력 없음)'}</dd>
          {report.appeal && (<><dt>소명</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{report.appeal.text} <span className="cell-sub">({formatDate(report.appeal.created_at)})</span></dd></>)}
          <dt>대상 ID</dt><dd className="cell-sub">{report.target_id}</dd>
        </dl>
        <div className="tabs">
          {tabs.map(([v, l]) => (
            <button key={v} className={`tab ${tab === v ? 'active' : ''}`} onClick={() => setTab(v)}>{l}</button>
          ))}
        </div>
        {tab === 'evidence' && <EvidenceItems report={report} onZoom={onZoom} />}
        {tab === 'owner' && ownerId && <OwnerContent ownerId={ownerId} onZoom={onZoom} />}
        {tab === 'face' && <FaceSearch report={report} onZoom={onZoom} onPurged={onChanged} />}
        <div className="modal__footer">
          <button className="btn" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}

function Lightbox({ src, onClose }) {
  return (
    <div className="lightbox" onClick={onClose}>
      {src.url ? <img src={src.url} alt="" /> : <AuthImage objectName={src.objectName} className="" />}
    </div>
  );
}

export default function ReportsPage() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('pending');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [detailOf, setDetailOf] = useState(null);
  const [zoom, setZoom] = useState(null);
  const [busy, setBusy] = useState(null);

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await getReports({ status, page, limit: 20 });
      setReports(res.data.reports || []);
      setTotalPages(res.data.pagination?.totalPages || 1);
      setTotal(res.data.pagination?.total || 0);
    } catch {
      setError('신고 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [status, page]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const doAction = async (report, action, message) => {
    if (!(await appConfirm(message))) return;
    setBusy(report.id);
    try {
      await actOnReport(report.id, action);
      await fetchList();
    } catch (err) {
      await appAlert(errMsg(err, '처리에 실패했습니다.'));
    } finally {
      setBusy(null);
    }
  };

  const actionButtons = (r) => {
    const disabled = busy === r.id;
    if (r.status === 'pending') {
      return [
        ...pendingActions(r.target_type).map((a) => (
          <button key={a.action} className={`btn btn--sm ${a.danger ? 'btn--danger' : ''}`} disabled={disabled}
            onClick={() => doAction(r, a.action, a.confirm)}>{a.label}</button>
        )),
        <button key="dis" className="btn btn--sm" disabled={disabled}
          onClick={() => doAction(r, 'dismiss', '이 신고를 기각합니다. 대상에는 아무 조치도 하지 않습니다.')}>기각</button>,
      ];
    }
    if (r.status === 'actioned' && r.action === 'blind') {
      return [<button key="res" className="btn btn--sm" disabled={disabled}
        onClick={() => doAction(r, 'restore', '블라인드를 해제하고 원래 공개 상태로 복원합니다.')}>복원</button>];
    }
    return null;
  };

  const statusBadge = (r) => {
    if (r.status === 'pending') return <span className="badge badge--amber">대기</span>;
    const res = r.resolution ? ` · ${RESOLUTION_LABELS[r.resolution] || r.resolution}` : '';
    if (r.status === 'actioned') {
      const strikeOnly = STRIKE_ONLY.includes(r.target_type) && r.action === 'confirm_delete';
      return <span className="badge badge--green">{strikeOnly ? '위반 확정' : `${ACTION_LABELS[r.action] || r.action}${res}`}</span>;
    }
    return <span className="badge badge--gray">기각{res}</span>;
  };

  return (
    <div>
      <h2 className="page-title">신고 처리</h2>

      <div className="filters">
        <div className="filter-group">
          {STATUS_TABS.map((t) => (
            <button
              key={t.value}
              className={`filter-btn ${status === t.value ? 'active' : ''}`}
              onClick={() => { setStatus(t.value); setPage(1); }}
            >
              {t.label}
            </button>
          ))}
        </div>
        {!loading && <span className="cell-sub">{total.toLocaleString()}건</span>}
      </div>

      {error && <p className="error-msg">{error}</p>}
      {loading ? <p className="loading">로딩 중…</p> : (
        <>
          <div className="report-list">
            {reports.map((r) => {
              const evCount = r.evidence?.items?.length || 0;
              const buttons = actionButtons(r);
              return (
                <div key={r.id} className={`report-card ${r.urgent && r.status === 'pending' ? 'report-card--urgent' : ''}`}>
                  <div className="report-card__head">
                    {r.urgent && <span className="badge badge--red">긴급</span>}
                    <span className="badge badge--purple">{TYPE_LABELS[r.target_type] || r.target_type}</span>
                    <span className="cell-main">{REASON_LABELS[r.reason_code] || r.reason_code}</span>
                    {statusBadge(r)}
                    <span className="when">{formatDate(r.created_at)}</span>
                  </div>
                  <div className="report-card__body">
                    <div>
                      <h4>신고 대상</h4>
                      <TargetSummary r={r} onZoom={setZoom} />
                    </div>
                    <div>
                      <h4>신고 내용 · 신고자 {r.reporter_nickname || '-'}</h4>
                      <p>{r.reason_text || <span className="cell-sub">(입력 없음)</span>}</p>
                      {r.appeal && (
                        <>
                          <h4 style={{ marginTop: 8 }}>작성자 소명</h4>
                          <p>{r.appeal.text}</p>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="report-card__foot">
                    <div className="actions">
                      <button className="btn btn--sm" onClick={() => setDetailOf(r)}>
                        자세히{evCount > 0 ? ` · 증거 ${evCount}건` : ''}
                      </button>
                    </div>
                    {r.handled_by_nickname && (
                      <span className="cell-sub">처리 {r.handled_by_nickname} · {formatDate(r.handled_at)}</span>
                    )}
                    {buttons && <div className="actions">{buttons}</div>}
                  </div>
                </div>
              );
            })}
            {reports.length === 0 && <div className="card td-empty">신고가 없습니다</div>}
          </div>

          {totalPages > 1 && (
            <div className="pagination">
              <button className="btn btn--sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>이전</button>
              <span className="pagination__info">{page} / {totalPages}</span>
              <button className="btn btn--sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>다음</button>
            </div>
          )}
        </>
      )}

      {detailOf && (
        <DetailModal
          report={detailOf}
          onClose={() => setDetailOf(null)}
          onZoom={setZoom}
          onChanged={() => { setDetailOf(null); fetchList(); }}
        />
      )}
      {zoom && <Lightbox src={zoom} onClose={() => setZoom(null)} />}
    </div>
  );
}
