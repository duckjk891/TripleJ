"""v3.284 unit tests — NO network (--network none). /t/samples.json = 최근 가사 실데이터."""
import asyncio, json, re, sys, logging
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s", stream=sys.stdout)
logging.getLogger("httpx").setLevel(logging.WARNING)
from app.services import lyrics_directions as D
from app.services import suno_generator as NEW
from app.services import suno_generator_orig as OLD
from app.services import lyrics_generator as LN
from app.services import lyrics_generator_orig as LO

FAILS = []
def check(c, msg):
    if not c:
        FAILS.append(msg); print("  FAIL:", msg)

print("U1 cues_of")
for inner, exp in [("whisper", ["Whispered"]), ("Whispered", ["Whispered"]), ("echo", ["Echo"]), ("spoken", ["Spoken Word"]),
                   ("ad-lib", ["Ad-libs"]), ("harmonize", ["Harmonized"]), ("falsetto", ["Falsetto"]), ("속삭이듯", ["Whispered"]),
                   ("천천히", ["Slow"]), ("웃으며", ["Laughing"]), ("whisper, echo", ["Whispered", "Echo"]),
                   ("whisper & echo", ["Whispered", "Echo"]), ("spoken / softly", ["Spoken Word", "Soft"]), ("기타 솔로", ["Guitar Solo"]),
                   ("whisper...", ["Whispered"]), ("oh oh", None), ("사랑해", None), ("우산 아래의 속삭임", None), ("Hey", None),
                   ("", None), ("whisper me", None), ("echo of love", None), ("rap god", None)]:
    got = D.cues_of(inner)
    check(got == exp, f"cues_of({inner!r}) = {got} != {exp}")

print("U2 lift")
cases = [
    ("[Verse]\n(whisper) 내 삶, 내 맘\n가사", "[Verse]\n[Whispered]\n내 삶, 내 맘\n가사"),
    ("가지마, 가지마 (echo)", "[Echo]\n가지마, 가지마"),
    ("[Bridge]\n(spoken)\n있잖아", "[Bridge]\n[Spoken Word]\n있잖아"),
    ("너를 (whisper) 불러", "[Whispered]\n너를 불러"),
    ("(whisper) 여긴 어디 (echo)", "[Whispered, Echo]\n여긴 어디"),
    ("  (falsetto) 별은 왜", "  [Falsetto]\n  별은 왜"),
    ("(spoken) 다 자도\r\n가사\r", "[Spoken Word]\r\n다 자도\r\n가사\r"),
    ("사랑해 (oh oh) (whisper)", "[Whispered]\n사랑해 (oh oh)"),
]
for src, exp in cases:
    got, st = D.lift_inline_directions(src)
    check(got == exp, f"lift {src!r} -> {got!r} != {exp!r}")
for keep in ["[Verse: soft, whispered]\n가사 (oh oh)", "[Verse (whisper)]\n가사", "", "그냥 가사", "(사랑해) 너만"]:
    got, st = D.lift_inline_directions(keep)
    check(got is keep and st["lifted"] == 0, f"unchanged {keep!r} -> {got!r}")

print("U3 is_cue_tag_line")
for ln, exp in [("[Whispered]", True), ("[Spoken Word, Echo]", True), ("  [Ad-libs]  ", True), ("[Verse]", False),
                ("[Verse: whispered]", False), ("[Female Vocal]", False), ("[Male]", False), ("Whispered", False)]:
    check(D.is_cue_tag_line(ln) == exp, f"is_cue_tag_line({ln!r}) != {exp}")

data = json.load(open("/t/samples.json"))
print("U4/U5 real data n=", len(data))
DIRP = re.compile(r"\(([^()\n]{1,40})\)")
def is_dir(inner): return D.cues_of(inner) is not None
def norm(t): return re.sub(r"\s+", " ", t).strip()
changed = 0
for g in data:
    t = g["lyrics"]
    out, st = D.lift_inline_directions(t)
    dir_in = [m.group(1) for m in DIRP.finditer(t) if is_dir(m.group(1))]
    non_in = [m.group(0) for m in DIRP.finditer(t) if not is_dir(m.group(1))]
    non_out = [m.group(0) for m in DIRP.finditer(out) if not is_dir(m.group(1))]
    check(not [1 for m in DIRP.finditer(out) if is_dir(m.group(1))], f"{g['id']} direction paren remains")
    check(non_in == non_out, f"{g['id']} non-direction parens changed")
    if not dir_in:
        check(out is t, f"{g['id']} no-direction text not identical")
    else:
        changed += 1
        stripped_src = norm(DIRP.sub(lambda m: " " if is_dir(m.group(1)) else m.group(0), t))
        stripped_out = norm("\n".join(l for l in out.split("\n") if not D.is_cue_tag_line(l)))
        check(stripped_src == stripped_out, f"{g['id']} lyric text not preserved")
        check(st["lifted"] == len(dir_in), f"{g['id']} lifted count {st['lifted']} != {len(dir_in)}")
    # shape stats: 연출 태그 없는 원문은 구버전과 동일, 변환 결과(태그 줄)는 원문(괄호 제거)과 같은 모양
    check(LN.lyrics_shape_stats(t) == LO.lyrics_shape_stats(t) or D.is_cue_tag_line("x"), f"{g['id']} shape changed for raw")
    if dir_in:
        a = LN.lyrics_shape_stats(out)
        b = LO.lyrics_shape_stats(DIRP.sub(lambda m: "" if is_dir(m.group(1)) else m.group(0), t))
        check(a["sections_with_lines"] == b["sections_with_lines"], f"{g['id']} shape sections {a} vs {b}")
print("   lyrics with directions:", changed)

print("U8 prompts")
sp = LN._system_prompt_for(False); dp = LN._system_prompt_for(True)
check("- (whisper) -" not in sp and "NEVER write performance directions in parentheses" in sp, "solo prompt rule")
check("10. NEVER write performance directions" in dp, "duet prompt rule")
check("{categories}" not in sp and "{categories}" not in dp, "categories replaced")
check(LO._system_prompt_for(False).count("{") <= sp.count("{"), "prompt braces sane")

print("U6/U7 generate_music_suno OLD vs NEW (httpx mocked)")
class _Stop(Exception): pass
CAP = {}
class FakeClient:
    def __init__(self, *a, **k): pass
    async def __aenter__(self): return self
    async def __aexit__(self, *a): return False
    async def post(self, url, headers=None, json=None, **k):
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
    return dict(CAP.get("body") or {}), CAP.get("url")
def strip_cues(t): return norm("\n".join(l for l in t.split("\n") if not D.is_cue_tag_line(l)))
def strip_dirs(t): return norm(DIRP.sub(lambda m: " " if is_dir(m.group(1)) else m.group(0), t))
async def main():
    plain = [g for g in data if not any(is_dir(m.group(1)) for m in DIRP.finditer(g["lyrics"]))][:5]
    withd = [g for g in data if any(is_dir(m.group(1)) for m in DIRP.finditer(g["lyrics"]))][:6]
    for g in plain:
        kw = dict(lyrics=g["lyrics"], genre="Ballad", mood="Romantic", vocal="female_warm", title="t")
        (bo, _), (bn, _) = await run(OLD, **kw), await run(NEW, **kw)
        check(bo == bn and bo, f"plain body differs {g['id']}")
    for g in withd:
        kw = dict(lyrics=g["lyrics"], genre="Pop", mood="Dreamy", vocal="female_warm", title="t")
        (bo, _), (bn, _) = await run(OLD, **kw), await run(NEW, **kw)
        diff_keys = [k for k in set(bo) | set(bn) if bo.get(k) != bn.get(k)]
        check(diff_keys == ["prompt"], f"{g['id']} diff keys {diff_keys}")
        check(not any(is_dir(m.group(1)) for m in DIRP.finditer(bn["prompt"])), f"{g['id']} dir remains in prompt")
        check(strip_cues(bn["prompt"]) == strip_dirs(bo["prompt"]), f"{g['id']} prompt text mismatch")
        check(bn["prompt"].lstrip().split("\n")[0] == bo["prompt"].lstrip().split("\n")[0], f"{g['id']} first line (leadin) changed")
    print("   head NEW:", withd[0]["id"][:8], bn["prompt"][:200].replace("\n", " / ") if withd else "-")
    # duet + direction
    duet = "[This song is a duet featuring one male vocalist and one female vocalist]\n===\n\n[Verse]\n[Female] (whisper) 오늘도 너를\n[Male] 나도 같은 하늘 (echo)\n\n[Chorus]\n[Both] 함께라면 괜찮아"
    (bn, _) = await run(NEW, lyrics=duet, vocal="female_warm", duet_main_vocal_style="soft", duet_sub_vocal_style="warm")
    p = bn["prompt"]
    print("   duet NEW:", p.replace("\n", " / "))
    check("[This song is" not in p and "[Female]" not in p and "(whisper)" not in p and "(echo)" not in p, "duet+dir normalize")
    check("[Whispered]" in p and "[Echo]" in p and "Female Vocal" in p, "duet+dir tags")
    # instrumental untouched
    (bo, _), (bn, _) = await run(OLD, lyrics="(whisper) 가사", vocal="instrumental"), await run(NEW, lyrics="(whisper) 가사", vocal="instrumental")
    check(bo == bn, "instrumental changed")
    # upload-cover path
    (bo, uo), (bn, un) = await run(OLD, lyrics="[Verse]\n(whisper) 가사 하나\n가사 둘", reference_audio_url="https://x/a.mp3", vocal="female_warm"), \
                         await run(NEW, lyrics="[Verse]\n(whisper) 가사 하나\n가사 둘", reference_audio_url="https://x/a.mp3", vocal="female_warm")
    check("upload-cover" in (un or "") and "[Whispered]" in bn.get("prompt", "") and "(whisper)" in bo.get("prompt", ""), f"upload-cover path url={un}")
    # U7 lift exception → original sent
    orig = D.lift_inline_directions
    def boom(t): raise RuntimeError("boom")
    D.lift_inline_directions = boom
    (bo, _), (bn, _) = await run(OLD, lyrics=withd[0]["lyrics"], vocal="female_warm"), await run(NEW, lyrics=withd[0]["lyrics"], vocal="female_warm")
    D.lift_inline_directions = orig
    check(bo == bn, "lift exception path not identical to OLD")
asyncio.run(main())
print("=" * 60)
print("RESULT:", "PASS" if not FAILS else f"FAIL {len(FAILS)}")
for f in FAILS[:40]: print(" ", f)
