#!/usr/bin/env python3
"""반값 치킨 티저 영상 클립을 Higgsfield API(기본 Kling 4.0 reference-to-video)로 뽑는 로컬 제작 스크립트.

프롬프트 원본은 ../banggap_video_prompts.html 의 CLIPS 배열이며, 실행할 때마다 HTML에서 다시 읽는다.
표준 라이브러리만 쓴다. WSL에서: python3 hf_clips.py <명령>

  list                         클립·길이·이미지 준비 상태
  show V06                     실제로 보낼 요청(프롬프트·이미지 순서) 출력, 호출 없음
  estimate V06 [--res 480p]    Higgsfield 견적(USD), 과금 없음
  run V06 [--res 480p] --yes   업로드 → 생성 → 상태 확인 → mp4 저장 (--yes 없으면 견적만 보여 주고 멈춤)
  poll                         끝나지 않은 작업을 이어서 확인하고 받아 옴

곡 음원은 절대 올리지 않는다(사용자 음원 외부 전송 금지). 소리는 generate_audio=false, 편집에서 원곡으로 덮는다.
"""
import argparse
import hashlib
import json
import mimetypes
import re
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
HTML = HERE.parent / "banggap_video_prompts.html"
IMAGE_MAP = HERE / "image_map.json"
OUT = HERE / "out"
RUNS = HERE / "runs"
JOBS = RUNS / "jobs.json"
UPLOADS = RUNS / "uploads.json"
API = "https://api.higgsfield.ai"
# 이름: (엔드포인트, 이미지 최대 장수, 프롬프트 이미지 표기, 가능 화질, 추가 필드)
MODELS = {
    "kling-4.0": ("kling-video/v4.0/reference-to-video", 10, "@image_{n}", ("720p", "1080p"),
                  {"aspect_ratio": "16:9"}),
    "seedance-2.0": ("bytedance/seedance-2.0/reference-to-video", 9, "@Image{n}", ("480p", "720p", "1080p"),
                     {"aspect_ratio": "16:9", "generate_audio": False}),
    "seedance-2.5": ("bytedance/seedance-2.5/reference-to-video", 30, "@Image{n}", ("480p", "720p", "1080p"),
                     {"aspect_ratio": "16:9", "generate_audio": False}),
}
DEFAULT_MODEL = "kling-4.0"
# open.higgsfield.ai 공개 단가(USD/초, 입력 영상 없음, 2026-11-09 30% 할인 적용가). 견적 API 실패 시에만 씀.
LIST_PRICE = {("kling-4.0", "720p"): 0.1099, ("kling-4.0", "1080p"): 0.1645}
TERMINAL = {"completed", "failed", "nsfw", "canceled"}
IMG_EXT = (".png", ".jpg", ".jpeg", ".webp")


# ---------- HTML → 클립 목록 ----------

def _js_to_py(src: str) -> str:
    """CLIPS 정의 구간(단순 JS)을 파이썬 코드로 옮긴다. 문자열 밖에서만 키·true를 바꾼다."""
    out, i, n = [], 0, len(src)
    while i < n:
        c = src[i]
        if c == '"':  # 큰따옴표 문자열은 그대로(파이썬과 이스케이프 호환)
            j = i + 1
            while src[j] != '"':
                j += 2 if src[j] == "\\" else 1
            out.append(src[i:j + 1]); i = j + 1
        elif c == "`":  # 템플릿 리터럴 → f-string
            j, buf = i + 1, []
            while src[j] != "`":
                if src.startswith("${", j):
                    k = src.index("}", j)
                    buf.append("{" + src[j + 2:k] + "}"); j = k + 1
                elif src[j] == "\\":
                    buf.append(src[j:j + 2]); j += 2
                elif src[j] in "{}":
                    buf.append(src[j] * 2); j += 1
                elif src[j] == '"':
                    buf.append('\\"'); j += 1
                else:
                    buf.append(src[j]); j += 1
            out.append('f"' + "".join(buf).replace("\n", "\\n") + '"'); i = j + 1
        else:
            m = re.match(r"([{,]\s*)([A-Za-z_]\w*):", src[i:])
            if m:
                out.append(f'{m.group(1)}"{m.group(2)}":'); i += m.end(); continue
            m = re.match(r"\btrue\b", src[i:])
            if m and not (out and out[-1][-1:].isalnum()):
                out.append("True"); i += 4; continue
            out.append(c); i += 1
    return "".join(out)


def load_clips():
    html = HTML.read_text(encoding="utf-8")
    start = html.index("const STYLE=")
    end = html.index("const TRANS=")
    body = html[start:end]
    body = re.sub(r"^const P=.*$", "", body, flags=re.M)
    body = re.sub(r"^const (\w+)=n=>", r"\1=lambda n:", body, flags=re.M)
    body = re.sub(r"^const (\w+)=", r"\1=", body, flags=re.M)
    body = re.sub(r";\s*$", "", body, flags=re.M)
    ns = {"P": lambda *a: "\n\n".join(a)}
    exec(_js_to_py(body), ns)
    clips = {}
    for c in ns["CLIPS"]:
        m = re.match(r"(\d+)", c["gen"])
        c["duration"] = int(m.group(1)) if m else 4  # '가장 짧게' = Seedance 최소 4초
        c["start"] = c["att"][0]
        c["refs"] = c["att"][1:]
        clips[c["id"]] = c
    return clips


# ---------- 이미지 ----------

def resolve_image(label: str):
    mp = json.loads(IMAGE_MAP.read_text(encoding="utf-8"))
    rel = mp.get(label)
    if rel is None:
        m = re.match(r"(C\d+\w?) 완성 이미지", label)
        rel = mp["_cut_pattern"].format(cut=m.group(1)) if m else None
    if rel is None:
        return None
    p = (HERE / rel)
    if p.suffix.lower() in IMG_EXT:
        return p if p.exists() else None
    for ext in IMG_EXT:
        if p.with_suffix(ext).exists():
            return p.with_suffix(ext)
    return None


def build_request(clip, resolution, model):
    """시작 프레임을 image_urls[0](@Image1)로 넣고 레퍼런스는 @Image2부터. 프롬프트 번호도 하나씩 민다.
    Higgsfield reference-to-video에는 첫 프레임 전용 칸이 없어서(image_url과 같이 못 씀) 이렇게 맞춘다."""
    _, limit, tag, resolutions, extra = MODELS[model]
    if resolution not in resolutions:
        raise SystemExit(f"{model}은 {', '.join(resolutions)}만 됩니다 (--res)")
    labels = [clip["start"]] + clip["refs"]
    t = lambda n: tag.format(n=n)
    prompt = re.sub(r"@Image(\d+)", lambda m: t(int(m.group(1)) + 1), clip["prompt"])
    prompt = prompt.replace(
        "Begin exactly on the start frame image.",
        f"{t(1)} is the start frame: the very first frame of the video is exactly {t(1)}.")
    prompt = re.sub(r"the start frame(?! image)(?!: )", f"the start frame ({t(1)})", prompt)
    if len(labels) > limit:
        raise SystemExit(f"{clip['id']}: 이미지 {len(labels)}장 > {model} 한도 {limit}장")
    return {
        "labels": labels,
        "body": dict({"prompt": prompt, "duration": clip["duration"], "resolution": resolution}, **extra),
    }


# ---------- HTTP ----------

def load_env():
    env = {}
    f = HERE / ".env"
    if f.exists():
        for line in f.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    kid, sec = env.get("HF_API_KEY_ID"), env.get("HF_API_KEY_SECRET")
    if not (kid and sec) and ":" in env.get("HF_KEY", ""):
        kid, sec = env["HF_KEY"].split(":", 1)
    if not (kid and sec):
        raise SystemExit(f"API 키가 없습니다. {f} 에 HF_API_KEY_ID / HF_API_KEY_SECRET 을 넣어 주세요 (.env.example 참고).")
    return f"Key {kid}:{sec}"


def http(method, url, auth=None, body=None, headers=None, raw=None):
    h = {"User-Agent": "maidol-local-video-script/1.0", "Accept": "application/json"}
    if auth:
        h["Authorization"] = auth
    data = raw
    if body is not None:
        data = json.dumps(body).encode()
        h["Content-Type"] = "application/json"
    h.update(headers or {})
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            txt = r.read()
            return r.status, (json.loads(txt) if txt.strip() else {})
    except urllib.error.HTTPError as e:
        txt = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(txt)
        except ValueError:
            return e.code, {"error": txt[:500]}


def _load(p, default):
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else default


def _save(p, data):
    RUNS.mkdir(exist_ok=True)
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def upload(auth, path: Path):
    """presigned 업로드. 같은 파일은 5일 안이면 다시 올리지 않는다."""
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    cache = _load(UPLOADS, {})
    hit = cache.get(digest)
    if hit and time.time() - hit["at"] < 5 * 86400:
        return hit["public_url"]
    ctype = mimetypes.guess_type(path.name)[0] or "image/jpeg"
    st, res = http("POST", f"{API}/files/generate-upload-url", auth, {"content_type": ctype})
    if st >= 300:
        raise SystemExit(f"업로드 URL 발급 실패 {st}: {res}")
    hdrs = dict(res.get("upload_headers") or {})
    hdrs.setdefault("Content-Type", ctype)
    st2, res2 = http("PUT", res["upload_url"], None, raw=path.read_bytes(), headers=hdrs)
    if st2 >= 300:
        raise SystemExit(f"업로드 실패 {st2}: {res2}")
    cache[digest] = {"public_url": res["public_url"], "at": time.time(), "file": str(path.relative_to(HERE.parent))}
    _save(UPLOADS, cache)
    return res["public_url"]


# ---------- 명령 ----------

def pick(clips, ids):
    if not ids or ids == ["all"]:
        return list(clips.values())
    bad = [i for i in ids if i.upper() not in clips]
    if bad:
        raise SystemExit(f"없는 클립: {bad}. 가능한 값: {', '.join(clips)}")
    return [clips[i.upper()] for i in ids]


def cmd_list(a):
    clips = load_clips()
    for c in clips.values():
        miss = [l for l in [c["start"]] + c["refs"] if not resolve_image(l)]
        state = "이미지 준비됨" if not miss else "없음: " + ", ".join(miss)
        print(f"{c['id']}  {c['kind']}  {c['duration']:>2}초  이미지 {1 + len(c['refs'])}장  {state}")


def cmd_show(a):
    clips = load_clips()
    for c in pick(clips, a.clips):
        r = build_request(c, a.res, a.model)
        print(f"===== {c['id']}  {MODELS[a.model][0]}")
        for i, l in enumerate(r["labels"], 1):
            p = resolve_image(l)
            print(f"  @Image{i}: {l}  ->  {p.relative_to(HERE.parent) if p else '(파일 없음)'}")
        print(json.dumps({k: v for k, v in r["body"].items() if k != "prompt"}, ensure_ascii=False))
        print(r["body"]["prompt"])


def estimate(auth, clip, a, urls=None):
    r = build_request(clip, a.res, a.model)
    body = dict(r["body"], image_urls=urls or [f"https://example.com/ref{i}.jpg" for i in range(len(r["labels"]))])
    st, res = http("POST", f"{API}/estimate/{MODELS[a.model][0]}", auth, body)
    if st >= 300 or res.get("usd") is None:
        rate = LIST_PRICE.get((a.model, a.res))
        if rate:  # 견적 API가 안 되면 2026-11-09 공개 단가(30% 할인가)로 계산
            return round(rate * body["duration"], 3), f"공개 단가 ${rate}/s 기준 (견적 API {st})"
        return None, f"{st} {res}"
    return res.get("usd"), res


def cmd_estimate(a):
    auth = load_env()
    clips = load_clips()
    total = 0.0
    for c in pick(clips, a.clips):
        usd, res = estimate(auth, c, a)
        if usd is None:
            print(f"{c['id']}  견적 실패: {res}")
            continue
        total += float(usd)
        print(f"{c['id']}  {c['duration']:>2}초  {a.res}  ${float(usd):.3f}")
    print(f"합계 ${total:.3f}  (모델 {a.model}, 소리 생성 끔)")


def poll_job(auth, job, jobs):
    url = job.get("status_url") or f"{API}/requests/{job['request_id']}/status"
    t0, wait = time.time(), 8
    while True:
        st, res = http("GET", url, auth)
        s = res.get("status", f"http{st}")
        if s != job.get("status"):
            print(f"  {job['clip']} {job['request_id']}: {s}", flush=True)
        job["status"] = s
        if s in TERMINAL:
            job["error"] = res.get("error")
            job["video_url"] = (res.get("video") or {}).get("url")
            job["expires_at"] = res.get("expires_at")
            break
        if time.time() - t0 > 45 * 60:
            print("  45분 넘게 끝나지 않아 멈춥니다. 나중에 poll 로 이어서 받으세요.")
            break
        time.sleep(wait)
        wait = min(wait + 4, 30)
    _save(JOBS, jobs)
    if job["status"] == "completed" and job.get("video_url"):
        OUT.mkdir(exist_ok=True)
        dest = OUT / f"{job['stem']}.mp4"
        urllib.request.urlretrieve(job["video_url"], dest)
        (OUT / f"{job['stem']}.txt").write_text(
            f"clip: {job['clip']}\nrequest_id: {job['request_id']}\nmodel: {job['model']}\n"
            f"resolution: {job['body']['resolution']}  duration: {job['body']['duration']}s\n"
            + "".join(f"@Image{i}: {l}\n" for i, l in enumerate(job["labels"], 1))
            + "\n" + job["body"]["prompt"] + "\n", encoding="utf-8")
        job["file"] = str(dest.relative_to(HERE))
        _save(JOBS, jobs)
        print(f"  저장: {dest}")


def cmd_run(a):
    auth = load_env()
    clips = load_clips()
    targets = pick(clips, a.clips)
    for c in targets:
        miss = [l for l in [c["start"]] + c["refs"] if not resolve_image(l)]
        if miss:
            raise SystemExit(f"{c['id']}: 이미지 파일이 없습니다 → {', '.join(miss)} (image_map.json 확인)")
    total, quotes = 0.0, {}
    for c in targets:
        usd, res = estimate(auth, c, a)
        quotes[c["id"]] = usd
        total += float(usd or 0)
        print(f"{c['id']}  {c['duration']:>2}초  {a.res}  " + (f"${float(usd):.3f}" if usd is not None else f"견적 실패 {res}"))
    print(f"합계 ${total:.3f}")
    if not a.yes:
        print("견적만 확인했습니다. 실제로 뽑으려면 --yes 를 붙여 다시 실행하세요.")
        return
    jobs = _load(JOBS, {})
    for c in targets:
        r = build_request(c, a.res, a.model)
        urls = [upload(auth, resolve_image(l)) for l in r["labels"]]
        body = dict(r["body"], image_urls=urls)
        st, res = http("POST", f"{API}/{MODELS[a.model][0]}", auth, body,
                       headers={"Idempotency-Key": str(uuid.uuid4())})
        if st >= 300 or "request_id" not in res:
            print(f"{c['id']} 제출 실패 {st}: {res}")
            continue
        stem = f"{c['id']}_{a.res}_{datetime.now():%m%d_%H%M%S}"
        job = {"clip": c["id"], "request_id": res["request_id"], "status_url": res.get("status_url"),
               "status": res.get("status"), "model": MODELS[a.model][0], "labels": r["labels"],
               "image_urls": urls, "body": body, "estimate_usd": quotes.get(c["id"]),
               "submitted_at": datetime.now().isoformat(timespec="seconds"), "stem": stem}
        jobs[res["request_id"]] = job
        _save(JOBS, jobs)
        print(f"{c['id']} 제출됨 request_id={res['request_id']}")
        if not a.no_wait:
            poll_job(auth, job, jobs)


def cmd_poll(a):
    auth = load_env()
    jobs = _load(JOBS, {})
    todo = [j for j in jobs.values() if j.get("status") not in TERMINAL or (j["status"] == "completed" and not j.get("file"))]
    if not todo:
        print("기다리는 작업이 없습니다.")
    for j in todo:
        poll_job(auth, j, jobs)
    for j in sorted(jobs.values(), key=lambda x: x["submitted_at"]):
        print(f"{j['clip']}  {j['body']['resolution']}  {j['status']:<10} {j['request_id']}  {j.get('file') or j.get('error') or ''}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name, fn in [("list", cmd_list), ("show", cmd_show), ("estimate", cmd_estimate), ("run", cmd_run), ("poll", cmd_poll)]:
        p = sub.add_parser(name)
        p.set_defaults(fn=fn)
        if name in ("show", "estimate", "run"):
            p.add_argument("clips", nargs="*", help="V06 V01 … 또는 all")
            p.add_argument("--res", default="720p", choices=["480p", "720p", "1080p"],
                           help="초안 720p(Kling 4.0 최저), 최종 1080p")
            p.add_argument("--model", default=DEFAULT_MODEL, choices=list(MODELS))
        if name == "run":
            p.add_argument("--yes", action="store_true", help="견적 확인 후 실제 생성(과금)")
            p.add_argument("--no-wait", action="store_true", help="제출만 하고 나중에 poll")
    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
