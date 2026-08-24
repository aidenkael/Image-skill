#!/usr/bin/env python3
"""crystal 技能本地验证（无网络、无 API 调用）。

覆盖：bbox 校验、schema 无 group_id、validate_placements 结构校验、
build_representative_assets（path + source_bbox）、generate_representative_edit
两图输入 + [[source_bbox], [target_box]]、compose 独立性不变量（同一干净 base）、
确定性局部合并（区域外像素不变）、一次性合成/顺序插入零残留、
wan2.7-image-pro 默认模型、凭证/端点规则、本地标注。
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

# 1) 主流水线不得依赖 rembg/本地抠图合成（方向守卫）
assert "import rembg" not in src_text and "import cv2" not in src_text, "主流水线不得回到 rembg/本地抠图合成"
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

# 5) build_representative_assets()：每组一个紧裁剪资产（仅 path + visual_identity，
#    无 source_bbox），默认 context_ratio=0.12，短边满足 min_side
from PIL import Image  # noqa: E402
import inspect  # noqa: E402
sig = inspect.signature(crystal.build_representative_assets)
assert sig.parameters["context_ratio"].default == 0.12, "默认 context_ratio 必须为 0.12"
crs = [{"display_name": "独特标注名ALPHA", "visual_identity": "identity-text-BETA",
        "representative_bbox_1000": [100, 100, 200, 200]},
       {"display_name": "B", "visual_identity": "x", "representative_bbox_1000": [400, 400, 600, 600]},
       {"display_name": "C", "visual_identity": "x", "representative_bbox_1000": [10, 10, 40, 40]}]
refs_dir = OUT / "refs"
assets = crystal.build_representative_assets(SAMPLE, crs, refs_dir, min_side=64)
assert len(assets) == 3, "每组应生成一个代表资产"
for i, (asset, group) in enumerate(zip(assets, crs), 1):
    assert set(asset) == {"path", "visual_identity"}, \
        f"asset 只能含 path + visual_identity，实际 {set(asset)}"
    assert asset["visual_identity"] == group["visual_identity"]
    p = Path(asset["path"])
    assert p.name == f"reference_{i:02d}.png" and p.exists()
    im = Image.open(p)
    assert min(im.size) >= 64, f"{p.name} 短边应放大到至少 64，实际 {im.size}"
print("[ok] build_representative_assets 紧裁剪资产（无 source_bbox）+ visual_identity 携带 + min_side")

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

# 7) 双模型分工：base=qwen-image-3.0-pro，插入=wan2.7-image-pro；QWEN_EDIT_MODEL 不控制 Crystal
saved_env = {k: os.environ.get(k) for k in ("CRYSTAL_IMAGE_MODEL", "CRYSTAL_BASE_MODEL", "QWEN_EDIT_MODEL")}
try:
    os.environ.pop("CRYSTAL_IMAGE_MODEL", None)
    os.environ.pop("CRYSTAL_BASE_MODEL", None)
    os.environ.pop("QWEN_EDIT_MODEL", None)
    assert crystal._image_model() == "wan2.7-image-pro", "插入默认模型必须是 wan2.7-image-pro"
    assert crystal._base_model() == "qwen-image-3.0-pro", "base 默认模型必须是 qwen-image-3.0-pro"
    os.environ["QWEN_EDIT_MODEL"] = "qwen-image-2.0-pro"
    assert crystal._image_model() == "wan2.7-image-pro", "QWEN_EDIT_MODEL 不得影响 Crystal"
    assert crystal._base_model() == "qwen-image-3.0-pro", "QWEN_EDIT_MODEL 不得影响 Crystal base"
    os.environ["CRYSTAL_IMAGE_MODEL"] = "wan2.7-image-pro-v2"
    os.environ["CRYSTAL_BASE_MODEL"] = "qwen-image-3.0-pro-v2"
    assert crystal._image_model() == "wan2.7-image-pro-v2", "CRYSTAL_IMAGE_MODEL 应可覆盖"
    assert crystal._base_model() == "qwen-image-3.0-pro-v2", "CRYSTAL_BASE_MODEL 应可覆盖"
finally:
    for k, v in saved_env.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v
print("[ok] 双模型分工默认值（base=qwen-image-3.0-pro / 插入=wan2.7-image-pro）与覆盖")

# 8) 架构守卫：一次性合成与顺序插入零残留，无重试/回退
for gone in ("call_edit", "EDIT_PROMPT", "MAX_INPUT_IMAGES", "MAX_BEAD_GROUPS",
             "_groups_text", "_call_wan",
             "qwen-image-2.0-pro", "build_bead_sheet", "bead_sheet",
             "insert_representative", "build_representative_crops",
             "current = step_out", "placed later", "source_bbox",
             "retry", "fallback"):
    assert gone not in src_text, f"旧架构/回退残留: {gone}"
assert "wan2.7-image-pro" in src_text, "Crystal 默认模型须为 wan2.7-image-pro"
assert "CRYSTAL_IMAGE_MODEL" in src_text, "须支持 CRYSTAL_IMAGE_MODEL 覆盖"
for need in ("_call_image_model", "_base_model", "BASE_NEGATIVE",
             "qwen-image-3.0-pro", "BASE_PROMPT", "INSERT_PROMPT",
             "generate_base_scene", "build_representative_assets",
             "generate_representative_edit", "merge_independent_edits",
             "_paste_feathered_region", "_expand_pixel_box",
             "compose_representatives", "validate_placements",
             "bbox_list", "ImageFilter"):
    assert need in src_text, f"缺少独立编辑架构组件: {need}"
print("[ok] 一次性合成/顺序插入零残留；独立编辑+确定性合并组件齐全；无重试/回退")

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

# 10) mock _call_wan：generate_representative_edit 两图输入 + [[source_bbox], [target_box]]
canvas = Image.new("RGB", (1200, 1600), (235, 232, 226))
canvas.save(OUT / "t_canvas.png")
rep_img = Image.new("RGB", (96, 96), (200, 160, 180))
rep_img.save(OUT / "t_rep.png")
asset = assets[0]  # 独特标注名ALPHA / identity-text-BETA（display_name 不得进 prompt）

calls = []


def fake_call_image_model(model, images, prompt, output_path,
                          size="1200*1600", bbox_list=None,
                          prompt_extend=None, negative_prompt=None):
    calls.append({"model": model, "images": [Path(p) for p in images],
                  "prompt": prompt, "output_path": Path(output_path),
                  "size": size, "bbox_list": bbox_list,
                  "prompt_extend": prompt_extend,
                  "negative_prompt": negative_prompt})
    Image.new("RGB", (1200, 1600), (230, 228, 222)).save(output_path)
    return Path(output_path)


orig_call = crystal._call_image_model
crystal._call_image_model = fake_call_image_model
try:
    out = crystal.generate_representative_edit(OUT / "t_canvas.png", asset,
                                               [100, 100, 200, 200],
                                               OUT / "t_edit.png")
    assert out == Path(OUT / "t_edit.png")
    assert len(calls) == 1, "一次代表件编辑恰好一次调用"
    c = calls[0]
    assert len(c["images"]) == 2, "独立编辑必须是两图输入"
    assert c["images"][0] == Path(asset["path"]), "Image 1 必须是代表资产"
    assert c["images"][1] == Path(OUT / "t_canvas.png"), "Image 2 必须是未变更 base"
    assert c["bbox_list"] == [[], [[120, 160, 240, 320]]], \
        f"bbox_list 必须为 [[], [target_box]]（源图不加框），实际 {c['bbox_list']}"
    assert c["size"] == "1200*1600", "编辑尺寸必须跟随 base 画布"
    assert c["model"] == "wan2.7-image-pro", "代表件编辑必须用 Wan"
    assert c["prompt_extend"] is None, "Wan 插入不得传 prompt_extend"
    assert "identity-text-BETA" in c["prompt"], "插入 prompt 必须绑定 visual_identity"
    assert "独特标注名ALPHA" not in c["prompt"], "display_name 不得进入插入 prompt"

    # generate_base_scene：Qwen、两图（手镯裁剪 + 模板）、无 bbox、prompt_extend=False、负向守卫
    calls.clear()
    crystal.generate_base_scene(OUT / "t_rep.png", OUT / "t_canvas.png",
                                OUT / "t_base.png", size="1200*1600")
    assert len(calls) == 1, "基础场景恰好一次调用"
    cb = calls[0]
    assert cb["model"] == "qwen-image-3.0-pro", "base 必须用 Qwen"
    assert len(cb["images"]) == 2 and cb["bbox_list"] is None, \
        "基础场景不得传代表参考或 bbox"
    assert cb["prompt_extend"] is False, "base 必须 prompt_extend=False"
    assert cb["negative_prompt"] and "replaced component" in cb["negative_prompt"] \
        and "duplicated component" in cb["negative_prompt"] \
        and "missing bead" in cb["negative_prompt"], \
        "base 负向 prompt 必须含重复/缺失/替换组件守卫"
    assert cb["prompt"] == crystal.BASE_PROMPT
    assert "placed later" not in cb["prompt"], "base prompt 不得提及后续组件"
finally:
    crystal._call_image_model = orig_call
print("[ok] base=Qwen（2 图/无 bbox/prompt_extend=False/负向守卫）+ 插入=Wan（[[], [target]]/无 prompt_extend）")

# 11) 独立性不变量：compose 的每次编辑都收到同一张干净 base，
#     任何编辑产物都不得成为另一次编辑的输入
edit_calls = []


def fake_edit(base_path, representative_asset, bbox_1000, output_path):
    edit_calls.append({"base": Path(base_path), "out": Path(output_path),
                       "asset": representative_asset})
    Image.new("RGB", (1200, 1600), (225, 222, 216)).save(output_path)
    return Path(output_path)


assets3 = [{"path": OUT / "t_rep.png", "visual_identity": f"id-{i}"} for i in range(1, 4)]
placements3 = crystal.validate_placements({"placements": [
    {"reference_index": 1, "bbox_1000": [100, 100, 200, 200]},
    {"reference_index": 2, "bbox_1000": [600, 700, 700, 800]},
    {"reference_index": 3, "bbox_1000": [300, 800, 400, 900]}]}, 3)

orig_edit = crystal.generate_representative_edit
crystal.generate_representative_edit = fake_edit
try:
    final_out = crystal.compose_representatives(
        OUT / "t_canvas.png", assets3, placements3,
        OUT / "t_composed.png", OUT / "t_work")
    assert final_out == Path(OUT / "t_composed.png") and final_out.exists()
    assert len(edit_calls) == 3, "N 组恰好 N 次独立编辑"
    base_arg = edit_calls[0]["base"]
    assert base_arg == Path(OUT / "t_canvas.png")
    outs = {c["out"] for c in edit_calls}
    for c in edit_calls:
        assert c["base"] == base_arg, "每次编辑必须使用同一张干净 base"
        assert c["base"] not in outs, "编辑产物不得作为另一次编辑的输入"
    try:
        crystal.compose_representatives(OUT / "t_canvas.png", assets3[:2],
                                        placements3, OUT / "t_x.png", OUT / "t_work")
        raise SystemExit("FAIL: 代表资产数量与 placements 不一致应被拒绝")
    except ValueError:
        pass
finally:
    crystal.generate_representative_edit = orig_edit
print("[ok] compose 独立性不变量（同一干净 base，编辑产物互不消费）")

# 12) 确定性局部合并：区域外像素与 base 完全一致，目标中心来自编辑图，尺寸不变
base_im = Image.new("RGB", (400, 400), (10, 10, 10))
base_im.save(OUT / "t_merge_base.png")
edited_im = Image.new("RGB", (400, 400), (200, 0, 0))
edited_im.save(OUT / "t_merge_edit.png")
merged = crystal.merge_independent_edits(
    OUT / "t_merge_base.png", [OUT / "t_merge_edit.png"],
    [{"reference_index": 1, "bbox_1000": [250, 250, 500, 500]}],
    OUT / "t_merged.png")
m = Image.open(merged)
assert m.size == (400, 400), "合并输出尺寸必须等于 base"
assert m.getpixel((20, 20)) == (10, 10, 10), "远区域外像素必须与 base 完全一致"
assert m.getpixel((380, 380)) == (10, 10, 10), "远区域外像素必须与 base 完全一致"
assert m.getpixel((150, 150)) == (200, 0, 0), "目标中心必须来自编辑图"
# 尺寸不一致显式拒绝
bad_edit = Image.new("RGB", (300, 300), (0, 200, 0))
bad_edit.save(OUT / "t_merge_bad.png")
try:
    crystal.merge_independent_edits(OUT / "t_merge_base.png", [OUT / "t_merge_bad.png"],
                                    [{"reference_index": 1, "bbox_1000": [250, 250, 500, 500]}],
                                    OUT / "t_merged_bad.png")
    raise SystemExit("FAIL: 编辑图尺寸不一致应被拒绝")
except ValueError:
    pass
print("[ok] 确定性局部合并（区域外不变/中心来自编辑图/尺寸守卫）")

# 12.5) _expand_pixel_box：横向用 px、纵向用 py，默认 ratio=0.20（捕捉旧 y2+px bug）
sig_e = inspect.signature(crystal._expand_pixel_box)
assert sig_e.parameters["ratio"].default == 0.20, "默认合并外扩比例必须为 0.20"
exp = crystal._expand_pixel_box([100, 100, 300, 200], 1000, 1000)
assert exp == [60, 80, 340, 220], f"非方形框横/纵外扩必须分离（px=40/py=20），实际 {exp}"
print("[ok] _expand_pixel_box 横纵分离 + ratio 0.20")

# 13) _call_image_model bbox_list 长度守卫（长度与图片数不一致时不发请求即拒绝）
try:
    crystal._call_image_model("wan2.7-image-pro",
                              [OUT / "t_rep.png", OUT / "t_canvas.png"],
                              crystal.INSERT_PROMPT, OUT / "t_unused.png",
                              bbox_list=[[]])
    raise SystemExit("FAIL: bbox_list 长度与图片数不一致应立即拒绝")
except ValueError:
    pass
print("[ok] _call_image_model bbox_list 长度守卫")

# 14) 本地准备 + 编辑式标注（无网络）
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
