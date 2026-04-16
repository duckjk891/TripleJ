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

    # Sync Labs (Lip Sync)
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

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
