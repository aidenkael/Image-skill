"""Mock 验证（无需 API 凭证）：scenes.yaml 解析 / type_count 强校验 / 合成流程。"""
import sys
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SKILL_DIR))

from PIL import Image, ImageDraw

import image_ops
import vision

# 1) scenes.yaml 解析 + 6 场景必需字段
cfg = image_ops.load_scenes()
assert cfg["canvas"] == {"width": 1600, "height": 1200}
required = {"background", "bracelet_box", "sample_column", "label_column",
            "shadow", "rotation_range", "scale_range"}
assert len(cfg["scenes"]) == 6, "必须恰好 6 个场景"
for key, sc in cfg["scenes"].items():
    missing = required - set(sc)
    assert not missing, f"场景 {key} 缺少字段: {missing}"
    assert (SKILL_DIR / sc["background"]).exists(), f"缺底图: {sc['background']}"
print("[ok] scenes.yaml 解析，6 场景字段齐全，底图均存在")

# 2) choose_scene
for s in ("auto", "1", "6"):
    k, _ = image_ops.choose_scene(s, cfg)
    assert k in cfg["scenes"]
try:
    image_ops.choose_scene("9", cfg)
    raise AssertionError("不存在的场景应报错")
except ValueError:
    pass
print("[ok] choose_scene: auto/1/6 正常，非法场景报错")

# 3) identify 响应强校验：种类数必须恰好等于 type_count
ok_text = '''```json
{"bracelet_bbox": [10, 20, 400, 380], "view": "top_down", "crystals": [
 {"name": "疑似紫水晶", "point": [100, 100], "radius": 30, "shape": "round", "confidence": 0.0},
 {"name": "可能白水晶", "point": [200, 120], "radius": 28, "shape": "faceted", "confidence": 0.0},
 {"name": "青金石", "point": [300, 150], "radius": 26, "shape": "round", "confidence": 1.0}]}
```'''
parsed = vision.parse_identify_response(ok_text, 3, image_size=(450, 444))
assert len(parsed["crystals"]) == 3
assert parsed["crystals"][0]["name"] == "紫水晶"   # 不确定措辞被剥离
assert parsed["crystals"][1]["name"] == "白水晶"
assert parsed["crystals"][0]["confidence"] == 0.0  # 置信度保留在内部
for c in parsed["crystals"]:
    assert not any(w in c["name"] for w in ("疑似", "可能", "大概", "或许"))
try:
    vision.parse_identify_response(ok_text, 2, image_size=(450, 444))
    raise AssertionError("种类数不符应报错")
except ValueError as e:
    assert "种类数" in str(e)
try:
    vision.parse_identify_response("没有JSON", 3)
    raise AssertionError("无 JSON 应报错")
except ValueError:
    pass
print("[ok] identify 响应校验：type_count 强约束 + 名称去不确定措辞")

# 4) compose：mock 手镯与 3 颗珠子（无需 API、无需 rembg）
def mock_ring(size=520, thickness=90, color=(150, 90, 200)):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse((20, 20, size - 20, size - 20), outline=color + (255,), width=thickness)
    return img

def mock_bead(size=140, color=(90, 160, 220)):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse((6, 6, size - 6, size - 6), fill=color + (255,))
    return img

analysis = {"bracelet_bbox": [0, 0, 100, 100], "view": "top_down", "crystals": []}
samples = [{"name": n, "image": mock_bead(color=c)} for n, c in
           [("紫水晶", (150, 90, 200)), ("白水晶", (235, 235, 240)), ("青金石", (40, 70, 160))]]
out = SKILL_DIR / "tests" / "outputs" / "mock_compose.jpg"
out.parent.mkdir(parents=True, exist_ok=True)
for scene_arg in ("1", "5"):
    key, sc = image_ops.choose_scene(scene_arg, cfg)
    image_ops.compose("mock", mock_ring(), samples, analysis, key, sc, out, config=cfg)
    assert out.exists() and out.stat().st_size > 10000
print(f"[ok] compose 成功（场景1与场景5各一次）: {out}")

# 5) extract_bead 几何兜底路径（不调 rembg：直接验证 _shape_fallback_mask）
for shape in ("round", "square", "faceted", "irregular"):
    m = image_ops._shape_fallback_mask((120, 120), 40, shape)
    assert m.max() == 255 and (m > 0).sum() > 1000
print("[ok] 各形状几何掩码兜底可用")

print("\nALL MOCK CHECKS PASSED")
