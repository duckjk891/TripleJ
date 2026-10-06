"""v3.283 가사 재정렬 테스트 — 데이터 수집 + Whisper 전사 (컨테이너 내 실행, 읽기 전용).
DB 쓰기 없음. 결과는 /tmp/rl/out/<track_id>.json 에만 기록(로컬로 회수 후 정리).
OpenAI 키는 settings 에서만 읽고 출력하지 않는다."""
import asyncio, json, os, re, subprocess, sys, time
sys.path.insert(0, "/srv/app")
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId
from app.config import settings
from app.database.minio import init_minio
import app.database.minio as mmod

OUT = "/tmp/rl/out"; WORK = "/tmp/rl/work"
os.makedirs(OUT, exist_ok=True); os.makedirs(WORK, exist_ok=True)
TITLES = ["갱 머니","사실 알고있잖아","13층","마지막 버스","show","너 정말","미칠거같아","막좋아","우린 예뻐2","벚꽃 첫사랑"]
N_CONTROL = int(os.environ.get("N_CONTROL", "3"))
ONLY = os.environ.get("ONLY")  # 쉼표 구분 track_id 만 처리(디버그)

# ── staging v3.283 _repair_timeline 복제(판정용) ──
_SECTION_TAG_RE = re.compile(r"^\[.*\]$")  # staging share_video 동일
_SEPARATOR_RE = re.compile(r"^[=\-_*~\s]{3,}$")
def repair_state(raw):
    items = []
    for seg in raw or []:
        if not isinstance(seg, dict): continue
        text = str(seg.get("text") or "").strip()
        try: st, en = float(seg.get("start")), float(seg.get("end"))
        except (TypeError, ValueError): continue
        is_tag = bool(_SECTION_TAG_RE.match(text) or _SEPARATOR_RE.match(text)) if text else True
        items.append({"st": st, "en": en, "tag": is_tag})
    lyr = [it for it in items if not it["tag"]]; n = len(lyr)
    if n < 5: return "short"
    for it in lyr: it["bad"] = (it["en"] - it["st"]) < 0.15
    for i in range(n):
        j = i
        while j + 1 < n and lyr[j + 1]["st"] - lyr[i]["st"] <= 0.5: j += 1
        if j - i + 1 >= 3:
            for k in range(i, j + 1): lyr[k]["bad"] = True
    bad = sum(1 for it in lyr if it["bad"])
    return "collapsed" if bad / n >= 0.5 else ("ok" if bad == 0 else "repaired")

def clean_lyrics(text):
    lines = []
    for ln in (text or "").splitlines():
        s = ln.strip()
        if not s or _SECTION_TAG_RE.match(s) or _SEPARATOR_RE.match(s): continue
        s = re.sub(r"^\s*\[(?:male|female|both|duet|남|여|함께)[^\]]*\]\s*", "", s, flags=re.I)
        s = re.sub(r"\[[^\]]*\]", "", s).strip()  # 줄 중간 [지시] 제거(괄호 코러스는 유지)
        if s: lines.append(s)
    return lines

async def gen_of(db, tr):
    gid = tr.get("generation_id")
    if not gid: return None
    q = ObjectId(gid) if isinstance(gid, str) and ObjectId.is_valid(gid) else gid
    return await db.generations.find_one({"_id": q}, {"lyrics": 1, "variants": 1, "vocal": 1, "duet": 1, "suno_model": 1, "model": 1, "genre": 1})

def ts_of(g, vi):
    vs = (g or {}).get("variants") or []
    if not vs: return []
    if not isinstance(vi, int) or vi < 0 or vi >= len(vs): vi = 0
    v = vs[vi]
    return v.get("timestamps") if isinstance(v, dict) and isinstance(v.get("timestamps"), list) else []

async def main():
    db = AsyncIOMotorClient(settings.computed_mongo_url)[settings.mongo_db]
    init_minio(settings.minio_endpoint, settings.minio_user, settings.minio_password)
    mc = mmod.minio_client
    targets = []
    for t in TITLES:
        tr = await db.tracks.find_one({"title": t, "is_public": True})
        if tr: targets.append(("collapsed", tr))
    # 대조군: 공개곡 중 Suno 타임라인 ok(몰림 0), 가사 충분, 최근순
    ctrl = []
    cur = db.tracks.find({"is_public": True, "generation_id": {"$exists": True, "$ne": None}},
                         {"title": 1, "generation_id": 1, "variant_index": 1, "audio_url": 1, "is_public": 1}).sort("_id", -1).limit(200)
    async for tr in cur:
        if len(ctrl) >= N_CONTROL: break
        if tr.get("title") in TITLES: continue
        g = await gen_of(db, tr)
        if not g: continue
        if (g.get("vocal") or "").lower() == "instrumental": continue
        lines = clean_lyrics(g.get("lyrics"))
        if len(lines) < 16: continue
        ts = ts_of(g, tr.get("variant_index") or 0)
        if repair_state(ts) != "ok": continue
        # 다양성: 같은 사용자 폴더 연속 회피 X(단순) — 곡 길이 ≥ 90s 정도만
        ctrl.append(("control", tr))
    targets += ctrl
    if ONLY:
        keep = set(ONLY.split(","))
        targets = [x for x in targets if str(x[1]["_id"]) in keep]

    # 보컬 스템 존재 여부(inst_jobs) — 새로 만들지 않음
    stems = {}
    for kind, tr in targets:
        j = await db.inst_jobs.find_one({"$or": [{"track_id": str(tr["_id"])}, {"source_track_id": str(tr["_id"])}]})
        if j: stems[str(tr["_id"])] = {k: (str(v)[:120] if not isinstance(v, (int, float, bool)) else v) for k, v in j.items() if "url" in k.lower() or "vocal" in k.lower() or k in ("status",)}

    from openai import OpenAI
    client = OpenAI(api_key=settings.openai_api_key)
    summary = []
    for kind, tr in targets:
        tid = str(tr["_id"]); path_out = f"{OUT}/{tid}.json"
        g = await gen_of(db, tr)
        vi = tr.get("variant_index") or 0
        ts = ts_of(g, vi)
        lines = clean_lyrics(g.get("lyrics"))
        rec = {"kind": kind, "track_id": tid, "title": tr.get("title"), "generation_id": str(tr.get("generation_id")),
               "variant_index": vi, "audio_url": tr.get("audio_url"), "lyrics_raw": g.get("lyrics"),
               "lyrics_lines": lines, "suno_timestamps": ts, "suno_state": repair_state(ts),
               "duet": g.get("duet"), "suno_model": g.get("suno_model") or g.get("model"), "genre": g.get("genre"),
               "vocal_stem": stems.get(tid)}
        if os.path.exists(path_out):
            summary.append({"tid": tid, "title": tr.get("title"), "cached": True}); continue
        t0 = time.time()
        src = f"{WORK}/{tid}{os.path.splitext(tr.get('audio_url') or '.mp3')[1] or '.mp3'}"
        resp = mc.get_object(bucket_name=settings.minio_bucket_music, object_name=tr["audio_url"])
        try:
            with open(src, "wb") as f:
                for ch in resp.stream(64 * 1024): f.write(ch)
        finally:
            resp.close(); resp.release_conn()
        t_dl = time.time() - t0
        dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src],
                                   capture_output=True).stdout.decode().strip() or 0)
        size = os.path.getsize(src)
        up = src
        if size > 24 * 1024 * 1024:
            up = f"{WORK}/{tid}_m64.mp3"
            subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", src, "-ac", "1", "-b:a", "64k", up], check=True)
        prompt = "".join(lines)[:200]
        t1 = time.time()
        with open(up, "rb") as f:
            r = client.audio.transcriptions.create(model="whisper-1", file=f, response_format="verbose_json",
                                                   timestamp_granularities=["word", "segment"], language="ko", prompt=prompt)
        t_api = time.time() - t1
        d = r.model_dump() if hasattr(r, "model_dump") else json.loads(r.json())
        rec.update({"audio_duration": dur, "audio_bytes": size, "uploaded_bytes": os.path.getsize(up),
                    "t_download": round(t_dl, 2), "t_api": round(t_api, 2), "prompt_chars": len(prompt),
                    "whisper": {"text": d.get("text"), "duration": d.get("duration"),
                                "words": d.get("words") or [],
                                "segments": [{k: s.get(k) for k in ("start", "end", "text", "no_speech_prob", "avg_logprob", "compression_ratio")} for s in (d.get("segments") or [])]}})
        with open(path_out, "w") as f: json.dump(rec, f, ensure_ascii=False, default=str)
        for p in {src, up}:
            try: os.remove(p)
            except OSError: pass
        summary.append({"tid": tid, "title": tr.get("title"), "kind": kind, "dur": round(dur, 1), "MB": round(size / 1e6, 2),
                        "t_api": round(t_api, 1), "words": len(d.get("words") or [])})
        print(json.dumps(summary[-1], ensure_ascii=False), flush=True)
    print("DONE", json.dumps(summary, ensure_ascii=False))
    print("STEMS", json.dumps(stems, ensure_ascii=False, default=str))
asyncio.run(main())
