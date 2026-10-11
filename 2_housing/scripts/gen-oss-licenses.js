// v3.334 [OssLicenses] 앱에 포함되는(운영 의존성) 오픈소스 목록·라이선스 고지 생성 → constants/ossLicenses.json
// 실행: node scripts/gen-oss-licenses.js  (의존성 추가·업데이트 후 다시 실행)
// MIT·BSD·Apache 등은 배포물에 저작권·라이선스 고지를 포함하라고 요구한다 → 설정 「오픈소스 라이선스」 화면이 이 파일을 보여준다.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const out = execSync('npm ls --omit=dev --all --parseable', { cwd: root, maxBuffer: 64 * 1024 * 1024 }).toString();
const dirs = [...new Set(out.split('\n').map((s) => s.trim()).filter((p) => p && p !== root))];

const LICENSE_FILES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'license.md', 'LICENCE', 'LICENSE-MIT', 'COPYING'];
const pkgs = new Map();
const texts = {};

for (const dir of dirs) {
  let pj;
  try { pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch { continue; }
  if (!pj.name || pj.private && !pj.version) continue;
  let lic = typeof pj.license === 'string' ? pj.license : (pj.license && pj.license.type) || (Array.isArray(pj.licenses) ? pj.licenses.map((l) => l.type || l).join(' OR ') : '');
  lic = lic || 'UNKNOWN';
  let fileText = '';
  for (const f of LICENSE_FILES) {
    const p = path.join(dir, f);
    if (fs.existsSync(p)) { fileText = fs.readFileSync(p, 'utf8'); break; }
  }
  const copyright = [...new Set(fileText.split('\n').map((l) => l.trim()).filter((l) => /^(copyright|\(c\)|©)/i.test(l)))].slice(0, 3).join(' / ');
  const key = `${pj.name}@${pj.version}`;
  if (!pkgs.has(key)) pkgs.set(key, { n: pj.name, v: pj.version, l: lic, c: copyright || (pj.author ? `Copyright (c) ${typeof pj.author === 'string' ? pj.author : pj.author.name || ''}`.trim() : '') });
  // 라이선스 종류별 전문 1부(저작권 줄 제외)
  if (fileText && !texts[lic] && lic.length < 40) {
    texts[lic] = fileText.split('\n').filter((l) => !/^\s*(copyright|\(c\)|©)/i.test(l.trim())).join('\n').trim().slice(0, 12000);
  }
}

const packages = [...pkgs.values()].sort((a, b) => a.n.localeCompare(b.n));
const data = { generatedAt: new Date().toISOString().slice(0, 10), count: packages.length, packages, texts };
fs.writeFileSync(path.join(root, 'constants', 'ossLicenses.json'), JSON.stringify(data));
const byLic = {};
packages.forEach((p) => { byLic[p.l] = (byLic[p.l] || 0) + 1; });
console.log('packages', packages.length, 'bytes', JSON.stringify(data).length, byLic);
