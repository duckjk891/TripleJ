"""
TMX 맵 렌더러 - office.tmx를 이미지로 렌더링 + 디렉터 walk zone 산출
"""
import json
import xml.etree.ElementTree as ET
from collections import deque
from PIL import Image

TILE_SIZE = 32
TMX_PATH = "assets/maps/office.tmx"
TILESET_DIR = "assets/tilesets"
OUTPUT_PATH = "assets/map_rendered.png"
OUTPUT_BG_PATH = "assets/map_bg.png"  # 바닥 + 벽 + 가구1 (캐릭터 아래 레이어)
OUTPUT_FG_PATH = "assets/map_fg.png"  # 가구2 이상 (캐릭터 앞 레이어)
OUTPUT_ZONE_JSON = "assets/director_walk_zones.json"

# 캐릭터보다 뒤 (bg)에 그릴 레이어 이름
BG_LAYER_NAMES = {"바닥", "걸레받이", "걸레받이 세로", "벽뒤가구", "벽", "가구1"}
# 나머지(가구2~가구5)는 fg로 분류

# 캐릭터 이동 차단 레이어 (걸레받이~가구5 모두 block)
BLOCKER_LAYER_NAMES = {
    "걸레받이", "걸레받이 세로", "벽뒤가구", "벽",
    "가구1", "가구2", "가구3", "가구4", "가구5",
}

# 디렉터 기본 위치 (map-px) — MapScreen의 DIRECTORS와 동기화
DIRECTOR_POSITIONS = [
    ("artist",   208, 340),
    ("lyricist", 208, 660),
    ("composer", 208, 980),
    ("wondera",  320, 980),
    ("image",    208, 1300),
    ("video",    208, 1620),
]

# flood-fill 최대 깊이 (Manhattan 타일 단위). 3 = 96px 반경 ≈ 3타일
WALK_FLOOD_MAX_DEPTH = 4

# GID 플립 플래그 마스크
FLIPPED_HORIZONTALLY = 0x80000000
FLIPPED_VERTICALLY = 0x40000000
FLIPPED_DIAGONALLY = 0x20000000
GID_MASK = 0x1FFFFFFF


def parse_tsx(tsx_path):
    """TSX 파일에서 타일셋 정보 추출"""
    tree = ET.parse(tsx_path)
    root = tree.getroot()
    img_el = root.find("image")
    return {
        "name": root.get("name"),
        "tilecount": int(root.get("tilecount")),
        "columns": int(root.get("columns")),
        "image_source": img_el.get("source"),
    }


def load_tileset_image(name):
    """타일셋 이미지 로드 (로컬 tilesets 디렉토리에서)"""
    # 파일명 매핑
    name_map = {
        "Room_Builder_32x32": "Room_Builder_32x32.png",
        "office_housing": "Modern_Office_32x32.png",
        "Interiors_32x32": "Interiors_32x32.png",
        "Music_and_sport_01": "Music_and_sport_01.png",
        "Interiors_free_32x32": "Interiors_free_32x32.png",
        "Art_01": "Art_01.png",
        "Television_and_Film_Studio_01": "Television_and_Film_Studio_01.png",
        "Music_and_sport_02": "Music_and_sport_02.png",
    }
    filename = name_map.get(name, f"{name}.png")
    path = f"{TILESET_DIR}/{filename}"
    return Image.open(path).convert("RGBA")


def get_tile(tileset_img, local_id, columns):
    """타일셋 이미지에서 특정 타일 잘라내기"""
    tx = (local_id % columns) * TILE_SIZE
    ty = (local_id // columns) * TILE_SIZE
    return tileset_img.crop((tx, ty, tx + TILE_SIZE, ty + TILE_SIZE))


def apply_flip(tile_img, flip_h, flip_v, flip_d):
    """타일 플립 적용"""
    if flip_d:
        tile_img = tile_img.transpose(Image.TRANSPOSE)
    if flip_h:
        tile_img = tile_img.transpose(Image.FLIP_LEFT_RIGHT)
    if flip_v:
        tile_img = tile_img.transpose(Image.FLIP_TOP_BOTTOM)
    return tile_img


def main():
    # TMX 파싱
    tree = ET.parse(TMX_PATH)
    root = tree.getroot()
    map_width = int(root.get("width"))
    map_height = int(root.get("height"))

    print(f"맵 크기: {map_width}x{map_height} 타일 ({map_width*TILE_SIZE}x{map_height*TILE_SIZE}px)")

    # 타일셋 정보 수집
    tilesets = []
    for ts_el in root.findall("tileset"):
        firstgid = int(ts_el.get("firstgid"))
        tsx_path = f"assets/maps/{ts_el.get('source')}"
        tsx_info = parse_tsx(tsx_path)
        tsx_info["firstgid"] = firstgid
        tsx_info["image"] = load_tileset_image(tsx_info["name"])
        tilesets.append(tsx_info)
        print(f"  타일셋: {tsx_info['name']} (firstgid={firstgid}, {tsx_info['tilecount']}타일)")

    # firstgid 역순 정렬 (큰 것부터 매칭)
    tilesets.sort(key=lambda t: t["firstgid"], reverse=True)

    def find_tileset(gid):
        for ts in tilesets:
            if gid >= ts["firstgid"]:
                return ts
        return None

    # 결과 이미지 3개 준비: 전체 / 배경(캐릭터 뒤) / 전경(캐릭터 앞)
    size = (map_width * TILE_SIZE, map_height * TILE_SIZE)
    result = Image.new("RGBA", size, (0, 0, 0, 255))
    bg_img = Image.new("RGBA", size, (0, 0, 0, 255))       # 바닥 있는 배경
    fg_img = Image.new("RGBA", size, (0, 0, 0, 0))          # 투명 (캐릭터 앞 오버레이)

    # 레이어별 타일 위치 집합 (walk zone 계산용)
    floor_tiles = set()       # (tx, ty)
    blocker_tiles = set()     # 캐릭터 이동 차단

    # 레이어별 렌더링
    layers = root.findall("layer")
    for layer in layers:
        layer_name = layer.get("name")
        data_el = layer.find("data")
        csv_text = data_el.text.strip()
        gids = [int(g) for g in csv_text.replace("\n", "").split(",") if g.strip()]

        is_bg = layer_name in BG_LAYER_NAMES
        target_img = bg_img if is_bg else fg_img

        rendered = 0
        for i, raw_gid in enumerate(gids):
            if raw_gid == 0:
                continue

            flip_h = bool(raw_gid & FLIPPED_HORIZONTALLY)
            flip_v = bool(raw_gid & FLIPPED_VERTICALLY)
            flip_d = bool(raw_gid & FLIPPED_DIAGONALLY)
            gid = raw_gid & GID_MASK

            ts = find_tileset(gid)
            if ts is None:
                continue

            local_id = gid - ts["firstgid"]
            if local_id < 0 or local_id >= ts["tilecount"]:
                continue

            tile_img = get_tile(ts["image"], local_id, ts["columns"])
            tile_img = apply_flip(tile_img, flip_h, flip_v, flip_d)

            tx = i % map_width
            ty = i // map_width
            x = tx * TILE_SIZE
            y = ty * TILE_SIZE
            # 기존 전체 이미지에도 계속 합성 (하위 호환)
            result.paste(tile_img, (x, y), tile_img)
            # 레이어 분기 합성
            target_img.paste(tile_img, (x, y), tile_img)
            # walk zone 계산용 타일 좌표 수집
            if layer_name == "바닥":
                floor_tiles.add((tx, ty))
            if layer_name in BLOCKER_LAYER_NAMES:
                blocker_tiles.add((tx, ty))
            rendered += 1

        bucket = "bg" if is_bg else "fg"
        print(f"  레이어 '{layer_name}' [{bucket}]: {rendered} 타일 렌더링")

    result.save(OUTPUT_PATH, "PNG")
    bg_img.save(OUTPUT_BG_PATH, "PNG")
    fg_img.save(OUTPUT_FG_PATH, "PNG")
    print(f"\n이미지 저장:")
    print(f"  전체:    {OUTPUT_PATH}")
    print(f"  배경(bg): {OUTPUT_BG_PATH}  ← 캐릭터 뒤")
    print(f"  전경(fg): {OUTPUT_FG_PATH}  ← 캐릭터 앞 (가구2~가구5)")

    # ─── 디렉터별 walk zone 산출 ───
    walkable = floor_tiles - blocker_tiles
    print(f"\n바닥 타일: {len(floor_tiles)}, 차단 타일: {len(blocker_tiles)}, 보행 가능 타일: {len(walkable)}")

    def nearest_walkable(start):
        """start 타일 또는 가장 가까운 walkable 타일 반환."""
        if start in walkable:
            return start
        best = None
        best_dist = 10 ** 9
        sx, sy = start
        for (tx, ty) in walkable:
            d = abs(tx - sx) + abs(ty - sy)
            if d < best_dist:
                best_dist = d
                best = (tx, ty)
        return best

    def bfs_zone(start, max_depth):
        """start에서 walkable 타일만 BFS, 최대 Manhattan 깊이 제한."""
        if start is None:
            return []
        visited = {start}
        queue = deque([(start, 0)])
        result_tiles = []
        while queue:
            (tx, ty), depth = queue.popleft()
            result_tiles.append((tx, ty))
            if depth >= max_depth:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = tx + dx, ty + dy
                if (nx, ny) in walkable and (nx, ny) not in visited:
                    visited.add((nx, ny))
                    queue.append(((nx, ny), depth + 1))
        return result_tiles

    walk_zones = {}
    for name, px, py in DIRECTOR_POSITIONS:
        base_tile = (px // TILE_SIZE, py // TILE_SIZE)
        anchor = nearest_walkable(base_tile)
        if anchor is None:
            print(f"  [{name}] 보행 가능 타일 없음 - skip")
            walk_zones[name] = []
            continue
        zone_tiles = bfs_zone(anchor, WALK_FLOOD_MAX_DEPTH)
        # 각 타일의 중심 map-px를 디렉터 베이스 (px, py) 기준 delta로 변환
        deltas = [
            [tx * TILE_SIZE + TILE_SIZE // 2 - px, ty * TILE_SIZE + TILE_SIZE // 2 - py]
            for (tx, ty) in zone_tiles
        ]
        walk_zones[name] = deltas
        anchor_px = (anchor[0] * TILE_SIZE + TILE_SIZE // 2, anchor[1] * TILE_SIZE + TILE_SIZE // 2)
        print(
            f"  [{name}] base=({px},{py}) anchor_tile={anchor} ({anchor_px[0]},{anchor_px[1]}) "
            f"zone={len(zone_tiles)} 타일 (max_depth={WALK_FLOOD_MAX_DEPTH})"
        )

    with open(OUTPUT_ZONE_JSON, "w", encoding="utf-8") as f:
        json.dump(walk_zones, f, ensure_ascii=False, indent=2)
    print(f"\nWalk zone 저장: {OUTPUT_ZONE_JSON}")


if __name__ == "__main__":
    main()
