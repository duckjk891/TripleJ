"""v3.283 lyrics prompt diff — no network, no LLM call."""
import difflib, sys
from app.services import lyrics_generator as NEW
from app.services import lyrics_generator_orig as OLD
def D(a, b, label):
    d = list(difflib.unified_diff(a.splitlines(), b.splitlines(), "orig", "new", lineterm="", n=0))
    print(f"### {label}: {'IDENTICAL' if not d else 'CHANGED'}")
    for l in d[2:]: print("   ", l)
for duet in (False, True):
    D(OLD._system_prompt_for(duet), NEW._system_prompt_for(duet), f"system duet={duet}")
for dm in (1, 2, 3, 4, 5, None):
    for structure in (None, "[Intro] [Verse] [Chorus] [Verse] [Chorus] [Bridge] [Chorus] [Outro]"):
        a = OLD._build_user_message("p", "Ballad", "Sad", None, dm, True, "soft", "warm", "ko", structure=structure)
        b = NEW._build_user_message("p", "Ballad", "Sad", None, dm, True, "soft", "warm", "ko", structure=structure)
        D(a, b, f"user dm={dm} structure={'Y' if structure else 'N'}")
# shape log: cap warnings
import logging; logging.basicConfig(level=logging.INFO, stream=sys.stdout, format="%(levelname)s %(message)s")
long_lyr = "\n\n".join(f"[Verse {i}]\n" + "\n".join(f"line{i}{j}" for j in range(4)) for i in range(9))
for dm in (1, 2, 3, 4):
    NEW._log_lyrics_shape({"lyrics": long_lyr, "model": "x"}, dm)
NEW._log_lyrics_shape({"lyrics": "[Verse]\na\nb\n\n[Chorus]\nc", "model": "x"}, 2)
print("caps:", {dm: NEW._length_cap_for(dm) for dm in (1, 2, 3, 4, 5, None, "2")})
