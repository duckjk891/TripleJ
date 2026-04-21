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

from ..config import settings
from ..database.minio import get_minio
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

logger = logging.getLogger(__name__)


async def _update_job(mongo_db, job_id, update: dict) -> None:
    """Helper to update mv_jobs document."""
    update["updated_at"] = datetime.utcnow()
    await mongo_db.mv_jobs.update_one(
        {"_id": job_id},
        {"$set": update},
    )


async def _get_job(mongo_db, job_id) -> Optional[dict]:
    """Load job document from MongoDB."""
    return await mongo_db.mv_jobs.find_one({"_id": job_id})


async def _is_cancelled(mongo_db, job_id) -> bool:
    """Check if cancel has been requested for this job."""
    job = await mongo_db.mv_jobs.find_one({"_id": job_id}, {"cancel_requested": 1})
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


def _get_scene_timestamps(whisper_segments: list[dict], section_start: float, section_end: float) -> list[dict]:
    """Extract and re-base Whisper timestamps for a specific scene time range.

    Filters the full whisper_segments to only those overlapping with
    [section_start, section_end], then shifts times so they start at 0
    (since per-scene videos start at 0 seconds).

    Args:
        whisper_segments: Full list of Whisper segments [{"text", "start", "end"}, ...]
        section_start: Scene start time in seconds (absolute)
        section_end: Scene end time in seconds (absolute)

    Returns:
        List of segments with times relative to scene start (0-based).
    """
    if not whisper_segments:
        return []
    result = []
    for seg in whisper_segments:
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
    whisper_segments: list[dict],
    lyrics: str,
    audio_duration: float,
) -> list[dict]:
    """Whisper 세그먼트와 가사를 매칭하여 섹션별 타이밍을 확정한다.

    Args:
        whisper_segments: [{"text", "start", "end"}, ...] from Whisper
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
        for j in range(seg_idx, min(seg_idx + 10, len(whisper_segments))):
            if _text_match(line_text, whisper_segments[j]["text"]):
                line_timings.append((sec_idx, whisper_segments[j]["start"], whisper_segments[j]["end"]))
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
        "Whisper section builder: %d sections from %d whisper segments",
        len(music_sections), len(whisper_segments),
    )
    return music_sections


# ── 15초 초과 섹션 자동 분할 ───────────────────────────────────────────────

MAX_CLIP_SEC = 15.0   # Kling 최대
TARGET_CLIP_SEC = 10.0  # 목표 클립 길이


def _split_long_section(sec: dict, whisper_segments: list, lyrics_lines: list) -> list[dict]:
    """15초 초과 섹션을 Whisper 줄 타이밍 기반으로 분할.

    Args:
        sec: {"label", "start", "end", "mood"}
        whisper_segments: 전체 Whisper 세그먼트 (줄별 타이밍)
        lyrics_lines: 해당 섹션의 가사 줄 리스트

    Returns:
        분할된 씬 리스트: [{"section", "start", "end", "lyrics_segment"}, ...]
    """
    import math

    sec_start = sec["start"]
    sec_end = sec["end"]
    sec_dur = sec_end - sec_start
    label = sec["label"]

    if sec_dur <= MAX_CLIP_SEC:
        return [{"section": label, "start": sec_start, "end": sec_end,
                 "lyrics_segment": "\n".join(lyrics_lines)}]

    # 해당 섹션 시간 범위에 속하는 Whisper 세그먼트 찾기
    sec_segs = []
    for ws in whisper_segments:
        ws_start = float(ws.get("start", 0))
        ws_end = float(ws.get("end", 0))
        # 세그먼트가 섹션 범위와 겹치면 포함
        if ws_end > sec_start + 0.5 and ws_start < sec_end - 0.5:
            sec_segs.append(ws)

    if not sec_segs:
        # Whisper 세그먼트 없으면 균등 분할
        clip_count = math.ceil(sec_dur / TARGET_CLIP_SEC)
        clip_dur = sec_dur / clip_count
        clips = []
        lines_per_clip = max(1, len(lyrics_lines) // clip_count) if lyrics_lines else 0
        for i in range(clip_count):
            c_start = sec_start + i * clip_dur
            c_end = sec_start + (i + 1) * clip_dur
            if lyrics_lines:
                l_start = i * lines_per_clip
                l_end = l_start + lines_per_clip if i < clip_count - 1 else len(lyrics_lines)
                c_lyrics = "\n".join(lyrics_lines[l_start:l_end])
            else:
                c_lyrics = ""
            clips.append({
                "section": "{}-{}".format(label, i + 1),
                "start": round(c_start, 3), "end": round(c_end, 3),
                "lyrics_segment": c_lyrics,
            })
        return clips

    # Whisper 세그먼트 경계를 분할 후보로 사용
    # 각 세그먼트 end 시점에서 자를 수 있음
    # 누적 시간이 TARGET_CLIP_SEC을 넘으면 거기서 자름
    clips = []
    clip_start = sec_start
    clip_lyrics = []
    line_idx = 0

    for seg in sec_segs:
        seg_end = float(seg.get("end", 0))
        elapsed = seg_end - clip_start

        # 이 세그먼트에 해당하는 가사 줄 배정
        if line_idx < len(lyrics_lines):
            clip_lyrics.append(lyrics_lines[line_idx])
            line_idx += 1

        # TARGET 초과하면 여기서 자름
        if elapsed >= TARGET_CLIP_SEC and clip_lyrics:
            clip_num = len(clips) + 1
            clips.append({
                "section": "{}-{}".format(label, clip_num),
                "start": round(clip_start, 3), "end": round(seg_end, 3),
                "lyrics_segment": "\n".join(clip_lyrics),
            })
            clip_start = seg_end
            clip_lyrics = []

    # 남은 부분 마지막 클립으로
    remaining_lyrics = lyrics_lines[line_idx:]
    clip_lyrics.extend(remaining_lyrics)
    if clip_start < sec_end - 0.1:
        clip_num = len(clips) + 1
        section_name = "{}-{}".format(label, clip_num) if clips else label
        clips.append({
            "section": section_name,
            "start": round(clip_start, 3), "end": round(sec_end, 3),
            "lyrics_segment": "\n".join(clip_lyrics),
        })

    # 클립이 1개뿐이면 원래 이름 유지
    if len(clips) == 1:
        clips[0]["section"] = label

    # 분할 완료 후 후처리: 15초 초과 클립 재분할
    final_clips = []
    for clip in clips:
        clip_dur = clip["end"] - clip["start"]
        if clip_dur > MAX_CLIP_SEC:
            # 시간 기반 균등 분할
            sub_count = math.ceil(clip_dur / TARGET_CLIP_SEC)
            sub_dur = clip_dur / sub_count
            # 가사도 균등 분배
            clip_lyrics_lines = [l for l in clip["lyrics_segment"].split("\n") if l.strip()] if clip["lyrics_segment"] else []
            for k in range(sub_count):
                sub_start = clip["start"] + k * sub_dur
                sub_end = clip["start"] + (k + 1) * sub_dur
                # 가사 분배
                if clip_lyrics_lines:
                    lines_per = max(1, len(clip_lyrics_lines) // sub_count)
                    l_start = k * lines_per
                    l_end = l_start + lines_per if k < sub_count - 1 else len(clip_lyrics_lines)
                    sub_lyrics = "\n".join(clip_lyrics_lines[l_start:l_end])
                else:
                    sub_lyrics = ""
                sub_section = "{}.{}".format(clip["section"], k + 1) if sub_count > 1 else clip["section"]
                final_clips.append({
                    "section": sub_section,
                    "start": round(sub_start, 3),
                    "end": round(sub_end, 3),
                    "lyrics_segment": sub_lyrics,
                })
        else:
            final_clips.append(clip)
    return final_clips


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

    # ── Phase 0: Generate MV Scenario (required, max 3 retries) ──
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
        has_user_character = bool(job.get("character_object_name"))
        # Cover-image person analysis is planned for Phase 1.5 — placeholder False for now
        has_cover_person = False

        for attempt in range(3):
            try:
                from .mv_generator import generate_mv_scenario
                character_name = job.get("character_name")
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
                )

                # Handle dual-model results
                if isinstance(result, dict) and "results" in result:
                    # Dual models: save both results (meta + scenario) and pause for user selection
                    # Each result now has shape: {"meta": dict, "scenario": str, "model": str}
                    # Preserve backward compatibility by also flattening scenario for /select-scenario
                    await _update_job(mongo_db, job_id, {
                        "scenario_results": result["results"],
                        "status": "scenario_review",
                        "progress": 1,
                    })
                    logger.info(
                        "Phase0: dual scenario results for job %s (%d models, attempt %d)",
                        job_id, len(result["results"]), attempt + 1,
                    )
                    return  # Stop here; user must select via /select-scenario endpoint

                # Single-model result: dict (drama) or str (legacy fallback)
                if isinstance(result, dict):
                    scenario_meta = result
                    scenario = result.get("scenario", "")
                else:
                    scenario_meta = {"characters": {}, "locations": {}, "scenario": result}
                    scenario = result

                if scenario and len(scenario.strip()) > 50:
                    await _update_job(mongo_db, job_id, {
                        "scenario": scenario,
                        "scenario_meta": scenario_meta,
                        "progress": 1,
                    })
                    logger.info(
                        "Phase0: scenario generated for job %s (%d chars body, attempt %d, style=%s)",
                        job_id, len(scenario), attempt + 1, scenario_style,
                    )
                    break
                else:
                    logger.warning("Phase0: scenario too short (%d chars), retrying (attempt %d/3)", len(scenario or ""), attempt + 1)
                    scenario = None
                    scenario_meta = None
            except Exception as e:
                logger.warning("Phase0: scenario generation failed (attempt %d/3): %s", attempt + 1, e)
                if attempt < 2:
                    await asyncio.sleep(3 * (attempt + 1))  # 지수 백오프: 3초, 6초

    if not scenario:
        logger.error("Phase0: scenario generation failed after 3 attempts for job %s", job_id)
        await _update_job(mongo_db, job_id, {
            "status": "failed",
            "error_message": "MV 시나리오 생성에 실패했습니다. 다시 시도해주세요.",
        })
        return

    # ── Phase 1a: 가사 파싱 + Whisper 타이밍 ──
    lyrics = job.get("lyrics", "")
    sections = _parse_lyrics_sections(lyrics)
    whisper_segments = None

    audio_object_name = await _resolve_audio_object_name(job, mongo_db)
    if audio_object_name:
        logger.info("Phase1a: analyzing music structure for job %s (audio: %s)", job_id, audio_object_name)
        await _update_job(mongo_db, job_id, {"progress": 1})

        try:
            audio_bytes = _load_audio_from_minio(audio_object_name)
            if audio_bytes:
                # Determine file format
                _file_format = "mp3"
                if audio_object_name.endswith(".wav"):
                    _file_format = "wav"
                elif audio_object_name.endswith(".m4a"):
                    _file_format = "m4a"

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

                # ── Try Suno timestamps first (more accurate, no extra cost) ──
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

                # ── Demucs 보컬 분리 → Whisper 분석 (fallback) ──
                if lyrics and sections:
                    import re as _re
                    _lyrics_plain = _re.sub(r'\[([^\]]+)\]', '', lyrics).strip()
                    _aud_dur = audio_duration or 180.0

                    if _suno_segments:
                        # Use Suno segments directly (same format as Whisper: text/start/end)
                        whisper_segments = _suno_segments

                        # Build sections from Suno timestamps
                        _candidate = _build_sections_from_whisper(whisper_segments, lyrics, _aud_dur)
                        if _candidate:
                            # Validate sections
                            _valid = True
                            _zero_count = 0
                            for _sec in _candidate:
                                _dur = _sec["end"] - _sec["start"]
                                if _dur > _aud_dur * 0.4:
                                    logger.warning("Phase1a: Suno section '%s' too long (%.1fs / %.1fs)", _sec["label"], _dur, _aud_dur)
                                    _valid = False
                                    break
                                if _dur < 0.1:
                                    _zero_count += 1
                            if _zero_count >= 4:
                                logger.warning("Phase1a: %d zero-length sections from Suno", _zero_count)
                                _valid = False

                            if _valid:
                                music_sections = _candidate
                                logger.info("Phase1a: Suno sections OK: %d sections", len(music_sections))
                            else:
                                logger.warning("Phase1a: Suno sections invalid, falling back to Whisper")
                                _suno_segments = None
                                whisper_segments = None
                        else:
                            logger.warning("Phase1a: Suno section builder returned empty, falling back to Whisper")
                            _suno_segments = None
                            whisper_segments = None

                    if not _suno_segments:
                        # Fall back to Whisper
                        for _attempt in range(3):
                            try:
                                # Step 1: Demucs 보컬 분리 (악기 제거 → Whisper 안정성 향상)
                                _whisper_input = audio_bytes
                                _whisper_format = _file_format
                                try:
                                    from .demucs_service import enhance_vocal_demucs
                                    import subprocess as _sp_conv
                                    _vocal_wav = await enhance_vocal_demucs(audio_bytes, "full_audio.mp3")
                                    if _vocal_wav and len(_vocal_wav) > 1000:
                                        # WAV→MP3 변환 (Whisper 25MB 제한 대응)
                                        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as _wf:
                                            _wf.write(_vocal_wav)
                                            _wav_path = _wf.name
                                        _mp3_path = _wav_path.replace(".wav", ".mp3")
                                        _sp_conv.run(["ffmpeg", "-y", "-i", _wav_path, "-codec:a", "libmp3lame", "-b:a", "128k", _mp3_path],
                                                     capture_output=True, timeout=60)
                                        if os.path.exists(_mp3_path):
                                            with open(_mp3_path, "rb") as _mf:
                                                _whisper_input = _mf.read()
                                            _whisper_format = "mp3"
                                            os.unlink(_wav_path)
                                            os.unlink(_mp3_path)
                                            logger.info("Phase1a: Demucs vocal→MP3 done (%d bytes)", len(_whisper_input))
                                        else:
                                            _whisper_input = _vocal_wav
                                            _whisper_format = "wav"
                                            os.unlink(_wav_path)
                                    else:
                                        logger.warning("Phase1a: Demucs returned small output, using original audio")
                                except Exception as _demucs_err:
                                    logger.warning("Phase1a: Demucs failed, using original audio: %s", str(_demucs_err)[:200])

                                # Step 2: Whisper 분석
                                from .whisper_service import get_full_audio_timestamps
                                whisper_segments = get_full_audio_timestamps(
                                    _whisper_input, file_format=_whisper_format,
                                    lyrics_hint=_lyrics_plain[:500] if _lyrics_plain else None,
                                )

                                if not whisper_segments:
                                    raise ValueError("Whisper returned no segments")

                                # Step 3: 섹션 빌드
                                _candidate = _build_sections_from_whisper(whisper_segments, lyrics, _aud_dur)
                                if not _candidate:
                                    raise ValueError("Section builder returned empty")

                                # Step 4: 검증 - 비정상 섹션 감지
                                _valid = True
                                _zero_count = 0
                                for _sec in _candidate:
                                    _dur = _sec["end"] - _sec["start"]
                                    if _dur > _aud_dur * 0.4:
                                        logger.warning("Phase1a: section '%s' too long (%.1fs / %.1fs)", _sec["label"], _dur, _aud_dur)
                                        _valid = False
                                        break
                                    if _dur < 0.1:
                                        _zero_count += 1
                                if _zero_count >= 4:
                                    logger.warning("Phase1a: %d zero-length sections", _zero_count)
                                    _valid = False

                                if _valid:
                                    music_sections = _candidate
                                    logger.info("Phase1a: Whisper sections OK (attempt %d): %d sections", _attempt + 1, len(music_sections))
                                    break
                                else:
                                    logger.warning("Phase1a: invalid sections (attempt %d/3), retrying", _attempt + 1)
                            except Exception as _whisper_err:
                                logger.warning("Phase1a: attempt %d/3 failed: %s", _attempt + 1, str(_whisper_err)[:200])

                # Save music_sections + whisper_segments to job
                if music_sections:
                    _save_data = {
                        "music_sections": music_sections,
                        "progress": 3,
                    }
                    if whisper_segments:
                        _save_data["whisper_segments"] = whisper_segments
                    await _update_job(mongo_db, job_id, _save_data)
                    logger.info(
                        "Phase1a: job %s music structure: %d sections",
                        job_id, len(music_sections),
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
    _ws_segments = whisper_segments if whisper_segments else job.get("whisper_segments", [])

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

        # 15초 초과 시 자동 분할
        clips = _split_long_section(sec, _ws_segments, lyrics_lines)

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

    prompts_result = None
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
        scene["description"] = scene["image_prompt"]  # 하위호환용

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

    await _update_job(mongo_db, job_id, {"status": "generating_assets", "progress": 5})

    from .mv_assets import (
        generate_character_sheet_asset,
        generate_location_sheet_asset,
        upload_asset_to_minio,
    )

    # 사용자 캐릭터 시트가 있으면 character1 생성 시 ref로 사용
    user_char_bytes = None
    if job.get("character_object_name"):
        user_char_bytes = _load_character_image(job.get("character_object_name"))
    # 커버 인물 분석은 v30 범위 외 — character_object_name 없으면 cover를 ref로 줄지 말지 결정
    # (보수적: 커버는 ref로 주지 않음; 보컬 성별 + description만으로 생성)

    assets = {}

    # 캐릭터 생성 (병렬)
    async def _make_char(key, info):
        ref = user_char_bytes if key == "character1" and user_char_bytes else None
        try:
            img = await generate_character_sheet_asset(
                name=info.get("name", key),
                gender=info.get("gender", "neutral"),
                description=info.get("description", ""),
                ref_image=ref,
            )
            obj = await upload_asset_to_minio(img, job_id, key)
            return key, {
                "type": "character",
                "name": info.get("name", key),
                "gender": info.get("gender"),
                "description": info.get("description", ""),
                "object_name": obj,
                "created_at": datetime.utcnow(),
            }
        except Exception as e:
            logger.exception("Phase1.5: char %s gen failed: %s", key, e)
            return key, None

    async def _make_loc(key, info):
        try:
            img = await generate_location_sheet_asset(
                name=info.get("name", key),
                description=info.get("description", ""),
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

    tasks = []
    for k, v in characters.items():
        if isinstance(v, dict):
            tasks.append(_make_char(k, v))
    for k, v in locations.items():
        if isinstance(v, dict):
            tasks.append(_make_loc(k, v))

    if tasks:
        results = await asyncio.gather(*tasks, return_exceptions=True)
        for r in results:
            if isinstance(r, tuple) and r[1] is not None:
                assets[r[0]] = r[1]

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

    # Asset registry: {"character1": bytes, ...} for variable-reference resolution
    from .mv_assets import parse_asset_references, load_asset_from_minio
    assets_meta = job.get("assets") or {}
    asset_bytes_cache: dict = {}
    for _k, _a in assets_meta.items():
        if isinstance(_a, dict) and _a.get("object_name"):
            _b = load_asset_from_minio(_a["object_name"])
            if _b:
                asset_bytes_cache[_k] = _b

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
            img_bytes = await generate_scene_image(
                scene_desc,
                cover_image_bytes=ref_image,
                character_image_bytes=character_image_bytes,
                scene_type=scene.get("scene_type", "drama"),
                reference_images=scene_refs or None,
            )

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
            scenes[i]["image_source"] = "gemini"
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

    for i, scene in enumerate(scenes):
        if not scene.get("image_object_name"):
            continue  # no image, skip
        if scene.get("video_prompt"):
            continue  # already has video_prompt (e.g. manual override), skip

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
            )

            scenes[i]["video_prompt"] = video_prompt
            logger.info("Phase2.5: scene %d video_prompt generated", scene.get("scene_number", i + 1))

        except Exception as e:
            logger.warning("Phase2.5: scene %d video_prompt failed: %s", scene.get("scene_number", i + 1), e)
            scenes[i]["video_prompt"] = "Smooth cinematic camera movement, slow dolly forward."  # fallback

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

    max_retries = 5
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
                if use_kling:
                    task_or_op = await start_scene_video_kling(
                        prompt=scene_desc_for_video,
                        image_bytes=image_bytes,
                        prev_scene_image_bytes=prev_scene_image_for_video,
                        character_image_bytes=character_image_bytes,
                        lyrics_segment=scene.get("lyrics_segment", ""),
                        scene_type=scene.get("scene_type", "drama"),
                        duration=float(scene.get("use_seconds", 10)),
                        video_prompt=scene_video_prompt,
                    )
                elif use_seedance:
                    # For lipsync scenes, slice audio segment and pass to Seedance
                    scene_audio_bytes = None
                    if scene.get("scene_type") == "lipsync" and seedance_audio_bytes:
                        scene_audio_bytes = _slice_audio_segment(
                            seedance_audio_bytes,
                            scene.get("section_start", 0),
                            scene.get("section_end", 10),
                        )

                    task_or_op = await start_scene_video_seedance(
                        prompt=scene_desc_for_video,
                        image_bytes=image_bytes,
                        video_prompt=scene_video_prompt,
                        lyrics_segment=scene.get("lyrics_segment", ""),
                        scene_type=scene.get("scene_type", "drama"),
                        duration=float(scene.get("use_seconds", 10)),
                        audio_bytes=scene_audio_bytes,
                    )
                else:
                    task_or_op = await start_scene_video(
                        scene_desc_for_video, image_bytes,
                        video_prompt=scene_video_prompt,
                        lyrics_segment=scene.get("lyrics_segment", ""),
                        scene_type=scene.get("scene_type", "drama"),
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
                    logger.warning("Phase3: scene %d error: %s", sn, status_result["error"])
                    if attempt < max_retries - 1:
                        continue
                    scenes[i]["video_status"] = "failed"
                    scenes[i]["video_error"] = status_result["error"]
                    break

                # Download and save video
                # Kling/Seedance returns "video_url", Veo returns "video_uri"
                video_download_url = status_result.get("video_url") or status_result.get("video_uri")
                if use_kling:
                    video_bytes = await download_video_kling(video_download_url)
                elif use_seedance:
                    video_bytes = await download_video_seedance(video_download_url)
                else:
                    video_bytes = await download_video(video_download_url)

                # Trim video to use_seconds if specified (section-aware pipeline)
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
                from .demucs_service import enhance_vocal_demucs
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

                            # 보컬 분리
                            logger.info("Phase3.5: separating vocals for scene %d", sn)
                            vocal_bytes = await enhance_vocal_demucs(segment_audio, "segment.mp3")

                            # 보컬 분리 결과가 너무 작으면 원본 segment로 fallback
                            if not vocal_bytes or len(vocal_bytes) < 5120:
                                logger.warning(
                                    "Phase3.5: scene %d vocal too small (%db), falling back to original segment",
                                    sn, len(vocal_bytes) if vocal_bytes else 0,
                                )
                                vocal_bytes = segment_audio

                            # 보컬 분리 결과 MinIO에 저장
                            orig_obj = "mv/{}/scenes/{:03d}_original_segment.mp3".format(str(job_id), sn)
                            vocal_obj = "mv/{}/scenes/{:03d}_vocal_only.wav".format(str(job_id), sn)
                            minio_client.put_object(bucket_name=settings.minio_bucket_music,
                                                    object_name=orig_obj, data=io.BytesIO(segment_audio),
                                                    length=len(segment_audio), content_type="audio/mpeg")
                            minio_client.put_object(bucket_name=settings.minio_bucket_music,
                                                    object_name=vocal_obj, data=io.BytesIO(vocal_bytes),
                                                    length=len(vocal_bytes), content_type="audio/wav")
                            scenes[sidx]["separated_original_object"] = orig_obj
                            scenes[sidx]["separated_vocal_object"] = vocal_obj

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

                            # Sync Labs 후 자막 재적용
                            _ws = job.get("whisper_segments", [])
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

                            # Generate lyrics subtitle for this scene (reuse saved Whisper timestamps)
                            timestamps = None
                            if scene.get("lyrics_segment"):
                                _ws = job.get("whisper_segments", [])
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

        # Generate karaoke-style lyrics subtitle (ASS) with Whisper timing
        scenes = job.get("scenes", [])
        all_timestamps: dict[int, list[dict]] = {}
        _ws = job.get("whisper_segments", [])
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
