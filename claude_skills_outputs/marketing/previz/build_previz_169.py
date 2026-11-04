# 반값 치킨 티저 프리비즈 — Blender 4.5 세팅 스크립트
# 실행: blender -b --python build_previz.py   (결과: banggap_chicken_previz.blend)
# 장면 구성: Previz3D(세트·마네킹·컷별 카메라) + Edit(컷 30개 시퀀스·노래·자막 자리 띠·컷 자막)
import bpy, math, os
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
SONG = os.path.join(HERE, "song_full.mp3")
FONT = "/System/Library/Fonts/Supplemental/AppleGothic.ttf"
FPS = 30
SONG_START = 19.8            # 노래에서 쓰는 구간 시작(초)
PARK = (200.0, 0.0, -50.0)   # 컷에 안 나오는 인물·소품을 치워 두는 자리

def F(t):  # 노래 시간(초) → 타임라인 프레임
    return int(round((t - SONG_START) * FPS)) + 1

# ── 초기화 ────────────────────────────────────────────────────────────────
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.name = "Previz3D"
sc.render.engine = "BLENDER_WORKBENCH"
sc.display.shading.light = "STUDIO"
sc.display.shading.color_type = "MATERIAL"
sc.display.shading.show_shadows = True
sc.render.resolution_x, sc.render.resolution_y = 1920, 1080
sc.render.fps = FPS
world = bpy.data.worlds.new("World"); sc.world = world

def mat(name, rgb, alpha=1.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.diffuse_color = (*rgb, alpha)
    return m

M = {
 "purple": mat("펄킴_보라", (0.52, 0.30, 0.90)), "lav": mat("펄킴_연보라", (0.78, 0.70, 0.95)),
 "lime": mat("근육팀_라임", (0.62, 0.95, 0.10)), "red": mat("치킨집_빨강", (0.85, 0.12, 0.10)),
 "skin": mat("피부", (0.93, 0.76, 0.64)), "hair": mat("머리", (0.05, 0.05, 0.06)),
 "white": mat("흰색", (0.95, 0.95, 0.95)), "dark": mat("어두운", (0.12, 0.12, 0.14)),
 "wall": mat("건물벽", (0.55, 0.55, 0.58)), "ground": mat("바닥", (0.35, 0.35, 0.37)),
 "road": mat("도로", (0.20, 0.20, 0.22)), "shopglow": mat("치킨집불빛", (1.0, 0.80, 0.35)),
 "gymglow": mat("헬스장창", (0.85, 0.95, 1.0)), "chicken": mat("치킨", (0.80, 0.50, 0.18)),
 "steel": mat("러닝머신", (0.30, 0.32, 0.36)), "bgL": mat("상상_라임배경", (0.62, 0.95, 0.10)),
 "bgR": mat("상상_빨강배경", (0.92, 0.18, 0.15)), "balloon": mat("풍선", (1.0, 0.85, 0.2)),
}

def box(name, loc, size, m, parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.object; o.name = name; o.scale = size
    o.data.materials.append(m)
    if parent: o.parent = parent
    return o

def cyl(name, loc, r, depth, m, parent=None, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, location=loc, rotation=rot, vertices=16)
    o = bpy.context.object; o.name = name; o.data.materials.append(m)
    if parent: o.parent = parent
    return o

def sph(name, loc, r, m, parent=None, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=16, ring_count=8)
    o = bpy.context.object; o.name = name; o.scale = scale; o.data.materials.append(m)
    if parent: o.parent = parent
    return o

def empty(name, loc=(0, 0, 0), parent=None):
    o = bpy.data.objects.new(name, None); sc.collection.objects.link(o)
    o.location = loc
    if parent: o.parent = parent
    return o

# ── 세트: 거리 + 2층 건물(1층 치킨집·오른쪽 계단 입구, 2층 헬스장) ───────────
box("인도", (0, -2.2, -0.05), (32, 4.4, 0.1), M["ground"])
box("도로", (4, -9, -0.06), (40, 9, 0.1), M["road"])
box("건물_1층", (3.8, 3.0, 1.6), (9.8, 6, 3.2), M["wall"])
# 2층은 앞이 뚫린 헬스장(창가의 근육팀이 보이게): 뒷벽(밝은 실내)·옆벽·지붕·창틀
box("2층_뒷벽", (3.8, 5.9, 4.8), (9.8, 0.2, 3.2), M["gymglow"])
box("2층_옆벽L", (-1.05, 3.0, 4.8), (0.1, 6, 3.2), M["wall"]); box("2층_옆벽R", (8.65, 3.0, 4.8), (0.1, 6, 3.2), M["wall"])
box("2층_지붕", (3.8, 3.0, 6.35), (9.8, 6, 0.1), M["wall"])
box("2층_창아래", (3.8, 0.0, 3.4), (9.8, 0.15, 0.4), M["wall"]); box("2층_창위", (3.8, 0.0, 6.1), (9.8, 0.15, 0.5), M["wall"])
for i, x in enumerate((1.2, 2.75, 4.25, 5.75, 7.25)):
    box(f"2층_창틀{i}", (x, 0.0, 4.8), (0.12, 0.15, 2.4), M["wall"])
box("치킨집_창", (3.0, -0.02, 1.5), (6.0, 0.05, 2.4), M["shopglow"])
box("치킨집_간판띠", (3.0, -0.05, 2.95), (6.2, 0.1, 0.4), M["red"])
box("계단입구", (7.7, -0.03, 1.3), (1.6, 0.06, 2.6), M["dark"])
for i in range(5):
    box(f"계단{i}", (7.7, 0.4 + i * 0.35, 0.15 + i * 0.3), (1.5, 0.35, 0.3), M["wall"])
box("2층_바닥", (3.8, 0.6, 3.25), (9.6, 1.2, 0.1), M["wall"])  # 창가에 근육팀이 서는 자리
box("시식대", (4.6, -1.0, 0.45), (1.0, 0.6, 0.9), M["red"])
# 옆 건물들(거리 배경 채우기)
for i, (x, w, h) in enumerate(((-4.5, 6.0, 5.0), (-11.0, 6.5, 8.0), (-17.5, 6.0, 4.5), (12.0, 5.5, 7.0), (18.0, 6.0, 4.8))):
    box(f"옆건물{i}", (x, 3.0, h / 2), (w, 6, h), M["wall"])
    box(f"옆건물{i}_창", (x, -0.02, h * 0.62), (w * 0.8, 0.05, h * 0.35), M["dark"])
for i, x in enumerate((0.3, 5.7)):
    sph(f"풍선{i}a", (x, -0.3, 2.6), 0.22, M["balloon"]); sph(f"풍선{i}b", (x + 0.3, -0.3, 2.8), 0.22, M["purple"])
shutter = box("셔터", PARK, (6.0, 0.08, 2.4), M["steel"])

# 헬스장 안 세트(따로 떨어진 곳, x=40)
box("헬스장_바닥", (40, 0, -0.05), (14, 10, 0.1), M["ground"])
box("헬스장_창벽", (40, 3.0, 2.0), (14, 0.1, 4), M["dark"])
for i, x in enumerate((37.6, 38.8, 40.0, 41.2, 42.4)):
    box(f"러닝머신{i}", (x, 0, 0.12), (0.8, 1.8, 0.24), M["steel"])
    box(f"러닝머신{i}_판", (x, -0.95, 1.1), (0.7, 0.08, 0.3), M["steel"])

# 상상 장면 배경(원색 단색 벽)
box("상상1_라임벽", (-40, 1.5, 4), (16, 0.1, 10), M["bgL"]); box("상상1_바닥", (-40, -3, -0.05), (16, 10, 0.1), M["bgL"])
box("상상2_빨강벽", (-60, 1.5, 4), (16, 0.1, 10), M["bgR"]); box("상상2_바닥", (-60, -3, -0.05), (16, 10, 0.1), M["bgR"])
box("상상3_라임반", (-84, 1.5, 4), (8, 0.1, 10), M["bgL"]); box("상상3_빨강반", (-76, 1.5, 4), (8, 0.1, 10), M["bgR"])
box("상상3_바닥", (-80, -3, -0.05), (16, 10, 0.1), M["ground"])
giant = sph("거대치킨다리", PARK, 0.7, M["chicken"], scale=(1, 0.8, 1.8))
small_ch = sph("시식치킨", PARK, 0.05, M["chicken"])
phone = box("폰", PARK, (0.085, 0.012, 0.17), M["white"])
phone_flat = box("폰_눕힘", PARK, (0.085, 0.17, 0.012), M["white"])
phone_side = box("폰_옆방향", PARK, (0.17, 0.085, 0.012), M["white"])

# ── 마네킹 ────────────────────────────────────────────────────────────────
# 앞(얼굴)은 -y. rotz: 0=카메라 쪽, 90=오른쪽, -90=왼쪽, 180=건물 쪽
def person(name, top, bottom, h=1.62, bulk=1.0, cap=None, hair=True):
    root = empty(name, PARK)
    s = h / 1.62
    for side, x in (("R", -0.09), ("L", 0.09)):
        cyl(f"{name}_다리{side}", (x * s, 0, 0.42 * s), 0.065 * s * bulk, 0.84 * s, M["skin"], root)
        cyl(f"{name}_신발{side}", (x * s, -0.04, 0.04), 0.07 * s, 0.08, M["white"], root)
    box(f"{name}_하의", (0, 0, 0.88 * s), (0.34 * s * bulk, 0.22 * s * bulk, 0.22 * s), bottom, root)
    box(f"{name}_상의", (0, 0, 1.17 * s), (0.36 * s * bulk, 0.22 * s * bulk, 0.42 * s), top, root)
    sph(f"{name}_머리", (0, 0, 1.50 * s), 0.11 * s, M["skin"], root)
    if hair: sph(f"{name}_머리카락", (0, 0.02, 1.53 * s), 0.118 * s, M["hair"], root, scale=(1, 0.95, 0.9))
    box(f"{name}_코", (0, -0.11 * s, 1.50 * s), (0.04, 0.06, 0.04), M["skin"], root)   # 보는 방향 표시
    if cap: cyl(f"{name}_모자", (0, 0, 1.62 * s), 0.12 * s, 0.07, cap, root)
    arms = {}
    for side, x in (("R", -0.23), ("L", 0.23)):
        piv = empty(f"{name}_어깨{side}", (x * s * bulk, 0, 1.36 * s), root)
        cyl(f"{name}_팔{side}", (0, 0, -0.30 * s), 0.05 * s * bulk, 0.60 * s, M["skin"], piv)
        piv.rotation_mode = "XYZ"; arms[side] = piv
    root.rotation_mode = "XYZ"
    return root, arms

ACT = {}
ACT["PK"] = person("펄킴", M["purple"], M["lav"], 1.62)
ACT["PKB"] = person("펄킴_검은옷", M["dark"], M["dark"], 1.62)
for i in range(1, 5):
    ACT[f"M{i}"] = person(f"근육{i}", M["lime"], M["dark"], 1.82, bulk=1.45, hair=False)
ACT["STAFF"] = person("시식직원", M["red"], M["dark"], 1.72, cap=M["white"])
ACT["BOSS"] = person("사장", M["red"], M["dark"], 1.74, bulk=1.15)
cyl("확성기", (0, 0, -0.66), 0.09, 0.22, M["white"], ACT["BOSS"][1]["R"])

# 팔 자세: (오른팔 앞뒤, 오른팔 옆, 왼팔 앞뒤, 왼팔 옆) 도(°). 앞으로 들기=-90, 옆으로(오른팔)=+90 / (왼팔)=-90
POSE = {
 "down": (0, 8, 0, -8), "fwdR": (-90, 0, 0, -8), "stop": (-95, 0, 0, -8), "up": (-165, 15, -165, -15),
 "wave": (-150, 20, 0, -8), "shield": (-80, -10, -80, 10), "side": (0, 90, 0, -90),
 "chest": (-70, -30, -70, 30), "wipe": (-150, -40, 0, -8), "flex": (0, 135, 0, -135),
 "point": (-120, 0, 0, -8), "run": (-40, 0, 40, 0), "toast": (-130, 0, 0, -8),
 "watch": (-70, -20, -80, 30), "wallet": (-45, -10, -45, 10),
 "phone": (-150, 20, 0, -8), "reach": (0, 8, -85, 20), "phoneflat": (-60, -10, -70, 25),
}
FACE = {"cam": 0, "R": 90, "L": -90, "back": 180}

def key_actor(key, f, loc=None, face="cam", pose="down", tilt=0, interp="CONSTANT"):
    root, arms = ACT[key]
    root.location = loc if loc else PARK
    root.rotation_euler = (math.radians(tilt), 0, math.radians(FACE.get(face, face) if isinstance(face, str) else face))
    root.keyframe_insert("location", frame=f); root.keyframe_insert("rotation_euler", frame=f)
    rf, rs, lf, ls = POSE[pose]
    arms["R"].rotation_euler = (math.radians(rf), math.radians(rs), 0)
    arms["L"].rotation_euler = (math.radians(lf), math.radians(ls), 0)
    for a in arms.values(): a.keyframe_insert("rotation_euler", frame=f)

def key_obj(o, f, loc=None):
    o.location = loc if loc else PARK; o.keyframe_insert("location", frame=f)

def key_world(f, rgb):
    world.color = rgb; world.keyframe_insert("color", frame=f)

# ── 컷 정의 (30컷, 샷리스트 v2) ───────────────────────────────────────────
# cam: (카메라 위치, 바라볼 점, 렌즈 mm)
DUSK, DUSK2, DROP, GYM, NIGHT = (0.62, 0.16, 0.42), (0.08, 0.12, 0.50), (0.45, 0.08, 0.70), (0.30, 0.32, 0.36), (0.03, 0.06, 0.30)
M_WIN = [(2.0, 0.6, 3.3), (3.5, 0.6, 3.3), (5.0, 0.6, 3.3), (6.5, 0.6, 3.3)]
CUTS = [
 # id, t0, t1, 샷, 앵글, 가사, 현실/상상, 배우 배치, 카메라, 하늘
 ("C01",19.8,20.7,"풀","로우","한 걸음씩 박자 맞춰","현실",{"PK":dict(loc=(-7.6,-2.2,0),face="R",to=(-6.6,-2.2,0))},((-3.6,-6.0,0.35),(-7,-2.2,0.9),24),DUSK),
 ("C01b",20.7,21.5,"바스트","망원","한 걸음씩 박자 맞춰","현실",{"PK":dict(loc=(-6.6,-2.2,0),face="R")},((-6.3,-9.0,1.45),(-6.3,-2.2,1.4),260),DUSK),
 ("C02",21.5,22.3,"바스트","아이레벨","clap, clap","현실",{"PK":dict(loc=(-4.5,-2.2,0),face="R"),"_phone":(-4.28,-2.2,1.12)},((-4.5,-4.3,1.42),(-4.5,-2.2,1.35),50),DUSK),
 ("C02b",22.3,23.1,"클로즈업","시점","clap, clap","현실",{"PK":dict(loc=(-4.5,-2.2,0),face="R",pose="phoneflat"),"_phoneside":(-4.02,-2.2,1.2)},((-4.28,-2.2,1.62),(-4.02,-2.2,1.2),35),DUSK),
 ("C03",23.1,25.0,"풀","아이레벨","뱃살이 빠지는 게 아냐","현실",{"PK":dict(loc=(-0.3,-1.6,0),face="R"),**{f"M{i+1}":dict(loc=M_WIN[i],pose="wave") for i in range(4)}},((3.8,-15,1.6),(3.8,0,3.1),24),DUSK),
 ("C04",25.0,26.8,"미디엄","로우","더 나오려는 걸 막아","현실",{"PK":dict(loc=(1.0,-2.3,0),pose="stop")},((1.0,-5.0,0.55),(1.0,-2.3,1.3),32),DUSK),
 ("C05",26.8,28.6,"바스트","아이레벨","그래도 난 웃으며 뛰어","현실",{"PK":dict(loc=(1.5,-2.3,0),face="R",pose="run")},((1.1,-5.6,1.2),(1.5,-2.3,1.0),40),DUSK),
 ("C06",28.6,30.9,"클로즈업","아이레벨","바이오 리듬, feel so light","현실",{"PK":dict(loc=(1.8,-2.3,0),face=25)},((1.8,-3.35,1.5),(1.8,-2.3,1.48),85),DUSK),
 ("C07",30.9,32.8,"풀","아이레벨","Move my body, one two","상상",{"PK":dict(loc=(-40,-1.4,0)),**{f"M{i+1}":dict(loc=(-42.4+i*1.6,0.2,0),pose="up") for i in range(4)}},((-40,-8,1.2),(-40,-0.5,1.3),28),DUSK),
 ("C08",32.8,34.7,"투샷","아이레벨","땀방울도 반짝여","현실",{"PK":dict(loc=(3.2,-2.0,0),face="R"),"STAFF":dict(loc=(4.5,-1.8,0),face="L",pose="fwdR")},((3.85,-5.3,1.5),(3.85,-1.9,1.35),35),DUSK),
 ("C09",34.7,36.6,"풀","로우","오늘의 나, good mood","상상",{"PK":dict(loc=(-60,-1.4,0),pose="up"),"_giant":(-59.6,-1.0,1.3)},((-60,-6.5,0.4),(-60,-1.0,1.4),28),DUSK),
 ("C10",36.6,38.7,"클로즈업","아이레벨","다시 한 번 one two","현실",{"PK":dict(loc=(3.0,-2.0,0),face=-20)},((3.0,-3.05,1.5),(3.0,-2.0,1.48),85),DUSK),
 ("C11",38.7,40.6,"미디엄","아이레벨","점심 메뉴 앞에 서면","현실",{"PK":dict(loc=(3.0,-1.1,0),face="back")},((2.3,-3.6,1.65),(3.4,0,1.6),35),DUSK),
 ("C12",40.6,42.6,"풀","아이레벨","마음속 전쟁 시작돼","상상",{"PK":dict(loc=(-80,-1.2,0),pose="side"),"M1":dict(loc=(-81.4,-1.2,0),face="R",pose="fwdR"),"STAFF":dict(loc=(-78.6,-1.2,0),face="L",pose="fwdR")},((-80,-8,1.2),(-80,-1,1.2),28),DUSK),
 ("C13",42.6,44.5,"바스트","로우","샐러드에 닭가슴살","현실",{"PK":dict(loc=(3.0,-2.0,0),face="R",pose="shield")},((2.5,-3.9,0.9),(3.0,-2.0,1.35),40),DUSK),
 ("C14",44.5,46.2,"미디엄","로우","떡볶이는 다음 주로","현실",{"PK":dict(loc=(4.0,-2.0,0),face="R",tilt=-10),"BOSS":dict(loc=(5.1,-1.6,0),face="L",pose="fwdR")},((4.4,-5.0,0.6),(4.7,-1.7,1.5),32),DUSK),
 ("C15",46.2,48.0,"미디엄","아이레벨","친구가 빵을 내밀어","현실",{"PK":dict(loc=(4.0,-2.1,0),face="R",tilt=-25),"STAFF":dict(loc=(4.9,-2.0,0),face="L",pose="fwdR"),"BOSS":dict(loc=(4.8,-1.2,0),face="L",pose="fwdR")},((4.2,-5.2,1.3),(4.35,-1.8,1.25),35),DUSK),
 ("C16",48.0,50.0,"익스트림 클로즈업","아이레벨","한 입만은 위험한 말","현실",{"PK":dict(loc=(4.0,-2.0,0),face="R"),"_small":(4.17,-2.0,1.47)},((4.08,-2.55,1.5),(4.08,-2.0,1.48),100),DUSK),
 ("C17",50.0,52.0,"바스트","하이","그래도 난 물을 들어","현실",{"PK":dict(loc=(4.0,-2.0,0),pose="reach"),"_small":(4.33,-2.4,1.15)},((4.0,-3.5,2.3),(4.0,-2.0,1.1),45),DUSK),
 ("C18",52.0,53.6,"클로즈업","시점","say goodbye","현실",{"PK":dict(loc=(4.0,-2.0,0),face="R",pose="phoneflat"),"_phoneside":(4.48,-2.0,1.2)},((4.22,-2.0,1.62),(4.48,-2.0,1.2),35),DUSK2),
 ("C19",53.6,55.3,"클로즈업","아이레벨","뱃살이 빠지는 게 아냐","현실",{"PK":dict(loc=(4.0,-2.0,0))},((4.0,-3.05,1.5),(4.0,-2.0,1.48),85),DUSK2),
 ("C20",55.3,57.2,"미디엄","로우","더 나오려는 걸 막아","현실",{**{f"M{i+1}":dict(loc=(3.5+i*1.0,0.6,3.3),pose="point") for i in range(4)}},((5.0,-4.5,1.0),(5.0,0.3,4.2),28),DUSK2),
 ("C21",57.2,59.0,"바스트","아이레벨","그래도 난 웃으며 뛰어","현실",{"PK":dict(loc=(4.2,-2.0,0),pose="watch")},((4.2,-3.65,1.45),(4.2,-2.0,1.35),50),DUSK2),
 ("C22",59.0,61.5,"풀","로우","삼십대의 리듬, feel so light","현실",{**{f"M{i+1}":dict(loc=(7.7+0.3*i,0.8+0.5*i,0),face=-120,pose="run",to=(5.6+0.4*i,-1.6-0.3*i,0)) for i in range(4)}},((4.6,-5.5,0.4),(6.8,-0.8,1.2),24),DUSK2),
 ("C23",61.5,63.4,"풀","아이레벨","두근두근 심박수 올라","현실+원색",{"PK":dict(loc=(3.0,-2.7,0),pose="chest"),**{f"M{i+1}":dict(loc=(1.5+i*1.0,-1.6,0),pose="chest") for i in range(4)}},((3.0,-9.0,1.3),(3.0,-2.0,1.2),32),DROP),
 ("C24",63.4,65.3,"미디엄","아이레벨","온몸에서 땀이 흘러","현실+원색",{"PK":dict(loc=(3.0,-2.7,0),pose="wipe"),**{f"M{i+1}":dict(loc=(1.5+i*1.0,-1.6,0),pose="wipe") for i in range(4)}},((3.0,-6.0,1.4),(3.0,-2.2,1.3),35),DROP),
 ("C25",65.3,66.8,"풀","하이","어깨 털고 허리 돌려","현실+원색",{"PK":dict(loc=(3.0,-2.7,0),pose="side",tilt=12),**{f"M{i+1}":dict(loc=(1.5+i*1.0,-1.6,0),pose="side",tilt=12) for i in range(4)},"STAFF":dict(loc=(5.8,-1.0,0),face=-60),"BOSS":dict(loc=(6.4,-1.3,0),face=-60)},((3.6,-7.5,4.6),(3.6,-2.0,0.8),28),DROP),
 ("C26",66.8,69.1,"풀","사이드","나를 위해 흔들어봐","현실+원색",{"PK":dict(loc=(1.5,-2.6,0),face="R",pose="flex",to=(4.5,-2.6,0)),**{f"M{i+1}":dict(loc=(-0.5-i*0.9,-2.0+0.25*(i%2),0),face="R",pose="flex",to=(2.5-i*0.9,-2.0+0.25*(i%2),0)) for i in range(4)}},((2.5,-9.5,1.2),(2.5,-2.3,1.2),28),DROP),
 ("C27",69.1,71.3,"와이드","아이레벨","퇴근길에 헬스장 갈까","현실",{"PK":dict(loc=(40,0,0.24),pose="run"),"M1":dict(loc=(37.6,0,0.24),pose="run"),"M2":dict(loc=(38.8,0,0.24),pose="run"),"M3":dict(loc=(41.2,0,0.24),pose="run"),"M4":dict(loc=(42.4,0,0.24),pose="run")},((40,-6.5,1.6),(40,0,1.1),20),GYM),
 ("C28",71.3,73.0,"클로즈업","아이레벨","갓생살까 현생살까","현실",{"PK":dict(loc=(40,0,0.24),pose="watch")},((40,-1.05,1.75),(40,0,1.7),85),GYM),
 ("C29",73.0,74.4,"풀","아이레벨","피곤함도 잠깐 접고","현실",{"PK":dict(loc=(7.6,-2.0,0),face="L"),"_shutter":((3.0,-0.08,3.9),(3.0,-0.08,1.5))},((3.8,-15,1.6),(3.8,0,3.1),24),NIGHT),
 ("C30",74.4,76.6,"미디엄","아이레벨","러닝 한 시간만 하자","현실",{"PK":dict(loc=(6.5,-2.3,0),pose="toast"),"M1":dict(loc=(5.4,-1.8,0),face=30,pose="toast"),"M2":dict(loc=(7.6,-1.8,0),face=-30,pose="toast"),"M3":dict(loc=(5.9,-1.1,0),face=20,pose="toast"),"M4":dict(loc=(7.1,-1.1,0),face=-20,pose="toast"),"_shutter":((3.0,-0.08,1.5),None)},((6.5,-5.6,1.4),(6.5,-1.8,1.3),32),NIGHT),
]
END_T1 = 79.6

# 16:9 구도 보정: 가로 여백에 맞춰 화각과 인물 위치를 다시 잡음
LENS_X = {"C03": 1.67, "C29": 1.67, "C07": 1.6, "C09": 1.6, "C12": 1.6, "C27": 1.5, "C02b": 1.4, "C18": 1.4}
SHIFT_X = {"C05": 0.45, "C06": 0.13, "C10": 0.13}
CAM_SET = {"C01": ((0.9, -0.55, 1.5), (-7.0, -2.2, 1.25), 70), "C01b": ((0.9, -0.55, 1.5), (-6.6, -2.2, 1.45), 240), "C02": ((0.9, -0.55, 1.5), (-4.5, -2.2, 1.35), 130)}
def fix169(row):
    row = list(row); cid = row[0]; cloc, ctgt, lens = row[8]
    if cid in CAM_SET: cloc, ctgt, lens = CAM_SET[cid]
    lens *= LENS_X.get(cid, 1)
    d = SHIFT_X.get(cid, 0)
    row[8] = ((cloc[0] + d, cloc[1], cloc[2]), (ctgt[0] + d, ctgt[1], ctgt[2]), lens)
    return tuple(row)
CUTS = [fix169(r) for r in CUTS]

# 행인·손님(회색 마네킹): 인도 안쪽에 두어 주인공 뒤로 지나가게 함
EXTRAS = {"X1": dict(loc=(-9.5, -0.9, 0), face="R"), "X2": dict(loc=(-5.2, -1.0, 0), face="L"), "X3": dict(loc=(-2.6, -0.8, 0), face="R"),
          "X4": dict(loc=(0.9, -0.6, 0), face="R"), "X5": dict(loc=(1.6, -0.6, 0), face="R"), "X6": dict(loc=(2.3, -0.6, 0), face="R"),
          "X7": dict(loc=(9.6, -1.0, 0), face="L"), "X8": dict(loc=(4.2, -0.5, 0), face="R"), "X9": dict(loc=(5.2, -0.5, 0), face="L")}
for i, (cx, col) in enumerate(((10.0, "red"), (-2.0, "steel"), (-14.0, "white"))):
    box(f"차{i}_몸체", (cx, -6.6, 0.55), (4.2, 1.8, 0.9), M[col]); box(f"차{i}_지붕", (cx, -6.6, 1.2), (2.2, 1.6, 0.5), M["dark"])
for k in EXTRAS:
    ACT[k] = person(f"행인{k}", M["steel"], M["dark"], 1.68)
STREET = {"C01", "C02", "C03", "C04", "C05", "C08", "C11", "C13", "C14", "C15", "C17", "C21", "C22", "C23", "C24", "C25", "C26", "C30"}  # 클로즈업에는 넣지 않음

# 카메라 + 배치 키프레임
cams = {}
MOVES = set()   # (오브젝트 이름, 시작 프레임): 컷 안에서 움직이는 구간
for (cid, t0, t1, shot, ang, lyric, kind, cast, (cloc, ctgt, lens), sky) in CUTS:
    f0, f1 = F(t0), F(t1)
    if "PK" in cast and kind != "상상" and cid not in ("C23", "C24", "C25", "C26"):  # 현실=검은 옷, 상상·드롭=보라 옷
        cast = dict(cast); cast["PKB"] = cast.pop("PK")
    if cid in STREET:
        cast = {**cast, **EXTRAS}
    cam_data = bpy.data.cameras.new(f"{cid}_cam"); cam_data.lens = lens; cam_data.sensor_fit = "VERTICAL"; cam_data.sensor_height = 36  # 세로판과 같은 세로 화각 유지
    cam = bpy.data.objects.new(f"{cid}_카메라", cam_data); sc.collection.objects.link(cam)
    cam.location = cloc
    tgt = empty(f"{cid}_카메라목표", ctgt)
    con = cam.constraints.new("TRACK_TO"); con.target = tgt; con.track_axis = "TRACK_NEGATIVE_Z"; con.up_axis = "UP_Y"
    cams[cid] = cam
    key_world(f0, sky)
    for key in ACT:
        spec = cast.get(key)
        if spec:
            key_actor(key, f0, loc=spec["loc"], face=spec.get("face", "cam"), pose=spec.get("pose", "down"), tilt=spec.get("tilt", 0))
            if "to" in spec:  # 컷 안에서 이동(걷기·질주·행진)
                MOVES.add((ACT[key][0].name, f0))
                key_actor(key, f1 - 1, loc=spec["to"], face=spec.get("face", "cam"), pose=spec.get("pose", "down"), tilt=spec.get("tilt", 0))
        else:
            key_actor(key, f0)
    key_obj(giant, f0, cast.get("_giant")); key_obj(small_ch, f0, cast.get("_small"))
    key_obj(phone, f0, cast.get("_phone")); key_obj(phone_flat, f0, cast.get("_phoneflat")); key_obj(phone_side, f0, cast.get("_phoneside"))
    s = cast.get("_shutter"); key_obj(shutter, f0, s[0] if s else None)
    if s and s[1]: key_obj(shutter, f1 - 1, s[1]); MOVES.add((shutter.name, f0))

# 키프레임 보간: 기본은 '뚝 끊기'(컷마다 배치), 이동 구간만 직선
for o in list(bpy.data.objects) + [world]:
    ad = o.animation_data
    if not ad or not ad.action: continue
    for fc in ad.action.fcurves:
        kps = fc.keyframe_points
        for kp in kps:
            moving = fc.data_path == "location" and (getattr(o, "name", ""), int(round(kp.co[0]))) in MOVES
            kp.interpolation = "LINEAR" if moving else "CONSTANT"

sc.frame_start, sc.frame_end = 1, F(END_T1) - 1
sc.camera = cams["C01"]
for (cid, t0, *_r) in CUTS:   # 타임라인 마커 = 컷 시작, 카메라 연결(블렌더 화면에서 재생해도 컷이 바뀜)
    mk = sc.timeline_markers.new(cid, frame=F(t0)); mk.camera = cams[cid]

# ── Edit 장면: 컷 이어 붙이기 + 노래 + 자막 자리 띠 + 컷 자막 ─────────────────
ed = bpy.data.scenes.new("Edit")
ed.render.resolution_x, ed.render.resolution_y = 1920, 1080
ed.render.fps = FPS
ed.frame_start, ed.frame_end = 1, F(END_T1) - 1
se = ed.sequence_editor_create()
S = se.strips if hasattr(se, "strips") else se.sequences

def new_effect(name, typ, ch, f0, f1):
    try:
        return S.new_effect(name=name, type=typ, channel=ch, frame_start=f0, frame_end=f1)
    except TypeError:
        return S.new_effect(name=name, type=typ, channel=ch, frame_start=f0, length=f1 - f0)

font = bpy.data.fonts.load(FONT) if os.path.exists(FONT) else None
for (cid, t0, t1, shot, ang, lyric, kind, *_r) in CUTS:
    f0, f1 = F(t0), F(t1)
    st = S.new_scene(name=cid, scene=sc, channel=1, frame_start=1)
    st.scene_camera = cams[cid]
    st.frame_final_start, st.frame_final_end = f0, f1
    tx = new_effect(f"{cid}_자막", "TEXT", 5, f0, f1)
    tx.text = f"{cid}  {shot}·{ang}  [{kind}]\n♪ {lyric}"
    tx.font_size = 40; tx.location = (0.5, 0.09); tx.alignment_x = "CENTER"; tx.anchor_x = "CENTER"; tx.anchor_y = "CENTER"
    tx.color = (1, 1, 1, 1); tx.use_shadow = True
    if font: tx.font = font
fe0, fe1 = F(76.6), F(END_T1)
end = new_effect("끝장면", "COLOR", 1, fe0, fe1); end.color = (0.05, 0.04, 0.08)
et = new_effect("끝장면_글자", "TEXT", 5, fe0, fe1); et.text = "MAIDOL\n내 이야기로 노래 만들기\nMAIDOL 검색"; et.font_size = 70
et.location = (0.5, 0.5); et.alignment_x = "CENTER"; et.anchor_x = "CENTER"; et.anchor_y = "CENTER"; et.color = (1, 1, 1, 1)
if font: et.font = font
# 자막·UI 자리 띠(위 9%, 아래 20%)
for nm, h, cy in ():
    b = new_effect(nm, "COLOR", 3, 1, fe1); b.color = (0.55, 0.25, 0.95)
    b.blend_type = "ALPHA_OVER"; b.blend_alpha = 0.22
    b.transform.scale_y = h; b.transform.offset_y = (cy - 0.5) * 1920
# 노래: 19.8초가 1프레임에 오도록
if os.path.exists(SONG):
    snd = S.new_sound(name="노래", filepath=SONG, channel=8, frame_start=1 - int(round(SONG_START * FPS)))
    snd.frame_final_start, snd.frame_final_end = 1, fe0
    snd.volume = 0.9

# 출력 설정(미리보기 mp4, 절반 해상도)
ed.render.resolution_percentage = 50
ed.render.image_settings.file_format = "FFMPEG"
ed.render.ffmpeg.format = "MPEG4"; ed.render.ffmpeg.codec = "H264"
ed.render.ffmpeg.audio_codec = "AAC"; ed.render.ffmpeg.audio_bitrate = 160
ed.render.filepath = os.path.join(HERE, "banggap_chicken_previz_169.mp4")
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "banggap_chicken_previz_169.blend"))
print("PREVIZ_BUILT", len(CUTS), "cuts, frames", ed.frame_end)
