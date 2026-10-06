"""Suno API music generation service."""
import asyncio
import hashlib
import io
import json
import logging
import re
import time
from datetime import datetime, timezone

import httpx

from ..config import settings
from ..database.minio import get_minio

logger = logging.getLogger(__name__)

SUNO_GENERATE_URL = "{base}/api/v1/generate"
SUNO_UPLOAD_COVER_URL = "{base}/api/v1/generate/upload-cover"
SUNO_STATUS_URL = "{base}/api/v1/generate/record-info"

# Suno 폴링 종료(실패) 상태 집합. "FAILED" 외에 *_FAILED/*_ERROR/*_EXCEPTION 류가 실제 terminal 에러로 도착한다.
SUNO_TERMINAL_ERROR_STATUSES = {
    "FAILED",
    "CREATE_TASK_FAILED",
    "GENERATE_AUDIO_FAILED",
    "CALLBACK_EXCEPTION",
    "SENSITIVE_WORD_ERROR",
}

SUNO_VOCAL_MAP = {
    "male_warm": {"style": "soft male vocal, warm, smooth", "gender": "m"},
    "male_powerful": {"style": "powerful male vocal, belted, strong", "gender": "m"},
    "male_husky": {"style": "raspy male vocal, husky, gritty", "gender": "m"},
    "male_soft": {"style": "gentle male vocal, soft, intimate", "gender": "m"},
    "female_warm": {"style": "soft female vocal, breathy, warm", "gender": "f"},
    "female_powerful": {"style": "powerful female vocal, belted, strong", "gender": "f"},
    "female_husky": {"style": "raspy female vocal, husky, sultry", "gender": "f"},
    "female_sweet": {"style": "sweet female vocal, melodic, warm", "gender": "f"},
}


# ── v3.229 V2 — 보이스 곡 audioWeight 서버 고정 스위치 ─────────────────────────
# settings.suno_voice_audio_weight(env SUNO_VOICE_AUDIO_WEIGHT) 가 비어 있으면 끔(None) →
# 앱이 보낸 audioWeight 를 그대로 통과(현행). 0~1 숫자면 켬 → voice_persona·참고 음원 없음
# 곡의 audioWeight 를 그 값으로 덮어쓴다. 해석 불가·범위 밖 값은 끔으로 취급(경고 1회).
_VOICE_AW_WARNED: set = set()


def voice_audio_weight_override():
    """Return the configured voice audioWeight (float, 0~1, 2 decimals) or None (off)."""
    raw = getattr(settings, "suno_voice_audio_weight", None)
    if raw is None:
        return None
    text = str(raw).strip()
    if not text or text.lower() in ("none", "null", "off"):
        return None
    try:
        val = float(text)
    except (TypeError, ValueError):
        val = None
    if val is None or val != val or not (0.0 <= val <= 1.0):
        if text not in _VOICE_AW_WARNED:
            _VOICE_AW_WARNED.add(text)
            logger.warning(
                "[suno] SUNO_VOICE_AUDIO_WEIGHT invalid value=%r (expected 0~1) -> override off", text[:20],
            )
        return None
    return round(val, 2)


def _suno_param_echo(status_data) -> dict:
    """v3.229 V3 — record-info `data.param`(요청 에코 JSON 문자열) 에서 확인용 필드만 추린다.

    personaId 값 자체는 반환하지 않는다(bool 만). 파싱 실패는 빈 dict.
    """
    try:
        param = ((status_data or {}).get("data") or {}).get("param")
        if isinstance(param, str):
            param = json.loads(param) if param.strip() else {}
        if not isinstance(param, dict):
            return {}
        return {
            "persona": bool(param.get("personaId")),
            "personaModel": param.get("personaModel"),
            "audioWeight": param.get("audioWeight"),
            "model": param.get("model") or param.get("mv"),
            "keys": sorted(str(k) for k in param.keys())[:30],
        }
    except Exception:
        return {}


try:
    _boot_aw = voice_audio_weight_override()
    logger.info(
        "[suno] voice audioWeight override=%s",
        "off" if _boot_aw is None else "on value={}".format(_boot_aw),
    )
except Exception:  # pragma: no cover — 기동 로그 실패가 import 를 막지 않게
    pass


def _ensure_lyrics_structure(lyrics: str) -> str:
    """가사에 [Verse]/[Chorus] 같은 구조 태그가 없으면 자동 추가."""
    if not lyrics or not lyrics.strip():
        return lyrics
    tags = ['[verse', '[chorus', '[bridge', '[intro', '[outro', '[pre-chorus', '[hook']
    if any(tag in lyrics.lower() for tag in tags):
        return lyrics  # 이미 있음
    lines = [l for l in lyrics.strip().split('\n') if l.strip()]
    if len(lines) <= 4:
        return f"[Verse]\n{lyrics.strip()}"
    # 4줄씩 verse, 그 다음 4줄 chorus 반복
    structured = []
    section = 0
    for i, line in enumerate(lines):
        if i % 4 == 0:
            tag = "[Verse]" if section % 2 == 0 else "[Chorus]"
            structured.append(f"\n{tag}")
            section += 1
        structured.append(line)
    return '\n'.join(structured).strip()


# ── v3.281 [57] 도입부 엇박 대책 — 첫 보컬 섹션 앞 '가사 없는 인트로' 보장 ──────────
# 실데이터(10-05, 보컬곡 최근 60건): 51건이 [Intro] 아래에 가사가 들어가 있었고(=0초부터 노래),
# 2건은 [Verse] 로 바로 시작했다. 가사 없는 인트로가 없으면 Suno 가 그루브가 서기 전에
# 보컬을 얹어 박이 어긋나기 쉽다 → 작곡 직전 프롬프트에만 태그 1줄을 넣는다(가사·doc 불변).
LEADIN_INTRO_TAG = "[Intro]"
# 첫 섹션이 '가사 있는 [Intro…]' 이면 [Intro] 를 또 넣지 않고 이름이 다른 태그를 쓴다(이중 [Intro] 모호성 회피).
LEADIN_INTRO_TAG_BEFORE_SUNG_INTRO = "[Instrumental Intro]"
# 실험 스위치(기본 ON): 보컬곡 style 에 진입 박 정렬 지시 1구 추가. 끄려면 False.
SUNO_CLEAN_INTRO_STYLE_HINT_ENABLED = True
SUNO_CLEAN_INTRO_STYLE_HINT = "clean intro, vocals enter on the downbeat"

_TAG_LINE_RE = re.compile(r"^\s*\[([^\]]+)\]\s*$")
_DUET_LINE_LABEL_RE = re.compile(r"^\s*\[(?:female|male|both)\]", re.I)


def _is_section_tag_line(line: str) -> bool:
    """섹션 태그 단독 줄([Verse 1: soft] 등). 듀엣 줄 라벨([Female] …)은 태그가 아니다."""
    return bool(_TAG_LINE_RE.match(line or "")) and not _DUET_LINE_LABEL_RE.match(line or "")


def _ensure_leadin_intro(text: str):
    """첫 보컬 섹션 앞에 가사 없는 인트로가 없으면 태그 1줄 추가. 반환 (text, action).

    action: added | added_before_sung_intro | leadin_present | empty
    - 듀엣 헤더([This song is a duet…] + '===')는 맨 앞에 유지하고 그 뒤에 넣는다.
    - 첫 섹션이 가사 없는 태그(예: [Intro], [Instrumental])면 불변.
    - 가사 줄은 한 글자도 바꾸지 않는다(태그 줄 삽입만).
    """
    if not text or not text.strip():
        return text, "empty"
    lines = text.split("\n")
    i = 0
    n = len(lines)
    while i < n and not lines[i].strip():
        i += 1
    # 듀엣 헤더 건너뛰기
    if i < n and lines[i].strip().lower().startswith("[this song is"):
        i += 1
        while i < n and not lines[i].strip():
            i += 1
        if i < n and lines[i].strip() == "===":
            i += 1
        while i < n and not lines[i].strip():
            i += 1
    if i >= n:
        return text, "empty"
    insert_at = i
    first = lines[i].strip()
    if _is_section_tag_line(first):
        # 첫 섹션에 가사 줄이 있는지
        j = i + 1
        has_lyrics = False
        while j < n:
            ln = lines[j].strip()
            if ln:
                if _is_section_tag_line(ln):
                    break
                has_lyrics = True
                break
            j += 1
        if not has_lyrics:
            return text, "leadin_present"
        tag_name = _TAG_LINE_RE.match(first).group(1).strip().lower()
        tag = LEADIN_INTRO_TAG_BEFORE_SUNG_INTRO if tag_name.startswith("intro") else LEADIN_INTRO_TAG
        action = "added_before_sung_intro" if tag_name.startswith("intro") else "added"
    else:
        tag = LEADIN_INTRO_TAG
        action = "added"
    new_lines = lines[:insert_at] + [tag, ""] + lines[insert_at:]
    return "\n".join(new_lines), action


# ── v3.283 가사 싱크 붕괴 예방(3번) — Suno 전송용 듀엣 가사 정규화 ─────────────────────
# 실데이터(10-04): 듀엣 14곡 중 12곡의 get-timestamped-lyrics 가 붕괴(전 줄이 수 초 안에 몰림).
# Suno 는 우리가 보낸 prompt 텍스트 그대로를 정렬 기준으로 쓰는데(타임스탬프 text 에 헤더·`[Male] …`
# 가 그대로 돌아옴), 듀엣 프롬프트가 강제하는 ① 맨 앞 헤더 `[This song is a duet …]` + `===`,
# ② 줄마다 붙은 `[Male]/[Female]/[Both]` 라벨이 정렬을 깨는 것으로 추정 → 작곡 직전 전송본에서만
# 헤더를 빼고(대신 style 에 duet 지시) 줄 라벨을 섹션 태그 수식어로 올린다.
# 저장된 doc.lyrics·사용자 표시 가사는 불변(이 함수는 prompt_text 에만 적용).
# 형식(Suno 메타태그 관행):
#   - 섹션 안 첫 화자 → 섹션 태그 수식어: `[Verse 1]` → `[Verse 1: Male Vocal]`
#     (기존 수식어가 있으면 `[Verse 1: Male Vocal, soft]`, 이미 male/female/duet/vocal 지시가 있으면 그대로)
#   - 섹션 안에서 화자가 바뀌면 그 줄 앞에 단독 보컬 태그 줄 `[Female Vocal]` 삽입 — 같은 섹션 이름을
#     반복(`[Verse 1 (cont.)…]`)하면 Suno 가 새 섹션 경계로 해석해 구조가 바뀔 수 있어 피한다.
#   - 라벨 없는 줄은 같은 섹션 안 직전 화자를 이어받는다(실데이터: 라벨은 화자 전환 줄에만 붙는 경우 다수).
#   - 섹션 태그 수식어 `[Intro: low synth, whispered]` 는 손대지 않는다. 인라인 연출 괄호 `(whisper)` 는
#     v3.284 lift_inline_directions(leadin 뒤, 아래 generate_music_suno)가 단독 태그 줄로 올린다.
DUET_VOCAL_TAG_TEXT = {"male": "Male Vocal", "female": "Female Vocal", "both": "Male and Female Vocals"}
DUET_STYLE_HINT = "duet, male and female vocals"  # 아래 generate_music_suno 에서 조각별 중복 검사 후 추가
_DUET_HEADER_RE = re.compile(r"^\s*\[\s*this song is\b[^\]]*\]\s*$", re.I)
_DUET_SEPARATOR_RE = re.compile(r"^\s*={3,}\s*$")
_DUET_LABEL_PREFIX_RE = re.compile(r"^(\s*)\[\s*(male|female|both)\s*\]\s*", re.I)
_DUET_TAG_HAS_VOCALIST_RE = re.compile(r"\b(?:male|female|duet|vocals?|both)\b", re.I)


def _promote_section_tag(tag_line: str, speaker: str) -> str:
    """`[Verse 1]` + male → `[Verse 1: Male Vocal]`. 이미 보컬 지시가 있으면 원문 유지."""
    inner = _TAG_LINE_RE.match(tag_line).group(1).strip()
    name, sep, mods = inner.partition(":")
    name, mods = name.strip(), mods.strip()
    if sep and _DUET_TAG_HAS_VOCALIST_RE.search(mods):
        return tag_line
    voc = DUET_VOCAL_TAG_TEXT[speaker]
    return "[{}: {}{}]".format(name, voc, ", " + mods if mods else "")


def _normalize_duet_lyrics_for_suno(text: str):
    """Suno 전송용 듀엣 가사 정규화. 반환 (text, stats).

    stats: duet(bool) header_removed(bool) sections(라벨이 정리된 섹션 수)
           moved_labels(제거한 줄 라벨 수) switches(삽입한 단독 보컬 태그 수)
    듀엣 헤더·줄 라벨이 하나도 없으면 입력 문자열을 그대로(바이트 불변) 돌려준다.
    가사 줄은 앞의 라벨만 떼고 나머지 글자는 바꾸지 않는다.
    """
    stats = {"duet": False, "header_removed": False, "sections": 0, "moved_labels": 0, "switches": 0}
    if not text or not text.strip():
        return text, stats
    lines = text.split("\n")
    has_header = any(_DUET_HEADER_RE.match(ln) for ln in lines)
    has_label = any(_DUET_LABEL_PREFIX_RE.match(ln) for ln in lines)
    if not (has_header or has_label):
        return text, stats
    stats["duet"] = True

    # 1) 헤더 줄 + 바로 뒤(빈 줄 건너) `===` 구분선 제거
    body = []
    i, n = 0, len(lines)
    while i < n:
        if _DUET_HEADER_RE.match(lines[i]):
            stats["header_removed"] = True
            i += 1
            j = i
            while j < n and not lines[j].strip():
                j += 1
            if j < n and _DUET_SEPARATOR_RE.match(lines[j]):
                i = j + 1
            continue
        body.append(lines[i])
        i += 1
    while body and not body[0].strip():  # 헤더 제거로 생긴 선행 빈 줄 정리
        body.pop(0)

    # 2) 섹션 블록 단위로 라벨 → 섹션 태그 승격 / 화자 전환 시 단독 보컬 태그
    blocks = []  # [tag_line or None, [lines]]
    cur = [None, []]
    for ln in body:
        if _is_section_tag_line(ln.strip()) and not _DUET_LABEL_PREFIX_RE.match(ln):
            blocks.append(cur)
            cur = [ln, []]
        else:
            cur[1].append(ln)
    blocks.append(cur)

    out = []
    for tag_line, blines in blocks:
        speaker = None
        runs_first = None      # 섹션 첫 가사 줄의 화자
        first_lyric_seen = False
        emitted = []           # (kind, text) kind: line|switch
        prev_emitted_speaker = None
        labels_here = 0
        for ln in blines:
            m = _DUET_LABEL_PREFIX_RE.match(ln)
            if m:
                labels_here += 1
                speaker = m.group(2).lower()
                rest = ln[m.end():]
                if not rest.strip():
                    continue  # 단독 라벨 줄([Male]) — 화자만 바꾸고 줄은 제거
                ln = m.group(1) + rest
            if not ln.strip():
                emitted.append(("line", ln))
                continue
            if not first_lyric_seen:
                first_lyric_seen = True
                runs_first = speaker
                prev_emitted_speaker = speaker
                if speaker is not None and tag_line is None:
                    emitted.append(("switch", "[{}]".format(DUET_VOCAL_TAG_TEXT[speaker])))
            elif speaker is not None and speaker != prev_emitted_speaker:
                emitted.append(("switch", "[{}]".format(DUET_VOCAL_TAG_TEXT[speaker])))
                prev_emitted_speaker = speaker
            emitted.append(("line", ln))
        stats["moved_labels"] += labels_here
        if labels_here:
            stats["sections"] += 1
        if tag_line is not None:
            if labels_here and runs_first is not None:
                out.append(_promote_section_tag(tag_line, runs_first))
            else:
                out.append(tag_line)
        for kind, t in emitted:
            if kind == "switch":
                stats["switches"] += 1
            out.append(t)
    result = "\n".join(out)
    return result, stats


# ── v3.281 과제1(c) — 내 목소리(voice_persona) 곡 style 의 보컬 음색 묘사 제거 ──────────
# 클론 목소리와 충돌하는 성별·음색 묘사만 보수적으로 제거한다(장르·분위기·악기 토큰은 보존).
_VOICE_STYLE_DROP_RES = [
    # "soft female vocal", "powerful male vocals", "female voice", "girl singer"
    re.compile(r"^(?:[a-z\-]+\s+){0,2}(?:male|female|man|woman|men|women|boy|girl|boyish|girlish)"
               r"\s+(?:vocal|vocals|voice|voices|singer|vocalist)$", re.I),
    # "soft vocal", "breathy vocals", "vocal", "voice"
    re.compile(r"^(?:[a-z\-]+\s+){0,2}(?:vocal|vocals|voice|vocalist)$", re.I),
    # 단독 음색 형용사(보컬 맥락 전용 단어만): breathy / husky / raspy / sultry / belted …
    re.compile(r"^(?:breathy|husky|raspy|sultry|belted|belting|nasal|falsetto)"
               r"(?:\s+(?:vocal|vocals|voice|tone))?$", re.I),
    # 한국어: 남성 보컬 / 여자 목소리 / 허스키 보컬
    re.compile(r"^(?:남성|여성|남자|여자|허스키한?|숨소리\s*섞인)\s*(?:보컬|목소리)$"),
]


def _clean_voice_persona_style_tokens(parts):
    """style 조각 리스트(쉼표 결합 전)에서 보컬 음색 토큰을 제거. 반환 (kept_parts, removed_count)."""
    kept = []
    removed = 0
    for part in parts:
        toks = [t.strip() for t in str(part or "").split(",")]
        keep_toks = []
        for t in toks:
            if not t:
                continue
            if any(rx.match(t) for rx in _VOICE_STYLE_DROP_RES):
                removed += 1
                continue
            keep_toks.append(t)
        if keep_toks:
            kept.append(", ".join(keep_toks))
    return kept, removed


# ── v3.281 [56] 짧은 곡 길이 대책 — 요청 길이 확인·style 지시·초과 로그 ──────────────
# Suno 는 보컬곡 길이를 직접 지정받지 않는다(duration 은 연주곡+V6 만 전송). 앱은 보컬곡에
# duration=120 을 고정 전송하므로 그 값은 의미가 없다 → 작사 원장(gen_jobs kind=lyrics)의
# meta.duration_minutes 를 lyrics_source.lyrics_id 로 찾아 '요청 길이'로 쓴다(best-effort).
SHORT_SONG_MAX_REQ_SEC = 90
SHORT_SONG_STYLE_HINT = "short song, under 1 minute, no extended intro or outro"
DURATION_OVERSHOOT_RATIO = 2.0


async def _resolve_requested_seconds(mongo_db, generation_id, duration, is_instrumental):
    """요청 곡 길이(초)와 출처를 반환. 모르면 (None, reason). 절대 raise 하지 않는다."""
    if is_instrumental:
        try:
            d = int(duration or 0)
        except (TypeError, ValueError):
            d = 0
        return (d, "param") if d > 0 else (None, "inst_auto")
    if mongo_db is None:
        return None, "no_db"
    try:
        from bson import ObjectId as _OID

        g = await mongo_db.generations.find_one(
            {"_id": _OID(generation_id)}, {"user_id": 1, "lyrics_source": 1},
        )
        lid = ((g or {}).get("lyrics_source") or {}).get("lyrics_id")
        uid = (g or {}).get("user_id")
        if not lid or not uid:
            return None, "no_lyrics_source"
        job = await mongo_db.gen_jobs.find_one(
            {"kind": "lyrics", "user_id": uid, "result.lyrics_id": lid},
            {"meta.duration_minutes": 1},
            sort=[("created_at", -1)],
        )
        dm = ((job or {}).get("meta") or {}).get("duration_minutes")
        if dm is None:
            return None, "no_lyrics_job"
        dm = int(dm)
        return (dm * 60, "lyrics_job") if dm > 0 else (None, "bad_dm")
    except Exception as exc:
        logger.warning("[suno] generation_id=%s requested-length lookup failed: %s", generation_id, exc)
        return None, "lookup_error"


def _check_duration_overshoot(generation_id, req_sec, req_src, songs):
    """결과 길이가 요청의 2배를 넘으면 로그만 남긴다(사용자 차단 없음)."""
    try:
        if not req_sec:
            return
        got = []
        for sng in songs or []:
            d = (sng or {}).get("duration")
            if d is not None:
                got.append(round(float(d), 1))
        if got and max(got) > req_sec * DURATION_OVERSHOOT_RATIO:
            logger.warning(
                "[suno] duration overshoot req=%s got=%s generation_id=%s src=%s",
                req_sec, got, generation_id, req_src,
            )
    except Exception as exc:
        logger.warning("[suno] generation_id=%s overshoot check failed: %s", generation_id, exc)


async def generate_music_suno(
    generation_id: str,
    lyrics: str = None,
    genre: str = None,
    mood: str = None,
    style: str = None,
    vocal: str = None,
    title: str = None,
    prompt: str = None,
    mongo_db=None,
    persona_id: str = None,
    negative_tags: str = None,
    style_weight: float = None,
    weirdness: float = None,
    audio_weight: float = None,
    persona_model: str = None,
    bpm: int = None,
    key: str = None,
    reference_audio_url: str = None,
    duet_main_vocal_style: str = None,
    duet_sub_vocal_style: str = None,
    suno_model: str = None,
    session_id: str = None,          # v3.200 creation-log 세션 (없으면 이벤트 생략)
    lyrics_version_id: str = None,   # v3.200 F5 — 요청에 들어간 가사 버전(§7.2)
    duration: int = None,            # v3.203: 연주곡(instrumental)+V6 한정 Suno duration(10~360s) 전달
) -> dict:
    """Generate music using Suno API."""

    if not settings.suno_api_key:
        raise ValueError("SUNO_API_KEY가 설정되지 않았습니다.")

    base_url = settings.suno_api_url.rstrip("/")
    headers = {
        "Authorization": f"Bearer {settings.suno_api_key}",
        "Content-Type": "application/json",
    }

    # Build style string (구조화된 값만 사용, 자연어 prompt는 제외)
    style_parts = []
    if genre:
        style_parts.append(genre)
    if mood:
        style_parts.append(mood)
    if style:
        style_parts.append(style)

    # v3.281 과제1(c) — 내 목소리(voice_persona + personaId) 곡은 성별·음색 묘사가 클론 목소리와
    # 충돌한다 → 프리셋 보컬 묘사·vocalGender 를 싣지 않고 style 의 음색 토큰을 제거한다.
    # (듀엣 보컬 묘사는 아래에서 그대로 추가 — 다른 경로 불변)
    _voice_clone_song = bool(persona_id) and (persona_model or "").strip().lower() == "voice_persona"

    # Vocal style from SUNO_VOCAL_MAP
    vocal_info = SUNO_VOCAL_MAP.get(vocal) if vocal else None
    if _voice_clone_song:
        style_parts, _vp_removed = _clean_voice_persona_style_tokens(style_parts)
        if vocal_info:
            _vp_removed += len([t for t in vocal_info["style"].split(",") if t.strip()]) + 1  # +1 = vocalGender
            vocal_info = None
        logger.info(
            "[suno] voice_persona style cleaned removed=%d generation_id=%s vocal=%s",
            _vp_removed, generation_id, vocal,
        )
    elif vocal_info:
        style_parts.append(vocal_info["style"])
    elif vocal and vocal.lower() != "instrumental":
        style_parts.append("vocal")

    # 듀엣 보컬 스타일을 style에 추가
    if duet_main_vocal_style:
        main_gender = "male" if vocal and vocal.lower() in ("m", "male_warm", "male_powerful", "male_soft") else "female"
        style_parts.append(f"{duet_main_vocal_style} {main_gender} vocal")
    if duet_sub_vocal_style:
        sub_gender = "female" if vocal and vocal.lower() in ("m", "male_warm", "male_powerful", "male_soft") else "male"
        style_parts.append(f"{duet_sub_vocal_style} {sub_gender} vocal")

    if bpm:
        style_parts.append(f"{bpm} BPM")
    if key:
        style_parts.append(f"{key}")

    # Determine if instrumental
    is_instrumental = bool(vocal and vocal.lower() == "instrumental")
    _has_lyrics = bool(lyrics and lyrics.strip())

    # Determine whether to use upload-cover endpoint (reference audio)
    use_upload_cover = bool(reference_audio_url)

    # v3.281 [56] — 요청 곡 길이(초). 보컬곡은 작사 원장 duration_minutes 기준(가사는 절단하지 않음).
    req_sec, req_src = await _resolve_requested_seconds(mongo_db, generation_id, duration, is_instrumental)
    _short_song = (not is_instrumental) and bool(req_sec) and req_sec <= SHORT_SONG_MAX_REQ_SEC
    if _short_song:
        style_parts.append(SHORT_SONG_STYLE_HINT)
    logger.info(
        "[suno] generation_id=%s requested_length req=%s src=%s short_song=%s",
        generation_id, req_sec, req_src, _short_song,
    )

    # v3.281 [57] — 보컬곡(가사 有·참고 음원 커버 아님) 진입 박 정렬 style 지시 (실험 스위치)
    _leadin_target = _has_lyrics and not is_instrumental and not use_upload_cover
    if _leadin_target and SUNO_CLEAN_INTRO_STYLE_HINT_ENABLED:
        style_parts.append(SUNO_CLEAN_INTRO_STYLE_HINT)

    # v3.283 — Suno 전송용 듀엣 가사 정규화(헤더·줄 라벨 → 섹션 태그). doc.lyrics 불변.
    # 구조 태그 보강(_ensure_lyrics_structure) 뒤에 적용해야 태그 없는 듀엣 가사도 자동 태그에 화자가 올라간다.
    _suno_lyrics_text = _ensure_lyrics_structure(lyrics.strip()) if _has_lyrics else None
    if _has_lyrics and not is_instrumental:
        try:
            _suno_lyrics_text, _duet_stats = _normalize_duet_lyrics_for_suno(_suno_lyrics_text)
        except Exception as _dn_exc:  # 정규화 실패가 작곡을 막지 않게 — 원문 그대로 전송
            _duet_stats = {"duet": False}
            logger.warning("[suno] duet lyrics normalize failed generation_id=%s: %s", generation_id, _dn_exc)
        if _duet_stats.get("duet"):
            _style_lc = ", ".join(style_parts).lower()
            _duet_hint = None
            if _voice_clone_song:
                _duet_hint = "skip_voice_persona"  # 클론 목소리와 성별 지시 충돌 — v3.281(c) 정책과 동일
            else:
                # DUET_STYLE_HINT 조각 중 style 에 이미 있는 것은 중복 추가하지 않는다.
                _add = []
                if "duet" not in _style_lc:
                    _add.append("duet")
                if "male and female" not in _style_lc:
                    _add.append("male and female vocals")
                if _add:
                    style_parts.append(", ".join(_add))
                    _duet_hint = "added"
                else:
                    _duet_hint = "present"
            logger.info(
                "[suno] duet lyrics normalized sections=%d moved_labels=%d switches=%d header_removed=%s "
                "style_hint=%s generation_id=%s",
                _duet_stats.get("sections", 0), _duet_stats.get("moved_labels", 0),
                _duet_stats.get("switches", 0), _duet_stats.get("header_removed"), _duet_hint, generation_id,
            )

    style_str = ", ".join(style_parts) if style_parts else "pop"
    logger.info("Suno style string: %s", style_str)

    # Build prompt - if custom mode with lyrics, include them
    # v3.203: 연주곡은 가사 없이도 customMode=true (duration 지원·style 필수 충족은 style_str 폴백 "pop" 보장)
    use_custom = _has_lyrics or is_instrumental
    prompt_text = _suno_lyrics_text if _has_lyrics else (title or "A beautiful song")
    # v3.281 [57] — 첫 보컬 섹션 앞 가사 없는 인트로 보장(태그 1줄 삽입만, 가사 불변).
    if _leadin_target:
        prompt_text, _leadin_action = _ensure_leadin_intro(prompt_text)
    else:
        _leadin_action = "skip_cover" if use_upload_cover else "skip"
    logger.info(
        "[suno] generation_id=%s leadin_intro=%s style_hint=%s",
        generation_id, _leadin_action,
        "on" if (_leadin_target and SUNO_CLEAN_INTRO_STYLE_HINT_ENABLED) else "off",
    )

    # v3.284 — 가사 속 괄호 연출(`(whisper) 가사`, `가사 (echo)`)을 단독 태그 줄(`[Whispered]`)로 올린다.
    # Suno 가 괄호를 코러스로 부르거나 정렬이 그 글자를 가사로 세어 싱크가 밀리던 문제(10-06 실데이터 18%).
    # leadin 뒤에 적용 — 앞에서 하면 첫 섹션의 태그 줄 때문에 '가사 없는 인트로'로 오판한다. doc.lyrics 불변.
    if _has_lyrics and not is_instrumental:
        try:
            from .lyrics_directions import lift_inline_directions

            prompt_text, _dir_stats = lift_inline_directions(prompt_text)
            if _dir_stats.get("lifted"):
                logger.info(
                    "[suno] generation_id=%s inline_directions lifted=%d lines=%d cues=%s",
                    generation_id, _dir_stats["lifted"], _dir_stats["lines"], _dir_stats.get("cues"),
                )
        except Exception as _dir_exc:  # 변환 실패가 작곡을 막지 않게 — 그 단계 전 텍스트 그대로 전송
            logger.warning("[suno] inline_directions lift failed generation_id=%s: %s", generation_id, _dir_exc)

    # v76.10: 호출자 명시 suno_model 우선.
    # v233(대표 실사고 2026-09-09): 호출자가 suno_model 을 안 넘기면 personaId 가 무시되던 문제 대응.
    # v3.177(대표 2026-09-15): Suno V5/V5_5 폐기(Deprecated) — sunoapi.org 기본이 V6 로 이전됨.
    #   voice_persona(보이스클론)·upload-cover 전부 V6 계열에서 지원 → 미지정 시 기본 모델을
    #   settings.suno_model_default(=V6) 로 통일한다. 구버전 강제(V5_5) 분기 제거.
    #   (호출자가 명시적으로 suno_model 을 넘기면 — 예: 구곡 재생성 doc — 그 값을 그대로 존중)
    resolved_model = (suno_model or "").strip()
    if not resolved_model:
        resolved_model = (settings.suno_model_default or "V6").strip()
    # v3.179(검증픽스): 구곡 재생성 doc 등에 저장된 폐기 모델(V5/V5_5/V4계열)이 명시 전달돼도
    # Suno가 하드 거부하는 시점에 깨지지 않도록 기본 모델로 방어 매핑 (V6 계열 명시는 존중).
    if resolved_model.upper() in {"V4", "V4_5", "V4_5PLUS", "V4_5ALL", "V5", "V5_5"}:
        logger.info(
            "[suno] generation_id=%s deprecated model %s → %s (defensive remap)",
            generation_id, resolved_model, settings.suno_model_default or "V6",
        )
        resolved_model = (settings.suno_model_default or "V6").strip()
    logger.info(
        "[suno] generation_id=%s resolved_model=%s (suno_model_in=%s use_upload_cover=%s persona=%s)",
        generation_id, resolved_model, suno_model, use_upload_cover, bool(persona_id),
    )

    # Request body
    body = {
        "prompt": prompt_text,
        "model": resolved_model,
        "customMode": use_custom,
        "instrumental": is_instrumental,
        "style": style_str[:1000],  # V5 limit
        "callBackUrl": "https://localhost/callback",  # Required by API, unused (we poll instead)
    }

    # Add uploadUrl for reference audio (upload-cover endpoint)
    if use_upload_cover:
        body["uploadUrl"] = reference_audio_url

    if use_custom and (title or is_instrumental):
        # v3.203: 연주곡 title 폴백 "Instrumental" (80자 제한)
        body["title"] = (title or "Instrumental")[:80]
    if vocal_info:
        body["vocalGender"] = vocal_info["gender"]

    # If a Suno Voice Persona is selected, include it in the request
    if persona_id:
        body["personaId"] = persona_id

    # Add optional advanced parameters
    if negative_tags:
        body["negativeTags"] = negative_tags
    if style_weight is not None:
        body["styleWeight"] = style_weight
    if weirdness is not None:
        body["weirdnessConstraint"] = weirdness
    if audio_weight is not None:
        body["audioWeight"] = audio_weight
    if persona_model:
        body["personaModel"] = persona_model

    # v3.229 V2 — 보이스(voice_persona) + 참고 음원 없음 + 보컬곡이면 서버 설정값으로 audioWeight 고정.
    # 설정이 비어 있으면(기본) 아무것도 바꾸지 않는다. 참고 음원이 있으면(upload-cover) 앱 값 존중.
    _is_voice_persona = (persona_model or "").strip().lower() == "voice_persona"
    _aw_override = None
    if _is_voice_persona and not use_upload_cover and not is_instrumental:
        _aw_override = voice_audio_weight_override()
        if _aw_override is not None:
            body["audioWeight"] = _aw_override
    if persona_id:
        # v3.229 V3 — 페르소나 곡 제출 직전 추적자(personaId 원문 미기록)
        logger.info(
            "[suno][voice] generation_id=%s persona submit model=%s personaModel=%s "
            "audioWeight req=%s sent=%s styleWeight=%s ref_audio=%s override=%s",
            generation_id, resolved_model, persona_model or None,
            audio_weight, body.get("audioWeight"), body.get("styleWeight"),
            use_upload_cover, "on" if _aw_override is not None else "off",
        )

    # v3.203: duration 은 연주곡+customMode(V6)에서만 전송 — 일반 보컬곡에 실으면
    # 앱이 고정 전송하는 duration:120 이 전 곡을 2분으로 클램프하는 회귀가 난다.
    if is_instrumental and duration and resolved_model.upper().startswith("V6"):
        body["duration"] = max(10, min(360, int(duration)))
    logger.info(
        "[suno] generation_id=%s customMode=%s instrumental=%s duration=%s",
        generation_id, use_custom, is_instrumental, body.get("duration"),
    )

    # ── v3.200 F1 — 엔진 전송 body 전문+canonical 해시 캡처 + GEN_REQUEST ──
    # 전문·해시는 생성 시점에만 확보 가능(소급 불가). 전부 best-effort —
    # 기록 실패가 생성 흐름을 절대 막지 않는다. 민감정보 로그 금지(해시·id만).
    requested_at = datetime.now(timezone.utc)
    req_body_hash = None
    is_regeneration_of = None
    try:
        from bson import ObjectId as _OID
        from .creation_log import append_event, request_body_hash

        req_body_hash = request_body_hash(body)  # §3.3 — callBackUrl 등 휘발 필드 제외 canonical SHA-256
        # §3.3 is_regeneration_of — 같은 유저의 동일 해시 과거 요청 중 최초 건을 가리킨다.
        _own = await mongo_db.generations.find_one({"_id": _OID(generation_id)}, {"user_id": 1})
        _uid = (_own or {}).get("user_id")
        if _uid:
            _orig = await mongo_db.generations.find_one(
                {
                    "user_id": _uid,
                    "suno_request_body_hash": req_body_hash,
                    "_id": {"$ne": _OID(generation_id)},
                },
                {"_id": 1},
                sort=[("created_at", 1)],
            )
            if _orig:
                is_regeneration_of = str(_orig["_id"])
        # 요청 전문 캡처는 doc 에 즉시 $set (F1 §3.2: request_body/hash/requested_at)
        await mongo_db.generations.update_one(
            {"_id": _OID(generation_id)},
            {"$set": {
                "suno_request_body": body,
                "suno_request_body_hash": req_body_hash,
                "requested_at": requested_at,
                "is_regeneration_of": is_regeneration_of,
                "engine_model": resolved_model,
            }},
        )
        if session_id:
            # §3.3 — 요청 전송 직전 GEN_REQUEST (actor=server, 해시 체인은 서버 계산)
            await append_event(
                session_id, "GEN_REQUEST", "server",
                payload={
                    "request_id": generation_id,
                    "request_body_hash": req_body_hash,
                    "engine": "suno",
                    "engine_model": resolved_model,
                    "is_regeneration_of": is_regeneration_of,
                    "lyrics_input_version_id": lyrics_version_id,
                },
            )
    except Exception as _cl_exc:
        logger.warning("[creation-log] GEN_REQUEST capture failed gen_id=%s: %s", generation_id, _cl_exc)

    # Update progress: starting
    await _update_progress(mongo_db, generation_id, 10, "processing")

    # Step 1: Submit generation request
    generate_endpoint = (
        f"{base_url}/api/v1/generate/upload-cover"
        if use_upload_cover
        else f"{base_url}/api/v1/generate"
    )
    logger.info(
        "Suno: using %s endpoint for generation %s (reference_audio=%s)",
        "upload-cover" if use_upload_cover else "generate",
        generation_id,
        bool(reference_audio_url),
    )

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            generate_endpoint,
            headers=headers,
            json=body,
        )
        resp.raise_for_status()
        result = resp.json()

    if result.get("code") != 200:
        raise ValueError(f"Suno API 오류: {result.get('msg', 'Unknown error')}")

    task_id = result["data"]["taskId"]
    logger.info("Suno: generation %s started, taskId=%s", generation_id, task_id)
    _submitted_mono = time.monotonic()  # v3.229 V3 — 제출→SUCCESS 소요초

    # Update progress: submitted
    await _update_progress(mongo_db, generation_id, 20, "processing")

    # Step 2: Poll for completion
    # v76.11: voice clone (persona_model=voice_persona) 는 일반보다 학습/생성 오래 걸림 → timeout 12분.
    # 일반은 기존 5분 유지. 매 poll 마다 status 로그 추가 (이전엔 status 안 찍혀서 진단 불가).
    is_voice_clone = (persona_model or "").strip().lower() == "voice_persona"
    max_polls = 240 if is_voice_clone else 60  # 240*5s=20min, 60*5s=5min — voice clone 은 보수적 마진
    logger.info(
        "[suno] gen_id=%s poll loop start max_polls=%d (~%dmin) is_voice_clone=%s",
        generation_id, max_polls, max_polls * 5 // 60, is_voice_clone,
    )
    audio_url = None
    suno_data = None
    status_data = None
    responded_at = None  # v3.200 F1 — 엔진 응답(SUCCESS record-info) 수신 시각(서버 UTC)

    for poll_attempt in range(max_polls):
        await asyncio.sleep(5)

        async with httpx.AsyncClient(timeout=30) as client:
            status_resp = await client.get(
                f"{base_url}/api/v1/generate/record-info",
                headers=headers,
                params={"taskId": task_id},
            )
            status_resp.raise_for_status()
            status_data = status_resp.json()

        data_obj = status_data.get("data") or {}
        status = data_obj.get("status", "")
        err_code = data_obj.get("errorCode")
        err_msg = data_obj.get("errorMessage") or ""
        if poll_attempt % 6 == 0 or status not in ("PENDING", ""):  # 매 30초 또는 status 변화 시
            logger.info(
                "[suno] gen_id=%s poll attempt=%d/%d status=%s err_code=%s err_msg=%s",
                generation_id, poll_attempt, max_polls, status or "?", err_code, (err_msg or "")[:120],
            )

        if status in SUNO_TERMINAL_ERROR_STATUSES or status.endswith(("_FAILED", "_ERROR", "_EXCEPTION")):
            logger.warning(
                "[suno] gen_id=%s terminal error status=%s err_code=%s err_msg=%s -> fail",
                generation_id, status, err_code, (err_msg or "")[:200],
            )
            _msg_lower = (err_msg or "").lower()
            if "expired" in _msg_lower or (status == "SENSITIVE_WORD_ERROR" and "voice" in _msg_lower):
                user_msg = "선택한 보이스가 만료되었습니다. 목소리를 다시 학습시키거나 다른 보컬을 선택해 주세요."
                # 만료된 클론을 자동으로 status='expired' 로 플래그 (이 루프의 motor client 사용).
                if persona_id:
                    try:
                        flagged = await mongo_db.voice_clones.find_one_and_update(
                            {"$or": [{"voice_id": persona_id}, {"generate_task_id": persona_id}], "status": {"$ne": "expired"}},
                            {"$set": {"status": "expired", "expired_at": datetime.now(timezone.utc), "expired_reason": (err_msg or "")[:200]}},
                        )
                        # v240(대표 확정 2026-09-11): 만료는 무환불 — 다시 학습(⭐5)하면 됨.
                        # 학습 "실패"(B-9 failed 전이) 환불만 유지.
                        logger.warning("[suno] gen_id=%s voice expired -> flag clone persona_id=%s matched=%d (무환불)", generation_id, persona_id, 1 if flagged else 0)
                    except Exception as _flag_exc:
                        logger.warning("[suno] gen_id=%s voice-clone expire-flag failed: %s", generation_id, _flag_exc)
            else:
                user_msg = f"Suno 음악 생성에 실패했습니다{': ' + err_msg if err_msg else ''}"
            raise ValueError(user_msg)

        # Update progress based on status
        if status == "TEXT_SUCCESS":
            await _update_progress(mongo_db, generation_id, 40, "processing")
        elif status == "FIRST_SUCCESS":
            await _update_progress(mongo_db, generation_id, 70, "processing")
        elif status == "SUCCESS":
            responded_at = datetime.now(timezone.utc)  # v3.200 F1
            suno_songs = status_data["data"]["response"]["sunoData"]
            if suno_songs:
                suno_data = suno_songs[0]  # Use first of 2 generated songs (BC)
                audio_url = suno_data.get("audioUrl")
            logger.info(
                "[SunoVariants] gen_id=%s polled SUCCESS suno_songs_count=%d",
                generation_id, len(suno_songs) if suno_songs else 0,
            )
            _check_duration_overshoot(generation_id, req_sec, req_src, suno_songs)  # v3.281 [56]
            if persona_id:
                # v3.229 V3 — 공급자가 받은 파라미터(요청 에코) 대조. personaId 는 bool 만.
                try:
                    _echo = _suno_param_echo(status_data)
                    logger.info(
                        "[suno][voice] generation_id=%s persona audioWeight req=%s sent=%s echo=%s "
                        "echo_persona=%s echo_personaModel=%s echo_model=%s model_name=%s secs=%.1f echo_keys=%s",
                        generation_id, audio_weight, body.get("audioWeight"),
                        _echo.get("audioWeight") if _echo else "n/a",
                        _echo.get("persona") if _echo else "n/a",
                        _echo.get("personaModel") if _echo else "n/a",
                        _echo.get("model") if _echo else "n/a",
                        [(s or {}).get("model_name") for s in (suno_songs or [])],
                        time.monotonic() - _submitted_mono,
                        _echo.get("keys") if _echo else [],
                    )
                except Exception as _echo_exc:
                    logger.warning("[suno][voice] generation_id=%s echo log failed: %s", generation_id, _echo_exc)
            break
        else:
            # PENDING or other - gradually increase progress
            progress = min(20 + poll_attempt, 60)
            await _update_progress(mongo_db, generation_id, progress, "processing")

    if not audio_url:
        # 마지막 본 status 도 같이 표시
        last_status = (status_data or {}).get("data", {}).get("status", "?") if status_data else "?"
        raise ValueError(f"Suno 음악 생성 시간이 초과되었습니다 (last_status={last_status}, polls={max_polls}, ~{max_polls*5//60}min).")

    # Step 3: Download audio and upload to MinIO
    await _update_progress(mongo_db, generation_id, 85, "processing")

    async with httpx.AsyncClient(timeout=120) as client:
        audio_resp = await client.get(audio_url)
        audio_resp.raise_for_status()
        audio_bytes = audio_resp.content

    # Upload to MinIO
    minio_client = get_minio()
    object_name = f"generated/{generation_id}/suno_output.mp3"

    # v3.200 F1 — 원본 오디오 SHA-256 (엔진에서 받은 바이트 그대로, 재인코딩 금지 유지 §16-2)
    audio_sha256_0 = hashlib.sha256(audio_bytes).hexdigest()

    minio_client.put_object(
        bucket_name=settings.minio_bucket_music,
        object_name=object_name,
        data=io.BytesIO(audio_bytes),
        length=len(audio_bytes),
        content_type="audio/mpeg",
    )

    # v74 — Collect all variants (both songs if available) and persist each
    # variant's audio_url + suno_audio_id + lyrics timestamps.
    # Hierarchy: variants[0] mirrors result_audio_url / suno_audio_id for BC.
    output_files = [object_name]
    variants: list[dict] = [{
        "index": 0,
        "audio_url": object_name,
        "suno_audio_id": suno_data.get("id", ""),
        "audio_sha256": audio_sha256_0,  # v3.200 F1
        "timestamps": [],
    }]

    all_suno_songs = status_data["data"]["response"].get("sunoData", [])
    if len(all_suno_songs) > 1:
        second = all_suno_songs[1]
        second_url = second.get("audioUrl")
        second_audio_id = second.get("id", "")
        if second_url:
            try:
                async with httpx.AsyncClient(timeout=120) as client:
                    audio2_resp = await client.get(second_url)
                    audio2_resp.raise_for_status()
                second_object = f"generated/{generation_id}/suno_output_2.mp3"
                # v3.200 F1 — variant 1 원본 SHA-256 (put 직전 bytes)
                audio_sha256_1 = hashlib.sha256(audio2_resp.content).hexdigest()
                minio_client.put_object(
                    bucket_name=settings.minio_bucket_music,
                    object_name=second_object,
                    data=io.BytesIO(audio2_resp.content),
                    length=len(audio2_resp.content),
                    content_type="audio/mpeg",
                )
                output_files.append(second_object)
                variants.append({
                    "index": 1,
                    "audio_url": second_object,
                    "suno_audio_id": second_audio_id,
                    "audio_sha256": audio_sha256_1,  # v3.200 F1
                    "timestamps": [],
                })
                logger.info(
                    "[SunoVariants] gen_id=%s variant=1 stored object=%s audio_id_len=%d",
                    generation_id, second_object, len(second_audio_id),
                )
            except Exception as e:
                logger.warning(
                    "[SunoVariants] gen_id=%s variant=1 download/store failed: %s",
                    generation_id, e,
                )
        else:
            logger.warning(
                "[SunoVariants] gen_id=%s variant=1 missing audioUrl in suno response",
                generation_id,
            )
    else:
        logger.info(
            "[SunoVariants] gen_id=%s only 1 variant returned by Suno",
            generation_id,
        )

    # v74 — Fetch lyrics timestamps for each variant in parallel.
    # Individual failures yield empty list (do not block completion).
    try:
        from .suno_timestamp_service import get_suno_timestamps

        async def _fetch_one(v_audio_id: str) -> list[dict]:
            if not v_audio_id:
                return []
            try:
                return await get_suno_timestamps(task_id, v_audio_id) or []
            except Exception as _ts_exc:
                logger.warning(
                    "[SunoVariants] gen_id=%s timestamps fetch failed for audio_id_len=%d: %s",
                    generation_id, len(v_audio_id), _ts_exc,
                )
                return []

        ts_results = await asyncio.gather(
            *[_fetch_one(v["suno_audio_id"]) for v in variants],
            return_exceptions=False,
        )
        for v, segs in zip(variants, ts_results):
            v["timestamps"] = segs or []

        logger.info(
            "[SunoVariants] gen_id=%s variant_count=%d timestamps_lens=%s",
            generation_id,
            len(variants),
            [len(v["timestamps"]) for v in variants],
        )
    except Exception as _gather_exc:
        logger.warning(
            "[SunoVariants] gen_id=%s timestamps gather failed: %s",
            generation_id, _gather_exc,
        )

    # Update MongoDB (variants is new; result_audio_url/output_files/suno_audio_id remain BC)
    await _update_progress(mongo_db, generation_id, 100, "completed", {
        "result_audio_url": object_name,
        "output_files": output_files,
        "variants": variants,
        "completed_at": datetime.utcnow(),
        "suno_task_id": task_id,
        "suno_audio_id": suno_data.get("id", ""),
        # v3.200 F1 — 응답 전문(최종 record-info)·응답 시각 보존 (§3.2 engine_response_raw)
        "suno_response_raw": status_data,
        "responded_at": responded_at,
        # v3.244 — 스위치 OFF 면 "skipped" (추출 훅은 beat_extraction 중앙 게이트가 no-op)
        "beats_status": "pending" if settings.beats_extraction_enabled else "skipped",
    })

    # ── v3.200 F1 — GEN_RESPONSE (응답·원본 저장 완료 직후 §3.3, best-effort) ──
    # engine_clip_id = record-info sunoData[].id (§16-1 확정), 작업 단위 taskId 병행.
    # candidate_id = "{gen_id}:v{index}" — FINALIZE(§4.4)·CANDIDATE_SELECT 가 참조.
    if session_id:
        try:
            from .creation_log import append_event as _cl_append

            _candidates = []
            for _v in variants:
                _idx = _v["index"]
                _song = all_suno_songs[_idx] if _idx < len(all_suno_songs) else {}
                _dur = _song.get("duration")
                _candidates.append({
                    "candidate_id": f"{generation_id}:v{_idx}",
                    "engine_clip_id": _v.get("suno_audio_id") or "",
                    "audio_sha256": _v.get("audio_sha256"),
                    "duration_ms": int(float(_dur) * 1000) if _dur is not None else None,
                })
            await _cl_append(
                session_id, "GEN_RESPONSE", "engine:suno",
                payload={
                    "request_id": generation_id,
                    "status": "ok",
                    "task_id": task_id,
                    "candidates": _candidates,
                },
            )
        except Exception as _cl_exc:
            logger.warning("[creation-log] GEN_RESPONSE record failed gen_id=%s: %s", generation_id, _cl_exc)

    logger.info("Suno: generation %s completed, object=%s", generation_id, object_name)

    # StarEcon(v158) — 완성 리베이트 +1 제거(v1.2 표에 없음) → 디렉터 피로
    # 완성 훅으로 교체: 그날 완성 카운트 +1 + 사다리 쿨다운 시작. best-effort
    # (생성 완료 흐름에 절대 영향 없음). 이 코루틴은 배경 루프에서 돌므로
    # 반드시 루프-로컬 mongo_db 를 주입한다 (메인 루프 get_mongo() 금지).
    try:
        from bson import ObjectId as _OID
        from .fatigue_service import on_generation_completed

        _gen_doc = await mongo_db.generations.find_one(
            {"_id": _OID(generation_id)}, {"user_id": 1}
        )
        _gen_user_id = (_gen_doc or {}).get("user_id")
        if _gen_user_id:
            await on_generation_completed(_gen_user_id, db=mongo_db)
            logger.info(
                "[fatigue] completion hook ok gen_id=%s user=%s",
                generation_id, _gen_user_id[:8],
            )
    except Exception as _ftg_exc:
        logger.warning(
            "[fatigue] completion hook failed gen_id=%s: %s", generation_id, _ftg_exc
        )

    # v44 — Background beat extraction (same loop, await to keep wrapper-loop
    # alive until completion). The user-facing generation status is already
    # "completed" so a polling client can use the audio URL immediately;
    # `beats_status` is a separate field tracked via /generate/{id}/beats.
    # We pass the loop-local motor `mongo_db` through so updates land in DB.
    try:
        from .beat_extraction import detect_beats_for_generation_with_db

        await detect_beats_for_generation_with_db(generation_id, mongo_db)
    except Exception as _be:
        logger.warning(
            "Suno: post-completion beat extraction failed for %s: %s",
            generation_id, _be,
        )

    return {
        "result_audio_url": object_name,
        "output_files": output_files,
        "variants": variants,
    }


async def _update_progress(mongo_db, generation_id: str, progress: int, status: str, extra: dict = None):
    """Update generation progress in MongoDB."""
    from bson import ObjectId
    update = {
        "progress": progress,
        "status": status,
        "updated_at": datetime.utcnow(),
    }
    if extra:
        update.update(extra)
    await mongo_db.generations.update_one(
        {"_id": ObjectId(generation_id)},
        {"$set": update},
    )


# v76: Suno V5_5 voice cloning endpoints (separate from old voice_persona flow)
SUNO_VOICE_VALIDATE_URL = "{base}/api/v1/voice/validate"
SUNO_VOICE_VALIDATE_INFO_URL = "{base}/api/v1/voice/validate-info"  # v76.2: validate phrase 폴링용
SUNO_VOICE_REGENERATE_URL = "{base}/api/v1/voice/regenerate"
SUNO_VOICE_GENERATE_URL = "{base}/api/v1/voice/generate"
SUNO_VOICE_RECORD_INFO_URL = "{base}/api/v1/voice/record-info"
SUNO_VOICE_CHECK_URL = "{base}/api/v1/voice/check-voice"
