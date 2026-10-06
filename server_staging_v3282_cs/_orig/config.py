"""
Application configuration loaded from environment variables using pydantic-settings.
"""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # PostgreSQL
    postgres_host: str = "localhost"
    postgres_port: int = 5432
    postgres_db: str = "aimu"
    postgres_user: str = "aimu_user"
    postgres_password: str = "your_postgres_password"

    # MongoDB
    mongo_host: str = "localhost"
    mongo_port: int = 27017
    mongo_db: str = "aimu"
    mongo_user: str = "aimu_user"
    mongo_password: str = "your_mongo_password"
    mongo_url: str = ""

    # Redis
    redis_host: str = "localhost"
    redis_port: int = 6379
    redis_password: str = "your_redis_password"
    redis_url: str = ""

    # Elasticsearch (2단계)
    es_host: str = "localhost"
    es_port: int = 9200
    # v189 — ES 인증(xpack.security). 미설정 시 basic_auth=None 으로 기존 동작 유지.
    es_user: str = "elastic"
    es_password: str = ""

    # HybridSearch — weighted RRF fusion of pgvector (semantic) + ES (BM25).
    # es weight > vec weight boosts rare-keyword BM25 hits (e.g. "어머니" → lyrics)
    # so they aren't diluted by generic semantic neighbours in the fused ranking.
    rrf_vec_weight: float = 1.0
    rrf_es_weight: float = 2.0

    # HybridSearch — irrelevant-query cutoff. A vector candidate is only kept when
    # its cosine similarity (1 - cosine_distance, range 0~1, higher = closer) to the
    # query is >= this floor. The cut only forces an EMPTY result when BOTH the
    # cosine-filtered vector hits AND the ES lexical hits are empty (see
    # routes/tracks.py) — so it never overrides a lexical/keyword match.
    #
    # Calibrated on the 19 public tracks (top1 cosine, measured directly):
    #   related:  사랑의 김장 0.551, 벚꽃 0.515, robot love song 0.417, 위로되는 노래 0.376,
    #             sad breakup 0.358, 이별 슬픔 0.354, workout 0.344, 어머니 0.323,
    #             운동 0.324, 기계 0.306, 음식 0.209(+ES), 다이어트 자극 0.171(ES=0)
    #   irrelevant: 비트코인 부자되는 노래 0.324(+ES), 크리스마스 캐롤 0.193(ES=0),
    #               주식 투자 0.177(ES=0)
    # No clean separator exists on this tiny corpus: the weakest required-related
    # query (다이어트 자극 0.171, ES=0) sits *below* two irrelevant ES=0 queries.
    # Per the hard rule "related queries must never die", the floor is set loose at
    # 0.15 — below every related top1 — so no related query is ever emptied. The
    # few irrelevant ES=0 queries near 0.18~0.19 may slip through with a handful of
    # nearest songs (acceptable per spec). True noise far from the catalog (top1
    # < 0.15 with no ES hit) is cut.
    search_min_cosine: float = 0.15

    # v171 — 아무말(gibberish) 게이트 임계. ES 히트 0건(es_ok=True) && vec_top1 <
    # 이 값 → 카탈로그와 무관한 쿼리로 판정, mode=gibberish 빈 결과. 실측: 아무말
    # 쿼리 top1 0.198~0.331(전부 ES=0), 정상 쿼리는 ES lexical 히트가 잡아주므로
    # (artist 필드 v169) 절대 임계 0.34 단독으로도 정상 쿼리를 죽이지 않는다.
    # ES 다운(es_ok=False) 시에는 게이트 미적용 — 가용성 우선.
    search_gibberish_cosine: float = 0.34

    # v171 — ES lexical 앵커 최소 점수. fuzziness AUTO 는 아무말 쿼리에도 저점수
    # 히트를 몇 건 만들 수 있어(실측 "존재하지않는외계어펑크" top1 2.54, 정상
    # 쿼리 최저 3.24 — 'Happy K-Pop 노래') 히트 0건 판정만으로는 부족하다.
    # es_top1 < 이 값이면 "lexical 앵커 없음"으로 간주해 gibberish 게이트의
    # ES 조건을 충족한다. 점수는 function_score(재생수 log1p*0.1 가산) 최종값.
    search_es_weak_score: float = 3.0

    # MinIO
    minio_host: str = "localhost"
    minio_api_port: int = 9000
    minio_access_key: str = "aimu_minio_admin"
    minio_secret_key: str = "your_minio_password"
    minio_bucket_music: str = "aimu-music"
    minio_bucket_images: str = "aimu-images"
    # v202: S3 전환 스위치 — 기본값은 로컬 MinIO 현행과 동일. EC2 는 .env 로
    # MINIO_SECURE=true(S3 는 HTTPS 필수) / S3_REGION=ap-northeast-2 지정.
    minio_secure: bool = False
    # v202: presign SigV4 리전 (bucket location 조회 생략용). 로컬 MinIO 기본값 유지.
    s3_region: str = "us-east-1"

    # v204: 운영 하드닝 — CORS 허용 Origin / API 문서 노출 스위치
    cors_origins: str = "*"       # v204: 쉼표 구분 허용 Origin 명단. "*"=전부 허용(로컬 개발 기본).
                                  # 운영(EC2)은 .env 로 https://www.maidol.ai.kr,https://admin.maidol.ai.kr
    docs_enabled: bool = True     # v204: false 면 /docs·/redoc·/openapi.json 전부 비활성(운영)

    # v205: 무거운 백그라운드 작업(박자 분석·공유영상 생성) 동시 실행 상한.
    #       env HEAVY_JOB_CONCURRENCY — 러시 관측 시 숫자만 조정 (services/heavy_jobs.py)
    heavy_job_concurrency: int = 2

    # v3.244: 박자분석(madmom) 전역 스위치 — env BEATS_EXTRACTION_ENABLED=false 면
    #         신규 추출(발매 훅·생성 완료 훅·재추출 엔드포인트·부팅 복구·MV 인라인
    #         폴백)을 전부 건너뛴다. 이미 추출된 beats/tempo 데이터 서빙은 불변.
    #         (2026-09-28 성능 진단: madmom 이 t3.large 2vCPU 최대 CPU 소비원)
    beats_extraction_enabled: bool = True

    # JWT
    jwt_secret: str = "music-platform-secret-key-2024"
    jwt_algorithm: str = "HS256"

    # OpenAI (ChatGPT for lyrics generation)
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"
    openai_model_advanced: str = "gpt-5.4"
    # HybridSearch — concept-keyword extraction model used at index time only
    # (keyword_service.generate_search_keywords). Cheap/fast model: abstract→concrete
    # search keywords are written once to Mongo `search_keywords` and shared by ES + pgvector.
    keyword_model: str = "gpt-4o-mini"
    # VectorSearch — OpenAI embeddings for pgvector semantic track search
    embedding_model: str = "text-embedding-3-small"
    embedding_dim: int = 1536

    # Anthropic (Claude)
    anthropic_api_key: str = ""

    # Google Gemini (AI cover image generation)
    google_api_key: str = ""

    # Suno API
    suno_api_key: str = ""
    suno_api_url: str = "https://api.sunoapi.org"
    # v3.177(대표 2026-09-15): Suno 구버전(V5/V5_5) 폐기 대응 — sunoapi.org 기본 모델이 V6로 바뀌고
    #   V5·V5_5·V4.5계열은 전부 Deprecated(하위호환용만). voice_persona(보이스클론)·upload-cover 모두
    #   V6/V6_WILD/V6_MINI 지원 확인 → 신규 생성 기본 모델을 V6 로 이전(호출자 명시 suno_model 은 여전히 우선).
    #   변형(V6_WILD/V6_MINI)으로 바꾸거나 롤백 시 .env SUNO_MODEL_DEFAULT 만 조정.
    suno_model_default: str = "V6"
    # v3.229 V2 — 보이스(voice_persona)·참고 음원 없음 곡의 audioWeight 서버 고정값 스위치.
    #   빈 값(기본) = 끔 → 앱이 보낸 값을 그대로 통과(배포만으로 동작 불변).
    #   예) .env `SUNO_VOICE_AUDIO_WEIGHT=1.0` + 컨테이너 재생성 = 켬(A/B 결과·사용자 승인 뒤).
    #   문자열로 받는 이유: 잘못된 값이 기동을 막지 않게 — 해석·범위(0~1) 검증은
    #   suno_generator.voice_audio_weight_override() 가 하고, 무효 값은 끔으로 취급(경고 로그).
    suno_voice_audio_weight: str = ""

    # Kling Video Generation
    kling_access_key: str = ""
    kling_secret_key: str = ""

    # v199: 「내 목소리로 변환」·「보컬 다듬기」 외부 API 설정 3종 제거 — 기능 삭제됨.
    #       실 .env 에 해당 키가 남아 있어도 model_config 의 extra="ignore" 로 무시된다.

    # Wondera AI Music Generation
    wondera_api_key: str = ""

    # fal.ai (Seedance)
    fal_api_key: str = ""

    # xAI (Grok Imagine Video — v66)
    xai_api_key: str = ""

    # Sync Labs (Lip Sync)
    sync_api_key: str = ""

    # Replicate (deprecated as of v41 — LoRA system removed; reserved for future use)
    replicate_api_token: str = ""

    # Social OAuth (Authorization Code flow) — 전부 플레이스홀더/빈문자열.
    # 키 미설정이면 oauth 라우트가 503 으로 친절히 안내하고 앱은 정상 기동.
    # .env 의 GOOGLE_CLIENT_ID 등으로 오버라이드 (pydantic-settings 자동 매핑).
    google_client_id: str = ""
    google_client_secret: str = ""
    kakao_client_id: str = ""       # 카카오 REST API 키
    kakao_client_secret: str = ""   # 선택(보안 강화 사용 시)
    naver_client_id: str = ""
    naver_client_secret: str = ""

    # provider 가 인가코드를 돌려보낼 우리 콜백의 베이스 URL.
    oauth_callback_base: str = "http://localhost:9006"
    # 최종 JWT 를 fragment 로 전달할 프론트엔드 URL.
    frontend_url: str = "https://localhost:4000"

    # ReferralSquad(v154) — 앱 추천(리퍼럴) 초대 착지 페이지의 [MAIDOL 시작하기] 버튼 링크.
    # 플레이스토어 출시 후 .env PLAY_STORE_URL 로 실제 URL 교체 (현재값은 플레이스홀더).
    play_store_url: str = "https://play.google.com/store/apps/details?id=com.maidol.app"

    # GuardSquad — 만14세 미만 보호자 동의 플로우 기능 플래그.
    # 기본 OFF(실서비스 "준비 중" 안내) — 테스트 모드에서만 .env GUARDIAN_CONSENT_ENABLED=true 로 켠다.
    guardian_consent_enabled: bool = False
    # v229 (B-6) — 인증 보상 ⭐ (대표 방침 2026-09-03: 보호자 동의 = 본인인증과 동일 액수 →
    # 단일 설정 공유). 0=미지급. PG 본인인증 정책 확정 시 .env VERIFY_REWARD_POINTS 로 설정.
    verify_reward_points: int = 0
    # v3.233 보호자 페이지(홈페이지 저장소 maidol/www/guardian/) 주소. 알림 어댑터가 만드는 링크 =
    #   가입 동의 {guardian_page_url}?token={consent_token} · 동의 후 관리 {guardian_page_url}?manage={manage_token}
    guardian_page_url: str = "https://maidol.ai.kr/guardian/"

    # v3.232 어린이 모드(1차) — services/kids_policy.py 가 읽는다. 기존 키 불변.
    # kids_mode_enabled = 킬 스위치. False(기본)면 모든 어린이 제한 함수가 DB 조회 없이 즉시
    # "제한 없음"을 돌려준다(성인·어린이 모두 현행 동작 — 응답에 추가 키만 존재).
    # .env KIDS_MODE_ENABLED=true 로 켜고, 문제 시 false 로 되돌린 뒤 컨테이너 재생성.
    kids_mode_enabled: bool = False
    # QA 전용 강제 어린이 계정(쉼표 구분 UUID). kids_mode_enabled=True 일 때만 의미.
    # 운영 DB 쓰기 없이 어린이 제한을 검증하기 위한 것 — .env KIDS_TEST_CHILD_USER_IDS.
    kids_test_child_user_ids: str = ""
    # 금칙어를 성인에게도 적용(2차 결정 전까지 False). False 면 금칙어는 어린이에게만 적용.
    word_filter_all_users: bool = False
    # v3.233 — 금칙어를 "소통 경로"(DM·피드 글·피드 댓글·곡 댓글)에 한해 모든 사용자에게 적용(Play 등급 설문
    # "채팅 조정"). 성인은 욕설·성적·혐오 범주만(개인정보 패턴은 어린이 전용 유지), 작사·캐릭터·곡 제목·닉네임은
    # 계속 어린이만. 기본 OFF — .env WORD_FILTER_SOCIAL_ALL_USERS=true. (word_filter_all_users 는 전 경로 — 사용 비권장)
    word_filter_social_all_users: bool = False

    # FaceGuardSquad(v135) — 얼굴 인증(생체 대조) A안: AWS Rekognition CompareFaces(서울)
    # + Face Liveness(도쿄). 키 빈값이면 mock 모드. 기본 OFF — .env FACE_VERIFY_ENABLED=true 로 켠다.
    face_verify_enabled: bool = False
    # v3.230 S3(대표 승인 2026-09-25 "본인인증 확인만 꺼줘"): 본인인증(users.is_verified) 요구 스위치.
    # False(기본) = 얼굴 인증 동의·보호자 요청·대조(routes/face_verify.py)에서만 본인인증 요구를 건너뛴다.
    # AWS 얼굴 인증(동의·라이브니스·대조)·미성년 보호자 동의·character 얼굴 게이트는 그대로.
    # 사용자간 DM 의 본인인증 게이트는 적용 대상 아님(대표 결정: 본인인증 도입 후 개방, 공식 계정 문의는 현행 허용).
    # 본인인증(PASS 등) 도입 시 .env IDENTITY_VERIFY_REQUIRED=true 한 줄로 복원.
    identity_verify_required: bool = False
    aws_face_access_key_id: str = ""
    aws_face_secret_access_key: str = ""
    # AWS 이전(2026-09-17): 키 없이 EC2 인스턴스 IAM 역할(maidol-ec2)로 Rekognition 호출.
    # true 면 키 빈값이어도 aws 모드 — boto3 기본 자격증명 체인(IMDSv2) 사용. EC2 전용 스위치.
    aws_face_use_iam_role: bool = False
    face_compare_region: str = "ap-northeast-2"
    face_liveness_region: str = "ap-northeast-1"
    face_match_threshold: int = 90
    # v136: Face Liveness confidence 하한 — 미만이면 liveness_failed (FE 재시도 유도)
    face_liveness_confidence_threshold: float = 80.0
    # Fernet 키 — 저장 얼굴(faces/{user_id}.bin) 암복호화. 빈값이면 기동 시 경고 + 저장 불가(mock 전용).
    face_data_key: str = ""
    # 테스트용 강제 판정: off | match | mismatch (mock 모드에서만 적용)
    face_mock_force: str = "off"

    # v3.200 창작 기록 계층(Phase 0) — user_id_hash = SHA256(user_id + salt) 용
    # 서버 salt (.env CREATION_LOG_SALT 신설). ⚠️ 빈값이면 jwt_secret 폴백 + 경고
    # (services/creation_log.py) — 배포 전 .env 설정이 원칙. 한 번 기록이 쌓이면
    # salt 변경 시 기존 세션과 user_id_hash 가 어긋나므로 이후 변경 금지.
    creation_log_salt: str = ""

    # Log access (앱팀 디버깅용 /api/_logs 토큰. 빈 문자열이면 API 비활성)
    log_access_token: str = ""

    # CS/OfficialSquad — maidol_official 공식 계정 (CS 오류신고 DM 문의 채널 + 4001 어드민 대응).
    # startup 에서 이 이메일로 users 시드(role=admin, is_verified=true) + 전체 유저 양방향 맞팔 백필.
    # password 는 플레이스홀더 — 빈값이면 랜덤 해시(로그인 불가, DM 대응은 어드민 API 로만).
    official_account_email: str = "official@maidol.app"
    official_account_nickname: str = "maidol_official"
    official_account_password: str = ""

    # v76: 외부에서 접근 가능한 백엔드 base URL (Suno 콜백 수신용).
    # 비어있으면 "https://localhost" 더미 사용 (개발환경 — 콜백 미수신, 폴링 폴백).
    public_base_url: str = ""

    # v76.1: voice clone 등 외부에서 fetch 필요한 presigned URL 의 호스트 override.
    # 형식 "host:port" (예: "203.0.113.10:9100"). 빈 값이면 기본 minio_host:minio_api_port 사용.
    # .env 의 MINIO_PUBLIC_HOST 로 오버라이드 (pydantic-settings 자동 매핑).
    minio_public_host: str = ""

    # v173: public presign 클라이언트의 https 여부. SigV4 서명에 scheme 이 포함되므로
    # 클라우드 이전(media.maidol.co.kr + TLS) 시 true 로 전환 → https presign 발급.
    # .env 의 MINIO_PUBLIC_SECURE 로 오버라이드 (pydantic-settings 자동 매핑).
    minio_public_secure: bool = False

    # v173: 브라우저 노출 이미지 URL 생성 모드. "proxy" = /api/upload/cover-preview/
    # 상대경로 (개발 https 화면 주력) / "presign" = public 클라이언트 presigned URL 직행
    # (클라우드 이전 후 주경로). .env 의 MEDIA_URL_MODE 로 오버라이드.
    media_url_mode: str = "proxy"

    # v3.207 ⑦ — 비밀번호 재설정 메일 (AWS SES, services/mailer.py).
    # IAM 자격은 boto3 기본 체인(EC2 인스턴스 롤 maidol-ec2 → 환경변수) —
    # 키 하드코딩/저장 금지(얼굴인증 aws_face_use_iam_role 관행 준용).
    # mail_enabled=false(기본) 또는 SES 발신 실패 시 dev 폴백: 실발송 대신
    # 서버 로그에 코드 기록 — SES 샌드박스(미검증 수신자 거부)에서도 플로우
    # E2E 테스트 가능. SES 사전 작업(DKIM/샌드박스 해제/IAM)은 DEPLOY.md 참조.
    mail_enabled: bool = False                  # .env MAIL_ENABLED=true 로 실발송 활성
    ses_region: str = "ap-northeast-2"          # .env SES_REGION
    mail_from: str = "no-reply@maidol.ai.kr"    # .env MAIL_FROM 로 주입 (검증된 발신 주소)
    # 재설정 코드 정책 — 운영 조정은 .env 로 (PASSWORD_RESET_* 자동 매핑)
    password_reset_code_ttl_minutes: int = 15   # 코드 유효 시간
    password_reset_max_attempts: int = 5        # 코드당 검증 시도 상한
    password_reset_hourly_limit: int = 5        # 이메일당 시간당 요청 상한 (rate limit)

    @property
    def es_url(self) -> str:
        """HybridSearch — Elasticsearch HTTP URL built from ES_HOST/ES_PORT."""
        return f"http://{self.es_host}:{self.es_port}"

    @property
    def es_basic_auth(self):
        """v189 — ES basic auth 튜플 (user, password). 미설정 시 None.

        URL 에 크리덴셜을 박는 방식(`http://user:pass@host`)은 로그·예외 메시지에
        비밀번호가 노출되므로 금지 — 클라이언트 생성 시 `basic_auth=` 로만 전달한다.
        None 이면 인증 미전달(= 기존 동작) 이라 개발 환경 하위호환.
        """
        if not self.es_password:
            return None
        return (self.es_user, self.es_password)

    @property
    def postgres_dsn(self) -> str:
        return f"postgresql://{self.postgres_user}:{self.postgres_password}@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"

    @property
    def computed_mongo_url(self) -> str:
        if self.mongo_url:
            return self.mongo_url
        return f"mongodb://{self.mongo_user}:{self.mongo_password}@{self.mongo_host}:{self.mongo_port}/{self.mongo_db}?authSource=admin"

    @property
    def computed_redis_url(self) -> str:
        if self.redis_url:
            return self.redis_url
        return f"redis://:{self.redis_password}@{self.redis_host}:{self.redis_port}/0"

    @property
    def minio_endpoint(self) -> str:
        return f"{self.minio_host}:{self.minio_api_port}"

    @property
    def minio_user(self) -> str:
        return self.minio_access_key

    @property
    def minio_password(self) -> str:
        return self.minio_secret_key

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}


settings = Settings()
