"""
TMX 맵 렌더러 - office.tmx를 이미지로 렌더링
"""
import xml.etree.ElementTree as ET
from PIL import Image

TILE_SIZE = 32
TMX_PATH = "assets/maps/office.tmx"
TILESET_DIR = "assets/tilesets"
OUTPUT_PATH = "assets/map_rendered.png"

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

    # 결과 이미지 생성
    result = Image.new("RGBA", (map_width * TILE_SIZE, map_height * TILE_SIZE), (0, 0, 0, 255))

    # 레이어별 렌더링
    layers = root.findall("layer")
    for layer in layers:
        layer_name = layer.get("name")
        data_el = layer.find("data")
        csv_text = data_el.text.strip()
        gids = [int(g) for g in csv_text.replace("\n", "").split(",") if g.strip()]

        rendered = 0
        for i, raw_gid in enumerate(gids):
            if raw_gid == 0:
                continue

            # 플립 플래그 추출
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

            x = (i % map_width) * TILE_SIZE
            y = (i // map_width) * TILE_SIZE
            result.paste(tile_img, (x, y), tile_img)
            rendered += 1

        print(f"  레이어 '{layer_name}': {rendered} 타일 렌더링")

    result.save(OUTPUT_PATH, "PNG")
    print(f"\n완료! 저장: {OUTPUT_PATH} ({result.size[0]}x{result.size[1]})")


if __name__ == "__main__":
    main()
