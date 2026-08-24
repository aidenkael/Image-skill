#!/usr/bin/env python3
"""crystal 技能本地验证（无网络、无 API 调用）。

覆盖：bbox 校验、schema 无 group_id、_groups_text 参考图映射、独立代表参考图、
组数上限预检、wan2.7-image-pro 默认模型、凭证/端点规则、本地标注。
"""
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

src_text = (Path(crystal.__file__)).read_text(encoding="utf-8")

# 1) 主流水线不得依赖 rembg/本地合成（方向守卫）
assert "import rembg" not in src_text and "import cv2" not in src_text, "主流水线不得回到 rembg/本地合成"
print("[ok] 主流水线无 rembg/cv2 依赖")

# 2) bbox 校验：bbox1000_to_pixels 直接拒绝反向/零面积（先校验后转换）
assert crystal.bbox1000_to_pixels([0, 0, 1000, 1000], 1200, 1600) == [0, 0, 1200, 1600]
for bad in ([800, 800, 200, 200],      # 反向
            [300, 300, 300, 400],      # 零面积 x1==x2
            [300, 300, 400, 300],      # 零面积 y1==y2
            [100, 100, 50, 150]):      # 反向
    try:
        crystal.bbox1000_to_pixels(bad, 1200, 1600)
        raise SystemExit(f"FAIL: bbox1000_to_pixels 应拒绝 {bad}")
    except ValueError:
        pass
print("[ok] bbox1000_to_pixels 直接拒绝反向/零面积 bbox")

# 3) validate_analysis 使用同一 bbox 语义（bracelet 与代表矩形两条路径）
good = {"bracelet_bbox_1000": [200, 200, 800, 800],
        "bead_groups": [
            {"display_name": "粉晶",
             "visual_identity": "medium round bead, translucent pale pink",
             "representative_bbox_1000": [300, 300, 400, 400]},
            {"display_name": "海蓝宝",
             "visual_identity": "large round bead, translucent blue-green",
             "representative_bbox_1000": [500, 300, 600, 400]}]}
a = crystal.validate_analysis(good)
assert len(a["bead_groups"]) == 2
assert "group_id" not in a["bead_groups"][0] and "group_id" not in a["bead_groups"][1], \
    "校验后的 schema 不得包含 group_id"
for label, path, bad in (("bracelet", "bracelet_bbox_1000", [800, 800, 200, 200]),
                         ("bracelet", "bracelet_bbox_1000", [300, 300, 300, 500]),
                         ("representative", "bead_groups", [400, 400, 300, 500]),
                         ("representative", "bead_groups", [300, 300, 300, 400])):
    bad_raw = copy.deepcopy(good)
    if path == "bracelet_bbox_1000":
        bad_raw[path] = bad
    else:
        bad_raw[path][0]["representative_bbox_1000"] = bad
    try:
        crystal.validate_analysis(bad_raw)
        raise SystemExit(f"FAIL: validate_analysis 应拒绝 {label} bbox {bad}")
    except ValueError:
        pass
print("[ok] validate_analysis 与 bbox1000_to_pixels 同语义（反向/零面积拒绝）")

# 4) 名称显式失败 + --types 可选行为
a2 = crystal.validate_analysis(good, 2)  # 显式 N：强校验
assert [g["display_name"] for g in a2["bead_groups"]] == ["粉晶", "海蓝宝"]
try:
    crystal.validate_analysis(good, 3)
    raise SystemExit("FAIL: 显式 N 组数校验失效")
except ValueError:
    pass
for bad_name in ("", "   ", "疑似紫水晶", "可能紫水晶", "大概紫水晶", "或许紫水晶"):
    bad_raw = copy.deepcopy(good)
    bad_raw["bead_groups"][0]["display_name"] = bad_name
    try:
        crystal.validate_analysis(bad_raw)
        raise SystemExit(f"FAIL: display_name {bad_name!r} 应被显式拒绝")
    except ValueError:
        pass
try:
    crystal.clean_name("")
    raise SystemExit("FAIL: 空名称应抛错")
except ValueError:
    pass
try:
    crystal.clean_name("疑似粉晶")
    raise SystemExit("FAIL: 不确定措辞应抛错")
except ValueError:
    pass
print("[ok] 空/不确定名称显式拒绝；--types 可选行为保持")

# 5) _groups_text()：映射参考图 2..N+1，只含 visual_identity
groups5 = [{"display_name": f"名{i}", "visual_identity": f"identity-{i}"}
           for i in range(1, 6)]
gt = crystal._groups_text(groups5)
assert "Reference image 2: identity-1." in gt, "第 1 组应映射到参考图 2"
assert "Reference image 3: identity-2." in gt
assert "Reference image 6: identity-5." in gt, "第 5 组应映射到参考图 6"
assert "Reference image 1" not in gt, "不得引用 Image 1（那是完整手镯）"
assert all(f"名{i}" not in gt for i in range(1, 6)), "display_name 不得进入生成文本"
assert "identity-5" in gt
print("[ok] _groups_text() 映射参考图 2..N+1 且不含 display_name")

# 6) build_representative_crops()：每组一个文件，短边不足 min_side 放大
crs = [{"display_name": "A", "visual_identity": "x", "representative_bbox_1000": [100, 100, 200, 200]},
       {"display_name": "B", "visual_identity": "x", "representative_bbox_1000": [400, 400, 600, 600]},
       {"display_name": "C", "visual_identity": "x", "representative_bbox_1000": [10, 10, 40, 40]}]
refs_dir = OUT / "refs"
paths = crystal.build_representative_crops(SAMPLE, crs, refs_dir, min_side=64)
assert len(paths) == 3, "每组应生成一个独立参考文件"
assert all(p.name == f"reference_{i:02d}.png" for i, p in enumerate(paths, 1))
from PIL import Image  # noqa: E402
sample_im = Image.open(SAMPLE)
sw, sh = sample_im.size


def crop_px(b):
    x1, y1, x2, y2 = b
    return (round(x2 / 1000 * sw) - round(x1 / 1000 * sw),
            round(y2 / 1000 * sh) - round(y1 / 1000 * sh))


expected_px = [crop_px(c["representative_bbox_1000"]) for c in crs]
for p, (ew, eh) in zip(paths, expected_px):
    im = Image.open(p)
    assert min(im.size) >= 64, f"{p.name} 短边应放大到至少 64，实际 {im.size}"
    if ew >= 64 and eh >= 64:
        assert im.size == (ew, eh), f"{p.name} 短边已足不应放大: {im.size} != {(ew, eh)}"
tiny = Image.open(paths[2])
assert min(tiny.size) == 64, f"小裁剪短边应精确放大到 min_side=64，实际 {tiny.size}"
print("[ok] build_representative_crops 每组一文件 + min_side 放大")

# 7) 组数上限预检：>7 组在 API 调用前拒绝（不静默合并、不回退 contact sheet）
too_many = [{"display_name": f"n{i}", "visual_identity": "x",
             "representative_bbox_1000": [100, 100, 200, 200]} for i in range(8)]
try:
    crystal.call_edit(Path("unused_src"), [], Path("unused_tpl"), Path("unused_out"), too_many)
    raise SystemExit("FAIL: 8 组应被预检拒绝")
except ValueError as e:
    assert "最多支持 7" in str(e), f"预检错误信息不符: {e}"
assert crystal.MAX_BEAD_GROUPS == 7 and crystal.MAX_INPUT_IMAGES == 9
print("[ok] 组数上限预检：>7 组在 API 调用前拒绝")

# 8) Crystal 默认图像模型 wan2.7-image-pro；QWEN_EDIT_MODEL 不控制 Crystal
saved_env = {k: os.environ.get(k) for k in ("CRYSTAL_IMAGE_MODEL", "QWEN_EDIT_MODEL")}
try:
    os.environ.pop("CRYSTAL_IMAGE_MODEL", None)
    os.environ.pop("QWEN_EDIT_MODEL", None)
    assert crystal._image_model() == "wan2.7-image-pro", "默认模型必须是 wan2.7-image-pro"
    os.environ["QWEN_EDIT_MODEL"] = "qwen-image-3.0-pro"
    assert crystal._image_model() == "wan2.7-image-pro", "QWEN_EDIT_MODEL 不得影响 Crystal"
    os.environ["CRYSTAL_IMAGE_MODEL"] = "wan2.7-image-pro-v2"
    assert crystal._image_model() == "wan2.7-image-pro-v2", "CRYSTAL_IMAGE_MODEL 应可覆盖"
finally:
    for k, v in saved_env.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v
print("[ok] 默认模型 wan2.7-image-pro；QWEN_EDIT_MODEL 不控制 Crystal")

# 9) 口径守卫：无 qwen 回退、无 contact sheet/bead sheet 运行时、无 prompt_extend
assert "qwen-image-2.0-pro" not in src_text, "不得有 qwen 回退"
assert "qwen-image-3.0-pro" not in src_text, "Crystal 不再使用 qwen-image-3.0-pro"
assert "QWEN_EDIT_MODEL" not in src_text, "Crystal 不使用 QWEN_EDIT_MODEL"
assert "prompt_extend" not in src_text, "wan2.7-image-pro 不传 prompt_extend"
assert "build_bead_sheet" not in src_text, "contact sheet 运行时已移除"
assert "bead_sheet" not in src_text, "不得残留 bead_sheet 产物"
assert "wan2.7-image-pro" in src_text, "Crystal 默认模型须为 wan2.7-image-pro"
assert "CRYSTAL_IMAGE_MODEL" in src_text, "须支持 CRYSTAL_IMAGE_MODEL 覆盖"
assert "MAX_BEAD_GROUPS" in src_text, "须有组数上限预检"
assert "never more, never fewer" not in src_text, "新 Prompt 不再使用 contact sheet 措辞"
print("[ok] 无 qwen 回退/无 contact sheet 运行时/无 prompt_extend 守卫")

# 10) 凭证/端点规则：仅 DASHSCOPE_API_KEY；sk-sp- → Token Plan；非 Token Plan 无 URL → 失败
saved2 = {k: os.environ.get(k) for k in ("DASHSCOPE_API_URL", "DASHSCOPE_API_KEY")}
try:
    del os.environ["DASHSCOPE_API_KEY"]
    assert crystal._token() is None, "凭证必须只读 DASHSCOPE_API_KEY"
    os.environ["DASHSCOPE_API_URL"] = "https://example.org/custom"
    os.environ["DASHSCOPE_API_KEY"] = "sk-plain"
    assert crystal._endpoint() == "https://example.org/custom", "URL 优先"
    del os.environ["DASHSCOPE_API_URL"]
    os.environ["DASHSCOPE_API_KEY"] = "sk-sp-test"
    assert crystal._endpoint() == crystal.TOKEN_PLAN_ENDPOINT, "sk-sp- 走 Token Plan 端点"
    os.environ["DASHSCOPE_API_KEY"] = "sk-plain"
    try:
        crystal._endpoint()
        raise SystemExit("FAIL: 非 Token Plan 且无 URL 应明确失败")
    except RuntimeError:
        pass
finally:
    for k, v in saved2.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v
print("[ok] 凭证只读 DASHSCOPE_API_KEY；端点规则（Token Plan / 无 URL 明确失败）")

# 11) 本地准备 + 编辑式标注（无网络）
clean = crystal.build_clean_source(SAMPLE, good["bracelet_bbox_1000"], OUT / "t_clean.jpg")
assert clean.exists()
# 短边不足时 clean_source 放大到 >=240（wan2.7-image-pro 输入最低分辨率）
tiny = Image.new("RGB", (100, 100), (200, 200, 200))
tiny.save(OUT / "t_tiny.png")
c_tiny = crystal.build_clean_source(OUT / "t_tiny.png", [10, 10, 90, 90],
                                    OUT / "t_clean_tiny.jpg", margin=0.0)
tc = Image.open(c_tiny)
assert min(tc.size) >= 240, f"clean_source 短边应放大到 >=240，实际 {tc.size}"
canvas = Image.new("RGB", (1200, 1600), (235, 232, 226))
canvas.save(OUT / "t_canvas.png")
final = crystal.render_labels(OUT / "t_canvas.png", [
    {"text": "粉晶", "x": 400, "y": 1300, "point_to": [400, 1220]},
    {"text": "海蓝宝", "x": 760, "y": 1330}], OUT / "t_final.png")
assert final.exists()
try:
    crystal.render_labels(OUT / "t_canvas.png", [{"text": "", "x": 10, "y": 10}],
                          OUT / "t_final_bad.png")
    raise SystemExit("FAIL: 空标注名应显式失败")
except ValueError:
    pass
print("[ok] clean_source + render_labels 本地路径")

print("\nALL CRYSTAL CHECKS PASSED")
