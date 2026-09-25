// v3.227(D): 꾸미기 피커 카탈로그 — 순수 함수 모듈(I/O 없음, 유닛 테스트 대상).
// - 타입·상수: Cat, AdItem, 카테고리 목록
// - 브랜드 기준 통합: brandOf/brandNameOf (brand 우선, advertiser_nickname은 폴백) — 무신사·지그재그·
//   브랜드샵 같은 판매자 계정명이 아니라 실제 브랜드로 묶고, 생성 프롬프트에도 같은 값을 쓴다.
// - 세부 분류(sub_category)·색상 계열(color_family 13종) 규칙: 서버 app/services/item_taxonomy.py
//   (v3.227 스테이징)와 같은 규칙표를 옮긴 것. 서버 catalog 응답에 값이 있으면 서버 값을 쓰고,
//   구서버(/ads/active 폴백)·SAMPLE일 때만 여기서 계산한다.
//   · Hermes/구형 Safari 호환을 위해 lookbehind를 쓰지 않는다 — "(?<![a-z])X" 는 "(?:^|[^a-z])X"로 대체
//     (분류는 test()만 쓰므로 동일, 색상 위치 계산은 접두 문자 길이를 보정).
//   · 입력은 소문자로 바꿔 매칭한다(영문 토큰은 전부 소문자).
// - 필터·패싯 개수·브랜드 그룹·정렬·가격 구간·색상 스와치.

// ── 타입·상수 ──────────────────────────────────────────────────────────────

// v3.206: 활성 선택 슬롯은 상의/하의/신발/모자/가방(모자·가방은 그리드에서 '악세서리' 카드 1장).
export type Cat = '상의' | '하의' | '신발' | '모자' | '가방';
export const CATEGORIES: Cat[] = ['상의', '하의', '신발', '모자', '가방'];
export const ACCESSORY_SUBCATS: Cat[] = ['모자', '가방'];
// v3.205(⑤): 성별 데이터가 실재하는 카테고리만 자동 필터. 나머지는 무필터(전량 사라지는 사고 방지).
export const GENDER_FILTER_CATS: Cat[] = ['상의', '하의', '신발'];

export interface AdItem {
  id: string;
  name: string;
  image_object_name?: string;
  product_url?: string;
  advertiser_nickname?: string;
  brand?: string;
  gender?: string;        // '남성용' | '여성용' | '공용'
  product_name?: string;
  color?: string;         // 표시용(잔재 값은 빈 문자열로 정리됨)
  category?: string;
  is_active?: boolean;
  // v3.227(D): 카탈로그 파생 필드 — catalogService 매퍼가 항상 채운다
  sub_category?: string;
  color_family?: string | null;
  price_krw?: number | null;
  source?: 'brand' | 'platform';
}

type BrandLike = { brand?: string; advertiser_nickname?: string };

/** 실제 브랜드명(없으면 판매자 닉네임, 그것도 없으면 빈 문자열) — 프롬프트·표시용 */
export const brandNameOf = (i: BrandLike) =>
  (i.brand || '').trim() || (i.advertiser_nickname || '').trim();
/** 그룹 키용 브랜드명 — 비어 있으면 '기타' */
export const brandOf = (i: BrandLike) => brandNameOf(i) || '기타';
export const productOf = (i: AdItem) => i.product_name || i.name || '기타';

// 성별 멤버십: 공용(및 미지정)은 남/여 모두에 포함
export const genderMatches = (i: AdItem, g: string) => {
  const ig = i.gender || '공용';
  if (ig === '공용') return true;
  if (g === '남') return ig === '남성용';
  if (g === '여') return ig === '여성용';
  return false;
};
export const genderLabel = (g: string) => (g === '남' ? '남성' : '여성');

// v3.205(⑤): 아티스트 성별 정규화 — '남성'/'남자'/'남' → '남', '여성'/'여자'/'여' → '여'.
// 판별 실패는 null → 자동 필터 미적용(전량 노출, 안전).
// v3.230 A4: 소년/소녀·영문(male/female·man/woman·boy/girl·m/f) 추가. 영문은 **정확 토큰 비교**만 —
// "female"·"woman" 안에 "male"·"man" 이 들어 있어 부분 문자열 매칭은 오판(여→남)이 된다.
const MALE_EN = new Set(['male', 'man', 'boy', 'm']);
const FEMALE_EN = new Set(['female', 'woman', 'girl', 'f']);
export const normalizeArtistGender = (raw?: string | null): '남' | '여' | null => {
  const t = (typeof raw === 'string' ? raw : '').trim();
  if (!t) return null;
  // 한글: 기존 '남…/여…' 시작 인식 유지 + 소년/소녀
  if (t.startsWith('남') || t.startsWith('소년')) return '남';
  if (t.startsWith('여') || t.startsWith('소녀')) return '여';
  const en = t.toLowerCase();
  if (FEMALE_EN.has(en)) return '여'; // female 먼저(정확 일치라 순서 무관하지만 의도 명시)
  if (MALE_EN.has(en)) return '남';
  return null;
};

// v3.230 A4: 꾸미기 피커 성별 필터 선택 — '남'|'여' = 해당 성별용+공용, 'all' = 전체 보기
export type CodyGenderChoice = '남' | '여' | 'all';

export type CodyGenderSource = 'pending' | 'server' | 'profile' | 'none';

/**
 * v3.230 A4: 필터 기본 성별 결정(순수).
 * - 신규 생성(sheet 모드 + 대상 아티스트 없음): 방금 답한 성별(pending → 같은 흐름의 초안 답)만 사용.
 *   기존 아티스트(서버)·슬롯 프로필 성별은 쓰지 않는다 — 여자 아티스트 보유 계정이 남자 아티스트를
 *   새로 만들 때 '여성용'으로 걸리던 문제(v3.230 ④). 답이 없으면 null(전체).
 * - 대상 있음(재생성·옷 갈아입히기): 대상(서버) 성별 → 답 → 슬롯 프로필(기존 폴백 유지).
 */
export function resolveCodyDefaultGender(p: {
  isNewArtist: boolean;
  pendingGender?: string | null;
  draftGender?: string | null;
  serverGender?: string | null;
  profileGender?: string | null;
}): { gender: '남' | '여' | null; source: CodyGenderSource } {
  if (p.isNewArtist) {
    const g = normalizeArtistGender(p.pendingGender) ?? normalizeArtistGender(p.draftGender);
    return { gender: g, source: g ? 'pending' : 'none' };
  }
  const s = normalizeArtistGender(p.serverGender);
  if (s) return { gender: s, source: 'server' };
  const pg = normalizeArtistGender(p.pendingGender);
  if (pg) return { gender: pg, source: 'pending' };
  const pf = normalizeArtistGender(p.profileGender);
  if (pf) return { gender: pf, source: 'profile' };
  return { gender: null, source: 'none' };
}

/** 선택 → 실제 필터 성별(null = 필터 없음) */
export const codyFilterGender = (choice: CodyGenderChoice): '남' | '여' | null =>
  choice === 'all' ? null : choice;

// ── 세부 분류 ──────────────────────────────────────────────────────────────

export const OTHER = '기타';
export const HAT_OTHER = '베레모/기타';

// BEGIN~END GENERATED 블록은 서버 규칙표에서 생성한다(수작업 이식 시 어긋남 방지).
// 재생성: python3 scripts/gen_taxonomy_ts.py <서버 app/services/item_taxonomy.py> utils/codyCatalog.ts (서버 규칙 변경 시)
// ── BEGIN GENERATED (item_taxonomy.py → gen_taxonomy_ts.py) — 직접 수정하지 말고 재생성 ──
const GEN_SUB_CATEGORIES: Record<string, string[]> = {"상의": ["아우터", "가디건", "후드", "맨투맨", "니트", "원피스", "나시", "티셔츠", "셔츠/블라우스", "기타"], "하의": ["스커트", "반바지", "데님", "슬랙스", "트레이닝/조거", "카고/와이드", "팬츠", "기타"], "신발": ["스니커즈", "부츠", "로퍼/구두", "샌들/슬리퍼", "기타"], "모자": ["볼캡", "버킷햇", "비니", "베레모/기타"], "가방": ["백팩", "크로스백", "토트백", "숄더백", "미니/파우치", "기타"]};
const GEN_SUB_RULES: Record<string, [string, string[], string[], string[]][]> = {
  "상의": [
    ["원피스", ["원피스", "드레스"], ["dress", "one-?piece"], []],
    ["아우터", ["자켓", "재킷", "점퍼", "블루종", "코트", "패딩", "파카", "바람막이", "윈드브레이커", "아노락", "야상", "베스트", "조끼", "트러커", "블레이저", "무스탕", "플리스", "집업", "사파리", "바시티", "봄버", "레더 ?자켓", "숏패딩", "롱패딩", "아우터"], ["jacket", "jumper", "blouson", "coat", "padding", "parka", "windbreaker", "anorak", "vest", "gilet", "trucker", "blazer", "fleece", "zip-?up", "zip up", "bomber", "varsity", "outer", "puffer"], []],
    ["가디건", ["가디건"], ["cardigan"], []],
    ["후드", ["후드", "후디"], ["hood", "hooded", "hoodie", "hoody"], []],
    ["맨투맨", ["맨투맨", "스웨트 ?셔츠", "크루넥", "스웻 ?셔츠"], ["sweat ?shirt", "sweatshirt", "crew ?neck", "crewneck", "mtm"], []],
    ["니트", ["니트", "스웨터", "풀오버", "폴라", "터틀넥", "케이블", "골지 ?니트"], ["knit", "knitted", "sweater", "pullover", "turtle ?neck", "turtleneck", "cable", "fisherman", "cashmere"], []],
    ["나시", ["나시", "슬리브리스", "탱크", "뷔스티에", "캐미솔", "홀터", "민소매"], ["sleeveless", "tank", "bustier", "cami", "camisole", "halter"], []],
    ["티셔츠", ["티셔츠", "티 셔츠"], ["t-?shirt", "t shirt", "tee", "tshirt"], []],
    ["셔츠/블라우스", ["셔츠", "블라우스", "남방"], ["shirt", "blouse", "overshirt"], []],
    ["티셔츠", ["반팔", "긴팔", "롱슬리브", "반소매", "긴소매", "탑", "폴로", "카라", "헨리넥", "저지", "져지", "슬리브", "크롭", "[가-힣]티(?![가-힣])", "(?:^|[^가-힣])티(?![가-힣])"], ["long ?sleeve", "short ?sleeve", "top", "polo", "pk", "henley", "crop", "ss", "ls", "s/s", "l/s", "jersey"], []],
  ],
  "하의": [
    ["스커트", ["스커트", "치마", "(?:^|[^a-za-z가-힣])sk(?![a-za-z])", "[가-힣]sk(?![a-za-z])"], ["skirt", "skort"], []],
    ["반바지", ["반바지", "쇼츠", "숏팬츠", "숏 팬츠", "하프 ?팬츠", "버뮤다", "5부", "3부"], ["shorts", "short", "half ?pants", "bermuda"], []],
    ["데님", ["데님", "청바지", "진청", "연청", "중청", "흑청", "진스", "(?:^|[^가-힣])진(?![가-힣])"], ["denim", "jeans?", "jean"], []],
    ["슬랙스", ["슬랙스", "트라우저", "트라우져", "수트 ?팬츠", "정장 ?바지"], ["slacks", "trousers?", "suit ?pants"], []],
    ["트레이닝/조거", ["트레이닝", "트랙", "조거", "스웨트 ?팬츠", "레깅스", "져지", "저지", "스웻 ?팬츠"], ["training", "track", "jogger", "sweat ?pants", "sweatpants", "leggings?", "jersey"], []],
    ["카고/와이드", ["카고", "와이드", "파라슈트", "벌룬", "부츠컷", "플레어"], ["cargo", "wide", "parachute", "balloon", "boot ?cut", "flare", "baggy"], []],
    ["팬츠", ["팬츠", "바지", "치노", "코튼", "스트레이트", "슬림핏", "밴딩", "[가-힣]pt(?![a-za-z])", "(?:^|[^a-za-z가-힣])pt(?![a-za-z])"], ["pants", "pant", "chino", "cotton", "straight", "trouser", "capri"], []],
  ],
  "신발": [
    ["부츠", ["부츠", "워커", "첼시", "앵클 ?부츠"], ["boots?", "walker", "chelsea"], []],
    ["스니커즈", ["스니커", "운동화"], ["sneakers?"], []],
    ["샌들/슬리퍼", ["샌들", "슬리퍼", "슬라이드", "쪼리", "플립", "뮬", "클로그", "크록스", "아쿠아 ?슈즈", "하바이아나스", "보스턴"], ["sandals?", "slippers?", "slides?", "flip-?flops?", "flip ?flops?", "mules?", "clogs?", "crocs"], []],
    ["로퍼/구두", ["로퍼", "구두", "더비", "옥스포드", "메리제인", "플랫(?!폼)", "펌프스", "힐", "모카신", "보트슈즈", "슬링백", "블로퍼", "정장화", "발레", "왈라비", "1461"], ["loafers?", "derby", "oxfords?", "mary ?janes?", "flats?", "pumps?", "heels?", "moccasins?", "boat ?shoes?", "sling ?back", "ballet", "wallabee"], []],
    ["스니커즈", ["러닝", "트레이너", "캔버스", "하이탑", "로우탑", "코트화", "슬립온", "스케이트", "런닝", "조깅", "에어 ?포스", "에어 ?맥스", "에어 ?조던", "덩크", "코르테즈", "삼바", "가젤", "슈퍼스타", "스탠 ?스미스", "척 ?70", "척 ?테일러", "올스타", "클럽 ?c", "sl ?72", "스피드캣", "페가수스", "젤-", "gt-", "수페르가", "뉴발란스", "하이커", "트레킹"], ["running", "runner", "trainers?", "canvas", "high ?top", "low ?top", "slip-?on", "skate", "court", "hiker", "trekking", "samba", "gazelle", "dunk"], []],
  ],
  "모자": [
    ["버킷햇", ["버킷", "벙거지"], ["bucket"], []],
    ["비니", ["비니", "니트 ?모자", "워치 ?캡", "와치 ?캡"], ["beanie", "watch ?cap"], []],
    ["볼캡", ["볼캡", "캡", "야구 ?모자", "스냅백", "트러커"], ["cap", "ball ?cap", "snapback", "trucker"], []],
    ["베레모/기타", ["베레", "페도라", "헌팅", "바라클라바", "귀도리", "이어", "햇", "썬캡", "바이저", "모자"], ["beret", "fedora", "newsboy", "balaclava", "hat", "visor"], []],
  ],
  "가방": [
    ["백팩", ["백팩", "배낭", "럭색", "데이팩", "짐색", "스트링 ?백"], ["backpack", "rucksack", "daypack", "day ?pack", "gym ?sack", "string ?bag"], []],
    ["미니/파우치", ["파우치", "클러치", "미니백", "미니 ?백", "지갑", "키링", "카드 ?지갑", "폰 ?백", "동전", "카드"], ["pouch", "clutch", "mini ?bag", "wallet", "key ?ring", "card ?holder", "card ?bag", "card", "phone ?bag"], []],
    ["크로스백", ["크로스", "메신저", "슬링", "힙색", "웨이스트", "벨트백", "카메라백", "사코슈"], ["cross", "crossbody", "messenger", "sling", "hip ?sack", "waist", "belt ?bag", "sacoche"], []],
    ["토트백", ["토트", "쇼퍼", "에코백", "캔버스백", "캔버스 ?백", "장바구니", "볼링"], ["tote", "shopper", "eco ?bag", "canvas ?bag", "bowling"], []],
    ["숄더백", ["숄더", "호보", "바게트", "언더암", "보스턴", "더플", "버킷백"], ["shoulder", "hobo", "baguette", "underarm", "boston", "duffle", "bucket ?bag"], []],
  ],
};
const GEN_COLOR_FAMILIES: string[] = ["블랙", "화이트", "아이보리/크림", "그레이", "네이비", "블루", "베이지/브라운", "그린", "레드/버건디", "핑크", "퍼플", "옐로/오렌지", "멀티"];
const GEN_COLOR_TOKENS: [string, string[], string[], boolean][] = [
  ["블랙", ["블랙", "검정", "검은", "먹색"], ["black", "ink", "caviar", "jet", "onyx", "noir"], false],
  ["화이트", ["화이트", "흰색", "하얀", "백색", "오프화이트", "오프 화이트", "화이트멜란지", "화이트 멜란지"], ["white", "off ?white", "salt", "snow"], false],
  ["아이보리/크림", ["아이보리", "크림(?!치즈)", "에크루", "오트밀", "내추럴", "내츄럴", "바닐라", "밀크", "소다"], ["ivory", "cream", "ecru", "oatmeal", "natural", "vanilla", "milk", "bone", "eggshell"], false],
  ["그레이", ["그레이", "회색", "차콜", "챠콜", "실버", "애쉬", "그라파이트", "그레이쉬", "그레이지", "멜란지그레이"], ["gr[ae]y", "charcoal", "silver", "ash", "ashgr[ae]y", "graphite", "pewter", "dove", "greige", "heather", "darkgr[ae]y", "lightgr[ae]y", "drakgr[ae]y", "slate", "smoke"], false],
  ["그레이", ["멜란지"], ["melange"], true],
  ["네이비", ["네이비", "곤색", "남색"], ["navy", "darknavy", "lightnavy", "midnight"], false],
  ["블루", ["블루(?!종)", "스카이", "인디고", "진청", "연청", "중청", "코발트", "하늘색", "파랑", "라이트블루", "스카이블루"], ["blue", "sky", "skyblue", "lightblue", "indigo", "cobalt", "royal", "ocean", "pacific", "aqua", "turquoise", "cyan", "smurf"], false],
  ["블루", ["데님", "청(?![가-힣])"], ["denim", "raw"], true],
  ["베이지/브라운", ["베이지", "브라운", "카멜", "탄(?![가-힣])", "토프", "모카(?!신)", "초코", "초콜릿", "에스프레소", "커피", "샌드", "마론", "카라멜", "캐러멜", "코코아", "갈색", "밤색", "스톤", "피칸", "월넛", "라떼"], ["beige", "brown", "camel", "tan", "taupe", "etope", "mocha", "choco", "chocolate", "espresso", "coffee", "sand", "khaki ?brown", "mahogany", "pecan", "caramel", "cocoa", "stone", "walnut", "latte", "tortoise", "cognac", "chestnut", "toffee", "biscuit", "lightbeige", "darkbeige"], false],
  ["그린", ["그린", "올리브", "카키", "민트", "세이지", "바질", "청록", "초록", "녹색", "라임", "포레스트"], ["green", "olive", "khaki", "mint", "sage", "basil", "teal", "lime", "forest", "pine", "emerald", "bluegreen", "army", "camo"], false],
  ["레드/버건디", ["레드", "버건디", "와인", "빨강", "빨간", "체리", "자주", "마룬"], ["red", "burgundy", "wine", "cherry", "maroon", "crimson", "scarlet", "brick", "oxblood", "bordeaux"], false],
  ["핑크", ["핑크", "로즈", "피치", "코랄", "딸기", "살몬", "연분홍", "분홍"], ["pink", "rose", "peach", "coral", "strawberry", "salmon", "blush", "fuchsia", "magenta"], false],
  ["퍼플", ["퍼플", "바이올렛", "라벤더", "라일락", "보라", "퍼플리쉬"], ["purple", "violet", "lavender", "lilac", "plum", "mauve"], false],
  ["옐로/오렌지", ["옐로", "옐로우", "노랑", "레몬", "버터", "오렌지", "머스타드", "골드", "주황", "귤"], ["yellow", "lemon", "butter", "orange", "mustard", "gold", "amber", "tangerine", "apricot"], false],
  ["멀티", ["멀티", "배색", "레오파드", "호피", "카모플라쥬"], ["multi", "multicolou?r", "leopard", "rainbow"], false],
];
const GEN_COLOR_RESIDUE = "^(?:기본|단일\\s*색상|단일|색상\\s*없음|없음|none|n/?a|-|free|one\\s*size|onesize|women|men|woman|man|unisex|long|short|regular|small|medium|large|xs|s|m|l|xl|xxl|os|default|색상미표기_?\\d*)$";
const GEN_MULTI_SEP = "\\+|&|(?:^|[^a-z])and(?![a-z])|,|/";
// ── END GENERATED ──

// 카테고리별 대분류 칩 노출 순서(서버 SUB_CATEGORIES와 동일)
export const SUB_CATEGORIES = GEN_SUB_CATEGORIES as Record<Cat, string[]>;

/** 한글 토큰 = 부분 문자열, 영문 토큰 = ASCII 단어 경계(+복수형 s/es), raw = 그대로 */
function rx(ko: string[], en: string[], raw: string[]): RegExp {
  const alts: string[] = [];
  if (ko.length) alts.push(`(?:${ko.join('|')})`);
  if (en.length) alts.push(`(?:^|[^a-z])(?:${en.join('|')})(?:e?s)?(?![a-z])`);
  alts.push(...raw);
  return new RegExp(alts.join('|'));
}

// (label, pattern) — 위에서부터 첫 매칭 채택. 순서가 의미를 가진다(티셔츠 > 셔츠, 맨투맨 > 셔츠).
const SUB_RULES: Record<string, [string, RegExp][]> = Object.fromEntries(
  Object.entries(GEN_SUB_RULES).map(([cat, rules]) => [
    cat,
    rules.map(([label, ko, en, raw]) => [label, rx(ko, en, raw)] as [string, RegExp]),
  ]),
);

const norm = (s?: string | null) => (s || '').trim();

/** 상품명 규칙 세부 분류 — product_name 우선, 실패하면 name. 알 수 없는 category면 '기타'. */
export function classifySubCategory(category?: string | null, name?: string | null, productName?: string | null): string {
  const cat = norm(category) as Cat;
  const rules = SUB_RULES[cat];
  if (!rules) return OTHER;
  const fallback = cat === '모자' ? HAT_OTHER : OTHER;
  const seen = new Set<string>();
  for (const raw of [norm(productName), norm(name)]) {
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);
    const text = raw.toLowerCase();
    for (const [label, re] of rules) {
      if (re.test(text)) return label;
    }
  }
  return fallback;
}

// ── 색상 ──────────────────────────────────────────────────────────────────

export const MULTI = '멀티';
export const COLOR_FAMILIES = GEN_COLOR_FAMILIES;
// 스와치 표시색(멀티는 UI에서 그라데이션 대신 분할 원으로 표현 — 대표색만 둠)
export const COLOR_SWATCHES: Record<string, string> = {
  '블랙': '#111111',
  '화이트': '#FFFFFF',
  '아이보리/크림': '#F3EBD8',
  '그레이': '#9A9A9A',
  '네이비': '#1F2A4D',
  '블루': '#3D7BE0',
  '베이지/브라운': '#A57C52',
  '그린': '#4C8B4A',
  '레드/버건디': '#B3263A',
  '핑크': '#F29CB7',
  '퍼플': '#8A5CC7',
  '옐로/오렌지': '#F2B233',
  [MULTI]: '#C9A0DC',
};

// color 필드의 파싱 잔재·무의미 값 → "" (표시 숨김). 입력은 소문자로 비교.
const COLOR_RESIDUE_RE = new RegExp(GEN_COLOR_RESIDUE);

// 한글 정규식은 매치 위치 그대로, 영문 정규식은 그룹1(접두 문자) 길이만큼 시작 위치 보정
const COLOR_RX = GEN_COLOR_TOKENS.map(([fam, ko, en, weak]) => ({
  fam,
  weak,
  ko: ko.length ? new RegExp(`(?:${ko.join('|')})`, 'g') : null,
  en: en.length ? new RegExp(`(^|[^a-z])(${en.join('|')})(?![a-z])`, 'g') : null,
}));
const MULTI_SEP_RE = new RegExp(GEN_MULTI_SEP);

type Hit = { start: number; end: number; fam: string; weak: boolean };

function familiesIn(text: string): { strong: [number, string][]; weak: [number, string][] } {
  const hits: Hit[] = [];
  for (const c of COLOR_RX) {
    if (c.ko) {
      c.ko.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = c.ko.exec(text))) {
        if (m[0].length === 0) { c.ko.lastIndex++; continue; }
        hits.push({ start: m.index, end: m.index + m[0].length, fam: c.fam, weak: c.weak });
      }
    }
    if (c.en) {
      c.en.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = c.en.exec(text))) {
        const start = m.index + m[1].length;
        const end = start + m[2].length;
        if (end > start) hits.push({ start, end, fam: c.fam, weak: c.weak });
        // 접두 문자를 소비했으므로 다음 탐색은 토큰 끝에서 — 인접 토큰("red/blue")도 잡힌다
        c.en.lastIndex = end;
      }
    }
  }
  // 겹침 제거: 길이 내림차순(같으면 앞선 것) 채택, 이미 채택된 구간과 겹치면 버림
  hits.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);
  const taken: Hit[] = [];
  for (const h of hits) {
    if (taken.some((t) => !(h.end <= t.start || h.start >= t.end))) continue;
    taken.push(h);
  }
  const byEnd = (a: [number, string], b: [number, string]) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);
  const strong = taken.filter((t) => !t.weak).map((t) => [t.end, t.fam] as [number, string]).sort(byEnd);
  const weak = taken.filter((t) => t.weak).map((t) => [t.end, t.fam] as [number, string]).sort(byEnd);
  return { strong, weak };
}

function familyFromText(text: string): string | null {
  if (!text) return null;
  const { strong, weak } = familiesIn(text);
  const famsStrong = strong.map(([, f]) => f);
  if (famsStrong.includes(MULTI)) return MULTI;
  const distinct: string[] = [];
  for (const f of famsStrong) if (!distinct.includes(f)) distinct.push(f);
  if (distinct.length >= 3) return MULTI;
  if (distinct.length >= 2 && MULTI_SEP_RE.test(text)) return MULTI;
  // 머리명사 규칙: 마지막 색 토큰이 기본 계열("sky blue"→블루, "카키브라운"→브라운)
  if (strong.length) return strong[strong.length - 1][1];
  if (weak.length) return weak[weak.length - 1][1];
  return null;
}

/** 표시용 color: 잔재·무의미 값은 빈 문자열, 그 외는 trim한 원문 */
export function cleanColor(color?: string | null): string {
  const c = norm(color);
  if (!c) return '';
  if (COLOR_RESIDUE_RE.test(c.toLowerCase())) return '';
  return c;
}

/** 13계열 색상 계열. color가 비었거나 잔재면 상품명에서 추출(단일 계열일 때만). 판정 불가 null. */
export function colorFamily(color?: string | null, name?: string | null, productName?: string | null): string | null {
  const c = cleanColor(color);
  if (c) {
    const fam = familyFromText(c.toLowerCase());
    if (fam) return fam;
  }
  for (const raw of [norm(productName), norm(name)]) {
    if (!raw) continue;
    const { strong, weak } = familiesIn(raw.toLowerCase());
    const fams: string[] = [];
    for (const [, f] of strong) if (!fams.includes(f)) fams.push(f);
    if (fams.length === 1) return fams[0];
    if (fams.length > 1) return null;
    if (weak.length && new Set(weak.map(([, f]) => f)).size === 1) return weak[weak.length - 1][1];
  }
  return null;
}

/** 매퍼가 쓰는 파생 필드 보강 — 서버가 준 값(sub_category·color_family)은 그대로 둔다 */
export function enrichItem(item: AdItem, cat: Cat): AdItem {
  const category = item.category || cat;
  return {
    ...item,
    category,
    color: cleanColor(item.color),
    sub_category: item.sub_category || classifySubCategory(category, item.name, item.product_name),
    color_family: item.color_family !== undefined
      ? item.color_family
      : colorFamily(item.color, item.name, item.product_name),
    price_krw: typeof item.price_krw === 'number' && item.price_krw > 0 ? item.price_krw : null,
  };
}

// ── 가격 ──────────────────────────────────────────────────────────────────

export const PRICE_BUCKETS: { key: string; label: string; min: number; max: number }[] = [
  { key: 'u3', label: '~3만원', min: 0, max: 30000 },
  { key: '3to5', label: '3~5만원', min: 30000, max: 50000 },
  { key: '5to10', label: '5~10만원', min: 50000, max: 100000 },
  { key: 'o10', label: '10만원~', min: 100000, max: Number.POSITIVE_INFINITY },
];

export function priceBucketOf(price?: number | null): string | null {
  if (typeof price !== 'number' || !(price > 0)) return null;
  const b = PRICE_BUCKETS.find((x) => price >= x.min && price < x.max);
  return b ? b.key : null;
}

/** 72000 → "72,000원" (Intl 의존 없이) */
export function formatPrice(price?: number | null): string {
  if (typeof price !== 'number' || !(price > 0)) return '';
  return `${String(Math.round(price)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}원`;
}

// ── 보기·필터 상태 ─────────────────────────────────────────────────────────

export type CodyViewMode = 'group' | 'all';   // 브랜드 모아보기 | 브랜드 펼쳐보기
export type CodySort = 'rec' | 'low' | 'high'; // 추천순 | 낮은 가격순 | 높은 가격순

export interface CodyViewState {
  mode: CodyViewMode;
  sort: CodySort;
  sub: string | null;        // 대분류(null = 전체)
  colors: string[];          // 색상 계열 다중
  prices: string[];          // 가격 구간 키 다중
  brands: string[];          // 브랜드 다중(펼쳐보기 전용)
  groupBrand: string | null; // 모아보기에서 들어간 브랜드(피커 열 때 초기화)
}

export const DEFAULT_VIEW: CodyViewState = {
  mode: 'group', sort: 'rec', sub: null, colors: [], prices: [], brands: [], groupBrand: null,
};

type FilterKey = 'sub' | 'colors' | 'prices' | 'brands';

/**
 * 대분류·색상·가격·브랜드 필터(성별은 호출 전에 적용). `skip`으로 한 축을 빼면 그 축의 패싯 개수 계산용.
 * - 색상 필터가 켜지면 색상 정보 없는 상품 제외, 가격 필터가 켜지면 가격 없는 상품 제외.
 * - 브랜드 필터는 펼쳐보기(mode='all')에서만 적용.
 */
export function applyFilters(items: AdItem[], v: CodyViewState, skip?: FilterKey): AdItem[] {
  const colorSet = skip !== 'colors' && v.colors.length ? new Set(v.colors) : null;
  const priceSet = skip !== 'prices' && v.prices.length ? new Set(v.prices) : null;
  const brandSet = skip !== 'brands' && v.mode === 'all' && v.brands.length ? new Set(v.brands) : null;
  const sub = skip !== 'sub' ? v.sub : null;
  return items.filter((i) => {
    if (sub && (i.sub_category || OTHER) !== sub) return false;
    if (colorSet && !(i.color_family && colorSet.has(i.color_family))) return false;
    if (priceSet) {
      const b = priceBucketOf(i.price_krw);
      if (!b || !priceSet.has(b)) return false;
    }
    if (brandSet && !brandSet.has(brandOf(i))) return false;
    return true;
  });
}

/** 활성 필터 축 개수(배지) — 대분류 칩과 성별 칩은 별도 표시라 제외 */
export function activeFilterCount(v: CodyViewState): number {
  return (v.colors.length ? 1 : 0) + (v.prices.length ? 1 : 0) + (v.mode === 'all' && v.brands.length ? 1 : 0);
}

export interface FacetCount { key: string; label: string; count: number }

/** 대분류 칩 — 서버 순서(order, catalog의 sub_categories) 우선·없으면 앱 규칙 순서, 0건 숨김 */
export function subCategoryFacets(items: AdItem[], cat: Cat, order?: string[] | null): FacetCount[] {
  const counts = new Map<string, number>();
  for (const i of items) {
    const k = i.sub_category || OTHER;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const seq = order && order.length ? order : SUB_CATEGORIES[cat] || [];
  const out: FacetCount[] = [];
  for (const k of seq) if (counts.get(k)) out.push({ key: k, label: k, count: counts.get(k)! });
  for (const [k, n] of counts) if (!seq.includes(k)) out.push({ key: k, label: k, count: n });
  return out;
}

export function colorFacets(items: AdItem[]): FacetCount[] {
  const counts = new Map<string, number>();
  for (const i of items) if (i.color_family) counts.set(i.color_family, (counts.get(i.color_family) || 0) + 1);
  return COLOR_FAMILIES.filter((f) => counts.get(f)).map((f) => ({ key: f, label: f, count: counts.get(f)! }));
}

export function priceFacets(items: AdItem[]): FacetCount[] {
  const counts = new Map<string, number>();
  for (const i of items) {
    const b = priceBucketOf(i.price_krw);
    if (b) counts.set(b, (counts.get(b) || 0) + 1);
  }
  return PRICE_BUCKETS.filter((b) => counts.get(b.key)).map((b) => ({ key: b.key, label: b.label, count: counts.get(b.key)! }));
}

/** 브랜드 패싯 — 상품 수 내림차순, 같으면 이름순 */
export function brandFacets(items: AdItem[]): FacetCount[] {
  const counts = new Map<string, number>();
  for (const i of items) {
    const b = brandOf(i);
    counts.set(b, (counts.get(b) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k, n]) => ({ key: k, label: k, count: n }));
}

export interface BrandGroup { brand: string; count: number; thumbs: AdItem[] }

/** 모아보기 — 브랜드별 그룹(상품 수 내림차순), 썸네일은 이미지 있는 상품 우선 3장 */
export function groupByBrand(items: AdItem[]): BrandGroup[] {
  const map = new Map<string, AdItem[]>();
  for (const i of items) {
    const b = brandOf(i);
    const arr = map.get(b);
    if (arr) arr.push(i);
    else map.set(b, [i]);
  }
  return [...map.entries()]
    .map(([brand, arr]) => ({
      brand,
      count: arr.length,
      thumbs: [...arr.filter((i) => !!i.image_object_name), ...arr.filter((i) => !i.image_object_name)].slice(0, 3),
    }))
    .sort((a, b) => b.count - a.count || a.brand.localeCompare(b.brand));
}

/** 정렬 — 추천순은 원래 순서(서버 source_rank), 가격순은 가격 없는 상품을 뒤로(안정 정렬) */
export function sortItems(items: AdItem[], sort: CodySort): AdItem[] {
  if (sort === 'rec') return items;
  const withIdx = items.map((it, idx) => ({ it, idx }));
  withIdx.sort((a, b) => {
    const pa = typeof a.it.price_krw === 'number' && a.it.price_krw > 0 ? a.it.price_krw : null;
    const pb = typeof b.it.price_krw === 'number' && b.it.price_krw > 0 ? b.it.price_krw : null;
    if (pa === null && pb === null) return a.idx - b.idx;
    if (pa === null) return 1;
    if (pb === null) return -1;
    return (sort === 'low' ? pa - pb : pb - pa) || a.idx - b.idx;
  });
  return withIdx.map((x) => x.it);
}

/** v3.123: 기선택 아이템을 맨 앞으로 */
export function pinPicked<T extends { id: string }>(items: T[], pickedId?: string): T[] {
  if (!pickedId) return items;
  const idx = items.findIndex((i) => i.id === pickedId);
  if (idx <= 0) return items;
  return [items[idx], ...items.slice(0, idx), ...items.slice(idx + 1)];
}
