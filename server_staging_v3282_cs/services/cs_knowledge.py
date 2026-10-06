"""v3.282 CS 워커 지식 베이스 — 정책·사용법·자주 묻는 질문·알려진 문제(한국어 구조화 텍스트).

원칙
  - 별(⭐) 단가·보너스·캡 같은 수치는 **서버 코드 상수에서 읽어 인용**한다(추정 금지). 상수를 못 읽으면
    아래 _FALLBACK 값(2026-10-06 라이브 코드 실측)을 쓴다.
  - 사용법 문구는 앱(2_housing) UI 문자열 실측 기준(2026-10-06). 화면이 바뀌면 HOW_TO 만 고치면 된다.
  - 수정 이력은 관리자가 갱신하기 쉽도록 `KNOWN_ISSUES` 리스트로 분리했다. 항목 추가 시
      {"id": 영문 짧은 키(고유), "date": "YYYY-MM-DD"(사용자 안내용 날짜), "status": "fixed"|"in_progress",
       "symptom": 사용자가 말하는 증상, "answer": 안내 요지}
    status="fixed" 만 AI 가 "고쳐졌어요"로 자동 답변하고, "in_progress" 는 접수 안내 후 관리자 큐로 간다.
  - 내부 버전 코드(v3.xxx)·담당자 이름은 넣지 않는다(LLM 이 그대로 노출할 수 있음). 날짜만.
"""

from typing import Dict, List, Optional

# 라이브 코드 실측값(2026-10-06) — 상수 import 실패 시에만 사용
_FALLBACK = {
    "POINT_COSTS": {"lyrics": 5, "compose": 15, "cover": 5, "cover_refine": 5, "share_video": 5, "character": 10,
                    "fatigue_skip": 5, "hire_director": 10, "extra_slot": 15, "voice_clone": 5, "instrumental": 5},
    "SKIP_POINT_COSTS": {"composer": 5, "lyricist": 2, "image": 2, "artist": 3, "video": 2},
    "SKIP_MINUTES": 30,
    "MAX_BULK_UNITS": 24,
    "ATTENDANCE": (10, 30, 100),
    "BETA_SIGNUP_BONUS_AMOUNT": 50,
    "BETA_SIGNUP_BONUS_UNTIL_KST": (2026, 10, 30),
    "GUEST_COMPOSE_RETENTION_DAYS": 7,
    "VOICE_STALE_TIMEOUT_MIN": 30,
}

SIGNUP_BONUS = 50          # routes/auth.py·oauth.py credit_points("signup_bonus", 50)
REFERRAL_BONUS = 50        # referral_inviter / referral_joiner 각 50
PROFILE_BONUS = 10         # profile_bonus 10
# 보호자 동의 보상(guardian_consent_reward)은 settings.verify_reward_points 가 라이브 0 → 미지급이라 KB 에서 제외
#   (앱 StarGuideModal 은 '+30' 표기 — 불일치, 관련 문의는 상담원 이관).
UPLOAD_BONUS = 5           # routes/tracks.py credit_points("upload", 5)
PLAY_DAILY_CAP = 5         # routes/charts.py award_point("play", daily_cap=5)


def _consts() -> dict:
    c = {k: (dict(v) if isinstance(v, dict) else v) for k, v in _FALLBACK.items()}
    try:
        from .points_service import POINT_COSTS
        c["POINT_COSTS"] = dict(POINT_COSTS)
    except Exception:
        pass
    try:
        from .fatigue_service import MAX_BULK_UNITS, SKIP_MINUTES, SKIP_POINT_COSTS
        c["SKIP_POINT_COSTS"] = dict(SKIP_POINT_COSTS)
        c["SKIP_MINUTES"] = SKIP_MINUTES
        c["MAX_BULK_UNITS"] = MAX_BULK_UNITS
    except Exception:
        pass
    try:
        from .attendance_service import _reward_for
        c["ATTENDANCE"] = (_reward_for(1), _reward_for(5), _reward_for(10))
    except Exception:
        pass
    try:
        from ..routes.auth import BETA_SIGNUP_BONUS_AMOUNT, BETA_SIGNUP_BONUS_UNTIL_KST
        c["BETA_SIGNUP_BONUS_AMOUNT"] = BETA_SIGNUP_BONUS_AMOUNT
        c["BETA_SIGNUP_BONUS_UNTIL_KST"] = tuple(BETA_SIGNUP_BONUS_UNTIL_KST)
    except Exception:
        pass
    try:
        from ..routes.generate import GUEST_COMPOSE_RETENTION_DAYS
        c["GUEST_COMPOSE_RETENTION_DAYS"] = GUEST_COMPOSE_RETENTION_DAYS
    except Exception:
        pass
    try:
        from .voice_clone_service import STALE_TIMEOUT_MIN
        c["VOICE_STALE_TIMEOUT_MIN"] = STALE_TIMEOUT_MIN
    except Exception:
        pass
    return c


# ─── 알려진 문제(최근 수정 이력) — 관리자 갱신용 ───────────────────────────────
KNOWN_ISSUES: List[Dict[str, str]] = [
    {"id": "bg_playback", "date": "2026-10-04", "status": "fixed",
     "symptom": "웹에서 화면을 끄거나 다른 앱으로 가면 연속 재생이 끊김 / 2곡 듣다 멈춤",
     "answer": "10월 1일·4일 업데이트에서 네트워크가 잠깐 끊겨도 같은 곡을 자동으로 다시 불러오고, 다음 곡을 미리 준비하도록 고쳤어요. "
               "단, 아이폰 사파리 같은 웹 브라우저는 화면이 꺼지면 브라우저가 페이지 자체를 멈출 수 있어 완전히 막기는 어려워요. "
               "웹은 새로고침한 뒤 다시 확인해 주세요."},
    {"id": "inst_autoplay", "date": "2026-10-04", "status": "fixed",
     "symptom": "연속 재생·다음 곡에서 Inst.(반주) 버전이 계속 나옴",
     "answer": "자동 재생과 '다음' 버튼 모두 Inst. 버전은 건너뛰도록 10월 4일에 고쳤어요. 직접 누른 Inst. 곡은 그대로 재생돼요."},
    {"id": "always_shuffle", "date": "2026-09-29", "status": "fixed",
     "symptom": "항상 랜덤(셔플) 재생됨, 추천 곡이 매번 같음",
     "answer": "9월 29일에 차트에서 곡을 누르면 셔플이 풀리고 그 곡과 비슷한 곡이 이어지도록 고쳤고, 10월 1일에 추천이 더 다양해지도록 바꿨어요."},
    {"id": "mypage_20_limit", "date": "2026-10-01", "status": "fixed",
     "symptom": "마이페이지에 곡이 20개까지만 보임 / 내 곡 성적표와 주간 차트 재생수 순위가 다름 / 영상 디렉터에 최근 곡만 보임",
     "answer": "최근 20곡만 불러오던 문제를 10월 1일에 고쳐서 모든 곡이 보이고 성적표도 전체 곡 기준으로 계산돼요. 앱·웹을 새로고침해 주세요."},
    {"id": "cover_rollback", "date": "2026-09-29", "status": "fixed",
     "symptom": "새로 만든 커버가 예전 커버로 되돌아감",
     "answer": "커버 저장 후 이전 작업 정보가 남아 옛 커버가 다시 적용되던 문제를 9월 29일에 고쳤어요."},
    {"id": "cover_lost_before_save", "date": "2026-10-01", "status": "fixed",
     "symptom": "커버를 저장하기 전에 화면을 나가면 만든 커버가 사라짐",
     "answer": "10월 1일부터는 저장하지 않고 나가도 다시 들어오면 마지막 결과와 버전 기록이 복원돼요."},
    {"id": "long_stall", "date": "2026-10-01", "status": "fixed",
     "symptom": "곡 생성이 오래(30분 가까이) 멈춤 / 다시 만들었더니 별이 또 빠짐",
     "answer": "생성이 일정 시간(최대 25~30분) 넘게 끝나지 않으면 자동으로 실패 처리되고 사용한 별은 자동 환불돼요. "
               "진행 중인 기록을 지워도 1회 환불되도록 10월 1일에 고쳤어요. 별 내역은 설정 > 계정 관리 > 스타 내역에서 볼 수 있어요."},
    {"id": "ab_single_result", "date": "2026-10-01", "status": "fixed",
     "symptom": "작곡 결과가 A/B 두 개가 아니라 한 개만 나옴",
     "answer": "이전 결과 화면 상태가 남아 한 버전만 보이던 문제를 10월 1일에 고쳤어요."},
    {"id": "edit_sheet_closes", "date": "2026-10-01", "status": "fixed",
     "symptom": "가사·플레이리스트 이름 수정 창이 입력 중에 닫힘 / 가사 수정이 반영 안 됨",
     "answer": "수정 창이 저절로 닫히던 문제를 10월 1일에 고쳤어요(작사 요청 확인, 플레이리스트 이름 변경, 크루 플레이리스트 만들기)."},
    {"id": "notification_tap", "date": "2026-10-01", "status": "fixed",
     "symptom": "알림을 눌러도 아무 반응이 없음",
     "answer": "10월 1일에 알림을 누르면 해당 피드·곡 댓글 등으로 바로 이동하도록 고쳤어요."},
    {"id": "dm_photo_zoom", "date": "2026-10-04", "status": "fixed",
     "symptom": "메시지로 받은 사진을 눌러도 크게 안 보임",
     "answer": "10월 4일부터 메시지 사진을 누르면 전체 화면으로 크게 볼 수 있어요."},
    {"id": "song_length", "date": "2026-10-06", "status": "fixed",
     "symptom": "곡 길이를 1분으로 설정했는데 3분짜리 곡이 나옴",
     "answer": "작곡 AI는 길이를 정확히 지정받지 않고 가사 분량에 따라 길이가 정해져요. 10월 6일에 짧은 곡을 고르면 가사와 구성을 짧게 만들도록 개선했어요. 그래도 설정과 조금 다를 수 있어요."},
    {"id": "intro_offbeat", "date": "2026-10-06", "status": "fixed",
     "symptom": "곡 도입부에서 가사와 반주가 엇박으로 들어감",
     "answer": "10월 6일에 가사 없는 도입부를 넣도록 개선했어요. 생성 특성상 완전히 없어지지 않을 수 있어서, A/B 두 버전 중 자연스러운 쪽을 고르는 것도 방법이에요."},
    {"id": "character_save_nav", "date": "2026-10-06", "status": "fixed",
     "symptom": "아티스트(캐릭터) 저장 후 목록으로 자동으로 안 넘어감",
     "answer": "10월 6일부터 저장하면 내 아티스트 목록으로 바로 이동해요."},
    {"id": "video_length", "date": "2026-10-06", "status": "fixed",
     "symptom": "영상 길이가 곡마다 다름(전체 길이 vs 15초)",
     "answer": "영상 형식에 따라 길이가 달라요. SNS용 세로·와이드 가로는 곡 전체, 카톡 프로필 배경은 15초예요. 10월 6일부터 형식별 길이를 표시하고, 15초 영상은 시작 구간을 고를 수 있어요."},
    {"id": "outfit_face", "date": "2026-10-06", "status": "fixed",
     "symptom": "다른 아티스트의 의상을 바꾸면 대표 아티스트 얼굴로 입혀짐",
     "answer": "의상 바꾸기가 대표 아티스트 사진을 잘못 쓰던 문제를 10월 6일에 고쳤어요."},
    {"id": "outfit_gender", "date": "2026-10-06", "status": "in_progress",
     "symptom": "남성을 골랐는데 옷 고르기에 여성 의류가 섞여 나옴",
     "answer": "10월 6일에 가방·모자에도 성별 필터를 적용하고 상품명으로 성별을 구분하도록 개선했어요. 일부 브랜드 상품은 아직 정리 중이에요."},
    {"id": "ab_other_song", "date": "2026-10-06", "status": "fixed",
     "symptom": "A/B 버전 고르는 중에 다른(이전) 곡이 재생 중으로 표시됨(잠금화면 등)",
     "answer": "10월 6일에 비교 화면에 들어가면 이전 곡을 멈추고 잠금화면 표시도 비교 중인 버전으로 바뀌도록 고쳤어요."},
    {"id": "old_video_black", "date": "2026-09-29", "status": "fixed",
     "symptom": "예전에 만든 영상이 아이폰에서 검은 화면으로 재생 안 됨",
     "answer": "9월 29일에 아이폰 사파리에서 지난 영상이 재생되도록 고쳤어요."},
    {"id": "subtitle_duet", "date": "2026-10-04", "status": "fixed",
     "symptom": "영상 자막(가사) 타이밍이 처음에 몰리거나 안 맞음(특히 듀엣 곡)",
     "answer": "가사 타이밍이 깨진 곡은 틀린 자막 대신 자막 없이 만들도록 10월 4일에 바꿨어요. 정확한 자막을 다시 만드는 기능은 아직 없어요."},
    {"id": "voice_2h_expiry", "date": "2026-09-29", "status": "fixed",
     "symptom": "내 목소리가 2시간 뒤 사용 불가 / 목소리 샘플을 다시 올려야 함",
     "answer": "9월 29일에 2시간 제한을 없앴어요. 이제 작곡할 때 목소리가 살아있는지만 확인하고, 올렸던 샘플은 보관함에 남아 다시 올리지 않고 재학습할 수 있어요."},
    {"id": "feeling_search", "date": "2026-09-29", "status": "fixed",
     "symptom": "'슬픔' 같은 느낌 검색·칩에 최신 곡이 안 나옴",
     "answer": "9월 29일에 최근 발매곡도 느낌(카테고리)으로 검색되도록 고쳤어요."},
    {"id": "lyrics_lost", "date": "2026-09-29", "status": "fixed",
     "symptom": "작사·작곡 진행 중 화면을 다녀오면 내용이 사라짐",
     "answer": "9월 29일부터 작곡·영상 진행 내용이 자동 저장돼요. 작업실에서 '이어서 하기'로 계속할 수 있어요."},
    {"id": "logout_lyrics_visible", "date": "2026-10-04", "status": "fixed",
     "symptom": "로그아웃했는데 이전 계정의 작사 내용이 보임",
     "answer": "10월 4일에 고쳤어요. 로그아웃하면 작사 작업본은 계정별로 보관되고 다시 로그인하면 돌아와요."},
    {"id": "slow_loading", "date": "2026-10-06", "status": "fixed",
     "symptom": "앱·웹이 느림, 커버 이미지가 늦게 뜸",
     "answer": "10월 4일 커버 이미지를 가벼운 썸네일로 바꾸고, 10월 6일 데이터 압축을 적용해 목록 로딩을 줄였어요."},
]

_KNOWN_BY_ID = {k["id"]: k for k in KNOWN_ISSUES}


def get_known_issue(issue_id: Optional[str]) -> Optional[dict]:
    if not issue_id:
        return None
    return _KNOWN_BY_ID.get(str(issue_id).strip())


# ─── 사용법(앱 UI 문자열 실측 2026-10-06) ──────────────────────────────────
HOW_TO = """[사용법]
H1 곡 만들기: 하단 '작업실' 탭에서 디렉터(아티스트·작사·작곡·이미지·영상)를 눌러 시작. 하던 작업이 있으면 '이어서 하기'.
H2 작사: 작사 디렉터와 대화 → 결과에서 제목·가사 [수정], [다시 생성하기](⭐ 사용), [보관함에 저장], [저장하고 작곡하러 가기]. 가사 보관함은 작사 디렉터 시작 화면의 '가사 보관함' 버튼(재설치·기기 변경에도 유지).
H3 작곡: 작곡 디렉터에서 가사를 '방금 작사/보관함/발매곡' 중 고르거나 '가사 없이 만들기(연주곡)'. 결과는 A/B 두 버전 — 고른 버전이 트랙으로 저장(마이뮤직에서 확인). 저장 직후 곡은 비공개.
H4 공개(차트 업로드): 상단 👤(마이페이지) → 곡의 ⋮ → '차트에 업로드'. 숨기려면 '차트에서 숨기기'(언제든 다시 업로드 가능). 영상은 공개 곡만 만들 수 있음.
H5 생성 이력: 작업실의 '생성 이력' — 생성중/발매됨/완료/실패 확인, 진행 중인 생성도 여기서 이어보기. 다른 화면에 다녀와도 생성은 계속 진행되고 완성되면 알림.
H6 디렉터 휴식: 디렉터는 작업을 마치면 휴식(쿨다운)에 들어감. 팝업에서 30분 단위로 ⭐를 써서 줄이거나, 앱(네이티브)에서는 '광고 보고 30분 줄이기'. 웹에서는 광고 버튼이 없음. 광고는 별을 주지 않고 휴식 단축에만 쓰임.
H7 내 목소리: 아티스트 목소리로 '간편 목소리'(성별+스타일) 또는 '내 목소리' 중 하나. 내 목소리 만들기 = 반주 없이 노래 녹음 최소 30초(1분 이상 권장, 최대 2분, 조용한 곳) → 낭독 문구 따라 읽기(검증 녹음) → 학습. 이전에 올린 샘플은 보관함에서 골라 다시 올리지 않고 학습 가능.
H8 커버 이미지: 작곡 결과 화면 '커버 이미지 생성하기' 또는 '보관함에서 커버 선택'. 스타일·구도·팔레트 선택.
H9 편곡하기: 작곡 결과 화면에서 '편곡하기' — 가사와 목소리는 그대로, 사운드만 새로(장르·분위기·멜로디 유지 정도 선택). 작곡과 같은 ⭐.
H10 Inst.(반주) 버전: 마이페이지 곡 ⋮ 메뉴에서 만들기.
H11 아티스트 만들기: '실사로 만들기'(실시간 얼굴 촬영 — 갤러리 사진 불가) 또는 '캐릭터로 만들기'. 기본 2칸, ⭐로 칸 영구 추가. 저장하면 내 아티스트 목록으로 이동. 꾸미기 '옷 입히기'에서 상의·하의·신발·모자·가방 선택 후 '이 옷으로 입히기'(헤어·안경 등은 아직 잠김).
H12 공유 영상(영상 디렉터): SNS용 세로(9:16, 곡 전체) / 와이드 가로(16:9, 곡 전체) / 카톡 프로필 배경(15초, 시작 구간 선택 가능). 처음 만들 때 1~2분. 이미 만든 영상 다시 보기는 무료.
H13 다운로드: 마이페이지 곡 ⋮ → 다운로드 → [영상]/[음원](음원은 로그인 필요). 웹 저장 위치: 아이폰 = 파일 앱 > 다운로드, 안드로이드·PC = 다운로드 폴더(파일명 MAIDOL_ 로 시작). 앱은 지정한 MAIDOL 폴더/사진 앨범.
H14 별 내역: 설정 > 계정 관리 > '스타 내역'(또는 스타 팝업의 '내역 보기'). 출석체크는 상단바 출석 아이콘.
H15 문의·오류 신고: 설정 > 기타 > '문의하기(오류 신고)' → 사유(재생 오류/결제·별 오류/계정 문제/로그인·계정 인증 문제/기타) 선택 → 공식 계정 메시지로 보내기. 사진은 한 메시지에 최대 5장.
H16 콘텐츠 신고: 곡·피드 등의 신고 메뉴(초상권/저작권/성적·불쾌/욕설·괴롭힘/기타). 처리 결과는 설정 > 내 신고 내역.
H17 크루: 계정당 1개 만들 수 있고 멤버끼리 채팅·게시판·공유 플레이리스트.
H18 차트 점수: 순 청취자 40% + 순 다운로더 60%(곡을 70% 이상 들어야 1인 1회). 내 곡을 내가 듣거나 받은 것, 좋아요, 총 재생수는 반영 안 됨. 아티스트 등급: 연습생 → 신인 → 루키 → 라이징 → 아이돌(각 등급 5단계 → 1단계가 정점).
H19 계정: 로그인 = 구글·카카오·이메일. 앱 안 브라우저(카톡 등)에서는 구글 로그인이 막힐 수 있어 기본 브라우저로 열기. 닉네임 변경 = 설정 > 계정 관리. 회원탈퇴 = 설정 맨 아래(복구 불가, 발매곡은 '탈퇴한 사용자'로 남음) — 탈퇴·삭제 요청은 상담원이 처리.
H20 게스트 체험: 가입 없이 작사·작곡 각 1회 무료 체험(발매는 가입 후). 체험 곡은 {guest_days}일 보관 → 작업실 '내 체험 곡' 카드의 [내 곡으로]로 가입 후 가져오기(가져온 곡은 생성 이력에서 발매). 체험 곡 생성이 실패하면 체험권은 그대로 남음. 체험은 간편 목소리만.
H21 어린이 계정(만 14세 미만): 가입 시 보호자 동의 필요(보호자 휴대폰으로 동의 요청, 링크 72시간). 사진 업로드·내 목소리 불가, 메시지는 공식 계정과 서로 팔로우한 친구만, 댓글·글쓰기는 보호자 허용 시. 관련 문의는 상담원이 처리.
"""


def _policy_text(c: dict) -> str:
    pc = c["POINT_COSTS"]
    sk = c["SKIP_POINT_COSTS"]
    a1, a5, a10 = c["ATTENDANCE"]
    y, m, d = c["BETA_SIGNUP_BONUS_UNTIL_KST"]
    return f"""[별(⭐, 앱 표기 '스타') 정책]
P1 사용 단가(서버 기준): 작사 {pc.get('lyrics')} · 작곡 {pc.get('compose')} · 편곡 {pc.get('compose')}(작곡과 동일) · 커버 이미지 {pc.get('cover')} · 커버 다듬기 {pc.get('cover_refine')} · 공유 영상 새로 만들기 {pc.get('share_video')}(이미 만든 영상 다시 보기는 무료) · 아티스트 만들기 {pc.get('character')} · 아티스트 칸 추가 {pc.get('extra_slot')} · 내 목소리 만들기 {pc.get('voice_clone')} · Inst. 버전 {pc.get('instrumental')}.
P2 디렉터 휴식 단축: {c['SKIP_MINUTES']}분당 작곡 디렉터 ⭐{sk.get('composer')} · 작사 ⭐{sk.get('lyricist')} · 이미지 ⭐{sk.get('image')} · 아티스트 ⭐{sk.get('artist')} · 영상 ⭐{sk.get('video')}. 한 번에 최대 {c['MAX_BULK_UNITS']}칸. 마지막 칸은 {c['SKIP_MINUTES']}분이 안 돼도 1칸 요금.
P3 별 받는 법: 첫 가입 +{SIGNUP_BONUS}(1회) · 베타 기간 가입 추가 +{c['BETA_SIGNUP_BONUS_AMOUNT']}({y}년 {m}월 {d}일 가입분까지) · 친구 초대 코드로 가입 시 초대한 사람·가입한 사람 각 +{REFERRAL_BONUS}(새로 가입할 때만 코드 적용) · 프로필 완성 +{PROFILE_BONUS}(1회) · 출석체크 하루 1회 +{a1}, 5일차 +{a5}, 10일차 +{a10}(10일 주기 반복, 연속 아니어도 누적) · 남의 곡 듣기 +1(곡당 하루 1회, 하루 최대 {PLAY_DAILY_CAP}) · 내 곡 발매 +{UPLOAD_BONUS}. 광고는 별을 주지 않음. 앱에서 별을 결제로 구매하는 기능은 없음.
P4 실패 시 환불: 작사·작곡·커버·영상·아티스트·Inst. 생성이 실패하거나 서버 점검으로 중단되면 사용한 별은 자동 환불(스타 내역에 '… 환불'로 표시). 오래 멈춘 작업도 시간 초과로 실패 처리되며 자동 환불. 진행 중인 생성 기록을 지우면 1회 환불.
P5 내 목소리: 학습 시작 시 ⭐{pc.get('voice_clone')} 사용, 분석·학습이 실패하면 자동 환불({c['VOICE_STALE_TIMEOUT_MIN']}분 넘게 진행이 멈춰도 실패 처리 후 환불). 학습이 끝난 목소리는 외부 시스템 사정으로 언젠가 만료될 수 있음 — 만료는 실패가 아니라서 환불 대상이 아니고, 보관함 샘플로 재학습(⭐{pc.get('voice_clone')}). 되도록 학습한 날 바로 작곡에 사용 권장. 시간 제한(예: 2시간)은 없음 — 작곡할 때 살아있는지 확인.
P6 결과물이 마음에 들지 않는 경우(음질·가사·분위기 등)는 실패가 아니므로 자동 환불 대상이 아님. 별 보상·수동 지급·환불 요청은 상담원이 확인.
P7 작곡 결과: 한 번에 A/B 두 버전, 고른 버전을 트랙으로 저장. 저장 직후 비공개 → 마이페이지에서 '차트에 업로드'로 공개.
P8 게스트 체험 곡 보관 {c['GUEST_COMPOSE_RETENTION_DAYS']}일(지나면 듣기·가져오기 불가).
"""


FAQ = """[자주 묻는 질문]
Q1 별이 왜 줄었나요? → 스타 내역(설정 > 계정 관리)에 사용·환불이 모두 기록돼요. 사용자 데이터의 최근 내역으로 설명.
Q2 생성이 실패했는데 별은요? → 실패·중단된 생성은 자동 환불(P4). 사용자 데이터에서 해당 작업의 refunded 와 스타 내역의 '환불' 줄로 확인되면 그 사실을 안내, 확인 안 되면 상담원에게.
Q3 곡이 차트에 안 보여요 → 저장 직후는 비공개. 마이페이지 ⋮ → '차트에 업로드'(H4). 차트 순위는 순 청취자·다운로더 기준(H18).
Q4 다운로드한 파일이 어디 있나요? → H13.
Q5 디렉터가 쉬고 있어요 → H6·P2.
Q6 내 목소리가 안 닮았어요/만료됐어요 → 1분 이상 반주 없는 노래 녹음 권장(H7), 만료 시 보관함 샘플로 재학습(P5).
Q7 영상이 15초만 나와요 → 카톡 프로필 배경 형식은 15초, SNS·와이드는 곡 전체(H12).
Q8 비밀번호를 잊었어요/로그인이 안 돼요 → 계정 문제는 상담원이 확인(account_security).
Q9 커버·가사를 저장 안 하고 나갔어요 → 커버는 다시 들어오면 마지막 결과가 복원되고, 가사는 저장하지 않았다면 작사 화면의 '이어서 하기'를 확인.
"""


_kb_cache: Optional[str] = None


def known_issues_text() -> str:
    lines = ["[알려진 문제 — id | 날짜 | 상태(fixed=해결됨, in_progress=개선 중) | 증상 | 안내 요지]"]
    for k in KNOWN_ISSUES:
        lines.append(f"- {k['id']} | {k['date']} | {k['status']} | {k['symptom']} | {k['answer']}")
    return "\n".join(lines)


def build_kb_text(refresh: bool = False) -> str:
    """LLM 시스템 프롬프트용 지식 베이스(프로세스 1회 생성 후 캐시)."""
    global _kb_cache
    if _kb_cache is not None and not refresh:
        return _kb_cache
    c = _consts()
    intro = ("[서비스]\nMAIDOL(마이돌, MY AI IDOL)은 AI 디렉터들과 대화하며 가사·곡·커버·뮤직비디오·AI 아티스트를 만들고 "
             "차트에 발매해 함께 듣는 음악 창작 앱이에요. 웹(app.maidol.ai.kr)에서 이용할 수 있어요.\n")
    _kb_cache = "\n".join([
        intro,
        _policy_text(c),
        HOW_TO.replace("{guest_days}", str(c["GUEST_COMPOSE_RETENTION_DAYS"])),
        FAQ,
        known_issues_text(),
    ])
    return _kb_cache
