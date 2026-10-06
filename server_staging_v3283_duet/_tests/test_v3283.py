"""v3.283 duet normalization unit test — NO network (--network none), Suno httpx mocked."""
import asyncio, json, re, sys, logging
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s", stream=sys.stdout)
for n in ("httpx",): logging.getLogger(n).setLevel(logging.WARNING)
from app.services import suno_generator as NEW
from app.services import suno_generator_orig as OLD

data = json.load(open("/t/samples2.json"))
FAILS = []
def check(cond, msg):
    if not cond:
        FAILS.append(msg); print("  FAIL:", msg)

PAREN_RE = re.compile(r"\((whisper|spoken|ad-lib|echo|harmon|falsetto)", re.I)
TAGMOD_RE = re.compile(r"\[[A-Za-z\- ]+\d?:[^\]]+\]")
LBL = re.compile(r"^\s*\[\s*(male|female|both)\s*\]\s*", re.I)
VT = {v: k for k, v in NEW.DUET_VOCAL_TAG_TEXT.items()}

def expected_seq(text):
    """원본 → [(section_name or None, lyric_text, speaker)] (헤더/=== 제외, 라벨은 같은 섹션 내 상속)."""
    out = []; sec = None; spk = None; skip_sep = False
    for ln in text.split("\n"):
        s = ln.strip()
        if not s: continue
        if NEW._DUET_HEADER_RE.match(ln): skip_sep = True; continue
        if skip_sep and s == "===": skip_sep = False; continue
        skip_sep = False
        m = LBL.match(ln)
        if not m and NEW._is_section_tag_line(s):
            sec = NEW._TAG_LINE_RE.match(s).group(1).split(":")[0].strip(); spk = None; continue
        if m:
            spk = m.group(1).lower(); rest = ln[m.end():]
            if not rest.strip(): continue
            ln = m.group(0)[:len(m.group(0)) - len(m.group(0).lstrip())] + rest if False else rest
        out.append((sec, ln.strip(), spk))
    return out

def parsed_seq(text):
    """정규화본 → 같은 형식. 섹션 태그 수식어/단독 보컬 태그로 화자 복원. 빈 섹션/빈 보컬태그 검사."""
    out = []; sec = None; spk = None; issues = []
    pending = None  # 가사가 뒤따라야 하는 태그
    for ln in text.split("\n"):
        s = ln.strip()
        if not s: continue
        m = NEW._TAG_LINE_RE.match(s)
        if m:
            inner = m.group(1).strip()
            if inner in VT:  # 단독 보컬 태그
                if pending and pending[0] == "vocal": issues.append("empty vocal tag before " + s)
                spk = VT[inner]; pending = ("vocal", s); continue
            if pending and pending[0] == "vocal": issues.append("vocal tag w/o lyrics: " + pending[1])
            name, _, mods = inner.partition(":")
            sec = name.strip(); spk = None; pending = ("sec", s)
            for k, v in VT.items():
                if mods.strip().startswith(k): spk = v
            if spk is None and re.match(r"\s*duet\b", mods, re.I): spk = "both"  # 기존 보컬 수식어 유지 케이스
            continue
        if LBL.match(ln): issues.append("label remains: " + s)
        if s.lower().startswith("[this song is") or s == "===": issues.append("header remains: " + s)
        pending = None
        out.append((sec, s, spk))
    if pending and pending[0] == "vocal": issues.append("trailing vocal tag: " + pending[1])
    return out, issues

def sec_tags_with_lyrics(text):
    res = []; cur = None; cnt = 0
    for ln in text.split("\n"):
        s = ln.strip()
        if not s: continue
        m = NEW._TAG_LINE_RE.match(s)
        if m and m.group(1).strip() not in VT and not LBL.match(s) and not s.lower().startswith("[this song is"):
            if cur is not None: res.append((cur, cnt))
            cur = m.group(1).split(":")[0].strip(); cnt = 0
        elif s != "===" and not (m and m.group(1).strip() in VT) and not s.lower().startswith("[this song is"):
            if LBL.match(s) and not LBL.sub("", s).strip(): continue
            cnt += 1
    if cur is not None: res.append((cur, cnt))
    return res

print("=" * 70, "\nA. DUET", len(data["duet"]))
for g in data["duet"]:
    L = g["lyrics"]
    out, st = NEW._normalize_duet_lyrics_for_suno(L)
    exp = expected_seq(L)
    got, issues = parsed_seq(out)
    print(f"- {g['id'][:8]} {g['status']:9s} stats={st}")
    check(st["duet"], f"{g['id']} not detected duet")
    check(not issues, f"{g['id']} issues={issues[:3]}")
    check([(a, b) for a, b, _ in exp] == [(a, b) for a, b, _ in got], f"{g['id']} lyric text/section sequence differs")
    mism = [(e, o) for e, o in zip(exp, got) if e[2] != o[2]]
    check(not mism, f"{g['id']} speaker mismatch {mism[:3]}")
    # 섹션: 원본의 가사 있는 섹션 = 정규화본의 가사 있는 섹션(이름·줄수), 빈 섹션 새로 생기지 않음
    so, sn = sec_tags_with_lyrics(L), sec_tags_with_lyrics(out)
    check(so == sn, f"{g['id']} section/line counts differ {so} vs {sn}")
    check(sum(1 for _, c in sn if c == 0) == sum(1 for _, c in so if c == 0), f"{g['id']} empty section count changed")

print("=" * 70, "\nB. SOLO byte-identical", len(data["solo"]))
for g in data["solo"]:
    L = g["lyrics"]
    out, st = NEW._normalize_duet_lyrics_for_suno(L)
    ip = bool(PAREN_RE.search(L)); tm = bool(TAGMOD_RE.search(L))
    print(f"- {g['id'][:8]} duet={st['duet']} identical={out == L} same_obj={out is L} inline_paren={ip} tag_mod={tm}")
    check(out == L and not st["duet"], f"solo {g['id']} changed")

print("=" * 70, "\nC. Synthetic edge cases")
cases = {
 "switch_mid_section": "[Verse 1]\n[Male] a\nb\n[Female] c\nd\n\n[Chorus]\n[Both] e\n[Both] f",
 "existing_mod": "[Verse 1: soft, whispered]\n[Female] a\n[Female] b",
 "existing_vocal_mod": "[Chorus: Duet]\n[Both] a",
 "unlabeled_first": "[Verse]\na\n[Male] b",
 "no_section_tags": "[This song is a duet featuring one male vocalist and one female vocalist]\n===\n[Male] a\n[Female] b",
 "standalone_label": "[Bridge]\n[Female]\na\nb\n[Male]\nc",
 "empty_intro": "[This song is a duet featuring one male vocalist and one female vocalist]\n===\n\n[Intro]\n\n[Verse]\n[Male] a",
 "inline_paren_kept": "[Verse]\n[Male] a (whisper)\n(spoken) b",
 "lowercase_label": "[Verse]\n[male] a\n[FEMALE] b",
}
for name, t in cases.items():
    out, st = NEW._normalize_duet_lyrics_for_suno(t)
    print(f"--- {name} {st}\n{out}")
    got, issues = parsed_seq(out)
    check(not issues, f"{name} issues {issues}")
    exp = expected_seq(t)
    check([(b, c) for _, b, c in exp] == [(b, c) for _, b, c in got], f"{name} seq mismatch {exp} vs {got}")
check("[Verse 1: Male Vocal]\na\nb\n[Female Vocal]\nc" in NEW._normalize_duet_lyrics_for_suno(cases["switch_mid_section"])[0], "switch format")
check(NEW._normalize_duet_lyrics_for_suno(cases["existing_mod"])[0].startswith("[Verse 1: Female Vocal, soft, whispered]"), "mod format")
check(NEW._normalize_duet_lyrics_for_suno(cases["existing_vocal_mod"])[0].startswith("[Chorus: Duet]\na"), "keep vocal mod")
check("(whisper)" in NEW._normalize_duet_lyrics_for_suno(cases["inline_paren_kept"])[0], "paren kept")

print("=" * 70, "\nD. generate_music_suno end-to-end (httpx mocked, captured body) OLD vs NEW")
class _Stop(Exception): pass
CAP = {}
class FakeClient:
    def __init__(self, *a, **k): pass
    async def __aenter__(self): return self
    async def __aexit__(self, *a): return False
    async def post(self, url, headers=None, json=None):
        CAP["body"] = json; CAP["url"] = url; raise _Stop()
    async def get(self, *a, **k): raise _Stop()
class _Coll:
    async def find_one(self, *a, **k): return None
    async def update_one(self, *a, **k): return None
class FakeDB: generations = _Coll(); gen_jobs = _Coll()
for M in (NEW, OLD):
    M.settings.suno_api_key = "dummy-no-network"
    M.httpx.AsyncClient = FakeClient
async def run(M, **kw):
    CAP.clear()
    try:
        await M.generate_music_suno("0123456789abcdef01234567", mongo_db=FakeDB(), **kw)
    except _Stop:
        pass
    return dict(CAP.get("body") or {})
async def main():
    gid_list = data["duet"][:3] + data["solo"]
    for g in gid_list:
        isduet = g in data["duet"]
        kw = dict(lyrics=g["lyrics"], genre="Ballad", mood="Romantic", vocal="female_warm", title="t")
        if isduet:
            kw.update(duet_main_vocal_style="soft", duet_sub_vocal_style="warm")
        bo, bn = await run(OLD, **kw), await run(NEW, **kw)
        if isduet:
            print(f"- duet {g['id'][:8]} style NEW: {bn['style']}")
            print("  prompt NEW head:", bn["prompt"][:160].replace("\n", " / "))
            check("[This song is" not in bn["prompt"] and not LBL.search(bn["prompt"]), "e2e header/label remains")
            check(bn["style"].lower().count("duet") >= 1 and "male and female" in bn["style"].lower(), "duet style hint")
            check(bo["style"] != bn["style"], "style unchanged for duet?")
        else:
            same = bo == bn
            print(f"- solo {g['id'][:8]} body identical OLD==NEW: {same}")
            check(same, f"solo body differs {g['id']}")
    # voice_persona duet → style hint skipped
    g = data["duet"][0]
    bn = await run(NEW, lyrics=g["lyrics"], persona_id="p", persona_model="voice_persona", vocal="female_warm")
    print("- voice_persona duet style:", bn["style"])
    check("male and female" not in bn["style"].lower(), "voice persona got duet hint")
    # style already has duet + male and female → no dup
    bn = await run(NEW, lyrics=g["lyrics"], style="duet, male and female vocals, pop")
    print("- pre-existing duet style:", bn["style"])
    check(bn["style"].lower().count("male and female") == 1 and bn["style"].lower().count("duet") == 1, "dup duet hint")
    # instrumental with duet lyrics → untouched (no normalization)
    bo = await run(OLD, lyrics=g["lyrics"], vocal="instrumental"); bn = await run(NEW, lyrics=g["lyrics"], vocal="instrumental")
    check(bo == bn, "instrumental changed")
    print("- instrumental identical:", bo == bn)
asyncio.run(main())

print("=" * 70)
print("RESULT:", "PASS" if not FAILS else f"FAIL {len(FAILS)}")
for f in FAILS: print(" ", f)
