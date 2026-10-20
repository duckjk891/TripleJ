import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { importItems, listImportJobs, getImportJob, friendlyError } from '../api';
import { appConfirm, appAlert, toast } from '../components/dialog';
import PhotoUpload from '../components/PhotoUpload';

// v3.381 엑셀/CSV 대량 등록 — 양식 받기 → 파일 고르기 → 미리 검사 → 등록(서버가 사진을 받아 저장, 진행률 표시).
// 서버: POST /api/business/ads/import(dry_run), GET /api/business/ads/import-jobs[/id]

const MAX_MB = 10;
const HEAD = ['착장에 보일 이름', '카테고리', '대상', '브랜드', '색상', '상품 페이지 주소', '사진 주소', '판매 페이지 상품명'];
const EXAMPLE = [
  ['오버핏 니트 라벤더', '상의', '여성용', '우리브랜드', '라벤더', 'https://shop.example.com/p/1001', 'https://shop.example.com/img/1001.jpg', '울 블렌드 오버핏 라운드 니트'],
  ['와이드 데님 팬츠', '하의', '공용', '우리브랜드', '인디고', 'https://shop.example.com/p/1002', 'https://shop.example.com/img/1002.jpg', ''],
];
const STATUS_KO = { running: '등록 중', done: '끝남', failed: '멈춤' };

function downloadTemplate() {
  const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = '﻿' + [HEAD, ...EXAMPLE].map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'MAIDOL_상품_등록_양식.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Upload() {
  // 10-20 피드백: 사진 파일을 가진 브랜드도 올릴 수 있게 '사진 파일과 함께' 방법을 추가(기본)
  const [method, setMethod] = useState('files');
  const [file, setFile] = useState(null);
  const [mode, setMode] = useState('append');
  const [activate, setActivate] = useState(true);
  const [check, setCheck] = useState(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [job, setJob] = useState(null);
  const [jobs, setJobs] = useState([]);
  const fileRef = useRef(null);
  const timer = useRef(null);

  const loadJobs = () => listImportJobs().then((r) => {
    const list = r.data?.jobs || [];
    setJobs(list);
    const running = list.find((j) => j.status === 'running');
    if (running) setJob((cur) => cur || running);
  }).catch(() => {});

  useEffect(() => { loadJobs(); return () => clearTimeout(timer.current); }, []);

  // 진행 중인 등록은 2.5초마다 진행률을 다시 읽는다(창을 닫았다 열어도 이어서 보인다).
  useEffect(() => {
    clearTimeout(timer.current);
    if (!job || job.status !== 'running') return undefined;
    timer.current = setTimeout(() => {
      getImportJob(job.job_id).then((r) => {
        setJob(r.data);
        if (r.data.status !== 'running') {
          loadJobs();
          toast(r.data.status === 'done' ? '등록이 끝났어요.' : '등록이 멈췄어요.');
        }
      }).catch(() => setJob((j) => ({ ...j })));
    }, 2500);
    return () => clearTimeout(timer.current);
  }, [job]);

  const pick = (fl) => {
    if (!fl) return;
    if (!/\.(xlsx|csv|txt)$/i.test(fl.name)) { appAlert('엑셀(.xlsx)이나 CSV 파일을 올려 주세요. 예전 엑셀(.xls)은 .xlsx로 다시 저장해 주세요.'); return; }
    if (fl.size > MAX_MB * 1024 * 1024) { appAlert(`파일은 ${MAX_MB}MB까지 올릴 수 있어요. 나눠서 올려 주세요.`); return; }
    setFile(fl);
    setCheck(null);
  };

  const runCheck = async (nextMode = mode) => {
    if (!file) { appAlert('먼저 파일을 골라 주세요.'); return; }
    setBusy(true);
    try {
      const r = await importItems(file, { mode: nextMode, dryRun: true });
      setCheck(r.data);
    } catch (err) {
      setCheck(null);
      appAlert(friendlyError(err, '파일을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.'));
    } finally {
      setBusy(false);
    }
  };

  const changeMode = (m) => { setMode(m); if (check) runCheck(m); };

  const start = async () => {
    if (!check || !check.will_insert) return;
    const lines = [`새 상품 ${check.will_insert.toLocaleString()}개를 등록할까요?`];
    if (mode === 'replace') lines.push(`\n등록이 끝나면 예전에 한꺼번에 올린 상품 ${Number(check.will_replace || 0).toLocaleString()}개는 지워져요. 지운 상품의 성과는 더 볼 수 없어요. 한 개씩 직접 등록한 상품은 그대로 남아요.`);
    if (!activate) lines.push('\n등록한 상품은 숨김 상태로 들어가요. 내 상품에서 켜면 앱에 보여요.');
    const ok = await appConfirm(lines.join('\n'), { okText: '등록 시작', danger: mode === 'replace' });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await importItems(file, { mode, dryRun: false, activate });
      setJob({ job_id: r.data.job_id, status: 'running', total: r.data.will_insert, processed: 0, inserted: 0, skipped_count: 0, mode });
      setFile(null);
      setCheck(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (err) {
      appAlert(friendlyError(err, '등록을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.'));
    } finally {
      setBusy(false);
    }
  };

  const running = job?.status === 'running';

  return (
    <div className="page page--mid">
      <Link to="/items" className="back">← 내 상품</Link>
      <div className="page__head">
        <div>
          <h1>엑셀로 한꺼번에 등록</h1>
          <p className="muted">상품이 많으면 양식에 적어 한 번에 올리세요. 사진은 파일로 함께 올리거나, 사진 주소(인터넷 링크)를 적으면 MAIDOL이 받아 와요.</p>
        </div>
      </div>

      <div className="method-tabs" role="tablist" aria-label="사진 올리는 방법">
        <button role="tab" aria-selected={method === 'files'} className={method === 'files' ? 'is-on' : ''} onClick={() => setMethod('files')}>
          <b>사진 파일과 함께 올리기</b><small>사진이 컴퓨터에 파일로 있을 때 · CSV + 사진 폴더</small>
        </button>
        <button role="tab" aria-selected={method === 'url'} className={method === 'url' ? 'is-on' : ''} onClick={() => setMethod('url')}>
          <b>사진 주소로 올리기</b><small>쇼핑몰 사진 링크가 있을 때 · 엑셀/CSV</small>
        </button>
      </div>

      {method === 'files' ? <PhotoUpload /> : (<>

      {job && (
        <section className="panel">
          <div className="panel__head">
            <h2>{running ? '등록하고 있어요' : job.status === 'done' ? '등록이 끝났어요' : '등록이 멈췄어요'}</h2>
            <span className={`badge badge--${job.status}`}>{STATUS_KO[job.status] || job.status}</span>
          </div>
          <JobProgress job={job} />
          {running && <p className="footnote">이 화면을 닫아도 등록은 계속돼요. 상품이 많으면 몇십 분 걸릴 수 있어요.</p>}
          {!running && <div className="row" style={{ marginTop: 10 }}><Link className="btn btn--sm btn--primary" to="/items">내 상품 보기</Link><button className="btn btn--sm" onClick={() => setJob(null)}>닫기</button></div>}
        </section>
      )}

      <section className="panel steps3">
        <div className="step3">
          <b className="step3__n">1</b>
          <div>
            <h2>양식 받기</h2>
            <p className="muted small">엑셀에서 열어 한 줄에 상품 하나씩 적어 주세요. 다 적으면 그대로(CSV) 저장하거나 엑셀(.xlsx)로 저장해도 돼요.</p>
            <button className="btn btn--sm" onClick={downloadTemplate} style={{ marginTop: 8 }}>양식 받기 (.csv)</button>
            <details className="help">
              <summary>칸마다 무엇을 적나요?</summary>
              <ul>
                <li><b>착장에 보일 이름</b> (필수) — 앱 착장 목록에 보이는 이름. 60자까지.</li>
                <li><b>카테고리</b> (필수) — 상의·하의·신발·모자·가방. ‘니트’, ‘청바지’, ‘운동화’처럼 적어도 알아서 나눠요.</li>
                <li><b>대상</b> — 남성용·여성용·공용. 비우면 공용.</li>
                <li><b>상품 페이지 주소</b> (필수) — 사용자가 누르면 가는 우리 쇼핑몰 주소(https://…).</li>
                <li><b>사진 주소</b> (필수) — 상품 사진이 바로 열리는 주소(https://…jpg 등). JPG·PNG·WEBP·GIF, 10MB까지.</li>
                <li><b>브랜드·색상·판매 페이지 상품명</b> — 있으면 적어 주세요. 세부 종류(아우터·니트·데님 등)는 이름을 보고 자동으로 나눠요.</li>
                <li>무신사·29CM 등에서 받은 파일처럼 제목이 조금 달라도(상품명·이미지URL·상품URL 등) 알아서 맞춰요.</li>
              </ul>
            </details>
          </div>
        </div>

        <div className="step3">
          <b className="step3__n">2</b>
          <div>
            <h2>파일 올리기</h2>
            <div
              className={`dropfile ${drag ? 'is-drag' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => fileRef.current?.click()}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click(); }}
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0]); }}
            >
              {file ? <><b>{file.name}</b><small>{(file.size / 1024).toFixed(0)}KB · 다른 파일로 바꾸려면 누르세요</small></> : <><b>여기에 파일을 끌어 놓거나 눌러서 고르세요</b><small>엑셀(.xlsx) 또는 CSV · {MAX_MB}MB · 한 번에 1만 개까지</small></>}
            </div>
            <input ref={fileRef} type="file" accept=".xlsx,.csv,.txt" hidden onChange={(e) => pick(e.target.files?.[0])} />
            <div className="field" style={{ marginTop: 12 }}>등록 방식
              <div className="chips">
                <button className={`chip ${mode === 'append' ? 'is-on' : ''}`} onClick={() => changeMode('append')}>추가하기</button>
                <button className={`chip ${mode === 'replace' ? 'is-on' : ''}`} onClick={() => changeMode('replace')}>전부 바꾸기</button>
              </div>
              <small className="muted">{mode === 'append' ? '지금 상품은 그대로 두고 새 상품만 더해요. 이미 등록된 상품(같은 주소·색상)은 건너뛰어요.' : '시즌이 바뀔 때처럼 목록을 통째로 바꿀 때 써요. 새 상품을 다 넣은 뒤, 예전에 한꺼번에 올린 상품을 지워요. 한 개씩 직접 등록한 상품은 남아요.'}</small>
            </div>
            <label className="check check--sm"><input type="checkbox" checked={activate} onChange={(e) => setActivate(e.target.checked)} /> 등록하자마자 앱 착장 목록에 보이게 하기</label>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn btn--primary" disabled={!file || busy || running} onClick={() => runCheck()}>{busy && !check ? '확인 중…' : '미리 검사하기'}</button>
              {running && <span className="muted small">지금 등록이 끝나면 새 파일을 올릴 수 있어요.</span>}
            </div>
          </div>
        </div>

        <div className={`step3 ${check ? '' : 'is-dim'}`}>
          <b className="step3__n">3</b>
          <div>
            <h2>검사 결과 확인하고 등록</h2>
            {!check ? (
              <p className="muted small">파일을 올리고 ‘미리 검사하기’를 누르면 몇 개가 등록되는지, 고칠 줄이 있는지 알려 드려요. 이때는 아무것도 저장되지 않아요.</p>
            ) : (
              <CheckResult check={check} mode={mode} busy={busy} onStart={start} />
            )}
          </div>
        </div>
      </section>

      {jobs.filter((j) => j.job_id !== job?.job_id).length > 0 && (
        <section className="panel">
          <h2>지난 등록</h2>
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>시작</th><th>파일</th><th>방식</th><th className="num">등록</th><th className="num">못 함</th><th>상태</th></tr></thead>
              <tbody>
                {jobs.filter((j) => j.job_id !== job?.job_id).map((j) => (
                  <tr key={j.job_id}>
                    <td>{j.started_at ? new Date(j.started_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'}</td>
                    <td className="cell-ellipsis" title={j.filename}>{j.filename || '-'}</td>
                    <td>{j.mode === 'replace' ? '전부 바꾸기' : '추가'}</td>
                    <td className="num">{Number(j.inserted || 0).toLocaleString()}</td>
                    <td className="num">{Number(j.skipped_count || 0).toLocaleString()}</td>
                    <td><button className="linkbtn small" onClick={() => getImportJob(j.job_id).then((r) => setJob(r.data)).catch(() => {})}>{STATUS_KO[j.status] || j.status} · 자세히</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      </>)}
    </div>
  );
}

function CheckResult({ check, mode, busy, onStart }) {
  const cats = Object.entries(check.by_category || {});
  return (
    <div>
      <div className="kpis kpis--3">
        <div className="kpi"><span>새로 등록</span><b>{Number(check.will_insert || 0).toLocaleString()}</b><small>개</small></div>
        <div className="kpi"><span>이미 있어 건너뜀</span><b>{Number(check.duplicates || 0).toLocaleString()}</b><small>같은 주소·색상</small></div>
        <div className={`kpi ${check.error_count ? 'kpi--warn' : ''}`}><span>고칠 줄</span><b>{Number(check.error_count || 0).toLocaleString()}</b><small>이 줄은 빼고 등록돼요</small></div>
      </div>
      {cats.length > 0 && <p className="small muted">{cats.map(([k, v]) => `${k} ${v.toLocaleString()}`).join(' · ')}</p>}
      {mode === 'replace' && <div className="notice">등록이 끝나면 예전에 한꺼번에 올린 상품 <b>{Number(check.will_replace || 0).toLocaleString()}개</b>가 지워져요.</div>}
      {check.error_count > 0 && (
        <div className="errlist">
          <b>고칠 줄 ({check.error_count.toLocaleString()}개)</b>
          <ul>
            {check.errors.slice(0, 30).map((e) => <li key={`${e.line}-${e.error}`}><span>{e.line}번째 줄</span>{e.error}</li>)}
          </ul>
          {check.error_count > 30 && <small className="muted">… 외 {(check.error_count - 30).toLocaleString()}개. 파일을 고쳐 다시 올리면 다시 검사해요.</small>}
        </div>
      )}
      <div className="row" style={{ marginTop: 12 }}>
        <button className={`btn ${mode === 'replace' ? 'btn--danger' : 'btn--primary'}`} disabled={busy || !check.will_insert} onClick={onStart}>
          {busy ? '시작하는 중…' : check.will_insert ? `${check.will_insert.toLocaleString()}개 등록 시작` : '새로 등록할 상품이 없어요'}
        </button>
      </div>
      <p className="footnote">사진 주소에서 사진을 받지 못한 상품은 등록되지 않고, 끝난 뒤 목록으로 알려 드려요.</p>
    </div>
  );
}

function JobProgress({ job }) {
  const total = Number(job.total || 0);
  const done = Number(job.processed || 0);
  const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const skipped = job.skipped || [];
  return (
    <div>
      <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${job.status === 'done' ? 100 : pct}%` }} /></div>
      <p className="small" style={{ marginTop: 8 }}>
        {done.toLocaleString()} / {total.toLocaleString()} 처리 · 등록 <b>{Number(job.inserted || 0).toLocaleString()}</b> · 못 함 {Number(job.skipped_count || 0).toLocaleString()}
        {job.mode === 'replace' && job.status === 'done' ? ` · 예전 상품 ${Number(job.replaced || 0).toLocaleString()}개 지움` : ''}
      </p>
      {job.error && <div className="notice notice--err">{job.error}</div>}
      {skipped.length > 0 && (
        <div className="errlist">
          <b>등록하지 못한 상품</b>
          <ul>{skipped.slice(0, 30).map((s) => <li key={`${s.line}`}><span>{s.line}번째 줄</span>{s.name} — {s.error}</li>)}</ul>
          {Number(job.skipped_count) > 30 && <small className="muted">… 외 {(Number(job.skipped_count) - 30).toLocaleString()}개</small>}
        </div>
      )}
    </div>
  );
}
