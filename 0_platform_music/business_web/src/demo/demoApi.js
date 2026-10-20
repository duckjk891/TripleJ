// 예시 화면(로그인 없이 둘러보기) — 서버 대신 브라우저 안에서 지어낸 데이터를 돌려준다.
// 입점을 고민하는 브랜드가 광고주 화면을 미리 볼 수 있게 하는 용도. 운영 서버·DB 를 전혀 부르지 않고,
// 저장·수정·삭제는 모두 "예시 화면에서는 저장되지 않아요"로 거절한다.
// 상품은 실제 브랜드가 아닌 '예시 브랜드' 그림 상품(실제 상품 사진·이름을 쓰지 않는다).

const DEMO_KEY = 'maidol_biz_demo';
const safe = (fn, fb = null) => { try { return fn(); } catch { return fb; } };
export const isDemo = () => safe(() => window.sessionStorage.getItem(DEMO_KEY)) === '1';
export const enterDemo = () => safe(() => window.sessionStorage.setItem(DEMO_KEY, '1'));
export const exitDemo = () => safe(() => window.sessionStorage.removeItem(DEMO_KEY));

export const DEMO_USER = { id: 'demo', email: 'demo@maidol.ai.kr', nickname: '예시 브랜드', role: 'customer' };
export const DEMO_SAVE_MSG = '예시 화면에서는 저장되지 않아요. 입점 문의를 남겨 주시면 광고주 계정을 만들어 드려요.';

// ---- 결정적 난수(새로고침해도 같은 숫자) ----
const rnd = (seed) => { const x = Math.sin(seed * 9301 + 49297) * 233280; return x - Math.floor(x); };

// ---- 그림 상품 사진(SVG) ----
const COLOR_HEX = {
  블랙: '#2b2b33', 화이트: '#f4f1ea', 그레이: '#9a9aa5', 네이비: '#2c3a63', 베이지: '#d9c7a7',
  브라운: '#8a5a3b', 라벤더: '#b9a3e8', 레드: '#d65252', 카키: '#7a7f52', 스카이블루: '#8fc1e8', 크림: '#efe4cc',
};
const SHAPES = {
  상의: '<path d="M110 70 L140 58 Q160 74 180 58 L210 70 L250 100 L228 132 L210 120 L210 250 L110 250 L110 120 L92 132 L70 100 Z"/>',
  하의: '<path d="M115 62 H205 L214 250 H172 L160 128 L148 250 H106 Z"/>',
  신발: '<path d="M70 190 Q72 150 110 150 L150 152 Q170 170 205 176 Q250 182 252 210 L252 222 H70 Z"/><rect x="70" y="222" width="182" height="12" rx="6" opacity=".55"/>',
  모자: '<path d="M90 180 Q92 98 160 96 Q228 98 230 180 Z"/><path d="M80 180 H270 Q270 196 230 198 H80 Z" opacity=".8"/>',
  가방: '<path d="M125 120 Q125 78 160 78 Q195 78 195 120" fill="none" stroke-width="12" stroke="currentColor"/><rect x="88" y="118" width="144" height="128" rx="18"/>',
};
const imgCache = {};
function demoImage(category, color) {
  const k = `${category}|${color}`;
  if (!imgCache[k]) {
    const fill = COLOR_HEX[color] || '#b9a3e8';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320"><rect width="320" height="320" fill="#f6f4fb"/><g fill="${fill}" color="${fill}" stroke="rgba(0,0,0,.12)" stroke-width="2">${SHAPES[category] || SHAPES.상의}</g><text x="160" y="296" text-anchor="middle" font-family="sans-serif" font-size="13" fill="#9a94b8">예시 상품</text></svg>`;
    imgCache[k] = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }
  return imgCache[k];
}

// ---- 상품 ----
const CATALOG = [
  ['상의', '니트', ['오버핏 크루넥 니트', '케이블 라운드 니트', '하이넥 골지 니트']],
  ['상의', '아우터', ['울 블렌드 싱글 코트', '숏 다운 패딩', '코튼 워크 재킷']],
  ['상의', '맨투맨', ['헤비 코튼 맨투맨', '레터링 스웨트셔츠']],
  ['상의', '후드', ['오버사이즈 후드', '투웨이 후드 집업']],
  ['상의', '셔츠/블라우스', ['옥스퍼드 오버셔츠', '스트라이프 셔츠']],
  ['상의', '티셔츠', ['베이직 반팔 티셔츠', '크롭 롱슬리브']],
  ['하의', '데님', ['와이드 데님 팬츠', '스트레이트 데님']],
  ['하의', '슬랙스', ['투턱 와이드 슬랙스', '세미 부츠컷 슬랙스']],
  ['하의', '카고/와이드', ['나일론 카고 팬츠', '파라슈트 팬츠']],
  ['하의', '스커트', ['플리츠 미니 스커트', '데님 롱 스커트']],
  ['신발', '스니커즈', ['레더 로우 스니커즈', '청키 러닝화', '캔버스 하이탑']],
  ['신발', '로퍼/구두', ['페니 로퍼', '메리제인 슈즈']],
  ['신발', '부츠', ['첼시 부츠']],
  ['모자', '볼캡', ['워싱 볼캡', '자수 로고 볼캡']],
  ['모자', '비니', ['골지 비니']],
  ['모자', '버킷햇', ['나일론 버킷햇']],
  ['가방', '크로스백', ['미니 크로스백', '나일론 메신저백']],
  ['가방', '숄더백', ['호보 숄더백']],
  ['가방', '백팩', ['데일리 백팩']],
];
const COLORS = ['블랙', '화이트', '그레이', '네이비', '베이지', '브라운', '라벤더', '레드', '카키', '스카이블루', '크림'];
const GENDER_BY = ['공용', '여성용', '남성용'];

const ITEMS = (() => {
  const out = [];
  let i = 0;
  CATALOG.forEach(([category, sub, names]) => {
    names.forEach((base) => {
      const color = COLORS[(i * 7) % COLORS.length];
      const pop = Math.min(0.98, 0.15 + rnd(i + 1) * 0.85);
      out.push({
        id: `d${String(1000 + i)}`.padEnd(24, '0'),
        user_id: 'demo',
        name: `${base} ${color}`,
        image_object_name: demoImage(category, color),
        product_url: 'https://maidol.ai.kr',
        category, sub_category: sub, gender: GENDER_BY[i % 3], brand: '예시 브랜드', color, color_family: color,
        product_name: '', is_active: i % 11 !== 5, admin_hidden: false, pop,
        created_at: new Date(Date.now() - (i * 2 + 1) * 86400000).toISOString(),
      });
      i += 1;
    });
  });
  return out;
})();

const PERIOD_MUL = { daily: 0.06, weekly: 0.32, monthly: 1 };
function statsOf(it, period = 'monthly') {
  const i = ITEMS.indexOf(it) + 1;
  const mul = PERIOD_MUL[period] || 1;
  const imp = Math.round((120 + it.pop * 1400 + rnd(i * 3) * 160) * mul * (it.is_active ? 1 : 0.15));
  const clk = Math.round(imp * (0.035 + it.pop * 0.07 + rnd(i * 7) * 0.02));
  const wishes = Math.round((18 + it.pop * 260 + rnd(i * 11) * 30) * (period === 'monthly' ? 1 : 1));
  return { impressions: imp, clicks: clk, wishes, ctr: imp ? +((clk / imp) * 100).toFixed(2) : 0 };
}
const wornOf = (it) => Math.round(it.pop * 14 + rnd(ITEMS.indexOf(it) + 9) * 3);

const pad2 = (n) => String(n).padStart(2, '0');
function dashboard(period) {
  const n = period === 'monthly' ? 30 : 7;
  const base = ITEMS.reduce((s, it) => s + statsOf(it, 'monthly').impressions, 0) / 30;
  const days = Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.now() - (n - 1 - i) * 86400000);
    const wk = [0.9, 0.85, 0.95, 1, 1.15, 1.35, 1.25][d.getDay()];
    const imp = Math.round(base * wk * (0.8 + rnd(i + n) * 0.35) * (1 + i / (n * 3)));
    const clk = Math.round(imp * (0.07 + rnd(i * 7) * 0.025));
    return { label: `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`, impressions: imp, clicks: clk, ctr: +((clk / imp) * 100).toFixed(2), users: Math.round(imp * 0.7) };
  });
  const span = period === 'daily' ? days.slice(-1) : days;
  const ti = span.reduce((s, d) => s + d.impressions, 0);
  const tc = span.reduce((s, d) => s + d.clicks, 0);
  const rows = ITEMS.map((it) => {
    const st = statsOf(it, period);
    return {
      item_id: it.id, name: it.name, image_object_name: it.image_object_name, product_url: it.product_url,
      impressions: st.impressions, clicks: st.clicks, ctr: st.ctr, wish_count: st.wishes, worn_count: wornOf(it),
      category: it.category, is_active: it.is_active, admin_hidden: false,
    };
  }).sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
  return {
    category: null, verified_only: false, total_impressions: ti, total_clicks: tc, ctr: ti ? +((tc / ti) * 100).toFixed(2) : 0,
    items: rows, total_users: 0, chart_data: days, total_wishes: rows.reduce((s, r) => s + r.wish_count, 0),
    total_worn: rows.reduce((s, r) => s + r.worn_count, 0), item_total: rows.length,
  };
}

const ARTISTS = ['루나벨', '하늘연', '별빛소녀', 'NOVA', '체리밤', '도하', '시엘', '유랑', 'MINT', '한결'].map((n) => `${n}(예시)`);
function insights(period, cat) {
  const mul = PERIOD_MUL[period] || 1;
  const list = ITEMS.filter((it) => !cat || it.category === cat);
  const subs = {};
  list.forEach((it) => {
    const k = `${it.category}|${it.sub_category}`;
    const st = statsOf(it, period);
    const e = subs[k] || (subs[k] = { category: it.category, sub: it.sub_category, items: 0, impressions: 0, clicks: 0, wishes: 0 });
    e.items += 1; e.impressions += st.impressions; e.clicks += st.clicks; e.wishes += Math.round(st.wishes * mul);
  });
  const reacted = Math.round(list.length * 52 * mul + 40);
  const f = Math.round(reacted * 0.58);
  const m = Math.round(reacted * 0.37);
  const top = [...list].sort((a, b) => b.pop - a.pop);
  return {
    period, category: cat || null, reacted_users: reacted, min_bucket: 5,
    genders: [{ key: '여성', count: f }, { key: '남성', count: m }, { key: '기타·미입력', count: reacted - f - m }],
    age_bands: [
      { key: '10대', count: Math.round(reacted * 0.31) }, { key: '20대', count: Math.round(reacted * 0.44) },
      { key: '30대', count: Math.round(reacted * 0.14) }, { key: '40대', count: Math.round(reacted * 0.05) },
      { key: '미입력', count: Math.round(reacted * 0.06) },
    ],
    subs: Object.values(subs).sort((a, b) => b.clicks - a.clicks),
    stars: ARTISTS.map((nickname, i) => ({
      nickname, worn_count: Math.max(1, Math.round(14 - i * 1.3 + rnd(i) * 2)),
      click_count: Math.round((60 - i * 5) * mul + 2), wish_count: Math.round((48 - i * 4) * mul + 1),
      follower_count: Math.round(2400 / (i + 1) + rnd(i * 5) * 80),
      items: top.slice(i % 5, (i % 5) + 2).map((t) => t.name),
    })),
  };
}

function filterItems({ q, category, status, gender, sub, color }) {
  let list = ITEMS.filter((it) => (!q || it.name.includes(q) || it.brand.includes(q)) && (!category || it.category === category) && (!gender || it.gender === gender));
  if (status === 'active') list = list.filter((it) => it.is_active);
  if (status === 'inactive') list = list.filter((it) => !it.is_active);
  if (status === 'hidden') list = [];
  if (sub) list = list.filter((it) => it.sub_category === sub);
  if (color) list = list.filter((it) => it.color_family === color);
  return list;
}
const counts = () => ({ all: ITEMS.length, active: ITEMS.filter((i) => i.is_active).length, hidden: 0 });

function listAds(p) {
  const page = Number(p.page || 1);
  const limit = Number(p.limit || 40);
  const cat = p.category || null;
  let list = filterItems({ q: p.q || '', category: cat, status: p.status, gender: p.gender });
  if (!p.sort) return { items: list.slice((page - 1) * limit, page * limit), total: list.length, page, limit, counts: counts() };
  const subCounts = {};
  const colorCounts = {};
  list.forEach((it) => { if (cat) subCounts[it.sub_category] = (subCounts[it.sub_category] || 0) + 1; colorCounts[it.color_family] = (colorCounts[it.color_family] || 0) + 1; });
  if (p.sub) list = list.filter((it) => it.sub_category === p.sub);
  if (p.color) list = list.filter((it) => it.color_family === p.color);
  const S = (it) => statsOf(it, 'monthly');
  if (['clicks', 'impressions', 'wishes', 'ctr'].includes(p.sort)) list = [...list].sort((a, b) => S(b)[p.sort] - S(a)[p.sort]);
  else if (p.sort === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  else list = [...list].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const byCat = {};
  const byG = {};
  ITEMS.forEach((it) => { byCat[it.category] = (byCat[it.category] || 0) + 1; byG[it.gender] = (byG[it.gender] || 0) + 1; });
  return {
    items: list.slice((page - 1) * limit, page * limit).map((it) => ({ ...it, stats: S(it) })),
    total: list.length, page, limit, counts: counts(),
    facets: {
      categories: byCat, genders: byG,
      subs: Object.entries(subCounts).map(([key, count]) => ({ key, count })),
      colors: Object.entries(colorCounts).map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count),
    },
    stats_period: 'monthly',
  };
}

function itemInsights(id, period) {
  const it = ITEMS.find((x) => x.id === id) || ITEMS[0];
  const st = statsOf(it, period);
  const s = ITEMS.indexOf(it) + (period || '').length;
  const w = Math.max(1, Math.round(st.wishes * (PERIOD_MUL[period] || 1)));
  const c = st.clicks;
  const split = (n, ps) => ps.map((p) => Math.round(n * p));
  const [g1, g2, g3, g4] = split(w + c, [0.42, 0.26, 0.18, 0.14]);
  const [m1, m2, m3] = split(w + c, [0.45, 0.33, 0.22]);
  const people = Math.round((w + c) * 0.8);
  return {
    period, verified_only: false,
    wish_to_click: { wishes: w, clicks: c, rate: w ? +(c / w).toFixed(4) : null },
    by_genre: [{ key: 'K-POP', wishes: Math.round(g1 * 0.6), clicks: Math.round(g1 * 0.4) }, { key: '발라드', wishes: Math.round(g2 * 0.6), clicks: Math.round(g2 * 0.4) }, { key: 'R&B', wishes: Math.round(g3 * 0.6), clicks: Math.round(g3 * 0.4) }, { key: '미귀속', wishes: Math.round(g4 * 0.6), clicks: Math.round(g4 * 0.4) }],
    by_mood: [{ key: '밝은', wishes: Math.round(m1 * 0.6), clicks: Math.round(m1 * 0.4) }, { key: '감성', wishes: Math.round(m2 * 0.6), clicks: Math.round(m2 * 0.4) }, { key: '신나는', wishes: Math.round(m3 * 0.6), clicks: Math.round(m3 * 0.4) }],
    by_hour: Array.from({ length: 24 }, (_, h) => ({ hour: h, count: Math.round(Math.max(0, Math.sin(((h - 6) / 24) * Math.PI * 2) * 6 + 5 + rnd(h + s) * 3) * (1 + it.pop)) })),
    by_weekday: Array.from({ length: 7 }, (_, d) => ({ weekday: d, count: Math.round((8 + rnd(d + s) * 10) * (1 + it.pop)) })),
    demographics: {
      age_bands: [{ band: '20대', count: Math.round(people * 0.44) }, { band: '10대', count: Math.round(people * 0.33) }, { band: '30대', count: Math.round(people * 0.15) }, { band: '기타(소수)', count: Math.round(people * 0.08) }],
      genders: [{ key: 'female', count: Math.round(people * 0.6) }, { key: 'male', count: Math.round(people * 0.34) }, { key: '기타(소수)', count: Math.round(people * 0.06) }],
      regions: [{ key: '서울', count: Math.round(people * 0.38) }, { key: '경기', count: Math.round(people * 0.27) }, { key: '부산', count: Math.round(people * 0.09) }, { key: '미입력', count: Math.round(people * 0.26) }],
      nationalities: [{ key: 'domestic', count: Math.round(people * 0.86) }, { key: '미입력', count: Math.round(people * 0.14) }],
      min_bucket: 5,
    },
  };
}
function itemStars(id) {
  const it = ITEMS.find((x) => x.id === id) || ITEMS[0];
  const n = Math.max(2, Math.round(it.pop * 6));
  return {
    stars: ARTISTS.slice(0, n).map((nickname, i) => ({ user_id: `s${i}`, nickname, worn_count: Math.max(1, n - i), wish_count: Math.max(1, Math.round((18 - i * 3) * it.pop)), click_count: Math.max(0, Math.round((11 - i * 2) * it.pop)), follower_count: Math.round(2400 / (i + 1)) })),
    untracked_clicks: Math.round(it.pop * 6), verified_only: false,
  };
}

// ---- axios 어댑터 ----
const PROFILE = { id: 'demo', user_id: 'demo', company_name: '예시 브랜드', industry: '패션', contact_name: '', contact_phone: '' };

function route(method, path, params) {
  if (method === 'get') {
    if (path === '/business/profile') return PROFILE;
    if (path === '/business/dashboard') return dashboard(params.period || 'weekly');
    if (path === '/business/insights') return insights(params.period || 'weekly', params.category);
    if (path === '/business/ads') return listAds(params);
    if (path === '/business/ads/import-jobs') return { jobs: [] };
    let m = path.match(/^\/business\/ads\/item\/(\w+)$/);
    if (m) { const it = ITEMS.find((x) => x.id === m[1]); return it || null; }
    m = path.match(/^\/business\/ads\/(\w+)\/insights$/);
    if (m) return itemInsights(m[1], params.period || 'weekly');
    m = path.match(/^\/business\/ads\/(\w+)\/stars$/);
    if (m) return itemStars(m[1]);
  }
  if (method === 'post' && path === '/business/session/refresh') return { token: 'demo', user: DEMO_USER };
  return undefined; // 저장·수정·삭제 등 → 거절
}

// 서버를 부르지 않는 axios 어댑터 — 읽기는 예시 데이터, 쓰기는 403(DEMO_SAVE_MSG)
export function demoAdapter(config) {
  const method = (config.method || 'get').toLowerCase();
  const path = String(config.url || '').replace(/^\/api/, '').split('?')[0];
  const params = config.params || {};
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      const data = route(method, path, params);
      const res = { status: 200, statusText: 'OK', headers: {}, config, request: {} };
      if (data === null) {
        const err = new Error('demo 404');
        err.config = config;
        err.response = { ...res, status: 404, data: { error: '예시 상품을 찾을 수 없어요.' } };
        reject(err);
      } else if (data === undefined) {
        const err = new Error('demo readonly');
        err.config = config;
        err.response = { ...res, status: 403, data: { error: DEMO_SAVE_MSG } };
        reject(err);
      } else {
        resolve({ ...res, data: JSON.parse(JSON.stringify(data)) });
      }
    }, 180);
  });
}

// 예시 화면에서도 진짜 서버로 보내는 요청(입점 문의 등)
export const DEMO_PASSTHROUGH = ['/business/inquiries', '/auth/'];
