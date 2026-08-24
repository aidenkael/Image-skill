#!/usr/bin/env python3
"""crystal 技能本地验证（无网络、无 API 调用）。

覆盖：bbox 校验、schema 无 group_id、validate_placements 结构校验、
insert_representative 两图输入 + [[], [target_box]] bbox 结构（mock _call_wan）、
compose 顺序合成结构、一次性多参考合成代码零残留、wan2.7-image-pro 默认模型、
凭证/端点规则、本地标注。
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

# 4) 名称显式失败 + type_count 可选行为
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
print("[ok] 空/不确定名称显式拒绝；type_count 可选行为保持")

# 5) build_representative_crops()：每组一个文件，短边不足 min_side 放大
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

# 6) validate_placements：数量/缺失/重复/反向零面积/排序返回
pl_good = {"placements": [
    {"reference_index": 2, "bbox_1000": [600, 700, 700, 800]},
    {"reference_index": 1, "bbox_1000": [100, 700, 200, 800]}]}
norm = crystal.validate_placements(pl_good, 2)
assert [p["reference_index"] for p in norm] == [1, 2], "必须按 reference_index 1..N 排序返回"
assert norm[0]["bbox_1000"] == [100.0, 700.0, 200.0, 800.0]
try:
    crystal.validate_placements(pl_good, 3)
    raise SystemExit("FAIL: placements 数量错误应被拒绝")
except ValueError:
    pass
try:
    crystal.validate_placements({"placements": [
        {"reference_index": 1, "bbox_1000": [100, 100, 200, 200]}]}, 2)
    raise SystemExit("FAIL: 缺失 reference_index 应被拒绝")
except ValueError:
    pass
try:
    crystal.validate_placements({"placements": [
        {"reference_index": 1, "bbox_1000": [100, 100, 200, 200]},
        {"reference_index": 1, "bbox_1000": [300, 100, 400, 200]}]}, 2)
    raise SystemExit("FAIL: 重复 reference_index 应被拒绝")
except ValueError:
    pass
try:
    crystal.validate_placements({"placements": [
        {"reference_index": 0, "bbox_1000": [100, 100, 200, 200]},
        {"reference_index": 2, "bbox_1000": [300, 100, 400, 200]}]}, 2)
    raise SystemExit("FAIL: reference_index 越界（0）应被拒绝")
except ValueError:
    pass
for bad_bbox in ([800, 800, 200, 200],     # 反向
                 [300, 300, 300, 400]):    # 零面积
    try:
        crystal.validate_placements({"placements": [
            {"reference_index": 1, "bbox_1000": bad_bbox},
            {"reference_index": 2, "bbox_1000": [600, 700, 700, 800]}]}, 2)
        raise SystemExit(f"FAIL: placement bbox {bad_bbox} 应被拒绝")
    except ValueError:
        pass
try:
    crystal.validate_placements([{"reference_index": 1}], 1)
    raise SystemExit("FAIL: 非对象 placements 应被拒绝")
except ValueError:
    pass
print("[ok] validate_placements 结构校验（数量/缺失/重复/越界/反向零面积/排序）")

# 7) Crystal 默认图像模型 wan2.7-image-pro；QWEN_EDIT_MODEL 不控制 Crystal
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

# 8) 架构守卫：一次性多参考合成零残留，无重试/回退/组数上限
for gone in ("call_edit", "EDIT_PROMPT", "MAX_INPUT_IMAGES", "MAX_BEAD_GROUPS",
             "_groups_text", "negative_prompt", "negative prompt",
             "prompt_extend", "qwen-image-2.0-pro", "build_bead_sheet",
             "bead_sheet", "retry", "fallback"):
    assert gone not in src_text, f"一次性合成/回退残留: {gone}"
assert "wan2.7-image-pro" in src_text, "Crystal 默认模型须为 wan2.7-image-pro"
assert "CRYSTAL_IMAGE_MODEL" in src_text, "须支持 CRYSTAL_IMAGE_MODEL 覆盖"
for need in ("_call_wan", "BASE_PROMPT", "INSERT_PROMPT",
             "generate_base_scene", "insert_representative",
             "compose_representatives", "validate_placements", "bbox_list"):
    assert need in src_text, f"缺少分阶段架构组件: {need}"
print("[ok] 一次性多参考合成零残留；分阶段架构组件齐全；无重试/回退")

# 9) 凭证/端点规则：仅 DASHSCOPE_API_KEY；sk-sp- → Token Plan；非 Token Plan 无 URL → 失败
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

# 10) mock _call_wan：insert_representative 两图输入 + [[], [target_box]] 结构
canvas = Image.new("RGB", (1200, 1600), (235, 232, 226))
canvas.save(OUT / "t_canvas.png")
rep_img = Image.new("RGB", (96, 96), (200, 160, 180))
rep_img.save(OUT / "t_rep.png")

calls = []


def fake_call_wan(images, prompt, output_path, size="1200*1600", bbox_list=None):
    calls.append({"images": [Path(p) for p in images], "prompt": prompt,
                  "output_path": Path(output_path), "size": size,
                  "bbox_list": bbox_list})
    Image.new("RGB", (1200, 1600), (230, 228, 222)).save(output_path)
    return Path(output_path)


orig_call_wan = crystal._call_wan
crystal._call_wan = fake_call_wan
try:
    out = crystal.insert_representative(OUT / "t_canvas.png", OUT / "t_rep.png",
                                        [100, 100, 200, 200], OUT / "t_insert.png")
    assert out == Path(OUT / "t_insert.png")
    assert len(calls) == 1, "一次插入恰好一次调用"
    c = calls[0]
    assert len(c["images"]) == 2, "插入调用必须是两图输入"
    assert c["images"][0] == Path(OUT / "t_rep.png"), "Image 1 必须是代表件参考"
    assert c["images"][1] == Path(OUT / "t_canvas.png"), "Image 2 必须是当前画布"
    assert c["bbox_list"] == [[], [[120, 160, 240, 320]]], \
        f"bbox_list 必须恰好 [[], [target_box]]，实际 {c['bbox_list']}"
    assert c["size"] == "1200*1600", "插入尺寸必须跟随画布"
    assert c["prompt"] == crystal.INSERT_PROMPT

    # generate_base_scene：两图（手镯裁剪 + 模板），无散珠、无 bbox_list
    calls.clear()
    crystal.generate_base_scene(OUT / "t_rep.png", OUT / "t_canvas.png",
                                OUT / "t_base.png", size="1200*1600")
    assert len(calls) == 1, "基础场景恰好一次调用"
    cb = calls[0]
    assert len(cb["images"]) == 2 and cb["bbox_list"] is None, \
        "基础场景不得传代表参考或 bbox"
    assert cb["prompt"] == crystal.BASE_PROMPT

    # compose_representatives：按 reference 顺序每件恰好一次插入（非重试循环）
    calls.clear()
    rep2 = OUT / "t_rep2.png"
    Image.new("RGB", (96, 96), (150, 190, 200)).save(rep2)
    placements = crystal.validate_placements({"placements": [
        {"reference_index": 2, "bbox_1000": [600, 700, 700, 800]},
        {"reference_index": 1, "bbox_1000": [100, 700, 200, 800]}]}, 2)
    final_out = crystal.compose_representatives(
        OUT / "t_canvas.png", [OUT / "t_rep.png", rep2], placements,
        OUT / "t_composed.png", OUT / "t_work")
    assert final_out == Path(OUT / "t_composed.png") and final_out.exists()
    assert len(calls) == 2, "N 组恰好 N 次插入调用"
    assert calls[0]["images"][0] == Path(OUT / "t_rep.png"), "第 1 步应插入 reference 1"
    assert calls[1]["images"][0] == rep2, "第 2 步应插入 reference 2"
    assert calls[0]["images"][1] == Path(OUT / "t_canvas.png"), "第 1 步画布应为 base"
    assert calls[1]["images"][1] == OUT / "t_work" / "insert_01.png", \
        "后续步骤画布应为上一步产物（顺序串行）"
    assert calls[0]["output_path"] == OUT / "t_work" / "insert_01.png", \
        "中间步产物应落在 workdir"
    assert calls[1]["output_path"] == Path(OUT / "t_composed.png"), \
        "最后一步产物应为最终输出"
    try:
        crystal.compose_representatives(OUT / "t_canvas.png", [OUT / "t_rep.png"],
                                        placements, OUT / "t_x.png", OUT / "t_work")
        raise SystemExit("FAIL: 参考图数量与 placements 不一致应被拒绝")
    except ValueError:
        pass
finally:
    crystal._call_wan = orig_call_wan
print("[ok] insert_representative/base/compose 结构（mock _call_wan，无网络）")

# 11) _call_wan bbox_list 长度守卫（长度与图片数不一致时不发请求即拒绝）
try:
    crystal._call_wan([OUT / "t_rep.png", OUT / "t_canvas.png"],
                      crystal.INSERT_PROMPT, OUT / "t_unused.png",
                      bbox_list=[[]])
    raise SystemExit("FAIL: bbox_list 长度与图片数不一致应立即拒绝")
except ValueError:
    pass
print("[ok] _call_wan bbox_list 长度守卫")

# 12) 本地准备 + 编辑式标注（无网络）
clean = crystal.build_clean_source(SAMPLE, good["bracelet_bbox_1000"], OUT / "t_clean.jpg")
assert clean.exists()
# 短边不足时 clean_source 放大到 >=240（wan2.7-image-pro 输入最低分辨率）
tiny = Image.new("RGB", (100, 100), (200, 200, 200))
tiny.save(OUT / "t_tiny.png")
c_tiny = crystal.build_clean_source(OUT / "t_tiny.png", [10, 10, 90, 90],
                                    OUT / "t_clean_tiny.jpg", margin=0.0)
tc = Image.open(c_tiny)
assert min(tc.size) >= 240, f"clean_source 短边应放大到 >=240，实际 {tc.size}"
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
