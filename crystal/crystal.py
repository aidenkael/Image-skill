#!/usr/bin/env python3
"""crystal 技能 — 水晶手镯参考图（生成式编辑主流水线，唯一运行时入口）。

主流水线（取代旧 rembg 本地合成与 contact sheet 瓶颈）：
    源图清理裁剪 → Agent 识别 N 组 + 每组一个独立代表件裁剪
    → 一次 wan2.7-image-pro 多参考图编辑调用（Image1 完整手镯 + N 张独立代表参考 + 场景模板）
    → Agent 视觉 QA → 本地 Pillow 编辑式标注 → 成品图

凭证仅从环境变量 DASHSCOPE_API_KEY（.env）读取，代码不硬编码密钥，无其他凭证回退；
Crystal 图像模型用 CRYSTAL_IMAGE_MODEL（默认 wan2.7-image-pro），端点可用 DASHSCOPE_API_URL 替换。

用法:
    python crystal/crystal.py run \
        --input src.jpg [--types N] --analysis a.json --output candidate.png
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
"""

import argparse
import base64
import json
import os
import sys
import tempfile
from pathlib import Path

import requests
from PIL import Image, ImageDraw, ImageFont

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


def build_representative_crops(input_path, groups, out_dir, min_side=384):
    """独立代表件参考图：每组一个独立裁剪文件（不再拼 contact sheet）。

    这些裁剪仅作为可见身份参考；物理尺度由 Image 1 + visual_identity 决定，
    不由独立参考图的像素尺寸决定。短边不足 min_side 时仅放大（不缩小）。"""
    im = Image.open(input_path).convert("RGB")
    w, h = im.size
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    paths = []
    for i, group in enumerate(groups, 1):
        crop = im.crop(
            bbox1000_to_pixels(
                group["representative_bbox_1000"], w, h
            )
        )

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
        paths.append(path)

    return paths


# ---------------------------------------------------------------- 编辑调用

MAX_INPUT_IMAGES = 9
MAX_BEAD_GROUPS = MAX_INPUT_IMAGES - 2


def _image_model():
    """Crystal 专用图像编辑模型：CRYSTAL_IMAGE_MODEL 可覆盖，默认 wan2.7-image-pro。
    Crystal 不使用 ecom-shot 的编辑模型配置变量。"""
    return os.environ.get("CRYSTAL_IMAGE_MODEL", "wan2.7-image-pro")


EDIT_PROMPT = """Create a photorealistic jewelry reference photo.

Reference roles:
- Image 1 is the only source of truth for the complete bracelet.
- Images 2 through {n_plus_one} are independent representative component references, exactly one image per bead_group.
- Image {scene_index} is only the empty scene/background reference.

Bracelet:
- Recreate one complete bracelet from Image 1.
- Preserve all visible beads, stones, pearls, metal settings, spacers, connectors and ornaments.
- Preserve order, geometry, relative physical scale, color, transparency, inclusions and surface traits.
- Do not add, remove, merge, substitute or redesign bracelet components.

Loose representatives:
- Create exactly {n} loose representatives in the final image.
- Create exactly one from each independent representative reference image.
{groups}
- Every representative must preserve the visible identity of its own reference.
- Preserve its physical scale relative to the bracelet and the relative size relationships between groups.
- Do not normalize different groups toward a common shape, size, color or transparency.
- No duplicate, omitted, merged or substituted representative.
- No extra loose metal accessories.

Composition:
- Complete bracelet is the clear main subject.
- Loose representatives are secondary and look naturally hand-arranged beside it.
- Use asymmetry, natural spacing and comfortable negative space.
- No row, grid, equal spacing, fixed arc or reference-order layout.

Style:
- photorealistic commercial/editorial jewelry photography
- believable crystal/glass/pearl material
- natural reflections and contact shadows
- no CGI/plastic/sticker/collage look

Text:
- generate no text, labels, title, logo or watermark"""

NEGATIVE = ("extra representative, missing representative, duplicate representative, merged representative, "
            "changed bracelet structure, changed bead geometry, changed bead scale, changed transparency, "
            "loose metal accessory, rigid row, grid, equal spacing, fixed arc, "
            "text, labels, title, watermark, CGI, plastic, sticker, collage")


def _groups_text(groups):
    """每个组直接对应一张独立参考图（Image 2..N+1）：只含 visual_identity，
    display_name 绝不进入生成 Prompt（猜测的矿名不得干扰生成）。"""
    return "\n".join(
        f"- Reference image {i + 2}: {g['visual_identity']}."
        for i, g in enumerate(groups)
    )


def _b64url(p: Path) -> str:
    mime = "image/png" if p.suffix.lower() == ".png" else "image/jpeg"
    return f"data:{mime};base64," + base64.b64encode(p.read_bytes()).decode()


def call_edit(clean_src, representative_paths, template, output_path, groups,
              size="1200*1600"):
    """一次 wan2.7-image-pro 多参考图编辑调用；single-pass：不自动重试、不换模型重跑。

    输入图顺序：Image1 完整手镯裁剪 → N 张独立代表件参考图 → 最后为场景模板。
    失败即抛错，无 qwen 回退、无 contact-sheet 回退。"""
    if len(groups) > MAX_BEAD_GROUPS:
        raise ValueError(
            f"当前直接多参考图路径最多支持 {MAX_BEAD_GROUPS} 个 bead_groups，"
            f"当前为 {len(groups)}；拒绝退化为 contact sheet"
        )
    token = _token()
    if not token:
        raise RuntimeError("无可用凭证：请配置 .env 的 DASHSCOPE_API_KEY")
    model = _image_model()
    content = [{"image": _b64url(clean_src)}]
    content.extend({"image": _b64url(p)} for p in representative_paths)
    content.append({"image": _b64url(template)})
    content.append({
        "text": EDIT_PROMPT.format(
            n=len(groups),
            n_plus_one=len(groups) + 1,
            scene_index=len(groups) + 2,
            groups=_groups_text(groups),
        )
    })
    payload = {
        "model": model,
        "input": {"messages": [{"role": "user", "content": content}]},
        "parameters": {"n": 1, "size": size, "negative_prompt": NEGATIVE},
    }
    resp = requests.post(_endpoint(),
                         headers={"Authorization": f"Bearer {token}",
                                  "Content-Type": "application/json"},
                         json=payload, timeout=600)
    if resp.status_code != 200:
        raise RuntimeError(f"编辑调用失败: {model} HTTP {resp.status_code}: {resp.text[:200]}")
    data = resp.json()
    url = None
    try:
        url = next(c["image"] for c in
                   data["output"]["choices"][0]["message"]["content"]
                   if isinstance(c, dict) and c.get("image"))
    except Exception:
        try:
            url = data["output"]["results"][0]["url"]
        except Exception:
            url = None
    if not url:
        raise RuntimeError(f"编辑调用失败: {model} 响应无图片")
    img = requests.get(url, timeout=120)
    img.raise_for_status()
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    Path(output_path).write_bytes(img.content)

    try:
        with Image.open(output_path) as generated:
            generated.verify()
    except Exception as e:
        Path(output_path).unlink(missing_ok=True)
        raise RuntimeError(f"生成结果不是有效图片: {e}")
    print(f"model_used: {model}")
    return model


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
        description="水晶手镯参考图：清理裁剪 + 独立多参考图 + 一次 wan2.7-image-pro 编辑 + 本地编辑式标注")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_run = sub.add_parser("run", help="清理裁剪 → 独立代表参考图 → 一次编辑调用 → 候选图")
    p_run.add_argument("--input", required=True)
    p_run.add_argument("--types", type=int, default=None,
                       help="可选：显式组数；缺省用当前 analysis 的新鲜组数")
    p_run.add_argument("--analysis", required=True)
    p_run.add_argument("--output", required=True)
    p_run.add_argument("--template", default=str(SKILL_DIR / "templates" / "04.jpg"))
    p_run.add_argument("--size", default="1200*1600")
    p_run.add_argument("--workdir", default=None)

    p_lab = sub.add_parser("label", help="候选图 + labels.json → 成品图（纯本地）")
    p_lab.add_argument("--input", required=True)
    p_lab.add_argument("--labels", required=True)
    p_lab.add_argument("--output", required=True)
    p_lab.add_argument("--font-size", type=int, default=34)

    args = parser.parse_args()

    if args.cmd == "run":
        try:
            raw = json.loads(Path(args.analysis).read_text(encoding="utf-8"))
            analysis = validate_analysis(raw, args.types)
        except Exception as e:
            print(f"ERROR: analysis 校验失败: {e}")
            return 1
        work = Path(args.workdir) if args.workdir else \
            Path(tempfile.mkdtemp(prefix="crystal_"))
        work.mkdir(parents=True, exist_ok=True)
        clean_src = build_clean_source(args.input, analysis["bracelet_bbox_1000"],
                                       work / "clean_source.jpg")
        representative_paths = build_representative_crops(
            args.input, analysis["bead_groups"], work / "references")
        print(f"clean_source: {clean_src}\n"
              f"representative crops: {[str(p) for p in representative_paths]}")
        try:
            call_edit(clean_src, representative_paths, Path(args.template),
                      args.output, analysis["bead_groups"], args.size)
        except Exception as e:
            print(f"ERROR: {e}")
            return 2
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
