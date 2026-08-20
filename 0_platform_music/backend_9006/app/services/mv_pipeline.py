"""
MV Pipeline — Phase runner functions for draft/resume MV generation.

Reads job data from MongoDB, uses low-level functions from mv_generator.py,
and updates MongoDB throughout each phase.
"""

import asyncio
import io
import logging
import os
import shutil
import subprocess
import tempfile
from datetime import datetime, timedelta
from typing import List, Optional

from bson import ObjectId

from ..config import settings
from ..database.minio import get_minio
from .media_urls import public_presign
from .mv_generator import (
    generate_scene_image,
    generate_video_prompts_from_images,
    start_scene_video,
    check_scene_video_status,
    download_video,
    concatenate_videos,
    trim_video_clip,
    _get_ffmpeg_path,
)
from .subtitle_generator import generate_lyrics_ass
from .kling_video_generator import (
    start_scene_video_kling,
    check_scene_video_status_kling,
    download_video_kling,
)
from .seedance_video_generator import (
    start_scene_video_seedance,
    check_scene_video_status_seedance,
    download_video_seedance,
)
# v66: Grok Imagine Video (xAI 직접)
from .grok_video_generator import (
    start_scene_video_grok,
    check_scene_video_status_grok,
    download_video_grok,
)

logger = logging.getLogger(__name__)


def _coerce_oid(job_id):
    """v62 — Accept str(hex) or ObjectId; return ObjectId.

    Cascade 경로(`run_phase1_split(str(job_oid), ...)`) 와 백그라운드 태스크 경로
    (`run_phase2_images(oid, ...)`) 가 서로 다른 형태로 전달해 _id 매칭이 깨지던
    버그를 가드한다. 변환 실패 시 입력 그대로 반환 (옛 ad-hoc 호출 호환).
    """
    if isinstance(job_id, ObjectId):
        return job_id
    try:
        return ObjectId(str(job_id))
    except Exception:
        return job_id


async def _update_job(mongo_db, job_id, update: dict) -> None:
    """Helper to update mv_jobs document."""
    update["updated_at"] = datetime.utcnow()
    await mongo_db.mv_jobs.update_one(
        {"_id": _coerce_oid(job_id)},
        {"$set": update},
    )


async def _get_job(mongo_db, job_id) -> Optional[dict]:
    """Load job document from MongoDB."""
    return await mongo_db.mv_jobs.find_one({"_id": _coerce_oid(job_id)})


async def _is_cancelled(mongo_db, job_id) -> bool:
    """Check if cancel has been requested for this job."""
    job = await mongo_db.mv_jobs.find_one(
        {"_id": _coerce_oid(job_id)}, {"cancel_requested": 1}
    )
    return bool(job and job.get("cancel_requested"))


def _load_cover_image(cover_object_name: Optional[str]) -> Optional[bytes]:
    """Load cover image bytes from MinIO for style reference."""
    if not cover_object_name:
        return None
    try:
        minio_client = get_minio()
        response = minio_client.get_object(
            bucket_name=settings.minio_bucket_images,
            object_name=cover_object_name,
        )
        data = response.read()
        response.close()
        response.release_conn()
        return data
    except Exception as e:
        logger.warning("Failed to load cover image '%s': %s", cover_object_name, e)
        return None


def _load_character_image(character_object_name: Optional[str]) -> Optional[bytes]:
    """Load character sheet image bytes from MinIO."""
    if not character_object_name:
        return None
    try:
        minio_client = get_minio()
        response = minio_client.get_object(
            bucket_name=settings.minio_bucket_images,
            object_name=character_object_name,
        )
        data = response.read()
        response.close()
        response.release_conn()
        return data
    except Exception as e:
        logger.warning("Failed to load character image '%s': %s", character_object_name, e)
        return None


def _load_audio_from_minio(audio_object_name: Optional[str]) -> Optional[bytes]:
    """Load audio bytes from MinIO music bucket."""
    if not audio_object_name:
        return None
    try:
        minio_client = get_minio()
        response = minio_client.get_object(
            bucket_name=settings.minio_bucket_music,
            object_name=audio_object_name,
        )
        data = response.read()
        response.close()
        response.release_conn()
        return data
    except Exception as e:
        logger.warning("Failed to load audio '%s': %s", audio_object_name, e)
        return None


def _slice_audio_segment(audio_bytes: bytes, start_sec: float, end_sec: float) -> Optional[bytes]:
    """Slice audio bytes from start_sec to end_sec using ffmpeg. Returns MP3 bytes."""
    try:
        ffmpeg_path = _get_ffmpeg_path()
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp_in:
            tmp_in.write(audio_bytes)
            tmp_in_path = tmp_in.name

        tmp_out_path = tmp_in_path + "_slice.mp3"

        duration = end_sec - start_sec
        subprocess.run(
            [ffmpeg_path, "-y", "-i", tmp_in_path, "-ss", str(start_sec), "-t", str(duration),
             "-acodec", "libmp3lame", "-q:a", "2", tmp_out_path],
            capture_output=True, timeout=30,
        )

        if os.path.exists(tmp_out_path):
            with open(tmp_out_path, "rb") as f:
                sliced = f.read()
            os.unlink(tmp_in_path)
            os.unlink(tmp_out_path)
            return sliced if len(sliced) > 100 else None

        os.unlink(tmp_in_path)
        return None
    except Exception as e:
        logger.warning("Audio slice failed: %s", e)
        return None


async def _resolve_audio_object_name(job: dict, mongo_db) -> Optional[str]:
    """Resolve audio object name from job or its linked generation."""
    # Direct audio_object_name on the job
    audio_obj = job.get("audio_object_name")
    if audio_obj:
        return audio_obj

    # Try to get from linked generation
    gen_id = job.get("audio_generation_id")
    if gen_id:
        try:
            from bson import ObjectId
            gen_doc = await mongo_db.generations.find_one(
                {"_id": ObjectId(gen_id)},
                {"result_audio_url": 1},
            )
            if gen_doc and gen_doc.get("result_audio_url"):
                return gen_doc["result_audio_url"]
        except Exception as e:
            logger.warning("Failed to resolve audio from generation %s: %s", gen_id, e)

    return None


def _get_scene_timestamps(lyric_timestamps: list[dict], section_start: float, section_end: float) -> list[dict]:
    """Extract and re-base lyric timestamps for a specific scene time range.

    Filters the full lyric_timestamps to only those overlapping with
    [section_start, section_end], then shifts times so they start at 0
    (since per-scene videos start at 0 seconds).

    v43: renamed from whisper_segments — same shape, source is now Suno API
    timestamps (Whisper STT removed).

    Args:
        lyric_timestamps: Full list of lyric segments [{"text", "start", "end"}, ...]
        section_start: Scene start time in seconds (absolute)
        section_end: Scene end time in seconds (absolute)

    Returns:
        List of segments with times relative to scene start (0-based).
    """
    if not lyric_timestamps:
        return []
    result = []
    for seg in lyric_timestamps:
        seg_start = float(seg.get("start", 0))
        seg_end = float(seg.get("end", 0))
        # Check if segment overlaps with the scene range
        if seg_end <= section_start or seg_start >= section_end:
            continue
        # Re-base to 0 (scene video starts at 0)
        result.append({
            "text": seg.get("text", ""),
            "start": max(0.0, seg_start - section_start),
            "end": min(section_end - section_start, seg_end - section_start),
        })
    return result


def _read_lyric_timestamps(job: dict) -> list[dict]:
    """Backward-shim reader for v43: prefer new key, fall back to old whisper_segments."""
    return job.get("lyric_timestamps") or job.get("whisper_segments") or []


# ── Whisper-based Section Building ───────────────────────────────────────────


def _normalize_text(text: str) -> str:
    """Remove punctuation/spaces and lowercase for fuzzy matching."""
    import re
    return re.sub(r'[^a-zA-Z0-9가-힣]', '', text).lower()


def _text_match(lyrics_line: str, whisper_text: str, min_chars: int = 3) -> bool:
    """Check if a lyrics line matches a Whisper segment text.

    Uses multiple strategies for robust matching:
    1. First min_chars characters prefix match
    2. Any 4+ char substring match
    3. Handles Whisper misrecognition (e.g., "벚꽃이" → "outbreaks이")
    """
    norm_line = _normalize_text(lyrics_line)
    norm_seg = _normalize_text(whisper_text)
    if not norm_line or not norm_seg:
        return False
    # Strategy 1: prefix match (first 3 chars)
    prefix = norm_line[:max(min_chars, min(6, len(norm_line)))]
    if prefix in norm_seg:
        return True
    # Strategy 2: any 4+ char substring from lyrics found in whisper
    for start in range(0, len(norm_line) - 3):
        chunk = norm_line[start:start + 4]
        if chunk in norm_seg:
            return True
    return False


def _build_sections_from_whisper(
    lyric_timestamps: list[dict],
    lyrics: str,
    audio_duration: float,
) -> list[dict]:
    """가사 타임스탬프와 가사 텍스트를 매칭하여 섹션별 타이밍을 확정.

    v43: param renamed from whisper_segments to lyric_timestamps. Source is
    now Suno API timestamps (Whisper STT removed). Function name retained
    for stability.

    Args:
        lyric_timestamps: [{"text", "start", "end"}, ...] (Suno API)
        lyrics: 전체 가사 텍스트 (섹션 태그 포함)
        audio_duration: 음악 총 길이 (초)

    Returns:
        music_sections: [{"label", "start", "end", "mood"}, ...]
    """
    import re

    if not lyrics or not lyrics.strip():
        return []

    # 1. 가사를 섹션별로 파싱
    pattern = r'\[([^\]]+)\]'
    parts = re.split(pattern, lyrics)
    sections = []

    # parts[0] = text before first tag (usually empty)
    # parts[1] = first tag, parts[2] = content after first tag, etc.
    for i in range(1, len(parts), 2):
        tag = parts[i].split(":")[0].strip()  # "Verse 1: rap flow" → "Verse 1"
        content = parts[i + 1].strip() if i + 1 < len(parts) else ""
        lines = [l.strip() for l in content.split("\n") if l.strip()]
        sections.append({"tag": tag, "lines": lines})

    if not sections:
        return []

    # 2. 모든 가사 줄을 순서대로 나열하고 섹션 경계 기록
    all_lines = []  # (section_idx, line_text)
    for sec_idx, sec in enumerate(sections):
        for line in sec["lines"]:
            all_lines.append((sec_idx, line))

    # 3. 가사 줄을 Whisper 세그먼트에 순서대로 1:1 매칭
    #    Whisper seg를 순서대로 소비하면서, 각 가사 줄과 매칭되는 seg 찾기
    line_timings = []  # (section_idx, start, end) for each matched line
    seg_idx = 0
    for sec_idx, line_text in all_lines:
        found = False
        # 현재 seg_idx부터 최대 10개까지 탐색 (ad-lib/yeah 등 건너뛰기)
        for j in range(seg_idx, min(seg_idx + 10, len(lyric_timestamps))):
            if _text_match(line_text, lyric_timestamps[j]["text"]):
                line_timings.append((sec_idx, lyric_timestamps[j]["start"], lyric_timestamps[j]["end"]))
                seg_idx = j + 1
                found = True
                break
        if not found:
            # 매칭 실패 시 None 기록
            line_timings.append((sec_idx, None, None))

    # 4. 섹션별로 매칭된 줄들의 시작/끝 집계
    section_timings = []
    for sec_idx, sec in enumerate(sections):
        matched = [(s, e) for si, s, e in line_timings if si == sec_idx and s is not None]
        if matched:
            section_timings.append((sec["tag"], matched[0][0], matched[-1][1], True))
        else:
            section_timings.append((sec["tag"], None, None, len(sec["lines"]) == 0))

    # 3. 타이밍 보간: 매칭 안 된 섹션은 이전/다음 섹션 사이로 채움
    music_sections = []
    for idx, (tag, start, end, has_vocals) in enumerate(section_timings):
        if start is not None and end is not None:
            music_sections.append({
                "label": tag,
                "start": round(start, 3),
                "end": round(end, 3),
                "mood": "",
            })
        else:
            # 이전 섹션 끝 찾기
            prev_end = 0.0
            for prev_idx in range(idx - 1, -1, -1):
                if section_timings[prev_idx][2] is not None:
                    prev_end = section_timings[prev_idx][2]
                    break
                elif music_sections and prev_idx < len(music_sections):
                    for ms in reversed(music_sections):
                        if ms["end"] > 0:
                            prev_end = ms["end"]
                            break
                    break

            # 다음 섹션 시작 찾기
            next_start = audio_duration
            for next_idx in range(idx + 1, len(section_timings)):
                if section_timings[next_idx][1] is not None:
                    next_start = section_timings[next_idx][1]
                    break

            music_sections.append({
                "label": tag,
                "start": round(prev_end, 3),
                "end": round(next_start, 3),
                "mood": "",
            })

    # 4. 첫 섹션이 0초가 아니면 앞에 시작을 0으로 조정
    if music_sections and music_sections[0]["start"] > 0.5:
        # 첫 섹션 이름이 Intro가 아니면 Intro 삽입
        if not music_sections[0]["label"].lower().startswith("intro"):
            music_sections.insert(0, {
                "label": "Intro",
                "start": 0.0,
                "end": music_sections[0]["start"],
                "mood": "",
            })
        else:
            music_sections[0]["start"] = 0.0

    # 5. 마지막 섹션 end를 audio_duration으로 보정
    if music_sections:
        if music_sections[-1]["end"] < audio_duration - 1.0:
            # Outro가 이미 있으면 확장, 없으면 추가
            if music_sections[-1]["label"].lower().startswith("outro"):
                music_sections[-1]["end"] = round(audio_duration, 3)
            else:
                music_sections.append({
                    "label": "Outro",
                    "start": music_sections[-1]["end"],
                    "end": round(audio_duration, 3),
                    "mood": "",
                })
        music_sections[-1]["end"] = round(audio_duration, 3)

    # 6. 시작=0으로 보장
    if music_sections:
        music_sections[0]["start"] = 0.0

    # 7. 섹션 간 공백 제거: 이전 섹션 end = 다음 섹션 start
    for i in range(len(music_sections) - 1):
        gap = music_sections[i + 1]["start"] - music_sections[i]["end"]
        if gap > 0.01:
            # 공백이 있으면 이전 섹션 end를 다음 섹션 start로 확장
            music_sections[i]["end"] = music_sections[i + 1]["start"]
        elif gap < -0.01:
            # 겹침이 있으면 다음 섹션 start를 이전 섹션 end로 조정
            music_sections[i + 1]["start"] = music_sections[i]["end"]

    logger.info(
        "Section builder: %d sections from %d lyric timestamps",
        len(music_sections), len(lyric_timestamps),
    )
    return music_sections


# ── v43: Beat-aligned 섹션 분할 (madmom downbeat 기반) ─────────────────────

MAX_CLIP_SEC = 15.0   # Kling 최대
TARGET_CLIP_SEC = 10.0  # 목표 클립 길이

# Per-model clip-duration cap (pipeline-side enforcement).
# Real model APIs accept up to 15s, but we cap below for safety / quality.
MV_MODEL_MAX_CLIP = {"veo": 8.0, "kling": 10.0, "seedance": 10.0}


def _snap_sections_to_downbeats(
    sections: list[dict], downbeats: list[float], tol: float = 1.5
) -> list[dict]:
    """Snap each section's start/end to the nearest downbeat within ±tol seconds.

    v43: helps Phase 1's whisper-derived section boundaries land on musical
    bar boundaries so that subsequent _split_by_downbeats stays in phase.

    Rules:
      - section.start: pick latest downbeat ≤ original (so chorus etc. doesn't
        start earlier than intended; can shift start later by ≤ 1 bar).
      - section.end: pick earliest downbeat ≥ original (extend slightly).
      - If no downbeat within ±tol of the original boundary, leave it.
      - Maintain monotonic ordering (no overlaps, no negative durations).
    """
    if not sections or not downbeats:
        return sections
    db = sorted(float(d) for d in downbeats)

    out = []
    for sec in sections:
        s = float(sec["start"])
        e = float(sec["end"])

        # Candidate for start: latest downbeat ≤ s, within tol.
        new_s = s
        candidates = [d for d in db if d <= s + 1e-6 and abs(d - s) <= tol]
        if candidates:
            new_s = max(candidates)

        # Candidate for end: earliest downbeat ≥ e, within tol.
        new_e = e
        candidates = [d for d in db if d >= e - 1e-6 and abs(d - e) <= tol]
        if candidates:
            new_e = min(candidates)

        # Sanity: keep ordering relative to previous section.
        if out and new_s < out[-1]["end"]:
            new_s = out[-1]["end"]
        if new_e <= new_s:
            new_e = e  # revert end snap if it would invert

        out.append({**sec, "start": round(new_s, 3), "end": round(new_e, 3)})

    return out


def _split_by_downbeats(
    section: dict,
    downbeats: list[float],
    beats: list[float],
    max_clip: float,
    lyric_timestamps: list[dict] | None,
    lyrics_lines: list[str] | None,
) -> list[dict]:
    """v43 — Split a section into clips using downbeats as primary cut points.

    Greedy algorithm: from cursor, pick the LATEST downbeat ≤ cursor + max_clip
    so each clip is as long as possible (= as few clips as possible, music-aware
    cuts only). If no downbeat fits, fall back to regular beats; if even those
    don't, fall back to equal split for the remainder.

    Each returned clip dict: {"section", "start", "end", "lyrics_segment"}.

    Args:
        section: {"label", "start", "end", "mood"}
        downbeats: list of absolute downbeat timestamps (seconds)
        beats: list of all beat timestamps (fallback for sparse downbeats)
        max_clip: per-model max clip duration (seconds)
        lyric_timestamps: full Suno-style segments [{"text","start","end"}, ...]
            used for per-clip lyrics text. Empty/None → use lyrics_lines fallback.
        lyrics_lines: section's lyric lines (used as equal-distribution fallback
            when lyric_timestamps unavailable, e.g., self-uploaded tracks).
    """
    import math

    sec_start = float(section["start"])
    sec_end = float(section["end"])
    label = section["label"]
    sec_dur = sec_end - sec_start
    max_clip = float(max_clip)
    lyrics_lines = lyrics_lines or []

    # Single-clip fast path
    if sec_dur <= max_clip + 1e-6:
        return [{
            "section": label,
            "start": round(sec_start, 3),
            "end": round(sec_end, 3),
            "lyrics_segment": _lyrics_for_range(
                sec_start, sec_end, lyric_timestamps, lyrics_lines, 0, 1,
            ),
        }]

    inner_db = sorted(float(b) for b in (downbeats or []) if sec_start < float(b) < sec_end)
    inner_beats = sorted(float(b) for b in (beats or []) if sec_start < float(b) < sec_end)

    cuts: list[float] = []  # ordered cut positions strictly between sec_start and sec_end
    cursor = sec_start

    while sec_end - cursor > max_clip + 1e-6:
        target = cursor + max_clip
        # Primary: downbeats
        cands = [b for b in inner_db if cursor + 1e-6 < b <= target + 1e-6]
        if not cands:
            # Secondary: regular beats (for very low BPM / sparse downbeats)
            cands = [b for b in inner_beats if cursor + 1e-6 < b <= target + 1e-6]
        if not cands:
            # Last resort: equal-split the remaining tail
            remaining = sec_end - cursor
            n = max(1, int(math.ceil(remaining / max_clip)))
            step = remaining / n
            for j in range(1, n):
                cuts.append(cursor + step * j)
            cursor = sec_end
            break
        # Latest viable cut → longest clip ≤ max_clip
        cut = max(cands)
        cuts.append(cut)
        cursor = cut

    # Build clip ranges from cuts
    bounds = [sec_start] + cuts + [sec_end]
    n_clips = len(bounds) - 1
    clips = []
    for i in range(n_clips):
        a = bounds[i]
        b = bounds[i + 1]
        sec_name = label if n_clips == 1 else "{}-{}".format(label, i + 1)
        clips.append({
            "section": sec_name,
            "start": round(a, 3),
            "end": round(b, 3),
            "lyrics_segment": _lyrics_for_range(
                a, b, lyric_timestamps, lyrics_lines, i, n_clips,
            ),
        })
    return clips


def _lyrics_for_range(
    a: float,
    b: float,
    lyric_timestamps: list[dict] | None,
    lyrics_lines: list[str],
    clip_idx: int,
    n_clips: int,
) -> str:
    """Pick lyric text overlapping [a, b]; fallback to even-distribution of lines."""
    if lyric_timestamps:
        texts = []
        for ls in lyric_timestamps:
            ls_start = float(ls.get("start", 0) or 0)
            ls_end = float(ls.get("end", 0) or 0)
            # Overlap test (with small tolerance to avoid edge double-count)
            if ls_end > a + 0.05 and ls_start < b - 0.05:
                t = (ls.get("text") or "").strip()
                if t:
                    texts.append(t)
        if texts:
            return "\n".join(texts)
    # Fallback: equal distribution of lyrics_lines across n_clips
    if not lyrics_lines:
        return ""
    if n_clips <= 1:
        return "\n".join(lyrics_lines)
    per = max(1, len(lyrics_lines) // n_clips)
    li = clip_idx * per
    le = li + per if clip_idx < n_clips - 1 else len(lyrics_lines)
    return "\n".join(lyrics_lines[li:le])


def _request_video_duration(scene_dur: float, model: str) -> int:
    """v43 — Round scene_dur up to the integer-second grid the model API accepts.

    - kling:    5 if d ≤ 5 else 10
    - seedance: clamp(ceil(d), 4, 15)
    - veo:      4 if d ≤ 4 else (6 if d ≤ 6 else 8)

    Returned int is what we pass to the model API; actual clip is then trimmed
    to the float scene_dur via _trim_video_to_duration.
    """
    import math
    d = max(0.1, float(scene_dur))
    m = (model or "").lower()
    if m == "kling":
        return 5 if d <= 5.0 + 1e-6 else 10
    if m == "seedance":
        return max(4, min(15, int(math.ceil(d))))
    if m == "grok":
        # v66: Grok Imagine Video — max 10s, ceil
        return max(1, min(10, int(math.ceil(d))))
    # veo (default)
    if d <= 4.0 + 1e-6:
        return 4
    if d <= 6.0 + 1e-6:
        return 6
    return 8


def _trim_video_to_duration(video_bytes: bytes, target_dur: float) -> bytes:
    """v43 — Re-encode to exactly target_dur seconds via ffmpeg ``-t``.

    Returns trimmed bytes. On any failure, returns the original bytes and logs
    a warning — never blocks the pipeline.
    """
    if not video_bytes or target_dur <= 0:
        return video_bytes
    try:
        ffmpeg_bin = _get_ffmpeg_path() or "ffmpeg"
        with tempfile.TemporaryDirectory() as tmpdir:
            in_path = os.path.join(tmpdir, "in.mp4")
            out_path = os.path.join(tmpdir, "out.mp4")
            with open(in_path, "wb") as f:
                f.write(video_bytes)
            proc = subprocess.run(
                [
                    ffmpeg_bin, "-y",
                    "-i", in_path,
                    "-t", "{:.3f}".format(float(target_dur)),
                    "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                    "-an",
                    out_path,
                ],
                capture_output=True, timeout=120,
            )
            if proc.returncode != 0 or not os.path.exists(out_path):
                logger.warning(
                    "trim_video: ffmpeg failed (target=%.3fs): %s",
                    target_dur, proc.stderr[-200:].decode("utf-8", errors="replace"),
                )
                return video_bytes
            with open(out_path, "rb") as f:
                return f.read()
    except Exception as e:
        logger.warning("trim_video: failed: %s — using original bytes", str(e)[:200])
        return video_bytes



# ── Lyrics Section Parser ──────────────────────────────────────────────────


def _parse_lyrics_sections(lyrics: str) -> list[dict]:
    """가사에서 섹션 태그를 파싱하여 [{tag, content}, ...] 반환."""
    import re
    if not lyrics or not lyrics.strip():
        return []
    pattern = r'\[([^\]]+)\]'
    parts = re.split(pattern, lyrics)
    sections = []
    for i in range(1, len(parts), 2):
        tag = parts[i].split(":")[0].strip()
        content = parts[i + 1].strip() if i + 1 < len(parts) else ""
        sections.append({"tag": tag, "content": content})
    return sections


# ── Lyrics-to-Scene Matching (legacy) ──────────────────────────────────────


def _assign_lyrics_to_scenes(scenes: list, lyrics: str) -> None:
    """가사 섹션 기반으로 씬에 가사를 배정한다.

    1. 원본 가사를 섹션 태그로 파싱 → {normalized_name: lyrics_content}
    2. 각 씬의 section 필드에서 부모 섹션명 추출
       - "Chorus" → "chorus1" (첫번째)
       - "Verse1" → "verse1"
       - 씬의 section 필드를 normalize
    3. 같은 부모 섹션에 속한 씬들을 그룹핑
    4. 가사 줄을 시간 비율(use_seconds)로 분배
       - 가사 줄 < 씬 수: 남는 씬은 빈 자막
       - 가사 줄 >= 씬 수: 시간 비율로 분배
    """
    if not lyrics:
        return

    import re

    # ── helper: normalize section name ──────────────────────────────────
    def _normalize(name: str) -> str:
        """'Verse 1' / 'Verse1' / 'Verse 1-2' → 'verse1', 'Pre-Chorus' → 'prechorus1'.
        Strips clip suffix (-1, -2, ...) to get parent section name."""
        s = name.split(":")[0].strip()          # remove vocal direction
        # Remove clip suffix: "Verse 1-2" → "Verse 1", "Chorus-3" → "Chorus"
        s = re.sub(r'-\d+$', '', s).strip()
        s = s.lower().replace(" ", "").replace("-", "")
        # If no trailing digit, append '1' (first occurrence default)
        if not s or s[-1].isdigit():
            return s
        return s + "1"

    # ── Step 1: parse lyrics into ordered sections ─────────────────────
    pattern = r'\[([^\]]+)\]'
    parts = re.split(pattern, lyrics)

    # parts = ["", "Intro", "\nbody...\n", "Verse 1: rap flow", "\nbody...\n", ...]
    parsed_sections: list[dict] = []
    # Track occurrence count per base name to auto-number
    base_counter: dict[str, int] = {}
    for i in range(1, len(parts), 2):
        tag_raw = parts[i]
        content = parts[i + 1].strip() if i + 1 < len(parts) else ""

        # base name without number: "verse 1" → "verse", "pre-chorus" → "prechorus"
        base_tag = tag_raw.split(":")[0].strip()
        base_name = re.sub(r'\s*\d+\s*$', '', base_tag).strip()
        base_key = base_name.lower().replace(" ", "").replace("-", "")

        base_counter[base_key] = base_counter.get(base_key, 0) + 1
        numbered = "{}{}".format(base_key, base_counter[base_key])

        parsed_sections.append({
            "tag_raw": tag_raw,
            "normalized": numbered,
            "content": content,
        })

    if not parsed_sections:
        return

    # Build lookup: normalized_name → lyrics content
    lyrics_by_section: dict[str, str] = {}
    for ps in parsed_sections:
        lyrics_by_section[ps["normalized"]] = ps["content"]

    # ── Step 2 & 3: group scenes by normalized section name ────────────
    scene_normalized: list[str] = []

    for scene in scenes:
        raw = (scene.get("section") or "").strip()
        norm = _normalize(raw)
        scene_normalized.append(norm)

    # Track how many times each base (without trailing digit) appears
    # so we can auto-number scenes whose section field has no digit.
    # But since _normalize already appends '1' when no digit, we need
    # to handle the case where GPT returns "Chorus" for multiple
    # consecutive scenes that should all map to the same section.
    # Strategy: scenes with the SAME normalized name in a row belong
    # to the same section occurrence. When a different section appears
    # and later the same name reappears, increment the counter.
    final_norm: list[str] = []
    _seen_runs: dict[str, int] = {}
    _prev: str = ""
    for norm in scene_normalized:
        # Extract base (without trailing digits)
        base = re.sub(r'\d+$', '', norm)
        if norm != _prev:
            # New run: increment counter for this base if we've seen it before
            if base in _seen_runs and _prev != norm:
                # Check if this is truly a new occurrence (not continuation)
                _seen_runs[base] = _seen_runs[base] + 1
            elif base not in _seen_runs:
                _seen_runs[base] = 1
        count = _seen_runs.get(base, 1)
        final_norm.append("{}{}".format(base, count))
        _prev = norm

    # Group scenes by their final normalized section name (preserve order)
    from collections import OrderedDict
    section_groups: OrderedDict[str, list[dict]] = OrderedDict()
    for scene, norm in zip(scenes, final_norm):
        if norm not in section_groups:
            section_groups[norm] = []
        section_groups[norm].append(scene)

    # ── Step 4: distribute lyrics lines to scenes per section ──────────
    for norm, group in section_groups.items():
        content = lyrics_by_section.get(norm, "")
        lines = [line for line in content.split("\n") if line.strip()] if content else []

        if not lines:
            # No lyrics for this section (e.g. Intro, Outro, Bridge)
            for sc in group:
                sc["lyrics_segment"] = ""
            continue

        num_scenes = len(group)
        num_lines = len(lines)

        if num_lines <= num_scenes:
            # 가사 줄 < 씬 수: 앞 씬들에 1줄씩, 남는 씬은 빈 자막
            for idx, sc in enumerate(group):
                if idx < num_lines:
                    sc["lyrics_segment"] = lines[idx]
                else:
                    sc["lyrics_segment"] = ""
        else:
            # 가사 줄 >= 씬 수: 시간 비율(use_seconds)로 분배
            durations = [float(sc.get("use_seconds", 10)) for sc in group]
            total_dur = sum(durations)

            if total_dur <= 0:
                # fallback: equal distribution
                durations = [1.0] * num_scenes
                total_dur = float(num_scenes)

            # Calculate proportional line counts (minimum 1 per scene)
            raw_counts = [(d / total_dur) * num_lines for d in durations]
            # Round down first, then distribute remainder
            counts = [max(1, int(c)) for c in raw_counts]

            # Adjust to match total line count
            while sum(counts) > num_lines:
                # Reduce the scene with the most over-allocation
                max_idx = max(range(num_scenes),
                              key=lambda i: counts[i] - raw_counts[i])
                if counts[max_idx] > 1:
                    counts[max_idx] -= 1
                else:
                    break

            while sum(counts) < num_lines:
                # Add to the scene with most under-allocation
                min_idx = min(range(num_scenes),
                              key=lambda i: counts[i] - raw_counts[i])
                counts[min_idx] += 1

            offset = 0
            for idx, sc in enumerate(group):
                end = offset + counts[idx]
                sc["lyrics_segment"] = "\n".join(lines[offset:end])
                offset = end

    logger.info("Lyrics assigned to %d scenes from %d parsed sections",
                len([s for s in scenes if s.get("lyrics_segment")]),
                len(parsed_sections))


# ── Phase 1: Split lyrics into scenes ────────────────────────────────────────


async def run_phase1_split(job_id, mongo_db) -> None:
    """Split lyrics into scenes: 가사 섹션 1개 = 씬 1개.

    v10.0: 대폭 단순화. Whisper로 섹션 타이밍 확정 후,
    GPT는 이미지/영상 프롬프트만 생성.
    """
    job = await _get_job(mongo_db, job_id)
    if not job:
        logger.error("Phase1: job %s not found", job_id)
        return

    await _update_job(mongo_db, job_id, {
        "status": "splitting",
        "progress": 1,
    })

    music_sections = None

    # ── Phase 0: Generate MV Scenario (v45 = Stage 1 Brainstorm + Stage 2 Beat Sheet) ──
    # Skip if scenario already exists (e.g., user already selected from dual results)
    scenario = job.get("scenario")
    if scenario and len(scenario.strip()) > 50:
        logger.info("Phase0: using existing scenario for job %s (%d chars)", job_id, len(scenario))
    else:
        scenario = None
        scenario_meta = None
        scenario_models = job.get("scenario_models")
        # Drama scenario controls (PLAN.md v30)
        scenario_style = job.get("scenario_style", "drama") or "drama"
        vocal_gender = job.get("vocal_gender")
        relationship = job.get("relationship")
        # v49: 사용자 사건 시드 (≤300자, None=시드 없음). 본문은 PII 가능 → 로그에 길이만.
        user_event_seed = job.get("user_event_seed")
        _seed_len = len((user_event_seed or "").strip()) if user_event_seed else 0
        logger.info(
            "[Phase0] job=%s seed_len=%d (시드 본문 미출력 — PII 보호)",
            job_id, _seed_len,
        )
        has_user_character = bool(job.get("character_object_name"))

        # v38: pull character1 meta from user_character_snapshot (captured at job-create time)
        snapshot = job.get("user_character_snapshot") or None
        character1_meta = None
        if isinstance(snapshot, dict):
            character1_meta = {
                "name": snapshot.get("name") or "",
                "age": snapshot.get("age") or "",
                "personality_tags": snapshot.get("personality_tags") or [],
                "personality_text": snapshot.get("personality_text") or "",
            }

        # v63: 커버 인물 자산화 흐름 — "내 캐릭터" 가 없을 때만 커버를 후보로 본다.
        # 체크박스 (use_cover_person_as_character1, default False) + 커버 PNG 가 있을 때
        # vision LLM 으로 외형 description 영문 1~2문장 추출. character1_meta.description
        # 으로 주입하면 시나리오 LLM 이 "변경 금지" 룰로 그대로 받아쓴다.
        use_cover_person = (
            bool(job.get("use_cover_person_as_character1"))
            and not has_user_character
            and bool(job.get("cover_object_name"))
        )
        has_cover_person = False
        if use_cover_person:
            try:
                from .mv_generator import extract_character_description_from_cover
                cover_bytes = _load_cover_image(job.get("cover_object_name"))
                cover_desc = await extract_character_description_from_cover(cover_bytes)
                if cover_desc:
                    has_cover_person = True
                    if character1_meta is None:
                        character1_meta = {
                            "name": "",
                            "age": "",
                            "personality_tags": [],
                            "personality_text": "",
                        }
                    character1_meta["description"] = cover_desc
                    logger.info(
                        "[Phase0] job=%s cover-person description injected (len=%d)",
                        job_id, len(cover_desc),
                    )
                else:
                    logger.info(
                        "[Phase0] job=%s use_cover_person on but no person detected",
                        job_id,
                    )
            except Exception as _cv_err:
                logger.warning(
                    "[Phase0] cover person extract failed: %s — proceeding without",
                    str(_cv_err)[:200],
                )

        # v42: user-supplied location name (used as anchor in scenario LLM prompt)
        _user_loc_snap = job.get("user_location_snapshot") or None
        user_location_name = None
        if isinstance(_user_loc_snap, dict):
            _ln = (_user_loc_snap.get("name") or "").strip()
            if _ln:
                user_location_name = _ln

        # v45: lazy fetch audio_duration_sec for events count derivation.
        # Phase 0 runs before Phase 1a, but generations doc may already have duration_sec.
        audio_duration_sec = job.get("audio_duration_sec") or None
        if not audio_duration_sec:
            try:
                _gen_id = job.get("audio_generation_id")
                if _gen_id:
                    from bson import ObjectId as _ObjId
                    _gen_doc = await mongo_db.generations.find_one(
                        {"_id": _ObjId(_gen_id)}, {"duration_sec": 1, "duration": 1},
                    )
                    if _gen_doc:
                        audio_duration_sec = _gen_doc.get("duration_sec") or _gen_doc.get("duration")
                if not audio_duration_sec:
                    _trk_id = job.get("audio_track_id")
                    if _trk_id:
                        from bson import ObjectId as _ObjId
                        _trk_doc = await mongo_db.tracks.find_one(
                            {"_id": _ObjId(_trk_id)}, {"duration_sec": 1, "duration": 1},
                        )
                        if _trk_doc:
                            audio_duration_sec = _trk_doc.get("duration_sec") or _trk_doc.get("duration")
            except Exception as _dur_err:
                logger.warning("Phase0: audio_duration_sec lookup failed (%s) — events count fallback", _dur_err)
                audio_duration_sec = None
        try:
            if audio_duration_sec is not None:
                audio_duration_sec = float(audio_duration_sec)
        except Exception:
            audio_duration_sec = None

        # ── v45 Stage 1: Brainstorm (4 candidates, single model) ──
        from .mv_generator import (
            generate_mv_scenario, generate_mv_brainstorm, RetryableScenarioError,
        )

        brainstorm_result = None
        # Stage 1 uses the first selected scenario model, or default. Single model only.
        _brain_model = None
        if scenario_models and isinstance(scenario_models, list) and scenario_models:
            _brain_model = scenario_models[0]
        try:
            brainstorm_result = await generate_mv_brainstorm(
                title=job["title"],
                genre=job.get("genre"),
                mood=job.get("mood"),
                lyrics=job.get("lyrics"),
                vocal_gender=vocal_gender,
                relationship=relationship,
                model_name=_brain_model,
                user_event_seed=user_event_seed,
            )
            logger.info(
                "Phase0 v45: brainstorm OK for job %s — %d candidates, model=%s, seed_len=%d",
                job_id, len(brainstorm_result.get("candidates", [])), _brain_model or "(default)",
                _seed_len,
            )
        except Exception as _brain_err:
            logger.warning(
                "Phase0 v45: brainstorm failed (%s) — continuing without it", _brain_err,
            )
            brainstorm_result = None

        # ── v45 Stage 2: Beat Sheet (3 retries) ──
        # Strategy: attempts 1~2 use strict=True (RetryableScenarioError → retry).
        # Final attempt 3 uses strict=False (soft mode) to allow graceful
        # degradation when small models cannot satisfy spec — the metrics dict
        # records soft_failures for downstream observation.
        for attempt in range(3):
            try:
                character_name = job.get("character_name")
                # v50: Stage 2 temperature uplift (창의성 회복) —
                #   첫 시도 0.85 (v49: 0.8), retry 1.0 (v49: 0.95). Claude 는 호출 직전
                #   `_claude_temp_cap` 으로 1.0 캡 (mv_generator.py).
                _temp = 1.0 if attempt > 0 else 0.85
                _strict = attempt < 2  # soft on the last attempt
                logger.info(
                    "[Phase0] Stage2 attempt=%d temp=%.2f strict=%s",
                    attempt + 1, _temp, _strict,
                )
                result = await generate_mv_scenario(
                    title=job["title"],
                    genre=job.get("genre"),
                    mood=job.get("mood"),
                    lyrics=job.get("lyrics"),
                    character_name=character_name,
                    models=scenario_models,
                    scenario_style=scenario_style,
                    vocal_gender=vocal_gender,
                    relationship=relationship,
                    has_user_character=has_user_character,
                    has_cover_person=has_cover_person,
                    character1_meta=character1_meta,
                    location_name=user_location_name,
                    brainstorm_candidates=brainstorm_result,
                    audio_duration_sec=audio_duration_sec,
                    user_event_seed=user_event_seed,
                    temperature=_temp,
                    strict=_strict,
                )

                # Handle dual-model results
                if isinstance(result, dict) and "results" in result:
                    _dual_update = {
                        "scenario_results": result["results"],
                        "scenario_brainstorm": brainstorm_result or {},
                        "status": "scenario_review",
                        "progress": 1,
                    }
                    # v48: archetype 가중치 영속화 (brainstorm_result 안에 포함됨)
                    if isinstance(brainstorm_result, dict) and brainstorm_result.get("archetype_weights"):
                        _dual_update["scenario_archetype_weights"] = brainstorm_result.get("archetype_weights")
                    await _update_job(mongo_db, job_id, _dual_update)
                    logger.info(
                        "Phase0: dual scenario results for job %s (%d models, attempt %d)",
                        job_id, len(result["results"]), attempt + 1,
                    )
                    return  # Stop here; user must select via /select-scenario endpoint

                # Single-model result: dict (drama with v45 fields) or str (legacy fallback)
                if isinstance(result, dict):
                    scenario_meta = result
                    scenario = result.get("scenario", "")
                else:
                    scenario_meta = {"characters": {}, "locations": {}, "scenario": result}
                    scenario = result

                if scenario and len(scenario.strip()) > 50:
                    # v45: persist all new fields. Existing jobs without these read .get(..., default).
                    update_fields = {
                        "scenario": scenario,
                        "scenario_meta": scenario_meta,
                        "progress": 1,
                    }
                    if isinstance(scenario_meta, dict):
                        # v45 fields (only present when LLM produced them) — persist with
                        # `scenario_` prefix for clear ownership inside mv_jobs document.
                        _v45_keys = [
                            "narrative",
                            "premise",
                            "character_states",
                            "central_conflict",
                            "emotional_core",
                            "narrative_arc",
                            "events",
                        ]
                        for _k in _v45_keys:
                            if _k in scenario_meta:
                                update_fields["scenario_" + _k] = scenario_meta.get(_k)
                        # v46: inferred_relationship 영속화 (LLM 자율 판단 결과).
                        # 사용자 명시 시 None — 그래도 키는 항상 저장(None) 해 일관성 유지.
                        if "inferred_relationship" in scenario_meta:
                            update_fields["scenario_inferred_relationship"] = scenario_meta.get(
                                "inferred_relationship"
                            )
                        # v47: selected_archetype 영속화 (Stage 2 가 어떤 brainstorm
                        # 후보의 plot_archetype 을 채택했는지). 미존재 또는 null 일 수 있음.
                        if "selected_archetype" in scenario_meta:
                            update_fields["scenario_selected_archetype"] = scenario_meta.get(
                                "selected_archetype"
                            )
                    if brainstorm_result:
                        update_fields["scenario_brainstorm"] = brainstorm_result
                        # v48: archetype 가중치 영속화 (brainstorm_result 안에 포함됨)
                        if isinstance(brainstorm_result, dict) and brainstorm_result.get("archetype_weights"):
                            update_fields["scenario_archetype_weights"] = brainstorm_result.get("archetype_weights")
                    await _update_job(mongo_db, job_id, update_fields)
                    # v48: weights_top1 키워드 추가 (server.log grep 용)
                    _v48_weights = (
                        brainstorm_result.get("archetype_weights")
                        if isinstance(brainstorm_result, dict) else None
                    )
                    _v48_top1 = None
                    if isinstance(_v48_weights, dict) and _v48_weights:
                        _v48_top1 = max(_v48_weights.items(), key=lambda kv: kv[1])
                    logger.info(
                        "Phase0: scenario generated for job %s (%d chars body, attempt %d, "
                        "style=%s, narrative=%d, events=%d, infer_rel=%s, archetype=%s, "
                        "weights_top1=%s, seed_len=%d)",
                        job_id, len(scenario), attempt + 1, scenario_style,
                        len(scenario_meta.get("narrative") or "") if isinstance(scenario_meta, dict) else 0,
                        len(scenario_meta.get("events") or []) if isinstance(scenario_meta, dict) else 0,
                        (scenario_meta.get("inferred_relationship") if isinstance(scenario_meta, dict) else None) or "null",
                        (scenario_meta.get("selected_archetype") if isinstance(scenario_meta, dict) else None) or "null",
                        ((_v48_top1[0], round(_v48_top1[1], 3)) if _v48_top1 else "null"),
                        _seed_len,
                    )
                    break
                else:
                    logger.warning(
                        "Phase0: scenario too short (%d chars), retrying (attempt %d/3)",
                        len(scenario or ""), attempt + 1,
                    )
                    scenario = None
                    scenario_meta = None
            except RetryableScenarioError as e:
                logger.warning(
                    "Phase0 v45: semantic check failed (attempt %d/3): %s",
                    attempt + 1, str(e)[:200],
                )
                if attempt < 2:
                    await asyncio.sleep(3 * (attempt + 1))
            except Exception as e:
                logger.warning(
                    "Phase0: scenario generation failed (attempt %d/3): %s",
                    attempt + 1, e,
                )
                if attempt < 2:
                    await asyncio.sleep(3 * (attempt + 1))

    if not scenario:
        logger.error("Phase0: scenario generation failed after 3 attempts for job %s", job_id)
        await _update_job(mongo_db, job_id, {
            "status": "failed",
            "error_message": "MV 시나리오 생성에 실패했습니다. 다시 시도해주세요.",
        })
        return

    # ── Phase 1a: 가사 파싱 + 비트/다운비트 + Suno 타임스탬프 (v43) ──
    # v43: Whisper STT + Demucs 보컬 분리 제거. Suno API 타임스탬프만 사용.
    # 직접 업로드 트랙은 lyric_timestamps=[] 로 두고 자막 미부여(MV 생성은 정상).
    lyrics = job.get("lyrics", "")
    sections = _parse_lyrics_sections(lyrics)
    lyric_timestamps = None  # was: whisper_segments

    audio_object_name = await _resolve_audio_object_name(job, mongo_db)
    if audio_object_name:
        logger.info("Phase1a: analyzing music structure for job %s (audio: %s)", job_id, audio_object_name)
        await _update_job(mongo_db, job_id, {"progress": 1})

        try:
            audio_bytes = _load_audio_from_minio(audio_object_name)
            if audio_bytes:
                # ── Measure audio duration via ffprobe ──
                audio_duration = job.get("audio_duration_sec")
                if not audio_duration:
                    try:
                        import subprocess as _sp_probe
                        with tempfile.NamedTemporaryFile(suffix=os.path.splitext(audio_object_name)[1] or ".mp3", delete=False) as _tmp_audio:
                            _tmp_audio.write(audio_bytes)
                            _tmp_audio_path = _tmp_audio.name
                        _probe = _sp_probe.run(
                            ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
                             "-of", "default=noprint_wrappers=1:nokey=1", _tmp_audio_path],
                            capture_output=True, text=True, timeout=30,
                        )
                        audio_duration = float(_probe.stdout.strip())
                        os.unlink(_tmp_audio_path)
                        logger.info("Phase1a: measured audio duration via ffprobe: %.3f sec", audio_duration)
                    except Exception as _probe_err:
                        logger.warning("Phase1a: ffprobe duration measurement failed: %s", _probe_err)
                        audio_duration = None

                # ── Beat detection (madmom) — v44: reuse stored beats if available ──
                try:
                    beat_info = None
                    reused_from = None

                    # Try generation-level stored beats first
                    _gen_id_for_beats = job.get("audio_generation_id")
                    if _gen_id_for_beats:
                        try:
                            from bson import ObjectId as _ObjId
                            _gen_doc = await mongo_db.generations.find_one(
                                {"_id": _ObjId(_gen_id_for_beats)},
                                {"beats_status": 1, "tempo": 1, "beats": 1, "downbeats": 1},
                            )
                            if (
                                _gen_doc
                                and _gen_doc.get("beats_status") == "completed"
                                and _gen_doc.get("beats")
                            ):
                                beat_info = {
                                    "tempo": _gen_doc.get("tempo"),
                                    "beats": _gen_doc.get("beats") or [],
                                    "downbeats": _gen_doc.get("downbeats") or [],
                                }
                                reused_from = f"generation {_gen_id_for_beats}"
                        except Exception as _gen_beat_err:
                            logger.warning(
                                "Phase1a: generation beats lookup failed: %s",
                                _gen_beat_err,
                            )

                    # Fall back to track-level stored beats
                    if beat_info is None:
                        _track_id_for_beats = job.get("audio_track_id")
                        if _track_id_for_beats:
                            try:
                                from bson import ObjectId as _ObjId
                                _track_doc = await mongo_db.tracks.find_one(
                                    {"_id": _ObjId(_track_id_for_beats)},
                                    {"beats_status": 1, "tempo": 1, "beats": 1, "downbeats": 1},
                                )
                                if (
                                    _track_doc
                                    and _track_doc.get("beats_status") == "completed"
                                    and _track_doc.get("beats")
                                ):
                                    beat_info = {
                                        "tempo": _track_doc.get("tempo"),
                                        "beats": _track_doc.get("beats") or [],
                                        "downbeats": _track_doc.get("downbeats") or [],
                                    }
                                    reused_from = f"track {_track_id_for_beats}"
                            except Exception as _track_beat_err:
                                logger.warning(
                                    "Phase1a: track beats lookup failed: %s",
                                    _track_beat_err,
                                )

                    # Inline extraction fallback (race / no source / failed extraction)
                    if beat_info is None:
                        from .audio_utils import detect_beats
                        beat_info = await detect_beats(audio_bytes)
                        reused_from = None  # extracted inline

                    if beat_info:
                        _beat_update = {
                            "tempo": beat_info.get("tempo"),
                            "beats": beat_info.get("beats") or [],
                            "downbeats": beat_info.get("downbeats") or [],
                        }
                        await _update_job(mongo_db, job_id, _beat_update)
                        job.update(_beat_update)
                        if reused_from:
                            logger.info(
                                "Phase1a: reused stored beats from %s — %d beats / %d downbeats, tempo=%s",
                                reused_from,
                                len(beat_info.get("beats") or []),
                                len(beat_info.get("downbeats") or []),
                                beat_info.get("tempo"),
                            )
                        else:
                            logger.info(
                                "Phase1a: extracted inline — %d beats / %d downbeats, tempo=%s",
                                len(beat_info.get("beats") or []),
                                len(beat_info.get("downbeats") or []),
                                beat_info.get("tempo"),
                            )
                    else:
                        logger.info("Phase1a: beat detection returned empty result")
                except Exception as _beat_err:
                    logger.warning("Phase1a: beat detection failed: %s", _beat_err)

                # ── Suno API timestamps (only path; v43 dropped Whisper fallback) ──
                _suno_segments = None
                if lyrics and sections:
                    try:
                        _gen_id = job.get("audio_generation_id")
                        if _gen_id:
                            from bson import ObjectId as _ObjId
                            _gen_doc = await mongo_db.generations.find_one(
                                {"_id": _ObjId(_gen_id)},
                                {"suno_task_id": 1, "suno_audio_id": 1},
                            )
                            if _gen_doc and _gen_doc.get("suno_task_id") and _gen_doc.get("suno_audio_id"):
                                from .suno_timestamp_service import get_suno_timestamps
                                _suno_segments = await get_suno_timestamps(
                                    _gen_doc["suno_task_id"],
                                    _gen_doc["suno_audio_id"],
                                )
                                if _suno_segments:
                                    logger.info("Phase1a: using Suno timestamps (%d segments)", len(_suno_segments))
                    except Exception as e:
                        logger.warning("Phase1a: Suno timestamp fetch failed: %s", e)

                if lyrics and sections:
                    _aud_dur = audio_duration or 180.0
                    if _suno_segments:
                        lyric_timestamps = _suno_segments
                        _candidate = _build_sections_from_whisper(lyric_timestamps, lyrics, _aud_dur)
                        if _candidate:
                            # Validate sections (same heuristic as before)
                            _valid = True
                            _zero_count = 0
                            for _sec in _candidate:
                                _dur = _sec["end"] - _sec["start"]
                                if _dur > _aud_dur * 0.4:
                                    logger.warning(
                                        "Phase1a: Suno section '%s' too long (%.1fs / %.1fs)",
                                        _sec["label"], _dur, _aud_dur,
                                    )
                                    _valid = False
                                    break
                                if _dur < 0.1:
                                    _zero_count += 1
                            if _zero_count >= 4:
                                logger.warning(
                                    "Phase1a: %d zero-length sections from Suno", _zero_count,
                                )
                                _valid = False

                            if _valid:
                                music_sections = _candidate
                                logger.info(
                                    "Phase1a: Suno sections OK: %d sections", len(music_sections),
                                )
                            else:
                                logger.warning(
                                    "Phase1a: Suno sections invalid — proceeding without lyric timestamps",
                                )
                                lyric_timestamps = None
                        else:
                            logger.warning(
                                "Phase1a: Suno section builder empty — proceeding without lyric timestamps",
                            )
                            lyric_timestamps = None

                # ── B4: Snap section boundaries to detected downbeats ──
                if music_sections:
                    _dbs = job.get("downbeats") or []
                    if _dbs:
                        music_sections = _snap_sections_to_downbeats(music_sections, _dbs, tol=1.5)
                        logger.info(
                            "Phase1a: snapped %d sections to downbeats", len(music_sections),
                        )

                # Save music_sections + lyric_timestamps + has_subtitles to job
                if music_sections:
                    _save_data = {
                        "music_sections": music_sections,
                        "progress": 3,
                        "has_subtitles": bool(lyric_timestamps),
                    }
                    if lyric_timestamps:
                        _save_data["lyric_timestamps"] = lyric_timestamps
                    await _update_job(mongo_db, job_id, _save_data)
                    # Mirror into in-memory job for downstream phases
                    job["has_subtitles"] = bool(lyric_timestamps)
                    if lyric_timestamps:
                        job["lyric_timestamps"] = lyric_timestamps
                    logger.info(
                        "Phase1a: job %s music structure: %d sections (has_subtitles=%s)",
                        job_id, len(music_sections), bool(lyric_timestamps),
                    )
            else:
                logger.warning("Phase1a: could not load audio bytes for job %s", job_id)
        except Exception as e:
            logger.warning(
                "Phase1a: music structure analysis failed for job %s: %s (continuing without)",
                job_id, e,
            )

    await _update_job(mongo_db, job_id, {"progress": 3})

    # ── 씬 생성: 가사 섹션 1개 = 씬 1개 ──
    if not music_sections:
        # Whisper 실패 시 가사 섹션 기반으로 균등 분할
        if sections:
            total_duration = float(job.get("audio_duration_sec") or 180.0)
            sec_duration = total_duration / len(sections)
            music_sections = []
            for idx, sec in enumerate(sections):
                music_sections.append({
                    "label": sec["tag"],
                    "start": round(idx * sec_duration, 3),
                    "end": round((idx + 1) * sec_duration, 3),
                    "mood": "",
                })
        else:
            logger.error("Phase1: no lyrics sections and no music sections for job %s", job_id)
            await _update_job(mongo_db, job_id, {
                "status": "failed",
                "error_message": "가사 섹션을 파싱할 수 없습니다.",
            })
            return

    # has_rap 판단: 가사 섹션 태그 중 "rap" 포함 여부
    has_rap = any("rap" in sec["tag"].lower() for sec in sections) if sections else False

    # Whisper 세그먼트 가져오기 (분할에 사용)
    # v43: prefer in-memory lyric_timestamps; fall back to job doc with backward-shim.
    _ws_segments = lyric_timestamps if lyric_timestamps else _read_lyric_timestamps(job)

    scenes = []
    scene_num = 1
    for i, sec in enumerate(music_sections):
        label = sec["label"]
        duration = sec["end"] - sec["start"]

        # 0초 섹션은 건너뛰기 (Break 등 매칭 실패한 짧은 섹션)
        if duration < 0.5:
            logger.info("Phase1: skipping zero-length section '%s'", label)
            continue

        # 해당 섹션의 가사 찾기
        matching_section = next((s for s in sections if s["tag"] == label), None)
        lyrics_content = matching_section["content"] if matching_section else ""
        lyrics_lines = [l.strip() for l in lyrics_content.split("\n") if l.strip()] if lyrics_content else []

        # scene_type 결정
        label_lower = label.lower()
        if has_rap:
            if "rap" in label_lower or "hiphop" in label_lower or "hip-hop" in label_lower:
                scene_type = "lipsync"
            else:
                scene_type = "drama"
        else:
            if label_lower.startswith("chorus"):
                scene_type = "lipsync"
            else:
                scene_type = "drama"

        # v43: 다운비트 우선 비트정렬 분할 (모델별 max_clip)
        _vmodel = (job.get("video_model") or "veo").lower()
        _max_clip = MV_MODEL_MAX_CLIP.get(_vmodel, 8.0)
        clips = _split_by_downbeats(
            sec,
            downbeats=job.get("downbeats") or [],
            beats=job.get("beats") or [],
            max_clip=_max_clip,
            lyric_timestamps=_ws_segments,
            lyrics_lines=lyrics_lines,
        )

        for clip in clips:
            clip_dur = clip["end"] - clip["start"]
            if clip_dur < 0.5:
                continue
            scenes.append({
                "scene_number": scene_num,
                "section": clip["section"],
                "scene_type": scene_type,
                "lyrics_segment": clip["lyrics_segment"],
                "use_seconds": round(clip_dur, 2),
                "section_start": round(clip["start"], 3),
                "section_end": round(clip["end"], 3),
                "section_mood": sec.get("mood", ""),
                "description": "",
                "image_prompt": "",
                "video_image_prompt": "",
                "video_prompt": "",
                "description_ko": "",
                # v56 — Korean prompts (sibling of English image_prompt/video_prompt).
                # Empty default; populated by scene-split LLM, Phase 1b retry,
                # cascade translate phase, or GET lazy translation.
                "image_prompt_ko": "",
                "video_prompt_ko": "",
                "image_object_name": None,
                "image_source": None,
                "video_object_name": None,
                "video_status": "pending",
                "video_error": None,
            })
            scene_num += 1

    logger.info("Phase1: %d scenes created from lyrics sections (has_rap=%s)", len(scenes), has_rap)

    # ── Phase 1b: GPT에게 씬 목록 전달 → 프롬프트만 받기 (3회 재시도) ──
    from .mv_generator import generate_scene_prompts_only

    prompt_models = job.get("prompt_models")

    scene_input = [
        {
            "scene_number": s["scene_number"],
            "section": s["section"],
            "duration": s["use_seconds"],
            "lyrics": s["lyrics_segment"],
            "scene_type": s["scene_type"],
        }
        for s in scenes
    ]

    # Collect asset keys (@character1, @location1, …) available for variable references
    _scenario_meta = job.get("scenario_meta") or {}
    asset_keys = (
        list((_scenario_meta.get("characters") or {}).keys())
        + list((_scenario_meta.get("locations") or {}).keys())
    )

    # v42: user-supplied location anchor for prompt-only LLM
    _user_loc_snap_pb1 = job.get("user_location_snapshot") or None
    user_location_name = None
    if isinstance(_user_loc_snap_pb1, dict):
        _ln_pb1 = (_user_loc_snap_pb1.get("name") or "").strip()
        if _ln_pb1:
            user_location_name = _ln_pb1

    prompts_result = None
    # v45 — pull narrative + events + emotional_core + premise + character_states from job
    _v45_narrative = job.get("scenario_narrative") or None
    _v45_events = job.get("scenario_events") or None
    _v45_emotional_core = job.get("scenario_emotional_core") or None
    _v45_premise = job.get("scenario_premise") or None
    _v45_character_states = job.get("scenario_character_states") or None
    for attempt in range(3):
        try:
            prompts_result = await generate_scene_prompts_only(
                scenes_input=scene_input,
                title=job["title"],
                genre=job.get("genre"),
                mood=job.get("mood"),
                scenario=scenario,
                user_scene_prompt=job.get("scene_prompt"),
                models=prompt_models,
                video_model=job.get("video_model", "veo"),
                asset_keys=asset_keys or None,
                location_name=user_location_name,
                narrative=_v45_narrative,
                scenario_events=_v45_events,
                emotional_core=_v45_emotional_core,
                premise=_v45_premise,
                character_states=_v45_character_states,
            )
        except Exception as e:
            logger.warning("Phase1b: prompt generation failed (attempt %d/3): %s", attempt + 1, e)
            if attempt < 2:
                await asyncio.sleep(3 * (attempt + 1))
            continue

        # Handle dual-model results
        if isinstance(prompts_result, dict) and "results" in prompts_result:
            # Dual models: save both results and pause for user selection
            await _update_job(mongo_db, job_id, {
                "prompt_results": prompts_result["results"],
                "status": "prompts_review",
                "progress": 4,
                "total_scenes": len(scenes),
                "scenes": scenes,
            })
            logger.info(
                "Phase1b: dual prompt results for job %s (%d models, attempt %d)",
                job_id, len(prompts_result["results"]), attempt + 1,
            )
            return  # Stop here; user must select via /select-prompts endpoint

        # Validate: all scenes must have image_prompt (video_prompt is generated later in Phase 2.5)
        if prompts_result and len(prompts_result) == len(scenes):
            missing = [
                p.get("scene_number", "?")
                for p in prompts_result
                if not p.get("image_prompt")
            ]
            if not missing:
                logger.info("Phase1b: all %d scenes have prompts (attempt %d)", len(scenes), attempt + 1)
                break
            else:
                logger.warning("Phase1b: scenes %s missing prompts, retrying (attempt %d/3)", missing, attempt + 1)
                prompts_result = None
        else:
            logger.warning(
                "Phase1b: prompt count mismatch (got %d, expected %d), retrying (attempt %d/3)",
                len(prompts_result) if prompts_result else 0, len(scenes), attempt + 1,
            )
            prompts_result = None

        if attempt < 2:
            await asyncio.sleep(3 * (attempt + 1))

    if not prompts_result:
        logger.error("Phase1b: prompt generation failed after 3 attempts for job %s", job_id)
        await _update_job(mongo_db, job_id, {
            "status": "failed",
            "error_message": "씬 프롬프트 생성에 실패했습니다. 다시 시도해주세요.",
        })
        return

    # 프롬프트를 씬에 채워넣기 (video_prompt는 Phase 2.5에서 이미지 기반으로 생성)
    prompt_by_number = {p["scene_number"]: p for p in prompts_result}
    for scene in scenes:
        p = prompt_by_number.get(scene["scene_number"], {})
        scene["image_prompt"] = p.get("image_prompt", "")
        scene["video_image_prompt"] = p.get("video_image_prompt", "")
        scene["video_prompt"] = ""  # Phase 2.5에서 Gemini가 이미지를 보고 생성
        scene["description_ko"] = p.get("description_ko", "")
        # v56 — Korean image_prompt (Phase 1b LLM is asked to output both en+ko).
        # video_prompt_ko stays "" here; will be filled in Phase 2.5 or by lazy translation.
        scene["image_prompt_ko"] = p.get("image_prompt_ko", "") or ""
        scene.setdefault("video_prompt_ko", "")
        scene["description"] = scene["image_prompt"]  # 하위호환용
        # v45: capture event_index from scene-split LLM (None when no event mapped)
        _ev_idx = p.get("event_index")
        if isinstance(_ev_idx, int):
            scene["event_index"] = _ev_idx
        else:
            scene["event_index"] = None

    # ── v37: sanitize raw character names → @characterN tokens ──
    from .mv_generator import sanitize_scene_character_tags
    characters_meta = (_scenario_meta.get("characters") or {})
    sanitize_scene_character_tags(scenes, characters_meta)

    if "character1" in characters_meta:
        failing = [
            s["scene_number"]
            for s in scenes
            if "@character1" not in (s.get("image_prompt") or "")
        ]
        if failing:
            logger.warning(
                "Phase1b v37: scenes %s lack @character1 after sanitize; retrying once",
                failing,
            )
            try:
                retry_input = [
                    {
                        "scene_number": s["scene_number"],
                        "section": s["section"],
                        "duration": s["use_seconds"],
                        "lyrics": s["lyrics_segment"],
                        "scene_type": s["scene_type"],
                    }
                    for s in scenes if s["scene_number"] in failing
                ]
                retry_result = await generate_scene_prompts_only(
                    scenes_input=retry_input,
                    title=job["title"],
                    genre=job.get("genre"),
                    mood=job.get("mood"),
                    scenario=scenario,
                    user_scene_prompt=job.get("scene_prompt"),
                    models=prompt_models,
                    video_model=job.get("video_model", "veo"),
                    asset_keys=asset_keys or None,
                    location_name=user_location_name,
                    narrative=_v45_narrative,
                    scenario_events=_v45_events,
                    emotional_core=_v45_emotional_core,
                    premise=_v45_premise,
                    character_states=_v45_character_states,
                )
                if isinstance(retry_result, dict) and "results" in retry_result:
                    retry_result = retry_result["results"][0]["prompts"]
                retry_by_number = {p["scene_number"]: p for p in (retry_result or [])}
                retry_scenes = []
                for scene in scenes:
                    if scene["scene_number"] in failing and scene["scene_number"] in retry_by_number:
                        p = retry_by_number[scene["scene_number"]]
                        scene["image_prompt"] = p.get("image_prompt", "") or scene["image_prompt"]
                        scene["video_image_prompt"] = p.get("video_image_prompt", "") or scene["video_image_prompt"]
                        scene["description_ko"] = p.get("description_ko", "") or scene["description_ko"]
                        # v56 — retry path: capture image_prompt_ko if provided (else keep existing).
                        scene["image_prompt_ko"] = p.get("image_prompt_ko", "") or scene.get("image_prompt_ko", "")
                        scene["description"] = scene["image_prompt"]
                        # v45: preserve event_index from retry response (overwrites only when given)
                        _retry_ev = p.get("event_index")
                        if isinstance(_retry_ev, int):
                            scene["event_index"] = _retry_ev
                        retry_scenes.append(scene)
                if retry_scenes:
                    sanitize_scene_character_tags(retry_scenes, characters_meta)

                still_failing = [
                    s["scene_number"]
                    for s in scenes
                    if "@character1" not in (s.get("image_prompt") or "")
                ]
                if still_failing:
                    logger.error(
                        "Phase1b v37: scenes %s still lack @character1 after 1 retry; proceeding non-blocking",
                        still_failing,
                    )
            except Exception as e:
                logger.error("Phase1b v37: retry failed: %s; proceeding non-blocking", e)

    await _update_job(mongo_db, job_id, {
        "status": "scenes_ready",
        "progress": 5,
        "total_scenes": len(scenes),
        "scenes": scenes,
        "completed_image_count": 0,
        "completed_video_count": 0,
    })

    logger.info("Phase1: job %s split into %d scenes", job_id, len(scenes))

    # ── Phase 1.5: 자산 사전생성 (drama 스타일이고 scenario_meta가 있을 때만) ──
    _job_after = await _get_job(mongo_db, job_id)
    if _job_after and _job_after.get("scenario_meta"):
        try:
            await run_phase1_5_assets(job_id, mongo_db)
        except Exception as e:
            logger.warning("Phase1.5 failed (continuing): %s", e)


# ── Phase 1.5: Pre-generate character/location assets ───────────────────────


async def run_phase1_5_assets(job_id, mongo_db) -> None:
    """Phase 1.5: scenario_meta 기반 캐릭터/장소 자산 사전생성."""
    job = await _get_job(mongo_db, job_id)
    if not job:
        return
    meta = job.get("scenario_meta") or {}
    characters = meta.get("characters") or {}
    locations = meta.get("locations") or {}
    if not characters and not locations:
        logger.info("Phase1.5: no assets to generate for job %s", job_id)
        return

    # v38: user_character_snapshot overrides character1 meta (user input wins over LLM)
    snapshot = job.get("user_character_snapshot") or None
    if isinstance(snapshot, dict) and isinstance(characters.get("character1"), dict):
        c1 = dict(characters["character1"])
        snap_name = (snapshot.get("name") or "").strip()
        snap_age = (snapshot.get("age") or "").strip()
        snap_tags = snapshot.get("personality_tags") or []
        snap_text = (snapshot.get("personality_text") or "").strip()
        if snap_name:
            c1["name"] = snap_name
        if snap_age:
            c1["age"] = snap_age
        if snap_tags or snap_text:
            c1["personality"] = {"tags": snap_tags, "text": snap_text}
        characters["character1"] = c1

    # v55: 씬+자산은 동일 image_model 사용. 옛 도큐먼트는 nb_pro 기본값.
    image_model = (job.get("image_model") or "nb_pro").strip() or "nb_pro"
    logger.info("[AssetGen] job=%s image_model=%s", job_id, image_model)

    await _update_job(mongo_db, job_id, {"status": "generating_assets", "progress": 5})

    from .mv_assets import (
        generate_character_sheet_asset,
        generate_location_sheet_asset,
        load_asset_from_minio,
        upload_asset_to_minio,
    )

    # 사용자 캐릭터 시트가 있으면 character1 생성 시 ref로 사용
    # v63 우선순위 체인:
    #   1순위: user_character_snapshot.sheet_object_name (마이뮤직 등록 시트)
    #   2순위: job.character_object_name ("내 캐릭터 포함" 직접 첨부)
    #   3순위: use_cover_person_as_character1 == True + cover_object_name → 커버 PNG
    #   4순위: 없음 → LLM description 만으로 생성 (mv_assets prompt 의 spec)
    user_char_bytes = None
    user_char_source = "none"
    snapshot_sheet_obj = None
    if isinstance(snapshot, dict):
        snapshot_sheet_obj = snapshot.get("sheet_object_name")
    if snapshot_sheet_obj:
        user_char_bytes = _load_character_image(snapshot_sheet_obj)
        if user_char_bytes:
            user_char_source = "snapshot_sheet"
    if not user_char_bytes and job.get("character_object_name"):
        user_char_bytes = _load_character_image(job.get("character_object_name"))
        if user_char_bytes:
            user_char_source = "character_object_name"
    # v63: 3순위 — 체크박스 + 커버 PNG. 1/2순위가 모두 비었을 때만 활성.
    if (
        not user_char_bytes
        and job.get("use_cover_person_as_character1")
        and job.get("cover_object_name")
    ):
        cover_bytes = _load_cover_image(job.get("cover_object_name"))
        if cover_bytes:
            user_char_bytes = cover_bytes
            user_char_source = "cover_person"
    logger.info(
        "[AssetGen] job=%s character1_ref_source=%s",
        job_id, user_char_source,
    )

    # v42: 사용자 location 스냅샷 — location1 자동생성을 SKIP하고 사용자 PNG를 자산화.
    # 보조 location2/3 생성 시 style_ref 로 사용한다.
    user_location_snapshot = job.get("user_location_snapshot") or None
    user_loc_bytes = None
    if isinstance(user_location_snapshot, dict):
        user_loc_obj = user_location_snapshot.get("object_name")
        if user_loc_obj:
            user_loc_bytes = load_asset_from_minio(user_loc_obj)
            if not user_loc_bytes:
                logger.warning(
                    "Phase1.5: user_location_snapshot object %s could not be loaded; "
                    "falling back to auto-generated location1",
                    user_loc_obj,
                )
    # 커버 인물 분석은 v30 범위 외 — character_object_name 없으면 cover를 ref로 줄지 말지 결정
    # (보수적: 커버는 ref로 주지 않음; 보컬 성별 + description만으로 생성)

    assets = {}

    # 캐릭터 생성 (병렬)
    async def _make_char(key, info):
        ref = user_char_bytes if key == "character1" and user_char_bytes else None
        age_val = (info.get("age") or "").strip() if isinstance(info.get("age"), str) else ""
        pers = info.get("personality") if isinstance(info.get("personality"), dict) else {}
        p_tags_raw = pers.get("tags") if isinstance(pers, dict) else None
        p_tags = [t for t in (p_tags_raw or []) if isinstance(t, str) and t.strip()]
        p_text = pers.get("text") if isinstance(pers, dict) else ""
        if not isinstance(p_text, str):
            p_text = ""
        p_text = p_text.strip()
        try:
            img = await generate_character_sheet_asset(
                name=info.get("name", key),
                gender=info.get("gender", "neutral"),
                description=info.get("description", ""),
                ref_image=ref,
                age=age_val or None,
                personality_tags=p_tags or None,
                personality_text=p_text or None,
                image_model=image_model,
            )
            obj = await upload_asset_to_minio(img, job_id, key)
            return key, {
                "type": "character",
                "name": info.get("name", key),
                "gender": info.get("gender"),
                "description": info.get("description", ""),
                "age": age_val,
                "personality_tags": p_tags,
                "personality_text": p_text,
                "object_name": obj,
                "created_at": datetime.utcnow(),
            }
        except Exception as e:
            logger.exception("Phase1.5: char %s gen failed: %s", key, e)
            return key, None

    async def _make_loc(key, info):
        # v42: location1 + user_location_snapshot 조합이면 자동생성 SKIP하고
        # 사용자 PNG를 그대로 자산 경로에 복사한다.
        if key == "location1" and user_loc_bytes:
            try:
                obj = await upload_asset_to_minio(user_loc_bytes, job_id, key)
                snap_name = (user_location_snapshot or {}).get("name") or info.get("name", key)
                return key, {
                    "type": "location",
                    "name": snap_name,
                    "description": info.get("description", ""),
                    "object_name": obj,
                    "source": "user",
                    "created_at": datetime.utcnow(),
                }
            except Exception as e:
                logger.exception("Phase1.5: user location1 copy failed: %s", e)
                return key, None
        try:
            # location2/3: 사용자 location1 이 있으면 그 톤을 따르도록 style_ref 첨부
            style_ref = user_loc_bytes if (key != "location1" and user_loc_bytes) else None
            img = await generate_location_sheet_asset(
                name=info.get("name", key),
                description=info.get("description", ""),
                style_ref=style_ref,
                image_model=image_model,
            )
            obj = await upload_asset_to_minio(img, job_id, key)
            return key, {
                "type": "location",
                "name": info.get("name", key),
                "description": info.get("description", ""),
                "object_name": obj,
                "created_at": datetime.utcnow(),
            }
        except Exception as e:
            logger.exception("Phase1.5: loc %s gen failed: %s", key, e)
            return key, None

    # v59: progress 단계화 + outer wait_for 가드 + 0개 성공 시 명시적 failed 마킹.
    # 한 task 가 영구 hang 해도 외부 wait_for(2400s, 40분) 가 잘라낸다.
    # 그동안 사용자에게는 progress 5→8 사이 점진적 갱신이 보이도록 한다.

    import time as _time
    _phase15_t0 = _time.monotonic()

    # _make_char/_make_loc 을 progress-aware wrapper 로 감싼다.
    progress_state = {"done": 0, "total": 0}

    async def _track(coro):
        try:
            result = await coro
        finally:
            progress_state["done"] += 1
            try:
                total = max(progress_state["total"], 1)
                done = progress_state["done"]
                # 5(시작) ~ 8(종료) 사이를 선형 분배. 5 + floor(done/total * 3) — 4 단계.
                p = 5 + int((done / total) * 3)
                if p > 8:
                    p = 8
                await _update_job(mongo_db, job_id, {"progress": p})
            except Exception as _e:  # progress update 실패는 치명적이지 않음
                logger.warning("[Phase1.5] progress update failed: %s", _e)
        return result

    tasks = []
    for k, v in characters.items():
        if isinstance(v, dict):
            tasks.append(_track(_make_char(k, v)))

    # v42: LLM이 location1 을 누락했더라도 user_loc_bytes 가 있으면 보강 등록한다.
    if user_loc_bytes and not isinstance(locations.get("location1"), dict):
        locations["location1"] = {
            "name": (user_location_snapshot or {}).get("name") or "사용자 장소",
            "description": "",
        }

    for k, v in locations.items():
        if isinstance(v, dict):
            tasks.append(_track(_make_loc(k, v)))

    progress_state["total"] = len(tasks)
    total_assets = len(tasks)
    logger.info(
        "[Phase1.5] job=%s total_assets=%d image_model=%s — starting parallel gen",
        job_id, total_assets, image_model,
    )

    if tasks:
        try:
            results = await asyncio.wait_for(
                asyncio.gather(*tasks, return_exceptions=True),
                timeout=2400.0,  # 40분 외부 가드
            )
        except asyncio.TimeoutError:
            logger.error(
                "[Phase1.5] job=%s outer wait_for timeout (2400s) — aborting asset phase",
                job_id,
            )
            await _update_job(mongo_db, job_id, {
                "status": "failed",
                "error_message": "자산 생성 단계가 40분 외부 가드를 초과했습니다. 잠시 후 다시 시도해주세요.",
            })
            return
        for r in results:
            if isinstance(r, tuple) and r[1] is not None:
                assets[r[0]] = r[1]

    elapsed_s = int(_time.monotonic() - _phase15_t0)
    logger.info(
        "[Phase1.5] job=%s done assets=%d/%d elapsed_s=%d",
        job_id, len(assets), total_assets, elapsed_s,
    )

    # v59: 시도한 자산이 1개 이상인데 성공이 0개면 명시적 failed 로 사용자에게 알린다.
    # 부분 실패(>=1 성공)는 기존대로 warning 만 — 후속 phase 가 부분 ref 로 진행.
    if total_assets > 0 and len(assets) == 0:
        logger.error(
            "[Phase1.5] job=%s all %d asset generations failed — marking job failed",
            job_id, total_assets,
        )
        await _update_job(mongo_db, job_id, {
            "assets": assets,
            "status": "failed",
            "error_message": "캐릭터/장소 자산 생성에 모두 실패했습니다. 모델 설정 또는 외부 API 상태를 확인해주세요.",
        })
        return

    await _update_job(mongo_db, job_id, {
        "assets": assets,
        "progress": 8,
    })
    logger.info("Phase1.5: generated %d assets for job %s", len(assets), job_id)


# ── Phase 1+2 Combined: Split lyrics then generate images ─────────────────────


async def run_phase1_and_phase2(job_id, mongo_db) -> None:
    """Run Phase 1 (split lyrics) then Phase 2 (generate images) in sequence.

    This is the background task launched by POST /api/mv/create.
    Final status after both complete: "images_ready".
    """
    # Run Phase 1
    await run_phase1_split(job_id, mongo_db)

    # Check if phase 1 succeeded
    job = await _get_job(mongo_db, job_id)
    if not job or job.get("status") == "failed":
        return

    # Run Phase 2 (all scenes, no specific scene_numbers)
    await run_phase2_images(job_id, mongo_db)


# ── Phase 2: Generate images ─────────────────────────────────────────────────


async def run_phase2_images(job_id, mongo_db, scene_numbers: Optional[List[int]] = None) -> None:
    """Generate images for scenes. Updates each scene in MongoDB."""
    job = await _get_job(mongo_db, job_id)
    if not job:
        logger.error("Phase2: job %s not found", job_id)
        return

    scenes = job.get("scenes", [])
    if not scenes:
        await _update_job(mongo_db, job_id, {
            "status": "failed",
            "error_message": "장면 데이터가 없습니다. 먼저 장면 분할을 실행하세요.",
        })
        return

    await _update_job(mongo_db, job_id, {
        "status": "generating_images",
        "cancel_requested": False,
    })

    cover_image_bytes = _load_cover_image(job.get("cover_object_name"))
    character_image_bytes = _load_character_image(job.get("character_object_name"))
    minio_client = get_minio()

    # v55: 씬+자산 동일 image_model 사용. 옛 도큐먼트는 nb_pro 기본값.
    image_model_p2 = (job.get("image_model") or "nb_pro").strip() or "nb_pro"
    logger.info("[SceneImage] job=%s image_model=%s (phase2)", job_id, image_model_p2)

    # Asset registry: {"character1": bytes, ...} for variable-reference resolution
    from .mv_assets import parse_asset_references, load_asset_from_minio
    assets_meta = job.get("assets") or {}
    asset_bytes_cache: dict = {}
    for _k, _a in assets_meta.items():
        if isinstance(_a, dict) and _a.get("object_name"):
            _b = load_asset_from_minio(_a["object_name"])
            if _b:
                asset_bytes_cache[_k] = _b

    # v42: user-supplied location name for prompt-side anchor (bytes are
    # already attached via reference_images when @location1 appears in prompt).
    _user_loc_snap_p2 = job.get("user_location_snapshot") or None
    user_location_name_p2 = None
    if isinstance(_user_loc_snap_p2, dict):
        _ln_p2 = (_user_loc_snap_p2.get("name") or "").strip()
        if _ln_p2:
            user_location_name_p2 = _ln_p2

    # Determine which scenes to process
    target_scenes = []
    for i, scene in enumerate(scenes):
        sn = scene.get("scene_number", i + 1)
        if scene_numbers is not None:
            if sn in scene_numbers:
                target_scenes.append((i, scene))
        else:
            # Only generate for scenes without images
            if not scene.get("image_object_name"):
                target_scenes.append((i, scene))

    total_to_generate = len(target_scenes)
    if total_to_generate == 0:
        await _update_job(mongo_db, job_id, {
            "status": "images_ready",
        })
        return

    generated_count = 0
    prev_scene_image_bytes = None  # Track previous scene image for continuity

    for idx, (i, scene) in enumerate(target_scenes):
        # Check for cancellation between scenes
        if await _is_cancelled(mongo_db, job_id):
            logger.info("Phase2: job %s cancelled by user", job_id)
            await _update_job(mongo_db, job_id, {
                "status": "images_ready",
                "cancel_requested": False,
                "error_message": "사용자에 의해 중지됨",
            })
            return

        sn = scene.get("scene_number", i + 1)
        scene_desc = scene.get("image_prompt", "")

        # Scene 1: use cover image as reference; Scene 2+: use previous scene image
        if prev_scene_image_bytes is not None:
            ref_image = prev_scene_image_bytes
        else:
            ref_image = cover_image_bytes

        # Resolve @character1/@location1 references → attach matching asset bytes
        scene_refs: list = []
        if asset_bytes_cache:
            _combined_prompt = "{} {}".format(
                scene_desc, scene.get("video_image_prompt", "") or "",
            )
            for _key in parse_asset_references(_combined_prompt):
                _b = asset_bytes_cache.get(_key)
                if _b:
                    scene_refs.append(_b)

        try:
            # v41: LoRA system removed — scene generation is Nano Banana only.
            # v55: image_model 분기 — nb_pro(기본) / gpt_image_2.
            img_bytes = await generate_scene_image(
                scene_desc,
                cover_image_bytes=ref_image,
                character_image_bytes=character_image_bytes,
                scene_type=scene.get("scene_type", "drama"),
                reference_images=scene_refs or None,
                user_location_name=user_location_name_p2,
                image_model=image_model_p2,
                scene_number=sn,
            )
            image_source = "gemini"

            # Save to MinIO
            object_name = "mv/{}/scenes/{:03d}.png".format(str(job_id), sn)
            minio_client.put_object(
                bucket_name=settings.minio_bucket_images,
                object_name=object_name,
                data=io.BytesIO(img_bytes),
                length=len(img_bytes),
                content_type="image/png",
            )

            # Update scene in MongoDB
            scenes[i]["image_object_name"] = object_name
            scenes[i]["image_source"] = image_source
            generated_count += 1

            # Save this scene's image for next scene's reference
            prev_scene_image_bytes = img_bytes

        except Exception as e:
            logger.warning("Phase2: scene %d image failed: %s", sn, e)

        # Update progress
        completed_image_count = sum(
            1 for s in scenes if s.get("image_object_name")
        )
        progress = int(5 + (idx + 1) / total_to_generate * 40)
        await _update_job(mongo_db, job_id, {
            "scenes": scenes,
            "completed_image_count": completed_image_count,
            "progress": min(progress, 45),
        })

        # Delay between image generations
        if idx < total_to_generate - 1:
            await asyncio.sleep(3)

    # ── Phase 2.5: Generate video_prompts from scene images (Gemini 2.5 Pro) ──
    logger.info("Phase2.5: generating video prompts from scene images for job %s", job_id)

    # v45: pull scenario events + emotional core for per-scene event lookup.
    _scenario_events = job.get("scenario_events") or []
    _emotional_core = job.get("scenario_emotional_core") or ""

    for i, scene in enumerate(scenes):
        if not scene.get("image_object_name"):
            continue  # no image, skip
        if scene.get("video_prompt"):
            continue  # already has video_prompt (e.g. manual override), skip

        # v45: find the event mapped to this scene (event_index from scene-split LLM)
        _event_for_scene = None
        _ev_idx = scene.get("event_index")
        if isinstance(_ev_idx, int) and 0 <= _ev_idx < len(_scenario_events):
            _event_for_scene = _scenario_events[_ev_idx]

        try:
            # Load scene image from MinIO
            resp = minio_client.get_object(
                bucket_name=settings.minio_bucket_images,
                object_name=scene["image_object_name"],
            )
            scene_image_bytes = resp.read()
            resp.close()
            resp.release_conn()

            video_prompt = await generate_video_prompts_from_images(
                image_bytes=scene_image_bytes,
                image_prompt=scene.get("video_image_prompt") or scene.get("image_prompt", ""),
                scene_type=scene.get("scene_type", "drama"),
                lyrics_segment=scene.get("lyrics_segment", ""),
                scene_number=scene.get("scene_number", i + 1),
                model=job.get("video_prompt_model") or "gemini-2.5-pro",
                video_model=job.get("video_model", "veo"),
                has_character=bool(job.get("character_object_name")),
                duration=float(scene.get("use_seconds", 5.0)),
                scene_event=_event_for_scene,
                emotional_core=_emotional_core,
            )

            # v60: Phase 2.5 결과가 빈 문자열이면 Phase 1b 의 video_prompt 유지 (덮어쓰지 않음).
            #      empty 는 generate_video_prompts_from_images 의 v60 fallback 시그널.
            if video_prompt:
                scenes[i]["video_prompt"] = video_prompt
                # v56 — auto-translate the newly generated English video_prompt to Korean.
                try:
                    from .translation import translate_en_to_ko
                    _vp_ko = await translate_en_to_ko(
                        video_prompt or "", context_hint="MV scene video prompt",
                    )
                    scenes[i]["video_prompt_ko"] = _vp_ko
                    logger.info(
                        "[TranslateEnKo] new video_prompt_ko scene=%d len=%d",
                        scene.get("scene_number", i + 1), len(_vp_ko or ""),
                    )
                except Exception as _tr_err:
                    logger.warning(
                        "[TranslateEnKo] phase2_5 failed scene=%d err=%s",
                        scene.get("scene_number", i + 1), str(_tr_err)[:200],
                    )
                    scenes[i].setdefault("video_prompt_ko", "")
                logger.info("Phase2.5: scene %d video_prompt generated", scene.get("scene_number", i + 1))
            else:
                # v60: Phase 1b 의 video_prompt 가 살아있으므로 영상 생성은 그대로 진행 가능.
                logger.warning(
                    "[Phase2.5] scene %d empty refinement → keeping Phase 1b video_prompt as-is",
                    scene.get("scene_number", i + 1),
                )
                scenes[i].setdefault("video_prompt_ko", "")

        except Exception as e:
            # v60: 예외 시에도 Phase 1b 의 video_prompt 그대로 유지. "Smooth..." 강제 박기 제거.
            logger.warning(
                "[Phase2.5] scene %d refinement failed: %s — keeping Phase 1b video_prompt",
                scene.get("scene_number", i + 1), e,
            )
            scenes[i].setdefault("video_prompt_ko", "")

        # Update progress
        await _update_job(mongo_db, job_id, {"scenes": scenes})

        # Small delay between API calls
        if i < len(scenes) - 1:
            await asyncio.sleep(2)

    # Final status
    completed_image_count = sum(1 for s in scenes if s.get("image_object_name"))
    await _update_job(mongo_db, job_id, {
        "status": "images_ready",
        "completed_image_count": completed_image_count,
        "scenes": scenes,
        "progress": 45,
    })

    logger.info(
        "Phase2: job %s — %d images generated (%d total)",
        job_id, generated_count, completed_image_count,
    )


# ── Sync Labs 후 자막 재적용 ──────────────────────────────────────────────────


def _burn_subtitles_on_synced_video(video_bytes: bytes, scene: dict, timestamps: list[dict] = None) -> bytes:
    """Sync Labs 후보정된 영상에 가사 자막을 다시 burn-in한다.

    Args:
        video_bytes: Sync Labs에서 반환된 영상 (무음 또는 유음)
        scene: 씬 데이터 (lyrics_segment, section_start, section_end 포함)
        timestamps: 해당 씬의 Whisper 타이밍 (pre-computed, 0-based)

    Returns:
        자막이 burn-in된 영상 bytes. 실패 시 원본 반환.
    """
    if not scene.get("lyrics_segment"):
        return video_bytes  # 가사 없으면 그냥 반환

    for _retry in range(3):
        try:
            from .subtitle_generator import generate_scene_lyrics_ass
            import subprocess, tempfile, os

            # ASS 자막 생성
            ass_content = generate_scene_lyrics_ass(scene, timestamps=timestamps)
            if not ass_content:
                return video_bytes

            with tempfile.TemporaryDirectory() as tmpdir:
                vid_path = os.path.join(tmpdir, "input.mp4")
                ass_path = os.path.join(tmpdir, "lyrics.ass")
                out_path = os.path.join(tmpdir, "output.mp4")

                with open(vid_path, "wb") as f:
                    f.write(video_bytes)
                with open(ass_path, "w", encoding="utf-8") as f:
                    f.write(ass_content)

                ass_filter = ass_path.replace("\\", "/").replace(":", "\\:")
                ffmpeg_bin = _get_ffmpeg_path() or "ffmpeg"
                subprocess.run(
                    [ffmpeg_bin, "-y", "-i", vid_path,
                     "-vf", "ass={}".format(ass_filter),
                     "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                     "-c:a", "copy",
                     out_path],
                    capture_output=True, timeout=60,
                )

                if os.path.exists(out_path):
                    with open(out_path, "rb") as f:
                        return f.read()

            logger.warning("Subtitle burn-in: output not created (attempt %d/3)", _retry + 1)
        except Exception as e:
            logger.warning("Subtitle burn-in failed (attempt %d/3): %s", _retry + 1, str(e)[:200])

    logger.warning("Subtitle burn-in: all 3 attempts failed, returning original video")
    return video_bytes


# ── Phase 3: Generate videos ─────────────────────────────────────────────────


async def run_phase3_videos(job_id, mongo_db, scene_numbers: Optional[List[int]] = None, video_model: Optional[str] = None) -> None:
    """Generate videos. Pauses on 429. Skips completed scenes."""
    job = await _get_job(mongo_db, job_id)
    if not job:
        logger.error("Phase3: job %s not found", job_id)
        return

    scenes = job.get("scenes", [])
    if not scenes:
        await _update_job(mongo_db, job_id, {
            "status": "failed",
            "error_message": "장면 데이터가 없습니다.",
        })
        return

    # Resolve video model: parameter > job setting > default
    if not video_model:
        video_model = job.get("video_model", "veo")
    use_kling = (video_model == "kling")
    use_seedance = (video_model == "seedance")
    use_grok = (video_model == "grok")  # v66

    logger.info("Phase3: job %s using video model: %s", job_id, video_model)

    await _update_job(mongo_db, job_id, {
        "status": "generating_videos",
        "progress": 45,
        "error_message": "",
        "cancel_requested": False,
    })

    minio_client = get_minio()
    character_image_bytes = _load_character_image(job.get("character_object_name"))

    # Determine which scenes to process
    target_scenes = []
    for i, scene in enumerate(scenes):
        sn = scene.get("scene_number", i + 1)
        if scene_numbers is not None:
            if sn not in scene_numbers:
                continue
        # Only process pending or failed
        if scene.get("video_status") in ("pending", "failed"):
            if scene.get("image_object_name"):
                target_scenes.append((i, scene))

    total_to_process = len(target_scenes)
    if total_to_process == 0:
        # Check if all done
        completed = sum(1 for s in scenes if s.get("video_status") == "completed")
        status = "completed" if completed == len(scenes) else "images_ready"
        await _update_job(mongo_db, job_id, {
            "status": status,
            "completed_video_count": completed,
        })
        return

    # v64: max_retries 를 5 → 3 으로 낮춤. content_policy_violation 같은 비-rate-limit
    # 에러는 retry 가 거의 무의미 (씬 15 케이스에서 8회 반복 거부 확인). rate-limit 시
    # backoffs 도 슬라이스 사용.
    max_retries = 3
    rate_limit_backoffs = [180, 300, 420, 600, 900]
    prev_scene_image_for_video = None  # Track previous scene image for Kling continuity

    # Load audio for Seedance lipsync scenes
    seedance_audio_bytes = None
    if use_seedance:
        audio_obj = await _resolve_audio_object_name(job, mongo_db)
        if audio_obj:
            seedance_audio_bytes = _load_audio_from_minio(audio_obj)

    for idx, (i, scene) in enumerate(target_scenes):
        # Check for cancellation between scenes
        if await _is_cancelled(mongo_db, job_id):
            logger.info("Phase3: job %s cancelled by user", job_id)
            completed_video_count = sum(
                1 for s in scenes if s.get("video_status") == "completed"
            )
            await _update_job(mongo_db, job_id, {
                "status": "paused",
                "cancel_requested": False,
                "error_message": "사용자에 의해 중지됨",
                "completed_video_count": completed_video_count,
                "scenes": scenes,
                "retry_info": None,
            })
            return

        sn = scene.get("scene_number", i + 1)

        # Load image from MinIO
        try:
            resp = minio_client.get_object(
                bucket_name=settings.minio_bucket_images,
                object_name=scene["image_object_name"],
            )
            image_bytes = resp.read()
            resp.close()
            resp.release_conn()
        except Exception as e:
            logger.warning("Phase3: failed to load image for scene %d: %s", sn, e)
            scenes[i]["video_status"] = "failed"
            scenes[i]["video_error"] = "이미지 로드 실패: {}".format(str(e)[:200])
            await _update_job(mongo_db, job_id, {"scenes": scenes})
            continue

        # Mark as generating
        scenes[i]["video_status"] = "generating"
        await _update_job(mongo_db, job_id, {"scenes": scenes})

        # # ── [DISABLED] Lipsync branch: Sync Labs (kept for future use) ──
        # scene_type = scene.get("scene_type", "drama")
        # if scene_type == "lipsync" and settings.sync_api_key:
        #     try:
        #         from .sync_labs_service import generate_lipsync, cut_audio_segment
        #
        #         # Get audio for this scene segment
        #         audio_object = await _resolve_audio_object_name(job, mongo_db)
        #         if not audio_object:
        #             raise ValueError("No audio available for lipsync scene")
        #
        #         audio_resp = minio_client.get_object(
        #             bucket_name=settings.minio_bucket_music,
        #             object_name=audio_object,
        #         )
        #         full_audio = audio_resp.read()
        #         audio_resp.close()
        #         audio_resp.release_conn()
        #
        #         # Get start/end times
        #         start_sec = scene.get("section_start", 0)
        #         end_sec = scene.get("section_end", start_sec + 10)
        #
        #         segment_audio = cut_audio_segment(full_audio, start_sec, end_sec)
        #
        #         # Generate lipsync video
        #         lipsync_video = await generate_lipsync(
        #             image_bytes=image_bytes,
        #             audio_bytes=segment_audio,
        #             model="lipsync-2",
        #         )
        #
        #         # Save to MinIO
        #         video_object = "mv/{}/videos/{:03d}_lipsync.mp4".format(str(job_id), sn)
        #         minio_client.put_object(
        #             bucket_name=settings.minio_bucket_images,
        #             object_name=video_object,
        #             data=io.BytesIO(lipsync_video),
        #             length=len(lipsync_video),
        #             content_type="video/mp4",
        #         )
        #
        #         scenes[i]["video_object_name"] = video_object
        #         scenes[i]["video_status"] = "completed"
        #         scenes[i]["video_error"] = None
        #         scenes[i]["video_source"] = "sync_labs"
        #
        #         logger.info("Phase3: lipsync scene %d completed via Sync Labs", sn)
        #
        #         # Update progress and continue to next scene
        #         completed_video_count = sum(
        #             1 for s in scenes if s.get("video_status") == "completed"
        #         )
        #         progress = int(45 + (idx + 1) / total_to_process * 40)
        #         await _update_job(mongo_db, job_id, {
        #             "scenes": scenes,
        #             "completed_video_count": completed_video_count,
        #             "progress": min(progress, 85),
        #         })
        #         if idx < total_to_process - 1:
        #             await asyncio.sleep(15)
        #         continue
        #
        #     except Exception as e:
        #         logger.error("Phase3: lipsync failed for scene %d: %s, falling back to video gen", sn, e)
        #         scenes[i]["video_error"] = "Lipsync 실패, 영상 생성으로 대체: {}".format(str(e)[:200])
        #         # Fall through to regular video generation below

        # Try to generate video with retries (all scenes via Veo 3.1 Fast)
        video_generated = False
        consecutive_429 = 0

        for attempt in range(max_retries):
            try:
                scene_desc_for_video = scene.get("video_image_prompt") or scene.get("image_prompt", "")
                scene_video_prompt = scene.get("video_prompt")
                # v60: 행동/감정/맥락 description — 영상 모델 prompt 의 별도 슬롯에 합쳐짐.
                scene_description_en = scene.get("description") or ""
                # v64: 영상 모델 호출 직전, 위험 표현 → 안전 표현 정적 후처리 1회 패스.
                # Mongo 원본은 변경하지 않음 (UI 표시용은 그대로 유지). 호출 인자만 정화.
                from .mv_generator import sanitize_video_prompt as _sanitize
                scene_desc_for_video = _sanitize(scene_desc_for_video)
                scene_video_prompt = _sanitize(scene_video_prompt)
                scene_description_en = _sanitize(scene_description_en)
                # v43: scene 의 정확한 duration (= section_end - section_start) 을 모델별 정수 그리드로 ceil.
                _scene_dur_exact = float(
                    scene.get("section_end", 0) - scene.get("section_start", 0)
                )
                if _scene_dur_exact <= 0:
                    _scene_dur_exact = float(scene.get("use_seconds", 10))
                # Stash exact duration on scene for trim post-processing later.
                scene["_exact_duration_sec"] = _scene_dur_exact
                if use_kling:
                    _req_dur = _request_video_duration(_scene_dur_exact, "kling")
                    task_or_op = await start_scene_video_kling(
                        prompt=scene_desc_for_video,
                        image_bytes=image_bytes,
                        prev_scene_image_bytes=prev_scene_image_for_video,
                        character_image_bytes=character_image_bytes,
                        lyrics_segment=scene.get("lyrics_segment", ""),
                        scene_type=scene.get("scene_type", "drama"),
                        duration=float(_req_dur),
                        video_prompt=scene_video_prompt,
                        description=scene_description_en,
                    )
                    logger.info("Phase3: scene %d kling duration: exact=%.3f, requested=%d",
                                sn, _scene_dur_exact, _req_dur)
                elif use_seedance:
                    # v72: audio embedding disabled — Phase 3.5 sync labs handles all lipsync.
                    _req_dur = _request_video_duration(_scene_dur_exact, "seedance")
                    logger.info(
                        "[SeedAudioOff] job=%s scene=%d type=%s (audio not embedded; sync labs will handle)",
                        job_id, sn, scene.get("scene_type"),
                    )
                    task_or_op = await start_scene_video_seedance(
                        prompt=scene_desc_for_video,
                        image_bytes=image_bytes,
                        video_prompt=scene_video_prompt,
                        lyrics_segment=scene.get("lyrics_segment", ""),
                        scene_type=scene.get("scene_type", "drama"),
                        duration=float(_req_dur),
                        audio_bytes=None,
                        description=scene_description_en,
                    )
                    logger.info("Phase3: scene %d seedance duration: exact=%.3f, requested=%d",
                                sn, _scene_dur_exact, _req_dur)
                elif use_grok:
                    # v66: Grok Imagine Video (xAI 직접). image.url 필요 →
                    # MinIO presigned URL 발급해서 전달.
                    # 주의: xAI 서버가 우리 MinIO 호스트로 접근 가능해야 동작
                    # (MINIO_HOST 가 public 또는 인터넷 reachable). Tailscale 환경
                    # 단독 운영 시 도달 불가 — 향후 public hosting 검토 필요.
                    _req_dur = _request_video_duration(_scene_dur_exact, "grok")
                    # v173: xAI 서버측 fetch — 반드시 public presign (프록시 URL 금지).
                    image_url = public_presign(
                        scene["image_object_name"],
                        expires=timedelta(hours=1),
                    )
                    task_or_op = await start_scene_video_grok(
                        prompt=scene_desc_for_video,
                        image_url=image_url,
                        video_prompt=scene_video_prompt,
                        lyrics_segment=scene.get("lyrics_segment", ""),
                        scene_type=scene.get("scene_type", "drama"),
                        duration=float(_req_dur),
                        description=scene_description_en,
                    )
                    logger.info(
                        "Phase3: scene %d grok duration: exact=%.3f, requested=%d",
                        sn, _scene_dur_exact, _req_dur,
                    )
                else:
                    # v43 NOTE: Veo with referenceImages is fixed at 8s by Google API
                    # (start_scene_video has no duration param). Trim post-processing
                    # will cap to exact scene_dur.
                    task_or_op = await start_scene_video(
                        scene_desc_for_video, image_bytes,
                        video_prompt=scene_video_prompt,
                        lyrics_segment=scene.get("lyrics_segment", ""),
                        scene_type=scene.get("scene_type", "drama"),
                        description=scene_description_en,
                    )
                consecutive_429 = 0  # API accepted
                await _update_job(mongo_db, job_id, {"retry_info": None})

                # Poll until done (max ~10 min)
                timed_out = True
                for _ in range(120):
                    await asyncio.sleep(5)
                    # Check cancellation during polling
                    if await _is_cancelled(mongo_db, job_id):
                        logger.info("Phase3: job %s cancelled during video poll", job_id)
                        scenes[i]["video_status"] = "pending"
                        completed_vc = sum(
                            1 for s in scenes if s.get("video_status") == "completed"
                        )
                        await _update_job(mongo_db, job_id, {
                            "status": "paused",
                            "cancel_requested": False,
                            "error_message": "사용자에 의해 중지됨",
                            "completed_video_count": completed_vc,
                            "scenes": scenes,
                            "retry_info": None,
                        })
                        return
                    if use_kling:
                        status_result = await check_scene_video_status_kling(task_or_op)
                    elif use_seedance:
                        status_result = await check_scene_video_status_seedance(task_or_op)
                    elif use_grok:
                        status_result = await check_scene_video_status_grok(task_or_op)
                    else:
                        status_result = await check_scene_video_status(task_or_op)
                    if status_result["done"]:
                        timed_out = False
                        break

                if timed_out:
                    logger.warning("Phase3: scene %d timed out (attempt %d)", sn, attempt + 1)
                    if attempt < max_retries - 1:
                        continue
                    scenes[i]["video_status"] = "failed"
                    scenes[i]["video_error"] = "비디오 생성 시간 초과"
                    break

                if status_result.get("error"):
                    _err_text = status_result["error"]
                    logger.warning("Phase3: scene %d error: %s", sn, _err_text)
                    # v64: content_policy_violation / partner_validation_failed 는
                    # 동일 prompt retry 가 거의 무의미. 즉시 fail 마킹.
                    _err_lower = _err_text.lower()
                    if (
                        "content_policy_violation" in _err_lower
                        or "partner_validation_failed" in _err_lower
                        or "sensitive content" in _err_lower
                    ):
                        logger.warning(
                            "[VideoRetry] scene %d content-policy hit — skipping retry, marking failed",
                            sn,
                        )
                        scenes[i]["video_status"] = "failed"
                        scenes[i]["video_error"] = (
                            "콘텐츠 안전 필터 거부 — 씬 카드의 [이미지 재생성] 또는 "
                            "프롬프트 수정 후 [재시도]를 눌러주세요. (원본 에러: "
                            + _err_text[:160] + ")"
                        )
                        break
                    if attempt < max_retries - 1:
                        continue
                    scenes[i]["video_status"] = "failed"
                    scenes[i]["video_error"] = _err_text
                    break

                # Download and save video
                # Kling/Seedance returns "video_url", Veo returns "video_uri"
                video_download_url = status_result.get("video_url") or status_result.get("video_uri")
                if use_kling:
                    video_bytes = await download_video_kling(video_download_url)
                elif use_seedance:
                    video_bytes = await download_video_seedance(video_download_url)
                elif use_grok:
                    video_bytes = await download_video_grok(video_download_url)
                else:
                    video_bytes = await download_video(video_download_url)

                # v43: First trim to the EXACT scene duration (float seconds) — model API only accepts
                # integer-second grid, so the returned video is ≥ exact duration; this trim makes
                # downstream concat frame-accurate. On failure, returns original bytes.
                _exact_dur = float(scene.get("_exact_duration_sec") or 0)
                if _exact_dur > 0.1:
                    _before = len(video_bytes) if video_bytes else 0
                    video_bytes = _trim_video_to_duration(video_bytes, _exact_dur)
                    logger.info(
                        "Phase3: scene %d trimmed to exact %.3fs (bytes %d → %d)",
                        sn, _exact_dur, _before, len(video_bytes) if video_bytes else 0,
                    )

                # Trim video to use_seconds if specified (legacy section-aware pipeline path)
                use_seconds = scene.get("use_seconds")
                if use_seconds and use_seconds > 0:
                    tmpdir_trim = tempfile.mkdtemp(prefix="mv_trim_")
                    try:
                        raw_path = os.path.join(tmpdir_trim, "raw_{:03d}.mp4".format(sn))
                        trimmed_path = os.path.join(tmpdir_trim, "trimmed_{:03d}.mp4".format(sn))
                        with open(raw_path, "wb") as f:
                            f.write(video_bytes)

                        trim_ok = await trim_video_clip(raw_path, trimmed_path, use_seconds)
                        if trim_ok and os.path.exists(trimmed_path):
                            with open(trimmed_path, "rb") as f:
                                video_bytes = f.read()
                            logger.info(
                                "Phase3: scene %d trimmed to %.1fs", sn, use_seconds
                            )
                        else:
                            logger.warning(
                                "Phase3: scene %d trim failed, using untrimmed", sn
                            )
                    finally:
                        shutil.rmtree(tmpdir_trim, ignore_errors=True)

                video_object = "mv/{}/videos/{:03d}.mp4".format(str(job_id), sn)
                minio_client.put_object(
                    bucket_name=settings.minio_bucket_images,
                    object_name=video_object,
                    data=io.BytesIO(video_bytes),
                    length=len(video_bytes),
                    content_type="video/mp4",
                )

                scenes[i]["video_object_name"] = video_object
                scenes[i]["video_status"] = "completed"
                scenes[i]["video_error"] = None
                video_generated = True

                # Save current scene image for next scene's Kling reference
                prev_scene_image_for_video = image_bytes
                break

            except Exception as e:
                error_str = str(e)
                is_rate_limit = "429" in error_str
                # v64: content_policy_violation 류는 retry 무의미 — 즉시 fail.
                _err_lower = error_str.lower()
                if (
                    "content_policy_violation" in _err_lower
                    or "partner_validation_failed" in _err_lower
                    or "sensitive content" in _err_lower
                ):
                    logger.warning(
                        "[VideoRetry] scene %d content-policy hit (exception path) — marking failed",
                        sn,
                    )
                    scenes[i]["video_status"] = "failed"
                    scenes[i]["video_error"] = (
                        "콘텐츠 안전 필터 거부 — 씬 카드의 [이미지 재생성] 또는 "
                        "프롬프트 수정 후 [재시도]를 눌러주세요. (원본: "
                        + error_str[:160] + ")"
                    )
                    break

                if is_rate_limit:
                    consecutive_429 += 1
                    backoff = rate_limit_backoffs[min(attempt, len(rate_limit_backoffs) - 1)]
                    logger.warning(
                        "Phase3: scene %d attempt %d: 429 — waiting %ds",
                        sn, attempt + 1, backoff,
                    )

                    if consecutive_429 >= max_retries:
                        # Quota exhausted — pause job
                        scenes[i]["video_status"] = "failed"
                        scenes[i]["video_error"] = "API 할당량 소진 (429)"
                        await _update_job(mongo_db, job_id, {
                            "status": "paused",
                            "scenes": scenes,
                            "error_message": "API 할당량이 소진되어 일시 중지되었습니다. 나중에 재개하세요.",
                            "completed_video_count": sum(
                                1 for s in scenes if s.get("video_status") == "completed"
                            ),
                            "retry_info": None,
                        })
                        logger.info("Phase3: job %s paused due to 429", job_id)
                        return
                else:
                    consecutive_429 = 0
                    backoff = 10 * (attempt + 1)
                    logger.warning(
                        "Phase3: scene %d attempt %d failed: %s",
                        sn, attempt + 1, error_str[:200],
                    )

                if attempt < max_retries - 1:
                    if is_rate_limit:
                        retry_info = {
                            "active": True,
                            "scene_number": sn,
                            "attempt": attempt + 1,
                            "max_retries": max_retries,
                            "backoff_seconds": backoff,
                            "retry_at": (datetime.utcnow() + timedelta(seconds=backoff)).isoformat(),
                            "reason": "429_rate_limit",
                        }
                        await _update_job(mongo_db, job_id, {"retry_info": retry_info})
                    await asyncio.sleep(backoff)
                    await _update_job(mongo_db, job_id, {"retry_info": None})
                    continue

                scenes[i]["video_status"] = "failed"
                scenes[i]["video_error"] = error_str[:300]

        # Update progress
        completed_video_count = sum(
            1 for s in scenes if s.get("video_status") == "completed"
        )
        total_with_images = sum(1 for s in scenes if s.get("image_object_name"))
        progress = int(45 + (idx + 1) / total_to_process * 40)
        await _update_job(mongo_db, job_id, {
            "scenes": scenes,
            "completed_video_count": completed_video_count,
            "progress": min(progress, 85),
        })

        # Breathing room between scenes
        if video_generated and idx < total_to_process - 1:
            await asyncio.sleep(15)

    # Final status
    completed_video_count = sum(
        1 for s in scenes if s.get("video_status") == "completed"
    )
    total_scenes = len(scenes)

    logger.info(
        "Phase3: job %s — %d/%d videos completed",
        job_id, completed_video_count, total_scenes,
    )

    # If ALL scenes have completed videos, auto-concatenate
    if completed_video_count == total_scenes:
        await _update_job(mongo_db, job_id, {
            "scenes": scenes,
            "completed_video_count": completed_video_count,
            "progress": 88,
            "status": "generating_videos",
            "retry_info": None,
        })

        # ── Phase 3.5: 립싱크 씬 자동 Sync Labs 적용 ──
        lipsync_scenes = [s for s in scenes if s.get("scene_type") == "lipsync"
                          and s.get("video_status") == "completed"
                          and s.get("video_object_name")
                          and not s.get("video_synclabs_object")]
        if lipsync_scenes:
            logger.info("Phase3.5: auto Sync Labs for %d lipsync scenes", len(lipsync_scenes))
            await _update_job(mongo_db, job_id, {
                "status": "synclabs_processing",
                "progress": 89,
                "synclabs_total": len(lipsync_scenes),
                "synclabs_completed": 0,
            })
            try:
                from .sync_labs_service import generate_lipsync_from_video, cut_audio_segment
                # v43: Demucs 제거 — raw audio segment 그대로 Sync Labs 에 투입.
                import subprocess

                audio_obj = await _resolve_audio_object_name(job, mongo_db)
                if audio_obj:
                    audio_resp = minio_client.get_object(
                        bucket_name=settings.minio_bucket_music, object_name=audio_obj)
                    full_audio = audio_resp.read()
                    audio_resp.close(); audio_resp.release_conn()

                    for scene in lipsync_scenes:
                        sn = scene["scene_number"]
                        sidx = next(i for i, s in enumerate(scenes) if s.get("scene_number") == sn)
                        try:
                            # ── section_start/end 유효성 가드 ──
                            raw_start = scene.get("section_start")
                            raw_end = scene.get("section_end")
                            if raw_start is None or raw_end is None:
                                msg = "씬의 시간 정보(section_start/end)가 없어 Sync Labs를 건너뜁니다."
                                logger.warning("Phase3.5: scene %d skipped: %s", sn, msg)
                                scenes[sidx]["sync_error"] = msg
                                scenes[sidx]["video_source"] = "kling (sync skipped)"
                                continue
                            try:
                                start_sec = float(raw_start)
                                end_sec = float(raw_end)
                            except (TypeError, ValueError):
                                msg = "section_start/end가 숫자가 아닙니다 (start={}, end={})".format(raw_start, raw_end)
                                logger.warning("Phase3.5: scene %d skipped: %s", sn, msg)
                                scenes[sidx]["sync_error"] = msg
                                scenes[sidx]["video_source"] = "kling (sync skipped)"
                                continue
                            if start_sec < 0 or end_sec <= start_sec or (end_sec - start_sec) < 0.5:
                                msg = "유효하지 않은 구간 (start={:.3f}, end={:.3f})".format(start_sec, end_sec)
                                logger.warning("Phase3.5: scene %d skipped: %s", sn, msg)
                                scenes[sidx]["sync_error"] = msg
                                scenes[sidx]["video_source"] = "kling (sync skipped)"
                                continue

                            try:
                                segment_audio = cut_audio_segment(full_audio, start_sec, end_sec)
                            except (RuntimeError, ValueError) as cut_err:
                                msg = "오디오 구간 컷팅 실패: {}".format(str(cut_err)[:200])
                                logger.warning("Phase3.5: scene %d %s", sn, msg)
                                scenes[sidx]["sync_error"] = msg
                                scenes[sidx]["video_source"] = "kling (sync failed)"
                                continue

                            # v43: Demucs 보컬 분리 제거 — raw segment 를 그대로 Sync Labs 에 전달.
                            vocal_bytes = segment_audio

                            # 원본 segment 만 MinIO 에 보관 (legacy 키 유지: separated_vocal_object).
                            orig_obj = "mv/{}/scenes/{:03d}_original_segment.mp3".format(str(job_id), sn)
                            minio_client.put_object(bucket_name=settings.minio_bucket_music,
                                                    object_name=orig_obj, data=io.BytesIO(segment_audio),
                                                    length=len(segment_audio), content_type="audio/mpeg")
                            scenes[sidx]["separated_original_object"] = orig_obj
                            scenes[sidx]["separated_vocal_object"] = orig_obj  # alias for backward UI

                            # Sync Labs 호출 (분리된 보컬로)
                            logger.info("Phase3.5: calling Sync Labs for scene %d", sn)
                            vid_resp = minio_client.get_object(
                                bucket_name=settings.minio_bucket_images,
                                object_name=scene["video_object_name"])
                            video_bytes = vid_resp.read()
                            vid_resp.close(); vid_resp.release_conn()

                            synced_video = await generate_lipsync_from_video(
                                video_bytes=video_bytes, audio_bytes=vocal_bytes, model="lipsync-2")

                            # 오디오 제거 후 무음 영상만 저장 (Phase 4에서 사용)
                            with tempfile.TemporaryDirectory() as tmpdir:
                                synced_path = os.path.join(tmpdir, "synced.mp4")
                                silent_path = os.path.join(tmpdir, "silent.mp4")
                                with open(synced_path, "wb") as f:
                                    f.write(synced_video)
                                ffmpeg_bin = _get_ffmpeg_path() or "ffmpeg"
                                subprocess.run([ffmpeg_bin, "-y", "-i", synced_path, "-an", "-c:v", "copy", silent_path],
                                              capture_output=True, timeout=30)
                                if os.path.exists(silent_path):
                                    with open(silent_path, "rb") as f:
                                        silent_video = f.read()
                                else:
                                    silent_video = synced_video

                            # Sync Labs 후 자막 재적용 (v43: has_subtitles 가드)
                            if job.get("has_subtitles") or _read_lyric_timestamps(job):
                                _ws = _read_lyric_timestamps(job)
                                _scene_ts = _get_scene_timestamps(_ws, float(scene.get("section_start", 0)), float(scene.get("section_end", 0)))
                                silent_video = _burn_subtitles_on_synced_video(silent_video, scene, timestamps=_scene_ts)

                            synclabs_obj = "mv/{}/scenes/{:03d}_video_synclabs.mp4".format(str(job_id), sn)
                            minio_client.put_object(bucket_name=settings.minio_bucket_images,
                                                    object_name=synclabs_obj, data=io.BytesIO(silent_video),
                                                    length=len(silent_video), content_type="video/mp4")
                            scenes[sidx]["video_synclabs_object"] = synclabs_obj
                            scenes[sidx]["video_source"] = "kling+synclabs"
                            scenes[sidx]["sync_error"] = None
                            logger.info("Phase3.5: scene %d Sync Labs completed", sn)

                        except Exception as sync_err:
                            logger.warning("Phase3.5: scene %d Sync Labs failed: %s", sn, str(sync_err)[:300])
                            scenes[sidx]["sync_error"] = str(sync_err)[:300]
                            scenes[sidx]["video_source"] = "kling (sync failed)"

                        # Update progress per scene
                        synclabs_done = sum(
                            1 for ls in lipsync_scenes
                            if any(
                                s.get("scene_number") == ls["scene_number"]
                                and (s.get("video_synclabs_object") or s.get("sync_error"))
                                for s in scenes
                            )
                        )
                        await _update_job(mongo_db, job_id, {
                            "scenes": scenes,
                            "synclabs_completed": synclabs_done,
                        })

                    await _update_job(mongo_db, job_id, {"scenes": scenes})
            except Exception as phase35_err:
                logger.warning("Phase3.5: failed: %s", str(phase35_err)[:300])
        else:
            logger.info("Phase3.5: no lipsync scenes to process")

        # ── Phase 3.6: Merge each scene video with its audio segment ──
        try:
            audio_obj_for_merge = await _resolve_audio_object_name(job, mongo_db)
            if audio_obj_for_merge:
                import subprocess
                from .subtitle_generator import generate_scene_lyrics_ass
                logger.info("Phase3.6: merging audio segments into scene videos for job %s", job_id)
                audio_resp = minio_client.get_object(
                    bucket_name=settings.minio_bucket_music,
                    object_name=audio_obj_for_merge,
                )
                full_audio_for_merge = audio_resp.read()
                audio_resp.close(); audio_resp.release_conn()

                for i, scene in enumerate(scenes):
                    if (scene.get("video_status") != "completed"
                            or not scene.get("video_object_name")
                            or scene.get("section_start") is None):
                        continue
                    try:
                        # 립싱크 씬은 Sync Labs 버전 우선 사용
                        vid_obj = scene.get("video_synclabs_object") or scene["video_object_name"]
                        vid_resp = minio_client.get_object(
                            bucket_name=settings.minio_bucket_images,
                            object_name=vid_obj,
                        )
                        vid_bytes = vid_resp.read()
                        vid_resp.close(); vid_resp.release_conn()

                        with tempfile.TemporaryDirectory() as tmpdir:
                            vid_path = os.path.join(tmpdir, "video.mp4")
                            aud_path = os.path.join(tmpdir, "audio.mp3")
                            out_path = os.path.join(tmpdir, "merged.mp4")

                            with open(vid_path, "wb") as f:
                                f.write(vid_bytes)
                            with open(aud_path, "wb") as f:
                                f.write(full_audio_for_merge)

                            start = scene["section_start"]
                            end = scene["section_end"]

                            ffmpeg_bin = _get_ffmpeg_path() or "ffmpeg"

                            # Generate lyrics subtitle for this scene (v43: has_subtitles 가드, lyric_timestamps backward-shim)
                            timestamps = None
                            if scene.get("lyrics_segment") and (job.get("has_subtitles") or _read_lyric_timestamps(job)):
                                _ws = _read_lyric_timestamps(job)
                                timestamps = _get_scene_timestamps(_ws, float(start), float(end))
                            ass_content = generate_scene_lyrics_ass(scene, timestamps=timestamps)

                            if ass_content:
                                ass_path = os.path.join(tmpdir, "lyrics.ass")
                                with open(ass_path, "w", encoding="utf-8") as f:
                                    f.write(ass_content)
                                # Re-encode with subtitle burn-in
                                escaped_ass = ass_path.replace("\\", "/").replace(":", "\\:")
                                subprocess.run(
                                    [ffmpeg_bin, "-y",
                                     "-i", vid_path,
                                     "-ss", str(start), "-to", str(end), "-i", aud_path,
                                     "-vf", "ass={}".format(escaped_ass),
                                     "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                                     "-c:a", "aac",
                                     "-map", "0:v:0", "-map", "1:a:0",
                                     "-shortest", out_path],
                                    capture_output=True, timeout=60,
                                )
                            else:
                                # No lyrics — stream copy (fast)
                                subprocess.run(
                                    [ffmpeg_bin, "-y",
                                     "-i", vid_path,
                                     "-ss", str(start), "-to", str(end), "-i", aud_path,
                                     "-c:v", "copy", "-c:a", "aac",
                                     "-map", "0:v:0", "-map", "1:a:0",
                                     "-shortest", out_path],
                                    capture_output=True, timeout=30,
                                )

                            if os.path.exists(out_path):
                                with open(out_path, "rb") as f:
                                    merged = f.read()
                                merged_obj = "mv/{}/scenes/{:03d}_video_audio.mp4".format(
                                    str(job_id), scene["scene_number"],
                                )
                                minio_client.put_object(
                                    bucket_name=settings.minio_bucket_images,
                                    object_name=merged_obj,
                                    data=io.BytesIO(merged),
                                    length=len(merged),
                                    content_type="video/mp4",
                                )
                                scenes[i]["video_with_audio_object"] = merged_obj
                    except Exception as merge_err:
                        logger.warning(
                            "Phase3.6: scene %d merge failed: %s",
                            scene.get("scene_number", i), str(merge_err)[:200],
                        )

                await _update_job(mongo_db, job_id, {"scenes": scenes})
                logger.info("Phase3.6: audio merge completed for job %s", job_id)
            else:
                logger.info("Phase3.6: no audio available, skipping audio merge")
        except Exception as merge_phase_err:
            logger.warning("Phase3.6: audio merge phase failed: %s", str(merge_phase_err)[:200])

        await run_phase4_concatenate(job_id, mongo_db)
    else:
        # Not all done — set to videos_ready so user can see progress
        await _update_job(mongo_db, job_id, {
            "scenes": scenes,
            "completed_video_count": completed_video_count,
            "progress": 85,
            "status": "videos_ready",
            "retry_info": None,
        })


# ── Phase 4: Concatenate videos ──────────────────────────────────────────────


async def run_phase4_concatenate(job_id, mongo_db) -> None:
    """Download clips, concatenate, upload final."""
    job = await _get_job(mongo_db, job_id)
    if not job:
        logger.error("Phase4: job %s not found", job_id)
        return

    scenes = job.get("scenes", [])
    completed_scenes = [
        s for s in scenes
        if s.get("video_status") == "completed" and s.get("video_object_name")
    ]

    if not completed_scenes:
        await _update_job(mongo_db, job_id, {
            "status": "failed",
            "error_message": "합칠 완료된 비디오가 없습니다.",
        })
        return

    await _update_job(mongo_db, job_id, {
        "status": "concatenating",
        "progress": 90,
    })

    # Sort by scene_number
    completed_scenes.sort(key=lambda s: s.get("scene_number", 0))

    minio_client = get_minio()
    tmpdir = tempfile.mkdtemp(prefix="mv_concat_")

    try:
        # Download all completed video clips (prefer Sync Labs version for lipsync scenes)
        video_paths = []
        for scene in completed_scenes:
            sn = scene["scene_number"]
            local_path = os.path.join(tmpdir, "scene_{:03d}.mp4".format(sn))
            # 립싱크 씬은 Sync Labs 결과물 우선 사용
            video_obj = scene["video_object_name"]
            if scene.get("video_synclabs_object"):
                video_obj = scene["video_synclabs_object"]
                logger.info("Phase4: scene %d using Sync Labs version", sn)
            try:
                resp = minio_client.get_object(
                    bucket_name=settings.minio_bucket_images,
                    object_name=video_obj,
                )
                with open(local_path, "wb") as f:
                    for chunk in resp.stream(32 * 1024):
                        f.write(chunk)
                resp.close()
                resp.release_conn()
                video_paths.append(local_path)
            except Exception as e:
                logger.warning(
                    "Phase4: failed to download scene %d video: %s", sn, e
                )

        if not video_paths:
            await _update_job(mongo_db, job_id, {
                "status": "failed",
                "error_message": "비디오 다운로드에 실패했습니다.",
            })
            return

        if len(video_paths) == 1:
            final_path = video_paths[0]
        else:
            ffmpeg_path = _get_ffmpeg_path()
            if not ffmpeg_path:
                await _update_job(mongo_db, job_id, {
                    "status": "failed",
                    "error_message": "ffmpeg가 설치되어 있지 않아 비디오를 합칠 수 없습니다.",
                })
                return

            final_path = os.path.join(tmpdir, "final.mp4")
            try:
                await concatenate_videos(video_paths, final_path)
            except Exception as e:
                logger.error("Phase4: concatenation failed: %s", e)
                await _update_job(mongo_db, job_id, {
                    "status": "failed",
                    "error_message": "비디오 합치기 실패: {}".format(str(e)[:300]),
                })
                return

        # Trim final video to audio duration if available
        audio_duration = job.get("audio_duration_sec")
        if audio_duration and audio_duration > 0:
            trimmed_path = os.path.join(tmpdir, "final_trimmed.mp4")
            ffmpeg_path = _get_ffmpeg_path()
            proc = await asyncio.create_subprocess_exec(
                ffmpeg_path, "-y", "-i", final_path,
                "-t", str(audio_duration),
                "-c", "copy", trimmed_path,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            _, stderr = await proc.communicate()
            if proc.returncode == 0:
                final_path = trimmed_path
            else:
                logger.warning(
                    "Phase4: trim failed (returncode %d), using untrimmed: %s",
                    proc.returncode, stderr.decode()[:300],
                )

        # Upload final video to MinIO
        final_object = "mv/{}/final.mp4".format(str(job_id))
        with open(final_path, "rb") as f:
            video_data = f.read()

        minio_client.put_object(
            bucket_name=settings.minio_bucket_images,
            object_name=final_object,
            data=io.BytesIO(video_data),
            length=len(video_data),
            content_type="video/mp4",
        )

        await _update_job(mongo_db, job_id, {
            "status": "video_ready",
            "progress": 95,
            "result_video_url": final_object,
        })

        logger.info("Phase4: job %s concatenation completed", job_id)

    except Exception as e:
        logger.error("Phase4: unexpected error for job %s: %s", job_id, e)
        await _update_job(mongo_db, job_id, {
            "status": "failed",
            "error_message": "예상치 못한 오류: {}".format(str(e)[:300]),
        })
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


# ── Phase 5: Merge audio with video ──────────────────────────────────────────


async def run_phase5_merge_audio(job_id, mongo_db, audio_object_name: str) -> None:
    """Download final video + audio, merge with ffmpeg, upload result."""
    job = await _get_job(mongo_db, job_id)
    if not job:
        logger.error("Phase5: job %s not found", job_id)
        return

    video_object_name = job.get("result_video_url")
    if not video_object_name:
        await _update_job(mongo_db, job_id, {
            "status": "failed",
            "error_message": "합칠 영상 파일이 없습니다.",
        })
        return

    await _update_job(mongo_db, job_id, {
        "status": "merging_audio",
        "progress": 96,
    })

    minio_client = get_minio()
    tmpdir = tempfile.mkdtemp(prefix="mv_merge_")

    try:
        # Download video
        video_path = os.path.join(tmpdir, "video.mp4")
        try:
            resp = minio_client.get_object(
                bucket_name=settings.minio_bucket_images,
                object_name=video_object_name,
            )
            with open(video_path, "wb") as f:
                for chunk in resp.stream(32 * 1024):
                    f.write(chunk)
            resp.close()
            resp.release_conn()
        except Exception as e:
            logger.error("Phase5: failed to download video: %s", e)
            await _update_job(mongo_db, job_id, {
                "status": "video_ready",
                "error_message": "영상 다운로드 실패: {}".format(str(e)[:300]),
            })
            return

        # Download audio (audio files are in the music bucket, not images)
        audio_path = os.path.join(tmpdir, "audio.mp3")
        try:
            resp = minio_client.get_object(
                bucket_name=settings.minio_bucket_music,
                object_name=audio_object_name,
            )
            with open(audio_path, "wb") as f:
                for chunk in resp.stream(32 * 1024):
                    f.write(chunk)
            resp.close()
            resp.release_conn()
        except Exception as e:
            logger.error("Phase5: failed to download audio: %s", e)
            await _update_job(mongo_db, job_id, {
                "status": "video_ready",
                "error_message": "오디오 다운로드 실패: {}".format(str(e)[:300]),
            })
            return

        # Merge with ffmpeg
        ffmpeg_path = _get_ffmpeg_path()
        if not ffmpeg_path:
            await _update_job(mongo_db, job_id, {
                "status": "video_ready",
                "error_message": "ffmpeg가 설치되어 있지 않아 합칠 수 없습니다.",
            })
            return

        # Generate karaoke-style lyrics subtitle (v43: lyric_timestamps backward-shim, has_subtitles guard)
        scenes = job.get("scenes", [])
        all_timestamps: dict[int, list[dict]] = {}
        _ws = _read_lyric_timestamps(job) if (job.get("has_subtitles") or job.get("lyric_timestamps") or job.get("whisper_segments")) else []
        if _ws:
            for s_idx, sc in enumerate(scenes):
                if not sc.get("lyrics_segment") or not sc.get("lyrics_segment", "").strip():
                    continue
                s_start = sc.get("section_start")
                s_end = sc.get("section_end")
                if s_start is None or s_end is None:
                    continue
                scene_ts = _get_scene_timestamps(_ws, float(s_start), float(s_end))
                if scene_ts:
                    all_timestamps[s_idx] = scene_ts

        ass_content = generate_lyrics_ass(scenes, all_timestamps=all_timestamps if all_timestamps else None)
        ass_path = os.path.join(tmpdir, "lyrics.ass")
        has_lyrics = False
        if ass_content:
            with open(ass_path, "w", encoding="utf-8") as f:
                f.write(ass_content)
            has_lyrics = True
            logger.info("Phase5: generated lyrics subtitle for job %s", job_id)

        output_path = os.path.join(tmpdir, "music_video.mp4")

        if has_lyrics:
            # Subtitle burn-in requires re-encoding video
            proc = await asyncio.create_subprocess_exec(
                ffmpeg_path, "-y",
                "-i", video_path,
                "-i", audio_path,
                "-vf", "ass={}".format(ass_path.replace("\\", "/").replace(":", "\\:")),
                "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                "-c:a", "aac",
                "-shortest",
                output_path,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        else:
            # No lyrics — copy video stream as-is
            proc = await asyncio.create_subprocess_exec(
                ffmpeg_path, "-y",
                "-i", video_path,
                "-i", audio_path,
                "-c:v", "copy",
                "-c:a", "aac",
                "-shortest",
                output_path,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        _, stderr = await proc.communicate()

        if proc.returncode != 0:
            error_msg = stderr.decode()[:300] if stderr else "알 수 없는 오류"
            logger.error("Phase5: ffmpeg merge failed: %s", error_msg)
            await _update_job(mongo_db, job_id, {
                "status": "video_ready",
                "error_message": "음악 합치기 실패: {}".format(error_msg),
            })
            return

        # Upload merged video to MinIO
        merged_object = "mv/{}/music_video.mp4".format(str(job_id))
        with open(output_path, "rb") as f:
            video_data = f.read()

        minio_client.put_object(
            bucket_name=settings.minio_bucket_images,
            object_name=merged_object,
            data=io.BytesIO(video_data),
            length=len(video_data),
            content_type="video/mp4",
        )

        await _update_job(mongo_db, job_id, {
            "status": "completed",
            "progress": 100,
            "result_music_video_url": merged_object,
        })

        logger.info("Phase5: job %s audio merge completed", job_id)

    except Exception as e:
        logger.error("Phase5: unexpected error for job %s: %s", job_id, e)
        await _update_job(mongo_db, job_id, {
            "status": "video_ready",
            "error_message": "예상치 못한 오류: {}".format(str(e)[:300]),
        })
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


# ─────────────────────────────────────────────────────────────────────────────
# v51 — Scene-level partial cascade helpers
# ─────────────────────────────────────────────────────────────────────────────
#
# 사용자 편집(PATCH) 후 트리거되는 부분 cascade. 씬 단위로만 작동한다.
#
#   description  → image_prompt → image → video_prompt
#   image_prompt → image → video_prompt
#   video_prompt → (no cascade)
#
# 사용자가 PATCH 한 필드는 scene.user_edited_fields 에 누적되며, cascade 진행 시
# 그 필드는 자동 재계산을 건너뛴다 (사용자 의도 보존). cascade 가 자동으로 어떤
# 필드를 재계산하면 user_edited_fields 에서 그 필드를 제거한다.
#
# 영상 폐기는 마킹만 (video_status="invalidated_by_cascade"). MinIO 파일 즉시
# 삭제 X — 롤백 가능성 위해 보존.

import uuid as _uuid_v51


async def _v51_get_scene_idx(mongo_db, job_oid, scene_number: int) -> Optional[int]:
    job = await mongo_db.mv_jobs.find_one({"_id": job_oid}, {"scenes": 1})
    if not job:
        return None
    for i, s in enumerate(job.get("scenes", [])):
        if s.get("scene_number") == scene_number:
            return i
    return None


async def _v51_set_scene_fields(mongo_db, job_oid, scene_idx: int, fields: dict) -> None:
    """Set arbitrary fields on scenes[scene_idx] via positional $set."""
    update = {"updated_at": datetime.utcnow()}
    for k, v in fields.items():
        update["scenes.{}.{}".format(scene_idx, k)] = v
    await mongo_db.mv_jobs.update_one({"_id": job_oid}, {"$set": update})


async def _v51_get_scene(mongo_db, job_oid, scene_idx: int) -> Optional[dict]:
    job = await mongo_db.mv_jobs.find_one({"_id": job_oid}, {"scenes": 1})
    if not job:
        return None
    scenes = job.get("scenes") or []
    if scene_idx < 0 or scene_idx >= len(scenes):
        return None
    return scenes[scene_idx]


async def _v51_is_user_edited(mongo_db, job_oid, scene_idx: int, field: str) -> bool:
    """v51 호환 wrapper. v54: 내부적으로 _v54_is_field_user_edited 통합 헬퍼에 위임.

    v54 통합 — scene-level 직접 조회 대신 통합 함수 호출. 동작은 동일.
    """
    job = await mongo_db.mv_jobs.find_one({"_id": job_oid}, {"scenes": 1})
    if not job:
        return False
    return _v54_is_field_user_edited(job, "scene", scene_idx, field)


# ─────────────────────────────────────────────────────────────────────────────
# v54 — user_edited_fields 보존 정책 통합 헬퍼
#
# 3 레벨 (씬 / event / scenario top-level) 의 user_edited_fields 체크를 1개
# 함수로 통일. v51/v52/v53 cascade 헬퍼들이 이 함수 호출하여 일관 분기.
#
# 옛 도큐먼트 (필드 자체 없음) → False 안전 반환.
# ─────────────────────────────────────────────────────────────────────────────


def _v54_is_field_user_edited(job: dict, scope: str, target: Optional[int], field: str) -> bool:
    """3 레벨 통합 user_edited_fields 체크.

    Args:
        job: Mongo mv_jobs 도큐먼트 (이미 fetch 한 상태).
        scope: "scene" | "event" | "scenario".
        target: scope="scene" → scene_idx (0-based). scope="event" → event_idx (0-based, =order-1). scope="scenario" → None.
        field: 필드명.

    Returns:
        True — 사용자가 직접 편집한 필드. False — 그 외 (옛 도큐먼트 / 범위 초과 / scope 오류 모두 안전 처리).
    """
    if not isinstance(job, dict):
        return False

    result = False
    try:
        if scope == "scene":
            scenes = job.get("scenes") or []
            if isinstance(target, int) and 0 <= target < len(scenes):
                edited = scenes[target].get("user_edited_fields") or []
                result = field in edited
        elif scope == "event":
            events = job.get("scenario_events") or []
            if isinstance(target, int) and 0 <= target < len(events):
                edited = events[target].get("user_edited_fields") or []
                result = field in edited
        elif scope == "scenario":
            edited = job.get("scenario_user_edited_fields") or []
            result = field in edited
    except Exception:
        result = False

    logger.debug(
        "[V54FieldCheck] scope=%s target=%s field=%s edited=%s",
        scope, target, field, result,
    )
    return result


async def _v51_remove_user_edited_field(mongo_db, job_oid, scene_idx: int, field: str) -> None:
    scene = await _v51_get_scene(mongo_db, job_oid, scene_idx)
    if not scene:
        return
    edited = list(scene.get("user_edited_fields") or [])
    if field in edited:
        edited = [f for f in edited if f != field]
        await _v51_set_scene_fields(mongo_db, job_oid, scene_idx, {"user_edited_fields": edited})


async def _v51_check_cancel(mongo_db, job_oid, scene_idx: int) -> bool:
    scene = await _v51_get_scene(mongo_db, job_oid, scene_idx)
    if not scene:
        return True  # disappeared → treat as cancelled
    return bool(scene.get("cancel_requested"))


async def _v51_invalidate_video(mongo_db, job_oid, scene_idx: int, scene_number: int) -> None:
    """B5 — image 가 cascade 로 갱신되었을 때 그 씬의 영상을 마킹만 으로 폐기.

    MinIO 파일은 삭제하지 않는다 (롤백 가능성).
    """
    await _v51_set_scene_fields(mongo_db, job_oid, scene_idx, {
        "video_status": "invalidated_by_cascade",
        "video_object_name": None,
        "video_with_audio_object": None,
        "video_synclabs_object": None,
        "video_with_audio_synclabs_object": None,
        "video_error": None,
    })
    logger.warning("[CascadeVideoInvalidate] job=%s scene=%d", job_oid, scene_number)


async def _v51_regen_image_prompt_single(job: dict, scene_idx: int) -> Optional[dict]:
    """Phase 1b 의 단일 씬 변형. generate_scene_prompts_only 를 1-element list 로 호출.

    Returns: prompts dict {"scene_number", "image_prompt", "video_image_prompt", ...} or None on failure.
    """
    from .mv_generator import generate_scene_prompts_only

    scenes = job.get("scenes", [])
    if scene_idx < 0 or scene_idx >= len(scenes):
        return None
    s = scenes[scene_idx]

    scene_input = [{
        "scene_number": s.get("scene_number"),
        "section": s.get("section", ""),
        "duration": float(s.get("use_seconds") or 5.0),
        "lyrics": s.get("lyrics_segment", ""),
        "scene_type": s.get("scene_type", "drama"),
    }]

    _scenario_meta = job.get("scenario_meta") or {}
    asset_keys = (
        list((_scenario_meta.get("characters") or {}).keys())
        + list((_scenario_meta.get("locations") or {}).keys())
    )

    user_location_name = None
    _user_loc_snap = job.get("user_location_snapshot") or None
    if isinstance(_user_loc_snap, dict):
        _ln = (_user_loc_snap.get("name") or "").strip()
        if _ln:
            user_location_name = _ln

    try:
        # Use single model (first of prompt_models, or default OpenAI)
        prompt_models = job.get("prompt_models") or None
        models_arg = [prompt_models[0]] if prompt_models else None
        result = await generate_scene_prompts_only(
            scenes_input=scene_input,
            title=job.get("title", ""),
            genre=job.get("genre"),
            mood=job.get("mood"),
            scenario=job.get("scenario"),
            user_scene_prompt=job.get("scene_prompt"),
            models=models_arg,
            video_model=job.get("video_model", "veo"),
            asset_keys=asset_keys or None,
            location_name=user_location_name,
            narrative=job.get("scenario_narrative"),
            scenario_events=job.get("scenario_events"),
            emotional_core=job.get("scenario_emotional_core"),
            premise=job.get("scenario_premise"),
            character_states=job.get("scenario_character_states"),
        )
    except Exception as e:
        logger.warning("[CascadePhase] phase1b single-scene failed: %s", e)
        return None

    # Result is a list of 1 prompt
    if isinstance(result, dict) and "results" in result:
        # Dual-model result (rare for single-scene single-model call) — flatten
        first = (result.get("results") or [{}])[0]
        prompts = first.get("prompts") or []
    else:
        prompts = result or []

    if not prompts or not isinstance(prompts, list):
        return None
    return prompts[0] if prompts else None


async def _v51_regen_video_prompt_single(job: dict, scene_idx: int) -> Optional[str]:
    """Phase 2.5 의 단일 씬 변형 — 이미 생성된 image 를 읽어 video_prompt 만 재생성."""
    scenes = job.get("scenes", [])
    if scene_idx < 0 or scene_idx >= len(scenes):
        return None
    scene = scenes[scene_idx]
    if not scene.get("image_object_name"):
        return None

    try:
        minio_client = get_minio()
        resp = minio_client.get_object(
            bucket_name=settings.minio_bucket_images,
            object_name=scene["image_object_name"],
        )
        scene_image_bytes = resp.read()
        resp.close()
        resp.release_conn()
    except Exception as e:
        logger.warning("[CascadePhase] phase2.5 image load failed: %s", e)
        return None

    _scenario_events = job.get("scenario_events") or []
    _emotional_core = job.get("scenario_emotional_core") or ""
    _event_for_scene = None
    _ev_idx = scene.get("event_index")
    if isinstance(_ev_idx, int) and 0 <= _ev_idx < len(_scenario_events):
        _event_for_scene = _scenario_events[_ev_idx]

    try:
        video_prompt = await generate_video_prompts_from_images(
            image_bytes=scene_image_bytes,
            image_prompt=scene.get("video_image_prompt") or scene.get("image_prompt", ""),
            scene_type=scene.get("scene_type", "drama"),
            lyrics_segment=scene.get("lyrics_segment", ""),
            scene_number=scene.get("scene_number", scene_idx + 1),
            model=job.get("video_prompt_model") or "gemini-2.5-pro",
            video_model=job.get("video_model", "veo"),
            has_character=bool(job.get("character_object_name")),
            duration=float(scene.get("use_seconds", 5.0)),
            scene_event=_event_for_scene,
            emotional_core=_emotional_core,
        )
        return video_prompt
    except Exception as e:
        logger.warning("[CascadePhase] phase2.5 LLM failed: %s", e)
        return None


async def _v51_run_cascade(job_oid, scene_number: int, mongo_db, trigger_field: str) -> None:
    """Background task: cascade dispatch.

    trigger_field=
      - "description":      phase1b → phase2 → phase2.5
      - "image_prompt":     phase2 → phase2.5
      - "video_prompt":     no-op
      - "description_ko":   translate_to_en → "description" cascade (phase1b → phase2 → phase2.5)
      - "image_prompt_ko":  translate_to_en → "image_prompt" cascade (phase2 → phase2.5)
      - "video_prompt_ko":  translate_to_en → completed (영상 단계는 별도 trigger)
    """
    cascade_id = str(_uuid_v51.uuid4())
    scene_idx = await _v51_get_scene_idx(mongo_db, job_oid, scene_number)
    if scene_idx is None:
        logger.warning("[CascadePhase] job=%s scene=%d not found, skip", job_oid, scene_number)
        return

    # ── v56 — Korean trigger handling (translate_*_to_en phase) ──────────────
    # 한국어 trigger → ko→en 번역 → 영어 필드 갱신 → 대응 영어 trigger 로 위임.
    _V56_KO_TRIGGERS = {
        "description_ko": "description",
        "image_prompt_ko": "image_prompt",
        "video_prompt_ko": "video_prompt",
    }
    if trigger_field in _V56_KO_TRIGGERS:
        en_field = _V56_KO_TRIGGERS[trigger_field]

        # Initialize running state for translation phase
        await _v51_set_scene_fields(mongo_db, job_oid, scene_idx, {
            "cascade_status": "running",
            "cascade_progress": 0,
            "cascade_started_at": datetime.utcnow(),
            "cascade_completed_at": None,
            "cascade_id": cascade_id,
            "cancel_requested": False,
        })
        logger.info(
            "[CascadePhase] job=%s scene=%d phase=translate_%s_to_en cascade_id=%s",
            job_oid, scene_number, en_field, cascade_id,
        )

        scene = await _v51_get_scene(mongo_db, job_oid, scene_idx)
        ko_text = (scene or {}).get(trigger_field, "") or ""
        try:
            from .translation import translate_ko_to_en
            new_en = await translate_ko_to_en(
                ko_text,
                context_hint="MV scene {}".format(en_field.replace("_", " ")),
            )
        except Exception as _tr_err:
            logger.error(
                "[CascadePhase] job=%s scene=%d phase=translate_%s_to_en failed err=%s",
                job_oid, scene_number, en_field, str(_tr_err)[:200],
            )
            await _v51_set_scene_fields(mongo_db, job_oid, scene_idx, {
                "cascade_status": "failed",
                "cascade_completed_at": datetime.utcnow(),
            })
            return

        # Persist translated English field. Mark English as "auto-synced" (remove from
        # user_edited_fields if previously edited there — Korean now the source of truth).
        await _v51_set_scene_fields(mongo_db, job_oid, scene_idx, {en_field: new_en or ""})
        await _v51_remove_user_edited_field(mongo_db, job_oid, scene_idx, en_field)
        logger.info(
            "[CascadePhase] job=%s scene=%d phase=translate_%s_to_en done en_len=%d",
            job_oid, scene_number, en_field, len(new_en or ""),
        )

        # video_prompt_ko → cascade end (영상 단계 X)
        if en_field == "video_prompt":
            await _v51_set_scene_fields(mongo_db, job_oid, scene_idx, {
                "cascade_status": "completed",
                "cascade_progress": 100,
                "cascade_completed_at": datetime.utcnow(),
                "cancel_requested": False,
            })
            logger.info(
                "[CascadePhase] job=%s scene=%d phase=video_prompt_ko_completed",
                job_oid, scene_number,
            )
            return

        # description_ko / image_prompt_ko → delegate to English cascade.
        # 영어가 방금 새로 채워졌으므로 그 영어를 사용자 편집으로 보지 않도록 보장 (위 remove 이미 처리).
        trigger_field = en_field
        # Fall through to the English cascade below (preserving cascade_id for telemetry).

    if trigger_field == "video_prompt":
        # No-op cascade
        await _v51_set_scene_fields(mongo_db, job_oid, scene_idx, {
            "cascade_status": "completed",
            "cascade_progress": 100,
            "cascade_started_at": datetime.utcnow(),
            "cascade_completed_at": datetime.utcnow(),
            "cascade_id": cascade_id,
            "cancel_requested": False,
        })
        logger.info(
            "[CascadePhase] job=%s scene=%d phase=video_prompt_noop", job_oid, scene_number,
        )
        return

    # Initialize running state (English-triggered cascade or after _ko translation phase).
    # When falling through from _ko phase, this $set re-initializes — that's intentional.
    await _v51_set_scene_fields(mongo_db, job_oid, scene_idx, {
        "cascade_status": "running",
        "cascade_progress": 0,
        "cascade_started_at": datetime.utcnow(),
        "cascade_completed_at": None,
        "cascade_id": cascade_id,
        "cancel_requested": False,
    })
    logger.info(
        "[CascadePhase] job=%s scene=%d phase=%s_start cascade_id=%s",
        job_oid, scene_number, trigger_field, cascade_id,
    )

    try:
        # ── Phase 1b (only for trigger_field == "description") ───────────
        if trigger_field == "description":
            if await _v51_check_cancel(mongo_db, job_oid, scene_idx):
                await _v51_finalize_cancelled(mongo_db, job_oid, scene_idx, scene_number)
                return

            if await _v51_is_user_edited(mongo_db, job_oid, scene_idx, "image_prompt"):
                logger.info(
                    "[CascadePhase] job=%s scene=%d phase=phase1b_skip_user_edited",
                    job_oid, scene_number,
                )
            else:
                logger.info(
                    "[CascadePhase] job=%s scene=%d phase=phase1b_enter", job_oid, scene_number,
                )
                job = await _get_job(mongo_db, job_oid)
                if not job:
                    return
                p = await _v51_regen_image_prompt_single(job, scene_idx)
                if p:
                    # v56 — also capture image_prompt_ko from Phase 1b LLM output (best-effort);
                    # if LLM omitted ko, we'll translate from the new English prompt below.
                    new_image_prompt_en = p.get("image_prompt", "") or ""
                    new_image_prompt_ko = p.get("image_prompt_ko", "") or ""
                    if new_image_prompt_en and not new_image_prompt_ko:
                        try:
                            from .translation import translate_en_to_ko
                            new_image_prompt_ko = await translate_en_to_ko(
                                new_image_prompt_en, context_hint="MV scene image prompt",
                            )
                            logger.info(
                                "[TranslateEnKo] new image_prompt_ko scene=%d len=%d",
                                scene_number, len(new_image_prompt_ko or ""),
                            )
                        except Exception as _tr_err:
                            logger.warning(
                                "[TranslateEnKo] phase1b_post failed scene=%d err=%s",
                                scene_number, str(_tr_err)[:200],
                            )
                            new_image_prompt_ko = ""
                    await _v51_set_scene_fields(mongo_db, job_oid, scene_idx, {
                        "image_prompt": new_image_prompt_en,
                        "video_image_prompt": p.get("video_image_prompt", "") or "",
                        "description_ko": p.get("description_ko", ""),
                        "image_prompt_ko": new_image_prompt_ko,
                    })
                    # cascade auto-regenerated → remove from user_edited_fields
                    await _v51_remove_user_edited_field(mongo_db, job_oid, scene_idx, "image_prompt")
                    # v56 — image_prompt_ko also auto-synced → drop from user_edited_fields
                    await _v51_remove_user_edited_field(mongo_db, job_oid, scene_idx, "image_prompt_ko")

            await _v51_set_scene_fields(mongo_db, job_oid, scene_idx, {"cascade_progress": 33})

        # ── Phase 2 (image regenerate) — always runs for description / image_prompt
        if await _v51_check_cancel(mongo_db, job_oid, scene_idx):
            await _v51_finalize_cancelled(mongo_db, job_oid, scene_idx, scene_number)
            return

        logger.info(
            "[CascadePhase] job=%s scene=%d phase=phase2_enter", job_oid, scene_number,
        )
        # Run phase2_images for this single scene
        await run_phase2_images(job_oid, mongo_db, scene_numbers=[scene_number])

        progress_after_phase2 = 66 if trigger_field == "description" else 50
        await _v51_set_scene_fields(mongo_db, job_oid, scene_idx, {
            "cascade_progress": progress_after_phase2,
        })

        # ── B5: image changed → invalidate video ─────────────────────────
        await _v51_invalidate_video(mongo_db, job_oid, scene_idx, scene_number)

        # ── Phase 2.5 (video_prompt regenerate) ──────────────────────────
        if await _v51_check_cancel(mongo_db, job_oid, scene_idx):
            await _v51_finalize_cancelled(mongo_db, job_oid, scene_idx, scene_number)
            return

        if await _v51_is_user_edited(mongo_db, job_oid, scene_idx, "video_prompt"):
            logger.info(
                "[CascadePhase] job=%s scene=%d phase=phase2_5_skip_user_edited",
                job_oid, scene_number,
            )
        else:
            logger.info(
                "[CascadePhase] job=%s scene=%d phase=phase2_5_enter", job_oid, scene_number,
            )
            job = await _get_job(mongo_db, job_oid)
            if job:
                vp = await _v51_regen_video_prompt_single(job, scene_idx)
                if vp:
                    # v56 — auto-translate new English video_prompt to Korean (sibling sync).
                    new_vp_ko = ""
                    try:
                        from .translation import translate_en_to_ko
                        new_vp_ko = await translate_en_to_ko(
                            vp, context_hint="MV scene video prompt",
                        )
                        logger.info(
                            "[TranslateEnKo] new video_prompt_ko scene=%d len=%d",
                            scene_number, len(new_vp_ko or ""),
                        )
                    except Exception as _tr_err:
                        logger.warning(
                            "[TranslateEnKo] cascade_phase2_5 failed scene=%d err=%s",
                            scene_number, str(_tr_err)[:200],
                        )
                    await _v51_set_scene_fields(mongo_db, job_oid, scene_idx, {
                        "video_prompt": vp,
                        "video_prompt_ko": new_vp_ko,
                    })
                    await _v51_remove_user_edited_field(mongo_db, job_oid, scene_idx, "video_prompt")
                    await _v51_remove_user_edited_field(mongo_db, job_oid, scene_idx, "video_prompt_ko")

        await _v51_set_scene_fields(mongo_db, job_oid, scene_idx, {
            "cascade_status": "completed",
            "cascade_progress": 100,
            "cascade_completed_at": datetime.utcnow(),
        })
        logger.info(
            "[CascadePhase] job=%s scene=%d phase=completed", job_oid, scene_number,
        )

    except Exception as e:
        logger.error(
            "[CascadePhase] job=%s scene=%d phase=failed err=%s",
            job_oid, scene_number, str(e)[:300],
        )
        await _v51_set_scene_fields(mongo_db, job_oid, scene_idx, {
            "cascade_status": "failed",
            "cascade_completed_at": datetime.utcnow(),
        })


async def _v51_finalize_cancelled(mongo_db, job_oid, scene_idx: int, scene_number: int) -> None:
    await _v51_set_scene_fields(mongo_db, job_oid, scene_idx, {
        "cascade_status": "cancelled",
        "cascade_completed_at": datetime.utcnow(),
        "cancel_requested": False,
    })
    logger.info(
        "[CascadePhase] job=%s scene=%d phase=cancelled", job_oid, scene_number,
    )


# ─────────────────────────────────────────────────────────────────────────────
# v52 — 시나리오 events 단위 부분 수정 + 매핑 씬 cascade
#
# 사용자는 시나리오 패널의 events 카드 안 5개 필드 (trigger / protagonist_action /
# motivation / emotion_shift / props) 를 부분 수정한다. PATCH 가 Mongo 의
# scenario_events[i] 를 즉시 갱신하면, 그 event 에 매핑된 (scene.event_index === i)
# 모든 씬에 대해 v51 의 cascade ("description" 트리거) 를 순차 실행한다.
#
# 핵심 단순화:
#   v51 의 _v51_run_cascade(trigger_field="description") 가 phase1b → phase2 → phase2.5
#   를 모두 처리한다. phase1b (image_prompt 재생성) 안의 generate_scene_prompts_only
#   는 이미 Mongo 의 갱신된 scenario_events 를 읽기 때문에 별도 Phase 1 LLM 호출
#   없이도 변경된 event 컨텍스트가 반영된다. 따라서 v52 는 "B3 wrapper" 안에서
#   추가 LLM 호출 없이 직접 v51 cascade 를 wrapping 한다.
#
#   단, scene.user_edited_fields 에 "description" 이 있으면 사용자 의도 보존을 위해
#   그 씬의 cascade 를 통째로 skip 한다 (description 보존 + 후속도 의미 없음).
#
# 추적자: [EventCascade] / [CascadePhase] (v51 재사용) / [EventCascadeCancel]
# ─────────────────────────────────────────────────────────────────────────────


async def _v52_get_affected_scenes(mongo_db, job_oid, event_order: int) -> List[int]:
    """event_order (1-based) 에 매핑된 씬 번호 list.

    매핑은 scene.event_index === event_order - 1.
    옛 도큐먼트 (event_index 키 누락) 는 자동 제외 + warning 로그.
    """
    job = await mongo_db.mv_jobs.find_one({"_id": job_oid}, {"scenes": 1})
    if not job:
        return []
    scenes = job.get("scenes") or []
    affected = []
    missing = 0
    for s in scenes:
        ev_idx = s.get("event_index")
        if ev_idx is None:
            missing += 1
            continue
        if isinstance(ev_idx, int) and ev_idx == event_order - 1:
            sn = s.get("scene_number")
            if isinstance(sn, int):
                affected.append(sn)
    if missing:
        logger.warning(
            "[EventCascade] missing event_index — skipping cascade for %d scenes (legacy doc)",
            missing,
        )
    return affected


async def _v52_event_cascade(job_oid, event_order: int, mongo_db) -> None:
    """v52 백그라운드 헬퍼 — event 에 매핑된 모든 씬에 대해 v51 cascade 순차 실행.

    매핑된 씬 0개 → 즉시 종료 + warning 로그.
    각 씬에 대해:
      - scene.user_edited_fields 에 "description" 있으면 그 씬은 skip + 로그.
      - 그렇지 않으면 _v51_run_cascade(scene_number, "description") 호출.
        (Phase 1b 재호출 시 generate_scene_prompts_only 가 갱신된 scenario_events
        를 다시 읽으므로 변경된 event 컨텍스트가 자동 반영됨.)
    """
    affected = await _v52_get_affected_scenes(mongo_db, job_oid, event_order)
    if not affected:
        logger.warning(
            "[EventCascade] job=%s event_order=%d affected_scenes=[] (no mapped scenes)",
            str(job_oid), event_order,
        )
        return

    logger.info(
        "[EventCascade] job=%s event_order=%d affected_scenes=%s",
        str(job_oid), event_order, affected,
    )

    for scene_number in affected:
        scene_idx = await _v51_get_scene_idx(mongo_db, job_oid, scene_number)
        if scene_idx is None:
            logger.warning(
                "[EventCascade] missing scene_idx — skipping cascade scene=%d",
                scene_number,
            )
            continue

        # description 보존 — 사용자가 직접 description 을 편집했으면 cascade 자체 skip.
        if await _v51_is_user_edited(mongo_db, job_oid, scene_idx, "description"):
            logger.info(
                "[CascadePhase] job=%s scene=%d phase=phase1_partial_skip_user_edited",
                str(job_oid), scene_number,
            )
            # 그래도 cascade_status 는 "completed" 로 마킹 (skipped 처럼 인식되도록)
            await _v51_set_scene_fields(mongo_db, job_oid, scene_idx, {
                "cascade_status": "completed",
                "cascade_progress": 100,
                "cascade_started_at": datetime.utcnow(),
                "cascade_completed_at": datetime.utcnow(),
                "cancel_requested": False,
            })
            continue

        # Phase 1 (description) — 갱신된 events 가 Mongo 에 이미 있으므로 별도 LLM 호출
        # 없이 v51 cascade 진입. v51 cascade 안의 phase1b 가 그 events 를 다시 읽는다.
        logger.info(
            "[CascadePhase] job=%s scene=%d phase=phase1_partial",
            str(job_oid), scene_number,
        )
        try:
            await _v51_run_cascade(job_oid, scene_number, mongo_db, "description")
        except Exception as e:
            logger.error(
                "[EventCascade] cascade failed scene=%d err=%s",
                scene_number, str(e)[:300],
            )
            # 다음 씬은 계속 진행


async def _v52_cancel_event_cascade(mongo_db, job_oid, event_order: int) -> List[int]:
    """v52 — event 에 매핑된 모든 씬에 일괄 cancel_requested=True.

    이미 idle/completed 인 씬은 변경 없음 (idempotent). 응답으로 cancel 신호를
    실제로 보낸 씬 목록 반환.
    """
    affected = await _v52_get_affected_scenes(mongo_db, job_oid, event_order)
    cancelled = []
    for scene_number in affected:
        scene_idx = await _v51_get_scene_idx(mongo_db, job_oid, scene_number)
        if scene_idx is None:
            continue
        scene = await _v51_get_scene(mongo_db, job_oid, scene_idx)
        if not scene:
            continue
        cur_status = scene.get("cascade_status") or "idle"
        if cur_status == "running":
            await _v51_set_scene_fields(mongo_db, job_oid, scene_idx, {"cancel_requested": True})
            cancelled.append(scene_number)
    logger.info(
        "[EventCascadeCancel] job=%s event_order=%d cancelled_scenes=%s",
        str(job_oid), event_order, cancelled,
    )
    return cancelled


# ─────────────────────────────────────────────────────────────────────────────
# v53 — 시나리오 상위 편집 + events 추가/삭제 + 전체 cascade
#
# 사용자는 시나리오 패널에서 narrative / premise / character_states /
# central_conflict / emotional_core / narrative_arc (상위 6 필드) + events 배열을
# 한 번에 편집한다. PATCH 가 Mongo 의 `scenario_<field>` 또는 `scenario_events` 를
# 즉시 갱신하면, [전체 저장 + 모든 씬 재생성] 버튼을 눌러 전체 cascade 를 시작한다.
#
# Phase 흐름:
#   Phase 0 (선택)  events 보강 — narrative 만 사용자 편집한 케이스에서 events 만 LLM
#                  재추출. 사용자가 events 도 직접 편집했으면 skip.
#   Phase 1        씬 분할 — run_phase1_split 재호출 (Phase 0 안의 시나리오 LLM 호출은
#                  이미 scenario 가 존재하므로 자동 skip). 옛 scenes 는 scenes_archive 에 보관.
#   Phase 1b       씬별 image_prompt 생성 — run_phase1_split 안에 포함됨.
#   Phase 2        씬별 image 재생성 — run_phase2_images.
#   Phase 2.5      씬별 video_prompt 재생성 — _v51_regen_video_prompt_single loop.
#   Phase Final    영상 폐기 — _v51_invalidate_video loop (마킹만, MinIO 파일 보존).
#
# 각 phase 진입 시 cancel_requested 체크. True 면 cascade_status="cancelled" 마감.
#
# 추적자: [ScenarioCascade] (전체) / [CascadePhase] (씬 단위, v51 재사용) /
#         [CascadeVideoInvalidate] (v51 재사용)
# ─────────────────────────────────────────────────────────────────────────────


_V53_PHASE_PROGRESS = {
    "events_extract": 16,
    "scene_split": 33,
    "scene_image_prompt": 50,
    "scene_image": 75,
    "scene_video_prompt": 90,
    "video_invalidate": 100,
}


async def _v53_set_cascade(mongo_db, job_oid, fields: dict) -> None:
    """job-level cascade_* 필드 일괄 갱신."""
    update = {"updated_at": datetime.utcnow()}
    for k, v in fields.items():
        update[k] = v
    await mongo_db.mv_jobs.update_one({"_id": job_oid}, {"$set": update})


async def _v53_is_cancelled(mongo_db, job_oid) -> bool:
    """job-level cancel_requested 체크 (전체 cascade 용)."""
    doc = await mongo_db.mv_jobs.find_one({"_id": job_oid}, {"cancel_requested": 1})
    return bool(doc and doc.get("cancel_requested"))


async def _v53_finalize_cancelled(mongo_db, job_oid) -> None:
    await _v53_set_cascade(mongo_db, job_oid, {
        "cascade_phase": "cancelled",
        "cascade_completed_at": datetime.utcnow(),
        "cancel_requested": False,
    })
    logger.info("[ScenarioCascade] job=%s phase=cancelled", str(job_oid))


async def _v53_finalize_failed(mongo_db, job_oid, err: str) -> None:
    await _v53_set_cascade(mongo_db, job_oid, {
        "cascade_phase": "failed",
        "cascade_completed_at": datetime.utcnow(),
        "cascade_error": str(err)[:300],
    })
    logger.error("[ScenarioCascade] job=%s phase=failed err=%s", str(job_oid), str(err)[:300])


async def _v53_extract_events_only(job: dict, mongo_db, job_oid) -> bool:
    """B7 — narrative 가 사용자 편집된 상태에서, events 만 LLM 재추출.

    기존 generate_mv_scenario (Stage 2) 를 strict=False 로 1회 호출하여 result dict
    에서 `events` 만 채택, 나머지 필드 (narrative/premise/character_states 등) 는
    사용자 입력 그대로 유지 (출력 무시). 검증 실패 시 False 반환 (cascade 실패 마킹은
    호출자에서 결정).

    Returns:
        True — events 갱신 성공. False — LLM 호출 실패 또는 검증 실패.
    """
    from .mv_generator import generate_mv_scenario, RetryableScenarioError

    # 기존 generate_mv_scenario 의 입력 매개변수 재구성
    snapshot = job.get("user_character_snapshot") or None
    character1_meta = None
    if isinstance(snapshot, dict):
        character1_meta = {
            "name": snapshot.get("name") or "",
            "age": snapshot.get("age") or "",
            "personality_tags": snapshot.get("personality_tags") or [],
            "personality_text": snapshot.get("personality_text") or "",
        }

    user_loc_snap = job.get("user_location_snapshot") or None
    user_location_name = None
    if isinstance(user_loc_snap, dict):
        _ln = (user_loc_snap.get("name") or "").strip()
        if _ln:
            user_location_name = _ln

    audio_duration_sec = None
    try:
        if job.get("audio_duration_sec") is not None:
            audio_duration_sec = float(job["audio_duration_sec"])
    except Exception:
        audio_duration_sec = None

    has_user_character = bool(job.get("character_object_name"))
    scenario_models = job.get("scenario_models")

    # 한 번 호출 + soft (strict=False) 으로 RetryableScenarioError 도 events 가 비어도 통과 가능
    for attempt in range(2):
        try:
            logger.info(
                "[ScenarioCascade] events_extract attempt=%d strict=False", attempt + 1,
            )
            result = await generate_mv_scenario(
                title=job.get("title", ""),
                genre=job.get("genre"),
                mood=job.get("mood"),
                lyrics=job.get("lyrics"),
                character_name=job.get("character_name"),
                models=scenario_models,
                scenario_style=job.get("scenario_style", "drama") or "drama",
                vocal_gender=job.get("vocal_gender"),
                relationship=job.get("relationship"),
                has_user_character=has_user_character,
                has_cover_person=False,
                character1_meta=character1_meta,
                location_name=user_location_name,
                brainstorm_candidates=job.get("scenario_brainstorm") or None,
                audio_duration_sec=audio_duration_sec,
                user_event_seed=job.get("user_event_seed"),
                temperature=0.85,
                strict=False,
            )

            # dual-model results 는 첫 번째 만 사용 (cascade 단순화)
            if isinstance(result, dict) and "results" in result:
                first = (result.get("results") or [{}])[0]
                if isinstance(first, dict):
                    result = first.get("scenario") if isinstance(first.get("scenario"), dict) else first
                else:
                    result = {}

            new_events = None
            if isinstance(result, dict):
                new_events = result.get("events")

            if not isinstance(new_events, list) or len(new_events) == 0:
                logger.warning(
                    "[ScenarioCascade] events_extract attempt=%d empty events", attempt + 1,
                )
                continue

            # order 재계산 + user_edited_fields=[] (LLM 산출물이므로 사용자 편집 표시 X)
            normalized = []
            for i, ev in enumerate(new_events):
                if not isinstance(ev, dict):
                    continue
                ev_norm = dict(ev)
                ev_norm["order"] = i + 1
                ev_norm["user_edited_fields"] = []
                normalized.append(ev_norm)

            if not normalized:
                continue

            await mongo_db.mv_jobs.update_one(
                {"_id": job_oid},
                {"$set": {"scenario_events": normalized, "updated_at": datetime.utcnow()}},
            )
            logger.info(
                "[ScenarioCascade] events_extract success events_count=%d attempt=%d",
                len(normalized), attempt + 1,
            )
            return True

        except RetryableScenarioError as e:
            logger.warning(
                "[ScenarioCascade] events_extract retryable attempt=%d err=%s",
                attempt + 1, str(e)[:200],
            )
        except Exception as e:
            logger.warning(
                "[ScenarioCascade] events_extract failed attempt=%d err=%s",
                attempt + 1, str(e)[:200],
            )

    return False


async def _v53_archive_scenes(mongo_db, job_oid) -> None:
    """B8 — Phase 1 진입 직전 옛 scenes 통째 → scenes_archive 의 head (1회분만 유지).

    옛 archive 가 이미 있으면 폐기 (1 회분만 보관).
    """
    job = await mongo_db.mv_jobs.find_one(
        {"_id": job_oid}, {"scenes": 1},
    )
    if not job:
        return
    scenes = job.get("scenes") or []
    if not scenes:
        return
    # 1회분만 — 새 archive 가 통째로 교체
    archive_entry = {
        "archived_at": datetime.utcnow(),
        "scenes": scenes,
    }
    await mongo_db.mv_jobs.update_one(
        {"_id": job_oid},
        {"$set": {"scenes_archive": [archive_entry], "updated_at": datetime.utcnow()}},
    )
    logger.info(
        "[ScenarioCascade] job=%s archive_count=%d", str(job_oid), len(scenes),
    )


async def _v53_full_cascade(job_oid, mongo_db) -> None:
    """B4 — v53 전체 cascade 백그라운드 헬퍼.

    Phase 0 (선택)  events_extract — narrative 편집되었지만 events 미편집 시 LLM 재추출.
    Phase 1         scene_split — run_phase1_split 재호출 (Phase 0 LLM 자동 skip).
    Phase 2         scene_image — run_phase2_images.
    Phase 2.5       scene_video_prompt — 모든 씬 video_prompt 재생성.
    Phase Final     video_invalidate — 모든 씬 영상 폐기 (마킹만).
    """
    try:
        job = await _get_job(mongo_db, job_oid)
        if not job:
            logger.error("[ScenarioCascade] job=%s not found, skip", str(job_oid))
            return

        # v54: 통합 헬퍼로 일관 분기
        narrative_edited = _v54_is_field_user_edited(job, "scenario", None, "narrative")
        events_edited = _v54_is_field_user_edited(job, "scenario", None, "events")

        # ── Phase 0: events 보강 ──────────────────────────────────────────────
        if await _v53_is_cancelled(mongo_db, job_oid):
            await _v53_finalize_cancelled(mongo_db, job_oid)
            return

        if narrative_edited and not events_edited:
            await _v53_set_cascade(mongo_db, job_oid, {
                "cascade_phase": "events_extract",
                "cascade_progress": _V53_PHASE_PROGRESS["events_extract"],
            })
            logger.info(
                "[ScenarioCascade] job=%s phase=events_extract progress=%d",
                str(job_oid), _V53_PHASE_PROGRESS["events_extract"],
            )
            ok = await _v53_extract_events_only(job, mongo_db, job_oid)
            if not ok:
                logger.warning(
                    "[ScenarioCascade] job=%s phase=events_extract failed — proceeding with existing events",
                    str(job_oid),
                )
            # job 갱신본 다시 읽기 (events 가 갱신됐을 수 있음)
            job = await _get_job(mongo_db, job_oid)
            if not job:
                return
        else:
            logger.info(
                "[ScenarioCascade] job=%s phase=events_extract_skip narrative_edited=%s events_edited=%s",
                str(job_oid), narrative_edited, events_edited,
            )

        # ── Phase 1 + 1b: 씬 분할 + image_prompt 생성 ─────────────────────────
        if await _v53_is_cancelled(mongo_db, job_oid):
            await _v53_finalize_cancelled(mongo_db, job_oid)
            return

        # 옛 scenes archive 보관 (B8)
        await _v53_archive_scenes(mongo_db, job_oid)

        await _v53_set_cascade(mongo_db, job_oid, {
            "cascade_phase": "scene_split",
            "cascade_progress": _V53_PHASE_PROGRESS["scene_split"],
        })
        logger.info(
            "[ScenarioCascade] job=%s phase=scene_split progress=%d",
            str(job_oid), _V53_PHASE_PROGRESS["scene_split"],
        )

        # run_phase1_split 안의 Phase 0 LLM 호출은 `if scenario and len > 50: skip` 로
        # 자동 우회 (cascade 진입 전 시나리오 도큐먼트가 이미 존재하므로). Phase 1a
        # (가사 파싱 + 비트) + Phase 1b (image_prompt 생성) 만 실행.
        try:
            await run_phase1_split(str(job_oid), mongo_db)
        except Exception as e:
            await _v53_finalize_failed(mongo_db, job_oid, "scene_split: " + str(e))
            return

        await _v53_set_cascade(mongo_db, job_oid, {
            "cascade_phase": "scene_image_prompt",
            "cascade_progress": _V53_PHASE_PROGRESS["scene_image_prompt"],
        })
        logger.info(
            "[ScenarioCascade] job=%s phase=scene_image_prompt progress=%d",
            str(job_oid), _V53_PHASE_PROGRESS["scene_image_prompt"],
        )

        # ── Phase 2: 모든 씬 image 재생성 ─────────────────────────────────────
        if await _v53_is_cancelled(mongo_db, job_oid):
            await _v53_finalize_cancelled(mongo_db, job_oid)
            return

        await _v53_set_cascade(mongo_db, job_oid, {
            "cascade_phase": "scene_image",
            "cascade_progress": _V53_PHASE_PROGRESS["scene_image"],
        })
        logger.info(
            "[ScenarioCascade] job=%s phase=scene_image progress=%d",
            str(job_oid), _V53_PHASE_PROGRESS["scene_image"],
        )

        try:
            await run_phase2_images(str(job_oid), mongo_db)
        except Exception as e:
            await _v53_finalize_failed(mongo_db, job_oid, "scene_image: " + str(e))
            return

        # ── Phase 2.5: 모든 씬 video_prompt 재생성 ────────────────────────────
        if await _v53_is_cancelled(mongo_db, job_oid):
            await _v53_finalize_cancelled(mongo_db, job_oid)
            return

        await _v53_set_cascade(mongo_db, job_oid, {
            "cascade_phase": "scene_video_prompt",
            "cascade_progress": _V53_PHASE_PROGRESS["scene_video_prompt"],
        })
        logger.info(
            "[ScenarioCascade] job=%s phase=scene_video_prompt progress=%d",
            str(job_oid), _V53_PHASE_PROGRESS["scene_video_prompt"],
        )

        job = await _get_job(mongo_db, job_oid)
        scenes = (job or {}).get("scenes") or []
        for scene_idx, scene in enumerate(scenes):
            if await _v53_is_cancelled(mongo_db, job_oid):
                await _v53_finalize_cancelled(mongo_db, job_oid)
                return
            try:
                vp = await _v51_regen_video_prompt_single(job, scene_idx)
                if vp:
                    await _v51_set_scene_fields(mongo_db, job_oid, scene_idx, {
                        "video_prompt": vp,
                    })
            except Exception as e:
                logger.warning(
                    "[ScenarioCascade] phase2.5 scene=%d failed err=%s",
                    scene.get("scene_number") or scene_idx, str(e)[:200],
                )

        # ── Phase Final: 모든 씬 영상 폐기 (마킹만) ───────────────────────────
        if await _v53_is_cancelled(mongo_db, job_oid):
            await _v53_finalize_cancelled(mongo_db, job_oid)
            return

        await _v53_set_cascade(mongo_db, job_oid, {
            "cascade_phase": "video_invalidate",
            "cascade_progress": _V53_PHASE_PROGRESS["video_invalidate"],
        })
        logger.info(
            "[ScenarioCascade] job=%s phase=video_invalidate progress=%d",
            str(job_oid), _V53_PHASE_PROGRESS["video_invalidate"],
        )

        job = await _get_job(mongo_db, job_oid)
        scenes = (job or {}).get("scenes") or []
        for scene_idx, scene in enumerate(scenes):
            try:
                await _v51_invalidate_video(
                    mongo_db, job_oid, scene_idx, scene.get("scene_number") or scene_idx,
                )
            except Exception as e:
                logger.warning(
                    "[ScenarioCascade] video_invalidate scene=%d failed err=%s",
                    scene.get("scene_number") or scene_idx, str(e)[:200],
                )

        await _v53_set_cascade(mongo_db, job_oid, {
            "cascade_phase": "completed",
            "cascade_progress": 100,
            "cascade_completed_at": datetime.utcnow(),
            "cancel_requested": False,
        })
        logger.info("[ScenarioCascade] job=%s phase=completed", str(job_oid))

    except Exception as e:
        await _v53_finalize_failed(mongo_db, job_oid, str(e))
