---
name: structure-fidelity
description: 证据提取规范 —— 如何从参考图导出 product_structure 与 immutable_features。品类中立的写法与提取维度，禁止品类推断与静默默认。
---

# Structure & Fidelity（证据提取）

## Evidence Extraction（Step 1）

对每张参考图做一次视觉提取，产出两个字段。提取必须**描述所见**，不得**推断所缺**。

### product_structure（结构描述，品类中立）

按 4 个维度写，全部来自画面可见内容：

1. **轮廓与刚性** — 整体 silhouette（rectangular / cylindrical / irregular…）+ rigid / soft / semi-rigid。
2. **部件清单** — 枚举可见部件（strap / handle / lid / zipper / legs / opening / emblem / tab…），**只列看见的**。
3. **连接关系** — 部件如何连接（strap attached at two upper corners; lid hinged at back…）。看不见连接点就写 "attachment not visible"，不要猜。
4. **比例** — 部件相对主体的大小/长短（long strap ≈ 2× body width…）。

> 正确示例（包）：`soft rectangular body; ONE long adjustable black strap attached at two upper anchors; one tan leather tab at left anchor; circular gold emblem centered on front face`。
> 错误示例：`a handbag`（品类标签，无结构信息）/ `has a bottom zipper`（未见却写）。

### immutable_features（不可变特征）

按 6 类提取，每类"看见才写"：

| 类 | 内容 |
|---|---|
| 颜色 | 主色 + 辅色 + 五金色（exact hue，如 "matte black, tan leather, gold hardware"） |
| 标识 | Logo/图案的形状、位置、朝向（"circular gold emblem with upward arrow, centered front"） |
| 材质纹理 | leather grain / crinkle / matte / glossy / knit… |
| 五金件 | 扣/环/拉链头的形状与 finish |
| 部件数量与连接点 | "exactly ONE strap, two anchors"（防复制/防缺失） |
| 比例 | 主体长宽比、部件相对比例 |

### 提取守则

- **看见才写**：任何维度看不清/没出现 → 该维度进入 `unknown`（见 evidence-views.md），不写默认值。
- **精确优于笼统**：写 "dark brown with red undertones" 而非 "brown"（复用 multi-angle 提取规范的精确度要求）。
- **置信度门槛**：必填维度（颜色/标识/部件数量）提取置信度低 → 向用户澄清（一次一个维度），不静默默认。
