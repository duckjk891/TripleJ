"""Anchor-clause SSOT for v42 user-location feature.

`anchor_clause(kind, name)` returns the canonical wording for the user-supplied
location anchor used by the cover generator, the scenario LLM, and the scene
splitter / scene image generator. When the user has not selected a location
(`name` is empty/None), every variant returns an empty string so the rest of
the pipeline behaves exactly as before (regression-safe).
"""

from typing import Optional


_KIND_PHASE1_SCENARIO = "phase1_scenario"
_KIND_PHASE1_SCENES = "phase1_scenes"
_KIND_PHASE2_IMAGE = "phase2_image"
_KIND_COVER = "cover"


def anchor_clause(
    kind: str,
    name: Optional[str],
    has_character: bool = True,
) -> str:
    """Return the anchor clause for one of the four pipeline injection sites.

    Args:
        kind: one of "phase1_scenario", "phase1_scenes", "phase2_image", "cover".
        name: user-provided location name. None or empty → returns "".
        has_character: only consulted for kind="cover" (selects subject phrasing).

    Returns:
        The anchor clause text, or "" when `name` is empty (regression-safe).
    """
    if not name:
        return ""
    cleaned = name.strip()
    if not cleaned:
        return ""

    if kind == _KIND_PHASE1_SCENARIO:
        return (
            "- ⭐ location1 은 사용자가 미리 지정한 주인공 캐릭터 장소 \"{name}\" 입니다. "
            "서사의 60% 이상이 이곳에서 일어나도록 설계하세요.\n"
            "- location2/location3 은 필요할 때만 추가하되, location1 의 시간대·라이팅·색감을 "
            "공유해야 합니다.\n"
            "- location1 의 description 은 \"{name}\" 의 분위기를 반영해서 1-2문장 한국어로 "
            "작성하되, 다른 장소로 대체하지 마세요."
        ).format(name=cleaned)

    if kind == _KIND_PHASE1_SCENES:
        return (
            "## ABSOLUTE RULE — USER LOCATION ANCHOR\n\n"
            "`@location1` is the user-provided real location named \"{name}\" where the "
            "protagonist primarily appears.\n"
            "- AT LEAST 60% of scenes MUST use @location1 as their setting (write "
            "@location1 explicitly in image_prompt).\n"
            "- You MAY introduce @location2 and/or @location3 only if narratively "
            "essential (transitions, contrast).\n"
            "- Secondary locations MUST share @location1's time of day, lighting "
            "direction, and dominant color tone.\n"
            "- NEVER describe locations as plain text (\"a cafe\", \"her room\") — always "
            "use @locationN tokens."
        ).format(name=cleaned)

    if kind == _KIND_PHASE2_IMAGE:
        return (
            "USER LOCATION REFERENCE: among the attached references, the @location1 "
            "image shows the real-world location \"{name}\" where the protagonist "
            "appears in this song. Match its setting, architecture, lighting and color "
            "tone exactly. Do NOT invent a different place."
        ).format(name=cleaned)

    if kind == _KIND_COVER:
        subject = "protagonist" if has_character else "subject of this image"
        return (
            "The {subject} appears at the location shown in the additional reference "
            "image (\"{name}\"). The cover scene MUST be set there — match its "
            "architecture, lighting, time of day, and color tone."
        ).format(subject=subject, name=cleaned)

    # Unknown kind — fail safe by returning empty string.
    return ""
