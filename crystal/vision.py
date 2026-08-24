"""crystal 技能 — Qwen 多模态视觉：水晶识别 + 成图 QA。

- 运行时共 2 次 Qwen 视觉调用（identify + qa），0 次图像生成调用。
- API Key 只从环境变量读取（.env 自动加载），绝不硬编码。
- 环境变量：
    DASHSCOPE_API_KEY   必需（复用仓库既有约定）
    QWEN_VL_MODEL       视觉模型，默认 qwen-vl-max
    QWEN_VL_API_URL     可选，覆盖默认端点
"""

import base64
import json
import os
import re
from pathlib import Path

import requests

DEFAULT_API_URL = ("https://dashscope.aliyuncs.com/api/v1/services/aigc/"
                   "multimodal-generation/generation")
DEFAULT_MODEL = "qwen-vl-max"

_UNCERTAIN_WORDS = ("疑似", "可能", "大概", "或许")


# ---------------------------------------------------------------- 环境

def load_env():
    """从仓库根或当前目录加载 .env（不覆盖已有环境变量）。"""
    here = Path(__file__).resolve().parent
    for base in (here, here.parent, Path.cwd()):
        env_path = base / ".env"
        if env_path.exists():
            with open(env_path, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        os.environ.setdefault(k.strip(), v.strip().strip('"'))
            break


def _config():
    load_env()
    key = os.environ.get("DASHSCOPE_API_KEY") or os.environ.get("QWEN_VL_API_KEY")
    if not key:
        raise RuntimeError(
            "缺少 DASHSCOPE_API_KEY：请在仓库根 .env 中配置后重试。")
    return {
        "api_key": key,
        "api_url": os.environ.get("QWEN_VL_API_URL", DEFAULT_API_URL),
        "model": os.environ.get("QWEN_VL_MODEL", DEFAULT_MODEL),
    }


def _image_data_url(image_path):
    with open(image_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()
    ext = Path(image_path).suffix.lower().lstrip(".")
    mime = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
            "webp": "image/webp"}.get(ext, "image/jpeg")
    return f"data:{mime};base64,{b64}"


def _call_vl(content_items, temperature=0.0):
    """调用 Qwen 多模态模型，返回纯文本回复。"""
    cfg = _config()
    payload = {
        "model": cfg["model"],
        "input": {"messages": [{"role": "user", "content": content_items}]},
        "parameters": {"temperature": temperature, "result_format": "message"},
    }
    headers = {"Authorization": f"Bearer {cfg['api_key']}",
               "Content-Type": "application/json"}
    resp = requests.post(cfg["api_url"], headers=headers, json=payload, timeout=120)
    if resp.status_code != 200:
        raise RuntimeError(f"Qwen VL API 错误 HTTP {resp.status_code}: "
                           f"{resp.text[:300]}")
    data = resp.json()
    message = data["output"]["choices"][0]["message"]
    content = message.get("content")
    if isinstance(content, str):
        return content
    return "".join(item.get("text", "") for item in content if isinstance(item, dict))


def _extract_json(text):
    """从模型回复中提取 JSON 对象（容忍代码围栏与前后缀文字）。"""
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.S)
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        raise ValueError(f"模型回复中没有 JSON: {text[:200]}")
    return json.loads(text[start:end + 1])


def _clean_name(name):
    """去掉不确定措辞，只保留市场名（不确定时保留最佳猜测名，不渲染置信度）。"""
    name = str(name).strip()
    for w in _UNCERTAIN_WORDS:
        name = name.replace(w, "")
    return name.strip("：:（）() ") or "未知水晶"


# ---------------------------------------------------------------- identify

_IDENTIFY_PROMPT = """你是珠宝水晶鉴定师。图片是唯一的商品事实来源。图片尺寸为 {w}x{h} 像素。

任务：
- 只识别水晶/宝石珠子，忽略所有金属部件（隔珠、吊坠、搭扣、转运珠金属件）
- 恰好分出 {type_count} 种水晶；光照/反光差异不算不同种类
- 为每种水晶选一颗最清晰的珠子作为代表，给出其中心像素坐标 point 与像素半径 radius
- 珠子形状 shape 可能是 round / faceted / square / irregular 等，按图中实际填写，不得虚构
- 名称使用中文珠宝水晶市场通用名（如 紫水晶、白水晶、粉晶、青金石、月光石）
- 同时给出手镯整体的外接矩形 bracelet_bbox: [x1, y1, x2, y2]（像素）
- 不确定的名称直接给出最可能的市场名，并附 "confidence": 0.0；否则 "confidence": 1.0

只返回 JSON，格式：
{{
  "bracelet_bbox": [x1, y1, x2, y2],
  "view": "top_down",
  "crystals": [
    {{"name": "紫水晶", "point": [x, y], "radius": 42, "shape": "round", "confidence": 1.0}}
  ]
}}
要求 crystals 恰好 {type_count} 项。不要输出 JSON 以外的任何文字。"""


def parse_identify_response(text, type_count, image_size=None):
    """解析并强校验识别结果。image_size=(w,h) 用于坐标裁剪。可独立单测。"""
    data = _extract_json(text)

    bbox = data.get("bracelet_bbox")
    if not (isinstance(bbox, list) and len(bbox) == 4):
        raise ValueError(f"bracelet_bbox 非法: {bbox}")
    bbox = [max(0, int(v)) for v in bbox]
    if image_size:
        bbox[0] = min(bbox[0], image_size[0] - 1)
        bbox[1] = min(bbox[1], image_size[1] - 1)
        bbox[2] = min(bbox[2], image_size[0])
        bbox[3] = min(bbox[3], image_size[1])
    if bbox[2] <= bbox[0] or bbox[3] <= bbox[1]:
        raise ValueError(f"bracelet_bbox 退化: {bbox}")

    crystals = data.get("crystals")
    if not isinstance(crystals, list):
        raise ValueError("缺少 crystals 列表")
    if len(crystals) != type_count:
        raise ValueError(
            f"水晶种类数不符: 模型返回 {len(crystals)} 种，要求恰好 {type_count} 种")

    cleaned = []
    for c in crystals:
        point = c.get("point")
        if not (isinstance(point, list) and len(point) == 2):
            raise ValueError(f"point 非法: {c}")
        cleaned.append({
            "name": _clean_name(c.get("name", "")),
            "point": [max(0, int(point[0])), max(0, int(point[1]))],
            "radius": max(4, int(c.get("radius", 20))),
            "shape": str(c.get("shape", "round")).lower(),
            "confidence": float(c.get("confidence", 1.0)),  # 仅内部使用，不渲染
        })
    return {
        "bracelet_bbox": bbox,
        "view": str(data.get("view", "top_down")),
        "crystals": cleaned,
    }


def identify(image_path, type_count):
    """Qwen 视觉识别：返回严格符合约定的 dict（见 parse_identify_response）。"""
    from PIL import Image as _PILImage
    w, h = _PILImage.open(image_path).size
    prompt = _IDENTIFY_PROMPT.format(w=w, h=h, type_count=type_count)
    text = _call_vl([{"image": _image_data_url(image_path)}, {"text": prompt}])
    return parse_identify_response(text, type_count, image_size=(w, h))


# ---------------------------------------------------------------- QA

_QA_PROMPT = """你是电商图片质检员。第一张是原始手镯照片，第二张是合成展示图。
预期水晶种类名称列表：{names}

逐项检查（只看事实）：
1. 展示图中的手镯是否与原图完全一致（未重绘、未变形、未改色）
2. 右侧每颗代表珠的颜色/质感是否与原图中对应珠子一致（真实像素，非生成）
3. 右侧中文标签是否恰好为 {count} 个且与预期名称一致，标签旁没有多余文字
4. 是否出现金属部件被标注、标题/水印/营销文案/装饰元素
5. 阴影与摆放是否自然（物体贴合背景，无明显悬浮或穿帮）

只返回 JSON：
{{"pass": true 或 false, "issues": ["问题1", ...], "summary": "一句话结论"}}
没有问题时 issues 为空数组。不要输出 JSON 以外的任何文字。"""


def qa(source_path, result_path, expected_types):
    """Qwen 视觉 QA。返回 {"pass": bool, "issues": [...], "summary": str}。"""
    names = "、".join(expected_types)
    prompt = _QA_PROMPT.format(names=names, count=len(expected_types))
    text = _call_vl([
        {"image": _image_data_url(source_path)},
        {"image": _image_data_url(result_path)},
        {"text": prompt},
    ])
    data = _extract_json(text)
    issues = data.get("issues") or []
    if not isinstance(issues, list):
        issues = [str(issues)]
    return {
        "pass": bool(data.get("pass", False)) and not issues,
        "issues": [str(i) for i in issues],
        "summary": str(data.get("summary", "")),
    }
