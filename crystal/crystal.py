#!/usr/bin/env python3
"""crystal 技能 — 水晶手镯识别展示图合成（唯一 CLI 入口，纯本地）。

识别与 QA 由执行任务的多模态 Agent 完成；本脚本只做本地像素提取与合成，
全程零网络/API 调用。

用法:
    python crystal/crystal.py \
        --input path/to/source.jpg \
        --types 3 \
        --analysis analysis.json \
        --output result.jpg \
        --scene auto        # 或 1-6

analysis.json 约定（坐标 0..1000 归一化）:
    {
      "bracelet_bbox_1000": [x1, y1, x2, y2],
      "crystals": [
        {"name": "紫水晶", "bbox_1000": [x1, y1, x2, y2],
         "shape": "round", "confidence": 0.92}
      ]
    }
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import image_ops  # noqa: E402


def main():
    parser = argparse.ArgumentParser(
        description="水晶手镯识别展示图：Agent 分析 JSON + 原图 → 本地合成标注图（零网络调用）")
    parser.add_argument("--input", required=True, help="手镯原图路径")
    parser.add_argument("--types", type=int, required=True,
                        help="水晶种类数 N（analysis 必须恰好含 N 种）")
    parser.add_argument("--analysis", required=True,
                        help="Agent 生成的分析 JSON 路径（bbox_1000 归一化坐标）")
    parser.add_argument("--output", required=True, help="输出图片路径 (.jpg/.png)")
    parser.add_argument("--scene", default="auto",
                        help="场景：auto 随机或 1-6 确定选择（默认 auto）")
    args = parser.parse_args()

    if not Path(args.input).exists():
        print(f"ERROR: 输入图片不存在: {args.input}")
        return 1
    if args.types < 1:
        print("ERROR: --types 必须 >= 1")
        return 1
    try:
        raw = json.loads(Path(args.analysis).read_text(encoding="utf-8"))
    except Exception as e:
        print(f"ERROR: 读取 analysis JSON 失败: {e}")
        return 1

    # Step 1 — 校验分析：恰好 N 种水晶（金属件不得入列）
    try:
        analysis = image_ops.validate_analysis(raw, args.types)
    except ValueError as e:
        print(f"ERROR: analysis 校验失败: {e}")
        return 1
    names = [c["name"] for c in analysis["crystals"]]
    print(f"[1/4] 分析校验通过: {'、'.join(names)}")

    # Step 2 — 归一化坐标 → 像素；本地提取原始像素（rembg 会话复用）
    w, h = image_ops.image_size(args.input)
    bracelet_bbox = image_ops.bbox1000_to_pixels(
        analysis["bracelet_bbox_1000"], w, h)
    print("[2/4] 提取原始手镯与代表珠（rembg u2net 会话复用）...")
    bracelet = image_ops.extract_bracelet(args.input, bracelet_bbox)
    samples = []
    for c in analysis["crystals"]:
        bb = image_ops.bbox1000_to_pixels(c["bbox_1000"], w, h)
        samples.append({"name": c["name"],
                        "image": image_ops.extract_bead(args.input, bb, c["shape"])})

    # Step 3 — 场景选择（auto 随机 / 指定确定）
    scene_key, scene_cfg = image_ops.choose_scene(args.scene)
    print(f"[3/4] 场景 {scene_key}: {scene_cfg.get('name', '')}")

    # Step 4 — 合成（原始像素 + 接触阴影 + 中文名标签）
    print(f"[4/4] 合成输出: {args.output}")
    image_ops.compose(bracelet, samples, scene_key, scene_cfg, args.output)
    print("完成。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
