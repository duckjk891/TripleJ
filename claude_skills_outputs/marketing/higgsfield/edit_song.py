#!/usr/bin/env python3
"""Full-song comic edit (0 -> end of song) for 「더 나오려는 것을 막는 것일뿐」.

usage: python3 edit_song.py [ver]        -> out/song_comic_<ver>.mp4

Every shot is fitted to whole beats (server beat grid in out/track.json).
Sources:
  K<n>   out/loop/C<n>.mp4      Kling 4.0 clips L1-L11 (720p)
  S:<x>  out/sd720/<x>.mp4      Seedance 2.5 clips, 480p upscaled to 720p
                                (lanczos + unsharp, see sd_dl step)
  F:<x>  out/loop/<x>.mp4       other single files (C10sofa)
Audio = the song only (no clip audio).
"""
import json, os, subprocess, sys

VER = sys.argv[1] if len(sys.argv) > 1 else "v1"
OUT = os.path.expanduser("~/TripleJ/claude_skills_outputs/marketing/higgsfield/out")
SEG = f"{OUT}/segs_song"
os.makedirs(SEG, exist_ok=True)
FPS = 24
beats = json.load(open(f"{OUT}/track.json"))["beats"]
NIGHT = "eq=brightness=-0.07:saturation=0.75,colorbalance=rs=-0.12:bs=0.22:rm=-0.08:bm=0.15:bh=0.08"


def src(tag):
    if tag.startswith("K"):
        return f"{OUT}/loop/C{tag[1:]}.mp4"
    kind, name = tag.split(":")
    if kind == "S":
        # prefer the Real-ESRGAN (realesr-animevideov3 x2 -> 1280x720) version when it exists
        esr = f"{OUT}/sd720esr/{name}.mp4"
        return esr if os.path.exists(esr) else f"{OUT}/sd720/{name}.mp4"
    return f"{OUT}/loop/{name}.mp4"


def K(n, shot):
    """Kling clip, standard 2-second shot (skip Kling's internal cut frames)."""
    if n == 5 and shot == 3:
        return (f"K{n}", 6.12, 7.45)  # stop before the comic-page pull-back
    return (f"K{n}", shot * 2 + (0.0 if shot == 0 else 0.12), shot * 2 + 2.0)


def S(name, a, b):
    return (f"S:{name}", a, b)


# (source, a, b, beats, fx)
T = []
def add(s, nb=4, fx=None):
    T.append((s[0], s[1], s[2], nb, fx))

def clip_std(n):
    for sh in range(4):
        add(K(n, sh))

# L1-L5  0.00-38.52  (Kling, as the loop video)
for n in range(1, 6):
    clip_std(n)
# L6 lunch: menu (Seedance fix), side lunge, salad squats (Seedance), band push
add(S("Cfix", 0.10, 2.70)); add(K(6, 1)); add(S("C6salad", 1.30, 3.95)); add(K(6, 3))
# L7-L9
for n in (7, 8, 9):
    clip_std(n)
# L10 commute: fork + band (Seedance fix), sofa spring-up, night run
add(S("Cfix", 2.90, 5.75)); add(S("Cfix", 5.95, 8.00)); add(("F:C10sofa", 0.6, 3.4)); add(K(10, 3))
# L11
clip_std(11)
# L12 park chorus 3, L13 weekend scale
for a, b in ((0.05, 1.95), (2.05, 3.95), (4.05, 5.95), (6.05, 8.0)):
    add(S("C12", a, b))
for a, b in ((0.05, 2.0), (2.15, 3.95), (4.05, 5.95), (6.05, 8.0)):
    add(S("C13", a, b))
# L14 bridge (8 bars, slow): ball 2 bars / jog 1 / water 2 + jog 1 / arc stretch 2
add(S("C14", 0.05, 1.80), 8); add(S("C14", 1.90, 3.90), 4)
add(S("C14", 4.00, 5.90), 8); add(S("C14", 2.60, 3.90), 4); add(S("C14", 6.25, 8.00), 8)
# L15 break -> build (8 bars)
add(S("C15", 0.05, 1.60)); add(S("C15", 1.70, 4.30)); add(S("C15", 4.40, 5.80))
add(S("C15", 5.85, 7.55), 8)                          # crouch, slow tension (2 bars)
def mid(s, w):
    m = (s[1] + s[2]) / 2
    return (s[0], m - w / 2, m + w / 2)

add(mid(K(9, 1), 1.0), 2); add(mid(K(11, 1), 1.0), 2)  # 2-beat cuts
for s in (K(8, 2), K(7, 2), S("C12", 4.05, 5.95), K(3, 0)):
    add(mid(s, 0.6), 1)                                # 1-beat cuts
for tag, a in (("K1", 0.6), ("K2", 6.9), ("K4", 4.8), ("K9", 4.8), ("S:C13", 6.7), ("K5", 2.8)):
    add((tag, a, a + 0.3), 0.5)                        # half-beat cuts
add(S("C15", 7.30, 7.90), 1)                           # explode into the last chorus (legs still in frame)
# L16 last chorus (climax), L17 hook together
for a, b in ((0.05, 1.95), (2.05, 3.95), (4.10, 6.20), (6.30, 8.0)):
    add(S("C16", a, b))
for a, b in ((0.05, 1.95), (2.05, 3.95), (4.30, 6.20), (6.30, 8.0)):
    add(S("C17", a, b))
# L18 struggle montage: 32 one-beat cuts, a "block it" shot on every bar's first beat
MAKA = [K(4, 1), K(8, 1), S("C12", 2.05, 3.95), S("C16", 2.05, 3.95)] * 2
POOL = [K(1, 0), K(3, 0), K(7, 2), K(9, 1), K(2, 3), K(11, 1), K(5, 0),
        K(8, 2), K(3, 3), K(9, 2), S("C13", 0.05, 2.0), K(1, 2),
        K(7, 0), K(11, 3), K(4, 2), S("C12", 4.05, 5.95), K(2, 0), K(5, 1),
        K(9, 0), K(8, 3), K(11, 2), S("C13", 4.05, 5.95), K(4, 3), K(6, 1)]
pi = 0
for bar in range(8):
    m = MAKA[bar]
    mid = (m[1] + m[2]) / 2
    add((m[0], mid - 0.35, mid + 0.35), 1)
    for _ in range(3):
        p = POOL[pi]; pi += 1
        mid = (p[1] + p[2]) / 2
        add((p[0], mid - 0.3, mid + 0.3), 1)
# L19 quiet break again, night colors (8 bars)
for s in (S("C14", 0.05, 1.80), S("C14", 1.90, 3.90), S("C14", 4.00, 5.90), S("C14", 6.25, 8.00),
          S("C15", 0.05, 1.60), S("C15", 1.70, 4.30), S("C15", 4.40, 5.80), S("C15", 5.85, 7.90)):
    add(s, 4, NIGHT)
# L20 chorus again = first chorus, L21 hook again = first hook
clip_std(4)
clip_std(5)
# L22 outro (10-second clip): shoes off, mirror high five, dance to bed, flop on bed -> song end
# Outro lines are sung later than the bar grid (server lyric timeline):
#   둠칫, 내일도 시작해 191.78 / 거울 속 나와 high five 194.22-195.98 / 느려도 난 계속 가 196.06 / 가볍게 웃으며 dance 197.97
add(S("C22", 0.35, 2.30), 7)      # 190.91-194.25 shoes off + stretch (skip the zoom-out in the first 0.3s)
add(S("C22", 2.45, 3.40), 4)      # 194.25-196.15 mirror high five, the slap lands on the beat at ~195.2
add(S("C22", 3.45, 6.20), 6)      # 196.15-199.00 dance steps to the bed ("느려도 난 계속 가 / 가볍게 웃으며 dance")
TAIL = ("S:C22", 6.30, 8.30)      # 199.00-end flop on the bed (~0.9x, calm)


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True, stdin=subprocess.DEVNULL)
    if r.returncode:
        print(" ".join(cmd)); print(r.stderr[-2000:]); sys.exit(1)


def fr(t):
    return round(t * FPS)


song_dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                 "-of", "csv=p=0", f"{OUT}/song.mp3"], capture_output=True, text=True).stdout)

# beat position -> time (fractional positions interpolate)
def bt(p):
    i = int(p)
    f = p - i
    return beats[i] + (beats[i + 1] - beats[i]) * f if f else beats[i]


segs, log = [], []
pos = 1.0          # beats[1] = 0.46, first bar; the first shot also covers 0 -> 0.46
t_prev_frame = 0
for k, (tag, a, b, nb, fx) in enumerate(T + [(TAIL[0], TAIL[1], TAIL[2], None, None)]):
    if nb is None:
        end_frame = fr(song_dur)
        pos_end = None
    else:
        pos_end = pos + nb
        end_frame = fr(bt(pos_end))
    n = end_frame - t_prev_frame
    speed = (b - a) / (n / FPS)
    vf = f"setpts=(PTS-STARTPTS)/{speed:.5f},fps={FPS},scale=1280:720,setsar=1"
    if fx:
        vf += "," + fx
    out = f"{SEG}/s{k:03d}.mp4"
    run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-ss", f"{a}", "-i", src(tag), "-vf", vf,
         "-frames:v", str(n), "-an", "-c:v", "libx264", "-crf", "15", "-pix_fmt", "yuv420p", out])
    segs.append(out)
    log.append(f"{k:03d} {t_prev_frame/FPS:7.2f}-{end_frame/FPS:7.2f} {tag:10s} {a:5.2f}-{b:5.2f} x{speed:.2f}{' night' if fx else ''}")
    t_prev_frame = end_frame
    if pos_end is not None:
        pos = pos_end

assert abs(pos - 418) < 1e-6, pos   # the tail (bed) starts on beat 418 = 199.00s and runs to the song end
total = t_prev_frame
dur = total / FPS
open(f"{SEG}/log.txt", "w").write("\n".join(log) + "\n")
print(f"{len(segs)} segments, {dur:.3f}s (song {song_dur:.3f}s)")
with open(f"{SEG}/list.txt", "w") as fh:
    fh.writelines(f"file '{s}'\n" for s in segs)
run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-t", f"{dur:.3f}", "-i", f"{OUT}/song.mp3",
     "-af", f"afade=t=in:d=0.02,afade=t=out:st={dur-0.5:.3f}:d=0.5",
     "-ar", "44100", "-ac", "2", f"{SEG}/song.wav"])
final = f"{OUT}/song_comic_{VER}.mp4"
run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", f"{SEG}/list.txt",
     "-i", f"{SEG}/song.wav", "-map", "0:v:0", "-map", "1:a:0",
     "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p",
     "-c:a", "aac", "-profile:a", "aac_low", "-b:a", "192k", "-ar", "44100", "-ac", "2",
     "-movflags", "+faststart", "-shortest", final])
print("wrote", final)
