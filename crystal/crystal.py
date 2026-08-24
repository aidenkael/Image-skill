#!/usr/bin/env python3
"""crystal 技能 — 水晶手镯参考图（生成式编辑主流水线，唯一运行时入口）。

主流水线（取代旧 rembg 本地合成）：
    源图清理裁剪 → Agent 识别 N 类 + 代表珠裁剪 → 珠子参考页
    → 一次 qwen 图像编辑调用（清理源图 + 参考页 + 固定场景模板）
    → 本地 Pillow 编辑式标注 → 成品图

凭证仅从环境变量 DASHSCOPE_API_KEY（.env）读取，代码不硬编码密钥，无其他凭证回退；
模型/端点可用环境变量替换（QWEN_EDIT_MODEL / DASHSCOPE_API_URL）。

用法:
    python crystal/crystal.py run \
        --input src.jpg --types 3 --analysis a.json --output candidate.png
    python crystal/crystal.py label \
        --input candidate.png --labels l.json --output final.png

analysis.json（坐标 0..1000 归一化；bracelet_bbox 紧圈手镯以排除包装/手/纸张）:
    {"bracelet_bbox_1000": [x1,y1,x2,y2],
     "bead_groups": [
       {"group_id": "g1", "label_name": "中文市场名",
        "shape": "round|square|faceted|barrel|other",
        "size_tier": "small|medium|large",
        "color_family": "色族", "material_traits": "视觉材质注记",
        "representative_bbox_1000": [x1,y1,x2,y2]}, ...]}  # 恰好 N
珠类分组由「形状 + 相对尺寸档 + 材质/色族 + 内部纹理」的可见组合决定；
同色族但形状或尺寸档不同的珠必须分为不同组；
bead_groups 只统计物理位于手镯环体上的珠类，代表珠必须裁自环体本身；
金属隔珠/银饰/包装/消磁碎石/散石/纸张/背景中任何类水晶物体不得计为一组。

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
    """DASHSCOPE_API_URL 优先；否则 sk-sp- 用 Token Plan 端点，其余用标准端点。"""
    url = os.environ.get("DASHSCOPE_API_URL")
    if url:
        return url
    if (_token() or "").startswith("sk-sp-"):
        return TOKEN_PLAN_ENDPOINT
    return DASHSCOPE_ENDPOINT


# ---------------------------------------------------------------- 分析校验

def clean_name(name):
    name = str(name).strip()
    for w in _uncertain:
        name = name.replace(w, "")
    return name.strip("：:（）() ") or "未知水晶"


def bbox1000_to_pixels(bbox, width, height):
    if not (isinstance(bbox, (list, tuple)) and len(bbox) == 4):
        raise ValueError(f"bbox_1000 非法: {bbox}")
    x1, y1, x2, y2 = (float(v) for v in bbox)
    if not all(0.0 <= v <= 1000.0 for v in (x1, y1, x2, y2)):
        raise ValueError(f"bbox_1000 超出 0-1000: {bbox}")
    px = [int(round(x1 / 1000 * width)), int(round(y1 / 1000 * height)),
          int(round(x2 / 1000 * width)), int(round(y2 / 1000 * height))]
    px[2] = min(width, max(px[0] + 1, px[2]))
    px[3] = min(height, max(px[1] + 1, px[3]))
    return px


_SHAPES = ("round", "square", "faceted", "barrel", "other")
_TIERS = ("small", "medium", "large")


def _check_bbox(bbox, label):
    if not all(0.0 <= v <= 1000.0 for v in bbox):
        raise ValueError(f"{label} 超出 0-1000: {bbox}")


def validate_analysis(raw, type_count):
    """严格 bead_groups schema：形状/尺寸档/色族/材质齐全，代表珠必须位于手镯环体内。"""
    if not isinstance(raw, dict):
        raise ValueError("analysis 必须是 JSON 对象")
    groups = raw.get("bead_groups")
    if not isinstance(groups, list):
        raise ValueError("analysis 缺少 bead_groups 列表")
    if len(groups) != type_count:
        raise ValueError(f"珠类组数不符: analysis 提供 {len(groups)} 组，"
                         f"要求恰好 {type_count} 组手镯上的珠类")
    bb = raw.get("bracelet_bbox_1000")
    if not (isinstance(bb, (list, tuple)) and len(bb) == 4):
        raise ValueError(f"bracelet_bbox_1000 非法: {bb}")
    bb = [float(v) for v in bb]
    _check_bbox(bb, "bracelet_bbox_1000")
    cleaned = []
    for i, g in enumerate(groups):
        if not isinstance(g, dict):
            raise ValueError(f"bead_groups[{i}] 非法")
        shape = str(g.get("shape", "")).strip().lower()
        if shape not in _SHAPES:
            raise ValueError(f"bead_groups[{i}].shape 非法: {shape}（须为 {_SHAPES} 之一）")
        tier = str(g.get("size_tier", "")).strip().lower()
        if tier not in _TIERS:
            raise ValueError(f"bead_groups[{i}].size_tier 非法: {tier}（须为 {_TIERS} 之一）")
        color_family = str(g.get("color_family", "")).strip()
        if not color_family:
            raise ValueError(f"bead_groups[{i}].color_family 缺失")
        traits = str(g.get("material_traits", "")).strip()
        if not traits:
            raise ValueError(f"bead_groups[{i}].material_traits 缺失")
        rb = g.get("representative_bbox_1000")
        if not (isinstance(rb, (list, tuple)) and len(rb) == 4):
            raise ValueError(f"bead_groups[{i}].representative_bbox_1000 非法: {rb}")
        rb = [float(v) for v in rb]
        _check_bbox(rb, f"bead_groups[{i}].representative_bbox_1000")
        if not (rb[0] >= bb[0] - 1 and rb[1] >= bb[1] - 1 and
                rb[2] <= bb[2] + 1 and rb[3] <= bb[3] + 1):
            raise ValueError(f"bead_groups[{i}] 代表珠必须来自手镯环体"
                             f"（不得取自包装/散石/背景）")
        cleaned.append({"group_id": str(g.get("group_id", f"g{i+1}")).strip() or f"g{i+1}",
                        "label_name": clean_name(g.get("label_name", "")),
                        "shape": shape, "size_tier": tier,
                        "color_family": color_family, "material_traits": traits,
                        "representative_bbox_1000": rb})
    return {"bracelet_bbox_1000": bb, "bead_groups": cleaned}


# ---------------------------------------------------------------- 本地准备

def build_clean_source(input_path, bbox_1000, out_path, margin=0.06):
    """清理裁剪：紧圈手镯，排除包装/手/说明纸等无关内容。"""
    im = Image.open(input_path).convert("RGB")
    w, h = im.size
    x1, y1, x2, y2 = bbox1000_to_pixels(bbox_1000, w, h)
    mx, my = int((x2 - x1) * margin), int((y2 - y1) * margin)
    box = (max(0, x1 - mx), max(0, y1 - my), min(w, x2 + mx), min(h, y2 + my))
    im.crop(box).save(out_path, quality=92)
    return Path(out_path)


def build_bead_sheet(input_path, groups, out_path, gap=40, max_width=1600, max_height=520):
    """代表珠参考页：同一源图的矩形原始裁剪，左→右按识别顺序。

    所有裁剪共用一个缩放因子（仅当整页超限才等比缩小），
    间隙为固定中性 padding、不参与缩放；
    保留源图中代表珠的相对表观尺寸，不暗示不同珠类物理尺寸相同。"""
    im = Image.open(input_path).convert("RGB")
    w, h = im.size
    crops = [im.crop(bbox1000_to_pixels(g["representative_bbox_1000"], w, h))
             for g in groups]
    n = len(crops)
    crop_w = sum(c.width for c in crops)
    avail_w = max_width - gap * (n - 1)
    if avail_w <= 0:
        raise ValueError(f"参考页配置非法：固定间隙已占满 max_width"
                         f"（available_width={avail_w}），请增大 max_width 或减小 gap")
    max_h = max(c.height for c in crops)
    scale = min(1.0, avail_w / crop_w, max_height / max_h)
    scaled = []
    for c in crops:
        if scale < 1.0:
            c = c.resize((max(1, int(c.width * scale)),
                          max(1, int(c.height * scale))),
                         Image.LANCZOS)
        scaled.append(c)
    sheet_h = max(r.height for r in scaled)
    sheet = Image.new("RGB", (sum(r.width for r in scaled) + gap * (len(scaled) - 1),
                              sheet_h), (245, 245, 245))
    x = 0
    for r in scaled:
        sheet.paste(r, (x, (sheet_h - r.height) // 2))
        x += r.width + gap
    sheet.save(out_path)
    return Path(out_path)


# ---------------------------------------------------------------- 编辑调用

EDIT_PROMPT = """Create a photorealistic jewelry reference photo, as if carefully arranged and shot by a jeweler.

Reference roles:
- Image 1 is the only source of truth for the bracelet.
- Image 2 is the representative bead reference sheet; its left-to-right order is only an identity/indexing convention.
- Image 3 is only the empty scene/background reference.

Bracelet (main subject):
- One complete bracelet as the clear main subject.
- Preserve bracelet structure, bead order, bead shapes, size tiers, colors, translucency, inclusions and metal accessories from Image 1.
- Do not redesign the bracelet; do not add, remove, merge or substitute any bead or metal part.

Representative beads (secondary):
- Exactly {n} loose beads in the whole image: never more, never fewer.
- One loose bead per group below; the list order matches the references in Image 2 (indexing convention only).
{groups}
- Each loose bead must visibly match its group: same shape (round stays round; square/faceted stays square/faceted), same size tier relative to the bracelet beads, same color family and material traits (opaque stays opaque; translucent stays translucent; inclusions kept).
- Each loose bead must look as if the actual bead was removed from the bracelet and set down beside it: approximately the same real-world diameter as its corresponding bracelet bead, with only minor apparent-size variation from perspective. Never enlarge it into a separate hero object; never intentionally shrink it.
- Their final spatial arrangement is free and should be chosen for the most natural hand-arranged jewelry composition: asymmetry, natural spacing, comfortable negative space; no fixed order, no row, no arc template, no equal spacing.
- Keep the representative beads secondary to the complete bracelet.
- No extra sample beads. No loose metal accessories.

Style:
- real jewelry photography, natural reflections, believable crystal materials
- subtle contact shadows, understated composition
- no infographic feeling, no poster feeling

Text:
- generate no text, no labels, no title, no watermark, no logo"""

NEGATIVE = ("extra bracelet, redesigned bracelet, changed bead type, invented beads, extra loose beads, "
            "missing beads, loose metal accessories, rigid row, grid, mechanical layout, equal spacing, "
            "arc template, wrong bead shape, square bead rendered round, opaque bead rendered translucent, "
            "translucent bead rendered opaque, text, "
            "labels, title, watermark, infographic, poster, collage, sticker cutout, white halo, "
            "floating object, fake transparency, plastic texture, CGI, illustration")


def _groups_text(groups):
    """按参考页左→右顺序（仅索引约定）生成逐组身份描述，供 Prompt 绑定身份。"""
    return "\n".join(
        f"- Reference {i}: \u300c{g['label_name']}\u300d — {g['shape']} shape, {g['size_tier']} size tier, "
        f"{g['color_family']}, {g['material_traits']}."
        for i, g in enumerate(groups, 1))


def _b64url(p: Path) -> str:
    mime = "image/png" if p.suffix.lower() == ".png" else "image/jpeg"
    return f"data:{mime};base64," + base64.b64encode(p.read_bytes()).decode()


def call_edit(clean_src, sheet, template, output_path, groups, size="1200*1600"):
    """一次生成式编辑调用；single-pass：不自动重试、不换模型重跑，失败即抛错。"""
    token = _token()
    if not token:
        raise RuntimeError("无可用凭证：请配置 .env 的 DASHSCOPE_API_KEY")
    model = os.environ.get("QWEN_EDIT_MODEL", "qwen-image-3.0-pro")
    payload = {
        "model": model,
        "input": {"messages": [{"role": "user", "content": [
            {"image": _b64url(clean_src)},
            {"image": _b64url(sheet)},
            {"image": _b64url(template)},
            {"text": EDIT_PROMPT.format(n=len(groups), groups=_groups_text(groups))}]}]},
        "parameters": {"n": 1, "prompt_extend": False,
                       "size": size, "negative_prompt": NEGATIVE},
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
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    Path(output_path).write_bytes(img.content)
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
        description="水晶手镯参考图：清理裁剪 + 参考页 + 一次生成式编辑 + 本地编辑式标注")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_run = sub.add_parser("run", help="清理裁剪 → 参考页 → 一次编辑调用 → 候选图")
    p_run.add_argument("--input", required=True)
    p_run.add_argument("--types", type=int, required=True)
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
        sheet = build_bead_sheet(args.input, analysis["bead_groups"],
                                 work / "bead_sheet.png")
        print(f"clean_source: {clean_src}\nbead_sheet: {sheet}")
        try:
            call_edit(clean_src, sheet, Path(args.template), args.output,
                      analysis["bead_groups"], args.size)
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
        render_labels(args.input, labels, args.output, args.font_size)
        print(f"final: {args.output}")
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
