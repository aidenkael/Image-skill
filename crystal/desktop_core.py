#!/usr/bin/env python3
"""Crystal 桌面版核心 — 配置 / 动态背景库 / 视觉理解 / 单一编排入口。

用户运行时是桌面 GUI（app.py），不依赖 Agent / JSON 文件 / CLI：
    上传原图 → 选择背景 → 一句自然语言要求 → 生成
    → 视觉源图分析（自动）→ 现有 Qwen base → 视觉 base QA + 珠位规划（自动）
    → 现有 Wan 独立 compose → 可选确定性 Pillow 标注 → 成品

图像生成算法完全复用现有生产核心 `crystal.py`，本文件不实现第二条生成管线。
密钥/运行产物绝不写入仓库：配置存 %APPDATA%\\Crystal，运行存 %LOCALAPPDATA%\\Crystal\\runs。
"""

import base64
import json
import os
import re
import shutil
import sys
import time
import uuid
from dataclasses import dataclass
from pathlib import Path

import requests
from PIL import Image

import crystal

SUPPORTED_BG_EXT = {".jpg", ".jpeg", ".png", ".webp"}

VISION_MODEL_DEFAULT = "qwen3.7-plus"
VISION_DEFAULT_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
VISION_TOKEN_PLAN_URL = ("https://token-plan.cn-beijing.maas.aliyuncs.com"
                         "/compatible-mode/v1/chat/completions")

BASE_MODEL_DEFAULT = "qwen-image-3.0-pro"
EDIT_MODEL_DEFAULT = "wan2.7-image-pro"


class DesktopError(Exception):
    """可直接展示给用户的中文错误。"""


# ---------------------------------------------------------------- 路径

def app_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def background_dir() -> Path:
    path = app_dir() / "templates"
    path.mkdir(parents=True, exist_ok=True)
    return path


def config_dir() -> Path:
    root = os.environ.get("APPDATA")
    base = Path(root) if root else Path.home()
    return base / "Crystal"


def config_path() -> Path:
    return config_dir() / "config.json"


def runs_dir() -> Path:
    root = os.environ.get("LOCALAPPDATA")
    base = Path(root) if root else Path.home()
    return base / "Crystal" / "runs"


# ---------------------------------------------------------------- 动态背景库

def _natural_key(name):
    return [int(c) if c.isdigit() else c.lower()
            for c in re.split(r"(\d+)", str(name))]


def _is_readable_image(path):
    try:
        with Image.open(path) as im:
            im.verify()
        return True
    except Exception:
        return False


def list_backgrounds():
    """templates/ 直接子项中的可读图片；大小写不敏感自然文件名排序。
    数量完全动态：没有六文件假设，零背景合法。"""
    result = []
    for p in background_dir().iterdir():
        if not p.is_file() or p.suffix.lower() not in SUPPORTED_BG_EXT:
            continue
        if not _is_readable_image(p):
            continue
        result.append(p)
    return sorted(result, key=lambda p: _natural_key(p.name))


def background_snapshot():
    """外部增删改检测快照：仅受支持扩展名的直接子项 (名称, mtime, size)。"""
    snap = []
    for p in background_dir().iterdir():
        if not p.is_file() or p.suffix.lower() not in SUPPORTED_BG_EXT:
            continue
        st = p.stat()
        snap.append((p.name, st.st_mtime_ns, st.st_size))
    return tuple(sorted(snap, key=lambda t: _natural_key(t[0])))


def add_background(source):
    """复制一张图片进背景库；重名自动 name (2).jpg 递增。"""
    source = Path(source)
    if not source.is_file():
        raise DesktopError("所选文件不存在")
    if source.suffix.lower() not in SUPPORTED_BG_EXT:
        raise DesktopError("仅支持 JPG / JPEG / PNG / WebP 背景图")
    if not _is_readable_image(source):
        raise DesktopError("所选文件不是有效图片")
    dest_dir = background_dir()
    stem, ext = source.stem, source.suffix.lower()
    dest = dest_dir / f"{stem}{ext}"
    n = 2
    while dest.exists():
        dest = dest_dir / f"{stem} ({n}){ext}"
        n += 1
    shutil.copyfile(source, dest)
    return dest


def delete_background(path):
    """仅允许删除 templates/ 的直接子项；拒绝外部路径与路径穿越。"""
    p = Path(path).resolve()
    base = background_dir().resolve()
    if p.parent != base or not p.is_file():
        raise DesktopError("非法的背景路径")
    p.unlink()


# ---------------------------------------------------------------- 配置

@dataclass
class AppConfig:
    api_key: str = ""
    image_api_url: str = ""
    vision_api_url: str = ""
    vision_model: str = VISION_MODEL_DEFAULT
    base_model: str = BASE_MODEL_DEFAULT
    edit_model: str = EDIT_MODEL_DEFAULT


_CONFIG_KEYS = ("api_key", "image_api_url", "vision_api_url",
                "vision_model", "base_model", "edit_model")


def load_config() -> AppConfig:
    cfg = AppConfig()
    path = config_path()
    if path.exists():
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return cfg
        if isinstance(raw, dict):
            for key in _CONFIG_KEYS:
                if isinstance(raw.get(key), str):
                    setattr(cfg, key, raw[key])
    return cfg


def save_config(cfg: AppConfig):
    path = config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    data = {key: str(getattr(cfg, key)) for key in _CONFIG_KEYS}
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2),
                    encoding="utf-8")


def is_token_plan(cfg: AppConfig) -> bool:
    return cfg.api_key.strip().startswith("sk-sp-")


def config_issues(cfg: AppConfig):
    """配置完整性检查（返回可直接展示的中文问题列表）。"""
    issues = []
    if not cfg.api_key.strip():
        issues.append("未配置 API Key")
    elif not is_token_plan(cfg) and not cfg.image_api_url.strip():
        issues.append("非 Token Plan Key 需要填写图像 API URL")
    return issues


def resolve_vision_url(cfg: AppConfig) -> str:
    """显式 Vision URL > sk-sp- Token Plan URL > 默认 compatible-mode。"""
    if cfg.vision_api_url.strip():
        return cfg.vision_api_url.strip()
    if is_token_plan(cfg):
        return VISION_TOKEN_PLAN_URL
    return VISION_DEFAULT_URL


def apply_config_env(cfg: AppConfig):
    """在调用现有图像核心前注入环境变量（保持现有端点语义）。"""
    os.environ["DASHSCOPE_API_KEY"] = cfg.api_key
    os.environ["CRYSTAL_BASE_MODEL"] = cfg.base_model or BASE_MODEL_DEFAULT
    os.environ["CRYSTAL_IMAGE_MODEL"] = cfg.edit_model or EDIT_MODEL_DEFAULT
    if cfg.image_api_url.strip():
        os.environ["DASHSCOPE_API_URL"] = cfg.image_api_url.strip()
    else:
        os.environ.pop("DASHSCOPE_API_URL", None)


# ---------------------------------------------------------------- 视觉调用

def _image_data_url(path):
    p = Path(path)
    ext = p.suffix.lower()
    mime = {".png": "image/png", ".webp": "image/webp"}.get(ext, "image/jpeg")
    return f"data:{mime};base64," + base64.b64encode(p.read_bytes()).decode()


def _vision_chat(cfg: AppConfig, messages, timeout=120) -> str:
    """一次 compatible-mode chat/completions 调用，强制 JSON 输出。"""
    if not cfg.api_key.strip():
        raise DesktopError("未配置 API Key")
    payload = {
        "model": cfg.vision_model.strip() or VISION_MODEL_DEFAULT,
        "messages": messages,
        "response_format": {"type": "json_object"},
        "enable_thinking": False,
        "stream": False,
    }
    try:
        resp = requests.post(
            resolve_vision_url(cfg),
            headers={
                "Authorization": f"Bearer {cfg.api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=timeout,
        )
    except requests.exceptions.RequestException as e:
        raise DesktopError("视觉 API 连接失败") from e
    if resp.status_code != 200:
        raise DesktopError(f"视觉 API 调用失败：HTTP {resp.status_code}")
    try:
        content = resp.json()["choices"][0]["message"]["content"]
    except Exception as e:
        raise DesktopError("视觉 API 响应无效") from e
    if isinstance(content, list):
        content = "".join(c.get("text", "") for c in content
                          if isinstance(c, dict))
    return content or ""


def _parse_vision_json(content, invalid_msg):
    """严格解析：恰好一个 JSON 对象；畸形输出显式失败，不静默修复。"""
    try:
        data = json.loads((content or "").strip())
    except Exception as e:
        raise DesktopError(invalid_msg) from e
    if not isinstance(data, dict):
        raise DesktopError(invalid_msg)
    return data


def test_connection(cfg: AppConfig):
    """一次最小视觉请求（不触发图像生成）。返回 (成功与否, 中文状态)。"""
    issues = config_issues(cfg)
    if issues:
        return False, issues[0]
    try:
        content = _vision_chat(
            cfg,
            [{"role": "user",
              "content": '只回复一个 JSON 对象：{"ok": true}'}],
            timeout=20,
        )
        json.loads(content)
    except DesktopError as e:
        return False, str(e)
    except ValueError:
        return False, "视觉 API 响应无效"
    if not is_token_plan(cfg) and not cfg.image_api_url.strip():
        return True, "视觉 API 可用；请填写图像 API URL 后再生成"
    return True, "连接成功"


# ---------------------------------------------------------------- 视觉理解：源图

_ANALYSIS_PROMPT = """你是珠宝产品图识别器。图片是一张手镯实拍原图。

用户要求（结构约束，可能为空）：
{instruction}

只输出一个 JSON 对象（不要 markdown、不要代码块、不要多余文字），格式二选一：
{{"ok":true,"analysis":{{"bracelet_bbox_1000":[x1,y1,x2,y2],"bead_groups":[{{"display_name":"圆珠1","visual_identity":"...","representative_bbox_1000":[x1,y1,x2,y2]}}]}}}}
或 {{"ok":false,"error":"可直接展示给用户的中文原因"}}

规则：
- 坐标为相对整图的 0..1000 归一化值，必须 x1<x2 且 y1<y2。
- bracelet_bbox_1000 = 完整可见手镯产品范围（含金属包边/隔珠/连接件/挂饰），
  排除包装、托盘、手、纸张与无关背景物体。
- 只识别物理上属于手镯本体的组件；包装、托盘、手、纸张、背景散石与松散装饰物一律排除。
- bead_groups = 手镯上视觉可区分的非金属珠/石/珍珠组件，按可见身份分组：
  几何/形状、相对物理尺寸、颜色/光学外观、透明度、内含物、纹理/表面
  任一存在可见设计差异，必须分为不同组。
- 金属隔珠/镶嵌/连接件仍是手镯部件，但不计入珠组。
- 每个 representative_bbox_1000 紧凑覆盖手镯上一颗清晰可见的该组代表珠。
- visual_identity 只写可见外观描述，绝不从外观推断矿物/宝石学身份。
- 用户给了名称就用用户的名称；否则用中性名，如 圆珠1、方珠1、珍珠1。
- 用户要求是结构约束：例如"3种珠子，2种圆珠、1种方珠"表示可见证据支持时
  必须恰好按该分组输出。
- 用户要求与图像可见证据无法对应时返回 ok:false 并给出中文原因，
  绝不虚构隐藏或不存在的部件。
"""


def analyze_source_image(image_path, user_instruction, config):
    """源图 + 一句自然语言要求 → 经现有 validate_analysis 校验的 analysis。"""
    instruction = (user_instruction or "").strip() or "（空：按可见证据自行分组）"
    prompt = _ANALYSIS_PROMPT.format(instruction=instruction)
    messages = [{
        "role": "user",
        "content": [
            {"type": "image_url",
             "image_url": {"url": _image_data_url(image_path)}},
            {"type": "text", "text": prompt},
        ],
    }]
    content = _vision_chat(config, messages, timeout=120)
    data = _parse_vision_json(content, "原图识别结果无效")
    if not data.get("ok"):
        reason = str(data.get("error") or "").strip()
        raise DesktopError(reason or "原图与描述无法对应")
    try:
        return crystal.validate_analysis(data.get("analysis"))
    except ValueError as e:
        raise DesktopError(f"原图识别结果无效：{e}") from e


# ---------------------------------------------------------------- 视觉理解：base QA + 珠位规划

_QA_PROMPT = """你是珠宝生成图质检与摆放规划器。图片是刚生成的基础场景图。
该场景应包含恰好一条完整手镯（共 {n} 组珠组件），周围表面应保持干净。

第一步质检，仅当同时满足以下全部条件时 pass=true：
- 恰好一条完整手镯，且手镯可见可用；
- 没有任何散珠、散石、散珍珠或多余金属件；
- 没有任何生成的文字、标签、logo 或水印。
不满足则只输出：{{"pass":false,"reason":"中文原因"}}

质检通过时，为每组珠规划恰好一个散珠摆放框，只输出一个 JSON 对象：
{{"pass":true,"reason":"","placements":[{{"reference_index":1,"bbox_1000":[x1,y1,x2,y2]}}]}}

摆放要求：
- reference_index 恰好覆盖 1..{n}，每组恰好一框；
- 坐标为 0..1000 归一化值，必须 x1<x2 且 y1<y2；
- 放在可见的空表面/背景区域，不压住手镯，框之间不得刻意重叠；
- 框的相对大小须匹配下方给出的该组相对物理尺寸；
- 手工摆放感的自然不对称布局，禁止行列/网格/等距/固定弧线模板；
- 不得假设任何模板文件名，也不得使用任何预设安全区。

各组身份与相对物理尺寸（索引从 1 开始，尺寸为代表珠相对宽×高/1000）：
{groups}
"""


def inspect_base_and_plan(base_path, analysis, config):
    """视觉检查实际生成的 base：FAIL 直接停止；PASS 返回校验后的 placements。"""
    groups = analysis["bead_groups"]
    lines = []
    for i, g in enumerate(groups, 1):
        x1, y1, x2, y2 = g["representative_bbox_1000"]
        lines.append(f"{i}. {g['visual_identity']}"
                     f"（相对尺寸 {round(x2 - x1)}×{round(y2 - y1)}）")
    prompt = _QA_PROMPT.format(n=len(groups), groups="\n".join(lines))
    messages = [{
        "role": "user",
        "content": [
            {"type": "image_url",
             "image_url": {"url": _image_data_url(base_path)}},
            {"type": "text", "text": prompt},
        ],
    }]
    content = _vision_chat(config, messages, timeout=120)
    data = _parse_vision_json(content, "基础场景检查失败：识别结果无效")
    if not data.get("pass"):
        reason = str(data.get("reason") or "").strip() or "基础场景不可用"
        raise DesktopError(f"基础场景检查失败：{reason}")
    try:
        return crystal.validate_placements(data, len(groups))
    except ValueError as e:
        raise DesktopError(f"基础场景检查失败：珠位规划无效（{e}）") from e


# ---------------------------------------------------------------- 标注（确定性推导）

def _est_text_width(text, font_size):
    return int(sum(font_size if ord(ch) > 0x2E7F else font_size * 0.6
                   for ch in text))


def derive_labels(analysis, placements, width, height, font_size=34):
    """由校验后的 analysis + placements + 输出尺寸确定性推导标注。

    文字默认在框下方，下方空间不足时放上方；整体夹紧到画面内。"""
    gap = 10
    text_h = font_size + 8
    labels = []
    for placement in placements:
        group = analysis["bead_groups"][placement["reference_index"] - 1]
        x1, y1, x2, y2 = crystal.bbox1000_to_pixels(
            placement["bbox_1000"], width, height)
        cx, cy = (x1 + x2) // 2, (y1 + y2) // 2
        y = y2 + gap
        if y + text_h > height:
            y = y1 - gap - text_h
        y = max(0, min(height - text_h, y))
        half = _est_text_width(group["display_name"], font_size) // 2 + 4
        x = max(half, min(width - half, cx))
        labels.append({"text": group["display_name"], "x": x, "y": y,
                       "point_to": [cx, cy]})
    return labels


# ---------------------------------------------------------------- 编排

@dataclass
class GenerationResult:
    run_dir: Path
    final_path: Path
    analysis: dict
    placements: list


def sanitize_error(text, cfg=None):
    """错误文本脱敏：绝不包含 API Key / Bearer / 完整 Authorization。"""
    out = str(text)
    if cfg is not None and cfg.api_key.strip():
        out = out.replace(cfg.api_key.strip(), "***")
    out = re.sub(r"Bearer\s+\S+", "Bearer ***", out, flags=re.IGNORECASE)
    out = re.sub(r"sk-[A-Za-z0-9_\-]{8,}", "sk-***", out)
    return out


def _map_core_error(exc):
    """核心/网络异常 → 简短中文。"""
    if isinstance(exc, DesktopError):
        return str(exc)
    msg = str(exc)
    if "无可用凭证" in msg:
        return "未配置 API Key"
    if "非 Token Plan" in msg:
        return "非 Token Plan Key 需要填写图像 API URL"
    if isinstance(exc, requests.exceptions.RequestException):
        return "生成图片下载失败"
    if "图像调用失败" in msg or "响应无图片" in msg:
        detail = msg.split(":", 1)[-1].strip() if ":" in msg else msg
        return f"图像生成请求失败：{detail[:120]}"
    if "不是有效图片" in msg:
        return "生成图片下载失败"
    first = (msg.splitlines()[0] if msg else exc.__class__.__name__)
    return f"生成失败：{first[:160]}"


def _write_error_txt(run_dir, message):
    try:
        Path(run_dir).mkdir(parents=True, exist_ok=True)
        (Path(run_dir) / "error.txt").write_text(message, encoding="utf-8")
    except Exception:
        pass


def generate_preview(source_path, background_path, user_instruction,
                     add_labels, config, progress=None):
    """桌面端单一生成编排：全程无 Agent、无用户 JSON 步骤。

    顺序：校验 → 隔离运行目录（复制源图/背景）→ 视觉源图分析
    → 现有清理裁剪/代表资产 → 现有 Qwen base → 视觉 base QA + 珠位规划
    → 现有 Wan 独立 compose（带进度）→ 可选确定性 Pillow 标注。"""

    def report(msg):
        if progress:
            progress(msg)

    issues = config_issues(config)
    if issues:
        raise DesktopError(issues[0])

    source_path = Path(source_path)
    background_path = Path(background_path)
    if not source_path.is_file():
        raise DesktopError("请先上传原图")
    if not background_path.is_file():
        raise DesktopError("没有可用背景，请先添加背景")

    run_dir = runs_dir() / (time.strftime("%Y%m%d-%H%M%S") + "-" +
                            uuid.uuid4().hex[:6])
    run_dir.mkdir(parents=True, exist_ok=True)

    # 运行隔离：worker 只使用副本，后续用户/文件变动不影响本次运行
    src_copy = run_dir / f"source{source_path.suffix.lower() or '.jpg'}"
    bg_copy = run_dir / f"background{background_path.suffix.lower() or '.jpg'}"
    shutil.copyfile(source_path, src_copy)
    shutil.copyfile(background_path, bg_copy)

    (run_dir / "request.json").write_text(json.dumps({
        "instruction": (user_instruction or "").strip(),
        "background": background_path.name,
        "vision_model": config.vision_model,
        "base_model": config.base_model,
        "edit_model": config.edit_model,
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    apply_config_env(config)

    try:
        report("正在分析原图…")
        analysis = analyze_source_image(src_copy, user_instruction, config)
        (run_dir / "analysis.json").write_text(
            json.dumps(analysis, ensure_ascii=False, indent=2),
            encoding="utf-8")

        report("正在生成基础场景…")
        work = run_dir / "work"
        work.mkdir(parents=True, exist_ok=True)
        clean_source = crystal.build_clean_source(
            src_copy, analysis["bracelet_bbox_1000"],
            work / "clean_source.jpg")
        representative_assets = crystal.build_representative_assets(
            src_copy, analysis["bead_groups"], work / "references")
        base_path = run_dir / "base.png"
        crystal.generate_base_scene(clean_source, bg_copy, base_path,
                                    size="1200*1600")

        report("正在检查场景并规划珠位…")
        placements = inspect_base_and_plan(base_path, analysis, config)
        (run_dir / "placements.json").write_text(
            json.dumps({"placements": placements}, ensure_ascii=False,
                       indent=2), encoding="utf-8")

        def compose_progress(i, total):
            report(f"正在生成散珠 {i}/{total}…" if i < total else "正在合并画面…")

        candidate = crystal.compose_representatives(
            base_path, representative_assets, placements,
            run_dir / "candidate.png", work / "edits",
            progress_callback=compose_progress)

        final_path = run_dir / "final.png"
        if add_labels:
            report("正在添加标注…")
            with Image.open(candidate) as im:
                width, height = im.size
            labels = derive_labels(analysis, placements, width, height)
            crystal.render_labels(candidate, labels, final_path)
        else:
            shutil.copyfile(candidate, final_path)

        report("生成完成")
        return GenerationResult(run_dir=run_dir, final_path=final_path,
                                analysis=analysis, placements=placements)

    except Exception as exc:
        message = sanitize_error(_map_core_error(exc), config)
        _write_error_txt(run_dir, message)
        if isinstance(exc, DesktopError):
            raise
        raise DesktopError(message) from exc
