"""v3.302 창작 기록 — DIRECTION 검증·인간 개입 요약·리포트(해시 체인 검증) — 격리 컨테이너 + 가짜 PG."""
import asyncio, sys, json
from datetime import datetime, timezone, timedelta
FAILS = []
def ok(n, c):
    print(("PASS " if c else "FAIL ") + n)
    if not c: FAILS.append(n)
import app.services.creation_log as cl
import app.routes.sessions as rs

def item(t, payload, target=None):
    return rs.EventItem(event_id="e" + str(id(payload)), client_seq=1, type=t, client_ts=None, target=target, payload=payload)
good = {"stage": "lyrics", "answers": {"topic": "30대의 다이어트 고민", "rap": False, "duration_sec": 180, "kw": ["밤하늘"]},
        "typed_fields": ["topic"], "reference": {"text": True, "named_work": False}}
try:
    v = rs._validate_item(item("DIRECTION", good)); ok("DIRECTION 정상 수용(actor=user)", v["type"] == "DIRECTION" and v["actor"] == "user")
except Exception as e:
    ok(f"DIRECTION 정상 수용 ({e})", False)
def rejects(p, name):
    try:
        rs._validate_item(item("DIRECTION", p)); ok(name, False)
    except ValueError:
        ok(name, True)
rejects({**good, "stage": "hack"}, "잘못된 stage 거부")
rejects({**good, "answers": {}}, "빈 answers 거부")
rejects({**good, "answers": {"x": "a" * 1001}}, "1000자 초과 거부")
rejects({**good, "typed_fields": ["nope"]}, "answers 밖 typed_fields 거부")
rejects({**good, "reference": {"text": "yes"}}, "reference 비불리언 거부")
rejects({**good, "extra": 1}, "미정의 키 거부")
ok("DIRECTION 서버 이벤트 타입 등록", "DIRECTION" in cl.EVENT_TYPES)

# 가짜 PG 커넥션으로 요약·리포트
SID = "11111111-1111-1111-1111-111111111111"
t0 = datetime(2026, 10, 7, 1, 0, tzinfo=timezone.utc)
raw = [
    ("SESSION_START", "server", {"app": "x"}),
    ("DIRECTION", "user", {"stage": "lyrics", "answers": {"topic": "t"}, "typed_fields": ["topic"], "reference": {"text": True, "named_work": True}}),
    ("LYRIC_EDIT", "server", {"source": "ai_draft", "lyrics_version_id": "v1"}),
    ("LYRIC_EDIT", "user", {"source": "user_edit", "lyrics_version_id": "v2"}),
    ("DIRECTION", "user", {"stage": "compose", "answers": {"genre": "발라드"}, "typed_fields": [], "reference": {"audio": True}}),
    ("GEN_REQUEST", "server", {"engine": "suno", "request_hash": "h"}),
    ("GEN_RESPONSE", "server", {"candidates": [{"candidate_id": "c1"}]}),
    ("LISTEN", "user", {"action": "play", "position_ms": 0}),
    ("LISTEN", "user", {"action": "pause", "position_ms": 5000}),
    ("CANDIDATE_SELECT", "user", {"action": "select"}),
]
events, prev = [], cl.GENESIS_HASH
for i, (t, a, p) in enumerate(raw, start=1):
    ts = t0 + timedelta(seconds=i)
    h = cl.event_hash(SID, i, t, a, cl.ts_str(ts), p, prev)
    import uuid as _u
    events.append({"session_id": _u.UUID(SID), "seq": i, "type": t, "actor": a, "server_ts": ts, "payload": json.dumps(p, ensure_ascii=False), "event_hash": h})
    prev = h
versions = [
    {"lyrics_version_id": "v1", "source": "ai_draft", "text": "[Verse]\n가사 하나\n가사 둘", "created_at": t0},
    {"lyrics_version_id": "v2", "source": "user_edit", "text": "[Verse]\n내가 바꾼 첫 줄\n가사 둘", "created_at": t0 + timedelta(seconds=5)},
]
class Conn:
    async def fetch(self, q, *a):
        if "FROM creation_log.events" in q: return events
        if "FROM creation_log.lyrics_versions" in q: return versions
        return []
    async def fetchrow(self, q, *a):
        return {"status": "ACTIVE", "created_at": t0, "finalized_at": None, "root_hash": None, "final_lyrics_version_id": None}
    async def close(self): pass
async def fake_connect(): return Conn()
cl._connect = fake_connect
async def main():
    s = await cl.compute_human_summary(SID)
    ok("요약: 지시 2건(작사·작곡)", s["directions"] == 2 and s["direction_stages"] == {"lyrics": 1, "compose": 1})
    ok("요약: 직접 입력 1개", s["typed_answers"] == 1)
    ok("요약: 가사 버전 2·사람 수정 1", s["lyric_versions"] == 2 and s["lyric_user_edits"] == 1)
    ok("요약: AI 초안 대비 유사도(‰) 1000 미만", isinstance(s["lyrics_ai_similarity_permille"], int) and 0 < s["lyrics_ai_similarity_permille"] < 1000)
    ok("요약: 청취 2·선택 1·생성요청 1", s["listens"] == 2 and s["candidate_selects"] == 1 and s["gen_requests"] == 1)
    ok("요약: 참고 플래그 합산(text·named_work·audio)", s["reference"] == {"text": True, "audio": True, "link": False, "named_work": True})
    ok("요약 값 정수·불리언만(canonical 안전)", "float" not in json.dumps({k: type(v).__name__ for k, v in s.items()}))
    rep = await cl.build_report(SID)
    ok("리포트: 해시 체인 검증 통과", rep["chain_ok"] is True and rep["chain_broken_seq"] is None)
    ok("리포트: 타임라인 10·지시 상세 포함", len(rep["timeline"]) == 10 and rep["timeline"][1]["detail"]["answers"] == {"topic": "t"})
    ok("리포트: 가사 버전 전문 2", len(rep["lyrics_versions"]) == 2)
    events[3]["payload"] = json.dumps({"source": "user_edit", "lyrics_version_id": "vX"})  # 변조
    rep2 = await cl.build_report(SID)
    ok("리포트: 변조 감지(seq 4)", rep2["chain_ok"] is False and rep2["chain_broken_seq"] == 4)
asyncio.run(main())
print("\nRESULT:", "ALL PASS" if not FAILS else f"{len(FAILS)} FAIL: {FAILS}")
sys.exit(1 if FAILS else 0)
