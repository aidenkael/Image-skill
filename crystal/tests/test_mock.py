"""Mock 验证（零网络）：场景配置 / 分析校验 / bbox 转换 / rembg 会话复用 / 本地合成。"""
import os
import sys
import types
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SKILL_DIR))

from PIL import Image, ImageDraw  # noqa: E402

import image_ops  # noqa: E402

# 1) 场景配置：6 场景、必需字段、3:4 画布、底图存在且为 3:4
cfg = image_ops.load_scenes()
assert (cfg["canvas"]["width"], cfg["canvas"]["height"]) == (1200, 1600)
required = {"background", "bracelet_box", "bead_row", "label_row",
            "shadow", "rotation_range", "scale_range"}
assert len(cfg["scenes"]) == 6
for key, sc in cfg["scenes"].items():
    assert not (required - set(sc)), f"场景 {key} 缺字段"
    bg = Image.open(SKILL_DIR / sc["background"])
    assert bg.size == (1200, 1600), f"场景 {key} 底图尺寸 {bg.size}"
print("[ok] 6 场景字段齐全，底图均为 1200x1600 (3:4)")

# 2) choose_scene：显式确定 / auto 随机 / 非法报错
assert image_ops.choose_scene("3", cfg)[0] == "03"
assert image_ops.choose_scene("6", cfg)[0] == "06"
assert image_ops.choose_scene("auto", cfg)[0] in cfg["scenes"]
try:
    image_ops.choose_scene("9", cfg)
    raise AssertionError
except ValueError:
    pass
print("[ok] choose_scene: 1-6 确定、auto 随机、非法报错")

# 3) bbox_1000 → 像素转换
px = image_ops.bbox1000_to_pixels([500, 500, 600, 600], 450, 444)
assert px == [225, 222, 270, 266], px
try:
    image_ops.bbox1000_to_pixels([0, 0, 1001, 500], 100, 100)
    raise AssertionError
except ValueError:
    pass
print("[ok] bbox_1000 转换与越界校验")

# 4) validate_analysis：恰好 N、去不确定措辞、confidence 保留内部
analysis = {
    "bracelet_bbox_1000": [100, 100, 900, 900],
    "crystals": [
        {"name": "疑似紫水晶", "bbox_1000": [100, 100, 300, 300], "shape": "round", "confidence": 0.4},
        {"name": "可能白水晶", "bbox_1000": [400, 100, 600, 300], "shape": "faceted"},
        {"name": "青金石", "bbox_1000": [700, 100, 900, 300], "shape": "round"},
    ],
}
clean = image_ops.validate_analysis(analysis, 3)
assert [c["name"] for c in clean["crystals"]] == ["紫水晶", "白水晶", "青金石"]
assert clean["crystals"][0]["confidence"] == 0.4
try:
    image_ops.validate_analysis(analysis, 2)
    raise AssertionError
except ValueError as e:
    assert "种类数" in str(e)
print("[ok] validate_analysis: 恰好 N 强校验 + 名称清洗")

# 5) rembg 会话：惰性创建、全局复用、默认 u2net、可覆盖（fake 模块，零下载）
fake = types.ModuleType("rembg")
created = []
fake.new_session = lambda name: created.append(name) or f"session<{name}>"
fake.remove = lambda img, session=None: img
sys.modules["rembg"] = fake
os.environ.pop("CRYSTAL_REMBG_MODEL", None)
image_ops._REMBG_SESSION = None
s1 = image_ops._get_rembg_session()
s2 = image_ops._get_rembg_session()
assert s1 is s2 and created == ["u2net"], created
os.environ["CRYSTAL_REMBG_MODEL"] = "isnet-general-use"
image_ops._REMBG_SESSION = None
image_ops._get_rembg_session()
assert created[-1] == "isnet-general-use"
os.environ.pop("CRYSTAL_REMBG_MODEL", None)
print("[ok] rembg 会话惰性复用：默认 u2net，CRYSTAL_REMBG_MODEL 可覆盖")

# 6) 本地完整合成（fake rembg + mock 珠子/手镯）：恰好 N 个标签
def mock_ring(size=520, thickness=90, color=(150, 90, 200)):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(img).ellipse((20, 20, size - 20, size - 20),
                                outline=color + (255,), width=thickness)
    return img

def mock_bead(size=140, color=(90, 160, 220)):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(img).ellipse((6, 6, size - 6, size - 6), fill=color + (255,))
    return img

samples = [{"name": n, "image": mock_bead(color=c)} for n, c in
           [("紫水晶", (150, 90, 200)), ("白水晶", (235, 235, 240)), ("青金石", (40, 70, 160))]]
out = SKILL_DIR / "tests" / "outputs" / "mock_compose.jpg"
for scene_arg in ("1", "4"):
    key, sc = image_ops.choose_scene(scene_arg, cfg)
    image_ops.compose(mock_ring(), samples, key, sc, out, config=cfg)
    with Image.open(out) as im:
        assert im.size == (1200, 1600), im.size
print(f"[ok] compose 输出 3:4 成品图（场景1/4）: {out}")

print("\nALL MOCK CHECKS PASSED")
