#!/usr/bin/env python3
"""crystal 技能 — 水晶手镯识别展示图生成（唯一 CLI 入口）。

流程（运行时 0 次图像生成 API，恰好 2 次 Qwen 视觉调用）：
    Qwen 识别 N 种水晶 → 本地提取原始手镯/代表珠 → 选场景 →
    OpenCV/Pillow 合成（含接触阴影与中文名标签）→ Qwen 视觉 QA。

用法:
    python crystal/crystal.py --input 图.jpg --types 3 \
        --output crystal/tests/outputs/result.jpg --scene auto
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import image_ops  # noqa: E402
import vision     # noqa: E402


def main():
    parser = argparse.ArgumentParser(
        description="水晶手镯识别展示图：原图 + N 种珠子 → 合成标注图（不调用生图 API）")
    parser.add_argument("--input", required=True, help="手镯原图路径")
    parser.add_argument("--types", type=int, required=True,
                        help="水晶种类数 N（模型必须恰好分出 N 种）")
    parser.add_argument("--output", required=True, help="输出图片路径 (.jpg/.png)")
    parser.add_argument("--scene", default="auto",
                        help="场景：auto 或 1-6（默认 auto 随机）")
    args = parser.parse_args()

    if not Path(args.input).exists():
        print(f"ERROR: 输入图片不存在: {args.input}")
        return 1
    if args.types < 1:
        print("ERROR: --types 必须 >= 1")
        return 1
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)

    # Step 1 — Qwen 视觉识别（第 1 次）
    print(f"[1/5] Qwen 识别水晶种类（N={args.types}）...")
    analysis = vision.identify(args.input, args.types)
    names = [c["name"] for c in analysis["crystals"]]
    print(f"      识别结果: {'、'.join(names)}")

    # Step 2 — 本地提取原始像素（无生成）
    print("[2/5] 提取原始手镯与代表珠（rembg）...")
    bracelet = image_ops.extract_bracelet(args.input, analysis["bracelet_bbox"])
    samples = []
    for c in analysis["crystals"]:
        bead = image_ops.extract_bead(args.input, c["point"], c["radius"], c["shape"])
        samples.append({"name": c["name"], "image": bead})

    # Step 3 — 场景选择
    scene_key, scene_cfg = image_ops.choose_scene(args.scene)
    print(f"[3/5] 场景 {scene_key}: {scene_cfg.get('name', '')}")

    # Step 4 — 合成（原始像素 + 阴影 + 中文名标签）
    print(f"[4/5] 合成输出: {args.output}")
    image_ops.compose(args.input, bracelet, samples, analysis,
                      scene_key, scene_cfg, args.output)

    # Step 5 — Qwen 视觉 QA（第 2 次）。失败不自动重生成，只报告。
    print("[5/5] Qwen 视觉 QA...")
    report = vision.qa(args.input, args.output, names)
    qa_path = Path(str(args.output) + ".qa.json")
    qa_path.write_text(json.dumps(report, ensure_ascii=False, indent=2),
                       encoding="utf-8")

    print(f"\nQA 结果: {'通过' if report['pass'] else '未通过'}")
    if report.get("summary"):
        print(f"结论: {report['summary']}")
    for issue in report["issues"]:
        print(f"  - {issue}")
    print(f"输出图片: {args.output}\nQA 报告: {qa_path}")

    if not report["pass"]:
        print("QA 未通过：图片已保存，请人工复核（MVP 不自动重试）。")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
