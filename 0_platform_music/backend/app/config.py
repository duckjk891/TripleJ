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

    # YuE Music Generation
    yue_model_dir: str = ""  # Path to YuEGP directory
    yue_output_dir: str = "./yue_output"
    yue_vram_profile: int = 4  # 3=int8(12GB), 4=offload(<10GB)
    yue_python: str = "/home/duckjk89/miniconda3/envs/yuegp/bin/python"

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
