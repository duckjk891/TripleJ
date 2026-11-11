#!/usr/bin/env python3
"""Beat-synced cut edit of the banggap teaser (Kling clips + song, all local).

v2: no zoom bounce. The "bouncy" feel comes from hard cuts that change on the
beat: long shots are split into 2-3 beat chunks that alternate between the full
frame and a tighter punch-in crop (static, no motion), so the picture snaps on
every change.
"""
import json, os, subprocess, sys

OUT = os.path.expanduser("~/TripleJ/claude_skills_outputs/marketing/higgsfield/out")
K = f"{OUT}/kling"
SEG = f"{OUT}/segs"
VER = sys.argv[1] if len(sys.argv) > 1 else "v2"
os.makedirs(SEG, exist_ok=True)
FPS = 24
PUNCH = 1.22                    # punch-in crop factor
beats = json.load(open(f"{OUT}/track.json"))["beats"]
T0 = 19.48                      # bar start just before "한 걸음씩"
b0 = beats.index(T0)

# (clip, src_in, src_out, n_beats, crop, fx)   crop: 1 = full frame, PUNCH = tight
P = PUNCH
PLAN = [
    # V01 tired walk (12)
    ("V01", 0.00, 0.95, 2, 1, None),
    ("V01", 0.96, 1.74, 2, 1, None),
    ("V01", 1.76, 2.53, 2, 1, None),
    ("V01", 2.55, 3.32, 2, 1, None),
    ("V01", 3.40, 4.40, 2, 1, None),
    ("V01", 4.40, 5.40, 2, P, None),
    # V02 belly, stomp, sniff, head turn (12)
    ("V02", 0.20, 1.82, 3, 1, None),
    ("V02", 1.85, 3.30, 3, 1, None),
    ("V02", 3.95, 5.28, 2, 1, None),
    ("V02", 5.30, 6.30, 2, 1, None),
    ("V02", 6.30, 7.50, 2, P, None),
    # V03 lime world x2 (4)
    ("V03", 0.00, 1.95, 2, 1, None),
    ("V03", 1.95, 3.95, 2, P, None),
    # V04 chicken offer x2 (4)
    ("V04", 0.00, 3.95, 4, 1, None),
    # V05 giant chicken, white flash out (4)
    ("V05", 0.90, 2.40, 2, 1, None),
    ("V05", 2.40, 3.95, 2, P, "flash_out"),
    # V06 refuse + high five (8)
    ("V06", 0.30, 2.00, 3, 1, None),
    ("V06", 2.00, 3.40, 2, P, None),
    ("V06", 3.43, 5.00, 3, 1, None),
    # V07 tug of war x2 (4)
    ("V07", 0.00, 3.95, 4, 1, None),
    # V08 shield, megaphone, chicken at mouth (20)
    ("V08", 0.00, 0.95, 2, 1, None),
    ("V08", 1.02, 1.98, 2, 1, None),
    ("V08", 2.02, 3.45, 3, 1, None),
    ("V08", 3.55, 5.00, 3, P, None),
    ("V08", 5.02, 6.00, 2, 1, None),
    ("V08", 6.00, 7.00, 2, P, None),
    ("V08", 7.00, 8.00, 2, 1, None),
    ("V08", 8.00, 9.00, 2, P, None),
    ("V08", 9.00, 10.0, 2, 1, None),
    # V09 phone, men pointing, smile + timer (20)
    ("V09", 0.00, 1.30, 3, 1, None),
    ("V09", 1.50, 2.55, 2, 1, None),
    ("V09", 2.60, 3.65, 2, P, None),
    ("V09", 3.70, 5.20, 3, 1, None),
    ("V09", 5.32, 6.27, 2, 1, None),
    ("V09", 6.30, 7.25, 2, P, None),
    ("V09", 7.30, 8.70, 3, 1, None),
    ("V09", 8.70, 10.0, 3, P, None),
    # V10 drop: snap every 2 beats (16)
    ("V10", 0.00, 0.95, 2, 1, "flash_in"),
    ("V10", 0.95, 1.90, 2, P, None),
    ("V10", 1.90, 2.85, 2, 1, None),
    ("V10", 2.85, 3.95, 2, P, None),
    ("V10", 4.12, 5.07, 2, 1, None),
    ("V10", 5.07, 6.02, 2, P, None),
    ("V10", 6.02, 6.97, 2, 1, None),
    ("V10", 6.97, 8.00, 2, P, None),
    # V11 gym ending (16)
    ("V11", 0.00, 0.91, 2, 1, None),
    ("V11", 0.91, 1.82, 2, P, None),
    ("V11", 1.85, 3.20, 3, 1, None),
    ("V11", 3.22, 4.45, 3, 1, None),
    ("V11", 4.48, 5.60, 2, 1, None),
    ("V11", 5.60, 6.70, 2, P, None),
    ("V11", 6.70, 8.02, 2, 1, None),
]

def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        print(r.stderr[-2000:]); sys.exit(1)

bi = b0
segfiles, log = [], []
for i, (clip, a, b, nb, crop, fx) in enumerate(PLAN):
    f0 = round((beats[bi] - T0) * FPS)
    f1 = round((beats[bi + nb] - T0) * FPS)
    n = f1 - f0
    speed = (b - a) / (n / FPS)
    vf = f"setpts=(PTS-STARTPTS)/{speed:.5f},fps={FPS}"
    if crop != 1:
        # tighter frame, kept a little high so faces stay in
        vf += f",crop=iw/{crop}:ih/{crop}:(iw-ow)/2:(ih-oh)*0.4"
    vf += ",scale=1280:720:flags=lanczos,setsar=1"
    d = n / FPS
    if fx == "flash_out":
        vf += f",fade=t=out:st={d-0.13:.3f}:d=0.13:color=white"
    if fx == "flash_in":
        vf += ",fade=t=in:st=0:d=0.13:color=white"
    out = f"{SEG}/s{i:02d}.mp4"
    run(["ffmpeg", "-v", "error", "-y", "-ss", f"{a}", "-i", f"{K}/{clip}.mp4",
         "-vf", vf, "-frames:v", str(n), "-an", "-c:v", "libx264", "-preset", "fast",
         "-crf", "14", "-pix_fmt", "yuv420p", out])
    segfiles.append(out)
    log.append(f"{i:02d} {clip} src {a:.2f}-{b:.2f} -> song {beats[bi]:.2f}-{beats[bi+nb]:.2f} "
               f"({nb} beats, {n} fr, x{speed:.2f}{', punch' if crop != 1 else ''})")
    bi += nb

T1 = beats[bi]
total = round((T1 - T0) * FPS)
print("\n".join(log))
print(f"song {T0}-{T1}  {len(PLAN)} cuts  total {total} frames = {total/FPS:.2f}s")

with open(f"{SEG}/list.txt", "w") as fh:
    fh.writelines(f"file '{s}'\n" for s in segfiles)
dur = total / FPS
final = f"{OUT}/banggap_teaser_draft_{VER}.mp4"
# Decode the song to WAV first, then encode plain AAC-LC 44.1 kHz stereo for widest player support.
run(["ffmpeg", "-v", "error", "-y", "-ss", f"{T0}", "-t", f"{dur:.3f}", "-i", f"{OUT}/song.mp3",
     "-af", f"afade=t=in:d=0.04,afade=t=out:st={dur-0.6:.3f}:d=0.6",
     "-ar", "44100", "-ac", "2", f"{SEG}/song_cut.wav"])
run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", f"{SEG}/list.txt",
     "-i", f"{SEG}/song_cut.wav",
     "-map", "0:v:0", "-map", "1:a:0",
     "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p",
     "-profile:v", "high", "-level", "4.0",
     "-c:a", "aac", "-profile:a", "aac_low", "-b:a", "192k", "-ar", "44100", "-ac", "2",
     "-disposition:a:0", "default", "-movflags", "+faststart", "-shortest", final])
print("wrote", final)
