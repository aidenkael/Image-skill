#!/usr/bin/env python3
"""crystal 技能 — 水晶手镯参考图（生成式编辑主流水线，唯一运行时入口）。

主流水线（取代旧 rembg 本地合成）：
    源图清理裁剪 → Agent 识别 N 类 + 代表珠裁剪 → 珠子参考页
    → 一次 qwen 图像编辑调用（清理源图 + 参考页 + 固定场景模板）
    → 本地 Pillow 编辑式标注 → 成品图

凭证仅从环境读取（.env / 环境变量），代码不硬编码密钥；
模型/端点可用环境变量替换（QWEN_EDIT_MODEL / DASHSCOPE_API_URL）。

用法:
    python crystal/crystal.py run \
        --input src.jpg --types 3 --analysis a.json --output candidate.png
    python crystal/crystal.py label \
        --input candidate.png --labels l.json --output final.png

analysis.json（坐标 0..1000 归一化；bracelet_bbox 紧圈手镯以排除包装/手/纸张）:
    {"bracelet_bbox_1000": [x1,y1,x2,y2],
     "crystals": [{"name": "锂云母", "bbox_1000": [x1,y1,x2,y2]}, ...]}  # 恰好 N

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
    return os.environ.get("DASHSCOPE_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")


def _endpoint():
    return os.environ.get("DASHSCOPE_API_URL") or \
        "https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"


def _models():
    pref = os.environ.get("QWEN_EDIT_MODEL", "qwen-image-3.0-pro")
    seen, models = set(), []
    for m in (pref, "qwen-image-2.0-pro"):
        if m not in seen:
            seen.add(m)
            models.append(m)
    return models


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


def validate_analysis(raw, type_count):
    if not isinstance(raw, dict):
        raise ValueError("analysis 必须是 JSON 对象")
    crystals = raw.get("crystals")
    if not isinstance(crystals, list):
        raise ValueError("analysis 缺少 crystals 列表")
    if len(crystals) != type_count:
        raise ValueError(f"水晶种类数不符: analysis 提供 {len(crystals)} 种，"
                         f"要求恰好 {type_count} 种")
    cleaned = []
    for i, c in enumerate(crystals):
        if not isinstance(c, dict) or not isinstance(c.get("bbox_1000"), (list, tuple)):
            raise ValueError(f"crystals[{i}] 非法")
        cleaned.append({"name": clean_name(c.get("name", "")),
                        "bbox_1000": [float(v) for v in c["bbox_1000"]]})
    bb = raw.get("bracelet_bbox_1000")
    if not (isinstance(bb, (list, tuple)) and len(bb) == 4):
        raise ValueError(f"bracelet_bbox_1000 非法: {bb}")
    return {"bracelet_bbox_1000": [float(v) for v in bb], "crystals": cleaned}


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


def build_bead_sheet(input_path, crystals, out_path, height=420, gap=40):
    """代表珠参考页：矩形原始裁剪，左→右按识别顺序，无抠图无改色。"""
    im = Image.open(input_path).convert("RGB")
    w, h = im.size
    crops = [im.crop(bbox1000_to_pixels(c["bbox_1000"], w, h))
             for c in crystals]
    rs = [c.resize((max(8, int(c.width * height / c.height)), height),
                   Image.LANCZOS) for c in crops]
    sheet = Image.new("RGB", (sum(r.width for r in rs) + gap * (len(rs) - 1),
                              height), (245, 245, 245))
    x = 0
    for r in rs:
        sheet.paste(r, (x, 0))
        x += r.width + gap
    sheet.save(out_path)
    return Path(out_path)


# ---------------------------------------------------------------- 编辑调用

EDIT_PROMPT = """Create a photorealistic jewelry reference photo, as if carefully arranged and shot by a jeweler.

Reference roles:
- Image 1 is the only source of truth for the bracelet.
- Image 2 contains {n} representative bead references, left to right.
- Image 3 is only the empty scene/background reference.

Composition:
- One complete bracelet as the main subject, placed naturally in the scene.
- Preserve bracelet structure, bead colors, translucency, inclusions, shapes, relative sizes and metal accessories from Image 1.
- Do not redesign the bracelet; do not add or remove components; do not invent bead types or shapes.
- Near the bracelet (a gentle loose arc at its lower side), place exactly {n} loose representative beads, one per crop in Image 2. Not more, not fewer.
- Bead order is critical and must be preserved exactly: reading Image 2 from left to right, bead #1 goes to the left, bead #2 next to it, bead #3 to the right. Never swap, reorder or substitute them.
- The loose beads must be clearly smaller than the bracelet beads (about half their diameter) and visually belong to the same scene, as if manually set down beside it for reference.
- Do NOT arrange the loose beads in a rigid centered straight row; avoid mechanical equal spacing.
- Each loose bead must match its source crop in material, color, transparency, inclusions and shape. If a source crop shows a metal cap or fitting, render that bead as a plain bare bead without it.
- No loose metal accessories.

Style:
- real jewelry photography, natural reflections, believable translucent crystal material
- subtle contact shadows, understated composition
- no infographic feeling, no poster feeling

Text:
- generate no text, no labels, no title, no watermark, no logo"""

NEGATIVE = ("extra bracelet, redesigned bracelet, changed bead type, invented beads, extra loose beads, "
            "missing beads, loose metal accessories, rigid row, mechanical layout, equal spacing, text, "
            "labels, title, watermark, infographic, poster, collage, sticker cutout, white halo, "
            "floating object, fake transparency, plastic texture, CGI, illustration")


def _b64url(p: Path) -> str:
    mime = "image/png" if p.suffix.lower() == ".png" else "image/jpeg"
    return f"data:{mime};base64," + base64.b64encode(p.read_bytes()).decode()


def call_edit(clean_src, sheet, template, output_path, n, size="1200*1600"):
    """一次生成式编辑调用；首选 qwen-image-3.0-pro，失败回退 qwen-image-2.0-pro。"""
    token = _token()
    if not token:
        raise RuntimeError("无可用凭证：请配置 .env 的 DASHSCOPE_API_KEY")
    payload = {
        "input": {"messages": [{"role": "user", "content": [
            {"image": _b64url(clean_src)},
            {"image": _b64url(sheet)},
            {"image": _b64url(template)},
            {"text": EDIT_PROMPT.format(n=n)}]}]},
        "parameters": {"n": 1, "prompt_extend": False,
                       "size": size, "negative_prompt": NEGATIVE},
    }
    last_err = ""
    for model in _models():
        payload["model"] = model
        resp = requests.post(_endpoint(),
                             headers={"Authorization": f"Bearer {token}",
                                      "Content-Type": "application/json"},
                             json=payload, timeout=600)
        if resp.status_code != 200:
            last_err = f"{model} HTTP {resp.status_code}: {resp.text[:200]}"
            print(f"[warn] {last_err}")
            continue
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
            last_err = f"{model} 响应无图片"
            continue
        img = requests.get(url, timeout=120)
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        Path(output_path).write_bytes(img.content)
        print(f"model_used: {model}")
        return model
    raise RuntimeError(f"编辑调用失败: {last_err}")


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
        sheet = build_bead_sheet(args.input, analysis["crystals"],
                                 work / "bead_sheet.png")
        print(f"clean_source: {clean_src}\nbead_sheet: {sheet}")
        try:
            call_edit(clean_src, sheet, Path(args.template), args.output,
                      len(analysis["crystals"]), args.size)
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
