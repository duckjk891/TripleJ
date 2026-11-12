# 읽기 전용 — 컨테이너 안에서 route→함수 매핑을 정렬해 출력 (lifespan 실행 안 함, DB 접속 안 함).
# 실행: docker exec|run ... -w /srv/app -e PYTHONPATH=/srv/app <컨테이너> python /chk/routemap.py
import sys

sys.path.insert(0, "/srv/app")
from app.main import app  # noqa: E402

rows = []
for r in app.routes:
    methods = ",".join(sorted(getattr(r, "methods", None) or [])) or "-"
    ep = getattr(r, "endpoint", None)
    name = "{}.{}".format(ep.__module__, ep.__name__) if ep else type(r).__name__
    rows.append("{} {} {}".format(methods, getattr(r, "path", "?"), name))
print("\n".join(sorted(rows)))
