"""전체 앱 라우트 → 핸들러 이름 매핑(배포 전후 비교 — 메모리 server-edit-decorator-check)."""
import os
os.environ.setdefault("DOCS_ENABLED", "false")
from app.main import app
for r in app.routes:
    methods = ",".join(sorted(getattr(r, "methods", None) or []))
    ep = getattr(r, "endpoint", None)
    print(f"{methods:12s} {getattr(r, 'path', '?'):70s} {getattr(ep, '__module__', '')}.{getattr(ep, '__name__', '')}")
