"""
ASS subtitle generator for lyrics overlay on music videos.

Generates ASS (Advanced SubStation Alpha) subtitle content.
Lyrics are displayed as plain text timed to each scene segment.
"""


def _format_ass_time(seconds: float) -> str:
    """Convert seconds to ASS timecode format H:MM:SS.cc (centiseconds)."""
    if seconds < 0:
        seconds = 0.0
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    # ASS uses centiseconds (2 decimal places)
    return "{:d}:{:02d}:{:05.2f}".format(h, m, s)


def generate_lyrics_ass(scenes: list, all_timestamps: dict | None = None) -> str:
    """Generate ASS subtitle file content with karaoke-style lyrics.

    Args:
        scenes: List of scene dicts, each with optional keys:
            - lyrics_segment (str): lyrics text for this scene
            - section_start (float): start time in seconds
            - section_end (float): end time in seconds
        all_timestamps: Optional dict mapping scene index (int) to a list of
            Whisper segment dicts [{"text", "start", "end"}, ...].
            When provided, lyrics lines are timed using Whisper data instead
            of equal distribution.

    Returns:
        ASS file content as a string, or empty string if no lyrics found.
    """
    # Collect dialogue lines
    dialogue_lines: list[str] = []

    for scene_idx, scene in enumerate(scenes):
        lyrics = scene.get("lyrics_segment", "")
        if not lyrics or not lyrics.strip():
            continue

        section_start = float(scene.get("section_start", 0))
        section_end = float(scene.get("section_end", section_start + 10))
        section_duration = section_end - section_start

        if section_duration <= 0:
            continue

        # Split lyrics into lines
        lines = [ln for ln in lyrics.split("\n") if ln.strip()]
        if not lines:
            continue

        # Check if Whisper timestamps are available for this scene
        timestamps = (all_timestamps or {}).get(scene_idx)

        if timestamps and len(timestamps) > 0:
            # Use Whisper timestamps (match sequentially)
            for i, line_text in enumerate(lines):
                if i < len(timestamps):
                    seg = timestamps[i]
                    # Whisper timestamps are relative to the audio segment;
                    # shift to absolute time within the full video
                    line_start = section_start + float(seg["start"])
                    line_end = section_start + float(seg["end"])
                    # Clamp to section bounds
                    line_start = max(line_start, section_start)
                    line_end = min(line_end, section_end)
                else:
                    # More lyrics lines than Whisper segments: distribute
                    # remaining lines equally over the remaining time
                    last_end = section_start + float(timestamps[-1]["end"]) if timestamps else section_start
                    remaining_lines = len(lines) - len(timestamps)
                    if remaining_lines > 0 and section_end > last_end:
                        rem_dur = (section_end - last_end) / remaining_lines
                        rem_idx = i - len(timestamps)
                        line_start = last_end + rem_idx * rem_dur
                        line_end = last_end + (rem_idx + 1) * rem_dur
                    else:
                        line_duration = section_duration / len(lines)
                        line_start = section_start + i * line_duration
                        line_end = section_start + (i + 1) * line_duration

                start_tc = _format_ass_time(line_start)
                end_tc = _format_ass_time(line_end)

                dialogue_lines.append(
                    "Dialogue: 0,{},{},Lyrics,,0,0,0,,{}".format(
                        start_tc, end_tc, line_text.strip()
                    )
                )
        else:
            # Fallback: distribute time equally across lines
            line_duration = section_duration / len(lines)

            for i, line_text in enumerate(lines):
                line_start = section_start + i * line_duration
                line_end = section_start + (i + 1) * line_duration

                start_tc = _format_ass_time(line_start)
                end_tc = _format_ass_time(line_end)

                dialogue_lines.append(
                    "Dialogue: 0,{},{},Lyrics,,0,0,0,,{}".format(
                        start_tc, end_tc, line_text.strip()
                    )
                )

    # If no lyrics at all, return empty string
    if not dialogue_lines:
        return ""

    # Build full ASS content
    header = """\
[Script Info]
Title: MAIDOL Lyrics
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Lyrics,Freesentation,44,&H00FFFFFF,&H0000FFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2,1,2,20,20,40,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    return header + "\n".join(dialogue_lines) + "\n"


def generate_scene_lyrics_ass(scene: dict, timestamps: list[dict] | None = None) -> str:
    """Generate ASS subtitle for a single scene with time offset to 0.

    Since per-scene preview videos start at 0 seconds, all timings are
    shifted so that section_start maps to 0.

    Args:
        scene: Scene dict with optional keys:
            - lyrics_segment (str): lyrics text for this scene
            - section_start (float): original start time in seconds
            - section_end (float): original end time in seconds
        timestamps: Optional list of Whisper segment dicts
            [{"text", "start", "end"}, ...] with times relative to
            the scene audio segment (starting at 0).

    Returns:
        ASS file content as a string, or empty string if no lyrics.
    """
    lyrics = scene.get("lyrics_segment", "")
    if not lyrics or not lyrics.strip():
        return ""

    section_start = float(scene.get("section_start", 0))
    section_end = float(scene.get("section_end", section_start + 10))
    section_duration = section_end - section_start

    if section_duration <= 0:
        return ""

    lines = [ln for ln in lyrics.split("\n") if ln.strip()]
    if not lines:
        return ""

    dialogue_lines: list[str] = []

    if timestamps and len(timestamps) > 0:
        # Use Whisper timestamps (already 0-based relative to scene audio)
        for i, line_text in enumerate(lines):
            if i < len(timestamps):
                seg = timestamps[i]
                line_start = float(seg["start"])
                line_end = float(seg["end"])
                # Clamp to section duration
                line_start = max(line_start, 0.0)
                line_end = min(line_end, section_duration)
            else:
                # More lyrics lines than Whisper segments: distribute remaining
                last_end = float(timestamps[-1]["end"]) if timestamps else 0.0
                remaining_lines = len(lines) - len(timestamps)
                if remaining_lines > 0 and section_duration > last_end:
                    rem_dur = (section_duration - last_end) / remaining_lines
                    rem_idx = i - len(timestamps)
                    line_start = last_end + rem_idx * rem_dur
                    line_end = last_end + (rem_idx + 1) * rem_dur
                else:
                    line_duration = section_duration / len(lines)
                    line_start = i * line_duration
                    line_end = (i + 1) * line_duration

            start_tc = _format_ass_time(line_start)
            end_tc = _format_ass_time(line_end)

            dialogue_lines.append(
                "Dialogue: 0,{},{},Lyrics,,0,0,0,,{}".format(
                    start_tc, end_tc, line_text.strip()
                )
            )
    else:
        # Fallback: distribute time equally across lines
        line_duration = section_duration / len(lines)

        for i, line_text in enumerate(lines):
            # Offset to 0-based timing
            line_start = i * line_duration
            line_end = (i + 1) * line_duration

            start_tc = _format_ass_time(line_start)
            end_tc = _format_ass_time(line_end)

            dialogue_lines.append(
                "Dialogue: 0,{},{},Lyrics,,0,0,0,,{}".format(
                    start_tc, end_tc, line_text.strip()
                )
            )

    if not dialogue_lines:
        return ""

    header = """\
[Script Info]
Title: MAIDOL Lyrics
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Lyrics,Freesentation,44,&H00FFFFFF,&H0000FFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2,1,2,20,20,40,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    return header + "\n".join(dialogue_lines) + "\n"
