"""age1 실제 분류기 점검 — 합성(직접 지어낸) 제목·가사·이미지만 보낸다. 이용자 데이터 전송 없음.
DB 연결 없음. 실행: 임시 컨테이너(운영 .env 의 ANTHROPIC_API_KEY 만 사용)."""
import asyncio
import base64
import io
import sys
import time

from PIL import Image, ImageDraw

from app.services import age_rating as ar

CASES = [
    ("all", "햇살 소풍", "도시락 들고 친구랑 공원에 가요\n하늘엔 구름이 둥실둥실\n우리 같이 노래해요 랄라라"),
    ("all", "이별 정류장", "버스가 떠나고 너도 떠났어\n눈물이 나지만 괜찮아질 거야\n고마웠어 안녕"),
    ("12", "망할 월요일", "망할 알람이 또 울려\n젠장 지각이야 뛰어가\n오늘도 버텨보자"),
    ("15", "취한 밤", "소주 한 병 비우고 담배 한 대 물고\n니가 미워서 욕이 나와 씨발 다 꺼져\n이 밤이 끝나면 다시 일어설게"),
    ("15", "비 오는 날 싸움", "그 새끼가 먼저 시비를 걸었어\n주먹이 오가고 코피가 터졌지\n집에 와서 혼자 맥주를 마셔"),
    ("12", "끝", "가끔은 사라지고 싶다는 생각을 해\n그래도 내일은 조금 나을까\n누가 내 손을 잡아줬으면"),
    ("19", "욕 랩", "씨발 다 좆같아 씨발 꺼져\n개새끼들아 씨발 내 말 들어\n좆까 씨발 니들 다 병신"),
    ("19", "밤의 침대", "옷을 하나씩 벗기며 너의 몸을 탐해\n침대 위에서 밤새 섹스해\n신음 소리가 방을 채워"),
    ("19", "하얀 가루", "한 줄 더 들이마셔 세상이 녹아내려\n약 없인 못 살아 너도 해봐 같이 날아\n코카인이 내 친구"),
]


def fake_cover():
    im = Image.new("RGB", (512, 512), (250, 220, 230))
    d = ImageDraw.Draw(im)
    d.ellipse((150, 150, 360, 360), fill=(255, 200, 60))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=85)
    return base64.standard_b64encode(buf.getvalue()).decode("ascii"), "image/jpeg"


async def main():
    print("model:", ar.model_id())
    ar._read_and_shrink = lambda obj: fake_cover()
    order = {r: i for i, r in enumerate(ar.RATINGS)}
    ok = 0
    for expect, title, lyrics in CASES:
        t0 = time.monotonic()
        try:
            res = await ar.classify(title, lyrics, "covers/synthetic/test.png")
        except Exception as e:  # noqa: BLE001
            print(f"ERROR {title}: {type(e).__name__}: {str(e)[:300]}")
            continue
        dt = time.monotonic() - t0
        near = abs(order[res["rating"]] - order[expect]) <= 1 and (expect != "19" or res["rating"] == "19") \
            and (expect != "all" or res["rating"] == "all")
        ok += near
        print(f"{'OK ' if near else 'BAD'} expect={expect:3s} got={res['rating']:3s} {dt:4.1f}s cover={res['cover_used']} "
              f"model={res['model']} title={title} reasons={res['reasons']}")
    print(f"{ok}/{len(CASES)} within tolerance (all·19 exact, 12·15 ±1)")
    sys.exit(0 if ok == len(CASES) else 1)


asyncio.run(main())
