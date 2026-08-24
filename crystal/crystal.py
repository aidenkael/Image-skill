#!/usr/bin/env python3
"""crystal 技能 — 水晶手镯参考图（bbox 逐件插入主流水线，唯一运行时入口）。

主流水线（规划式多阶段、零重试；取代一次性多参考图合成与顺序插入）：
    新鲜 analysis → base：清理裁剪 + 每组上下文代表资产 + 一次干净场景生成（无散珠）
    → 强制 base QA 门 → Agent 一次性决定全部摆放框 placements.json
    → compose：N 次独立局部编辑（每次都用同一张干净 base；Image 1 为无框紧裁剪身份参考，
      仅 Image 2 目标区域以 bbox_list 选中，visual_identity 绑定进每次插入 prompt）
    → Pillow 羽毛合并仅合并 N 个被编辑的局部区域回同一干净 base
    → Agent 视觉 QA → 本地 Pillow 编辑式标注 → 成品图

凭证仅从环境变量 DASHSCOPE_API_KEY（.env）读取，代码不硬编码密钥，无其他凭证回退；
Crystal 图像模型用 CRYSTAL_IMAGE_MODEL（默认 wan2.7-image-pro），端点可用 DASHSCOPE_API_URL 替换。

用法:
    python crystal/crystal.py base \
        --input src.jpg --analysis a.json --output base.png --workdir work
    # Agent 目视 base 图后写 placements.json（每组恰好一个框）
    python crystal/crystal.py compose \
        --input base.png --source src.jpg --analysis a.json \
        --placements placements.json --output candidate.png --workdir work
    python crystal/crystal.py label \
        --input candidate.png --labels l.json --output final.png

analysis.json（坐标 0..1000 归一化）:
    {"bracelet_bbox_1000": [x1,y1,x2,y2],
     "bead_groups": [
       {"display_name": "中文标注名",
        "visual_identity": "自由文本可见身份描述（几何/相对物理尺寸/颜色/透明度/内含物/纹理/表面特征）",
        "representative_bbox_1000": [x1,y1,x2,y2]}, ...]}
bracelet_bbox_1000 = 完整可见手镯产品范围：包含手镯自有的珠/石/珍珠、金属包边、
隔珠、连接件、吊坠/挂饰；仅排除外包装、托盘、纸张、手及无关背景物体。
bead_groups = 手镯上视觉可区分的非金属珠/石/珍珠材质组件（物理上属于该手镯）：
同一组的判据 = 允许透视、光照/反射、珠间自然微小差异后，设计层面的可见身份仍等价；
几何/形状、标称物理尺寸、颜色/光学外观、透明度/不透明度、特征纹理/内含物/表面外观
任一出现清晰可见的设计层面差异，MUST 分为不同组（不使用"可分开"等模糊措辞）；
金属隔珠/帽/包边/配件不属于珠组，但仍是完整手镯的一部分，必须在生成中保留；
只统计物理位于手镯上的组件，代表珠裁自手镯本身（Agent 视觉分析职责）；
代表矩形落在 bracelet_bbox 内仅为坐标 sanity check，不证明物理归属；
包装/托盘/纸张/手/背景中任何类水晶物体不得计为一组；
--types 可选：提供则强校验组数，缺省则用当前分析的新鲜组数（不复用历史运行）。
display_name 仅用于最终 Pillow 标注，绝不进入生成 Prompt。

labels.json（像素坐标，位置应呼应生成图中散珠摆放，小字、克制、可带细引线）:
    {"labels": [{"text": "锂云母", "x": 372, "y": 1330,
                 "point_to": [372, 1240]}, ...]}

placements.json（base 场景上 0..1000 归一化坐标，Agent 一次性决定全部框）:
    {"placements": [{"reference_index": 1,
                     "bbox_1000": [x1, y1, x2, y2]}, ...]}
reference_index 从 1 起对应 bead_groups 顺序，1..N 各恰好一次；
框不得压住主手镯、不得刻意相互重叠、物理尺寸须匹配手镯组件尺度、
手工摆放感（非行/网格/等距/弧线模板）。框的校验仅为结构性检查，
摆放审美由 Agent 视觉分析负责。
"""

import argparse
import base64
import json
import os
import sys
import tempfile
from pathlib import Path

import requests
from PIL import Image, ImageDraw, ImageFilter, ImageFont

SKILL_DIR = Path(__file__).resolve().parent
REPO_ROOT = SKILL_DIR.parent

_uncertain = ("疑似", "可能", "大概", "或许")

# 编辑式标注字体：楷/仿宋优先（手写编辑感），回退黑体/苹方/Noto
_CJK_FONTS = [
    "C:/Windows/Fonts/simkai.ttf",
    "C:/Windows/Fonts/simfang.ttf",
    "C:/Windows/Fonts/msyh.ttc",
    "/System/Library/Fonts/PingFang.ttc",
    "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
]


# ---------------------------------------------------------------- 环境/凭证

def _load_env():
    env = REPO_ROOT / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


_load_env()


def _token():
    """凭证只读 DASHSCOPE_API_KEY，不设任何其他回退。"""
    return os.environ.get("DASHSCOPE_API_KEY")


# Token Plan 端点（sk-sp- 凭证）见根目录 .env.example；其余走 DashScope 标准端点
TOKEN_PLAN_ENDPOINT = ("https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/"
                       "multimodal-generation/generation")
DASHSCOPE_ENDPOINT = ("https://dashscope.aliyuncs.com/api/v1/services/aigc/"
                      "multimodal-generation/generation")


def _endpoint():
    """DASHSCOPE_API_URL 优先；否则仅 sk-sp- Token Plan 凭证走 Token Plan 端点。
    非 Token Plan 凭证且未显式配置 DASHSCOPE_API_URL 时直接失败，
    拒绝猜测 Wan workspace 端点。"""
    url = os.environ.get("DASHSCOPE_API_URL")
    if url:
        return url
    if (_token() or "").startswith("sk-sp-"):
        return TOKEN_PLAN_ENDPOINT
    raise RuntimeError(
        "非 Token Plan（sk-sp-）凭证且未配置 DASHSCOPE_API_URL："
        "拒绝猜测 Wan workspace 端点，请改用 Token Plan 凭证或显式配置 DASHSCOPE_API_URL"
    )


# ---------------------------------------------------------------- 分析校验

def clean_name(name):
    """清洗标注名：去首尾空白与全半角括号冒号；空名/不确定措辞显式抛错，不静默兜底。"""
    name = str(name).strip().strip("：:（）() ")
    if not name:
        raise ValueError("名称不能为空")
    if any(w in name for w in _uncertain):
        raise ValueError("名称不得包含疑似/可能/大概/或许等不确定措辞")
    return name


def bbox1000_to_pixels(bbox, width, height):
    x1, y1, x2, y2 = _check_bbox(bbox, "bbox_1000")
    px = [
        int(round(x1 / 1000 * width)),
        int(round(y1 / 1000 * height)),
        int(round(x2 / 1000 * width)),
        int(round(y2 / 1000 * height)),
    ]
    px[2] = min(width, max(px[0] + 1, px[2]))
    px[3] = min(height, max(px[1] + 1, px[3]))
    return px


def _check_bbox(bbox, label):
    if not (isinstance(bbox, (list, tuple)) and len(bbox) == 4):
        raise ValueError(f"{label} 非法: {bbox}")
    vals = [float(v) for v in bbox]
    if not all(0.0 <= v <= 1000.0 for v in vals):
        raise ValueError(f"{label} 超出 0-1000: {bbox}")
    x1, y1, x2, y2 = vals
    if not (x1 < x2 and y1 < y2):
        raise ValueError(f"{label} 必须满足 x1<x2 且 y1<y2: {bbox}")
    return vals


def validate_analysis(raw, type_count=None):
    """bead_groups schema：display_name + visual_identity 自由文本 + 代表矩形（无 group_id）。

    type_count 可选：显式提供则强校验组数；缺省用当前分析的新鲜组数。
    代表矩形包含关系仅为坐标 sanity check；物理归属手镯是 Agent 视觉分析职责。"""
    if not isinstance(raw, dict):
        raise ValueError("analysis 必须是 JSON 对象")
    groups = raw.get("bead_groups")
    if not isinstance(groups, list) or not groups:
        raise ValueError("analysis 缺少非空 bead_groups 列表")
    if type_count is not None and len(groups) != type_count:
        raise ValueError(f"珠类组数不符: analysis 提供 {len(groups)} 组，"
                         f"显式要求恰好 {type_count} 组")
    bb = _check_bbox(raw.get("bracelet_bbox_1000"), "bracelet_bbox_1000")
    cleaned = []
    for i, g in enumerate(groups):
        if not isinstance(g, dict):
            raise ValueError(f"bead_groups[{i}] 非法")
        vi = str(g.get("visual_identity", "")).strip()
        if not vi:
            raise ValueError(f"bead_groups[{i}].visual_identity 缺失"
                             f"（须为自由文本的可见身份描述）")
        rb = _check_bbox(g.get("representative_bbox_1000"),
                         f"bead_groups[{i}].representative_bbox_1000")
        if not (rb[0] >= bb[0] - 1 and rb[1] >= bb[1] - 1 and
                rb[2] <= bb[2] + 1 and rb[3] <= bb[3] + 1):
            raise ValueError(f"bead_groups[{i}] 代表矩形坐标 sanity check 失败："
                             f"应落在 bracelet_bbox_1000 内")
        cleaned.append({"display_name": clean_name(g.get("display_name", "")),
                        "visual_identity": vi,
                        "representative_bbox_1000": rb})
    return {"bracelet_bbox_1000": bb, "bead_groups": cleaned}


def validate_placements(raw, group_count):
    """placements 结构性校验：每组恰好一个框，reference_index 恰好覆盖 1..N。

    摆放审美/不压手镯/不相互重叠是 Agent 视觉职责，代码只保证结构合法。
    返回按 reference_index 1..N 排序的规范列表。"""
    if not isinstance(raw, dict):
        raise ValueError("placements 必须是 JSON 对象")

    items = raw.get("placements")
    if not isinstance(items, list) or len(items) != group_count:
        raise ValueError(
            f"placements 数量必须等于 bead_groups 数量 {group_count}"
        )

    found = {}
    for item in items:
        if not isinstance(item, dict):
            raise ValueError("placement 项必须是对象")
        idx = item.get("reference_index")
        if not isinstance(idx, int) or isinstance(idx, bool) \
                or not (1 <= idx <= group_count):
            raise ValueError(f"reference_index 非法: {idx}")
        if idx in found:
            raise ValueError(f"reference_index 重复: {idx}")
        found[idx] = _check_bbox(item.get("bbox_1000"),
                                 f"placements[{idx}].bbox_1000")

    if set(found) != set(range(1, group_count + 1)):
        raise ValueError("placements 必须完整覆盖 reference_index 1..N")

    return [{"reference_index": idx, "bbox_1000": found[idx]}
            for idx in range(1, group_count + 1)]


# ---------------------------------------------------------------- 本地准备

def build_clean_source(input_path, bbox_1000, out_path, margin=0.06, min_side=384):
    """清理裁剪：完整可见手镯产品范围（含金属配件），排除包装/托盘/手/说明纸等无关内容。

    短边不足 min_side 时仅放大（不缩小），满足 wan2.7-image-pro 输入最低分辨率（≥240x240）。"""
    im = Image.open(input_path).convert("RGB")
    w, h = im.size
    x1, y1, x2, y2 = bbox1000_to_pixels(bbox_1000, w, h)
    mx, my = int((x2 - x1) * margin), int((y2 - y1) * margin)
    box = (max(0, x1 - mx), max(0, y1 - my), min(w, x2 + mx), min(h, y2 + my))
    crop = im.crop(box)
    scale = max(1.0, min_side / min(crop.width, crop.height))
    if scale > 1.0:
        crop = crop.resize((max(1, round(crop.width * scale)),
                            max(1, round(crop.height * scale))), Image.LANCZOS)
    crop.save(out_path, quality=92)
    return Path(out_path)


def build_representative_assets(
    input_path,
    groups,
    out_dir,
    context_ratio=0.12,
    min_side=384,
):
    """每组一个紧裁剪单组件身份参考：保留原始源像素（不分割/不去背/不合成），
    仅最小周边上下文，避免邻珠成为竞争身份源。

    身份选择不再依赖源图 bbox：Wan 交互编辑的 bbox_list 只标识要编辑的区域，
    源图不加框；身份约束改由 visual_identity 绑定进插入 prompt。短边不足
    min_side 时仅放大（不缩小）。"""
    im = Image.open(input_path).convert("RGB")
    w, h = im.size
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    assets = []

    for i, group in enumerate(groups, 1):
        x1, y1, x2, y2 = bbox1000_to_pixels(
            group["representative_bbox_1000"], w, h
        )

        bw = x2 - x1
        bh = y2 - y1
        pad_x = max(2, round(bw * context_ratio))
        pad_y = max(2, round(bh * context_ratio))

        cx1 = max(0, x1 - pad_x)
        cy1 = max(0, y1 - pad_y)
        cx2 = min(w, x2 + pad_x)
        cy2 = min(h, y2 + pad_y)

        crop = im.crop((cx1, cy1, cx2, cy2))

        scale = max(1.0, min_side / min(crop.width, crop.height))
        if scale > 1.0:
            crop = crop.resize(
                (
                    max(1, round(crop.width * scale)),
                    max(1, round(crop.height * scale)),
                ),
                Image.LANCZOS,
            )

        path = out_dir / f"reference_{i:02d}.png"
        crop.save(path)

        assets.append({
            "path": path,
            "visual_identity": group["visual_identity"],
        })

    return assets


# ---------------------------------------------------------------- 编辑调用

def _image_model():
    """Crystal 专用图像编辑模型：CRYSTAL_IMAGE_MODEL 可覆盖，默认 wan2.7-image-pro。
    Crystal 不使用 ecom-shot 的编辑模型配置变量。"""
    return os.environ.get("CRYSTAL_IMAGE_MODEL", "wan2.7-image-pro")


BASE_PROMPT = """Create one photorealistic commercial/editorial jewelry photograph.

Image 1 is the only source of truth for the complete bracelet.
Image 2 is only the empty scene/background reference.

Place exactly one complete bracelet naturally into the scene from Image 2.

Preserve the bracelet from Image 1:
- every bead, stone and pearl
- geometry and order
- relative physical scale
- color and transparency
- inclusions and surface traits
- every metal setting, spacer, connector and ornament

Do not add, remove, merge, substitute or redesign any bracelet component.

The surface around the bracelet must remain empty, clean and uncluttered.
Do not generate any loose bead, loose stone, loose pearl, metal disc, spare component, prop or decorative object.

Generate no text, labels, title, logo or watermark.

Photorealistic jewelry photography.
Natural reflections and contact shadows.
No CGI, plastic, sticker or collage appearance.
"""

INSERT_PROMPT = """Place the single dominant jewelry component from Image 1 into the selected empty region of Image 2.

Image 1 is the only identity reference for the new component.
Image 2 is the clean target jewelry photograph.
Only the selected region of Image 2 may be edited.

Required visible identity:
{visual_identity}

Create exactly one physical loose component in the selected target region.

Preserve from Image 1:
- geometry and physical proportions
- relative size implied by the selected target region
- color
- transparency or opacity
- inclusions
- texture and surface traits

Do not reinterpret the component as another bead type.
Do not copy the appearance of any bead already present in Image 2.

Match Image 2 lighting and surface:
- natural contact shadow
- natural local reflection
- no floating object
- no cutout/sticker edge

Do not change the bracelet.
Do not add any second object.
Do not generate text, labels, logo or watermark.
"""


def _b64url(p: Path) -> str:
    mime = "image/png" if p.suffix.lower() == ".png" else "image/jpeg"
    return f"data:{mime};base64," + base64.b64encode(p.read_bytes()).decode()


def _call_wan(images, prompt, output_path, size="1200*1600", bbox_list=None):
    """共享的 wan2.7-image-pro 调用：基础场景生成与独立局部编辑共用。

    规划式多阶段、零重试：失败即抛错，不重试、不换模型、不回退。"""
    token = _token()
    if not token:
        raise RuntimeError("无可用凭证：请配置 .env 的 DASHSCOPE_API_KEY")

    content = [{"image": _b64url(Path(p))} for p in images]
    content.append({"text": prompt})

    parameters = {
        "n": 1,
        "size": size,
        "watermark": False,
    }
    if bbox_list is not None:
        if len(bbox_list) != len(images):
            raise ValueError("bbox_list 长度必须与输入图片数量一致")
        parameters["bbox_list"] = bbox_list

    payload = {
        "model": _image_model(),
        "input": {
            "messages": [{
                "role": "user",
                "content": content,
            }]
        },
        "parameters": parameters,
    }

    resp = requests.post(
        _endpoint(),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=600,
    )
    if resp.status_code != 200:
        raise RuntimeError(
            f"图像调用失败: {_image_model()} HTTP {resp.status_code}: "
            f"{resp.text[:200]}"
        )

    data = resp.json()
    url = None
    try:
        url = next(
            c["image"]
            for c in data["output"]["choices"][0]["message"]["content"]
            if isinstance(c, dict) and c.get("image")
        )
    except Exception:
        try:
            url = data["output"]["results"][0]["url"]
        except Exception:
            url = None

    if not url:
        raise RuntimeError("图像调用失败：响应无图片")

    img = requests.get(url, timeout=120)
    img.raise_for_status()

    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(img.content)

    try:
        with Image.open(output_path) as generated:
            generated.verify()
    except Exception as e:
        output_path.unlink(missing_ok=True)
        raise RuntimeError(f"生成结果不是有效图片: {e}")

    return output_path


def generate_base_scene(clean_src, template, output_path, size="1200*1600"):
    """基础场景：完整手镯 + 空场景模板，不生成任何散珠；恰好一次调用，
    不传任何代表件参考图。"""
    return _call_wan(
        [clean_src, template],
        BASE_PROMPT,
        output_path,
        size=size,
    )


def generate_representative_edit(
    base_path,
    representative_asset,
    bbox_1000,
    output_path,
):
    """独立局部编辑：Image 1 = 无框紧裁剪身份参考，Image 2 = 未变更干净 base，
    bbox_list 只框 Image 2 的目标区域（Wan bbox 语义 = 要编辑的区域，源图不加框）；
    visual_identity 绑定进 prompt 作为显式身份约束。

    关键不变量：base_path 必须始终是 base 阶段原始输出；
    任何代表件编辑的产物都不得作为另一次代表件编辑的输入。"""
    with Image.open(base_path) as base:
        w, h = base.size

    target_box = bbox1000_to_pixels(bbox_1000, w, h)

    prompt = INSERT_PROMPT.format(
        visual_identity=representative_asset["visual_identity"]
    )

    return _call_wan(
        [
            representative_asset["path"],
            base_path,
        ],
        prompt,
        output_path,
        size=f"{w}*{h}",
        bbox_list=[
            [],
            [target_box],
        ],
    )


def _expand_pixel_box(box, width, height, ratio=0.20):
    """合并区域适度外扩：Wan bbox 编辑已限定目标区域，合并只需为羽毛/接触阴影
    留小边距。横向用 px、纵向用 py（不得混用）。"""
    x1, y1, x2, y2 = box
    bw = x2 - x1
    bh = y2 - y1

    px = max(4, round(bw * ratio))
    py = max(4, round(bh * ratio))

    return [
        max(0, x1 - px),
        max(0, y1 - py),
        min(width, x2 + px),
        min(height, y2 + py),
    ]


def _paste_feathered_region(canvas, edited, region, feather_ratio=0.12):
    """场景区域合并：只取编辑图在 region 内的局部场景，边缘高斯羽化后贴回画布。
    不是水晶分割/抠图合成——模型已渲染好代表件及其局部表面/阴影/反射。"""
    x1, y1, x2, y2 = region
    patch = edited.crop((x1, y1, x2, y2))

    pw, ph = patch.size
    feather = max(4, round(min(pw, ph) * feather_ratio))

    mask = Image.new("L", (pw, ph), 0)
    draw = ImageDraw.Draw(mask)

    left = min(feather, max(0, pw // 3))
    top = min(feather, max(0, ph // 3))
    right = max(left + 1, pw - left)
    bottom = max(top + 1, ph - top)

    draw.rectangle(
        [left, top, right - 1, bottom - 1],
        fill=255,
    )
    mask = mask.filter(
        ImageFilter.GaussianBlur(radius=max(1, feather / 2))
    )

    canvas.paste(patch, (x1, y1), mask)


def merge_independent_edits(
    base_path,
    edited_paths,
    placements,
    output_path,
):
    """确定性合并：把 N 张独立编辑图的局部区域羽毛贴回同一张干净 base。
    区域外像素与 base 完全一致。"""
    if len(edited_paths) != len(placements):
        raise ValueError("独立编辑图数量与 placements 数量不一致")

    canvas = Image.open(base_path).convert("RGB")
    w, h = canvas.size

    for edited_path, placement in zip(edited_paths, placements):
        edited = Image.open(edited_path).convert("RGB")

        if edited.size != canvas.size:
            raise ValueError(
                f"独立编辑图尺寸不一致: {edited.size} != {canvas.size}"
            )

        target = bbox1000_to_pixels(
            placement["bbox_1000"], w, h
        )
        region = _expand_pixel_box(target, w, h)

        _paste_feathered_region(
            canvas,
            edited,
            region,
        )

    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output_path, quality=95)

    return output_path


def compose_representatives(
    base_path,
    representative_assets,
    placements,
    output_path,
    workdir,
):
    """N 次独立局部编辑（全部针对同一张干净 base）+ 确定性局部合并。
    这是规划式生产工作，不是重试循环；任何编辑产物都不进入另一次编辑。"""
    if len(representative_assets) != len(placements):
        raise ValueError("代表参考数量与 placements 数量不一致")

    workdir = Path(workdir)
    workdir.mkdir(parents=True, exist_ok=True)

    edited_paths = []

    for i, placement in enumerate(placements, 1):
        ref_index = placement["reference_index"]
        asset = representative_assets[ref_index - 1]

        edit_out = workdir / f"edit_{i:02d}.png"

        generate_representative_edit(
            base_path,
            asset,
            placement["bbox_1000"],
            edit_out,
        )

        edited_paths.append(edit_out)

    return merge_independent_edits(
        base_path,
        edited_paths,
        placements,
        output_path,
    )


# ---------------------------------------------------------------- 编辑式标注

def _cjk_font(size):
    for p in _CJK_FONTS:
        if Path(p).exists():
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return ImageFont.load_default()


def _ink_color(img, x, y):
    patch = img.convert("L").crop((max(0, x - 90), max(0, y - 30),
                                    min(img.width, x + 90),
                                    min(img.height, y + 50)))
    lum = patch.convert("L").resize((1, 1), Image.LANCZOS).getpixel((0, 0))
    return (72, 66, 60) if lum > 128 else (240, 236, 228)


def render_labels(input_path, labels, output_path, font_size=34):
    """本地编辑式标注：小字楷体 + 可选细引线，位置呼应散珠摆放。"""
    im = Image.open(input_path).convert("RGBA")
    overlay = Image.new("RGBA", im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    font = _cjk_font(font_size)
    for lb in labels:
        x, y = int(lb["x"]), int(lb["y"])
        text = clean_name(lb.get("text", ""))
        ink = _ink_color(im, x, y)
        pt = lb.get("point_to")
        if pt:
            px, py = int(pt[0]), int(pt[1])
            d.line([(x, y - 8), (px, py)], fill=ink + (110,), width=1)
            d.ellipse([px - 3, py - 3, px + 3, py + 3], fill=ink + (150,))
        d.text((x, y), text, font=font, fill=ink + (235,), anchor="ma")
    out = Image.alpha_composite(im, overlay).convert("RGB")
    out.save(output_path, quality=92)
    return Path(output_path)


# ---------------------------------------------------------------- CLI

def main():
    parser = argparse.ArgumentParser(
        description="水晶手镯参考图：base 干净场景 → 强制 QA 门 → placements → N 次独立局部编辑 + 确定性合并 → 本地编辑式标注")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_base = sub.add_parser("base", help="清理裁剪 + 代表资产 + 一次干净基础场景生成（无散珠）")
    p_base.add_argument("--input", required=True)
    p_base.add_argument("--analysis", required=True)
    p_base.add_argument("--output", required=True)
    p_base.add_argument("--template", default=str(SKILL_DIR / "templates" / "04.jpg"))
    p_base.add_argument("--size", default="1200*1600")
    p_base.add_argument("--workdir", default=None)

    p_compose = sub.add_parser("compose", help="N 次独立局部编辑（同一干净 base）+ 确定性局部合并（无重试）")
    p_compose.add_argument("--input", required=True, help="base 阶段输出的未变更场景图")
    p_compose.add_argument("--source", required=True, help="原始手镯实拍图（重建代表资产）")
    p_compose.add_argument("--analysis", required=True)
    p_compose.add_argument("--placements", required=True)
    p_compose.add_argument("--output", required=True)
    p_compose.add_argument("--workdir", default=None)

    p_lab = sub.add_parser("label", help="候选图 + labels.json → 成品图（纯本地）")
    p_lab.add_argument("--input", required=True)
    p_lab.add_argument("--labels", required=True)
    p_lab.add_argument("--output", required=True)
    p_lab.add_argument("--font-size", type=int, default=34)

    args = parser.parse_args()

    if args.cmd == "base":
        try:
            raw = json.loads(Path(args.analysis).read_text(encoding="utf-8"))
            analysis = validate_analysis(raw)
        except Exception as e:
            print(f"ERROR: analysis 校验失败: {e}")
            return 1
        work = Path(args.workdir) if args.workdir else \
            Path(tempfile.mkdtemp(prefix="crystal_"))
        work.mkdir(parents=True, exist_ok=True)
        clean_src = build_clean_source(args.input, analysis["bracelet_bbox_1000"],
                                       work / "clean_source.jpg")
        representative_assets = build_representative_assets(
            args.input, analysis["bead_groups"], work / "references")
        print(f"clean_source: {clean_src}\n"
              f"representative assets: {[str(a['path']) for a in representative_assets]}")
        try:
            generate_base_scene(clean_src, Path(args.template), args.output,
                                args.size)
        except Exception as e:
            print(f"ERROR: {e}")
            return 2
        print(f"model_used: {_image_model()}")
        print(f"base: {args.output}")
        return 0

    if args.cmd == "compose":
        try:
            raw = json.loads(Path(args.analysis).read_text(encoding="utf-8"))
            analysis = validate_analysis(raw)
            raw_p = json.loads(Path(args.placements).read_text(encoding="utf-8"))
            placements = validate_placements(raw_p, len(analysis["bead_groups"]))
        except Exception as e:
            print(f"ERROR: analysis/placements 校验失败: {e}")
            return 1
        work = Path(args.workdir) if args.workdir else \
            Path(tempfile.mkdtemp(prefix="crystal_"))
        work.mkdir(parents=True, exist_ok=True)
        # 代表资产确定性重建：同输入同 bbox 产物一致，与 base 阶段等价可复用
        representative_assets = build_representative_assets(
            args.source, analysis["bead_groups"], work / "references")
        try:
            compose_representatives(args.input, representative_assets,
                                    placements, args.output, work / "edits")
        except Exception as e:
            print(f"ERROR: {e}")
            return 2
        print(f"model_used: {_image_model()}")
        print(f"independent_edit_calls: {len(placements)}")
        print(f"candidate: {args.output}")
        return 0

    if args.cmd == "label":
        try:
            labels = json.loads(Path(args.labels).read_text(encoding="utf-8"))["labels"]
        except Exception as e:
            print(f"ERROR: labels 读取失败: {e}")
            return 1
        try:
            render_labels(args.input, labels, args.output, args.font_size)
        except Exception as e:
            print(f"ERROR: 标注失败（名称不能为空/含不确定措辞等）: {e}")
            return 1
        print(f"final: {args.output}")
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
