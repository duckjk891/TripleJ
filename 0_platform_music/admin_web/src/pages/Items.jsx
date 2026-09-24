import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getItems, getItemOwners, updateItem, deleteItem, setItemHidden,
  importItems, getImportJob, getImportJobs,
} from '../api';
import AuthImage from '../components/AuthImage';
import { formatDate } from './Dashboard';
import { appAlert, appConfirm, appPrompt } from '../components/dialog';

const CATEGORIES = ['상의', '하의', '신발', '모자', '가방', '장소'];
const GENDERS = ['남성용', '여성용', '공용'];

function EditModal({ item, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: item.name || '',
    brand: item.brand || '',
    product_name: item.product_name || '',
    color: item.color || '',
    category: item.category || '상의',
    gender: item.gender || '여성용',
    product_url: item.product_url || '',
    is_active: item.is_active !== false,
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateItem(item.id, form);
      onSaved();
      onClose();
    } catch (err) {
      await appAlert(err.response?.data?.error || '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal__title">아이템 수정</h3>
        <div className="form-row"><label>표시 이름</label>
          <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} /></div>
        <div className="form-row"><label>브랜드</label>
          <input className="input" value={form.brand} onChange={(e) => set('brand', e.target.value)} /></div>
        <div className="form-row"><label>상품명</label>
          <input className="input" value={form.product_name} onChange={(e) => set('product_name', e.target.value)} /></div>
        <div className="form-row"><label>색상</label>
          <input className="input" value={form.color} onChange={(e) => set('color', e.target.value)} /></div>
        <div className="form-row"><label>카테고리</label>
          <select className="select" value={form.category} onChange={(e) => set('category', e.target.value)}>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select></div>
        <div className="form-row"><label>성별</label>
          <select className="select" value={form.gender} onChange={(e) => set('gender', e.target.value)}>
            {GENDERS.map((g) => <option key={g}>{g}</option>)}
          </select></div>
        <div className="form-row"><label>상품 URL</label>
          <input className="input" value={form.product_url} onChange={(e) => set('product_url', e.target.value)} /></div>
        <div className="form-row">
          <label>
            <input type="checkbox" checked={form.is_active}
              onChange={(e) => set('is_active', e.target.checked)} /> 활성 (광고주 노출 플래그)
          </label>
        </div>
        <div className="modal__footer">
          <button className="btn" onClick={onClose}>취소</button>
          <button className="btn btn--primary" onClick={handleSave} disabled={saving}>
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ImportPanel({ onImported }) {
  const [file, setFile] = useState(null);
  const [mode, setMode] = useState('append');
  const [dryResult, setDryResult] = useState(null);
  const [job, setJob] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const pollRef = useRef(null);

  useEffect(() => () => clearInterval(pollRef.current), []);

  // 마지막 실행 잡이 진행 중이면 이어서 표시
  useEffect(() => {
    getImportJobs().then((res) => {
      const running = (res.data.jobs || []).find((j) => j.status === 'running');
      if (running) startPolling(running.job_id);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startPolling = (jobId) => {
    clearInterval(pollRef.current);
    const tick = async () => {
      try {
        const res = await getImportJob(jobId);
        setJob(res.data);
        if (res.data.status !== 'running') {
          clearInterval(pollRef.current);
          onImported();
        }
      } catch {
        clearInterval(pollRef.current);
      }
    };
    tick();
    pollRef.current = setInterval(tick, 2500);
  };

  const handleDryRun = async () => {
    if (!file) { await appAlert('CSV 파일을 선택하세요.'); return; }
    setBusy(true);
    setDryResult(null);
    try {
      const res = await importItems(file, mode, true);
      setDryResult(res.data);
    } catch (err) {
      await appAlert(err.response?.data?.error || '검증에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handleRun = async () => {
    if (!file) { await appAlert('CSV 파일을 선택하세요.'); return; }
    const warn = mode === 'replace'
      ? 'CSV에 포함된 플랫폼의 기존 시드/임포트 아이템을 모두 지우고 새로 넣습니다(전량 교체). 진행할까요?'
      : '기존 아이템을 유지한 채 CSV 행을 추가합니다. 진행할까요?';
    if (!(await appConfirm(warn))) return;
    setBusy(true);
    try {
      const res = await importItems(file, mode, false);
      setDryResult(null);
      startPolling(res.data.job_id);
    } catch (err) {
      await appAlert(err.response?.data?.error || '임포트 시작에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const pct = job && job.total ? Math.round(((job.processed || 0) / job.total) * 100) : 0;

  const downloadTemplate = () => {
    const rows = [
      ['구분', '성별', '부위', '아이템명', '브랜드', '색상', '순위', '디테일페이지URL', '이미지URL'],
      ['무신사', '여성', '여성_상의', '오버핏 티셔츠', '예시브랜드', '화이트', '1', 'https://www.musinsa.com/products/12345', 'https://example.com/image1.jpg'],
      ['29cm', '남성', '남성_신발', '레더 스니커즈', '예시브랜드2', '블랙', '', 'https://www.29cm.co.kr/product/catalog/98765', 'https://example.com/image2.jpg'],
    ];
    const csv = '﻿' + rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'maidol_아이템_임포트_양식.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="card">
      <h3 className="section-title">CSV 임포트 (착장 데이터 갱신)</h3>
      <p className="cell-sub" style={{ marginBottom: 10 }}>
        구분(무신사·29cm·w컨셉·에이블리·지그재그·크림) · 성별 · 부위 · 아이템명 · 브랜드 · 색상 · 순위 · 디테일페이지URL · 이미지URL
        — 다른 헤더명(상품명·카테고리·상품URL·이미지 등)도 자동 인식됩니다. 이미지URL·구분·부위는 필수.
      </p>
      <div className="filters" style={{ marginBottom: 0 }}>
        <button className="btn" onClick={downloadTemplate}>양식 다운로드</button>
        <input ref={fileRef} type="file" accept=".csv" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        <select className="select" value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="append">추가 (append)</option>
          <option value="replace">전량 교체 (replace — 시즌 전환용)</option>
        </select>
        <button className="btn" onClick={handleDryRun} disabled={busy}>검증 (dry-run)</button>
        <button className="btn btn--primary" onClick={handleRun} disabled={busy}>임포트 실행</button>
      </div>

      {dryResult && (
        <div className="import-result">
          <b>검증 결과:</b> 유효 {dryResult.valid_rows}행 / 오류 {dryResult.error_count}행
          <ul>
            {Object.entries(dryResult.by_platform || {}).map(([p, c]) => <li key={p}>{p}: {c}건</li>)}
          </ul>
          {dryResult.errors?.length > 0 && (
            <ul style={{ color: 'var(--danger)' }}>
              {dryResult.errors.slice(0, 10).map((e, i) => <li key={i}>{e.line}행: {e.error}</li>)}
              {dryResult.error_count > 10 && <li>… 외 {dryResult.error_count - 10}건</li>}
            </ul>
          )}
        </div>
      )}

      {job && (
        <div className="import-result">
          <b>임포트 잡:</b>{' '}
          {job.status === 'running' && <span className="badge badge--amber">진행 중</span>}
          {job.status === 'done' && <span className="badge badge--green">완료</span>}
          {job.status === 'failed' && <span className="badge badge--red">실패</span>}
          {' '}{job.inserted || 0} 등록 / {job.skipped_count || 0} 스킵 / 총 {job.total}
          {job.mode === 'replace' && job.replaced != null && <> (기존 {job.replaced}건 교체 삭제)</>}
          {job.status === 'running' && <div className="progress-bar"><div style={{ width: `${pct}%` }} /></div>}
          {job.error && <div style={{ color: 'var(--danger)', marginTop: 6 }}>{job.error}</div>}
          {job.status === 'done' && job.skipped?.length > 0 && (
            <ul style={{ color: 'var(--amber)' }}>
              {job.skipped.slice(0, 10).map((s, i) => <li key={i}>{s.platform} — {s.product}: {s.error}</li>)}
              {job.skipped_count > 10 && <li>… 외 {job.skipped_count - 10}건</li>}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default function ItemsPage() {
  const [items, setItems] = useState([]);
  const [byCategory, setByCategory] = useState({});
  const [owners, setOwners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [gender, setGender] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [editing, setEditing] = useState(null);

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = { search, page, limit: 20 };
      if (category) params.category = category;
      if (gender) params.gender = gender;
      if (ownerId) params.owner_id = ownerId;
      const res = await getItems(params);
      setItems(res.data.items || []);
      setByCategory(res.data.by_category || {});
      setTotalPages(res.data.pagination?.totalPages || 1);
      setTotal(res.data.pagination?.total || 0);
    } catch {
      setError('아이템 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [search, page, category, gender, ownerId]);

  useEffect(() => { fetchList(); }, [fetchList]);
  useEffect(() => {
    getItemOwners().then((res) => setOwners(res.data.owners || [])).catch(() => {});
  }, []);

  const handleHidden = async (item) => {
    const toHide = !item.admin_hidden;
    let reason = '';
    if (toHide) {
      reason = await appPrompt('숨김 사유 (감사 로그용, 생략 가능):') || '';
    }
    try {
      await setItemHidden(item.id, toHide, reason);
      fetchList();
    } catch (err) {
      await appAlert(err.response?.data?.error || '숨김 설정에 실패했습니다.');
    }
  };

  const handleDelete = async (item) => {
    if (!(await appConfirm(`"${item.name}" 아이템을 삭제하시겠습니까? 이미지도 함께 삭제됩니다.`))) return;
    try {
      await deleteItem(item.id);
      fetchList();
    } catch (err) {
      await appAlert(err.response?.data?.error || '삭제에 실패했습니다.');
    }
  };

  return (
    <div>
      <h2 className="page-title">착장 아이템 관리</h2>

      <div className="stats-grid">
        <div className="stat-card"><span className="stat-label">전체 (필터 기준)</span><span className="stat-value">{total.toLocaleString()}</span></div>
        {CATEGORIES.map((c) => (
          <div key={c} className="stat-card">
            <span className="stat-label">{c}</span>
            <span className="stat-value">{(byCategory[c] || 0).toLocaleString()}</span>
          </div>
        ))}
      </div>

      <ImportPanel onImported={fetchList} />

      <div className="filters">
        <form className="search-form" onSubmit={(e) => { e.preventDefault(); setPage(1); fetchList(); }}>
          <input className="input" type="text" placeholder="이름·브랜드 검색"
            value={search} onChange={(e) => setSearch(e.target.value)} />
          <button className="btn" type="submit">검색</button>
        </form>
        <select className="select" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }}>
          <option value="">카테고리 전체</option>
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select className="select" value={gender} onChange={(e) => { setGender(e.target.value); setPage(1); }}>
          <option value="">성별 전체</option>
          {GENDERS.map((g) => <option key={g}>{g}</option>)}
        </select>
        <select className="select" value={ownerId} onChange={(e) => { setOwnerId(e.target.value); setPage(1); }}>
          <option value="">플랫폼 전체</option>
          {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </div>

      {error && <p className="error-msg">{error}</p>}
      {loading ? <p className="loading">로딩 중…</p> : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>이미지</th><th>이름</th><th>브랜드</th><th>분류</th><th>플랫폼</th><th>상태</th><th>등록일</th><th>액션</th></tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id}>
                    <td><AuthImage objectName={it.image_object_name} alt={it.name} /></td>
                    <td>
                      <div className="cell-main">{it.name}</div>
                      {it.product_url && (
                        <a href={it.product_url} target="_blank" rel="noreferrer" className="cell-sub" style={{ color: 'var(--primary)' }}>
                          상품 링크 ↗
                        </a>
                      )}
                    </td>
                    <td>{it.brand || '-'}</td>
                    <td>{it.category} · {it.gender}</td>
                    <td>{it.owner_name}</td>
                    <td>
                      {it.admin_hidden
                        ? <span className="badge badge--red">숨김</span>
                        : it.is_active !== false
                          ? <span className="badge badge--green">노출</span>
                          : <span className="badge badge--gray">비활성</span>}
                    </td>
                    <td className="nowrap">{formatDate(it.created_at)}</td>
                    <td>
                      <div className="actions">
                        <button className="btn btn--sm" onClick={() => setEditing(it)}>수정</button>
                        <button className="btn btn--sm" onClick={() => handleHidden(it)}>
                          {it.admin_hidden ? '숨김 해제' : '숨김'}
                        </button>
                        <button className="btn btn--sm btn--danger" onClick={() => handleDelete(it)}>삭제</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {items.length === 0 && <tr><td colSpan={8} className="td-empty">아이템이 없습니다</td></tr>}
              </tbody>
            </table>
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

      {editing && <EditModal item={editing} onClose={() => setEditing(null)} onSaved={fetchList} />}
    </div>
  );
}
