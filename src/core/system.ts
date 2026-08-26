import { z } from 'zod';

export const AI_CONFIG_PROVIDER = '阿里云百炼 / DashScope' as const;
export const AI_VISION_MODEL = 'qwen3.7-plus' as const;
export const AI_IMAGE_MODEL = 'qwen-image-3.0-pro' as const;

export const AISettingsStatusSchema = z.object({
  configured: z.boolean(),
  source: z.enum(['runtime', 'environment', 'none']),
  maskedKey: z.string().nullable(),
  provider: z.literal(AI_CONFIG_PROVIDER),
  visionModel: z.literal(AI_VISION_MODEL),
  imageModel: z.literal(AI_IMAGE_MODEL),
});

export type AISettingsStatus = z.infer<typeof AISettingsStatusSchema>;
