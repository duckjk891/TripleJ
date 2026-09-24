"""서버 꾸미기 분류 규칙표 → 앱 규칙표 생성기 (MAIDOL v3.227 D).

용도
  서버 app/services/item_taxonomy.py 의 세부 분류(sub_category) 규칙·색상 계열(color_family 13종)
  토큰표·색상 잔재 정규식을 읽어, 앱 utils/codyCatalog.ts 안의
  "BEGIN GENERATED ~ END GENERATED" 블록을 다시 써 준다. 앱은 서버 catalog 응답에 분류 값이 없을 때
  (구서버 /ads/active 폴백·SAMPLE) 이 규칙으로 직접 계산하므로, 서버와 앱 규칙이 반드시 같아야 한다.

실행법 (2_housing 폴더에서)
  python3 scripts/gen_taxonomy_ts.py <item_taxonomy.py> utils/codyCatalog.ts

주의
  - 서버 규칙(item_taxonomy.py)이 바뀌면 반드시 이 스크립트로 재생성한다(생성 블록 직접 수정 금지).
  - 변환 규칙: lookbehind (?<![...]) → (?:^|[^...]) (Hermes·구형 Safari 호환), 모든 토큰 소문자화
    (앱은 입력을 소문자로 바꿔 매칭).
  - 재생성 후 npx tsc --noEmit 과 서버 골든 케이스 대조를 다시 확인한다.
"""
import json, re, sys
src = open(sys.argv[1], encoding='utf-8').read()
stub = "def _rx(ko=(), en=(), raw=()):\n    return ('RX', list(ko), list(en), list(raw))\n"
src = src.replace('def _rx(', 'def _rx_orig(', 1)
i = src.index('_RULES = {')
src = src[:i] + stub + src[i:]
ns = {'__name__': 'taxgen'}
exec(compile(src, 'item_taxonomy', 'exec'), ns)

LB = re.compile(r'\(\?<!\[([^\]]+)\]\)')
def conv(tok):
    t = LB.sub(lambda m: '(?:^|[^' + m.group(1) + '])', tok)
    assert '(?<' not in t, tok
    # 대문자 범위 A-Z 는 소문자화 후 a-z 와 중복 — 그대로 소문자화해도 의미 동일
    return t.lower()

out = []
out.append('// ── BEGIN GENERATED (item_taxonomy.py → gen_taxonomy_ts.py) — 직접 수정하지 말고 재생성 ──')
subs = ns['SUB_CATEGORIES']
out.append('const GEN_SUB_CATEGORIES: Record<string, string[]> = ' + json.dumps(subs, ensure_ascii=False) + ';')
out.append('const GEN_SUB_RULES: Record<string, [string, string[], string[], string[]][]> = {')
for cat, rules in ns['_RULES'].items():
    out.append('  %s: [' % json.dumps(cat, ensure_ascii=False))
    for label, spec in rules:
        _, ko, en, raw = spec
        out.append('    [%s, %s, %s, %s],' % (json.dumps(label, ensure_ascii=False),
            json.dumps([conv(x) for x in ko], ensure_ascii=False),
            json.dumps([conv(x) for x in en], ensure_ascii=False),
            json.dumps([conv(x) for x in raw], ensure_ascii=False)))
    out.append('  ],')
out.append('};')
out.append('const GEN_COLOR_FAMILIES: string[] = ' + json.dumps(ns['COLOR_FAMILIES'], ensure_ascii=False) + ';')
out.append('const GEN_COLOR_TOKENS: [string, string[], string[], boolean][] = [')
for fam, ko, en, weak in ns['_COLOR_TOKENS']:
    out.append('  [%s, %s, %s, %s],' % (json.dumps(fam, ensure_ascii=False),
        json.dumps([conv(x) for x in ko], ensure_ascii=False),
        json.dumps([conv(x) for x in en], ensure_ascii=False), 'true' if weak else 'false'))
out.append('];')
out.append('const GEN_COLOR_RESIDUE = ' + json.dumps(conv(ns['_COLOR_RESIDUE_RE'].pattern), ensure_ascii=False) + ';')
out.append('const GEN_MULTI_SEP = ' + json.dumps(conv(ns['_MULTI_SEP_RE'].pattern), ensure_ascii=False) + ';')
out.append('// ── END GENERATED ──')
block = '\n'.join(out)

ts_path = sys.argv[2]
ts = open(ts_path, encoding='utf-8').read()
a = ts.index('// ── BEGIN GENERATED'); b = ts.index('// ── END GENERATED ──') + len('// ── END GENERATED ──')
ts = ts[:a] + block + ts[b:]
open(ts_path, 'w', encoding='utf-8').write(ts)
print('ok', sum(len(r) for r in ns['_RULES'].values()), 'rules', len(ns['_COLOR_TOKENS']), 'color tokens')
