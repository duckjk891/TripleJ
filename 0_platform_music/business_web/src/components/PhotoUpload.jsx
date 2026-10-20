import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { createItem, toggleItem, listItems, friendlyError, CATEGORIES } from '../api';
import { appAlert, appConfirm, toast } from './dialog';
import { isDemo, DEMO_SAVE_MSG } from '../demo/demoApi';

// 사진 파일과 함께 올리기(10-20 피드백) — CSV 의 '사진 파일명' 칸과 고른 사진 파일을 이름으로 짝지어
// 상품을 한 개씩 등록한다(기존 POST /api/business/ads — 한 장 10MB, 썸네일도 서버가 만든다).
// 검사는 모두 이 브라우저에서 하고(아무것도 저장 안 함), 등록 중에는 창을 열어 둬야 한다.

const MAX_IMG_MB = 10;
const MAX_ROWS = 3000;
const PARALLEL = 3;
const IMG_RX = /\.(jpe?g|png|webp|gif)$/i;
const IMG_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
const HEAD = ['착장에 보일 이름', '카테고리', '대상', '브랜드', '색상', '상품 페이지 주소', '사진 파일명', '판매 페이지 상품명'];
const EXAMPLE = [
  ['오버핏 니트 라벤더', '상의', '여성용', '우리브랜드', '라벤더', 'https://shop.example.com/p/1001', '1001.jpg', '울 블렌드 오버핏 라운드 니트'],
  ['와이드 데님 팬츠', '하의', '공용', '우리브랜드', '인디고', 'https://shop.example.com/p/1002', '1002.png', ''],
];
const ALIAS = {
  name: ['착장에보일이름', '이름', '상품명', '아이템명', '상품이름'],
  cat: ['카테고리', '분류', '부위', '구분', '종류'],
  gender: ['대상', '성별'],
  brand: ['브랜드', '브랜드명'],
  color: ['색상', '컬러', '색'],
  url: ['상품페이지주소', '상품url', '디테일페이지url', '상품링크', '상품주소', 'url', '링크'],
  file: ['사진파일명', '사진파일', '이미지파일명', '이미지파일', '파일명', '사진', '이미지', '사진이름'],
  pname: ['판매페이지상품명', '정식상품명'],
  imgurl: ['사진주소', '이미지url', '이미지주소', '사진url'],
};
const CATWORDS = [
  ['상의', /상의|니트|셔츠|티셔츠|코트|재킷|자켓|후드|맨투맨|아우터|가디건|블라우스|원피스|패딩|점퍼|스웨터|탑/],
  ['하의', /하의|팬츠|바지|데님|청바지|슬랙스|스커트|치마|쇼츠|반바지|조거/],
  ['신발', /신발|스니커즈|운동화|부츠|로퍼|구두|샌들|슬리퍼|슈즈/],
  ['모자', /모자|캡|비니|햇|베레/],
  ['가방', /가방|백|파우치|토트|클러치/],
];

const normHead = (h) => String(h || '').replace(/^﻿/, '').replace(/[\s*()[\]_\-·]|필수|선택/g, '').toLowerCase();
const fileKey = (n) => String(n || '').trim().split(/[\\/]/).pop().toLowerCase();
const stemKey = (n) => fileKey(n).replace(/\.[a-z0-9]+$/, '');

function parseCsv(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const delim = !firstLine.includes(',') && firstLine.includes('\t') ? '\t' : ',';
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim()));
}

// 엑셀에서 'CSV(쉼표로 분리)'로 저장하면 한글이 EUC-KR 이라 UTF-8 로 먼저 읽고 안 되면 EUC-KR 로 다시 읽는다
async function readText(file) {
  const buf = await file.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return new TextDecoder('euc-kr').decode(buf); }
}

// 폴더를 끌어 놓았을 때 안의 파일을 모두 꺼낸다(하위 폴더 포함)
async function filesFromDrop(dt) {
  const items = [...(dt.items || [])];
  const entries = items.map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null)).filter(Boolean);
  if (!entries.length) return [...(dt.files || [])];
  const out = [];
  const walk = (entry) => new Promise((resolve) => {
    if (entry.isFile) { entry.file((f) => { out.push(f); resolve(); }, () => resolve()); return; }
    if (!entry.isDirectory) { resolve(); return; }
    const reader = entry.createReader();
    const readAll = () => reader.readEntries(async (batch) => {
      if (!batch.length) { resolve(); return; }
      for (const e of batch) await walk(e); // eslint-disable-line no-await-in-loop
      readAll();
    }, () => resolve());
    readAll();
  });
  for (const e of entries) await walk(e); // eslint-disable-line no-await-in-loop
  return out;
}

function downloadTemplate() {
  const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = '﻿' + [HEAD, ...EXAMPLE].map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'MAIDOL_상품_등록_양식_사진파일.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function existingKeys() {
  const keys = new Set();
  for (let page = 1; page <= 60; page += 1) {
    const r = await listItems({ page, limit: 100 }); // eslint-disable-line no-await-in-loop
    (r.data?.items || []).forEach((it) => keys.add(`${it.product_url || ''}|${(it.color || '').trim()}`));
    if (!r.data?.items?.length || page * 100 >= (r.data?.total || 0)) break;
  }
  return keys;
}

export default function PhotoUpload() {
  const [csv, setCsv] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [activate, setActivate] = useState(true);
  const [check, setCheck] = useState(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [run, setRun] = useState(null); // { total, done, ok, failed: [], stopped }
  const csvRef = useRef(null);
  const dirRef = useRef(null);
  const multiRef = useRef(null);
  const stopRef = useRef(false);

  const uploading = run && !run.finished;
  useEffect(() => {
    if (!uploading) return undefined;
    const onLeave = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [uploading]);

  const takeFiles = (list) => {
    const files = [...list];
    const csvs = files.filter((f) => /\.(csv|txt)$/i.test(f.name));
    const imgs = files.filter((f) => IMG_RX.test(f.name));
    const xlsx = files.find((f) => /\.xlsx?$/i.test(f.name));
    if (csvs.length) setCsv(csvs[0]);
    if (imgs.length) setPhotos((prev) => {
      const m = new Map(prev.map((p) => [fileKey(p.name), p]));
      imgs.forEach((f) => m.set(fileKey(f.name), f));
      return [...m.values()];
    });
    setCheck(null);
    if (xlsx && !csvs.length) appAlert('사진 파일과 함께 올릴 때는 CSV 파일을 써 주세요. 엑셀에서 [다른 이름으로 저장 → CSV UTF-8(쉼표로 분리)]로 저장하면 돼요.');
    else if (!csvs.length && !imgs.length) appAlert('CSV 파일이나 사진(JPG·PNG·WEBP·GIF)을 골라 주세요.');
  };

  const runCheck = async () => {
    if (!csv) { appAlert('상품 정보를 적은 CSV 파일을 골라 주세요.'); return; }
    if (!photos.length) { appAlert('사진 파일을 골라 주세요. 사진이 든 폴더를 통째로 고르거나 끌어 놓아도 돼요.'); return; }
    setBusy(true);
    try {
      const table = parseCsv(await readText(csv));
      if (table.length < 2) { appAlert('CSV에 상품 줄이 없어요. 첫 줄은 제목, 둘째 줄부터 상품 하나씩 적어 주세요.'); return; }
      const head = table[0].map((h) => {
        const n = normHead(h);
        return Object.keys(ALIAS).find((k) => ALIAS[k].includes(n)) || null;
      });
      if (!head.includes('file')) {
        appAlert(head.includes('imgurl')
          ? "이 파일에는 '사진 파일명' 칸이 없고 '사진 주소' 칸이 있어요. 사진 주소로 올리려면 위의 '사진 주소로 올리기'를 써 주세요."
          : "'사진 파일명' 칸을 찾지 못했어요. 양식을 받아 그 제목 그대로 써 주세요.");
        return;
      }
      const byName = new Map(photos.map((p) => [fileKey(p.name), p]));
      const byStem = new Map(photos.map((p) => [stemKey(p.name), p]));
      let have = new Set();
      try { have = await existingKeys(); } catch { /* 중복 확인 실패 — 그대로 진행 */ }
      const rows = []; const errors = []; const used = new Set(); const seen = new Set(); let dup = 0;
      table.slice(1, MAX_ROWS + 1).forEach((cells, k) => {
        const line = k + 2; const r = {};
        head.forEach((h, i) => { if (h && r[h] == null) r[h] = String(cells[i] ?? '').trim(); });
        const catRaw = r.cat || '';
        const cat = CATEGORIES.includes(catRaw) ? catRaw : (CATWORDS.find(([, rx]) => rx.test(catRaw)) || [])[0];
        if (!r.name) { errors.push({ line, error: '착장에 보일 이름이 비어 있어요.' }); return; }
        if (!cat) { errors.push({ line, error: `카테고리 '${catRaw.slice(0, 20)}'를 알 수 없어요. 상의·하의·신발·모자·가방 중 하나로 적어 주세요.` }); return; }
        if (!/^https?:\/\/\S+\.\S+/.test(r.url || '')) { errors.push({ line, error: '상품 페이지 주소가 없거나 https:// 로 시작하지 않아요.' }); return; }
        if (!r.file) { errors.push({ line, error: '사진 파일명이 비어 있어요.' }); return; }
        const img = byName.get(fileKey(r.file)) || byStem.get(stemKey(r.file));
        if (!img) { errors.push({ line, error: `사진 '${fileKey(r.file).slice(0, 40)}'을(를) 고른 사진들 중에서 찾지 못했어요.` }); return; }
        if (img.size > MAX_IMG_MB * 1024 * 1024) { errors.push({ line, error: `사진 '${img.name}'이 ${MAX_IMG_MB}MB보다 커요. 줄여서 다시 골라 주세요.` }); return; }
        const key = `${r.url}|${r.color || ''}`;
        if (have.has(key) || seen.has(key)) { dup += 1; return; }
        seen.add(key);
        used.add(fileKey(img.name));
        const gender = /남/.test(r.gender || '') ? '남성용' : /여/.test(r.gender || '') ? '여성용' : '공용';
        rows.push({ line, name: r.name.slice(0, 60), cat, gender, brand: (r.brand || '').slice(0, 60), color: (r.color || '').slice(0, 30), url: r.url, pname: (r.pname || '').slice(0, 120), img });
      });
      const by = {};
      rows.forEach((x) => { by[x.cat] = (by[x.cat] || 0) + 1; });
      setCheck({ rows, errors, dup, by, total: Math.min(table.length - 1, MAX_ROWS), cut: table.length - 1 > MAX_ROWS, unused: photos.filter((p) => !used.has(fileKey(p.name))).length });
    } catch {
      appAlert('파일을 읽지 못했어요. CSV 파일이 맞는지 확인해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    if (!check?.rows.length) return;
    if (isDemo()) { appAlert(DEMO_SAVE_MSG); return; }
    const ok = await appConfirm(`새 상품 ${check.rows.length.toLocaleString()}개를 등록할까요?\n사진을 이 컴퓨터에서 하나씩 올리니, 끝날 때까지 이 창을 닫지 말아 주세요.${activate ? '' : '\n등록한 상품은 숨김 상태로 들어가요.'}`, { okText: '등록 시작' });
    if (!ok) return;
    stopRef.current = false;
    const queue = [...check.rows];
    const state = { total: queue.length, done: 0, ok: 0, failed: [], finished: false };
    setRun({ ...state });
    let halted = '';
    const worker = async () => {
      while (queue.length && !stopRef.current && !halted) {
        const r = queue.shift();
        const fd = new FormData();
        const ext = (r.img.name.split('.').pop() || '').toLowerCase();
        const blob = r.img.type ? r.img : new File([r.img], r.img.name, { type: IMG_TYPES[ext] || 'image/jpeg' });
        fd.append('image', blob, r.img.name);
        fd.append('name', r.name);
        fd.append('product_url', r.url);
        fd.append('category', r.cat);
        fd.append('gender', r.gender);
        if (r.brand) fd.append('brand', r.brand);
        if (r.color) fd.append('color', r.color);
        if (r.pname) fd.append('product_name', r.pname);
        try {
          const res = await createItem(fd); // eslint-disable-line no-await-in-loop
          if (!activate && res.data?.id) await toggleItem(res.data.id).catch(() => {}); // eslint-disable-line no-await-in-loop
          state.ok += 1;
        } catch (err) {
          const st = err?.response?.status;
          if (st === 401 || st === 403) halted = friendlyError(err, '로그인이 끝나서 등록을 멈췄어요. 다시 로그인한 뒤 남은 줄만 올려 주세요.');
          state.failed.push({ line: r.line, name: r.name, error: friendlyError(err, '등록하지 못했어요.') });
        }
        state.done += 1;
        setRun({ ...state, failed: [...state.failed] });
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    state.finished = true;
    state.stopped = stopRef.current || Boolean(halted);
    setRun({ ...state, failed: [...state.failed], halted });
    setCheck(null);
    toast(state.stopped ? '등록을 멈췄어요.' : '등록이 끝났어요.');
  };

  const pct = run?.total ? Math.round((run.done / run.total) * 100) : 0;

  return (
    <>
      {run && (
        <section className="panel">
          <div className="panel__head">
            <h2>{!run.finished ? '사진을 올리며 등록하고 있어요' : run.stopped ? '등록을 멈췄어요' : '등록이 끝났어요'}</h2>
            {!run.finished && <button className="btn btn--sm" onClick={() => { stopRef.current = true; }}>멈추기</button>}
          </div>
          <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${run.finished && !run.stopped ? 100 : pct}%` }} /></div>
          <p className="small" style={{ marginTop: 8 }}>{run.done.toLocaleString()} / {run.total.toLocaleString()} 처리 · 등록 <b>{run.ok.toLocaleString()}</b> · 못 함 {run.failed.length.toLocaleString()}</p>
          {!run.finished && <p className="footnote">이 컴퓨터에서 사진을 올리는 중이에요. 끝날 때까지 이 창을 닫거나 다른 주소로 옮기지 말아 주세요.</p>}
          {run.halted && <div className="notice notice--err">{run.halted}</div>}
          {run.failed.length > 0 && (
            <div className="errlist">
              <b>등록하지 못한 상품</b>
              <ul>{run.failed.slice(0, 50).map((f) => <li key={`${f.line}`}><span>{f.line}번째 줄</span>{f.name} — {f.error}</li>)}</ul>
            </div>
          )}
          {run.finished && <div className="row" style={{ marginTop: 10 }}><Link className="btn btn--sm btn--primary" to="/items">내 상품 보기</Link><button className="btn btn--sm" onClick={() => setRun(null)}>닫기</button></div>}
        </section>
      )}

      <section className="panel steps3">
        <div className="step3">
          <b className="step3__n">1</b>
          <div>
            <h2>양식 받기</h2>
            <p className="muted small">한 줄에 상품 하나씩 적고, <b>사진 파일명</b> 칸에 그 상품 사진의 파일 이름(예: 1001.jpg)을 적어 주세요. 엑셀에서 적었다면 <b>CSV UTF-8(쉼표로 분리)</b>로 저장해 주세요.</p>
            <button className="btn btn--sm" onClick={downloadTemplate} style={{ marginTop: 8 }}>양식 받기 (사진 파일명 .csv)</button>
            <details className="help">
              <summary>사진은 어떻게 준비하나요?</summary>
              <ul>
                <li>상품 사진을 한 폴더에 모으고, CSV의 <b>사진 파일명</b>과 같은 이름으로 저장해 주세요. 대·소문자는 달라도 되고, 확장자(.jpg)를 빼고 적어도 찾아요.</li>
                <li>CSV 파일도 같은 폴더에 넣고 <b>폴더째 끌어 놓으면</b> 한 번에 골라져요.</li>
                <li>사진은 JPG·PNG·WEBP·GIF, 한 장 {MAX_IMG_MB}MB까지. 한 번에 {MAX_ROWS.toLocaleString()}줄까지.</li>
                <li>나머지 칸(이름·카테고리·대상·상품 페이지 주소 등)은 ‘사진 주소로 올리기’ 양식과 같아요.</li>
              </ul>
            </details>
          </div>
        </div>

        <div className="step3">
          <b className="step3__n">2</b>
          <div>
            <h2>CSV와 사진 고르기</h2>
            <div
              className={`dropfile ${drag ? 'is-drag' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => dirRef.current?.click()}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') dirRef.current?.click(); }}
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={async (e) => { e.preventDefault(); setDrag(false); takeFiles(await filesFromDrop(e.dataTransfer)); }}
            >
              <b>CSV와 사진이 든 폴더를 여기에 끌어 놓거나 눌러서 폴더를 고르세요</b>
              <small>CSV {csv ? `· ${csv.name}` : '없음'} · 사진 {photos.length.toLocaleString()}장</small>
            </div>
            <input ref={dirRef} type="file" hidden webkitdirectory="" directory="" multiple onChange={(e) => { takeFiles(e.target.files || []); e.target.value = ''; }} />
            <input ref={csvRef} type="file" hidden accept=".csv,.txt" onChange={(e) => { takeFiles(e.target.files || []); e.target.value = ''; }} />
            <input ref={multiRef} type="file" hidden multiple accept="image/jpeg,image/png,image/webp,image/gif" onChange={(e) => { takeFiles(e.target.files || []); e.target.value = ''; }} />
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn btn--sm btn--ghost" onClick={() => csvRef.current?.click()}>CSV만 고르기</button>
              <button className="btn btn--sm btn--ghost" onClick={() => multiRef.current?.click()}>사진 여러 장 고르기</button>
              {(csv || photos.length > 0) && <button className="btn btn--sm btn--ghost" onClick={() => { setCsv(null); setPhotos([]); setCheck(null); }}>다시 고르기</button>}
            </div>
            <label className="check check--sm" style={{ marginTop: 10 }}><input type="checkbox" checked={activate} onChange={(e) => setActivate(e.target.checked)} /> 등록하자마자 앱 착장 목록에 보이게 하기</label>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn btn--primary" disabled={!csv || !photos.length || busy || uploading} onClick={runCheck}>{busy ? '확인 중…' : '미리 검사하기'}</button>
              <span className="muted small">검사할 때는 아무것도 저장되지 않아요.</span>
            </div>
          </div>
        </div>

        <div className={`step3 ${check ? '' : 'is-dim'}`}>
          <b className="step3__n">3</b>
          <div>
            <h2>검사 결과 확인하고 등록</h2>
            {!check ? (
              <p className="muted small">CSV의 줄마다 사진을 찾아 짝을 맞춰 보고, 몇 개가 등록되는지·고칠 줄이 있는지 알려 드려요.</p>
            ) : (
              <div>
                <div className="kpis kpis--3">
                  <div className="kpi"><span>새로 등록</span><b>{check.rows.length.toLocaleString()}</b><small>개 (사진 짝 맞음)</small></div>
                  <div className="kpi"><span>이미 있어 건너뜀</span><b>{check.dup.toLocaleString()}</b><small>같은 주소·색상</small></div>
                  <div className={`kpi ${check.errors.length ? 'kpi--warn' : ''}`}><span>고칠 줄</span><b>{check.errors.length.toLocaleString()}</b><small>이 줄은 빼고 등록돼요</small></div>
                </div>
                <p className="small muted">{Object.entries(check.by).map(([k, v]) => `${k} ${v.toLocaleString()}`).join(' · ')}{check.unused ? ` · CSV에 없는 사진 ${check.unused.toLocaleString()}장은 쓰지 않아요` : ''}</p>
                {check.cut && <div className="notice">한 번에 {MAX_ROWS.toLocaleString()}줄까지만 올려요. 나머지는 파일을 나눠 다시 올려 주세요.</div>}
                {check.errors.length > 0 && (
                  <div className="errlist">
                    <b>고칠 줄 ({check.errors.length.toLocaleString()}개)</b>
                    <ul>{check.errors.slice(0, 50).map((e) => <li key={`${e.line}-${e.error}`}><span>{e.line}번째 줄</span>{e.error}</li>)}</ul>
                  </div>
                )}
                <div className="row" style={{ marginTop: 12 }}>
                  <button className="btn btn--primary" disabled={uploading || !check.rows.length} onClick={start}>{check.rows.length ? `${check.rows.length.toLocaleString()}개 등록 시작` : '새로 등록할 상품이 없어요'}</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
