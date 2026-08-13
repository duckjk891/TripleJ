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

    # Kling Video Generation
    kling_access_key: str = ""
    kling_secret_key: str = ""

    # Kits.AI Voice Conversion
    kits_api_key: str = ""
    kits_api_url: str = "https://arpeggi.io/api/kits/v1"

    # LALAL.AI Vocal Enhancement
    lalal_api_key: str = ""

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
    oauth_callback_base: str = "http://localhost:9005"
    # 최종 JWT 를 fragment 로 전달할 프론트엔드 URL.
    frontend_url: str = "https://localhost:4000"

    # ReferralSquad(v154) — 앱 추천(리퍼럴) 초대 착지 페이지의 [MAIDOL 시작하기] 버튼 링크.
    # 플레이스토어 출시 후 .env PLAY_STORE_URL 로 실제 URL 교체 (현재값은 플레이스홀더).
    play_store_url: str = "https://play.google.com/store/apps/details?id=com.maidol.app"

    # GuardSquad — 만14세 미만 보호자 동의 플로우 기능 플래그.
    # 기본 OFF(실서비스 "준비 중" 안내) — 테스트 모드에서만 .env GUARDIAN_CONSENT_ENABLED=true 로 켠다.
    guardian_consent_enabled: bool = False

    # FaceGuardSquad(v135) — 얼굴 인증(생체 대조) A안: AWS Rekognition CompareFaces(서울)
    # + Face Liveness(도쿄). 키 빈값이면 mock 모드. 기본 OFF — .env FACE_VERIFY_ENABLED=true 로 켠다.
    face_verify_enabled: bool = False
    aws_face_access_key_id: str = ""
    aws_face_secret_access_key: str = ""
    face_compare_region: str = "ap-northeast-2"
    face_liveness_region: str = "ap-northeast-1"
    face_match_threshold: int = 90
    # v136: Face Liveness confidence 하한 — 미만이면 liveness_failed (FE 재시도 유도)
    face_liveness_confidence_threshold: float = 80.0
    # Fernet 키 — 저장 얼굴(faces/{user_id}.bin) 암복호화. 빈값이면 기동 시 경고 + 저장 불가(mock 전용).
    face_data_key: str = ""
    # 테스트용 강제 판정: off | match | mismatch (mock 모드에서만 적용)
    face_mock_force: str = "off"

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

    @property
    def es_url(self) -> str:
        """HybridSearch — Elasticsearch HTTP URL built from ES_HOST/ES_PORT."""
        return f"http://{self.es_host}:{self.es_port}"

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
