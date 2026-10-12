// 명함 QR 만들기 — 곡마다 다른 QR(https://maidol.ai.kr/c/{곡ID}).
// 이 주소는 MAIDOL이 관리하는 주소라, 나중에 연결 목적지(곡 공유 화면 → 스토어 등)를 바꿔도 인쇄한 QR은 그대로 쓴다.
// 사용: node make_card_qr.js <곡ID> <파일이름> [<곡ID> <파일이름> ...]
//   예: node make_card_qr.js 6ac98a0d2d98f000091eb49e 분신술
// 출력: design_assets/qr/<파일이름>_QR.svg (벡터 — 일러스트레이터에서 열어 색·크기 자유롭게, 인쇄 시 2cm 이상 권장)
const fs = require('fs');
const path = require('path');
const qrcode = require('/Users/pearl/TripleJ/2_housing/node_modules/qrcode-generator');

const OUT = path.join(__dirname, '..', 'qr');
const MARGIN = 4; // QR 표준 여백(칸)

function svgFor(url) {
  const qr = qrcode(0, 'Q'); // 오류 복원 Q(약 25%) — 인쇄 얼룩·접힘에 강함
  qr.addData(url);
  qr.make();
  const n = qr.getModuleCount();
  const size = n + MARGIN * 2;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + MARGIN} ${r + MARGIN}h1v1h-1z`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size * 10}" height="${size * 10}" shape-rendering="crispEdges">
  <title>${url}</title>
  <g id="QR_배경"><rect width="${size}" height="${size}" fill="#FFFFFF"/></g>
  <g id="QR_코드"><path d="${d}" fill="#000000"/></g>
</svg>
`;
}

const args = process.argv.slice(2);
if (args.length < 2 || args.length % 2) { console.error('사용: node make_card_qr.js <곡ID> <파일이름> ...'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });
for (let i = 0; i < args.length; i += 2) {
  const id = args[i], name = args[i + 1];
  if (!/^[0-9a-f]{24}$/i.test(id)) { console.error('곡ID 형식 오류:', id); process.exit(1); }
  const url = `https://maidol.ai.kr/c/${id}`;
  const file = path.join(OUT, `${name}_QR.svg`);
  fs.writeFileSync(file, svgFor(url));
  console.log('만듦', file, '→', url);
}
