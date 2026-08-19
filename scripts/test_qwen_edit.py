#!/usr/bin/env python3
"""
Line B: Qwen Image 测试脚本
通过 DashScope API 调用 qwen-image-3.0-pro（I2I 模式），
将商品参考图 + 场景 Prompt → 生成电商场景图。

用法:
    python scripts/test_qwen_edit.py --image tests/samples/bag-01.jpg --prompt "..." --output outputs/qwen-test-01.png

需要:
    DASHSCOPE_API_KEY 环境变量（在 .env 中配置）
"""

import os
import sys
import json
import time
import argparse
import base64
import requests
from pathlib import Path
from io import BytesIO

# 尝试加载 .env
def load_env():
    env_path = Path(__file__).parent.parent / ".env"
    if env_path.exists():
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, val = line.split("=", 1)
                    os.environ.setdefault(key.strip(), val.strip())

load_env()

DASHSCOPE_API_URL = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"
# Token Plan 专用端点（如使用 sk-sp-... 凭证）:
# DASHSCOPE_API_URL = "https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"


def image_to_base64_url(image_path: str) -> str:
    """将本地图片转为 base64 data URL"""
    with open(image_path, "rb") as f:
        data = f.read()
    b64 = base64.b64encode(data).decode()
    # 检测格式
    ext = Path(image_path).suffix.lower()
    mime = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"}.get(ext.lstrip("."), "image/jpeg")
    return f"data:{mime};base64,{b64}"


def call_qwen_image_edit(image_path: str, prompt: str, model: str = "qwen-image-3.0-pro", size: str = "1024*1024") -> dict:
    """调用 Qwen Image 3.0 Pro API (I2I 模式)"""
    api_key = os.environ.get("DASHSCOPE_API_KEY")
    if not api_key:
        print("ERROR: DASHSCOPE_API_KEY 未设置。请在 .env 中配置。")
        sys.exit(1)

    image_url = image_to_base64_url(image_path)

    payload = {
        "model": model,
        "input": {
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"image": image_url},
                        {"text": prompt}
                    ]
                }
            ]
        },
        "parameters": {
            "n": 1,
            "prompt_extend": True
        }
    }
    if size:
        payload["parameters"]["size"] = size

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    print(f"调用模型: {model}")
    print(f"输入图片: {image_path}")
    print(f"Prompt: {prompt[:100]}...")
    print(f"等待 API 响应...")

    resp = requests.post(DASHSCOPE_API_URL, headers=headers, json=payload, timeout=120)

    if resp.status_code != 200:
        print(f"API 错误: HTTP {resp.status_code}")
        print(resp.text)
        return None

    result = resp.json()
    return result


def download_image(url: str, output_path: str):
    """下载生成的图片"""
    resp = requests.get(url, timeout=60)
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "wb") as f:
        f.write(resp.content)
    print(f"图片已保存: {output_path} ({len(resp.content)} bytes)")


def main():
    parser = argparse.ArgumentParser(description="Qwen Image Edit 测试")
    parser.add_argument("--image", required=True, help="商品原图路径")
    parser.add_argument("--prompt", required=True, help="编辑指令/Prompt")
    parser.add_argument("--model", default="qwen-image-3.0-pro", help="模型名称")
    parser.add_argument("--size", default="1024*1024", help="输出尺寸 (如 1024*1024)")
    parser.add_argument("--output", default=None, help="输出路径")
    args = parser.parse_args()

    if not Path(args.image).exists():
        print(f"ERROR: 图片不存在: {args.image}")
        sys.exit(1)

    output = args.output or f"outputs/qwen-test-{int(time.time())}.png"

    result = call_qwen_image_edit(args.image, args.prompt, args.model, args.size)

    if result is None:
        print("生成失败。")
        sys.exit(1)

    # 解析结果
    print("\nAPI 响应:")
    print(json.dumps(result, indent=2, ensure_ascii=False)[:2000])

    # 尝试提取图片 URL
    try:
        choices = result.get("output", {}).get("choices", [])
        if choices:
            content = choices[0].get("message", {}).get("content", [])
            for item in content:
                if "image" in item:
                    img_url = item["image"]
                    download_image(img_url, output)
                    print(f"\n成功! 输出: {output}")
                    return
        # 尝试另一种响应格式
        results = result.get("output", {}).get("results", [])
        if results:
            img_url = results[0].get("url")
            if img_url:
                download_image(img_url, output)
                print(f"\n成功! 输出: {output}")
                return
    except Exception as e:
        print(f"解析响应出错: {e}")

    print("未能从响应中提取图片。请检查上方 API 响应。")


if __name__ == "__main__":
    main()
