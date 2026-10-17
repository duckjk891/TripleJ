# 옷(광고 아이템) 이미지 썸네일 생성 — ads/thumb320/<원본 경로에서 ads/ 뺀 것> (JPEG, 긴 변 320px)
# 서버 재시작 없이 기존 이미지 프록시(/api/business/items/image/ads/...)로 바로 제공된다. 이미 있으면 건너뜀.
import asyncio, io, sys, time
from PIL import Image
from app.config import settings
from app.database import mongodb as M, minio as S

THUMB = "ads/thumb320/"

def thumb_name(o):
    rest = o[len("ads/"):]
    base = rest.rsplit(".", 1)[0]
    return THUMB + base + ".jpg"

async def main():
    await M.init_mongodb(settings.computed_mongo_url, settings.mongo_db)
    S.init_minio(settings.minio_endpoint, settings.minio_user, settings.minio_password)
    c = S.get_minio(); B = settings.minio_bucket_images
    objs = await M.get_mongo().ad_items.distinct("image_object_name")
    objs = [o for o in objs if isinstance(o, str) and o.startswith("ads/") and not o.startswith(THUMB)]
    existing = {x.object_name for x in c.list_objects(B, prefix=THUMB, recursive=True)}
    todo = [o for o in objs if thumb_name(o) not in existing]
    print("images", len(objs), "existing thumbs", len(existing), "todo", len(todo), flush=True)
    if "--count" in sys.argv: return
    done = fail = 0; saved_in = saved_out = 0; t0 = time.time()
    for o in todo:
        try:
            r = c.get_object(B, o); data = r.read(); r.close(); r.release_conn()
            im = Image.open(io.BytesIO(data)); im = im.convert("RGB")
            im.thumbnail((320, 320), Image.LANCZOS)
            out = io.BytesIO(); im.save(out, "JPEG", quality=78, optimize=True, progressive=True); b = out.getvalue()
            c.put_object(B, thumb_name(o), io.BytesIO(b), len(b), content_type="image/jpeg")
            done += 1; saved_in += len(data); saved_out += len(b)
        except Exception as e:
            fail += 1
            if fail <= 5: print("fail", o[-40:], type(e).__name__, str(e)[:80], flush=True)
        if (done + fail) % 500 == 0:
            print("progress", done, fail, "in %.0fMB -> out %.0fMB" % (saved_in/1e6, saved_out/1e6), "%.0fs" % (time.time()-t0), flush=True)
    print("DONE", done, "fail", fail, "in %.0fMB -> out %.0fMB" % (saved_in/1e6, saved_out/1e6), "%.0fs" % (time.time()-t0), flush=True)

asyncio.run(main())
