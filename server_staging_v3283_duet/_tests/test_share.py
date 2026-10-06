"""v3.283 — 정규화본이 정렬 기준이 됐을 때 share_video 필터/복구/후렴 탐지 호환성 (가상 타임라인)."""
import json
from app.services import suno_generator as NEW
from app.services import share_video as SV
data = json.load(open("/t/samples2.json"))
g = data["duet"][1]
out, _ = NEW._normalize_duet_lyrics_for_suno(NEW._ensure_lyrics_structure(g["lyrics"].strip()))
out, act = NEW._ensure_leadin_intro(out)
print("leadin:", act); print(out[:700]); print("...")
lines = [l.strip() for l in out.split("\n") if l.strip()]
t = 5.0; raw = []
for l in lines:  # Suno 처럼 태그 줄도 세그먼트로 돌아온다고 가정, 정상 간격
    raw.append({"text": l, "start": t, "end": t + (0.05 if l.startswith("[") else 2.5)}); t += (0.05 if l.startswith("[") else 2.6)
kept, st = SV._repair_timeline(raw)
segs = SV._filter_segments(kept)
print("repair_state:", st, "raw:", len(raw), "kept:", len(kept), "display_segments:", len(segs))
print("tags leaked to display:", [s["text"] for s in segs if s["text"].startswith("[")])
print("lyric lines in prompt:", sum(1 for l in lines if not l.startswith("[")))
print("first_chorus_start:", SV.first_chorus_start(raw))
# old-format timeline for comparison (labels on lines) — label stripped by _VOCAL_LABEL_RE
old_lines = [l.strip() for l in g["lyrics"].split("\n") if l.strip()]
t = 5.0; raw_old = []
for l in old_lines:
    tag = bool(SV._SECTION_TAG_RE.match(l) or SV._SEPARATOR_RE.match(l))
    raw_old.append({"text": l, "start": t, "end": t + (0.05 if tag else 2.5)}); t += (0.05 if tag else 2.6)
so = SV._filter_segments(SV._repair_timeline(raw_old)[0])
print("old display segments:", len(so), "| same display texts:", [s["text"] for s in so] == [s["text"] for s in segs])
