"""crystal 技能 — 本地图像提取与合成（OpenCV + Pillow）。

原则：
- 手镯与代表珠的像素 100% 来自原图，不做任何生成式重建。
- rembg 为默认前景提取；失败时用几何掩码兜底（不调用任何生成模型）。
- 合成只做：摆放 + 接触阴影 + 中文标签，不做激进调色。
"""

import random
from pathlib import Path

import cv2
import numpy as np
import yaml
from PIL import Image, ImageDraw, ImageFilter, ImageFont

SKILL_DIR = Path(__file__).parent

# 常见中文字体候选（Windows / macOS / Linux）
_CJK_FONT_CANDIDATES = [
    "C:/Windows/Fonts/msyh.ttc",
    "C:/Windows/Fonts/simhei.ttf",
    "C:/Windows/Fonts/simsun.ttc",
    "/System/Library/Fonts/PingFang.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
]


# ---------------------------------------------------------------- 基础工具

def load_scenes(yaml_path=None):
    """解析 scenes.yaml，返回 {"canvas": ..., "scenes": {...}}。"""
    path = Path(yaml_path) if yaml_path else SKILL_DIR / "scenes.yaml"
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def choose_scene(scene="auto", config=None):
    """选择场景：'auto' 随机挑一个，'1'-'6' 指定编号。返回 (key, scene_cfg)。"""
    config = config or load_scenes()
    scenes = config["scenes"]
    if scene == "auto":
        key = random.choice(sorted(scenes.keys()))
    else:
        key = f"{int(scene):02d}"
    if key not in scenes:
        raise ValueError(f"未知场景: {scene}（可用: 1-{len(scenes)} 或 auto）")
    return key, scenes[key]


def _rembg_remove(pil_img):
    """rembg 前景提取（惰性导入，便于无依赖单测）。"""
    from rembg import remove
    return remove(pil_img)


def _pil_to_alpha(img):
    """PIL RGBA -> (rgb uint8, alpha uint8)。"""
    arr = np.asarray(img.convert("RGBA"))
    return arr[:, :, :3], arr[:, :, 3]


def _feather(mask, px):
    """羽化 alpha 边缘 px 像素（1-3 px）。"""
    sigma = max(0.5, min(3.0, px) / 2.0)
    return cv2.GaussianBlur(mask, (0, 0), sigma)


def _round_rect_mask(h, w, radius, corner):
    mask = np.zeros((h, w), dtype=np.uint8)
    cv2.rectangle(mask, (corner, 0), (w - corner, h), 255, -1)
    cv2.rectangle(mask, (0, corner), (w, h - corner), 255, -1)
    for cx, cy in [(corner, corner), (w - corner, corner),
                   (corner, h - corner), (w - corner, h - corner)]:
        cv2.circle(mask, (cx, cy), corner, 255, -1)
    return mask


# ---------------------------------------------------------------- 手镯提取

def extract_bracelet(image_path, bbox=None, margin=0.10):
    """从原图提取完整手镯（保留原始像素），返回透明背景 RGBA。

    - bbox 为 Qwen 给出的 [x1, y1, x2, y2]，用于缩小 rembg 处理范围；
    - 默认 rembg；失败时退化为羽化椭圆蒙版（不做生成式补全）。
    """
    img = Image.open(image_path).convert("RGBA")
    w, h = img.size
    if bbox:
        x1, y1, x2, y2 = [int(v) for v in bbox]
        mx, my = int((x2 - x1) * margin), int((y2 - y1) * margin)
        x1, y1 = max(0, x1 - mx), max(0, y1 - my)
        x2, y2 = min(w, x2 + mx), min(h, y2 + my)
        if x2 - x1 > 32 and y2 - y1 > 32:
            img = img.crop((x1, y1, x2, y2))

    try:
        out = _rembg_remove(img)
        alpha = np.asarray(out)[:, :, 3]
        if alpha.max() > 16 and (alpha > 16).mean() > 0.01:
            return out
    except Exception as e:  # rembg 不可用或失败 → 几何兜底
        print(f"[warn] rembg 提取手镯失败，使用椭圆蒙版兜底: {e}")

    # 兜底：羽化椭圆蒙版，原样保留裁剪区像素
    arr = np.array(img)
    hh, ww = arr.shape[:2]
    mask = np.zeros((hh, ww), dtype=np.uint8)
    cv2.ellipse(mask, (ww // 2, hh // 2), (int(ww * 0.47), int(hh * 0.47)),
                0, 0, 360, 255, -1)
    mask = _feather(mask, 3)
    arr[:, :, 3] = mask
    return Image.fromarray(arr, "RGBA")


# ---------------------------------------------------------------- 代表珠提取

def _clean_alpha(alpha, center):
    """清理 alpha：只保留包含中心点（或最近）的最大连通域。失败返回 None。"""
    _, binary = cv2.threshold(alpha, 96, 255, cv2.THRESH_BINARY)
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    n, labels, stats, cents = cv2.connectedComponentsWithStats(binary, 8)
    if n <= 1:
        return None
    cx, cy = center
    best, best_score = None, None
    for i in range(1, n):
        x, y, bw, bh, area = stats[i]
        contains = x <= cx < x + bw and y <= cy < y + bh
        dist = float(np.hypot(cents[i][0] - cx, cents[i][1] - cy))
        score = (0 if contains else 1, dist, -area)
        if best_score is None or score < best_score:
            best, best_score = i, score
    if best is None:
        return None
    return ((labels == best) * 255).astype(np.uint8)


def _shape_fallback_mask(crop_size, radius, shape):
    """rembg 失败时按形状做几何掩码兜底。"""
    h, w = crop_size
    if shape == "square":
        side = int(min(w, h) * 0.92)
        x0, y0 = (w - side) // 2, (h - side) // 2
        m = np.zeros((h, w), dtype=np.uint8)
        m[y0:y0 + side, x0:x0 + side] = _round_rect_mask(side, side, side, max(4, side // 8))
        return m
    # round / faceted / other → 保守圆形或椭圆蒙版
    mask = np.zeros((h, w), dtype=np.uint8)
    r = int(min(w, h) / 2 * (0.92 if shape == "round" else 0.85))
    cv2.circle(mask, (w // 2, h // 2), max(2, r), 255, -1)
    return mask


def extract_bead(image_path, point, radius, shape="round"):
    """从原图提取单颗代表珠，返回透明背景 RGBA。

    步骤：局部裁剪 → rembg → 清理 alpha → 羽化 1-3px。
    rembg 失败时按 shape 用几何掩码兜底（保留原始像素）。
    """
    img = Image.open(image_path).convert("RGBA")
    w, h = img.size
    px, py = int(point[0]), int(point[1])
    radius = max(8, int(radius))
    half = int(radius * 1.7)
    x1, y1 = max(0, px - half), max(0, py - half)
    x2, y2 = min(w, px + half), min(h, py + half)
    crop = img.crop((x1, y1, x2, y2))
    center = (px - x1, py - y1)
    shape = (shape or "round").lower()

    alpha_clean = None
    try:
        out = _rembg_remove(crop)
        _, alpha = _pil_to_alpha(out)
        min_area = 0.25 * np.pi * radius * radius
        cleaned = _clean_alpha(alpha, center)
        if cleaned is not None and (cleaned > 0).sum() >= min_area:
            alpha_clean = cleaned
    except Exception as e:
        print(f"[warn] rembg 提取珠子失败（{shape}），使用几何蒙版兜底: {e}")

    arr = np.array(crop)
    if alpha_clean is None:
        alpha_clean = _shape_fallback_mask(arr.shape[:2], radius, shape)
    feather_px = 1.0 if radius < 24 else (2.0 if radius < 48 else 3.0)
    arr[:, :, 3] = _feather(alpha_clean, feather_px)
    return Image.fromarray(arr, "RGBA")


# ---------------------------------------------------------------- 合成

def _cjk_font(size):
    for path in _CJK_FONT_CANDIDATES:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    return ImageFont.load_default()


def _paste_with_shadow(canvas, rgba, x, y, shadow_cfg):
    """先画接触阴影再贴物体。x, y 为左上角坐标。"""
    offset = shadow_cfg.get("offset", [8, 12])
    blur = float(shadow_cfg.get("blur", 18))
    opacity = float(shadow_cfg.get("opacity", 0.22))

    alpha = rgba.getchannel("A")
    shadow = Image.new("RGBA", rgba.size, (0, 0, 0, 255))
    shadow.putalpha(alpha.point(lambda v: int(v * opacity)))
    shadow = shadow.filter(ImageFilter.GaussianBlur(blur / 2.0))
    canvas.alpha_composite(shadow, (x + int(offset[0]), y + int(offset[1])))
    canvas.alpha_composite(rgba, (x, y))


def _fit(rgba, max_w, max_h, scale):
    """等比缩放到盒子内，再乘轻微随机缩放。"""
    w, h = rgba.size
    k = min(max_w / w, max_h / h, 1.25) * scale
    nw, nh = max(8, int(w * k)), max(8, int(h * k))
    return rgba.resize((nw, nh), Image.LANCZOS)


def _label_color(background, x, y):
    """按标签位置背景亮度自动选深/浅色文字。"""
    patch = background.crop((max(0, x - 10), max(0, y - 40),
                             min(background.width, x + 220), min(background.height, y + 40)))
    lum = np.asarray(patch.convert("L")).mean()
    return (45, 38, 32) if lum > 128 else (245, 241, 233)


def compose(source_path, bracelet, samples, analysis, scene_key, scene_cfg,
            output_path, config=None):
    """合成最终展示图。

    - bracelet: extract_bracelet 结果（RGBA）
    - samples: [{"name": 中文名, "image": RGBA}, ...] 与 analysis["crystals"] 对应
    - 仅摆放 + 阴影 + 中文名称标签，不改珠子颜色、不加任何装饰文字。
    """
    config = config or load_scenes()
    cw, ch = config["canvas"]["width"], config["canvas"]["height"]
    background = Image.open(SKILL_DIR / scene_cfg["background"]).convert("RGBA")
    if background.size != (cw, ch):
        background = background.resize((cw, ch), Image.LANCZOS)
    canvas = background.copy()
    rng = random.Random()

    # ---- 左/中：完整原始手镯
    x1, y1, x2, y2 = scene_cfg["bracelet_box"]
    box_w, box_h = x2 - x1, y2 - y1
    lo, hi = scene_cfg.get("scale_range", [0.96, 1.04])
    scale = rng.uniform(lo, hi)
    fitted = _fit(bracelet, box_w, box_h, scale)
    rlo, rhi = scene_cfg.get("rotation_range", [-4, 4])
    angle = rng.uniform(rlo, rhi)
    if abs(angle) > 0.1:  # 轻微旋转，保持俯拍视角物理合理
        fitted = fitted.rotate(angle, resample=Image.BICUBIC, expand=True)
    cx = (x1 + x2) // 2 + rng.randint(-10, 10)
    cy = (y1 + y2) // 2 + rng.randint(-8, 8)
    _paste_with_shadow(canvas, fitted,
                       cx - fitted.width // 2, cy - fitted.height // 2,
                       scene_cfg["shadow"])

    # ---- 右侧：每类水晶一颗代表珠 + 中文名
    col = scene_cfg["sample_column"]
    n = max(1, len(samples))
    gap = col["gap"]
    max_gap = (ch - col["y_start"] - 90) / max(1, n - 1) if n > 1 else gap
    gap = min(gap, max_gap) if n > 1 else gap
    bead_size = int(min(gap - 30, 200, 2 * max(40, col["x"] - x2 - 12)))
    font = _cjk_font(max(30, min(48, gap // 5)))

    for i, s in enumerate(samples):
        cy = int(col["y_start"] + i * gap)
        b = _fit(s["image"], bead_size, bead_size, rng.uniform(0.97, 1.03))
        bx = col["x"] - b.width // 2
        by = cy - b.height // 2
        _paste_with_shadow(canvas, b, bx, by, scene_cfg["shadow"])
        # 标签：只写中文水晶名，不写任何其他文字
        name = str(s["name"]).strip()
        for word in ("疑似", "可能", "大概", "或许"):
            name = name.replace(word, "")
        tx = scene_cfg["label_column"]["x"]
        draw = ImageDraw.Draw(canvas)
        color = _label_color(background, tx, cy)
        draw.text((tx, cy), name, font=font, fill=color + (255,),
                  anchor="lm")

    canvas.convert("RGB").save(output_path, quality=92)
    return str(output_path)
