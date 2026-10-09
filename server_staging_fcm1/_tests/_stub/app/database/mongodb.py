"""테스트 스텁 — 실제 서버의 app.database.mongodb 대체(테스트가 get_mongo 를 패치)."""


def get_mongo():
    raise RuntimeError("stub: patch get_mongo in test")
