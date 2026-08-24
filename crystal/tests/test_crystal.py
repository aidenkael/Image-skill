#!/usr/bin/env python3
"""crystal 技能本地验证（无网络、无 API 调用）。"""
import copy  # noqa: E402
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

# 2) analysis 校验：无 group_id、display_name + visual_identity 自由文本 + 可选 N
good = {"bracelet_bbox_1000": [200, 200, 800, 800],
        "bead_groups": [
            {"display_name": "紫水晶",
             "visual_identity": "medium round bead, translucent purple with inclusions",
             "representative_bbox_1000": [300, 300, 400, 400]},
            {"display_name": "白水晶",
             "visual_identity": "large cube bead, translucent clear",
             "representative_bbox_1000": [500, 300, 600, 400]}]}
a = crystal.validate_analysis(good)  # N 缺省：用新鲜组数
assert len(a["bead_groups"]) == 2
assert "group_id" not in a["bead_groups"][0] and "group_id" not in a["bead_groups"][1], \
    "校验后的 schema 不得包含 group_id"
a2 = crystal.validate_analysis(good, 2)  # 显式 N：强校验
assert [g["display_name"] for g in a2["bead_groups"]] == ["紫水晶", "白水晶"]
try:
    crystal.validate_analysis(good, 3)
    raise SystemExit("FAIL: 显式 N 组数校验失效")
except ValueError:
    pass

# 2b) visual_identity 必填
bad_vi = copy.deepcopy(good)
bad_vi["bead_groups"][0]["visual_identity"] = "   "
try:
    crystal.validate_analysis(bad_vi)
    raise SystemExit("FAIL: visual_identity 必填校验失效")
except ValueError:
    pass

# 2c) 代表矩形坐标 sanity check（须落在 bracelet_bbox_1000 内）
bad_out = copy.deepcopy(good)
bad_out["bead_groups"][0]["representative_bbox_1000"] = [50, 50, 90, 90]
try:
    crystal.validate_analysis(bad_out)
    raise SystemExit("FAIL: 代表矩形坐标 sanity check 失效")
except ValueError:
    pass

# 2d) 反向 bbox 拒绝（bracelet 与代表矩形两条路径）
for label, path in (("bracelet", "bracelet_bbox_1000"),
                    ("representative", "bead_groups")):
    bad = copy.deepcopy(good)
    if path == "bracelet_bbox_1000":
        bad[path] = [800, 800, 200, 200]  # 反向
    else:
        bad[path][0]["representative_bbox_1000"] = [400, 400, 300, 300]  # 反向
    try:
        crystal.validate_analysis(bad)
        raise SystemExit(f"FAIL: {label} 反向 bbox 应被拒绝")
    except ValueError:
        pass

# 2e) 零面积 bbox 拒绝（x1==x2 / y1==y2）
for x1, y1, x2, y2 in ((300, 300, 300, 400), (300, 300, 400, 300)):
    bad = copy.deepcopy(good)
    bad["bead_groups"][0]["representative_bbox_1000"] = [x1, y1, x2, y2]
    try:
        crystal.validate_analysis(bad)
        raise SystemExit(f"FAIL: 零面积 bbox {[x1, y1, x2, y2]} 应被拒绝")
    except ValueError:
        pass

# 2f) 空 display_name 拒绝（不静默变成“未知水晶”）
bad_name = copy.deepcopy(good)
bad_name["bead_groups"][0]["display_name"] = "   "
try:
    crystal.validate_analysis(bad_name)
    raise SystemExit("FAIL: 空 display_name 应被拒绝")
except ValueError:
    pass
try:
    crystal.clean_name("")
    raise SystemExit("FAIL: 空名称应抛错")
except ValueError:
    pass

# 2g) 不确定措辞 display_name 拒绝（不静默删词）
for bad_word in ("疑似紫水晶", "可能为紫水晶", "大概紫水晶", "或许紫水晶"):
    bad_name = copy.deepcopy(good)
    bad_name["bead_groups"][0]["display_name"] = bad_word
    try:
        crystal.validate_analysis(bad_name)
        raise SystemExit(f"FAIL: 不确定措辞 {bad_word!r} 应被拒绝")
    except ValueError:
        pass
try:
    crystal.clean_name("疑似紫水晶")
    raise SystemExit("FAIL: 不确定措辞应抛错")
except ValueError:
    pass

# 2h) _groups_text()：只含 Reference 索引 + visual_identity，不含 display_name
gt = crystal._groups_text(a["bead_groups"])
assert "Reference 1" in gt and "Reference 2" in gt, "须用 Reference 索引"
assert "translucent purple" in gt and "紫水晶" not in gt, \
    "生成绑定仅 Reference 索引 + visual_identity，display_name 不得入 Prompt"
print("[ok] validate_analysis 无 group_id + visual_identity 自由文本 + 可选 N + 名称/bbox 显式拒绝")

# 3) bbox_1000 转换与夹紧
px = crystal.bbox1000_to_pixels([0, 0, 1000, 1000], 1200, 1600)
assert px == [0, 0, 1200, 1600]
print("[ok] bbox_1000 转换")

# 4) 清理裁剪 + 参考页（本地 Pillow）
clean = crystal.build_clean_source(SAMPLE, good["bracelet_bbox_1000"], OUT / "t_clean.jpg")
sheet = crystal.build_bead_sheet(SAMPLE, good["bead_groups"], OUT / "t_sheet.png")
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

# 7) 口径守卫：物理取下规则、无直径缩小、无模型回退、识别范围限手镯
assert "about half their diameter" not in src_text, "代表珠不得故意缩小为一半"
assert "plain bare bead" not in src_text, "不得指示模型去金属帽合成裸珠"
assert "AUTH_TOKEN" not in src_text, "凭证只允许 DASHSCOPE_API_KEY"
assert "removed from the bracelet" in src_text, "散珠须同物理尺寸（像从手镯取下）"
assert "Never intentionally enlarge or shrink a representative" in src_text, \
    "生成尺度规则须为物理取下/不放大不缩小语义（不依赖直径）"
assert "bead #1" not in src_text, "顺序规则不得硬编码 N==3"
assert "lower side" not in src_text, "构图不得固定下侧弧线"
assert "left-to-right identity order" not in src_text, "不得要求生成珠保持左/右空间顺序"
assert "indexing convention" in src_text, "左→右仅为身份/索引约定"
assert "{n}" in src_text, "Prompt 须保持 {n} 参数化"
assert "qwen-image-2.0-pro" not in src_text, "single-pass：不得有模型回退重试"
assert "_models" not in src_text, "single-pass：不得有模型列表重试循环"
assert "visual_identity" in src_text, "analysis 须用 visual_identity 自由文本 schema"
assert '"group_id"' not in src_text, "schema 不得再定义 group_id 字段"
assert "_SHAPES" not in src_text and "_TIERS" not in src_text, "schema 不得有形状/尺寸枚举"
assert "size_tier" not in src_text and "color_family" not in src_text, "旧刚性分类字段已移除"
assert "never more, never fewer" in src_text, "Prompt 须硬约束散珠总数 == N"
assert "MUST 分为不同组" in src_text, "分组规则须为 MUST 而非 may/可分开"
print("[ok] 物理尺度/范围/凭证口径守卫 + single-pass 守卫")

# 8) 参考页公共比例：不同尺寸 bbox 的相对表观尺寸保持比例
from PIL import ImageDraw  # noqa: E402
canvas2 = Image.new("RGB", (1000, 1000), (210, 210, 210))
ImageDraw.Draw(canvas2).rectangle([400, 400, 599, 599], fill=(0, 0, 255))
canvas2.save(OUT / "t_src.png")
crs2 = [{"display_name": "A", "representative_bbox_1000": [100, 100, 200, 200]},   # 100x100
        {"display_name": "B", "representative_bbox_1000": [400, 400, 600, 600]}]   # 200x200
p1 = crystal.build_bead_sheet(OUT / "t_src.png", crs2, OUT / "t_sheet_s1.png", gap=40)
s1 = Image.open(p1)
assert s1.size == (100 + 40 + 200, 200), "未超限时须保留原始相对尺寸（不拉成同高）"
assert s1.crop((140, 0, 340, 200)).size == (200, 200), "大珠在参考页仍为小珠 2 倍"
p2 = crystal.build_bead_sheet(OUT / "t_src.png", crs2, OUT / "t_sheet_s2.png",
                              gap=40, max_width=170)
s2 = Image.open(p2)
assert s2.width <= 170 and s2.height <= 520, "最终页须实际满足 max_width/max_height"
scale = (170 - 40) / (100 + 200)  # 间隙不缩放：可用裁剪宽 = max_width - gap*(n-1)
h_small, h_large = int(100 * scale), int(200 * scale)
assert s2.height == h_large and abs(h_large / h_small - 2.0) < 0.1, "缩小后相对比例仍须保持"
p3 = crystal.build_bead_sheet(OUT / "t_src.png", crs2, OUT / "t_sheet_s3.png",
                              gap=40, max_height=120)
s3 = Image.open(p3)
assert s3.width <= 1600 and s3.height <= 120, "高度上限同样须满足"
print("[ok] 参考页公共比例保留相对尺寸且满足页面上限")

# 9) 参考页配置校验：固定间隙单独占满/超过 max_width 时拒绝（ValueError，不静默夹紧）
try:
    crystal.build_bead_sheet(OUT / "t_src.png", crs2, OUT / "t_sheet_bad.png",
                             gap=40, max_width=40)  # avail_w = 40-40 = 0
    raise SystemExit("FAIL: avail_w<=0 应抛 ValueError")
except ValueError:
    pass
print("[ok] 参考页拒绝 avail_w<=0 非法配置")

print("\nALL CRYSTAL CHECKS PASSED")
