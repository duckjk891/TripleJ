"""v3.299 작사 분량 하한·구조 지시·보강 재작성 — 격리 컨테이너(모델 호출 없음)."""
import asyncio, sys
FAILS = []
def ok(n, c):
    print(("PASS " if c else "FAIL ") + n)
    if not c: FAILS.append(n)
import app.services.lyrics_generator as lg

STRUCT = "[Intro] - [Verse 1] - [Chorus] - [Verse 2] - [Chorus] - [Bridge] - [Chorus] - [Outro]"
m = lg._build_user_message("직장인 응원", "힙합", "밝고 경쾌한", None, 3, False, None, None, "ko", structure=STRUCT, has_rap=False)
ok("3분+구조: '2~3줄로 줄여' 지시 제거", "2~3줄로 줄여" not in m)
ok("3분 힙합: 범위 36~44줄", "36~44줄" in m)
ok("구조 순서 유지 지시", "섹션 순서는 그대로" in m and STRUCT in m)
m2 = lg._build_user_message("첫사랑", "발라드", "잔잔", None, 3, False, None, None, "ko", structure=None)
ok("3분 발라드: 범위 32~40줄", "32~40줄" in m2)
m1 = lg._build_user_message("짧게", "댄스", "", None, 1, False, None, None, "ko", structure=STRUCT)
ok("1분: 짧은 곡 규칙 유지·범위 문구 없음", "짧은 곡 규칙" in m1 and "LENGTH RANGE" not in m1)
m4 = lg._build_user_message("긴 곡", "록", "", None, 4, False, None, None, "ko")
ok("4분: 하한만(44줄 이상)", "44줄 이상" in m4)
ok("랩 판별(장르·랩 옵션)", lg._is_rap_song("붐뱁", False) and lg._is_rap_song("발라드", True) and not lg._is_rap_song("발라드", False))
ok("시스템 규칙 2-6줄", "Each section: 2-6 lines" in lg._system_prompt_for(False) and "Each section: 2-6 lines" in lg._system_prompt_for(True))

def lyr(n):
    body = "\n".join(f"가사 {i}" for i in range(n))
    return f"[Intro]\n\n[Verse 1]\n{body}"
async def main():
    calls = []
    async def mk(note):
        calls.append(note); return {"lyrics": lyr(38), "model": "m"}
    r = await lg._length_retry(mk, {"lyrics": lyr(22), "model": "m"}, 3, "힙합", False)
    ok("22줄(하한 36) → 1회 보강, 38줄 채택", len(calls) == 1 and lg.lyrics_shape_stats(r["lyrics"])["lyric_lines"] == 38)
    ok("보강 지시에 현재 줄 수·하한 포함", "22줄" in calls[0] and "36줄 이상" in calls[0])
    calls.clear()
    r = await lg._length_retry(mk, {"lyrics": lyr(34), "model": "m"}, 3, "발라드", False)
    ok("34줄(하한 32) → 재작성 없음", not calls and lg.lyrics_shape_stats(r["lyrics"])["lyric_lines"] == 34)
    async def mk_short(note): return {"lyrics": lyr(18), "model": "m"}
    r = await lg._length_retry(mk_short, {"lyrics": lyr(20), "model": "m"}, 3, "발라드", False)
    ok("보강이 더 짧으면 원래 유지", lg.lyrics_shape_stats(r["lyrics"])["lyric_lines"] == 20)
    async def mk_long(note): return {"lyrics": lyr(80), "model": "m"}
    r = await lg._length_retry(mk_long, {"lyrics": lyr(20), "model": "m"}, 3, "발라드", False)
    ok("보강이 상한 크게 초과면 원래 유지", lg.lyrics_shape_stats(r["lyrics"])["lyric_lines"] == 20)
    async def mk_err(note): raise RuntimeError("api down")
    r = await lg._length_retry(mk_err, {"lyrics": lyr(10), "model": "m"}, 3, "발라드", False)
    ok("보강 호출 실패 → 원래 유지", lg.lyrics_shape_stats(r["lyrics"])["lyric_lines"] == 10)
    r = await lg._length_retry(mk, {"lyrics": lyr(6), "model": "m"}, 1, "댄스", False)
    ok("1분 곡은 보강 안 함", lg.lyrics_shape_stats(r["lyrics"])["lyric_lines"] == 6)
    # generate_lyrics 경로 연결(모델 호출은 가짜)
    seq = [lyr(22), lyr(40)]
    async def fake_openai(**kw):
        return {"title": "t", "lyrics": seq.pop(0), "categories": [], "model": "fake", "_note": kw.get("extra_note")}
    lg._generate_lyrics_openai = fake_openai
    out = await lg.generate_lyrics("p", genre="힙합", duration_minutes=3, structure=STRUCT)
    ok("generate_lyrics 기본 경로: 짧으면 보강본 반환", lg.lyrics_shape_stats(out["lyrics"])["lyric_lines"] == 40 and "분량 보강" in (out.get("_note") or ""))
asyncio.run(main())
print("\nRESULT:", "ALL PASS" if not FAILS else f"{len(FAILS)} FAIL: {FAILS}")
sys.exit(1 if FAILS else 0)
