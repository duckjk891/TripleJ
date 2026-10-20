// 광고주 사이트 로컬 확인용 모의 API (운영 로그인 없이 화면 점검·시연 스크린샷)
//   node dev/mock_server.mjs   →  BIZ_API_TARGET=http://127.0.0.1:5196 npm run dev
// 로그인: 아무 이메일 + 비밀번호 'temp1234'(임시 비밀번호 흐름) 또는 그 밖의 값(일반 흐름). 'user' 가 들어간 이메일은 일반 사용자.
// v3.381 — 내부 시연용 상품: 무신사 스탠다드 실제 상품(이름·사진 주소·상품 주소)에 임의 성과 수치. 운영 서버와 무관, 공개하지 않는다.
//   사진은 무신사 이미지 주소로 넘겨 보여 준다(파일을 저장하지 않음). MOCK_PLAIN=1 이면 예전 색 상자 예시 상품.
import http from 'node:http';

const PORT = Number(process.env.MOCK_PORT || 5196);
const BRAND = '무신사 스탠다드';
const CATS = ['상의', '하의', '신발', '모자', '가방'];
const GENDERS = ['남성용', '여성용', '공용'];

// [상품번호, 판매 페이지 상품명, 사진 주소, 카테고리, 대상, 인기(0~1)]
const MS = [
  [6917755, '에센셜 크루 넥 니트 [오트밀]', 'https://image.msscdn.net/images/goods_img/20260724/6917755/6917755_17914496521482_500.jpg', '상의', '공용', 0.95],
  [2778661, '메리노 울 블렌드 하이게이지 크루 넥 니트 [블랙]', 'https://image.msscdn.net/images/goods_img/20220907/2778661/2778661_17286354598495_500.jpg', '상의', '공용', 0.7],
  [7083631, '피그먼트 다이드 하이넥 크롭 니트 집업 [차콜 그레이]', 'https://image.msscdn.net/images/goods_img/20260814/7083631/7083631_17919378601492_500.jpg', '상의', '여성용', 0.55],
  [7074430, '캐시미어 20 싱글 코트 [블랙]', 'https://image.msscdn.net/images/goods_img/20260813/7074430/7074430_17907369667236_500.jpg', '상의', '공용', 0.9],
  [4209292, '캐시미어 블렌드 오버사이즈 미니멀 발마칸 코트 [토프]', 'https://image.msscdn.net/images/goods_img/20240620/4209292/4209292_17364968941519_500.jpg', '상의', '공용', 0.6],
  [3054928, '하이넥 미니멀 블루종 재킷 [블랙]', 'https://image.msscdn.net/images/goods_img/20230202/3054928/3054928_16896573676857_500.jpg', '상의', '남성용', 0.65],
  [4617220, '코튼 해링턴 재킷 [다크 그레이]', 'https://image.msscdn.net/images/goods_img/20241115/4617220/4617220_17411676564169_500.jpg', '상의', '남성용', 0.4],
  [3790840, '헤비웨이트 CP 워크 재킷 [바로크 브라운]', 'https://image.msscdn.net/images/goods_img/20240112/3790840/3790840_17224128397682_500.jpg', '상의', '공용', 0.5],
  [7023008, '크롭 옥스포드 셔츠 [화이트]', 'https://image.msscdn.net/images/goods_img/20260807/7023008/7023008_17901477227528_500.jpg', '상의', '여성용', 0.75],
  [2093491, '스트라이프 오버사이즈 옥스포드 셔츠 [스카이 블루 스트라이프]', 'https://image.msscdn.net/images/goods_img/20210827/2093491/2093491_17224104211279_500.jpg', '상의', '공용', 0.6],
  [3056556, '오버사이즈 옥스포드 셔츠 [네이비]', 'https://image.msscdn.net/images/goods_img/20230202/3056556/3056556_17286314506641_500.jpg', '상의', '공용', 0.35],
  [7357750, '키스 해링 Winged Heart 후디드 스웨트셔츠 [블랙]', 'https://image.msscdn.net/thumbnails/images/goods_img/20260917/7357750/7357750_17921309040013_big.jpg?w=500', '상의', '공용', 0.85],
  [7357748, '키스 해링 American Flag 후디드 스웨트셔츠 [미디엄 그레이]', 'https://image.msscdn.net/thumbnails/images/goods_img/20260917/7357748/7357748_17923783406086_big.jpg?w=500', '상의', '공용', 0.5],
  [7363402, '키스 해링 Barking Dog 스트라이프 긴소매 티셔츠 [화이트/네이비]', 'https://image.msscdn.net/thumbnails/images/goods_img/20260918/7363402/7363402_17921365979132_big.jpg?w=500', '상의', '공용', 0.45],
  [7154377, '케이팝 데몬 헌터스 티셔츠 [블랙]', 'https://image.msscdn.net/thumbnails/images/goods_img/20260825/7154377/7154377_17918863821581_big.jpg?w=500', '상의', '공용', 1.0],
  [3779117, '셀비지 스트레이트 데님 팬츠 [딥 인디고]', 'https://image.msscdn.net/images/goods_img/20240105/3779117/3779117_17421805923099_500.jpg', '하의', '남성용', 0.8],
  [2823285, '트위스트 세미 벌룬 데님 팬츠 [크림]', 'https://image.msscdn.net/images/goods_img/20220927/2823285/2823285_16733390499800_500.jpg', '하의', '여성용', 0.7],
  [6078643, '커브드 데님 팬츠 [미드 블루]', 'https://image.msscdn.net/images/goods_img/20260304/6078643/6078643_17876252437332_500.jpg', '하의', '공용', 0.9],
  [2568742, '사이드 어드저스트 투 턱 와이드 슬랙스 [블랙]', 'https://image.msscdn.net/images/goods_img/20220518/2568742/2568742_1_500.jpg', '하의', '공용', 0.75],
  [3504230, '파라슈트 밴딩 슬랙스 [블랙]', 'https://image.msscdn.net/images/goods_img/20230828/3504230/3504230_16963958728359_500.jpg', '하의', '공용', 0.4],
  [4108403, '맥시멀 스커트 슬랙스 [블랙]', 'https://image.msscdn.net/images/goods_img/20240507/4108403/4108403_17201456979347_500.jpg', '하의', '여성용', 0.5],
  [6834027, '데님 디테일 와이드 스웨트 팬츠 [블랙]', 'https://image.msscdn.net/images/goods_img/20260713/6834027/6834027_17884256563666_500.jpg', '하의', '공용', 0.3],
  [4537762, '클래식 트레이너 스니커즈 [화이트]', 'https://image.msscdn.net/images/goods_img/20241021/4537762/4537762_17326065570562_500.jpg', '신발', '공용', 0.85],
  [6717409, '스웨이드 레이싱 스니커즈 [다크 브라운]', 'https://image.msscdn.net/images/goods_img/20260623/6717409/6717409_17865091194339_500.jpg', '신발', '공용', 0.65],
  [6717414, '레이싱 스니커즈 [블랙]', 'https://image.msscdn.net/images/goods_img/20260623/6717414/6717414_17865166148042_500.jpg', '신발', '공용', 0.6],
  [1635193, '레더 코트 스니커즈 [화이트]', 'https://image.msscdn.net/images/goods_img/20201006/1635193/1635193_17137793603764_500.jpg', '신발', '공용', 0.5],
  [1388932, '빅 사이즈 코튼 볼캡 [블랙]', 'https://image.msscdn.net/images/goods_img/20200407/1388932/1388932_16898375620438_500.jpg', '모자', '공용', 0.7],
  [3518274, 'TR 미니멀 볼캡 [블랙]', 'https://image.msscdn.net/images/goods_img/20230831/3518274/3518274_16989811439608_500.jpg', '모자', '공용', 0.4],
  [1215265, '니트 워치 캡 [블랙]', 'https://image.msscdn.net/images/goods_img/20191106/1215265/1215265_17516063048391_500.jpg', '모자', '공용', 0.6],
  [2122542, '볼드 니트 비니 [베이지]', 'https://image.msscdn.net/images/goods_img/20210910/2122542/2122542_1_500.jpg', '모자', '여성용', 0.45],
  [4647080, '나일론 플랩 카고 백팩 [블랙]', 'https://image.msscdn.net/images/goods_img/20241203/4647080/4647080_17429785933129_500.jpg', '가방', '공용', 0.55],
  [5875492, '립스탑 커브드 포켓 하이킹 백팩 [머드 그레이]', 'https://image.msscdn.net/images/goods_img/20260107/5875492/5875492_17767341173595_500.jpg', '가방', '공용', 0.35],
  [4677936, 'TR 미니멀 크로스 백 [블랙]', 'https://image.msscdn.net/images/goods_img/20241223/4677936/4677936_17423732269123_500.jpg', '가방', '공용', 0.6],
  [4641082, '크링클 페들러 백 [블랙]', 'https://image.msscdn.net/images/goods_img/20241128/4641082/4641082_17429672522455_500.jpg', '가방', '여성용', 0.3],
];

const rnd = (seed) => { const x = Math.sin(seed) * 10000; return x - Math.floor(x); };
const IMG = new Map(); // object name → 사진 주소
const splitName = (full) => {
  const mm = full.match(/^(.*?)\s*\[([^\]]+)\]\s*$/);
  return mm ? [mm[1].trim(), mm[2].trim()] : [full, ''];
};

function demoItems() {
  return MS.map(([no, full, img, cat, gender, pop], i) => {
    const [base, color] = splitName(full);
    const obj = `ads/u1/ms${no}.jpg`;
    IMG.set(obj, img);
    return {
      id: (200000 + i).toString(16).padStart(24, 'c'), user_id: 'u1', name: color ? `${base} ${color}` : base,
      image_object_name: obj, product_url: `https://www.musinsa.com/products/${no}`, category: cat, gender, brand: BRAND,
      color, product_name: full, is_active: i !== 10 && i !== 21, admin_hidden: false, seed_source: i < 30 ? 'fashion_brands_csv' : undefined,
      pop, created_at: new Date(Date.now() - (i * 2 + 1) * 86400000).toISOString(),
    };
  });
}

function plainItems() {
  const COLORS = ['라벤더', '블랙', '화이트', '네이비', '베이지', '레드'];
  const NAMES = ['오버핏 니트', '와이드 데님 팬츠', '레더 스니커즈', '볼캡', '미니 크로스백', '울 코트', '스트라이프 셔츠', '카고 팬츠', '청키 로퍼', '버킷햇'];
  return Array.from({ length: 57 }, (_, i) => ({
    id: (100000 + i).toString(16).padStart(24, 'a'), user_id: 'u1', name: `${NAMES[i % NAMES.length]} ${COLORS[i % COLORS.length]}`,
    image_object_name: `ads/u1/mock${i}.png`, product_url: `https://shop.example.com/p/${i}`, category: CATS[i % CATS.length], gender: GENDERS[i % 3],
    brand: '예시브랜드', color: COLORS[i % COLORS.length], product_name: '', is_active: i % 9 !== 4, admin_hidden: i === 13, pop: rnd(i),
    created_at: new Date(Date.now() - i * 86400000).toISOString(),
  }));
}

const PLAIN = process.env.MOCK_PLAIN === '1';
let mustChange = false;
let items = PLAIN ? plainItems() : demoItems();
const profile = PLAIN
  ? { id: 'p1', user_id: 'u1', company_name: '예시브랜드', industry: '패션', contact_name: '김담당', contact_phone: '010-0000-0000' }
  : { id: 'p1', user_id: 'u1', company_name: BRAND, industry: '패션', contact_name: '시연 담당', contact_phone: '010-0000-0000' };

// 세부 종류 — 서버(app/services/item_taxonomy.py) 규칙을 줄여 옮김(모의 화면용)
const SUBS = {
  상의: [['원피스', /원피스|드레스/], ['아우터', /코트|재킷|자켓|블루종|점퍼|패딩|집업|해링턴|블레이저/], ['가디건', /가디건/], ['후드', /후드|후디/], ['맨투맨', /맨투맨|스웨트셔츠|크루넥|크루 넥/], ['니트', /니트|스웨터/], ['티셔츠', /티셔츠/], ['셔츠/블라우스', /셔츠|블라우스/]],
  하의: [['스커트', /스커트|치마/], ['반바지', /반바지|쇼츠/], ['데님', /데님|청바지|진/], ['슬랙스', /슬랙스/], ['트레이닝/조거', /조거|트레이닝|스웨트 팬츠/], ['카고/와이드', /카고|와이드/], ['팬츠', /팬츠|바지/]],
  신발: [['스니커즈', /스니커즈|운동화|트레이너/], ['부츠', /부츠/], ['로퍼/구두', /로퍼|구두/], ['샌들/슬리퍼', /샌들|슬리퍼/]],
  모자: [['볼캡', /볼캡|볼 캡/], ['버킷햇', /버킷/], ['비니', /비니|워치 캡/]],
  가방: [['백팩', /백팩/], ['크로스백', /크로스|페들러|메신저/], ['토트백', /토트/], ['숄더백', /숄더|호보/], ['미니/파우치', /파우치|미니 백/]],
};
const SUB_ORDER = { 상의: ['아우터', '가디건', '후드', '맨투맨', '니트', '원피스', '나시', '티셔츠', '셔츠/블라우스', '기타'], 하의: ['스커트', '반바지', '데님', '슬랙스', '트레이닝/조거', '카고/와이드', '팬츠', '기타'], 신발: ['스니커즈', '부츠', '로퍼/구두', '샌들/슬리퍼', '기타'], 모자: ['볼캡', '버킷햇', '비니', '베레모/기타'], 가방: ['백팩', '크로스백', '토트백', '숄더백', '미니/파우치', '기타'] };
const subOf = (it) => {
  const text = `${it.product_name || ''} ${it.name || ''}`;
  for (const [label, rx] of SUBS[it.category] || []) if (rx.test(text)) return label;
  return it.category === '모자' ? '베레모/기타' : '기타';
};
const FAMS = [['블랙', /블랙|차콜/], ['화이트', /화이트|크림|아이보리|오트밀/], ['그레이', /그레이/], ['네이비', /네이비|인디고/], ['블루', /블루/], ['베이지', /베이지|토프/], ['브라운', /브라운/], ['레드', /레드/], ['퍼플', /라벤더|퍼플/]];
const famOf = (it) => { for (const [f, rx] of FAMS) if (rx.test(it.color || '')) return f; return '색상 정보 없음'; };

// 임의 성과 — 상품 인기(pop)에 비례, 기간이 길수록 크게
const PERIOD_MUL = { daily: 0.06, weekly: 0.32, monthly: 1 };
function statsOf(it, period = 'monthly') {
  const i = items.indexOf(it) + 1;
  const mul = PERIOD_MUL[period] || 1;
  const imp = Math.round((120 + (it.pop || 0.3) * 1400 + rnd(i * 3) * 160) * mul * (it.is_active ? 1 : 0.15));
  const clk = Math.round(imp * (0.035 + (it.pop || 0.3) * 0.07 + rnd(i * 7) * 0.02));
  const wishes = Math.round(18 + (it.pop || 0.3) * 260 + rnd(i * 11) * 30);
  return { impressions: imp, clicks: clk, wishes, ctr: imp ? +(clk / imp * 100).toFixed(2) : 0 };
}

function dashboard(period) {
  const n = period === 'monthly' ? 30 : 7;
  const tot = items.reduce((s, it) => s + statsOf(it, 'monthly').impressions, 0) / 30;
  const days = Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.now() - (n - 1 - i) * 86400000);
    const wk = [0.9, 0.85, 0.95, 1, 1.15, 1.35, 1.25][d.getDay()];
    const imp = Math.round(tot * wk * (0.8 + rnd(i + n) * 0.35) * (1 + i / (n * 3)));
    const clk = Math.round(imp * (0.07 + rnd(i * 7) * 0.025));
    return { label: `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, impressions: imp, clicks: clk, ctr: +(clk / imp * 100).toFixed(2), users: Math.round(imp * 0.7) };
  });
  const span = period === 'daily' ? days.slice(-1) : days.slice(-(period === 'monthly' ? 30 : 7));
  const ti = span.reduce((s, d) => s + d.impressions, 0);
  const tc = span.reduce((s, d) => s + d.clicks, 0);
  const rows = items.map((it, i) => {
    const st = statsOf(it, period);
    return { item_id: it.id, name: it.name, image_object_name: it.image_object_name, product_url: it.product_url, impressions: st.impressions, clicks: st.clicks, ctr: st.ctr, wish_count: st.wishes, worn_count: Math.round((it.pop || 0.2) * 14 + rnd(i + 9) * 3), category: it.category, is_active: it.is_active, admin_hidden: it.admin_hidden };
  }).sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
  return { category: null, verified_only: false, total_impressions: ti, total_clicks: tc, ctr: ti ? +(tc / ti * 100).toFixed(2) : 0, items: rows, total_users: 0, chart_data: days, total_wishes: rows.reduce((s, r) => s + r.wish_count, 0), total_worn: rows.reduce((s, r) => s + r.worn_count, 0), item_total: rows.length };
}

const ARTISTS = ['루나벨', '하늘연', '별빛소녀', 'NOVA', '체리밤', '도하', '시엘', '유랑', 'MINT', '한결'];
function insights(period, cat) {
  const mul = PERIOD_MUL[period] || 1;
  const list = items.filter((it) => !cat || it.category === cat);
  const subs = {};
  list.forEach((it) => {
    const k = `${it.category}|${subOf(it)}`;
    const st = statsOf(it, period);
    const e = subs[k] || (subs[k] = { category: it.category, sub: subOf(it), items: 0, impressions: 0, clicks: 0, wishes: 0 });
    e.items += 1; e.impressions += st.impressions; e.clicks += st.clicks; e.wishes += Math.round(st.wishes * mul);
  });
  const reacted = Math.round(list.length * 52 * mul + 40);
  const f = Math.round(reacted * 0.58); const m = Math.round(reacted * 0.37);
  const top = [...list].sort((a, b) => b.pop - a.pop);
  return {
    period, category: cat || null, reacted_users: reacted, min_bucket: 5,
    genders: [{ key: '여성', count: f }, { key: '남성', count: m }, { key: '기타·미입력', count: reacted - f - m }],
    age_bands: [{ key: '10대', count: Math.round(reacted * 0.31) }, { key: '20대', count: Math.round(reacted * 0.44) }, { key: '30대', count: Math.round(reacted * 0.14) }, { key: '40대', count: Math.round(reacted * 0.05) }, { key: '미입력', count: Math.round(reacted * 0.06) }],
    subs: Object.values(subs).sort((a, b) => b.clicks - a.clicks),
    stars: ARTISTS.map((nickname, i) => ({ nickname, worn_count: Math.max(1, Math.round(14 - i * 1.3 + rnd(i) * 2)), click_count: Math.round((60 - i * 5) * mul + 2), wish_count: Math.round((48 - i * 4) * mul + 1), follower_count: Math.round(2400 / (i + 1) + rnd(i * 5) * 80), items: top.slice(i % 5, i % 5 + 2).map((t) => t.name) })),
  };
}

function svg(seed) {
  const hue = Math.round(rnd(seed) * 360);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320"><rect width="320" height="320" fill="hsl(${hue},60%,88%)"/><rect x="90" y="70" width="140" height="180" rx="26" fill="hsl(${hue},55%,55%)"/></svg>`;
}

const send = (res, code, b) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(b)); };
const rawBody = (req) => new Promise((r) => { const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => r(Buffer.concat(chunks))); });
const body = async (req) => { const d = (await rawBody(req)).toString(); try { return JSON.parse(d || '{}'); } catch { return { _raw: d }; } };
const authed = (req) => String(req.headers.authorization || '').startsWith('Bearer mock');

// multipart 아주 간단히 — 필드 문자열과 파일 바이트
function multipart(req, buf) {
  const ct = String(req.headers['content-type'] || '');
  const b = ct.match(/boundary=(.+)$/)?.[1];
  const out = { fields: {}, file: null, filename: '' };
  if (!b) return out;
  const parts = buf.toString('latin1').split(`--${b}`);
  for (const part of parts) {
    const head = part.slice(0, part.indexOf('\r\n\r\n'));
    const name = head.match(/name="([^"]+)"/)?.[1];
    if (!name) continue;
    const content = part.slice(head.length + 4, part.length - 2);
    if (/filename="/.test(head)) { out.file = Buffer.from(content, 'latin1'); out.filename = Buffer.from(head.match(/filename="([^"]*)"/)[1], 'latin1').toString('utf8'); } else out.fields[name] = Buffer.from(content, 'latin1').toString('utf8');
  }
  return out;
}

const COLS = { 착장에보일이름: 'name', 이름: 'name', 상품명: 'name', 아이템명: 'name', 카테고리: 'cat', 분류: 'cat', 부위: 'cat', 대상: 'gender', 성별: 'gender', 브랜드: 'brand', 색상: 'color', 상품페이지주소: 'url', 상품url: 'url', 디테일페이지url: 'url', 사진주소: 'img', 이미지url: 'img', 이미지: 'img', 판매페이지상품명: 'pname' };
const CATWORDS = { 상의: /상의|니트|셔츠|티셔츠|코트|재킷|후드|맨투맨|아우터/, 하의: /하의|팬츠|바지|데님|청바지|슬랙스|스커트/, 신발: /신발|스니커즈|운동화|부츠|로퍼/, 모자: /모자|캡|비니|햇/, 가방: /가방|백/ };
function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') q = false; else cell += ch; } else if (ch === '"') q = true; else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
function checkFile(file, filename, mode) {
  if (!file || file[0] === 0x50) { // xlsx 는 모의 서버에서 내용 대신 예시 결과
    return { rows: MS.slice(0, 6).map(([no, full, img, cat, gender], i) => ({ line: i + 2, name: `${splitName(full)[0]} (새 시즌)`, cat, gender, brand: BRAND, color: splitName(full)[1], url: `https://www.musinsa.com/products/${no}?s=2`, img })), errors: [{ line: 9, error: "카테고리 '장갑'를 알 수 없어요. 상의·하의·신발·모자·가방 중 하나로 적어 주세요." }], total: 7, dup: 0 };
  }
  const table = parseCsv(file.toString('utf8').replace(/^﻿/, '')).filter((r) => r.some((c) => c.trim()));
  const head = (table[0] || []).map((h) => COLS[h.replace(/[\s*()]|필수|선택/g, '').toLowerCase()] || null);
  const errors = []; const rows = []; let dup = 0;
  table.slice(1).forEach((cells, k) => {
    const line = k + 2; const r = {};
    head.forEach((h, i) => { if (h && r[h] == null) r[h] = (cells[i] || '').trim(); });
    const cat = Object.keys(CATWORDS).find((c) => CATWORDS[c].test(r.cat || ''));
    if (!cat) { errors.push({ line, error: `카테고리 '${(r.cat || '').slice(0, 20)}'를 알 수 없어요. 상의·하의·신발·모자·가방 중 하나로 적어 주세요.` }); return; }
    if (!r.name) { errors.push({ line, error: '착장에 보일 이름이 비어 있어요.' }); return; }
    if (!/^https?:\/\//.test(r.url || '')) { errors.push({ line, error: '상품 페이지 주소가 없거나 http(s)로 시작하지 않아요.' }); return; }
    if (!/^https?:\/\//.test(r.img || '')) { errors.push({ line, error: '사진 주소가 없거나 http(s)로 시작하지 않아요.' }); return; }
    if (mode === 'append' && items.some((it) => it.product_url === r.url && (it.color || '') === (r.color || ''))) { dup += 1; return; }
    const g = /남/.test(r.gender || '') ? '남성용' : /여/.test(r.gender || '') ? '여성용' : '공용';
    rows.push({ line, name: r.name.slice(0, 60), cat, gender: g, brand: r.brand || '', color: r.color || '', url: r.url, img: r.img, pname: r.pname || '' });
  });
  return { rows, errors, total: table.length - 1, dup };
}
const jobs = [];
function summary(chk, mode) {
  const by = {}; chk.rows.forEach((r) => { by[r.cat] = (by[r.cat] || 0) + 1; });
  return { total_rows: chk.total, valid_rows: chk.rows.length + chk.dup, duplicates: chk.dup, will_insert: chk.rows.length, by_category: by, errors: chk.errors, error_count: chk.errors.length, mode, ...(mode === 'replace' ? { will_replace: items.filter((i) => i.seed_source).length } : {}) };
}
function runJob(job, rows) {
  const tick = () => {
    const step = rows.slice(job.processed, job.processed + 2);
    step.forEach((r, k) => {
      if (/fail|missing/.test(r.img)) { job.skipped_count += 1; job.skipped.push({ line: r.line, name: r.name, error: '사진 주소에서 사진을 받지 못했어요.' }); return; }
      const obj = `ads/u1/imp${Date.now()}${k}.jpg`;
      IMG.set(obj, r.img);
      items.unshift({ id: (Date.now() + k).toString(16).padStart(24, 'd'), user_id: 'u1', name: r.name, image_object_name: obj, product_url: r.url, category: r.cat, gender: r.gender, brand: r.brand, color: r.color, product_name: r.pname, is_active: job.activate, admin_hidden: false, seed_source: 'business_import', import_job_id: job.job_id, pop: 0.2, created_at: new Date().toISOString() });
      job.inserted += 1;
    });
    job.processed += step.length;
    if (job.processed < rows.length) { setTimeout(tick, 700); return; }
    if (job.mode === 'replace') { const before = items.length; items = items.filter((i) => !i.seed_source || i.import_job_id === job.job_id); job.replaced = before - items.length; }
    job.status = 'done'; job.finished_at = new Date().toISOString();
  };
  setTimeout(tick, 700);
}

function richList(sp) {
  const page = Number(sp.get('page') || 1); const limit = Number(sp.get('limit') || 40);
  const q = sp.get('q') || ''; const cat = sp.get('category'); const st = sp.get('status'); const g = sp.get('gender');
  const sub = sp.get('sub'); const color = sp.get('color'); const sort = sp.get('sort') || 'recent';
  let list = filterItems({ q, category: cat, status: st, gender: g });
  const subCounts = {}; const colorCounts = {};
  list.forEach((it) => { if (cat) subCounts[subOf(it)] = (subCounts[subOf(it)] || 0) + 1; colorCounts[famOf(it)] = (colorCounts[famOf(it)] || 0) + 1; });
  if (sub) list = list.filter((it) => subOf(it) === sub);
  if (color) list = list.filter((it) => famOf(it) === color);
  const S = (it) => statsOf(it, 'monthly');
  if (['clicks', 'impressions', 'wishes', 'ctr'].includes(sort)) list.sort((a, b) => S(b)[sort] - S(a)[sort]);
  else if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  else list.sort((a, b) => b.created_at.localeCompare(a.created_at));
  const byCat = {}; const byG = {};
  items.forEach((it) => { byCat[it.category] = (byCat[it.category] || 0) + 1; byG[it.gender] = (byG[it.gender] || 0) + 1; });
  const order = SUB_ORDER[cat] || [];
  return {
    items: list.slice((page - 1) * limit, page * limit).map((it) => ({ ...it, sub_category: subOf(it), color_family: famOf(it), stats: S(it) })),
    total: list.length, page, limit,
    counts: { all: items.length, active: items.filter((i) => i.is_active && !i.admin_hidden).length, hidden: items.filter((i) => i.admin_hidden).length },
    facets: { categories: byCat, genders: byG, subs: order.filter((k) => subCounts[k]).map((k) => ({ key: k, count: subCounts[k] })), colors: Object.entries(colorCounts).map(([key, count]) => ({ key, count })).sort((a, b) => (a.key === '색상 정보 없음') - (b.key === '색상 정보 없음') || b.count - a.count) },
    stats_period: 'monthly',
  };
}
function filterItems({ q, category, status, gender, sub, color }) {
  let list = items.filter((it) => (!q || it.name.includes(q) || (it.brand || '').includes(q)) && (!category || it.category === category) && (!gender || it.gender === gender));
  if (status === 'active') list = list.filter((it) => it.is_active && !it.admin_hidden);
  if (status === 'inactive') list = list.filter((it) => !it.is_active);
  if (status === 'hidden') list = list.filter((it) => it.admin_hidden);
  if (sub) list = list.filter((it) => subOf(it) === sub);
  if (color) list = list.filter((it) => famOf(it) === color);
  return list;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const m = req.method;
  await new Promise((r) => setTimeout(r, 250)); // 실제처럼 약간 늦게
  if (p.startsWith('/api/business/items/image/')) {
    const obj = decodeURIComponent(p.slice('/api/business/items/image/'.length));
    const orig = obj.startsWith('ads/thumb320/') ? [...IMG.keys()].find((k) => k.replace(/\.\w+$/, '') === `ads/${obj.slice(13).replace(/\.jpg$/, '')}`) : obj;
    if (orig && IMG.has(orig)) { res.writeHead(302, { Location: IMG.get(orig), 'Cache-Control': 'no-store' }); res.end(); return; }
    if (p.includes('/thumb320/') && p.includes('mock1')) { res.writeHead(404); res.end(); return; } // 썸네일 없는 경우 원본 폴백 확인
    res.writeHead(200, { 'Content-Type': 'image/svg+xml' }); res.end(svg(p.length + (p.match(/\d+/g) || [0]).join('').length)); return;
  }
  if (p === '/api/auth/login' && m === 'POST') {
    const b = await body(req);
    if (b.password === 'wrong') return send(res, 401, { error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
    mustChange = b.password === 'temp1234';
    const role = String(b.email).includes('user') ? 'user' : 'customer';
    return send(res, 200, { token: 'mock-token', user: { id: 'u1', email: b.email, nickname: profile.company_name, role } });
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
  if (p === '/api/business/session/refresh') return send(res, 200, { token: 'mock-token', user: { id: 'u1', email: 'brand@example.com', nickname: profile.company_name, role: 'customer' } });
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
  if (p === '/api/business/insights') return send(res, 200, insights(url.searchParams.get('period'), url.searchParams.get('category')));
  if (p === '/api/business/ads' && m === 'GET') {
    if (url.searchParams.get('sort')) return send(res, 200, richList(url.searchParams));
    const page = Number(url.searchParams.get('page') || 1); const limit = Number(url.searchParams.get('limit') || 40);
    const list = filterItems({ q: url.searchParams.get('q') || '', category: url.searchParams.get('category'), status: url.searchParams.get('status') });
    return send(res, 200, { items: list.slice((page - 1) * limit, page * limit), total: list.length, page, limit, counts: { all: items.length, active: items.filter((i) => i.is_active && !i.admin_hidden).length, hidden: items.filter((i) => i.admin_hidden).length } });
  }
  if (p === '/api/business/ads' && m === 'POST') {
    await rawBody(req);
    const it = { ...items[0], id: Date.now().toString(16).padStart(24, 'b'), name: '새 상품', created_at: new Date().toISOString(), is_active: true, admin_hidden: false };
    items = [it, ...items];
    return send(res, 201, it);
  }
  if (p === '/api/business/ads/bulk' && m === 'POST') {
    const b = await body(req);
    const target = b.ids ? items.filter((i) => b.ids.includes(i.id)) : filterItems(b.filter || {});
    if (b.action === 'delete') { const ids = new Set(target.map((t) => t.id)); items = items.filter((i) => !ids.has(i.id)); } else target.forEach((t) => { t.is_active = b.action === 'show'; });
    return send(res, 200, { matched: target.length, changed: target.length, admin_hidden_kept: b.action === 'show' ? target.filter((t) => t.admin_hidden).length : 0 });
  }
  if (p === '/api/business/ads/import' && m === 'POST') {
    const mp = multipart(req, await rawBody(req));
    const mode = mp.fields.mode || 'append';
    const chk = checkFile(mp.file, mp.filename, mode);
    const sum = summary(chk, mode);
    if (mp.fields.dry_run !== 'false') return send(res, 200, { dry_run: true, ...sum });
    if (jobs.some((j) => j.status === 'running')) return send(res, 409, { error: '이미 등록이 진행 중이에요. 끝난 뒤에 다시 올려 주세요.' });
    const job = { job_id: `job${Date.now()}`, status: 'running', mode, activate: mp.fields.activate !== 'false', filename: mp.filename, total: chk.rows.length, processed: 0, inserted: 0, skipped: [], skipped_count: 0, duplicates: chk.dup, started_at: new Date().toISOString() };
    jobs.unshift(job);
    runJob(job, chk.rows);
    return send(res, 200, { dry_run: false, job_id: job.job_id, ...sum });
  }
  if (p === '/api/business/ads/import-jobs') return send(res, 200, { jobs: jobs.slice(0, 5).map(({ skipped, ...j }) => j) });
  let mm = p.match(/^\/api\/business\/ads\/import-jobs\/(\w+)$/);
  if (mm) { const j = jobs.find((x) => x.job_id === mm[1]); return j ? send(res, 200, j) : send(res, 404, { error: '등록 기록을 찾을 수 없어요.' }); }
  mm = p.match(/^\/api\/business\/ads\/item\/(\w+)$/);
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
  if (mm) return send(res, 200, { stars: ARTISTS.slice(0, 4).map((nickname, i) => ({ user_id: `s${i}`, nickname, worn_count: 5 - i, wish_count: 18 - i * 4, click_count: 11 - i * 2, follower_count: Math.round(2400 / (i + 1)) })), untracked_clicks: 5 });
  mm = p.match(/^\/api\/business\/ads\/(\w+)$/);
  if (mm && m === 'PUT') { await rawBody(req); const it = items.find((i) => i.id === mm[1]); return send(res, 200, it); }
  if (mm && m === 'DELETE') { items = items.filter((i) => i.id !== mm[1]); return send(res, 200, { message: 'ok' }); }
  send(res, 404, { error: 'not found' });
}).listen(PORT, '127.0.0.1', () => console.log(`mock business api on ${PORT}${PLAIN ? '' : ' (무신사 스탠다드 내부 시연 데이터)'}`));
