import { z } from 'zod';

export const AI_PROFILE_PRESETS = ['aliyun-qwen', 'volcengine-ark', 'custom'] as const;
export const AIProfilePresetSchema = z.enum(AI_PROFILE_PRESETS);
export const VisionDriverSchema = z.enum(['openai-compatible-vision']);
export const ImageDriverSchema = z.enum(['dashscope-image', 'volcengine-ark-image']);

/* ── Vision compatibility ── */

export const StructuredOutputModeSchema = z.enum([
  'auto',
  'json-schema',
  'json-object',
  'text-json',
]);
export const VisionCompatibilitySchema = z.object({
  imageInput: z.boolean(),
  structuredOutput: StructuredOutputModeSchema,
});

export const VisionCapabilitySchema = z.object({
  enabled: z.boolean(),
  driver: VisionDriverSchema,
  endpoint: z.string().trim().url(),
  model: z.string().trim().min(1).max(120),
  compatibility: VisionCompatibilitySchema,
});

/* ── Image compatibility ── */

export const ImageBatchModeSchema = z.enum(['auto', 'native', 'single']);
export const ImageSizeModeSchema = z.enum(['mapped', 'provider-default']);
export const ImagePromptEnhancementSchema = z.enum(['auto', 'on', 'off']);
export const ImageCompatibilitySchema = z.object({
  referenceImage: z.boolean(),
  batchMode: ImageBatchModeSchema,
  sizeMode: ImageSizeModeSchema,
  sizeByRatio: z.object({
    '1:1': z.string().trim().min(1).optional(),
    '3:4': z.string().trim().min(1).optional(),
    '4:3': z.string().trim().min(1).optional(),
  }),
  promptEnhancement: ImagePromptEnhancementSchema,
});

export const ImageCapabilitySchema = z.object({
  enabled: z.boolean(),
  driver: ImageDriverSchema,
  endpoint: z.string().trim().url(),
  model: z.string().trim().min(1).max(120),
  compatibility: ImageCompatibilitySchema,
});

/* ── Public / input schemas ── */

export const AIProfilePublicSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(60),
  preset: AIProfilePresetSchema,
  maskedKey: z.string(),
  vision: VisionCapabilitySchema,
  image: ImageCapabilitySchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const AISettingsPublicSchema = z.object({
  profiles: z.array(AIProfilePublicSchema),
  activeVisionProfileId: z.string().uuid().nullable(),
  activeImageProfileId: z.string().uuid().nullable(),
});

export const AIProfileInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  preset: AIProfilePresetSchema,
  apiKey: z.string().trim().max(500)
    .refine((value) => value.length === 0 || value.length >= 8, 'API Key 至少需要 8 个字符')
    .optional()
    .transform((value) => value || undefined),
  vision: VisionCapabilitySchema,
  image: ImageCapabilitySchema,
}).superRefine((profile, context) => {
  if (profile.image.enabled && profile.image.endpoint.includes('{WorkspaceId}')) {
    context.addIssue({
      code: 'custom',
      path: ['image', 'endpoint'],
      message: '请将接口地址中的 {WorkspaceId} 替换为百炼工作空间 ID',
    });
  }
  if (profile.image.compatibility.sizeMode === 'mapped') {
    const m = profile.image.compatibility.sizeByRatio;
    if (!m['1:1'] || !m['3:4'] || !m['4:3']) {
      context.addIssue({
        code: 'custom',
        path: ['image', 'compatibility', 'sizeByRatio'],
        message: '尺寸模式为预设映射时，必须填写 1:1、3:4、4:3 三种尺寸',
      });
    }
  }
});

export const ActiveAIProfilesInputSchema = z.object({
  visionProfileId: z.string().uuid().nullable(),
  imageProfileId: z.string().uuid().nullable(),
});
export const AIConnectionCapabilitySchema = z.enum(['vision', 'image']);

export type AIProfilePreset = z.infer<typeof AIProfilePresetSchema>;
export type VisionDriver = z.infer<typeof VisionDriverSchema>;
export type ImageDriver = z.infer<typeof ImageDriverSchema>;
export type StructuredOutputMode = z.infer<typeof StructuredOutputModeSchema>;
export type VisionCompatibility = z.infer<typeof VisionCompatibilitySchema>;
export type ImageBatchMode = z.infer<typeof ImageBatchModeSchema>;
export type ImageSizeMode = z.infer<typeof ImageSizeModeSchema>;
export type ImagePromptEnhancement = z.infer<typeof ImagePromptEnhancementSchema>;
export type ImageCompatibility = z.infer<typeof ImageCompatibilitySchema>;
export type VisionCapability = z.infer<typeof VisionCapabilitySchema>;
export type ImageCapability = z.infer<typeof ImageCapabilitySchema>;
export type AIProfilePublic = z.infer<typeof AIProfilePublicSchema>;
export type AISettingsPublic = z.infer<typeof AISettingsPublicSchema>;
export type AIProfileInput = z.infer<typeof AIProfileInputSchema>;
export type ActiveAIProfilesInput = z.infer<typeof ActiveAIProfilesInputSchema>;
export type AIConnectionCapability = z.infer<typeof AIConnectionCapabilitySchema>;

export const PROVIDER_PRESET_LABELS: Record<AIProfilePreset, string> = {
  'aliyun-qwen': '阿里云百炼 / 千问',
  'volcengine-ark': '火山方舟 / Seedream',
  custom: '自定义',
};

export const ALIYUN_VISION_ENDPOINT =
  'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
export const ALIYUN_IMAGE_ENDPOINT_TEMPLATE =
  'https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
export const LEGACY_ALIYUN_IMAGE_ENDPOINT =
  'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
export const VOLCENGINE_IMAGE_ENDPOINT =
  'https://ark.cn-beijing.volces.com/api/v3/images/generations';

export interface AIProfileDraftDefaults {
  vision: VisionCapability;
  image: ImageCapability;
}

export function profileDefaults(preset: AIProfilePreset): AIProfileDraftDefaults {
  if (preset === 'aliyun-qwen') {
    return {
      vision: {
        enabled: true, driver: 'openai-compatible-vision', endpoint: ALIYUN_VISION_ENDPOINT, model: 'qwen3.7-plus',
        compatibility: { imageInput: true, structuredOutput: 'auto' },
      },
      image: {
        enabled: true, driver: 'dashscope-image', endpoint: ALIYUN_IMAGE_ENDPOINT_TEMPLATE, model: 'qwen-image-3.0-pro',
        compatibility: {
          referenceImage: true, batchMode: 'native', sizeMode: 'mapped',
          sizeByRatio: { '1:1': '1024*1024', '3:4': '768*1344', '4:3': '1344*768' },
          promptEnhancement: 'auto',
        },
      },
    };
  }
  if (preset === 'volcengine-ark') {
    return {
      vision: {
        enabled: false, driver: 'openai-compatible-vision', endpoint: ALIYUN_VISION_ENDPOINT, model: 'qwen3.7-plus',
        compatibility: { imageInput: true, structuredOutput: 'auto' },
      },
      image: {
        enabled: true, driver: 'volcengine-ark-image', endpoint: VOLCENGINE_IMAGE_ENDPOINT, model: 'doubao-seedream-4-0-250828',
        compatibility: {
          referenceImage: true, batchMode: 'single', sizeMode: 'mapped',
          sizeByRatio: { '1:1': '2048x2048', '3:4': '1536x2048', '4:3': '2048x1536' },
          promptEnhancement: 'off',
        },
      },
    };
  }
  return {
    vision: {
      enabled: false, driver: 'openai-compatible-vision', endpoint: ALIYUN_VISION_ENDPOINT, model: 'qwen3.7-plus',
      compatibility: { imageInput: true, structuredOutput: 'auto' },
    },
    image: {
      enabled: false, driver: 'dashscope-image', endpoint: LEGACY_ALIYUN_IMAGE_ENDPOINT, model: 'qwen-image-3.0-pro',
      compatibility: {
        referenceImage: true, batchMode: 'native', sizeMode: 'mapped',
        sizeByRatio: { '1:1': '1024*1024', '3:4': '768*1344', '4:3': '1344*768' },
        promptEnhancement: 'auto',
      },
    },
  };
}
