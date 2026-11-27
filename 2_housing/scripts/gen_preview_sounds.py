#!/usr/bin/env python3
# v3.451 [CreationPreview] 작곡 화면 키·BPM 미리 듣기 소리 만들기(오리쟁이 11-25 신고 6b06aa34·대표 11-27).
#
# 외부 AI·외부 서비스 없이 이 스크립트가 직접 합성한다(표준 라이브러리 + ffmpeg mp3 인코딩만).
#   키  : assets/sounds/preview/key_<음>_<major|minor>.mp3 — 피아노 비슷한 화음 4개(약 3.2초)
#          메이저 I–V–vi–IV(밝게), 마이너 i–VI–III–VII(어둡게)
#   BPM : assets/sounds/preview/bpm_<60..200>.mp3 — 킥·스네어·하이햇 박자 4초(5 간격, 29개)
# 다시 만들기: python3 scripts/gen_preview_sounds.py  (2_housing 에서, ffmpeg 필요)
import math
import os
import random
import struct
import subprocess
import tempfile
import wave

SR = 22050
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'sounds', 'preview')

NOTE = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
KEYS = ['C', 'D', 'E', 'F', 'G', 'A', 'B']


def midi_hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def piano(buf, start, dur, hz, amp):
    """배음 + 지수 감쇠 — 짧은 피아노 느낌."""
    n0 = int(start * SR)
    n = int(dur * SR)
    partials = [(1, 1.0), (2, 0.45), (3, 0.22), (4, 0.12), (5, 0.06)]
    for i in range(n):
        if n0 + i >= len(buf):
            break
        t = i / SR
        env = (min(1.0, t / 0.008)) * math.exp(-3.2 * t)
        if i > n - 400:  # 끝 클릭 방지
            env *= (n - i) / 400
        s = 0.0
        for k, a in partials:
            s += a * math.exp(-1.2 * k * t) * math.sin(2 * math.pi * hz * k * t)
        buf[n0 + i] += amp * env * s


def triad(root_midi, minor):
    return [root_midi, root_midi + (3 if minor else 4), root_midi + 7]


def key_clip(tonic, minor):
    # 근음을 C4~B4 근처에 두고 화음은 그 위, 베이스는 한 옥타브 아래
    t = 60 + NOTE[tonic]
    if t > 65:
        t -= 12  # 너무 높아지지 않게 F3~E4 근처
    if minor:  # i – VI – III – VII
        prog = [(0, True), (8, False), (3, False), (10, False)]
    else:      # I – V – vi – IV
        prog = [(0, False), (7, False), (9, True), (5, False)]
    step = 0.8
    total = step * len(prog) + 0.6
    buf = [0.0] * int(total * SR)
    for i, (off, mnr) in enumerate(prog):
        root = t + off
        if off >= 7:
            root -= 12  # 보이싱이 위로 튀지 않게
        notes = triad(root + 12, mnr)
        for j, m in enumerate(notes):
            piano(buf, i * step + j * 0.012, step + 0.5, midi_hz(m), 0.20)
        piano(buf, i * step, step + 0.5, midi_hz(root), 0.26)  # 베이스
    return buf


def kick(buf, at, amp=0.9):
    n0 = int(at * SR)
    ph = 0.0
    for i in range(int(0.28 * SR)):
        if n0 + i >= len(buf):
            break
        t = i / SR
        f = 50 + 90 * math.exp(-t * 28)
        ph += 2 * math.pi * f / SR
        buf[n0 + i] += amp * math.exp(-t * 11) * math.sin(ph)


def snare(buf, at, rnd, amp=0.5):
    n0 = int(at * SR)
    for i in range(int(0.2 * SR)):
        if n0 + i >= len(buf):
            break
        t = i / SR
        noise = rnd.uniform(-1, 1)
        tone = math.sin(2 * math.pi * 185 * t)
        buf[n0 + i] += amp * (0.75 * noise * math.exp(-t * 22) + 0.45 * tone * math.exp(-t * 30))


def hat(buf, at, rnd, amp=0.16):
    n0 = int(at * SR)
    prev = 0.0
    for i in range(int(0.05 * SR)):
        if n0 + i >= len(buf):
            break
        t = i / SR
        x = rnd.uniform(-1, 1)
        hp = x - prev  # 간단한 고역 통과(밝은 쇳소리)
        prev = x
        buf[n0 + i] += amp * hp * math.exp(-t * 70)


def bpm_clip(bpm, seconds=4.0):
    rnd = random.Random(bpm)
    buf = [0.0] * int((seconds + 0.3) * SR)
    beat = 60.0 / bpm
    i = 0
    while i * beat < seconds:
        at = i * beat
        pos = i % 4
        if pos in (0, 2):
            kick(buf, at)
        else:
            snare(buf, at, rnd)
        hat(buf, at, rnd, 0.2 if pos == 0 else 0.15)
        hat(buf, at + beat / 2, rnd, 0.11)
        i += 1
    return buf


def write_mp3(buf, path):
    peak = max(1e-9, max(abs(x) for x in buf))
    g = 0.85 / peak
    fd, tmp = tempfile.mkstemp(suffix='.wav')
    os.close(fd)
    try:
        with wave.open(tmp, 'wb') as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes(b''.join(struct.pack('<h', int(max(-1, min(1, x * g)) * 32767)) for x in buf))
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', tmp, '-ac', '1', '-b:a', '48k', path], check=True)
    finally:
        os.remove(tmp)


def main():
    os.makedirs(OUT, exist_ok=True)
    for k in KEYS:
        for minor in (False, True):
            name = f"key_{k}_{'minor' if minor else 'major'}.mp3"
            write_mp3(key_clip(k, minor), os.path.join(OUT, name))
            print(name)
    for bpm in range(60, 201, 5):
        name = f'bpm_{bpm}.mp3'
        write_mp3(bpm_clip(bpm), os.path.join(OUT, name))
        print(name)


if __name__ == '__main__':
    main()
