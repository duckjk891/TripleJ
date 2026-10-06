"""v3.283 가사 재정렬 — Whisper 단어 타임스탬프 ↔ 우리 가사 줄 정렬 (로컬 순수 파이썬, 테스트용).
입력: raw/<track_id>.json (fetch_transcribe.py 결과). 출력: results/*.json, results/*.md
방법: 음절(문자) 단위 겹침 정렬(Needleman–Wunsch, 양끝 갭 무료) + 자모 부분 일치 점수,
     인식 단어 안 글자 시각은 단어 [start,end] 선형 분배(줄 경계에서 붙은 단어 'frame난잡한' 대응).
     줄 시작 = 첫 정합 글자 시각, 끝 = 마지막 정합 글자 끝(다음 줄 시작으로 클램프), 실패 줄 = 앵커 사이 보간."""
import glob, json, os, re, statistics, sys

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw"); RES = os.path.join(HERE, "results")
os.makedirs(RES, exist_ok=True)
_SECTION_TAG_RE = re.compile(r"^\[.*\]$")
_SEPARATOR_RE = re.compile(r"^[=\-_*~\s]{3,}$")
_LABEL_RE = re.compile(r"^\s*\[(?:male|female|both|duet|남|여|함께)[^\]]*\]\s*", re.I)

def norm_chars(s):
    s = s.lower()
    return [c for c in s if ("가" <= c <= "힣") or ("a" <= c <= "z") or ("0" <= c <= "9")]

def jamo(c):
    if "가" <= c <= "힣":
        o = ord(c) - 0xAC00
        return (o // 588, (o % 588) // 28, o % 28)
    return None

MATCH, PART, MIS, GAP = 2, 1, -1, -1
def sim(a, b):
    if a == b: return MATCH
    ja, jb = jamo(a), jamo(b)
    if ja and jb:
        same = sum(1 for x, y in zip(ja, jb) if x == y)
        if same >= 2: return PART
    return MIS

def align(A, B):
    n, m = len(A), len(B)
    # DP with per-row last-column record
    prev = [0] * (m + 1)
    tb = [bytearray(m + 1) for _ in range(n + 1)]
    for j in range(1, m + 1): tb[0][j] = 2
    lastcol = [0] * (n + 1)
    for i in range(1, n + 1):
        cur = [0] * (m + 1); tb[i][0] = 1
        ai = A[i - 1]; ti = tb[i]
        for j in range(1, m + 1):
            d = prev[j - 1] + sim(ai, B[j - 1]); u = prev[j] + GAP; l = cur[j - 1] + GAP
            if d >= u and d >= l: cur[j] = d; ti[j] = 0
            elif u >= l: cur[j] = u; ti[j] = 1
            else: cur[j] = l; ti[j] = 2
        lastcol[i] = cur[m]; prev = cur
    # 끝점: 마지막 행(n, j) 또는 마지막 열(i, m) 중 최대
    best, bi, bj = prev[m], n, m
    for j in range(m + 1):
        if prev[j] > best: best, bi, bj = prev[j], n, j
    for i in range(n + 1):
        if lastcol[i] > best: best, bi, bj = lastcol[i], i, m
    amap = {}
    i, j = bi, bj
    while i > 0 and j > 0:
        t = tb[i][j]
        if t == 0:
            amap[i - 1] = (j - 1, sim(A[i - 1], B[j - 1])); i -= 1; j -= 1
        elif t == 1: i -= 1
        else: j -= 1
    return amap

def lyric_lines(raw):
    out = []
    for ln in (raw or "").splitlines():
        s = ln.strip()
        if not s or _SECTION_TAG_RE.match(s) or _SEPARATOR_RE.match(s): continue
        s = _LABEL_RE.sub("", s); s = re.sub(r"\[[^\]]*\]", "", s).strip()
        if s: out.append(s)
    return out

HOLDOUT = {"6ac27bb92667400ef2cd1e95", "6ac260042667400ef2cd1e03", "6ac241bf2667400ef2cd1d91"}
MODE = os.environ.get("MODE", "v2")  # v1=단어 내 선형 분배, v2=긴 단어 압축·0길이 단어 불신
SLOW = float(os.environ.get("SLOW", "0.6"))   # 무게당 초과 시 '늘어진 단어'로 판정
UNIT = float(os.environ.get("UNIT", "0.3"))   # 압축 시 무게당 초

def cw(c):
    return 1.0 if "가" <= c <= "힣" else (0.5 if c.isdigit() else 0.3)

def realign(lines, words, duration):
    # 인식 글자 스트림(글자별 소속 단어·무게), 시각은 정렬 뒤 단어 단위로 부여
    B, Bw, Bk = [], [], []
    # 0길이 단어 및 같은 시각에 3개 이상 몰린 단어 = 불신(Whisper 30초 창 경계 붕괴)
    unreliable = set()
    for wi, w in enumerate(words):
        if float(w["end"]) - float(w["start"]) < 0.02: unreliable.add(wi)
    i = 0
    while i < len(words):
        j = i
        while j + 1 < len(words) and abs(float(words[j + 1]["start"]) - float(words[i]["start"])) < 0.02: j += 1
        if j - i + 1 >= 3: unreliable.update(range(i, j + 1))
        i = j + 1
    for wi, w in enumerate(words):
        if MODE != "v1" and wi in unreliable: continue  # 시각 정보 없음 + 프롬프트 복제 위험 → 정렬에서 제외
        for ci, c in enumerate(norm_chars(w["word"])):
            B.append(c); Bw.append(wi); Bk.append(ci)
    A, Aline = [], []
    for li, ln in enumerate(lines):
        for c in norm_chars(ln): A.append(c); Aline.append(li)
    amap = align(A, B)
    b2line = {j: Aline[k] for k, (j, sc) in amap.items() if sc > 0}
    Bst = [None] * len(B); Ben = [None] * len(B); Brel = [True] * len(B)
    by_word = {}
    for bi, wi in enumerate(Bw): by_word.setdefault(wi, []).append(bi)
    line_first_b = {}
    for bi in sorted(b2line): line_first_b.setdefault(b2line[bi], bi)
    for wi, bis in by_word.items():
        st, en = float(words[wi]["start"]), float(words[wi]["end"])
        tot = sum(cw(B[b]) for b in bis) or 1.0
        rel = wi not in unreliable
        def linear():
            acc = 0.0
            for b in bis:
                Bst[b] = st + (en - st) * acc / tot; acc += cw(B[b]); Ben[b] = st + (en - st) * acc / tot
        if MODE == "v1" or (en - st) / tot <= SLOW:
            linear()
        else:
            # 줄 소속으로 묶음(미정합 글자는 앞 묶음에)
            runs = []
            for b in bis:
                ln = b2line.get(b)
                if runs and (ln is None or ln == runs[-1][0]): runs[-1][1].append(b)
                elif ln is None and not runs: runs.append([None, [b]])
                else:
                    if runs and runs[-1][0] is None: runs[-1][0] = ln; runs[-1][1].append(b)
                    else: runs.append([ln, [b]])
            for ri, (ln, rb) in enumerate(runs):
                w_ = sum(cw(B[b]) for b in rb)
                starts_line = ln is not None and line_first_b.get(ln) in rb
                if ri == 0 and not (len(runs) == 1 and starts_line):
                    t = st  # 앞 묶음: 단어 시작부터 압축
                elif ri == len(runs) - 1:
                    t = max(st, en - w_ * UNIT)  # 뒤 묶음/줄 첫 단어: 단어 끝에 붙여 압축
                else:
                    t = st + (en - st) * sum(cw(B[x]) for r in runs[:ri] for x in r[1]) / tot
                for b in rb:
                    Bst[b] = t; t += cw(B[b]) * UNIT; Ben[b] = min(t, en)
        if not rel and MODE != "v1":
            for b in bis: Brel[b] = False
    res = []
    for li, ln in enumerate(lines):
        idx = [k for k in range(len(A)) if Aline[k] == li]
        hits_all = [(k, amap[k]) for k in idx if k in amap and amap[k][1] > 0]
        hits = [(k, v) for k, v in hits_all if Brel[v[0]]]
        exact = sum(1 for _, (j, s) in hits if s == MATCH)
        n = max(1, len(idx))
        r = {"line": ln, "n_chars": len(idx), "exact": exact, "partial": len(hits) - exact,
             "match_ratio": round(len(hits_all) / n, 3), "reliable_ratio": round(len(hits) / n, 3)}
        if hits and MODE != "v1" or (MODE == "v1" and hits):
            js = [j for _, (j, s) in hits]
            r["st"] = Bst[js[0]]; r["en"] = Ben[js[-1]]
            # 첫 정합 글자가 줄의 앞쪽(앞 30% 내)에 있어야 시작 시각 신뢰
            first_pos = idx.index(hits[0][0]) / n
            rr = len(hits) / n
            r["anchor"] = ((rr >= 0.5 or (rr >= 0.35 and exact >= 4)) and len(hits) >= 2 and first_pos <= 0.34)
            if r["anchor"] and first_pos > 0:  # 앞 글자 미정합분 보정(글자당 0.25s 추정)
                r["st"] = max(0.0, r["st"] - first_pos * n * 0.25)
        else:
            r["anchor"] = False
        res.append(r)
    # 앵커 단조성 강제: 이전 앵커보다 이른 앵커는 해제
    last = -1.0
    for r in res:
        if r["anchor"]:
            if r["st"] < last - 1e-6: r["anchor"] = False; r["demoted"] = True
            else: last = r["st"]
    # 보간
    anchors = [i for i, r in enumerate(res) if r["anchor"]]
    for i, r in enumerate(res):
        if r["anchor"]: r["start"] = r["st"]; continue
        prv = max([a for a in anchors if a < i], default=None)
        nxt = min([a for a in anchors if a > i], default=None)
        if prv is not None and nxt is not None:
            t0 = res[prv]["st"]; t1 = res[nxt]["st"]
            w0 = sum(max(1, res[k]["n_chars"]) for k in range(prv, i))
            wt = sum(max(1, res[k]["n_chars"]) for k in range(prv, nxt))
            r["start"] = t0 + (t1 - t0) * w0 / wt
        elif prv is not None:
            r["start"] = min(duration, res[prv]["st"] + 0.25 * sum(max(1, res[k]["n_chars"]) for k in range(prv, i)))
        elif nxt is not None:
            r["start"] = max(0.0, res[nxt]["st"] - 0.25 * sum(max(1, res[k]["n_chars"]) for k in range(i, nxt)))
        else:
            r["start"] = None
    for i, r in enumerate(res):
        nxt_st = next((res[k]["start"] for k in range(i + 1, len(res)) if res[k]["start"] is not None), duration)
        if r["start"] is None: continue
        own_end = r.get("en") if r["anchor"] else r["start"] + 0.25 * max(1, r["n_chars"])
        end = min(nxt_st, max(own_end, r["start"] + 0.3))
        if nxt_st - end < 1.0: end = nxt_st  # 짧은 틈은 다음 줄까지 이어 표시
        r["end"] = end
    unmatched_B = len(B) - len({j for j, s in amap.values() if s > 0})
    unrel_words = len(unreliable)
    return res, {"A_chars": len(A), "B_chars": len(B), "B_unmatched": unmatched_B,
                 "char_match": round(sum(1 for j, s in amap.values() if s > 0) / max(1, len(A)), 3),
                 "char_exact": round(sum(1 for j, s in amap.values() if s == MATCH) / max(1, len(A)), 3),
                 "unreliable_words": unrel_words if MODE != "v1" else 0, "words": len(words)}

def suno_lines(ts):
    out = []
    for s in ts or []:
        t = str(s.get("text") or "").strip()
        if not t or _SECTION_TAG_RE.match(t) or _SEPARATOR_RE.match(t): continue
        t = _LABEL_RE.sub("", t)
        try: out.append({"text": t, "start": float(s["start"]), "end": float(s["end"])})
        except Exception: pass
    # staging _repair_timeline 과 같은 '몰린 줄' 표시
    n = len(out)
    for it in out: it["bad"] = (it["end"] - it["start"]) < 0.15
    for i in range(n):
        j = i
        while j + 1 < n and out[j + 1]["start"] - out[i]["start"] <= 0.5: j += 1
        if j - i + 1 >= 3:
            for k in range(i, j + 1): out[k]["bad"] = True
    return out

def repair_state(segs):
    """staging share_video._repair_timeline 판정 복제(가사 줄만 입력)."""
    sl = suno_lines(segs); n = len(sl)
    if n < 5: return "short"
    bad = sum(1 for x in sl if x["bad"])
    return "collapsed" if bad / n >= 0.5 else ("ok" if bad == 0 else "repaired")

def match_suno(lines, sl):
    """우리 가사 줄 ↔ Suno 줄 (정규화 텍스트 LCS 순서 매칭)."""
    a = ["".join(norm_chars(x)) for x in lines]; b = ["".join(norm_chars(x["text"])) for x in sl]
    n, m = len(a), len(b)
    L = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        for j in range(m - 1, -1, -1):
            L[i][j] = L[i + 1][j + 1] + 1 if a[i] and a[i] == b[j] else max(L[i + 1][j], L[i][j + 1])
    out = {}; i = j = 0
    while i < n and j < m:
        if a[i] and a[i] == b[j]: out[i] = j; i += 1; j += 1
        elif L[i + 1][j] >= L[i][j + 1]: i += 1
        else: j += 1
    return out

def pct(xs, q):
    xs = sorted(xs)
    if not xs: return None
    k = (len(xs) - 1) * q; f = int(k); c = min(f + 1, len(xs) - 1)
    return xs[f] + (xs[c] - xs[f]) * (k - f)

def main():
    rows = []
    for p in sorted(glob.glob(os.path.join(RAW, "*.json"))):
        d = json.load(open(p))
        lines = lyric_lines(d["lyrics_raw"])
        dur = d["audio_duration"]
        res, cst = realign(lines, d["whisper"]["words"], dur)
        sl = suno_lines(d["suno_timestamps"]); smap = match_suno(lines, sl)
        n = len(res)
        anchored = sum(1 for r in res if r["anchor"])
        matched = sum(1 for r in res if r["match_ratio"] >= 0.3)
        starts = [r["start"] for r in res if r.get("start") is not None]
        mono_viol = sum(1 for a, b in zip(starts, starts[1:]) if b < a - 1e-6)
        short = sum(1 for r in res if r.get("end") is not None and r["end"] - r["start"] < 0.15)
        cov = (max(r["end"] for r in res if r.get("end") is not None) - min(starts)) / dur if starts else 0
        # 최장 연속 비앵커 구간
        run = best_run = 0
        for r in res:
            run = run + 1 if not r["anchor"] else 0; best_run = max(best_run, run)
        table = []
        diffs = []; okdiffs = []
        for i, r in enumerate(res):
            s = sl[smap[i]] if i in smap else None
            row = {"i": i + 1, "line": r["line"], "new_start": round(r["start"], 2) if r.get("start") is not None else None,
                   "new_end": round(r["end"], 2) if r.get("end") is not None else None,
                   "anchor": r["anchor"], "match_ratio": r["match_ratio"],
                   "suno_start": round(s["start"], 2) if s else None, "suno_end": round(s["end"], 2) if s else None,
                   "suno_squashed": s["bad"] if s else None}
            if s and r.get("start") is not None:
                row["diff"] = round(r["start"] - s["start"], 2)
                if d["kind"] == "control": diffs.append((abs(row["diff"]), r["anchor"]))
                elif not s["bad"]: okdiffs.append(abs(row["diff"]))
            table.append(row)
        m = {"title": d["title"], "kind": d["kind"] + ("-holdout" if d["track_id"] in HOLDOUT else ""), "track_id": d["track_id"], "suno_state": d["suno_state"],
             "duration": round(dur, 1), "lines": n, "anchored": anchored, "anchor_ratio": round(anchored / max(1, n), 3),
             "matched_ratio": round(matched / max(1, n), 3), "mono_violations": mono_viol, "short_lines": short,
             "coverage": round(cov, 3), "max_unanchored_run": best_run, **cst,
             "t_api": d.get("t_api"), "audio_MB": round(d.get("audio_bytes", 0) / 1e6, 2),
             "cost_usd": round(dur / 60 * 0.006, 4)}
        new_ts = [{"text": r["line"], "start": round(r["start"], 2), "end": round(r["end"], 2)} for r in res if r.get("start") is not None]
        m["new_timeline_state"] = repair_state(new_ts)
        m["suno_lines_ok"] = sum(1 for x in sl if not x["bad"]); m["suno_lines"] = len(sl)
        if okdiffs:
            m.update({"vs_suno_ok_n": len(okdiffs), "vs_suno_ok_median": round(pct(okdiffs, .5), 2),
                      "vs_suno_ok_p90": round(pct(okdiffs, .9), 2)})
        if diffs:
            all_d = [x for x, _ in diffs]; anc_d = [x for x, a in diffs if a]
            m.update({"ctrl_n": len(all_d), "ctrl_median": round(pct(all_d, .5), 2), "ctrl_p90": round(pct(all_d, .9), 2),
                      "ctrl_anchor_median": round(pct(anc_d, .5), 2) if anc_d else None,
                      "ctrl_anchor_p90": round(pct(anc_d, .9), 2) if anc_d else None,
                      "ctrl_within_1s": round(sum(1 for x in all_d if x <= 1) / len(all_d), 3),
                      "_diffs": all_d})
        rows.append(m)
        json.dump({"metrics": m, "table": table, "realigned_timestamps": new_ts}, open(os.path.join(RES, f"{d['track_id']}_{d['title'].replace(' ', '_')}.json"), "w"),
                  ensure_ascii=False, indent=1)
    json.dump(rows, open(os.path.join(RES, "summary.json"), "w"), ensure_ascii=False, indent=1)
    for m in rows:
        print({k: v for k, v in m.items() if k != "_diffs"})
    for name, sel in (("tune(3)", lambda m: m["track_id"] not in HOLDOUT), ("holdout(3)", lambda m: m["track_id"] in HOLDOUT), ("all(6)", lambda m: True)):
        ctrl = [x for m in rows if m.get("_diffs") and sel(m) for x in m["_diffs"]]
        if ctrl: print("CONTROL %s %s n=%d median=%.2f p90=%.2f within1s=%.2f" % (MODE, name, len(ctrl), pct(ctrl, .5), pct(ctrl, .9), sum(1 for x in ctrl if x <= 1) / len(ctrl)))

if __name__ == "__main__":
    main()
