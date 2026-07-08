"""SnapFix — immutable character-sheet snapshot copies.

배경: 캐릭터 영구 시트는 고정 MinIO 경로(`characters/{uid}/sheet.png`,
`sheet_virtual.png`)에 덮어쓰기된다. 트랙/MV 스냅샷이 이 경로 문자열만
저장하면 캐릭터 재생성 시 파일 내용이 바뀌어 옛 곡의 "주인공 캐릭터"
표시가 따라 바뀐다.

해결: 스냅샷 생성 시점에 시트를 불변 경로
`character_snapshots/{user_id}/{uuid}.png` 로 서버측 복사하고 스냅샷에는
사본 경로를 저장한다. prefix 를 `characters/` 밖에 두는 이유:
DELETE /character/me 가 `characters/{uid}/` prefix 를 재귀 삭제하므로,
그 밖에 있어야 캐릭터 삭제 후에도 곡 표시가 유지된다.
"""

import io
import logging
import uuid
from typing import Optional

from ..config import settings

logger = logging.getLogger(__name__)

SNAPSHOT_PREFIX = "character_snapshots"


def snapshot_sheet_copy(minio_client, user_id: str, src_object_name: Optional[str]) -> Optional[str]:
    """Copy a character sheet to an immutable snapshot path. Never raises.

    Returns the new object name (`character_snapshots/{user_id}/{uuid}.png`)
    on success, or None when src is empty / both copy strategies fail.
    Callers must treat None as "keep the original path" — publishing/MV
    creation must never fail because of this copy (best-effort).
    """
    if not src_object_name:
        return None

    bucket = settings.minio_bucket_images
    dest_object_name = "{}/{}/{}.png".format(SNAPSHOT_PREFIX, user_id, uuid.uuid4().hex)

    # 1) Server-side copy (no data transit through the app)
    try:
        from minio.commonconfig import CopySource

        minio_client.copy_object(
            bucket_name=bucket,
            object_name=dest_object_name,
            source=CopySource(bucket_name=bucket, object_name=src_object_name),
        )
        return dest_object_name
    except Exception as e:
        logger.warning(
            "[SnapFix] server-side copy failed src=%s user=%s: %s — trying download+upload",
            src_object_name, user_id, e,
        )

    # 2) Fallback: download + re-upload
    try:
        resp = minio_client.get_object(bucket_name=bucket, object_name=src_object_name)
        data = resp.read()
        resp.close()
        resp.release_conn()
        minio_client.put_object(
            bucket_name=bucket,
            object_name=dest_object_name,
            data=io.BytesIO(data),
            length=len(data),
            content_type="image/png",
        )
        return dest_object_name
    except Exception as e:
        logger.warning(
            "[SnapFix] fallback copy failed src=%s user=%s: %s — keeping original path",
            src_object_name, user_id, e,
        )
        return None
