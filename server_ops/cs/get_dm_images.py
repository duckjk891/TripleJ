# DM 첨부 이미지 받기: python get_dm_images.py dm/<uid>/<file> ... → 컨테이너 /tmp/dmimg_N.<ext>
import sys
from app.config import settings
from app.database import minio as S
S.init_minio(settings.minio_endpoint, settings.minio_user, settings.minio_password)
c = S.get_minio()
bucket = settings.minio_bucket_images
for i, name in enumerate(sys.argv[1:]):
    r = c.get_object(bucket, name)
    data = r.read()
    open(f"/tmp/dmimg_{i}" + name[name.rfind("."):], "wb").write(data)
    print(name, len(data))
