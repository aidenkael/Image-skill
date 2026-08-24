import { z } from 'zod';

/**
 * 模板（编辑器文档）领域契约。
 * 模板 JSON 是数据，不是 React 代码；这里定义编辑器文档的领域 schema。
 */

export const COLLAGE_TEMPLATE_IDS = [
  'left-hero-right-three',
  'top-hero-bottom-three',
  'four-grid',
] as const;
export type CollageTemplateId = (typeof COLLAGE_TEMPLATE_IDS)[number];

/** 详情页模板目录（V2 阶段保留） */
export const DETAIL_TEMPLATE_DIR = 'detail';

const ImageContentTransformSchema = z.object({
  left: z.number(),
  top: z.number(),
  scaleX: z.number().positive(),
  scaleY: z.number().positive(),
});

const ImageSlotLayerSchema = z.object({
  type: z.literal('image'),
  id: z.string().min(1),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  fit: z.enum(['cover', 'contain']),
  radius: z.number().min(0).optional(),
  /** 该图片槽位对应第几个选中资产（0 起） */
  slotIndex: z.number().int().min(0),
  assetId: z.string().nullable().optional(),
  /** 图片在固定槽位框内的可编辑位置与缩放；槽位几何本身保持不变 */
  contentTransform: ImageContentTransformSchema.optional(),
});
export type ImageSlotLayer = z.infer<typeof ImageSlotLayerSchema>;

const TextLayerSchema = z.object({
  type: z.literal('text'),
  id: z.string().min(1),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  text: z.string(),
  fontSize: z.number().positive(),
  fontWeight: z.union([z.literal(400), z.literal(500), z.literal(600), z.literal(700)]).optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  color: z.string().optional(),
  /** headline=主标题；selling-point=卖点标签（由客户端按开关填充） */
  tag: z.enum(['headline', 'selling-point']).optional(),
});

const ShapeLayerSchema = z.object({
  type: z.literal('shape'),
  id: z.string().min(1),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  fill: z.string().optional(),
  radius: z.number().min(0).optional(),
});

export const EditorLayerSchema = z.discriminatedUnion('type', [
  ImageSlotLayerSchema,
  TextLayerSchema,
  ShapeLayerSchema,
]);
export type EditorLayer = z.infer<typeof EditorLayerSchema>;

export const TemplateDocumentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  width: z.number().positive(),
  height: z.number().positive(),
  layers: z.array(EditorLayerSchema),
});
export type TemplateDocument = z.infer<typeof TemplateDocumentSchema>;

export class TemplateValidationError extends Error {}

export function parseTemplateDocument(
  json: unknown,
  allowedIds: readonly string[] = COLLAGE_TEMPLATE_IDS,
): TemplateDocument {
  const doc = TemplateDocumentSchema.safeParse(json);
  if (!doc.success) {
    const detail = doc.error.issues
      .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
      .join('; ');
    throw new TemplateValidationError(`模板文档不合法：${detail}`);
  }
  if (!(allowedIds as readonly string[]).includes(doc.data.id)) {
    throw new TemplateValidationError(`模板 id 不在允许列表：${doc.data.id}`);
  }
  return doc.data;
}
