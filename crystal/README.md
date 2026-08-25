# crystal — 水晶手镯参考图（独立桌面应用）

输入一张手镯实拍图，输出一张"人工摆拍 + 手工标注"感的珠宝参考照片：
完整手镯为主体，每组视觉可区分的非金属珠/石/珍珠组件（bead_groups）各取一个代表件，
由 `wan2.7-image-pro` 对同一张干净 base 做 N 次**独立**局部编辑（Image 1 无框紧裁剪身份参考，
`bbox_list` 只框 Image 2 目标区域，`visual_identity` 绑定进插入 prompt），
Pillow 羽毛合并仅合并被编辑的局部区域，小字楷体中文注记（可带细引线）。

## 使用方式（普通用户）

**双击 `crystal/Crystal.bat`**（源码运行，需 Python 3），或运行打包后的
`crystal/dist/Crystal/Crystal.exe`（见下方"打包"，无需 Python）。

主流程：

```
上传手镯原图 → 选择/管理背景库 → 输入一句自然语言要求
→ 配置/测试 API → 点击生成预览图 → 查看进度 → 预览成品 → 保存成品
```

- **上传原图**：JPG / JPEG / PNG / WebP。
- **背景库**：`crystal/templates/` 是实时背景文件夹，任意数量、任意文件名
  （现有 `01.jpg`…`06.jpg` 只是初始文件，不是固定白名单）。界面上可
  `添加背景` / `删除背景` / `打开背景文件夹`；在文件夹里直接增删图片也会
  每秒自动刷新。零背景时生成按钮禁用。
- **自然语言要求**：例如"3种珠子，两种圆珠，一种方珠"；留空则按图像可见证据分组。
- **API 设置**：`DASHSCOPE_API_KEY` 必填；`sk-sp-` Token Plan key 可不填图像 API URL，
  其余 key 必须填写图像 API URL；视觉 API URL 可选。`测试连接` 只发一次最小视觉请求，
  不触发图像生成。Key 以掩码显示，只保存在用户配置目录，绝不写入仓库。
- **生成**：一键完成 源图视觉分析 → Qwen base 场景 → 视觉 base QA + 珠位规划
  → N 次独立 Wan 局部编辑 + 确定性合并 → 可选珠子名称标注。进度实时显示；
  失败给出中文原因，不自动重试。
- **保存成品**：即"下载/导出"；`打开输出文件夹` 可查看本次运行的全部中间产物。

### 用户数据位置（不写入仓库）

| 内容 | 位置 |
|---|---|
| 配置（含 API Key） | `%APPDATA%\Crystal\config.json` |
| 每次运行产物 | `%LOCALAPPDATA%\Crystal\runs\<时间戳-短ID>\` |

运行目录包含：`source.*`、`background.*`、`request.json`（不含密钥）、
`analysis.json`、`base.png`、`placements.json`、`candidate.png`、`final.png`，
失败时另有 `error.txt`。这些文件由应用自动产生与消费，**用户无需手写任何 JSON**。

## 流水线（planned multi-stage, zero-retry）

```
视觉源图分析（自动，含用户自然语言约束）
→ base: 1 Qwen call（qwen-image-3.0-pro；完整手镯 + 所选背景，不生成任何散珠/道具）
→ 视觉 base QA 门（FAIL 则停止，不跑 compose）+ 自动珠位规划
→ N independent Wan local edits, all against the same clean base
→ Pillow feather-merges only edited local regions
→ 确定性 Pillow 标注（可勾选关闭）
```

代表件生成独立而非顺序：先前代表件永远不可能污染后续代表件；
源图不加框（Wan bbox 语义 = 要编辑的区域，仅 Image 2 目标区域加框），身份由紧裁剪参考 + visual_identity 约束；
局部合并是场景区域合并（模型已渲染好代表件及其阴影/反射），不是水晶抠图合成，无 rembg/分割；
多次调用是有意设计的阶段，不是重试；计划成本 = `1 + N` 次图像模型调用；任一阶段失败即返回失败。

## 安装（源码运行）

```
pip install -r crystal/requirements.txt
```

模型分工：基础场景 = `CRYSTAL_BASE_MODEL`（默认 `qwen-image-3.0-pro`）；
代表件独立局部编辑 = `CRYSTAL_IMAGE_MODEL`（默认 `wan2.7-image-pro`）；
视觉理解 = `qwen3.7-plus`（OpenAI compatible-mode，`sk-sp-` key 自动走 Token Plan 端点）；
失败即失败，不回退重试。

## 打包（开发者）

```
crystal\build_exe.bat
```

使用 PyInstaller（仅构建期依赖，不在 `requirements.txt`）生成
`crystal/dist/Crystal/Crystal.exe`（无控制台、无需 Python）。
`templates/` 作为 **exe 旁的可编辑外部文件夹** 一并复制：
他人增删背景无需重新打包。配置/运行产物仍落在各用户 AppData。

打包/源码冒烟（不开 GUI、不联网）：

```
app.py --smoke-test        # 或 dist\Crystal\Crystal.exe --smoke-test
```

## 结构

| 文件 | 内容 |
|---|---|
| `app.py` | 桌面 GUI（Tkinter，仅 UI）+ `--smoke-test` |
| `desktop_core.py` | 配置 / 动态背景库 / 视觉理解 / 单一生成编排 |
| `crystal.py` | 图像生产核心（唯一图像管线；CLI 为开发者后备入口） |
| `Crystal.bat` | 桌面 GUI 源码启动器（双击入口） |
| `build_exe.bat` | 开发者打包入口 |
| `templates/` | 实时背景库（用户可自由增删） |
| `SKILL.md` | 开发/内部低层参考（非用户运行时） |
| `tests/test_crystal.py`、`tests/test_desktop.py` | 本地验证（无网络） |

## 开发者后备：CLI

桌面应用内部复用同一核心；调试时可手动分阶段执行
（`analysis.json` / `placements.json` 等为开发者调试文件，普通用户流程不需要）：

```
python crystal/crystal.py base    --input src.jpg --analysis a.json --output base.png --workdir work
python crystal/crystal.py compose --input base.png --source src.jpg --analysis a.json --placements p.json --output candidate.png --workdir work
python crystal/crystal.py label   --input candidate.png --labels l.json --output final.png
```

## 测试

```
python crystal/tests/test_crystal.py
python -m unittest discover -s crystal/tests -p "test_desktop.py"
```
