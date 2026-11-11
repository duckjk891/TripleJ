#!/usr/bin/env python3
"""Loop edit (song 0 -> 38.52s): one shot per lyric line, cut on the bar.

usage: build_loop.py R|C [ver]
  R = realistic clips out/loop/R1..R5.mp4, C = comic clips out/loop/C1..C5.mp4
Each clip has four 2-second shots; each shot fills one lyric line (4 beats).
Comic version opens on the real cover still (0 -> first bar) so the loop
closes on the same picture L5 pulls back to.
"""
import json, os, subprocess, sys

KIND = sys.argv[1]
VER = sys.argv[2] if len(sys.argv) > 2 else "v1"
OUT = os.path.expanduser("~/TripleJ/claude_skills_outputs/marketing/higgsfield/out")
L = f"{OUT}/loop"
SEG = f"{OUT}/segs_loop_{KIND}"
os.makedirs(SEG, exist_ok=True)
FPS = 24
beats = json.load(open(f"{OUT}/track.json"))["beats"]
START_I = 1            # beats[1] = 0.46, first bar ("둠칫")
END_T = 38.52          # end of the hook bar; verse 2 starts after
end_i = beats.index(END_T)
assert (end_i - START_I) == 80, end_i   # 20 lines x 4 beats

def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        print(r.stderr[-2000:]); sys.exit(1)

def fr(t):
    return round(t * FPS)

segs, log = [], []
# intro: 0 -> beats[1]
intro_n = fr(beats[START_I])
intro = f"{SEG}/s00.mp4"
if KIND == "C":
    run(["ffmpeg", "-v", "error", "-y", "-loop", "1", "-i", f"{OUT}/cover.png",
         "-vf", "scale=-2:720,pad=1280:720:(ow-iw)/2:0:color=white,setsar=1,fps=24",
         "-frames:v", str(intro_n), "-c:v", "libx264", "-crf", "14", "-pix_fmt", "yuv420p", intro])
else:
    # realistic: hold the first frame of L1 for the pickup
    run(["ffmpeg", "-v", "error", "-y", "-i", f"{L}/R1.mp4", "-vf",
         f"trim=end_frame=1,loop={intro_n}:1:0,setpts=N/{FPS}/TB,scale=1280:720,setsar=1,fps=24",
         "-frames:v", str(intro_n), "-c:v", "libx264", "-crf", "14", "-pix_fmt", "yuv420p", intro])
segs.append(intro)
log.append(f"intro 0.00-{beats[START_I]:.2f} ({intro_n} fr)")

bi = START_I
k = 1
for clip in range(1, 6):
    for shot in range(4):
        # Kling's internal cuts land at ~2.04 / 4.04-4.08 / 6.04-6.08s: start past them
        a, b = shot * 2 + (0.0 if shot == 0 else 0.12), shot * 2 + 2.0
        n = fr(beats[bi + 4]) - fr(beats[bi])
        speed = (b - a) / (n / FPS)
        out = f"{SEG}/s{k:02d}.mp4"
        run(["ffmpeg", "-v", "error", "-y", "-ss", f"{a}", "-i", f"{L}/{KIND}{clip}.mp4",
             "-vf", f"setpts=(PTS-STARTPTS)/{speed:.5f},fps={FPS},scale=1280:720,setsar=1",
             "-frames:v", str(n), "-an", "-c:v", "libx264", "-crf", "14", "-pix_fmt", "yuv420p", out])
        segs.append(out)
        log.append(f"L{clip} shot{shot+1} src {a:.2f}-{b:.2f} -> {beats[bi]:.2f}-{beats[bi+4]:.2f} x{speed:.2f}")
        bi += 4; k += 1

total = fr(END_T)
dur = total / FPS
print("\n".join(log)); print(f"total {total} fr = {dur:.3f}s")
with open(f"{SEG}/list.txt", "w") as fh:
    fh.writelines(f"file '{s}'\n" for s in segs)
run(["ffmpeg", "-v", "error", "-y", "-t", f"{dur:.3f}", "-i", f"{OUT}/song.mp3",
     "-af", f"afade=t=in:d=0.02,afade=t=out:st={dur-0.03:.3f}:d=0.03",
     "-ar", "44100", "-ac", "2", f"{SEG}/song.wav"])
final = f"{OUT}/loop_{'comic' if KIND == 'C' else 'real'}_{VER}.mp4"
run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", f"{SEG}/list.txt",
     "-i", f"{SEG}/song.wav", "-map", "0:v:0", "-map", "1:a:0",
     "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p",
     "-c:a", "aac", "-profile:a", "aac_low", "-b:a", "192k", "-ar", "44100", "-ac", "2",
     "-movflags", "+faststart", "-shortest", final])
print("wrote", final)
