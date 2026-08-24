"""crystal 技能 — 本地图像提取与合成（OpenCV + Pillow）。

原则：
- 手镯与代表珠像素 100% 来自原图，不做任何生成式重建。
- rembg 固定轻量模型（默认 u2net，可用 CRYSTAL_REMBG_MODEL 覆盖），
  单一惰性会话在手镯与全部珠子提取间复用。
- 本模块及整个 crystal 运行时零网络/API 调用
  （rembg 模型文件仅首次运行时缓存到用户目录，不进仓库）。
- 合成只做：摆放 + 接触阴影 + 中文名称标签，不做激进调色。
"""

import os
import random
from pathlib import Path

import cv2
import numpy as np
import yaml
from PIL import Image, ImageDraw, ImageFilter, ImageFont

SKILL_DIR = Path(__file__).parent

ALLOWED_SHAPES = ("round", "square", "faceted", "irregular")
_UNCERTAIN_WORDS = ("疑似", "可能", "大概", "或许")

# 常见中文字体候选（Windows / macOS / Linux）
_CJK_FONT_CANDIDATES = [
    "C:/Windows/Fonts/msyh.ttc",
    "C:/Windows/Fonts/simhei.ttf",
    "C:/Windows/Fonts/simsun.ttc",
    "/System/Library/Fonts/PingFang.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
]


# ---------------------------------------------------------------- rembg 会话

_REMBG_SESSION = None


def _get_rembg_session():
    """惰性创建并全局复用单个 rembg 会话；固定轻量模型 u2net 为默认。"""
    global _REMBG_SESSION
    if _REMBG_SESSION is None:
        from rembg import new_session
        model = os.environ.get("CRYSTAL_REMBG_MODEL", "u2net")
        _REMBG_SESSION = new_session(model)
    return _REMBG_SESSION


def _rembg_remove(pil_img):
    from rembg import remove
    return remove(pil_img, session=_get_rembg_session())


# ---------------------------------------------------------------- 场景配置

def load_scenes(yaml_path=None):
    """解析 scenes.yaml，返回 {"canvas": {...}, "scenes": {...}}。"""
    path = Path(yaml_path) if yaml_path else SKILL_DIR / "scenes.yaml"
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def choose_scene(scene="auto", config=None):
    """'auto' 随机挑一个；'1'-'6' 确定选择。返回 (key, scene_cfg)。"""
    config = config or load_scenes()
    scenes = config["scenes"]
    if scene == "auto":
        key = random.choice(sorted(scenes.keys()))
    else:
        key = f"{int(scene):02d}"
    if key not in scenes:
        raise ValueError(f"未知场景: {scene}（可用: 1-{len(scenes)} 或 auto）")
    return key, scenes[key]


# ---------------------------------------------------------------- 分析校验

def clean_name(name):
    """只保留市场名；不确定措辞不进入最终渲染。"""
    name = str(name).strip()
    for w in _UNCERTAIN_WORDS:
        name = name.replace(w, "")
    return name.strip("：:（）() ") or "未知水晶"


def bbox1000_to_pixels(bbox, width, height):
    """0..1000 归一化坐标 → 源图像素坐标（夹紧、保证非退化）。"""
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


def validate_analysis(analysis, type_count):
    """强校验 Agent 分析 JSON：恰好 N 种水晶；返回清洗后的副本。"""
    if not isinstance(analysis, dict):
        raise ValueError("analysis 必须是 JSON 对象")
    crystals = analysis.get("crystals")
    if not isinstance(crystals, list):
        raise ValueError("analysis 缺少 crystals 列表")
    if len(crystals) != type_count:
        raise ValueError(
            f"水晶种类数不符: analysis 提供 {len(crystals)} 种，要求恰好 {type_count} 种")

    cleaned = []
    for i, c in enumerate(crystals):
        if not isinstance(c, dict):
            raise ValueError(f"crystals[{i}] 非法")
        bbox = c.get("bbox_1000")
        if not (isinstance(bbox, (list, tuple)) and len(bbox) == 4):
            raise ValueError(f"crystals[{i}].bbox_1000 非法: {bbox}")
        shape = str(c.get("shape", "round")).lower()
        if shape not in ALLOWED_SHAPES:
            shape = "irregular"
        cleaned.append({
            "name": clean_name(c.get("name", "")),
            "bbox_1000": [float(v) for v in bbox],
            "shape": shape,
            "confidence": float(c.get("confidence", 1.0)),  # 仅内部，不渲染
        })

    bb = analysis.get("bracelet_bbox_1000")
    if not (isinstance(bb, (list, tuple)) and len(bb) == 4):
        raise ValueError(f"bracelet_bbox_1000 非法: {bb}")
    return {"bracelet_bbox_1000": [float(v) for v in bb], "crystals": cleaned}


def image_size(image_path):
    with Image.open(image_path) as im:
        return im.size


# ---------------------------------------------------------------- 提取

def _pil_alpha(img):
    return np.asarray(img.convert("RGBA"))[:, :, 3]


def _feather(mask, px):
    """羽化 alpha 边缘 1-3 px。"""
    sigma = max(0.5, min(3.0, px) / 2.0)
    return cv2.GaussianBlur(mask, (0, 0), sigma)


def _round_rect_mask(h, w, corner):
    mask = np.zeros((h, w), dtype=np.uint8)
    cv2.rectangle(mask, (corner, 0), (w - corner, h), 255, -1)
    cv2.rectangle(mask, (0, corner), (w, h - corner), 255, -1)
    for cx, cy in [(corner, corner), (w - corner, corner),
                   (corner, h - corner), (w - corner, h - corner)]:
        cv2.circle(mask, (cx, cy), corner, 255, -1)
    return mask


def _clean_alpha(alpha, center):
    """只保留包含中心点（或最近）的最大连通域；失败返回 None。"""
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
    return ((labels == best) * 255).astype(np.uint8)


def _shape_fallback_mask(crop_size, shape):
    """rembg 失败时按形状做几何掩码兜底（保留原始像素）。"""
    h, w = crop_size
    if shape == "square":
        side = int(min(w, h) * 0.92)
        x0, y0 = (w - side) // 2, (h - side) // 2
        m = np.zeros((h, w), dtype=np.uint8)
        m[y0:y0 + side, x0:x0 + side] = _round_rect_mask(side, side, max(4, side // 8))
        return m
    mask = np.zeros((h, w), dtype=np.uint8)
    r = int(min(w, h) / 2 * (0.92 if shape == "round" else 0.85))
    cv2.circle(mask, (w // 2, h // 2), max(2, r), 255, -1)
    return mask


def extract_bracelet(image_path, bbox=None, margin=0.10):
    """提取完整手镯（保留原始像素），返回透明背景 RGBA。

    bbox 为像素坐标 [x1,y1,x2,y2]，用于缩小 rembg 处理范围；
    rembg 失败时退化为羽化椭圆蒙版（不做生成式补全）。
    """
    img = Image.open(image_path).convert("RGBA")
    w, h = img.size
    if bbox:
        x1, y1, x2, y2 = (int(v) for v in bbox)
        mx, my = int((x2 - x1) * margin), int((y2 - y1) * margin)
        x1, y1 = max(0, x1 - mx), max(0, y1 - my)
        x2, y2 = min(w, x2 + mx), min(h, y2 + my)
        if x2 - x1 > 32 and y2 - y1 > 32:
            img = img.crop((x1, y1, x2, y2))

    try:
        out = _rembg_remove(img)
        alpha = _pil_alpha(out)
        if alpha.max() > 16 and (alpha > 16).mean() > 0.01:
            return out
    except Exception as e:
        print(f"[warn] rembg 提取手镯失败，使用椭圆蒙版兜底: {e}")

    arr = np.array(img)
    hh, ww = arr.shape[:2]
    mask = np.zeros((hh, ww), dtype=np.uint8)
    cv2.ellipse(mask, (ww // 2, hh // 2), (int(ww * 0.47), int(hh * 0.47)),
                0, 0, 360, 255, -1)
    arr[:, :, 3] = _feather(mask, 3)
    return Image.fromarray(arr, "RGBA")


def extract_bead(image_path, bbox, shape="round"):
    """按像素 bbox 提取单颗代表珠，返回透明背景 RGBA。

    步骤：局部裁剪 → rembg（复用会话）→ 清理 alpha → 羽化 1-3px。
    rembg 失败时按 shape 用几何掩码兜底。
    """
    img = Image.open(image_path).convert("RGBA")
    w, h = img.size
    x1, y1, x2, y2 = (int(v) for v in bbox)
    x1, y1 = max(0, min(w - 8, x1)), max(0, min(h - 8, y1))
    x2, y2 = max(x1 + 8, min(w, x2)), max(y1 + 8, min(h, y2))
    crop = img.crop((x1, y1, x2, y2))
    cw, ch = crop.size
    center = (cw // 2, ch // 2)
    shape = (shape or "round").lower()

    alpha_clean = None
    try:
        out = _rembg_remove(crop)
        cleaned = _clean_alpha(_pil_alpha(out), center)
        if cleaned is not None and (cleaned > 0).sum() >= 0.20 * cw * ch:
            alpha_clean = cleaned
    except Exception as e:
        print(f"[warn] rembg 提取珠子失败（{shape}），使用几何蒙版兜底: {e}")

    arr = np.array(crop)
    if alpha_clean is None:
        alpha_clean = _shape_fallback_mask(arr.shape[:2], shape)
    feather_px = 1.0 if min(cw, ch) < 48 else (2.0 if min(cw, ch) < 96 else 3.0)
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
    offset = shadow_cfg.get("offset", [6, 10])
    blur = float(shadow_cfg.get("blur", 16))
    opacity = float(shadow_cfg.get("opacity", 0.22))

    alpha = rgba.getchannel("A")
    shadow = Image.new("RGBA", rgba.size, (0, 0, 0, 255))
    shadow.putalpha(alpha.point(lambda v: int(v * opacity)))
    shadow = shadow.filter(ImageFilter.GaussianBlur(blur / 2.0))
    canvas.alpha_composite(shadow, (x + int(offset[0]), y + int(offset[1])))
    canvas.alpha_composite(rgba, (x, y))


def _fit(rgba, max_w, max_h, scale=1.0):
    """等比缩放到盒子内。"""
    w, h = rgba.size
    k = min(max_w / w, max_h / h, 1.25) * scale
    nw, nh = max(8, int(w * k)), max(8, int(h * k))
    return rgba.resize((nw, nh), Image.LANCZOS)


def _label_color(background, x, y):
    """按标签位置背景亮度自动选深/浅色文字。"""
    patch = background.crop((max(0, x - 90), max(0, y - 30),
                             min(background.width, x + 90),
                             min(background.height, y + 50)))
    lum = np.asarray(patch.convert("L")).mean()
    return (45, 38, 32) if lum > 128 else (245, 241, 233)


def compose(bracelet, samples, scene_key, scene_cfg, output_path, config=None):
    """合成最终展示图（3:4 竖幅）。

    - bracelet: extract_bracelet 结果（RGBA）
    - samples: [{"name": 中文名, "image": RGBA}, ...]
    - 仅摆放 + 阴影 + 中文名称标签；不改珠子颜色、不加任何装饰文字。
    """
    config = config or load_scenes()
    cw, ch = config["canvas"]["width"], config["canvas"]["height"]
    background = Image.open(SKILL_DIR / scene_cfg["background"]).convert("RGBA")
    if background.size != (cw, ch):
        background = background.resize((cw, ch), Image.LANCZOS)
    canvas = background.copy()
    rng = random.Random()

    # ---- 上区：完整原始手镯
    x1, y1, x2, y2 = scene_cfg["bracelet_box"]
    lo, hi = scene_cfg.get("scale_range", [0.96, 1.04])
    fitted = _fit(bracelet, x2 - x1, y2 - y1, rng.uniform(lo, hi))
    rlo, rhi = scene_cfg.get("rotation_range", [-4, 4])
    angle = rng.uniform(rlo, rhi)
    if abs(angle) > 0.1:  # 轻微旋转，保持原视角物理合理
        fitted = fitted.rotate(angle, resample=Image.BICUBIC, expand=True)
    cx = (x1 + x2) // 2 + rng.randint(-8, 8)
    cy = (y1 + y2) // 2 + rng.randint(-6, 6)
    _paste_with_shadow(canvas, fitted,
                       cx - fitted.width // 2, cy - fitted.height // 2,
                       scene_cfg["shadow"])

    # ---- 下区：每类水晶一颗代表珠横排 + 正下方中文名
    row = scene_cfg["bead_row"]
    n = len(samples)
    if n == 1:
        xs = [(row["x_start"] + row["x_end"]) / 2]
        spacing = row["x_end"] - row["x_start"]
    else:
        xs = [row["x_start"] + i * (row["x_end"] - row["x_start"]) / (n - 1)
              for i in range(n)]
        spacing = (row["x_end"] - row["x_start"]) / (n - 1)
    bead_size = int(min(row["size"], spacing - 24)) if n > 1 else int(row["size"])

    names = [str(s["name"]).strip() for s in samples]
    for w_ in ("疑似", "可能", "大概", "或许"):
        names = [nm.replace(w_, "") for nm in names]
    max_len = max((len(nm) for nm in names), default=3)
    font_size = int(max(26, min(46, min(46, spacing * 0.92 / max(max_len, 1)))))
    font = _cjk_font(font_size)

    for i, s in enumerate(samples):
        bx = int(xs[i])
        b = _fit(s["image"], bead_size, bead_size, rng.uniform(0.97, 1.03))
        _paste_with_shadow(canvas, b,
                           bx - b.width // 2, int(row["y"]) - b.height // 2,
                           scene_cfg["shadow"])
        # 标签：只写中文水晶名，不写任何其他文字
        color = _label_color(background, bx, int(scene_cfg["label_row"]["y"]))
        ImageDraw.Draw(canvas).text(
            (bx, int(scene_cfg["label_row"]["y"])), names[i],
            font=font, fill=color + (255,), anchor="ma")

    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(out, quality=92)
    return str(out)
