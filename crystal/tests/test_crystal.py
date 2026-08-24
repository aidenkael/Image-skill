#!/usr/bin/env python3
"""crystal 技能本地验证（无网络、无 API 调用）。"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import crystal  # noqa: E402

HERE = Path(__file__).resolve().parent
SAMPLE = HERE.parent.parent / "tests" / "samples" / "ScreenShot_2026-08-19_231344_035.png"
OUT = HERE / "outputs"
OUT.mkdir(exist_ok=True)

# 1) 主流水线不得依赖 rembg/本地合成（方向守卫）
src_text = (Path(crystal.__file__)).read_text(encoding="utf-8")
assert "import rembg" not in src_text and "import cv2" not in src_text, "主流水线不得回到 rembg/本地合成"
print("[ok] 主流水线无 rembg/cv2 依赖")

# 2) analysis 校验：恰好 N
good = {"bracelet_bbox_1000": [200, 200, 800, 800],
        "crystals": [{"name": "紫水晶", "bbox_1000": [300, 300, 400, 400]},
                     {"name": "白水晶", "bbox_1000": [500, 300, 600, 400]}]}
a = crystal.validate_analysis(good, 2)
assert [c["name"] for c in a["crystals"]] == ["紫水晶", "白水晶"]
try:
    crystal.validate_analysis(good, 3)
    raise SystemExit("FAIL: 种类数校验失效")
except ValueError:
    pass
print("[ok] validate_analysis 恰好 N 强校验")

# 3) bbox_1000 转换与夹紧
px = crystal.bbox1000_to_pixels([0, 0, 1000, 1000], 1200, 1600)
assert px == [0, 0, 1200, 1600]
print("[ok] bbox_1000 转换")

# 4) 清理裁剪 + 参考页（本地 Pillow）
clean = crystal.build_clean_source(SAMPLE, good["bracelet_bbox_1000"], OUT / "t_clean.jpg")
sheet = crystal.build_bead_sheet(SAMPLE, good["crystals"], OUT / "t_sheet.png")
assert clean.exists() and sheet.exists()
print("[ok] clean_source + bead_sheet:", sheet)

# 5) 编辑式标注（楷体小字 + 细引线）
from PIL import Image  # noqa: E402
canvas = Image.new("RGB", (1200, 1600), (235, 232, 226))
canvas.save(OUT / "t_canvas.png")
final = crystal.render_labels(OUT / "t_canvas.png", [
    {"text": "紫水晶", "x": 400, "y": 1300, "point_to": [400, 1220]},
    {"text": "白水晶", "x": 760, "y": 1330}], OUT / "t_final.png")
assert final.exists()
print("[ok] render_labels 编辑式标注")

# 6) 凭证/端点解析：仅 DASHSCOPE_API_KEY；URL 优先 → sk-sp- Token Plan → 标准端点
saved = {k: os.environ.get(k) for k in ("DASHSCOPE_API_URL", "DASHSCOPE_API_KEY")}
try:
    os.environ["DASHSCOPE_API_URL"] = "https://example.org/custom"
    os.environ["DASHSCOPE_API_KEY"] = "sk-plain"
    assert crystal._endpoint() == "https://example.org/custom"
    del os.environ["DASHSCOPE_API_URL"]
    os.environ["DASHSCOPE_API_KEY"] = "sk-sp-test"
    assert crystal._endpoint() == crystal.TOKEN_PLAN_ENDPOINT
    os.environ["DASHSCOPE_API_KEY"] = "sk-plain"
    assert crystal._endpoint() == crystal.DASHSCOPE_ENDPOINT
    del os.environ["DASHSCOPE_API_KEY"]
    assert crystal._token() is None, "凭证必须只读 DASHSCOPE_API_KEY"
finally:
    for k, v in saved.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v
print("[ok] 凭证/端点解析")

# 7) 口径守卫：无半尺寸规则、无去金属帽合成裸珠指令、无其他凭证回退、识别范围限手镯
assert "about half their diameter" not in src_text, "代表珠不得故意缩小为一半"
assert "plain bare bead" not in src_text, "不得指示模型去金属帽合成裸珠"
assert "AUTH_TOKEN" not in src_text, "凭证只允许 DASHSCOPE_API_KEY"
assert "removed from the bracelet" in src_text, "散珠须同物理尺寸（像从手镯取下）"
print("[ok] 物理尺度/范围/凭证口径守卫")

print("\nALL CRYSTAL CHECKS PASSED")
