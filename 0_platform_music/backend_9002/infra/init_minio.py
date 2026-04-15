"""
Music Platform - MinIO Bucket Initialization Script (v2.0)

Creates the required buckets for the music platform:
- music-platform-audio: Audio file storage (tracks)
- music-platform-images: Image storage (covers, profiles)

Usage:
    python infra/init_minio.py
"""

import os
import sys

from minio import Minio
from minio.error import S3Error

MINIO_ENDPOINT = os.getenv("MINIO_HOST", "localhost") + ":" + os.getenv("MINIO_PORT", "9000")
MINIO_ACCESS_KEY = os.getenv("MINIO_USER", "music_minio")
MINIO_SECRET_KEY = os.getenv("MINIO_PASSWORD", "music_minio_pass_2024")

BUCKETS = [
    os.getenv("MINIO_AUDIO_BUCKET", "music-platform-audio"),
    os.getenv("MINIO_IMAGE_BUCKET", "music-platform-images"),
]


def main():
    print(f"Connecting to MinIO at {MINIO_ENDPOINT}...")
    client = Minio(
        endpoint=MINIO_ENDPOINT,
        access_key=MINIO_ACCESS_KEY,
        secret_key=MINIO_SECRET_KEY,
        secure=False,
    )

    for bucket in BUCKETS:
        try:
            if client.bucket_exists(bucket):
                print(f"  Bucket '{bucket}' already exists.")
            else:
                client.make_bucket(bucket)
                print(f"  Bucket '{bucket}' created successfully.")
        except S3Error as e:
            print(f"  ERROR creating bucket '{bucket}': {e}")
            sys.exit(1)

    print("MinIO initialization completed.")


if __name__ == "__main__":
    main()
