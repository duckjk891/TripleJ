#!/usr/bin/env python3
"""Beat-synced cut edit of the banggap teaser (Kling clips + song, all local)."""
import json, os, subprocess, sys

OUT = os.path.expanduser("~/TripleJ/claude_skills_outputs/marketing/higgsfield/out")
K = f"{OUT}/kling"
SEG = f"{OUT}/segs"
os.makedirs(SEG, exist_ok=True)
FPS = 24
beats = json.load(open(f"{OUT}/track.json"))["beats"]
T0 = 19.48                      # bar start just before "한 걸음씩"
b0 = beats.index(T0)

# (clip, src_in, src_out, n_beats, fx)   fx: None | 'flash_out' | 'flash_in'
PLAN = [
    # V01 tired walk (12 beats)
    ("V01", 0.00, 0.95, 2, None),
    ("V01", 0.96, 1.74, 2, None),
    ("V01", 1.76, 2.53, 2, None),
    ("V01", 2.55, 3.32, 2, None),
    ("V01", 3.40, 5.40, 4, None),
    # V02 belly, stomp, sniff, head turn (12)
    ("V02", 0.20, 1.82, 3, None),
    ("V02", 1.85, 3.30, 3, None),
    ("V02", 3.95, 5.28, 2, None),
    ("V02", 5.30, 7.50, 4, None),
    # V03 lime world x2 (4)
    ("V03", 0.00, 3.95, 4, None),
    # V04 chicken offer x2 (4)
    ("V04", 0.00, 3.95, 4, None),
    # V05 giant chicken x1.5, white flash out (4)
    ("V05", 0.90, 3.95, 4, "flash_out"),
    # V06 refuse + high five (8)
    ("V06", 0.30, 3.40, 5, None),
    ("V06", 3.43, 5.00, 3, None),
    # V07 tug of war x2 (4)
    ("V07", 0.00, 3.95, 4, None),
    # V08 shield, megaphone, chicken at mouth (20)
    ("V08", 0.00, 0.95, 2, None),
    ("V08", 1.02, 1.98, 2, None),
    ("V08", 2.02, 5.00, 6, None),
    ("V08", 5.02, 6.90, 4, None),
    ("V08", 7.30, 8.30, 2, None),
    ("V08", 8.60, 10.0, 4, None),
    # V09 phone, men pointing, smile + timer (20)
    ("V09", 0.00, 1.30, 3, None),
    ("V09", 1.50, 5.20, 7, None),
    ("V09", 5.32, 7.20, 4, None),
    ("V09", 7.30, 10.0, 6, None),
    # V10 drop (16)
    ("V10", 0.00, 4.00, 8, "flash_in"),
    ("V10", 4.12, 8.00, 8, None),
    # V11 gym ending (16)
    ("V11", 0.00, 1.82, 4, None),
    ("V11", 1.85, 3.20, 3, None),
    ("V11", 3.22, 4.45, 3, None),
    ("V11", 4.48, 8.02, 6, None),
]

def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        print(r.stderr[-2000:]); sys.exit(1)

bi = b0
segfiles = []
log = []
drop_start = drop_end = None
for i, (clip, a, b, nb, fx) in enumerate(PLAN):
    f0 = round((beats[bi] - T0) * FPS)
    f1 = round((beats[bi + nb] - T0) * FPS)
    n = f1 - f0
    speed = (b - a) / (n / FPS)
    if clip == "V10" and drop_start is None:
        drop_start = beats[bi] - T0
    if clip == "V10":
        drop_end = beats[bi + nb] - T0
    vf = f"setpts=(PTS-STARTPTS)/{speed:.5f},fps={FPS},scale=1280:720,setsar=1"
    d = n / FPS
    if fx == "flash_out":
        vf += f",fade=t=out:st={d-0.13:.3f}:d=0.13:color=white"
    if fx == "flash_in":
        vf += ",fade=t=in:st=0:d=0.17:color=white"
    out = f"{SEG}/s{i:02d}.mp4"
    run(["ffmpeg", "-v", "error", "-y", "-ss", f"{a}", "-i", f"{K}/{clip}.mp4",
         "-vf", vf, "-frames:v", str(n), "-an", "-c:v", "libx264", "-preset", "fast",
         "-crf", "14", "-pix_fmt", "yuv420p", out])
    segfiles.append(out)
    log.append(f"{i:02d} {clip} src {a:.2f}-{b:.2f} -> song {beats[bi]:.2f}-{beats[bi+nb]:.2f} "
               f"({nb} beats, {n} frames, x{speed:.2f})")
    bi += nb

T1 = beats[bi]
total = round((T1 - T0) * FPS)
print("\n".join(log))
print(f"song {T0}-{T1}  total {total} frames = {total/FPS:.2f}s; drop {drop_start:.2f}-{drop_end:.2f}")

with open(f"{SEG}/list.txt", "w") as fh:
    fh.writelines(f"file '{s}'\n" for s in segfiles)
run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", f"{SEG}/list.txt",
     "-c", "copy", f"{SEG}/joined.mp4"])

# Beat bounce: zoom kick on every beat that decays fast; bigger on bar starts and in the drop.
P = (T1 - T0) / (bi - b0)
ph = f"mod(it,{P:.5f})"
bar = f"lt(mod(it,{4*P:.5f}),{P*0.5:.5f})"
drop = f"between(it,{drop_start:.3f},{drop_end:.3f})"
amp = f"if({drop},0.075,if({bar},0.06,0.03))"
z = f"1+{amp}*exp(-{ph}/0.085)"
zp = (f"scale=2560:1440,zoompan=z='{z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
      f":d=1:s=1280x720:fps={FPS}")
final = f"{OUT}/banggap_teaser_draft_v1.mp4"
dur = total / FPS
run(["ffmpeg", "-v", "error", "-y", "-i", f"{SEG}/joined.mp4",
     "-ss", f"{T0}", "-t", f"{dur:.3f}", "-i", f"{OUT}/song.mp3",
     "-filter_complex",
     f"[0:v]{zp},format=yuv420p[v];[1:a]afade=t=in:d=0.04,afade=t=out:st={dur-0.6:.3f}:d=0.6[a]",
     "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "medium", "-crf", "17",
     "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", final])
print("wrote", final)
