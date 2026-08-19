---
name: framing-scene
description: camera_angle（限 known_views）、scene（由交互派生的真实环境）、composition（商品为 hero 的占比与朝向）、light 的品类中立推导。
---

# Framing / Scene / Light（镜头 · 场景 · 构图 · 光线）

## camera_angle（只能选自 known_views）

- 从 known_views 选**信息最多且最能突出商品**的视角（优先 front-3/4 > front > side）。
- 镜头高度/距离服务于 composition（见下），但**朝向**不得超出 known_views。
- 若用户指定视角 ∈ unknown_views → 拒绝并解释，改选最近似 known 视角 + 遮挡策略。

## scene（由交互派生，非品类查表）

scene = 主交互**真实发生**的环境：

| interaction_mode | 候选真实环境 |
|---|---|
| wear-crossbody / wear-shoulder / carry-hand | 通勤街道、咖啡馆外、地铁口、城市人行道 |
| fill-place / open-use | 厨房台面、卧室、衣帽间、桌面 |
| place-static | 客厅架、窗台、书桌、浴室台 |
| operate-hand | 桌面、户外长椅、工作台 |
| wear-body | 梳妆台、浴室镜前、日常室内 |

选 1 个主场景 + 1-2 个环境道具（cafe 遮阳棚、自行车、绿植…）增加真实感，但道具不得抢焦点、不得与商品同色混淆。

## composition（商品为 hero）

- 商品占画面 **20-40%**（全身人像时）或 **≥50%**（特写/静物时），始终为视觉焦点。
- known 面（带标识面）朝向镜头，位于三分线交点附近。
- 人物/道具作引导线，把视线引向商品。
- 留白适度，背景虚化（shallow DoF）突出主体。

## light

- 默认 **natural soft light**（golden hour / window light），方向单一、阴影自然。
- 室外通勤 → warm afternoon golden hour；室内 → soft window light from one side。
- 避免：多光源冲突、过曝、HDR 感、棚拍打光与场景不符。
