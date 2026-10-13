"""기준곡별 추천 후보 상위 5 — 종전(검색 임베딩 최근접) vs v3.360(곡 느낌 점수). 격리 컨테이너에서 catalog.json 으로."""
import json, re, sys
import numpy as np
import app.services.related_feel as RF

INST = re.compile(r"\((Inst\.|MR)\)\s*$")
cat = json.load(open(sys.argv[1]))["tracks"]
pub = [t for t in cat if t["is_public"] and not INST.search(t.get("title") or "")]
ids = [t["id"] for t in cat if t.get("emb")]
m = np.stack([np.array(json.loads(t["emb"]) if isinstance(t["emb"], str) else t["emb"], dtype=np.float32) for t in cat if t.get("emb")])
m /= np.linalg.norm(m, axis=1, keepdims=True)
ix = {t: i for i, t in enumerate(ids)}
by = {t["id"]: t for t in cat}
pubset = {t["id"] for t in pub}


def lab(t):
    g = "/".join(t.get("genre") or []) or "-"
    md = "/".join(t.get("mood") or []) or "-"
    return f"{t['title']} [{g} · {md}]"


for title in sys.argv[2:]:
    seed = next((t for t in pub if t["title"] == title), None)
    if not seed:
        continue
    sims = m @ m[ix[seed["id"]]]
    vec = [ids[j] for j in np.argsort(-sims) if ids[j] != seed["id"] and ids[j] in pubset][:5]
    feel = sorted((t for t in pub if t["id"] != seed["id"]), key=lambda t: -RF.feel_score(seed, t))[:5]
    print(f"\n■ {lab(seed)}")
    print("  종전:", " | ".join(lab(by[i]) for i in vec))
    print("  변경:", " | ".join(lab(t) for t in feel))
