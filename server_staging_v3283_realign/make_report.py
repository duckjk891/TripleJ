"""results/*.json → results/REPORT.md + 사람 확인용 줄별 비교표(compare_*.md)."""
import glob, json, os
HERE = os.path.dirname(os.path.abspath(__file__)); RES = os.path.join(HERE, "results"); RAW = os.path.join(HERE, "raw")
docs = []
for p in sorted(glob.glob(os.path.join(RES, "6*.json"))):
    d = json.load(open(p)); raw = json.load(open(os.path.join(RAW, d["metrics"]["track_id"] + ".json")))
    d["metrics"]["t_download"] = raw.get("t_download"); docs.append(d)
def fmt(t): return "-" if t is None else f"{int(t//60)}:{t%60:05.2f}"
out = ["# v3.283 가사 싱크 재정렬 테스트 결과 (Whisper whisper-1 단어 타임스탬프 + 음절 DP 정렬)", ""]
out += ["## 붕괴 10곡", "", "| 곡 | 길이(s) | 가사 줄 | 앵커 줄 | 매칭 줄 | 최장 비앵커 연속 | 0.15s 미만 줄 | 단조 위반 | 커버리지 | 새 타임라인 판정 | 비용($) | API(s) | 판정 |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
for d in docs:
    m = d["metrics"]
    if m["kind"] != "collapsed": continue
    ok = m["anchor_ratio"] >= 0.85 and m["mono_violations"] == 0 and m["short_lines"] == 0 and m["max_unanchored_run"] <= 3 and m["new_timeline_state"] == "ok"
    out.append(f"| {m['title']} | {m['duration']} | {m['lines']} | {m['anchored']} ({m['anchor_ratio']:.0%}) | {m['matched_ratio']:.0%} | {m['max_unanchored_run']} | {m['short_lines']} | {m['mono_violations']} | {m['coverage']:.0%} | {m['new_timeline_state']} | {m['cost_usd']} | {m['t_api']} | {'적용 가능' if ok else '불가/검수'} |")
out += ["", "## 대조군(정상 Suno 타임라인) — 줄 시작 |새−Suno| (초)", "", "| 곡 | 구분 | 줄 | 중앙값 | 90분위 | ≤1s 비율 |", "|---|---|---|---|---|---|"]
for d in docs:
    m = d["metrics"]
    if not m["kind"].startswith("control"): continue
    out.append(f"| {m['title']} | {m['kind']} | {m['ctrl_n']} | {m['ctrl_median']} | {m['ctrl_p90']} | {m['ctrl_within_1s']:.0%} |")
open(os.path.join(RES, "REPORT.md"), "w").write("\n".join(out) + "\n")
for d in docs:
    m = d["metrics"]
    if m["title"] not in ("벚꽃 첫사랑", "13층", "막좋아", "사실 알고있잖아", "틀 밖으로 점프"): continue
    L = [f"# {m['title']} ({m['kind']}, track {m['track_id']}) — 줄별 비교", "",
         "새 시작=재정렬 결과, Suno 시작=기존 variants[vi].timestamps(가사 텍스트로 순서 매칭). '앵커'=음성 인식 단어로 직접 고정, 아니면 앞뒤 앵커 사이 보간.", "",
         "| # | 가사 줄 | 새 시작 | 새 끝 | 앵커 | Suno 시작 | Suno 몰림 | 차이(s) |", "|---|---|---|---|---|---|---|---|"]
    for r in d["table"]:
        L.append(f"| {r['i']} | {r['line']} | {fmt(r['new_start'])} | {fmt(r['new_end'])} | {'O' if r['anchor'] else '보간'} | {fmt(r['suno_start'])} | {'몰림' if r.get('suno_squashed') else ''} | {'' if r.get('diff') is None else r['diff']} |")
    open(os.path.join(RES, f"compare_{m['title'].replace(' ', '_')}.md"), "w").write("\n".join(L) + "\n")
print("\n".join(out))
