// 광고주 사이트 로컬 확인용 모의 API (운영 로그인 없이 화면 점검)
//   node dev/mock_server.mjs   →  BIZ_API_TARGET=http://127.0.0.1:5196 npm run dev
// 로그인: 아무 이메일 + 비밀번호 'temp1234'(임시 비밀번호 흐름) 또는 그 밖의 값(일반 흐름). 'user' 가 들어간 이메일은 일반 사용자.
import http from 'node:http';

const PORT = Number(process.env.MOCK_PORT || 5196);
const CATS = ['상의', '하의', '신발', '모자', '가방'];
const GENDERS = ['남성용', '여성용', '공용'];
const COLORS = ['라벤더', '블랙', '화이트', '네이비', '베이지', '레드'];
const NAMES = ['오버핏 니트', '와이드 데님 팬츠', '레더 스니커즈', '볼캡', '미니 크로스백', '울 코트', '스트라이프 셔츠', '카고 팬츠', '청키 로퍼', '버킷햇'];
let mustChange = false;
let items = Array.from({ length: 57 }, (_, i) => ({
  id: (100000 + i).toString(16).padStart(24, 'a'),
  user_id: 'u1',
  name: `${NAMES[i % NAMES.length]} ${COLORS[i % COLORS.length]}`,
  image_object_name: `ads/u1/mock${i}.png`,
  product_url: `https://shop.example.com/p/${i}`,
  category: CATS[i % CATS.length],
  gender: GENDERS[i % 3],
  brand: '예시브랜드',
  color: COLORS[i % COLORS.length],
  product_name: '',
  is_active: i % 9 !== 4,
  admin_hidden: i === 13,
  created_at: new Date(Date.now() - i * 86400000).toISOString(),
}));
const profile = { id: 'p1', user_id: 'u1', company_name: '예시브랜드', industry: '패션', contact_name: '김담당', contact_phone: '010-0000-0000' };

const rnd = (seed) => { let x = Math.sin(seed) * 10000; return x - Math.floor(x); };
const send = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
const body = (req) => new Promise((r) => { let d = ''; req.on('data', (c) => { d += c; }); req.on('end', () => { try { r(JSON.parse(d || '{}')); } catch { r({ _raw: d }); } }); });
const authed = (req) => String(req.headers.authorization || '').startsWith('Bearer mock');

function dashboard(period) {
  const n = period === 'monthly' ? 30 : 7;
  const days = Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.now() - (n - 1 - i) * 86400000);
    const imp = Math.round(30 + rnd(i + n) * 90 + i * 3);
    const clk = Math.round(imp * (0.04 + rnd(i * 7) * 0.06));
    return { label: `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, impressions: imp, clicks: clk, ctr: +(clk / imp * 100).toFixed(2), users: Math.round(imp * 0.7) };
  });
  const span = period === 'daily' ? days.slice(-1) : days.slice(-(period === 'monthly' ? 30 : 7));
  const ti = span.reduce((s, d) => s + d.impressions, 0);
  const tc = span.reduce((s, d) => s + d.clicks, 0);
  const rows = items.map((it, i) => {
    const imp = Math.round(rnd(i + 3) * ti / 8);
    const clk = Math.round(imp * rnd(i + 11) * 0.12);
    return { item_id: it.id, name: it.name, image_object_name: it.image_object_name, product_url: it.product_url, impressions: imp, clicks: clk, ctr: imp ? +(clk / imp * 100).toFixed(2) : 0, wish_count: Math.round(rnd(i + 5) * 40), worn_count: Math.round(rnd(i + 9) * 9), category: it.category, is_active: it.is_active, admin_hidden: it.admin_hidden };
  }).sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
  return { category: null, verified_only: false, total_impressions: ti, total_clicks: tc, ctr: ti ? +(tc / ti * 100).toFixed(2) : 0, items: rows, total_users: 0, chart_data: days, total_wishes: rows.reduce((s, r) => s + r.wish_count, 0), total_worn: rows.reduce((s, r) => s + r.worn_count, 0), item_total: rows.length };
}

function svg(seed) {
  const hue = Math.round(rnd(seed) * 360);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320"><rect width="320" height="320" fill="hsl(${hue},60%,88%)"/><rect x="90" y="70" width="140" height="180" rx="26" fill="hsl(${hue},55%,55%)"/></svg>`;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const m = req.method;
  await new Promise((r) => setTimeout(r, 250)); // 실제처럼 약간 늦게
  if (p.startsWith('/api/business/items/image/')) {
    if (p.includes('/thumb320/') && p.includes('mock1')) { res.writeHead(404); res.end(); return; } // 썸네일 없는 경우 원본 폴백 확인
    res.writeHead(200, { 'Content-Type': 'image/svg+xml' }); res.end(svg(p.length + (p.match(/\d+/g) || [0]).join('').length)); return;
  }
  if (p === '/api/auth/login' && m === 'POST') {
    const b = await body(req);
    if (b.password === 'wrong') return send(res, 401, { error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
    mustChange = b.password === 'temp1234';
    const role = String(b.email).includes('user') ? 'user' : 'customer';
    return send(res, 200, { token: 'mock-token', user: { id: 'u1', email: b.email, nickname: '예시브랜드', role } });
  }
  if (p.startsWith('/api/auth/password-reset/')) {
    const b = await body(req);
    if (p.endsWith('confirm') && b.code !== '123456') return send(res, 400, { error: '코드가 올바르지 않거나 만료되었습니다.' });
    return send(res, 200, { message: 'ok' });
  }
  if (p === '/api/business/inquiries' && m === 'POST') {
    const b = await body(req);
    if (String(b.message).includes('429')) return send(res, 429, { error: '문의가 너무 자주 접수됐어요. 잠시 후 다시 보내 주세요.' });
    if (String(b.message).includes('500')) return send(res, 500, { error: '서버 내부 오류가 발생했습니다.' });
    return send(res, 201, { ok: true });
  }
  if (!authed(req)) return send(res, 401, { detail: '세션이 만료되었습니다.' });
  if (p === '/api/business/session/refresh') return send(res, 200, { token: 'mock-token', user: { id: 'u1', email: 'brand@example.com', nickname: '예시브랜드', role: 'customer' } });
  if (p === '/api/business/profile') {
    if (m === 'PUT') Object.assign(profile, await body(req));
    return send(res, 200, { ...profile, ...(mustChange ? { must_change_password: true } : {}) });
  }
  if (p === '/api/business/password') {
    const b = await body(req);
    if (b.current_password !== 'temp1234' && b.current_password !== 'pass1234') return send(res, 400, { error: '현재 비밀번호가 맞지 않아요.' });
    mustChange = false;
    return send(res, 200, { message: '비밀번호를 바꿨어요.' });
  }
  if (p === '/api/business/dashboard') return send(res, 200, dashboard(url.searchParams.get('period')));
  if (p === '/api/business/ads' && m === 'GET') {
    const page = Number(url.searchParams.get('page') || 1); const limit = Number(url.searchParams.get('limit') || 40);
    const q = url.searchParams.get('q') || ''; const cat = url.searchParams.get('category'); const st = url.searchParams.get('status');
    let list = items.filter((it) => (!q || it.name.includes(q) || it.brand.includes(q)) && (!cat || it.category === cat));
    if (st === 'active') list = list.filter((it) => it.is_active && !it.admin_hidden);
    if (st === 'inactive') list = list.filter((it) => !it.is_active);
    if (st === 'hidden') list = list.filter((it) => it.admin_hidden);
    return send(res, 200, { items: list.slice((page - 1) * limit, page * limit), total: list.length, page, limit, counts: { all: items.length, active: items.filter((i) => i.is_active && !i.admin_hidden).length, hidden: items.filter((i) => i.admin_hidden).length } });
  }
  if (p === '/api/business/ads' && m === 'POST') {
    await body(req);
    const it = { ...items[0], id: Date.now().toString(16).padStart(24, 'b'), name: '새 상품', created_at: new Date().toISOString(), is_active: true, admin_hidden: false };
    items = [it, ...items];
    return send(res, 201, it);
  }
  let mm = p.match(/^\/api\/business\/ads\/item\/(\w+)$/);
  if (mm) { const it = items.find((i) => i.id === mm[1]); return it ? send(res, 200, it) : send(res, 404, { error: '아이템을 찾을 수 없습니다.' }); }
  mm = p.match(/^\/api\/business\/ads\/(\w+)\/toggle$/);
  if (mm) { const it = items.find((i) => i.id === mm[1]); it.is_active = !it.is_active; return send(res, 200, { is_active: it.is_active }); }
  mm = p.match(/^\/api\/business\/ads\/(\w+)\/insights$/);
  if (mm) {
    const s = mm[1].length + (url.searchParams.get('period') || '').length;
    return send(res, 200, {
      period: url.searchParams.get('period'), wish_to_click: { wishes: 71, clicks: 38, rate: 0.5352 },
      by_genre: [{ key: 'K-POP', wishes: 25, clicks: 16 }, { key: '발라드', wishes: 14, clicks: 8 }, { key: 'R&B', wishes: 9, clicks: 5 }, { key: '미귀속', wishes: 6, clicks: 4 }],
      by_mood: [{ key: '밝은', wishes: 20, clicks: 12 }, { key: '감성', wishes: 15, clicks: 9 }, { key: '신나는', wishes: 9, clicks: 6 }],
      by_hour: Array.from({ length: 24 }, (_, h) => ({ hour: h, count: Math.round(Math.max(0, Math.sin((h - 6) / 24 * Math.PI * 2) * 6 + 5 + rnd(h + s) * 3)) })),
      by_weekday: Array.from({ length: 7 }, (_, d) => ({ weekday: d, count: Math.round(8 + rnd(d + s) * 10) })),
      demographics: { age_bands: [{ band: '20대', count: 38 }, { band: '10대', count: 29 }, { band: '30대', count: 12 }, { band: '기타(소수)', count: 6 }], genders: [{ key: 'female', count: 52 }, { key: 'male', count: 27 }, { key: '기타(소수)', count: 4 }], regions: [{ key: '서울', count: 31 }, { key: '경기', count: 22 }, { key: '미입력', count: 18 }], nationalities: [{ key: 'domestic', count: 70 }, { key: '미입력', count: 12 }], min_bucket: 5 },
    });
  }
  mm = p.match(/^\/api\/business\/ads\/(\w+)\/stars$/);
  if (mm) return send(res, 200, { stars: [{ user_id: 'a', nickname: '별빛소녀', worn_count: 4, wish_count: 18, click_count: 11, follower_count: 120 }, { user_id: 'b', nickname: '루나', worn_count: 3, wish_count: 9, click_count: 7, follower_count: 64 }, { user_id: 'c', nickname: '하늘연', worn_count: 2, wish_count: 6, click_count: 3, follower_count: 12 }], untracked_clicks: 5 });
  mm = p.match(/^\/api\/business\/ads\/(\w+)$/);
  if (mm && m === 'PUT') { await body(req); const it = items.find((i) => i.id === mm[1]); return send(res, 200, it); }
  if (mm && m === 'DELETE') { items = items.filter((i) => i.id !== mm[1]); return send(res, 200, { message: 'ok' }); }
  send(res, 404, { error: 'not found' });
}).listen(PORT, '127.0.0.1', () => console.log(`mock business api on ${PORT}`));
