#!/usr/bin/env python3
"""一次性生成 6 张确定性中性实拍风格背景模板（无网络、无模型）。

用途：为 crystal 技能提供可替换的场景底图。模板只保证：
真实中性材质 + 正确光照方向 + 干净的商品摄影构图。
对效果不满意时，直接用实拍照片替换 templates/0X.jpg 即可，无需改代码。

用法:
    python crystal/make_templates.py
"""

import numpy as np
import cv2
from pathlib import Path

W, H = 1600, 1200
OUT_DIR = Path(__file__).parent / "templates"


def gradient(top_rgb, bottom_rgb):
    t = np.linspace(0.0, 1.0, H, dtype=np.float32)[:, None, None]
    top = np.array(top_rgb, dtype=np.float32).reshape(1, 1, 3)
    bot = np.array(bottom_rgb, dtype=np.float32).reshape(1, 1, 3)
    return np.broadcast_to(top + (bot - top) * t, (H, W, 3)).copy()


def noise(img, rng, strength):
    img += rng.normal(0.0, strength, img.shape).astype(np.float32)
    return np.clip(img, 0, 255)


def radial_light(img, cx, cy, radius, color, gain):
    """在 (cx, cy) 叠加柔和径向光，模拟主光方向。gain 为最大叠加亮度(0-255)。"""
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / radius
    falloff = np.clip(1.0 - d, 0.0, 1.0) ** 2
    light = (np.array(color, dtype=np.float32) / 255.0).reshape(1, 1, 3)
    img += light * (falloff[:, :, None] * gain)
    return np.clip(img, 0, 255)


def vignette(img, strength):
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    d = np.sqrt(((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2)
    v = 1.0 - strength * np.clip(d - 0.55, 0.0, 1.0) ** 1.6
    return np.clip(img * v[:, :, None], 0, 255)


def weave_texture(img, rng, period=4, strength=5.0):
    """细密织物/亚麻纹理：两组低频正弦叠加。"""
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    p1 = rng.uniform(period * 0.8, period * 1.3)
    p2 = rng.uniform(period * 0.9, period * 1.5)
    tex = np.sin(2 * np.pi * xx / p1) + np.sin(2 * np.pi * yy / p2)
    img += (tex * strength)[:, :, None]
    return np.clip(img, 0, 255)


def wood_grain(img, rng, strength=14.0):
    """水平木纹：随机行偏移曲线，沿纵向拉伸模糊。"""
    x = np.arange(W, dtype=np.float32)
    grain = np.zeros((H, W), dtype=np.float32)
    for _ in range(26):
        amp = rng.uniform(2.0, 7.0)
        freq = rng.uniform(0.002, 0.008)
        phase = rng.uniform(0, 2 * np.pi)
        y0 = rng.uniform(0, H)
        band = amp * np.sin(x * freq * 2 * np.pi + phase)
        rows = slice(int(max(0, y0 - 18)), int(min(H, y0 + 18)))
        grain[rows, :] += band * rng.uniform(0.4, 1.0)
    grain = cv2.GaussianBlur(grain, (0, 0), 6)
    img += (grain * strength / 14.0)[:, :, None] * np.array([1, 0.92, 0.8], dtype=np.float32)
    return np.clip(img, 0, 255)


def speckle(img, rng, count=2600, dark=True):
    """石材/陶瓷细颗粒。"""
    pts = rng.randint(0, H, count), rng.randint(0, W, count)
    val = rng.choice([-1, 1], count) * rng.uniform(4, 14, count)
    for y, x, v in zip(pts[0], pts[1], val):
        img[y, x] += v
    return np.clip(img, 0, 255)


def soft_tray(img, box, tone, blur=60):
    """在摆放区画一个极柔和的托盘/展示台色块（只做明暗过渡，不做细节）。"""
    mask = np.zeros((H, W), dtype=np.float32)
    x1, y1, x2, y2 = box
    cv2.ellipse(mask, ((x1 + x2) // 2, (y1 + y2) // 2),
                ((x2 - x1) // 2, (y2 - y1) // 2), 0, 0, 360, 1.0, -1)
    mask = cv2.GaussianBlur(mask, (0, 0), blur)
    color = np.array(tone, dtype=np.float32).reshape(1, 1, 3)
    img = img * (1 - 0.5 * mask[:, :, None]) + color * (0.5 * mask[:, :, None])
    return np.clip(img, 0, 255)


def finish(img, path, jpeg_q=90):
    img = cv2.GaussianBlur(img.astype(np.float32), (0, 0), 0.8)  # 去数码噪点感
    img = img[:, :, ::-1]  # 内部按 RGB 计算，cv2 以 BGR 写盘
    cv2.imwrite(str(path), img.astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, jpeg_q])
    print(f"written: {path}")


def scene_01(rng):  # 米色亚麻珠宝托盘
    img = gradient((219, 205, 181), (190, 172, 145))
    img = weave_texture(img, rng, period=5, strength=4.5)
    img = soft_tray(img, (120, 200, 860, 1000), (232, 221, 200))
    img = radial_light(img, 350, 150, 1500, (255, 250, 238), 26)
    img = noise(img, rng, 2.2)
    return vignette(img, 0.30)


def scene_02(rng):  # 深色丝绒珠宝托盘
    img = gradient((46, 40, 52), (22, 18, 27))
    img = weave_texture(img, rng, period=3, strength=2.0)
    img = soft_tray(img, (130, 210, 870, 1010), (58, 50, 66))
    img = radial_light(img, 300, 120, 1300, (120, 105, 140), 30)
    img = noise(img, rng, 1.6)
    return vignette(img, 0.50)


def scene_03(rng):  # 浅木桌面 + 亚麻布
    img = gradient((206, 176, 138), (184, 152, 114))
    img = wood_grain(img, rng, strength=12)
    img = soft_tray(img, (110, 190, 850, 990), (226, 214, 192))  # 亚麻布区
    img = weave_texture(img, rng, period=6, strength=3.0)
    img = radial_light(img, 400, 100, 1500, (255, 248, 232), 24)
    img = noise(img, rng, 2.0)
    return vignette(img, 0.28)


def scene_04(rng):  # 中性石材 + 象牙白展示面
    img = gradient((206, 202, 196), (176, 172, 165))
    img = speckle(img, rng, count=3200)
    img = soft_tray(img, (125, 205, 865, 1005), (238, 233, 222))  # 象牙白展示面
    img = radial_light(img, 380, 130, 1400, (252, 250, 244), 22)
    img = noise(img, rng, 1.8)
    return vignette(img, 0.26)


def scene_05(rng):  # 深色木纹 + 暖色侧光
    img = gradient((64, 46, 33), (34, 24, 17))
    img = wood_grain(img, rng, strength=10)
    img = soft_tray(img, (135, 215, 875, 1015), (76, 56, 40))
    img = radial_light(img, 60, 600, 1500, (255, 190, 120), 34)  # 左侧暖光
    img = noise(img, rng, 1.6)
    return vignette(img, 0.45)


def scene_06(rng):  # 浅灰织物 / 陶瓷展示面
    img = gradient((216, 216, 214), (192, 192, 190))
    img = weave_texture(img, rng, period=4, strength=3.5)
    img = soft_tray(img, (118, 198, 858, 998), (230, 230, 228))
    img = speckle(img, rng, count=1400)
    img = radial_light(img, 420, 140, 1500, (250, 250, 250), 20)
    img = noise(img, rng, 1.8)
    return vignette(img, 0.26)


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    builders = [scene_01, scene_02, scene_03, scene_04, scene_05, scene_06]
    for i, build in enumerate(builders, start=1):
        rng = np.random.RandomState(20260824 + i)  # 固定种子，结果确定
        finish(build(rng), OUT_DIR / f"{i:02d}.jpg")


if __name__ == "__main__":
    main()
