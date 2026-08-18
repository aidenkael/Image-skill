# 商品场景图 Prompt 模板

## 通用结构

```
[人物描述], [人物动作 + 与商品的自然互动],
[商品保持约束],
[环境/场景描述],
[光线与氛围],
[摄影风格与构图],
[质量约束]
```

## 负面 Prompt（通用）

```
low quality, blurry, deformed, extra limbs, extra fingers, mutated hands,
plastic skin, waxy face, uncanny valley, airbrushed,
floating product, fake background, oversaturated, AI-generated look,
watermark, text overlay, extra products, distorted product,
changed logo, altered pattern, wrong color
```

---

## 模板 1：包/手提包 — 通勤街拍

### 正向 Prompt

```
A young professional woman in her late 20s with natural shoulder-length dark hair,
wearing a casual beige trench coat and white blouse,
naturally holding [PRODUCT] in one hand while walking on a tree-lined city street.

The product must remain exactly as shown in the reference image — same shape, color, material, hardware, logo, and proportions. Do not alter any detail.

Urban sidewalk with soft bokeh background of café terraces and pedestrians.
Warm afternoon golden hour sunlight casting soft natural shadows.
Shot on 85mm lens, shallow depth of field, editorial lifestyle photography style.
Ultra realistic, natural skin texture with visible pores, photorealistic.
```

### 负面 Prompt

```
low quality, blurry, plastic skin, waxy face, floating bag,
changed bag shape, altered logo, extra bags, watermark,
oversaturated, AI-generated look, deformed hands, extra fingers
```

---

## 模板 2：收纳盒 — 家居整理

### 正向 Prompt

```
A woman in her early 30s with a neat bun hairstyle, wearing a simple white linen top,
organizing items into [PRODUCT] on a clean wooden shelf in a bright minimalist bedroom.
Her hands are naturally placing a folded item into the box.

The product must remain exactly as shown in the reference image — same shape, color, size, material, and design. Do not alter any detail.

Bright Scandinavian-style room with white walls, wooden floor, and a few green plants.
Soft natural window light from the left, warm and airy atmosphere.
Shot on 50mm lens, medium depth of field, clean lifestyle photography.
Ultra realistic, natural skin, photorealistic.
```

---

## 模板 3：杯子/保温杯 — 户外晨间

### 正向 Prompt

```
A young man in his mid-20s with short brown hair and light stubble,
wearing a casual grey hoodie, holding [PRODUCT] with both hands and taking a sip
on a park bench surrounded by autumn trees.

The product must remain exactly as shown in the reference image — same shape, color, size, logo, and material. Do not alter any detail.

Park setting with fallen leaves, morning mist, and soft golden light filtering through trees.
Cool autumn morning atmosphere, warm drink steam visible.
Shot on 70mm lens, shallow depth of field, candid lifestyle photography.
Ultra realistic, natural skin texture, photorealistic.
```

---

## 模板 4：发饰 — 真人佩戴

### 正向 Prompt

```
A young woman in her early 20s with long wavy dark hair,
wearing [PRODUCT] in her hair, turning her head slightly with a natural smile,
sitting at a vanity table with a round mirror.

The product must remain exactly as shown in the reference image — same shape, color, design, and size. Do not alter any detail.

Soft bedroom vanity setup with warm ambient light, a few beauty products on the table.
Soft diffused natural light, warm and feminine atmosphere.
Shot on 85mm portrait lens, close-up, beauty editorial photography.
Ultra realistic, natural skin with pores, detailed hair strands, photorealistic.
```

---

## 模板 5：化妆刷 — 使用中特写

### 正向 Prompt

```
A professional makeup artist's hand naturally holding [PRODUCT],
applying blush on a young woman's cheek. The woman has her eyes gently closed
with a relaxed expression.

The product must remain exactly as shown in the reference image — same shape, color, handle material, bristle shape. Do not alter any detail.

Close-up beauty scene, soft studio-like lighting from the right,
clean background with warm neutral tones.
Shot on 100mm macro lens, shallow depth of field focused on the brush and cheek.
Ultra realistic, natural skin texture with visible pores and fine peach fuzz, photorealistic.
```

---

## 使用说明

1. 将 `[PRODUCT]` 替换为实际商品描述
2. 根据商品实际情况调整人物描述（年龄、性别、发型等）
3. 负面 Prompt 直接使用通用版本
4. 如果使用 Qwen Image Edit API，将正向 Prompt 作为 text instruction 传入
5. 如果使用 Gemini 参考图模式，将商品图作为 reference image 传入
