"""
Application configuration loaded from environment variables using pydantic-settings.
"""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # PostgreSQL (shared host container; DB name isolated)
    postgres_host: str = "localhost"
    postgres_port: int = 5432
    postgres_db: str = "mv_wedding"
    postgres_user: str = "aimu_user"
    postgres_password: str = "your_postgres_password"

    # MongoDB (shared host container; DB name isolated)
    mongo_host: str = "localhost"
    mongo_port: int = 27017
    mongo_db: str = "mv_wedding"
    mongo_user: str = "aimu_user"
    mongo_password: str = "your_mongo_password"
    mongo_url: str = ""

    # Redis (shared host container; db index 1 to avoid collision with reference db 0)
    redis_host: str = "localhost"
    redis_port: int = 6379
    redis_password: str = "your_redis_password"
    redis_url: str = ""

    # MinIO (shared host container; bucket prefix isolated)
    minio_host: str = "localhost"
    minio_api_port: int = 9100
    minio_access_key: str = "aimu_minio_admin"
    minio_secret_key: str = "your_minio_password"
    minio_bucket_photos: str = "mv-wedding-photos"
    minio_bucket_audio: str = "mv-wedding-audio"
    minio_bucket_videos: str = "mv-wedding-videos"

    # JWT
    jwt_secret: str = "wedding-mv-secret-key-2026"
    jwt_algorithm: str = "HS256"

    # External API keys (reserved for v2 — unused in v1 bootstrap)
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"
    openai_model_advanced: str = "gpt-5.4"
    anthropic_api_key: str = ""

    # Wedding lyrics 기본 모델 — model=null로 호출되면 이 값을 사용.
    # Claude Opus 4.7: 한국어 창작·서사 최상. 결혼식 곡 1회 생성당 약 280원 추정.
    wedding_lyrics_default_model: str = "claude-opus-4-7"
    google_api_key: str = ""
    suno_api_key: str = ""
    suno_api_url: str = "https://api.sunoapi.org"
    kling_access_key: str = ""
    kling_secret_key: str = ""
    fal_api_key: str = ""
    sync_api_key: str = ""

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
        return f"redis://:{self.redis_password}@{self.redis_host}:{self.redis_port}/1"

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
