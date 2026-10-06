#!/usr/bin/env python3
r"""v3.281 [62] — 꾸미기 아이템(ad_items) 성별 데이터 보정 (스테이징 · 미실행).

배경(2026-10-06 실측, 활성 8,640건 · gender 결측 0):
  - fashion_brands_csv 시드가 성별을 **브랜드 단위**로 매겨 24개 브랜드 1,341건이 전량 '공용'.
    여성 전용 품목(메리제인·슬링백·홀터탑·스커트 …)이 '공용'으로 남성 보기에 노출(제보 [62]).
  - 일부는 태그가 반대: 핏플랍 "여성 …" 등 7건 남성용, 데상트 "… (남성 7인치" 등 43건 여성용.
  - 앱(v3.281 utils/codyCatalog.ts resolveItemGender)은 같은 규칙으로 표시 시점에 보정한다.
    이 스크립트는 **데이터 자체**를 같은 규칙으로 맞춰 관리자 웹·구버전 앱·향후 서버 필터와 일치시킨다.

규칙(앱과 동일 — 바꾸면 양쪽 같이):
  ① 상품명(name + product_name)에 남녀공용 표기 → 공용
  ② 명시 성별(여성/우먼/women… 또는 남성/맨즈/men…) 한쪽만 → 그 성별 (둘 다 → 공용)
  ③ 여성 전용 품목 키워드(보수적) → 여성용 (신발 전용 키워드는 category=신발만)
  ④ 그 외 → 기존 태그 유지
  + 선택: --women-brands / --men-brands — 규칙 ④(이름 근거 없음)이고 태그 '공용'인 해당 브랜드 문서만
    지정 성별로. 브랜드 성별은 편집 판단이라 기본값 없음(대표 확인 후 명시 지정).

실행(컨테이너 /srv/app 안 — 앱과 동일 접속정보):
  미리보기(기본, 쓰기 0):
    sudo docker exec -i maidol-app python -B - < fix_ad_item_gender_v3281.py
    sudo docker exec -i maidol-app python -B - --women-brands 스탠드오일,스컬프터 < fix_ad_item_gender_v3281.py
  적용:
    sudo docker exec -i maidol-app python -B - --apply [--women-brands ...] < fix_ad_item_gender_v3281.py
  되돌리기(이 스크립트가 바꾼 문서만 gender_orig 로 복원):
    sudo docker exec -i maidol-app python -B - --rollback [--apply] < fix_ad_item_gender_v3281.py
  오프라인 미리보기(로컬 덤프 JSON — [{id,brand,category,gender,name,product_name}]):
    python3 fix_ad_item_gender_v3281.py --from-json items.json

적용 시 문서에 gender_orig(최초 1회만)·gender_fix='v3281'·gender_fixed_at 기록 → 롤백 가능.
로그 프리픽스 [GenderFix].
"""

import argparse
import json
import re
import sys
from collections import Counter
from datetime import datetime, timezone

TAG = "v3281"


def _en(alts):
    return r"(?:^|[^a-z])(?:%s)(?![a-z])" % alts


UNISEX_RX = re.compile(r"남녀|남여|공용|유니섹스|" + _en(r"unisex|men ?[&/] ?women|men and women"))
FEMALE_EXPLICIT_RX = re.compile(r"여성|여자|우먼|위민|레이디|숙녀|" + _en(r"women'?s?|woman'?s?|wmns|ladies|lady"))
MALE_EXPLICIT_RX = re.compile(r"남성|남자|맨즈|멘즈|" + _en(r"men'?s?|mens|man's"))
FEMALE_TYPE_RX = re.compile("|".join([
    "원피스", "드레스", "스커트", "치마", "블라우스", "뷔스티에", "캐미솔", "홀터", "브라탑", "브라렛",
    "스포츠 ?브라", "(?:^|[^가-힣])브라(?![가-힣])", "크롭 ?탑", "베이비 ?티",
    _en(r"one-?piece|dress(?:es)?(?! ?(?:shirt|shoe))|skirts?|skort|blouses?|bustier|camisole|cami|halter"
        r"|bra|bralette|bra ?top|crop ?tops?|baby ?tee"),
]))
FEMALE_SHOE_RX = re.compile("|".join([
    "메리 ?제인", "슬링 ?백", "펌프스", "하이 ?힐", "키튼 ?힐", "미들 ?힐", "킬힐", "발레",
    _en(r"mary ?janes?|maryjanes?|sling ?backs?|pumps|heels?|kitten-?heels?|ballet|ballerinas?"),
]))


def normalize_tag(raw):
    t = (raw or "").strip()
    if not t:
        return None
    if t == "공용" or re.search(r"unisex|남녀|남여", t, re.I):
        return "공용"
    if t.startswith("남") or t.lower() in ("male", "man", "m"):
        return "남성용"
    if t.startswith("여") or t.lower() in ("female", "woman", "f"):
        return "여성용"
    return "공용"


def resolve(doc):
    """(gender, reason) — 앱 resolveItemGender 와 동일."""
    text = ("%s %s" % (doc.get("name") or "", doc.get("product_name") or "")).lower()
    if UNISEX_RX.search(text):
        return "공용", "name-unisex"
    f = bool(FEMALE_EXPLICIT_RX.search(text))
    m = bool(MALE_EXPLICIT_RX.search(text))
    if f and m:
        return "공용", "name-both"
    if f:
        return "여성용", "name-female"
    if m:
        return "남성용", "name-male"
    if FEMALE_TYPE_RX.search(text) or (doc.get("category") == "신발" and FEMALE_SHOE_RX.search(text)):
        return "여성용", "type-female"
    tag = normalize_tag(doc.get("gender"))
    return (tag, "tag") if tag else ("공용", "missing")


def plan(docs, women_brands, men_brands):
    out = []
    for d in docs:
        cur = d.get("gender") or ""
        g, reason = resolve(d)
        brand = (d.get("brand") or "").strip()
        if reason == "tag" and cur == "공용":
            if brand in women_brands:
                g, reason = "여성용", "brand-women"
            elif brand in men_brands:
                g, reason = "남성용", "brand-men"
        if g != cur:
            out.append({"id": d.get("_id", d.get("id")), "brand": brand, "category": d.get("category"),
                        "from": cur, "to": g, "reason": reason,
                        "name": (d.get("product_name") or d.get("name") or "")[:80]})
    return out


def report(changes, total):
    log("scan total=%d changes=%d" % (total, len(changes)))
    for (k, n) in sorted(Counter("%s %s→%s (%s)" % (c["category"], c["from"], c["to"], c["reason"])
                                 for c in changes).items()):
        log("  %-40s %d" % (k, n))
    seen = set()
    for c in changes:
        key = (c["brand"], c["name"], c["to"])
        if key in seen:
            continue
        seen.add(key)
        log("  · %s %s→%s [%s] %s | %s" % (c["category"], c["from"], c["to"], c["reason"], c["brand"], c["name"]))


def log(msg):
    print("[GenderFix] " + msg, flush=True)


def main(argv=None):
    ap = argparse.ArgumentParser(description="MAIDOL ad_items gender fix (v3.281 [62])")
    ap.add_argument("--apply", action="store_true", help="실제 쓰기 (기본 미리보기, 쓰기 0)")
    ap.add_argument("--women-brands", default="", help="이름 근거 없는 '공용' → 여성용 처리할 브랜드(쉼표)")
    ap.add_argument("--men-brands", default="", help="이름 근거 없는 '공용' → 남성용 처리할 브랜드(쉼표)")
    ap.add_argument("--rollback", action="store_true", help="gender_fix=v3281 문서를 gender_orig 로 복원")
    ap.add_argument("--from-json", help="오프라인 미리보기(덤프 JSON) — DB 접속 안 함")
    args = ap.parse_args(argv)
    wb = {b.strip() for b in args.women_brands.split(",") if b.strip()}
    mb = {b.strip() for b in args.men_brands.split(",") if b.strip()}
    if wb & mb:
        log("ERROR 같은 브랜드가 women/men 양쪽에 지정됨: %s" % sorted(wb & mb))
        return 2

    if args.from_json:
        docs = json.load(open(args.from_json, encoding="utf-8"))
        report(plan(docs, wb, mb), len(docs))
        log("offline preview only")
        return 0

    from pymongo import MongoClient, UpdateOne
    from app.config import settings  # 컨테이너(/srv/app) 안에서 실행
    client = MongoClient(settings.computed_mongo_url, serverSelectionTimeoutMS=10000)
    db = client[settings.mongo_db]
    db.command("ping")
    col = db.ad_items

    if args.rollback:
        q = {"gender_fix": TAG, "gender_orig": {"$exists": True}}
        n = col.count_documents(q)
        log("rollback candidates=%d apply=%s" % (n, args.apply))
        if args.apply and n:
            ops = [UpdateOne({"_id": d["_id"]},
                             {"$set": {"gender": d["gender_orig"]},
                              "$unset": {"gender_orig": "", "gender_fix": "", "gender_fixed_at": ""}})
                   for d in col.find(q, {"gender_orig": 1})]
            r = col.bulk_write(ops, ordered=False)
            log("rollback modified=%d" % r.modified_count)
        return 0

    docs = list(col.find({}, {"name": 1, "product_name": 1, "gender": 1, "brand": 1, "category": 1}))
    unknown = (wb | mb) - {(d.get("brand") or "").strip() for d in docs}
    if unknown:
        log("WARN 카탈로그에 없는 브랜드: %s" % sorted(unknown))
    changes = plan(docs, wb, mb)
    report(changes, len(docs))
    if not args.apply:
        log("dry-run (쓰기 0) — 적용은 --apply")
        return 0
    now = datetime.now(timezone.utc)
    ops = []
    for c in changes:
        ops.append(UpdateOne({"_id": c["id"], "gender": c["from"]},
                             [{"$set": {"gender_orig": {"$ifNull": ["$gender_orig", "$gender"]},
                                        "gender": c["to"], "gender_fix": TAG, "gender_fixed_at": now}}]))
    if ops:
        r = col.bulk_write(ops, ordered=False)
        log("applied matched=%d modified=%d" % (r.matched_count, r.modified_count))
    return 0


if __name__ == "__main__":
    sys.exit(main())
